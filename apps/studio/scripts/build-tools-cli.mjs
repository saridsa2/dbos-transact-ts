import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const dir = new URL('../cli/dist/', import.meta.url);
await mkdir(dir, { recursive: true });
await build({
  entryPoints: [new URL('../cli/main.ts', import.meta.url).pathname],
  outfile: new URL('stackproc.mjs', dir).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
});
await build({
  entryPoints: [new URL('../server/tools/compiler.ts', import.meta.url).pathname],
  outfile: new URL('compiler-engine.mjs', dir).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
});
await copyFile(new URL('../server/code/worker.mjs', import.meta.url), new URL('worker.mjs', dir));
await copyFile(new URL('../server/tools/compiler-worker.mjs', import.meta.url), new URL('compiler-worker.mjs', dir));
await copyFile(new URL('../../../LICENSE', import.meta.url), new URL('../cli/LICENSE', import.meta.url));
await writeFile(
  new URL('../cli/package.json', import.meta.url),
  JSON.stringify(
    {
      name: '@stackproc/cli',
      version: '0.1.0',
      license: 'MIT',
      type: 'module',
      engines: { node: '>=22.13' },
      bin: { procczar: 'dist/stackproc.mjs', stackproc: 'dist/stackproc.mjs' },
      files: ['dist'],
      dependencies: {
        typescript: '5.9.3',
        esbuild: '0.28.2',
        'quickjs-emscripten': '0.32.0',
        fflate: '0.8.2',
        zod: '4.3.6',
        ajv: '8.20.0',
        jsep: '1.6.0',
      },
    },
    null,
    2,
  ) + '\n',
);
