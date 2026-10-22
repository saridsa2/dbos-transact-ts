#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, lstat, chmod, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { starterFiles, fileMapSchema, manifestSchema, type ToolFiles } from '../lib/tools/contracts';
import { compileTool, packageHash, testBuild, toolkitTypes } from '../server/tools/compiler';
import { packTool, unpackTool } from '../server/tools/package';
const argv = process.argv.slice(2),
  [group, command] = argv;
const flag = (name: string) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? undefined : argv[i + 1];
};
const yes = (name: string) => argv.includes('--' + name);
const booleanFlags = new Set(['remote', 'json', 'help', 'watch', 'api-key-stdin']);
const valueFlags = new Set([
  'server',
  'workspace',
  'profile',
  'fixture',
  'output',
  'hash',
  'version',
  'revision',
  'language',
]);
const positional: string[] = [];
const seenFlags = new Set<string>();
let argumentError = '';
for (let i = 2; i < argv.length; i++) {
  const value = argv[i];
  if (!value.startsWith('--')) {
    positional.push(value);
    continue;
  }
  const name = value.slice(2);
  if (seenFlags.has(name)) {
    argumentError = `Repeated flag: --${name}`;
    break;
  }
  seenFlags.add(name);
  if (booleanFlags.has(name)) continue;
  if (!valueFlags.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
    argumentError = `Unknown flag or missing value: --${name}`;
    break;
  }
  i++;
}

const configDir = join(homedir(), '.stackproc'),
  profile = flag('profile') ?? 'default';
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(profile)) throw Error('Invalid profile.');
const configPath = join(configDir, profile + '.json');
let config: any = {};
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch {}
const server = flag('server') ?? process.env.PROCCZAR_SERVER ?? process.env.STACKPROC_SERVER ?? config.server;
let workspace =
  flag('workspace') ?? process.env.PROCCZAR_WORKSPACE ?? process.env.STACKPROC_WORKSPACE ?? config.workspace;
let loginToken: string | undefined;
const envToken = process.env.PROCCZAR_API_KEY ?? process.env.STACKPROC_TOKEN;
const output = (value: unknown) =>
  process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n');
// macOS stores tokens in Keychain; CI supplies short-lived bearer credentials via the environment.
function keychain(action: 'read' | 'write' | 'delete', value?: string) {
  if (process.platform !== 'darwin')
    throw Error(
      'This CLI uses macOS Keychain for interactive credentials. On other platforms provide PROCCZAR_API_KEY from a credential manager.',
    );
  const service = `stackproc:${server}:${profile}`;
  const args =
    action === 'read'
      ? ['find-generic-password', '-s', service, '-a', 'developer', '-w']
      : action === 'delete'
        ? ['delete-generic-password', '-s', service, '-a', 'developer']
        : ['add-generic-password', '-U', '-s', service, '-a', 'developer', '-w', value!];
  const result = spawnSync('/usr/bin/security', args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw Error(action === 'read' ? 'Sign in with procczar auth login.' : 'Credential store operation failed.');
  return result.stdout.trim();
}
async function saveConfig() {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(configPath, JSON.stringify({ ...config, server, workspace }, null, 2), { mode: 0o600 });
  await chmod(configPath, 0o600);
}
function serverURL(path: string) {
  if (!server) throw Error('Use --server or PROCCZAR_SERVER.');
  const u = new URL(server);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    throw Error('Remote servers require HTTPS.');
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash)
    throw Error('Server must be an origin without credentials.');
  return new URL(path, u);
}
async function api(path: string, value?: unknown, anonymous = false) {
  const token = anonymous ? undefined : (loginToken ?? envToken ?? keychain('read'));
  const response = await fetch(serverURL(path), {
    method: value === undefined ? 'GET' : 'POST',
    redirect: 'error',
    headers: {
      ...(value === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(workspace ? { 'x-studio-workspace': workspace } : {}),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`[${response.status}] ${result.error ?? 'Request failed.'}`);
  return result;
}
async function readPackage(dir: string): Promise<ToolFiles> {
  if (dir.endsWith('.sptool')) return unpackTool(await readFile(resolve(dir)));
  const root = resolve(dir),
    files: ToolFiles = {};
  async function visit(sub: string) {
    for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
      const path = sub ? `${sub}/${entry.name}` : entry.name;
      if (!sub && !['tool.json', 'src', 'schemas', 'tests', 'README.md'].includes(entry.name)) continue;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) throw Error(`Symlink is not allowed: ${path}`);
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) {
        if (stat.size > 1048576) throw Error('File exceeds size limit.');
        files[path] = await readFile(join(root, path), 'utf8');
        fileMapSchema.parse(files);
      } else throw Error('Special files are unavailable.');
    }
  }
  await visit('');
  return fileMapSchema.parse(files);
}
async function writePackage(dir: string, files: ToolFiles) {
  for (const path of Object.keys(files)) {
    try {
      await lstat(join(dir, path));
      throw Error(`Refusing to overwrite ${path}. Choose an empty output folder.`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  for (const [path, text] of Object.entries(files)) {
    await mkdir(resolve(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text, { flag: 'wx' });
  }
}
async function devFiles(dir: string, types: string) {
  await mkdir(join(dir, '.stackproc'), { recursive: true });
  await writeFile(join(dir, '.stackproc/types.d.ts'), types);
  await writeFile(join(dir, '.stackproc/toolkit.d.ts'), `declare module '@stackproc/toolkit' { ${toolkitTypes} }`);
  try {
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2020'],
            types: [],
            skipLibCheck: true,
          },
          include: ['src/**/*', '.stackproc/*.d.ts'],
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
}
async function main() {
  if (argumentError) throw Error(argumentError);
  if (flag('revision') && command !== 'enable')
    throw Error('Historical-revision pull is not available; --revision currently applies only to enable.');
  if (yes('watch')) throw Error('Draft watch is not available in this release. Use explicit upload.');
  if (flag('language') && flag('language') !== 'typescript')
    throw Error(
      'The scaffold currently supports --language typescript. JavaScript source can be authored with JSDoc types.',
    );
  if (!group || yes('help')) {
    output(
      'procczar auth login|status|logout; workspace select <id>; tools init|validate|test|upload|pack|pull|diff|history|inspect|publish|enable\nFlags: --server --workspace --profile --json. CI: PROCCZAR_SERVER, PROCCZAR_WORKSPACE, PROCCZAR_API_KEY. Login: --api-key-stdin stores a key in macOS Keychain.',
    );
    return;
  }
  if (group === 'auth' && command === 'status') {
    output(await api('/api/tools/auth/session'));
    return;
  }
  if (group === 'auth' && command === 'login' && yes('api-key-stdin')) {
    if (process.stdin.isTTY) throw Error('Pipe the API key through stdin, or set PROCCZAR_API_KEY.');
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 1024) throw Error('Invalid API key.');
    }
    loginToken = value.trim();
    if (!/^pcc_ws_[A-Za-z0-9_-]{43}$/.test(loginToken)) throw Error('Invalid workspace API key.');
    const result = await api('/api/tools/auth/session');
    keychain('write', loginToken);
    workspace = result.workspaceId;
    config.expiresAt = result.expiresAt;
    await saveConfig();
    loginToken = undefined;
    output({ signedIn: true, ...result });
    return;
  }
  if (group === 'auth' && command === 'login') {
    const verifier = randomBytes(32).toString('base64url'),
      challenge = createHash('sha256').update(verifier).digest('base64url');
    const flow = await api('/api/tools/auth/device', { challenge }, true);
    output(`Open ${serverURL(flow.verificationPath)}\nApprove developer access for code ${flow.code}.`);
    const until = Date.now() + flow.expiresIn * 1000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, flow.interval * 1000));
      const result = await api('/api/tools/auth/token', { id: flow.id, verifier }, true);
      if (result.pending) continue;
      keychain('write', result.token);
      workspace = result.workspaceId;
      config.expiresAt = result.expiresAt;
      await saveConfig();
      output({ signedIn: true, workspace, expiresAt: result.expiresAt });
      return;
    }
    throw Error('Login expired.');
  }
  if (group === 'auth' && command === 'logout') {
    if (envToken) throw Error('Remove PROCCZAR_API_KEY or STACKPROC_TOKEN from your environment to sign out.');
    const stored = keychain('read');
    if (!stored.startsWith('pcc_ws_')) await api('/api/tools/auth/revoke', {});
    keychain('delete');
    output({ signedOut: true });
    return;
  }
  if (group === 'workspace' && command === 'select') {
    workspace = positional[0];
    if (!workspace) throw Error('Specify a workspace ID.');
    await saveConfig();
    output({ workspace });
    return;
  }
  if (group !== 'tools') throw Error('Unknown command.');
  let dir = resolve(positional[0] ?? '.');
  if (command === 'init') {
    const slug = positional[0] ?? 'sum-values',
      files = starterFiles(randomUUID(), slug);
    manifestSchema.parse(JSON.parse(files['tool.json']));
    await writePackage(resolve(slug), files);
    await devFiles(resolve(slug), (await compileTool(files)).types);
    output({ directory: resolve(slug) });
    return;
  }
  if (['history', 'inspect', 'pull'].includes(command)) {
    const id = positional[0];
    if (!id) throw Error('Specify a tool UUID.');
    const data = await api(`/api/tools/${id}${command === 'history' ? '/history' : ''}`);
    if (command === 'pull') {
      const out = flag('output');
      if (!out) throw Error('pull requires --output pointing to an empty directory.');
      await writePackage(resolve(out), data.files);
      await mkdir(join(resolve(out), '.stackproc'), { recursive: true });
      await writeFile(join(resolve(out), '.stackproc/remote.lock.json'), JSON.stringify(data.tool));
      output({ directory: resolve(out), tool: data.tool });
    } else output(data);
    return;
  }
  const files = await readPackage(dir),
    manifest = manifestSchema.parse(JSON.parse(files['tool.json']));
  if (positional[0]?.endsWith('.sptool')) dir = resolve(dir, '..', '.stackproc', manifest.id);
  if (command === 'pack') {
    const out = flag('output') ?? `${manifest.slug}.sptool`;
    await writeFile(out, packTool(files), { flag: 'wx' });
    output({ file: resolve(out), hash: packageHash(files) });
    return;
  }
  const build = await compileTool(files);
  if (!positional[0]?.endsWith('.sptool')) await devFiles(dir, build.types);
  if (command === 'validate') {
    output({ hash: build.hash, buildHash: build.buildHash, diagnostics: build.diagnostics });
    if (build.diagnostics.length) process.exitCode = 2;
    return;
  }
  if (command === 'test' && !yes('remote')) {
    if (build.diagnostics.length) {
      output(build.diagnostics);
      process.exitCode = 2;
      return;
    }
    const result = await testBuild(build, files, undefined, flag('fixture'));
    output({ ...result, profile: 'local', hash: build.hash, buildHash: build.buildHash });
    if (!result.success) process.exitCode = 2;
    return;
  }
  let lock: any = { editVersion: 0 };
  try {
    lock = JSON.parse(await readFile(join(dir, '.stackproc/remote.lock.json'), 'utf8'));
  } catch {}
  if (command === 'upload') {
    if (build.diagnostics.length)
      throw Error('Resolve validation errors before CLI upload. Browser Save draft can retain invalid source.');
    await mkdir(join(dir, '.stackproc'), { recursive: true });
    const receiptPath = join(dir, '.stackproc/upload.command.json');
    let receipt: any;
    try {
      receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    } catch {}
    const payload = {
      id: manifest.id,
      files,
      expectedVersion: receipt?.hash === build.hash ? receipt.expectedVersion : (lock.editVersion ?? 0),
      commandKey: receipt?.hash === build.hash ? receipt.key : randomUUID(),
    };
    await writeFile(
      receiptPath,
      JSON.stringify({ key: payload.commandKey, hash: build.hash, expectedVersion: payload.expectedVersion }),
    );
    const result = await api('/api/tools/uploads', payload);
    await writeFile(join(dir, '.stackproc/remote.lock.json'), JSON.stringify(result.tool));
    await unlink(receiptPath);
    output(result);
    return;
  }
  const remote = await api(`/api/tools/${manifest.id}`);
  if (command === 'diff') {
    output({
      localHash: build.hash,
      remoteHash: remote.tool.hash,
      changes: [...new Set([...Object.keys(files), ...Object.keys(remote.files)])]
        .filter((p) => files[p] !== remote.files[p])
        .map((file) => ({ file, local: files[file] ?? null, remote: remote.files[file] ?? null })),
    });
    return;
  }
  if (command === 'test' && yes('remote')) {
    if (remote.tool.hash !== build.hash) throw Error('Upload these exact files before remote testing.');
    const r = await api(`/api/tools/${manifest.id}/tests`, {
      hash: build.hash,
      ...(flag('fixture') ? { fixture: flag('fixture') } : {}),
    });
    output(r);
    if (!r.success) process.exitCode = 2;
    return;
  }
  if (command === 'publish') {
    if (flag('hash') !== build.hash || remote.tool.hash !== build.hash)
      throw Error('publish requires --hash matching the local and remote package.');
    const receiptPath = join(dir, '.stackproc/publish.command.json');
    let receipt: any;
    try {
      receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    } catch {}
    const key = receipt?.hash === build.hash ? receipt.key : randomUUID(),
      expectedVersion = receipt?.hash === build.hash ? receipt.expectedVersion : remote.tool.editVersion;
    await mkdir(join(dir, '.stackproc'), { recursive: true });
    await writeFile(receiptPath, JSON.stringify({ key, hash: build.hash, expectedVersion }));
    const published = await api(`/api/tools/${manifest.id}/releases`, {
      hash: build.hash,
      version: flag('version') ?? manifest.version,
      expectedVersion,
      commandKey: key,
    });
    await unlink(receiptPath);
    output(published);
    return;
  }
  if (command === 'enable') {
    const revision = Number(flag('revision'));
    if (!Number.isInteger(revision) || revision < 1) throw Error('Specify --revision.');
    const bound = await api(`/api/tools/${manifest.id}/bindings`, {
      revision,
      expectedVersion: remote.tool.editVersion,
      commandKey: randomUUID(),
    });
    await mkdir(join(dir, '.stackproc'), { recursive: true });
    await writeFile(join(dir, '.stackproc/remote.lock.json'), JSON.stringify(bound.tool));
    output(bound);
    return;
  }
  throw Error('Unknown tools command.');
}
main().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = /\[(401|403)\]/.test(error.message)
    ? 3
    : /\[409\]/.test(error.message)
      ? 4
      : /\[422\]/.test(error.message)
        ? 2
        : /fetch failed|timeout|Connection/i.test(error.message)
          ? 6
          : 1;
});
