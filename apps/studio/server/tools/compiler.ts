import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { fileMapSchema, manifestSchema, type ToolFiles, type ToolDiagnostic } from '../../lib/tools/contracts';
import { schemaValidator } from '../workspace-harness/schema';
import { isolatedCodeRunner } from '../code/runner';
import { isDeepStrictEqual } from 'node:util';
export const toolkitTypes = `export interface ToolContext { readonly log: { info(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void }; readonly invocationId: string; }`;
export const toolchain = `toolkit@1/typescript@${ts.version}/esbuild@${esbuildVersion}/quickjs@0.32.0`;
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function packageHash(raw: ToolFiles) {
  const files = fileMapSchema.parse(raw);
  return sha(
    JSON.stringify(
      Object.keys(files)
        .sort()
        .map((path) => [path, files[path]]),
    ),
  );
}
function schemaType(s: any, depth = 0): string {
  if (depth > 20) throw Error('Schema nesting exceeds 20 levels.');
  if (s.enum) return s.enum.map((x: unknown) => JSON.stringify(x)).join(' | ') || 'never';
  if (s.type === 'array') return `Array<${schemaType(s.items ?? {}, depth + 1)}>`;
  if (s.type === 'object')
    return `{ ${Object.entries(s.properties ?? {})
      .map(([k, v]) => `${JSON.stringify(k)}${s.required?.includes(k) ? '' : '?'}: ${schemaType(v, depth + 1)}`)
      .join('; ')} }`;
  return (
    (
      { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' } as Record<
        string,
        string
      >
    )[s.type] ?? 'unknown'
  );
}
export async function compileInProcess(raw: ToolFiles) {
  const files = fileMapSchema.parse(raw),
    hash = packageHash(files);
  const manifest = manifestSchema.parse(JSON.parse(files['tool.json'] ?? '{}'));
  const readJSON = (path: string) => {
    if (!(path in files)) throw Error(`Missing package file: ${path}`);
    return JSON.parse(files[path]);
  };
  if (!(manifest.entrypoint in files)) throw Error('Entrypoint is missing.');
  for (const path of [manifest.inputSchema, manifest.outputSchema])
    if (Buffer.byteLength(files[path] ?? '') > 16384) throw Error('Schema exceeds 16 KiB.');
  const inputSchema = readJSON(manifest.inputSchema),
    outputSchema = readJSON(manifest.outputSchema);
  schemaValidator(inputSchema);
  schemaValidator(outputSchema);
  if (new Set(manifest.tests.map((t) => t.name)).size !== manifest.tests.length)
    throw Error('Fixture names must be unique.');
  for (const t of manifest.tests) {
    readJSON(t.input);
    readJSON(t.expected);
  }
  const types = `export type Input = ${schemaType(inputSchema)};\nexport type Output = ${schemaType(outputSchema)};`;
  const sdk = toolkitTypes;
  const virtual: ToolFiles = {
    ...Object.fromEntries(Object.entries(files).map(([p, s]) => [`/tool/${p}`, s])),
    '/tool/.stackproc/types.d.ts': types,
    '/tool/toolkit.d.ts': sdk,
  };
  const opts: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2020.d.ts'],
    types: [],
    allowJs: true,
    checkJs: true,
  };
  const host = ts.createCompilerHost(opts),
    originalRead = host.readFile.bind(host),
    originalExists = host.fileExists.bind(host);
  const libRoot = posix.dirname(ts.getDefaultLibFilePath(opts));
  const trusted = (p: string) => p.startsWith(libRoot + '/lib.') && p.endsWith('.d.ts');
  host.readFile = (p) => virtual[p] ?? (trusted(p) ? originalRead(p) : undefined);
  host.fileExists = (p) => p in virtual || (trusted(p) && originalExists(p));
  host.directoryExists = (p) => p === '/tool' || Object.keys(virtual).some((k) => k.startsWith(p + '/'));
  host.getCurrentDirectory = () => '/tool';
  host.resolveModuleNames = (names) =>
    names.map((name) => {
      if (name === '@stackproc/toolkit') return { resolvedFileName: '/tool/toolkit.d.ts' };
      if (!name.startsWith('.')) return undefined;
      const path = posix.normalize(posix.join('/tool', posix.dirname(manifest.entrypoint), name));
      // TypeScript supplies the containing file through resolveModuleNameLiterals below.
      return ['/index.ts', '.ts', '.d.ts', '.js', '']
        .map((ext) => path + ext)
        .filter((p) => p in virtual)
        .map((resolvedFileName) => ({ resolvedFileName }))[0];
    });
  host.resolveModuleNameLiterals = (literals, containing) =>
    literals.map(({ text }) => {
      const base =
        text === '@stackproc/toolkit'
          ? '/tool/toolkit'
          : text.startsWith('.')
            ? posix.resolve(posix.dirname(containing), text)
            : '';
      const resolved = ['', '.ts', '.d.ts', '.js', '/index.ts'].map((ext) => base + ext).find((p) => p in virtual);
      return {
        resolvedModule: resolved
          ? {
              resolvedFileName: resolved,
              extension: resolved.endsWith('.d.ts')
                ? ts.Extension.Dts
                : resolved.endsWith('.js')
                  ? ts.Extension.Js
                  : ts.Extension.Ts,
            }
          : undefined,
      };
    });
  const program = ts.createProgram(
    Object.keys(virtual).filter((p) => /\.[jt]s$/.test(p)),
    opts,
    host,
  );
  const diagnostics: ToolDiagnostic[] = ts.getPreEmitDiagnostics(program).map((d) => {
    const point = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return {
      file: d.file?.fileName.replace('/tool/', '') ?? 'tool.json',
      line: point ? point.line + 1 : undefined,
      column: point ? point.character + 1 : undefined,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    };
  });
  for (const source of program.getSourceFiles().filter((f) => f.fileName.startsWith('/tool/src/'))) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const point = source.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          file: source.fileName.replace('/tool/', ''),
          line: point.line + 1,
          column: point.character + 1,
          message: 'Dynamic imports are unavailable in pure-js-v1.',
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (diagnostics.length)
    return { hash, manifest, diagnostics, types, source: '', buildHash: '', inputSchema, outputSchema };
  const result = await build({
    entryPoints: [manifest.entrypoint],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__tool',
    platform: 'neutral',
    target: 'es2020',
    sourcemap: 'inline',
    logLevel: 'silent',
    plugins: [
      {
        name: 'package-only',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            const path =
              args.kind === 'entry-point'
                ? posix.normalize(args.path)
                : args.path.startsWith('.')
                  ? posix.normalize(posix.join(posix.dirname(args.importer), args.path))
                  : '';
            if (!path || path.startsWith('../'))
              return { errors: [{ text: 'External and escaped imports are unavailable in pure-js-v1.' }] };
            const resolved = ['', '.ts', '.js', '/index.ts']
              .map((ext) => path + ext)
              .find((p) => Object.hasOwn(files, p));
            return resolved
              ? { path: resolved, namespace: 'tool' }
              : { errors: [{ text: `Missing package import: ${args.path}` }] };
          });
          b.onLoad({ filter: /.*/, namespace: 'tool' }, (args) => ({
            contents: files[args.path],
            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          }));
        },
      },
    ],
  });
  const bundled = result.outputFiles[0].text;
  if (Buffer.byteLength(bundled) > 256 * 1024) throw Error('Compiled JavaScript exceeds 256 KiB.');
  const source = `${bundled}\nif(typeof __tool.run!=='function')throw new Error('Export run(input, ctx).');\nreturn await __tool.run(input,Object.freeze({log:console,invocationId:String(variables.invocationId || 'local-test')}));`;
  if (source.length > 100000)
    throw Error('Compiled tool exceeds the current executor limit of 100,000 source characters.');
  return {
    hash,
    manifest,
    diagnostics,
    types,
    source,
    buildHash: sha(toolchain + '\n' + source),
    inputSchema,
    outputSchema,
  };
}
export type ToolBuild = Awaited<ReturnType<typeof compileTool>>;
export async function executeBuild(build: ToolBuild, input: unknown, invocationId: string, signal?: AbortSignal) {
  if (build.diagnostics.length || !build.source) throw Error('Tool has compilation errors.');
  const result = await isolatedCodeRunner.execute(
    {
      version: 1,
      language: 'javascript',
      source: build.source,
      runtime: 'quickjs-wasm@0.32.0',
      dependencies: [],
      mode: 'all-items',
      limits: build.manifest.limits,
      inputSchema: build.inputSchema,
      outputSchema: build.outputSchema,
    },
    input,
    { invocationId },
    signal,
  );
  return { ...result, revision: build.buildHash };
}
export async function testBuild(
  build: ToolBuild,
  files: ToolFiles,
  signal?: AbortSignal,
  fixtureName?: string,
  progress?: (event: unknown) => void,
) {
  const results = [];
  if (fixtureName && !build.manifest.tests.some((t) => t.name === fixtureName)) throw Error('Fixture not found.');
  const deadline = AbortSignal.timeout(30000);
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (const fixture of build.manifest.tests.filter((t) => !fixtureName || t.name === fixtureName)) {
    progress?.({ phase: 'testing', fixture: fixture.name });
    try {
      const result = await executeBuild(build, JSON.parse(files[fixture.input]), `fixture:${fixture.name}`, signal);
      const success = isDeepStrictEqual(result.value, JSON.parse(files[fixture.expected]));
      results.push({
        name: fixture.name,
        success,
        output: result.value,
        logs: result.logs,
        error: success ? undefined : 'Output does not match expected fixture.',
      });
    } catch (error) {
      results.push({
        name: fixture.name,
        success: false,
        error: error instanceof Error ? error.message : 'Test failed.',
      });
    }
  }
  return {
    success: results.every((r) => r.success),
    complete: results.length === build.manifest.tests.length,
    results,
  };
}

let activeCompilers = 0;
export async function compileTool(raw: ToolFiles): Promise<Awaited<ReturnType<typeof compileInProcess>>> {
  fileMapSchema.parse(raw);
  if (activeCompilers >= 2) throw Error('Compiler capacity reached. Retry later.');
  activeCompilers++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./compiler-worker.mjs', import.meta.url), {
        workerData: { files: raw, development: import.meta.url.endsWith('.ts') },
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
      let finished = false;
      const done = (error?: Error, value?: Awaited<ReturnType<typeof compileInProcess>>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        void worker.terminate().finally(() => (error ? reject(error) : resolve(value!)));
      };
      const timer = setTimeout(() => done(new Error('Tool compilation exceeded 15 seconds.')), 15000);
      worker.once('message', (m) => (m.ok ? done(undefined, m.build) : done(new Error(m.error))));
      worker.once('error', (e) => done(e));
      worker.once('exit', (code) => {
        if (!finished) done(new Error(`Compiler exited without a result (${code}).`));
      });
    });
  } finally {
    activeCompilers--;
  }
}
