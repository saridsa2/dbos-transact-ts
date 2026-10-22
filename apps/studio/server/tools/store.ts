import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Context } from '../../lib/control/contracts';
import { fileMapSchema, type ToolHead, type ToolFiles } from '../../lib/tools/contracts';
import { ControlError, type ControlPlane } from '../control/service';
import { compileTool, executeBuild, packageHash, sha, testBuild, toolchain, type ToolBuild } from './compiler';
const head = (r: any): ToolHead => ({
  id: r.id,
  name: r.name,
  editVersion: r.edit_version,
  snapshotId: r.snapshot_id,
  hash: r.hash,
  publishedRevision: r.published_revision,
  enabledRevision: r.enabled_revision,
  archived: r.archived,
  updatedAt: r.updated_at.toISOString(),
});
export class ToolStore {
  constructor(readonly control: ControlPlane) {}
  async initialize() {
    await this.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('stackproc-tools-migrations',0))");
      await c.query('CREATE TABLE IF NOT EXISTS wt_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
      for (const [index, file] of ['schema.sql', '002-workspace-api-keys.sql'].entries()) {
        const sql = await readFile(new URL(file, import.meta.url), 'utf8'),
          checksum = sha(sql),
          version = index + 1;
        const row = (await c.query('SELECT checksum FROM wt_migrations WHERE version=$1', [version])).rows[0];
        if (row && row.checksum !== checksum) throw Error('Tools migration changed after application.');
        if (!row) {
          await c.query(sql);
          await c.query('INSERT INTO wt_migrations VALUES($1,$2)', [version, checksum]);
        }
      }
    });
  }
  async list(ctx: Context) {
    return (
      await this.control.pool.query(
        'SELECT * FROM wt_tools WHERE workspace_id=$1 AND NOT archived ORDER BY updated_at DESC',
        [ctx.workspace.id],
      )
    ).rows.map(head);
  }
  async get(ctx: Context, id: string) {
    z.uuid().parse(id);
    const r = (
      await this.control.pool.query(
        'SELECT t.*,s.files FROM wt_tools t JOIN wt_snapshots s ON s.workspace_id=t.workspace_id AND s.id=t.snapshot_id WHERE t.workspace_id=$1 AND t.id=$2',
        [ctx.workspace.id, id],
      )
    ).rows[0];
    if (!r) throw new ControlError(404, 'Tool not found.');
    return { tool: head(r), files: r.files as ToolFiles };
  }
  async command(ctx: Context, key: string, request: unknown, fn: (c: PoolClient) => Promise<unknown>) {
    z.uuid().parse(key);
    const hash = sha(JSON.stringify(request));
    return this.control.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${ctx.workspace.id}:${ctx.user.id}:${key}`,
      ]);
      const old = (
        await c.query('SELECT * FROM wt_commands WHERE workspace_id=$1 AND actor_id=$2 AND key=$3', [
          ctx.workspace.id,
          ctx.user.id,
          key,
        ])
      ).rows[0];
      if (old) {
        if (old.hash !== hash) throw new ControlError(409, 'Command key already belongs to different content.');
        return old.result;
      }
      const result = await fn(c);
      await c.query('INSERT INTO wt_commands(workspace_id,actor_id,key,hash,result) VALUES($1,$2,$3,$4,$5)', [
        ctx.workspace.id,
        ctx.user.id,
        key,
        hash,
        JSON.stringify(result),
      ]);
      return result;
    });
  }
  async save(ctx: Context, raw: unknown) {
    const p = z
      .object({
        id: z.uuid(),
        files: fileMapSchema,
        expectedVersion: z.number().int().nonnegative(),
        commandKey: z.uuid(),
      })
      .strict()
      .parse(raw);
    const hash = packageHash(p.files);
    let name = 'Untitled tool';
    try {
      const m = JSON.parse(p.files['tool.json']);
      if (m.id !== p.id) throw Error();
      name = String(m.name || name).slice(0, 100);
    } catch {
      /* invalid drafts remain editable */
    }
    return this.command(ctx, p.commandKey, p, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${ctx.workspace.id}:${p.id}`]);
      const row = (
        await c.query('SELECT * FROM wt_tools WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [ctx.workspace.id, p.id])
      ).rows[0];
      if ((row?.edit_version ?? 0) !== p.expectedVersion || row?.archived)
        throw new ControlError(
          409,
          'Draft changed elsewhere. Pull or reload and review the diff; your local files are retained.',
        );
      const snapshot = randomUUID(),
        version = p.expectedVersion + 1;
      await c.query(
        'INSERT INTO wt_tools(workspace_id,id,name,edit_version,snapshot_id,hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET name=$3,edit_version=$4,snapshot_id=$5,hash=$6,updated_at=now()',
        [ctx.workspace.id, p.id, name, version, snapshot, hash],
      );
      await c.query('INSERT INTO wt_snapshots(workspace_id,tool_id,id,hash,files,actor_id) VALUES($1,$2,$3,$4,$5,$6)', [
        ctx.workspace.id,
        p.id,
        snapshot,
        hash,
        JSON.stringify(p.files),
        ctx.user.id,
      ]);
      return {
        tool: head(
          (await c.query('SELECT * FROM wt_tools WHERE workspace_id=$1 AND id=$2', [ctx.workspace.id, p.id])).rows[0],
        ),
      };
    });
  }
  async test(
    ctx: Context,
    id: string,
    hash: string,
    signal?: AbortSignal,
    fixture?: string,
    progress?: (event: unknown) => void,
  ) {
    const { tool, files } = await this.get(ctx, id);
    if (tool.hash !== hash) throw new ControlError(409, 'Test hash is stale. Save and test the current draft.');
    let build: ToolBuild | undefined, result: unknown;
    progress?.({ phase: 'compiling', hash });
    try {
      build = await compileTool(files);
      if (build.manifest.id !== id) throw Error('Manifest ID must match tool identity.');
      result = build.diagnostics.length
        ? { success: false, diagnostics: build.diagnostics }
        : await testBuild(build, files, signal, fixture, progress);
    } catch (e) {
      result = { success: false, error: e instanceof Error ? e.message : 'Build failed.' };
    }
    const testId = randomUUID();
    await this.control.pool.query(
      'INSERT INTO wt_builds(workspace_id,id,tool_id,snapshot_id,hash,build_hash,compiler,build,test_result,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        ctx.workspace.id,
        testId,
        id,
        tool.snapshotId,
        hash,
        build?.buildHash ?? null,
        toolchain,
        build ? JSON.stringify(build) : null,
        JSON.stringify(result),
        ctx.user.id,
      ],
    );
    return { testId, hash, buildHash: build?.buildHash, ...(result as object) };
  }
  async publish(ctx: Context, id: string, raw: unknown) {
    const p = z
      .object({ hash: z.string(), version: z.string(), expectedVersion: z.number().int(), commandKey: z.uuid() })
      .strict()
      .parse(raw);
    return this.command(ctx, p.commandKey, { id, ...p }, async (c) => {
      const t = (
        await c.query('SELECT * FROM wt_tools WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [ctx.workspace.id, id])
      ).rows[0];
      if (!t || t.archived) throw new ControlError(404, 'Tool not found.');
      if (t.hash !== p.hash || t.edit_version !== p.expectedVersion)
        throw new ControlError(409, 'Publish requires the current exact draft hash/version.');
      const old = (
        await c.query('SELECT * FROM wt_releases WHERE workspace_id=$1 AND tool_id=$2 AND version=$3', [
          ctx.workspace.id,
          id,
          p.version,
        ])
      ).rows[0];
      if (old) {
        if (old.hash !== p.hash) throw new ControlError(409, 'This semantic version already has different content.');
        return { revision: old.revision, hash: old.hash };
      }
      const b = (
        await c.query(
          "SELECT * FROM wt_builds WHERE workspace_id=$1 AND tool_id=$2 AND snapshot_id=$3 AND compiler=$4 AND test_result->>'success'='true' AND test_result->>'complete'='true' ORDER BY created_at DESC LIMIT 1",
          [ctx.workspace.id, id, t.snapshot_id, toolchain],
        )
      ).rows[0];
      if (!b?.build || b.build.manifest.version !== p.version)
        throw new ControlError(
          422,
          'Run successful server fixture tests for this exact hash and manifest version before publishing.',
        );
      const revision = (t.published_revision ?? 0) + 1;
      await c.query(
        'INSERT INTO wt_releases(workspace_id,tool_id,revision,version,snapshot_id,build_id,hash,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [ctx.workspace.id, id, revision, p.version, t.snapshot_id, b.id, p.hash, ctx.user.id],
      );
      await c.query('UPDATE wt_tools SET published_revision=$3 WHERE workspace_id=$1 AND id=$2', [
        ctx.workspace.id,
        id,
        revision,
      ]);
      return { revision, hash: p.hash };
    });
  }
  async bind(ctx: Context, id: string, raw: unknown) {
    const p = z
      .object({
        revision: z.number().int().positive().nullable(),
        expectedVersion: z.number().int(),
        commandKey: z.uuid(),
      })
      .strict()
      .parse(raw);
    return this.command(ctx, p.commandKey, { id, ...p }, async (c) => {
      const r = await c.query(
        'UPDATE wt_tools SET enabled_revision=$3,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND edit_version=$4 AND NOT archived AND ($3::int IS NULL OR EXISTS(SELECT 1 FROM wt_releases WHERE workspace_id=$1 AND tool_id=$2 AND revision=$3)) RETURNING *',
        [ctx.workspace.id, id, p.revision, p.expectedVersion],
      );
      if (!r.rowCount) throw new ControlError(409, 'Tool changed or release is unavailable. Reload before enabling.');
      return { tool: head(r.rows[0]) };
    });
  }
  async history(ctx: Context, id: string) {
    await this.get(ctx, id);
    const [releases, tests] = await Promise.all([
      this.control.pool.query(
        'SELECT revision,version,hash,created_at FROM wt_releases WHERE workspace_id=$1 AND tool_id=$2 ORDER BY revision DESC',
        [ctx.workspace.id, id],
      ),
      this.control.pool.query(
        'SELECT id,hash,build_hash,test_result,created_at FROM wt_builds WHERE workspace_id=$1 AND tool_id=$2 ORDER BY created_at DESC LIMIT 30',
        [ctx.workspace.id, id],
      ),
    ]);
    return { releases: releases.rows, tests: tests.rows };
  }
  async archive(ctx: Context, id: string, version: number) {
    const r = await this.control.pool.query(
      'UPDATE wt_tools SET archived=true,enabled_revision=NULL,edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2 AND edit_version=$3 RETURNING id',
      [ctx.workspace.id, id, version],
    );
    if (!r.rowCount) throw new ControlError(409, 'Tool changed. Reload before archiving.');
    return { archived: true };
  }
  async offerings(ctx: Context) {
    return (
      await this.control.pool.query(
        'SELECT t.id,r.revision,b.build FROM wt_tools t JOIN wt_releases r ON r.workspace_id=t.workspace_id AND r.tool_id=t.id AND r.revision=t.enabled_revision JOIN wt_builds b ON b.workspace_id=r.workspace_id AND b.id=r.build_id WHERE t.workspace_id=$1 AND NOT t.archived',
        [ctx.workspace.id],
      )
    ).rows as { id: string; revision: number; build: ToolBuild }[];
  }
  async invokeWorkflow(runId: string, nodeId: string, payload: unknown, signal?: AbortSignal) {
    const p = z
      .object({ handler: z.string().regex(/^workspace_tool\.[a-f0-9-]{36}\.r[1-9][0-9]*$/), input: z.unknown() })
      .parse(payload);
    const run = (
      await this.control.pool.query('SELECT actor_user_id,workspace_id FROM studio_runs WHERE id=$1', [runId])
    ).rows[0];
    if (!run?.actor_user_id)
      throw new ControlError(403, 'Workflow tool execution requires a recorded workspace principal.');
    const ctx = await this.control.authorizePrincipal(run.actor_user_id, run.workspace_id, 'execute');
    const [, id, revision] = p.handler.match(/^workspace_tool\.([a-f0-9-]{36})\.r([1-9][0-9]*)$/)!;
    const build = await this.releaseBuild(ctx, id, Number(revision));
    if (!build.manifest.exposure.includes('workflow')) throw new ControlError(403, 'Tool is not exposed to workflows.');
    return this.invoke(ctx, id, Number(revision), p.input, `${runId}:${nodeId}`, signal);
  }
  async releaseBuild(ctx: Context, id: string, revision: number) {
    const r = (
      await this.control.pool.query(
        'SELECT b.build FROM wt_tools t JOIN wt_releases r ON r.workspace_id=t.workspace_id AND r.tool_id=t.id JOIN wt_builds b ON b.workspace_id=r.workspace_id AND b.id=r.build_id WHERE t.workspace_id=$1 AND t.id=$2 AND r.revision=$3 AND t.enabled_revision IS NOT NULL AND NOT t.archived',
        [ctx.workspace.id, id, revision],
      )
    ).rows[0];
    if (!r) throw new ControlError(403, 'Tool revision is unavailable or disabled.');
    return r.build as ToolBuild;
  }
  async invoke(ctx: Context, id: string, revision: number, input: unknown, invocationId: string, signal?: AbortSignal) {
    // Recheck current enablement for every dispatch, including pinned work.
    return executeBuild(await this.releaseBuild(ctx, id, revision), input, invocationId, signal);
  }
}
