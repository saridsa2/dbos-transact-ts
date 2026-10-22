import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { ControlPlane } from './control/service';
import { SecretVault } from './control/secrets';
import { ToolStore } from './tools/store';
import { toolRoutes } from './tools/routes';
import { starterFiles } from '../lib/tools/contracts';
import { authoredExtensions } from './tools/catalog';
import type { Context } from '../lib/control/contracts';
describe.skipIf(process.env.STUDIO_INTEGRATION !== '1')('tool builder persistence and developer access', () => {
  let pool: pg.Pool,
    control: ControlPlane,
    store: ToolStore,
    ctx: Context,
    server: Server,
    origin: string,
    cookie: string;
  const id = randomUUID(),
    files = starterFiles(id);
  let tool: any;
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/studio' });
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='studio_tools_integration'")).rowCount)
      await admin.query('CREATE DATABASE studio_tools_integration');
    await admin.end();
    pool = new pg.Pool({ connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/studio_tools_integration' });
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    control = new ControlPlane(pool, await SecretVault.load(true), null, null);
    await control.initialize();
    store = new ToolStore(control);
    await store.initialize();
    const s = await control.developmentSession({
      email: `tools-${randomUUID()}@example.test`,
      displayName: 'Tool author',
    });
    cookie = `studio_session=${s.token}`;
    const workspace = randomUUID(),
      customer = randomUUID();
    await pool.query('INSERT INTO cp_customers(id,name,owner_user_id) VALUES($1,$2,$3)', [
      customer,
      'Tools test',
      s.user.id,
    ]);
    await pool.query('INSERT INTO cp_workspaces(id,name,customer_id) VALUES($1,$2,$3)', [
      workspace,
      'Tools test',
      customer,
    ]);
    await pool.query("INSERT INTO cp_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [
      workspace,
      s.user.id,
    ]);
    ctx = {
      user: s.user,
      workspace: { id: workspace, name: 'Tools test', customerId: customer, customerName: 'Tools test', role: 'owner' },
    };
    const route = toolRoutes(
      store,
      async (req) => {
        let data = '';
        for await (const b of req) data += b;
        return data ? JSON.parse(data) : {};
      },
      (res, status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      },
    );
    server = createServer(async (req, res) => {
      if (!(await route(req, res, new URL(req.url!, origin)))) res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool?.end();
  });
  async function request(path: string, value?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(origin + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { cookie, 'x-studio-workspace': ctx.workspace.id, 'content-type': 'application/json', ...headers },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    return { status: r.status, ...(await r.json()) };
  }
  it('saves and replays uploads; stale edits preserve remote and local versions', async () => {
    const p = { id, files, expectedVersion: 0, commandKey: randomUUID() };
    const a: any = await store.save(ctx, p),
      b: any = await store.save(ctx, p);
    tool = a.tool;
    expect(b).toEqual(a);
    await expect(store.save(ctx, { ...p, commandKey: randomUUID() })).rejects.toThrow('changed elsewhere');
    expect((await store.get(ctx, id)).files).toEqual(files);
  });
  it('gates publication on exact server tests, publishes once, and enables independent of publication', async () => {
    await expect(
      store.publish(ctx, id, {
        hash: tool.hash,
        version: '0.1.0',
        expectedVersion: tool.editVersion,
        commandKey: randomUUID(),
      }),
    ).rejects.toThrow('tests');
    expect(await store.test(ctx, id, tool.hash)).toMatchObject({ success: true });
    const p = { hash: tool.hash, version: '0.1.0', expectedVersion: tool.editVersion, commandKey: randomUUID() };
    expect(await store.publish(ctx, id, p)).toEqual(await store.publish(ctx, id, p));
    expect(await store.offerings(ctx)).toEqual([]);
    const r: any = await store.bind(ctx, id, {
      revision: 1,
      expectedVersion: tool.editVersion,
      commandKey: randomUUID(),
    });
    tool = r.tool;
    expect((await store.invoke(ctx, id, 1, { values: [9, 18, 27] }, 'integration')).value).toEqual({ total: 54 });
    const resolved = await authoredExtensions(store, ctx);
    expect(resolved.definitions).toHaveLength(1);
    expect(resolved.pins).toMatchObject([{ id, revision: 1 }]);
  });
  it('keeps released code immutable while invalid drafts are saveable; blocks cross-workspace and disabled calls', async () => {
    const changed = { ...files, 'src/index.ts': 'export function run( { invalid' };
    const r: any = await store.save(ctx, {
      id,
      files: changed,
      expectedVersion: tool.editVersion,
      commandKey: randomUUID(),
    });
    tool = r.tool;
    expect(await store.test(ctx, id, tool.hash)).toMatchObject({ success: false });
    expect((await store.invoke(ctx, id, 1, { values: [1, 2] }, 'pinned')).value).toEqual({ total: 3 });
    await expect(store.get({ ...ctx, workspace: { ...ctx.workspace, id: randomUUID() } }, id)).rejects.toThrow(
      'not found',
    );
    const disabled: any = await store.bind(ctx, id, {
      revision: null,
      expectedVersion: tool.editVersion,
      commandKey: randomUUID(),
    });
    tool = disabled.tool;
    await expect(store.invoke(ctx, id, 1, { values: [1] }, 'disabled')).rejects.toThrow('disabled');
  });
  it('uses approved, short-lived CLI credentials and enforces current role and workspace', async () => {
    const verifier = 'a'.repeat(43),
      challenge = createHash('sha256').update(verifier).digest('base64url');
    const device = await request('/api/tools/auth/device', { challenge });
    expect(device.status).toBe(200);
    expect(await request('/api/tools/auth/token', { id: device.id, verifier })).toMatchObject({ pending: true });
    expect(await request('/api/tools/auth/approve', { code: device.code })).toMatchObject({ approved: true });
    const login = await request('/api/tools/auth/token', { id: device.id, verifier });
    expect(login.token).toMatch(/^sp_dev_/);
    const headers = { authorization: `Bearer ${login.token}`, cookie: '' };
    expect((await request('/api/tools', undefined, headers)).status).toBe(200);
    const exec = promisify(execFile),
      root = await mkdtemp(join(tmpdir(), 'stackproc-cli-integration-'));
    await exec(process.execPath, ['scripts/build-tools-cli.mjs'], { cwd: process.cwd() });
    const cli = join(process.cwd(), 'cli/dist/stackproc.mjs'),
      env = {
        ...process.env,
        STACKPROC_SERVER: origin,
        STACKPROC_WORKSPACE: ctx.workspace.id,
        STACKPROC_TOKEN: login.token,
      };
    await exec(process.execPath, [cli, 'tools', 'init', 'cli-tool'], { cwd: root, env });
    const cwd = join(root, 'cli-tool');
    const run = async (...args: string[]) =>
      JSON.parse((await exec(process.execPath, [cli, ...args], { cwd, env })).stdout);
    const local = await run('tools', 'test');
    expect(local).toMatchObject({ success: true, profile: 'local' });
    const uploaded = await run('tools', 'upload', '.');
    expect(uploaded.tool.editVersion).toBe(1);
    expect(await run('tools', 'test', '--remote')).toMatchObject({ success: true, buildHash: local.buildHash });
    const published = await run('tools', 'publish', '--hash', uploaded.tool.hash);
    expect(published.revision).toBe(1);
    expect(await run('tools', 'enable', '--revision', '1')).toMatchObject({ tool: { enabledRevision: 1 } });
    expect(await run('tools', 'pull', uploaded.tool.id, '--output', join(root, 'pulled'))).toMatchObject({
      tool: { id: uploaded.tool.id },
    });
    expect(await readFile(join(root, 'pulled/src/index.ts'), 'utf8')).toBe(
      await readFile(join(cwd, 'src/index.ts'), 'utf8'),
    );

    expect((await request('/api/tools', undefined, { ...headers, 'x-studio-workspace': randomUUID() })).status).toBe(
      403,
    );
    await pool.query("UPDATE cp_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2", [
      ctx.workspace.id,
      ctx.user.id,
    ]);
    expect((await request(`/api/tools/${id}/tests`, { hash: tool.hash }, headers)).status).toBe(403);
    await pool.query("UPDATE cp_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2", [
      ctx.workspace.id,
      ctx.user.id,
    ]);
    expect((await request('/api/tools/auth/revoke', {}, headers)).status).toBe(200);
    expect((await request('/api/tools', undefined, headers)).status).toBe(401);
  });
  it('creates hashed workspace keys and enforces scopes, expiry, revocation and live membership', async () => {
    const created = await request('/api/tools/auth/keys', {
      name: 'Read-only integration',
      days: 7,
      scopes: ['tools:read'],
    });
    expect(created.status).toBe(201);
    expect(created.token).toMatch(/^pcc_ws_/);
    const headers = { authorization: `Bearer ${created.token}`, cookie: '' };
    const list = await request('/api/tools/auth/keys');
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect(list.keys.find((k: any) => k.id === created.id)).not.toHaveProperty('token_hash');
    expect(
      (await pool.query('SELECT token_hash FROM wt_workspace_api_keys WHERE id=$1', [created.id])).rows[0].token_hash,
    ).toBe(createHash('sha256').update(created.token).digest('hex'));
    expect((await request('/api/tools', undefined, headers)).status).toBe(200);
    expect((await request('/api/tools/auth/session', undefined, headers)).workspaceId).toBe(ctx.workspace.id);
    expect((await request('/api/tools/auth/keys', {}, headers)).status).toBe(403);
    expect((await request(`/api/tools/${id}/tests`, { hash: tool.hash }, headers)).status).toBe(401);
    expect((await request('/api/tools', undefined, { ...headers, 'x-studio-workspace': randomUUID() })).status).toBe(
      403,
    );
    await expect(control.authenticate({ method: 'GET', url: '/api/tools-other', headers } as any)).rejects.toThrow(
      'scoped to tool authoring',
    );
    await pool.query("UPDATE cp_memberships SET role='editor' WHERE workspace_id=$1 AND user_id=$2", [
      ctx.workspace.id,
      ctx.user.id,
    ]);
    expect((await request('/api/tools/auth/keys', { name: 'No', days: 7, scopes: ['tools:read'] })).status).toBe(403);
    await pool.query("UPDATE cp_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2", [
      ctx.workspace.id,
      ctx.user.id,
    ]);
    await pool.query("UPDATE wt_workspace_api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [created.id]);
    expect((await request('/api/tools', undefined, headers)).status).toBe(401);
    await pool.query("UPDATE wt_workspace_api_keys SET expires_at=now()+interval '1 day' WHERE id=$1", [created.id]);
    expect((await request(`/api/tools/auth/keys/${created.id}/revoke`, {})).status).toBe(200);
    expect((await request('/api/tools', undefined, headers)).status).toBe(401);
    const writable = await request('/api/tools/auth/keys', {
      name: 'CLI integration',
      days: 7,
      scopes: ['tools:read', 'tools:write', 'tools:test'],
    });
    const exec = promisify(execFile);
    const env = {
      ...process.env,
      PROCCZAR_SERVER: origin,
      PROCCZAR_WORKSPACE: ctx.workspace.id,
      PROCCZAR_API_KEY: writable.token,
    };
    const cli = join(process.cwd(), 'cli/dist/stackproc.mjs');
    expect(JSON.parse((await exec(process.execPath, [cli, 'auth', 'status'], { env })).stdout).workspaceId).toBe(
      ctx.workspace.id,
    );
    const root = await mkdtemp(join(tmpdir(), 'procczar-key-cli-'));
    await exec(process.execPath, [cli, 'tools', 'init', 'key-tool'], { cwd: root, env });
    expect(
      JSON.parse(
        (await exec(process.execPath, [cli, 'tools', 'upload', '.'], { cwd: join(root, 'key-tool'), env })).stdout,
      ).tool.editVersion,
    ).toBe(1);
    expect(
      JSON.parse(
        (await exec(process.execPath, [cli, 'tools', 'test', '--remote'], { cwd: join(root, 'key-tool'), env })).stdout,
      ).success,
    ).toBe(true);
    const savedMembership = (
      await pool.query('DELETE FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 RETURNING *', [
        ctx.workspace.id,
        ctx.user.id,
      ])
    ).rows[0];
    expect(
      (await request('/api/tools', undefined, { authorization: `Bearer ${writable.token}`, cookie: '' })).status,
    ).toBe(401);
    await pool.query('INSERT INTO cp_memberships(workspace_id,user_id,role) VALUES($1,$2,$3)', [
      savedMembership.workspace_id,
      savedMembership.user_id,
      savedMembership.role,
    ]);
    await request(`/api/tools/auth/keys/${writable.id}/revoke`, {});
    const audits = (
      await pool.query("SELECT details FROM cp_audit WHERE workspace_id=$1 AND entity_type='api_key'", [
        ctx.workspace.id,
      ])
    ).rows;
    expect(JSON.stringify(audits)).not.toContain(writable.token);
  });
});
