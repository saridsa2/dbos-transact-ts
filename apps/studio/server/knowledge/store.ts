import type { PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ControlError, type ControlPlane } from '../control/service';
import { canExecute, canManage } from '../../lib/control/contracts';
import type { Context } from '../../lib/control/contracts';
import {
  contentHash,
  id,
  type ArtifactKind,
  type KnowledgeArtifact,
  type KnowledgeRevision,
} from '../../lib/knowledge/contracts';
import { ontologySchema, validateOntology } from '../../lib/knowledge/ontology';
import { processDocumentSchema as processSchema, validateProcess } from '../../lib/knowledge/process';
import type { IntelligenceTask } from '../../lib/intelligence/contracts';
const artifactRow = (r: any): KnowledgeArtifact => ({
  id: r.id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  name: r.name,
  editVersion: r.edit_version,
  revisionId: r.revision_id,
  publishedRevisionId: r.published_revision_id,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export const taskRow = (r: any): IntelligenceTask => ({
  id: r.id,
  name: r.name,
  status: r.status,
  sourceId: r.source_id,
  sourceRevisionId: r.source_revision_id,
  connectionId: r.connection_id,
  connectionRevision: r.connection_revision,
  summary: r.summary,
  error: r.error,
  analysis: r.analysis,
  editVersion: r.edit_version,
  flowId: r.flow_id,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export class KnowledgeStore {
  constructor(readonly control: ControlPlane) {}
  get pool() {
    return this.control.pool;
  }
  async initialize() {
    await this.control.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('stackproc-knowledge-migrations',0))");
      await client.query(
        'CREATE TABLE IF NOT EXISTS wi_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const [index, file] of ['schema.sql', '002-intelligence-history.sql'].entries()) {
        const sql = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex'),
          version = index + 1;
        const migration = (await client.query('SELECT checksum FROM wi_migrations WHERE version=$1', [version]))
          .rows[0];
        if (migration && migration.checksum !== checksum)
          throw new Error(
            `Knowledge migration ${version} checksum mismatch. Add a new migration instead of editing applied SQL.`,
          );
        if (!migration) {
          await client.query(sql);
          await client.query('INSERT INTO wi_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
        }
      }
    });
  }

  async list(ctx: Context, kind?: string, cursor?: string) {
    const rows = await this.pool.query(
      'SELECT * FROM wi_artifacts WHERE workspace_id=$1 AND ($2::text IS NULL OR kind=$2) AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT 51',
      [ctx.workspace.id, kind ?? null, cursor ?? null],
    );
    return {
      items: rows.rows.slice(0, 50).map(artifactRow),
      nextCursor: rows.rows.length > 50 ? rows.rows[49].id : null,
    };
  }
  async get(ctx: Context, artifactId: string, revisionId?: string, client: PoolClient | typeof this.pool = this.pool) {
    const row = (
      await client.query(
        'SELECT a.*,r.id AS rid,r.parent_revision_id,r.content_hash,r.content,r.created_at AS revision_created_at,EXISTS(SELECT 1 FROM wi_reviews v WHERE v.workspace_id=r.workspace_id AND v.revision_id=r.id) AS reviewed FROM wi_artifacts a JOIN wi_revisions r ON r.workspace_id=a.workspace_id AND r.artifact_id=a.id AND r.id=COALESCE($3,a.revision_id) WHERE a.workspace_id=$1 AND a.id=$2',
        [ctx.workspace.id, artifactId, revisionId ?? null],
      )
    ).rows[0];
    if (!row) throw new ControlError(404, 'Knowledge artifact not found.');
    return {
      artifact: artifactRow(row),
      revision: {
        id: row.rid,
        artifactId: row.id,
        parentRevisionId: row.parent_revision_id,
        contentHash: row.content_hash,
        content: row.content,
        createdAt: row.revision_created_at.toISOString(),
        reviewed: row.reviewed,
      } as KnowledgeRevision,
    };
  }
  async validate(
    ctx: Context,
    kind: ArtifactKind,
    content: unknown,
    client: PoolClient | typeof this.pool = this.pool,
  ) {
    const checked =
      kind === 'ontology'
        ? ontologySchema.parse(content)
        : kind === 'process'
          ? processSchema.parse(content)
          : z
              .object({
                schemaVersion: z.literal(1),
                mediaType: z.enum(['text/plain', 'text/markdown']),
                text: z
                  .string()
                  .min(1)
                  .max(200000)
                  .refine((v) => v.trim().length > 0, 'Source must contain text.'),
              })
              .strict()
              .parse(content);
    if (dataContainsInvalidText(checked)) throw new ControlError(422, 'Text contains unsupported control characters.');
    const issues = kind === 'ontology' ? validateOntology(checked) : kind === 'process' ? validateProcess(checked) : [];
    if (issues.some((i) => i.severity === 'error'))
      throw new ControlError(
        422,
        issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join(' '),
      );
    async function walk(v: unknown): Promise<void> {
      if (Array.isArray(v)) {
        for (const item of v) await walk(item);
        return;
      }
      if (v && typeof v === 'object') {
        const x = v as Record<string, unknown>;
        if (x.kind === 'source') {
          const exists = await client.query(
            'SELECT 1 FROM wi_source_blocks WHERE workspace_id=$1 AND revision_id=$2 AND id=$3',
            [ctx.workspace.id, x.revisionId, x.blockId],
          );
          if (!exists.rowCount) throw new ControlError(422, 'Source evidence is unavailable in this workspace.');
        }
        if (x.kind === 'user') {
          const exists = await client.query('SELECT 1 FROM wi_decisions WHERE workspace_id=$1 AND id=$2', [
            ctx.workspace.id,
            x.decisionId,
          ]);
          if (!exists.rowCount) throw new ControlError(422, 'User decision is unavailable in this workspace.');
        }
        if (x.kind === 'inference') {
          const exists = await client.query('SELECT 1 FROM wi_tasks WHERE workspace_id=$1 AND id=$2', [
            ctx.workspace.id,
            x.taskId,
          ]);
          if (!exists.rowCount) throw new ControlError(422, 'Inference task is unavailable in this workspace.');
        }
        for (const item of Object.values(x)) await walk(item);
      }
    }
    await walk(checked);
    if (kind === 'process')
      for (const ref of (checked as z.infer<typeof processSchema>).ontologyRefs) {
        const found = await this.get(ctx, ref.artifactId, ref.revisionId, client);
        if (found.artifact.kind !== 'ontology')
          throw new ControlError(422, 'Ontology references must point to ontology revisions.');
      }
    return { content: checked, issues };
  }
  async save(ctx: Context, input: unknown, artifactId?: string, transactionClient?: PoolClient) {
    const data = z
      .object({
        name: z.string().trim().min(1).max(200),
        kind: z.enum(['ontology', 'process', 'source']),
        content: z.unknown(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input);
    const { content, issues } = await this.validate(ctx, data.kind, data.content, transactionClient),
      hash = await contentHash(content),
      revisionId = crypto.randomUUID(),
      recordId = artifactId ?? crypto.randomUUID();
    const mutate = async (client: PoolClient) => {
      if (data.kind === 'source') {
        let permitted = canExecute(ctx.workspace.role);
        // An installed context policy governs every source import path, atomically with the write.
        if ((await client.query("SELECT to_regclass('wa_context_permissions') AS policy")).rows[0].policy) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-context-policy:'||$1,0))", [
            ctx.workspace.id,
          ]);
          const member = (
            await client.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 FOR SHARE', [
              ctx.workspace.id,
              ctx.user.id,
            ])
          ).rows[0];
          const policy = (
            await client.query('SELECT editor_upload FROM wa_context_permissions WHERE workspace_id=$1', [
              ctx.workspace.id,
            ])
          ).rows[0];
          permitted =
            !!member && (canManage(member.role) || (member.role === 'editor' && (policy?.editor_upload ?? true)));
        }
        if (!permitted) {
          await this.control.audit(ctx, 'agent.context_upload_denied', 'workspace', ctx.workspace.id, {
            role: ctx.workspace.role,
            origin: 'sources',
          });
          throw new ControlError(
            403,
            'Your workspace role cannot import context sources. Ask an owner or admin to review People → Context permissions.',
          );
        }
      }
      let previous: string | null = null;
      if (artifactId) {
        const row = (
          await client.query('SELECT * FROM wi_artifacts WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
            ctx.workspace.id,
            artifactId,
          ])
        ).rows[0];
        if (!row) throw new ControlError(404, 'Knowledge artifact not found.');
        if (row.edit_version !== data.expectedVersion)
          throw new ControlError(409, 'This artifact changed. Reload before saving.');
        if (row.kind !== data.kind) throw new ControlError(422, 'Artifact kind cannot change.');
        previous = row.revision_id;
        await client.query(
          'UPDATE wi_artifacts SET name=$3,edit_version=edit_version+1,revision_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2',
          [ctx.workspace.id, recordId, data.name, revisionId],
        );
      } else
        await client.query('INSERT INTO wi_artifacts(workspace_id,id,kind,name,revision_id) VALUES($1,$2,$3,$4,$5)', [
          ctx.workspace.id,
          recordId,
          data.kind,
          data.name,
          revisionId,
        ]);
      await client.query(
        'INSERT INTO wi_revisions(workspace_id,id,artifact_id,parent_revision_id,content_hash,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [ctx.workspace.id, revisionId, recordId, previous, hash, content, ctx.user.id],
      );
      if (data.kind === 'source') {
        const text = (content as { text: string }).text;
        const blocks = text
          .replace(/\r\n?/g, '\n')
          .split(/\n\s*\n/)
          .filter((t) => t.trim());
        if (blocks.length > 1000) throw new ControlError(422, 'Source exceeds 1000 paragraphs. Split the document.');
        for (const [index, text] of blocks.entries())
          await client.query(
            'INSERT INTO wi_source_blocks(workspace_id,revision_id,id,ordinal,text) VALUES($1,$2,$3,$4,$5)',
            [ctx.workspace.id, revisionId, `block-${index + 1}`, index, text],
          );
      }
      await this.control.audit(ctx, 'knowledge.saved', data.kind, recordId, { revisionId }, client);
    };
    if (transactionClient) await mutate(transactionClient);
    else await this.control.transaction(mutate);
    return { ...(await this.get(ctx, recordId, undefined, transactionClient)), issues };
  }
  async blocks(ctx: Context, artifactId: string, revisionId: string) {
    const record = await this.get(ctx, artifactId, revisionId);
    if (record.artifact.kind !== 'source') throw new ControlError(404, 'Source not found.');
    return (
      await this.pool.query(
        'SELECT id,ordinal,text FROM wi_source_blocks WHERE workspace_id=$1 AND revision_id=$2 ORDER BY ordinal',
        [ctx.workspace.id, revisionId],
      )
    ).rows;
  }
  async review(ctx: Context, artifactId: string, input: unknown, publish = false) {
    const data = z.object({ revisionId: id, expectedVersion: z.number().int().positive() }).strict().parse(input);
    await this.control.transaction(async (client) => {
      const row = (
        await client.query('SELECT * FROM wi_artifacts WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          artifactId,
        ])
      ).rows[0];
      if (!row) throw new ControlError(404, 'Artifact not found.');
      if (row.edit_version !== data.expectedVersion || row.revision_id !== data.revisionId)
        throw new ControlError(409, 'Review applies to an older revision. Reload first.');
      if (publish) {
        const content = (
          await client.query('SELECT content FROM wi_revisions WHERE workspace_id=$1 AND id=$2', [
            ctx.workspace.id,
            data.revisionId,
          ])
        ).rows[0].content;
        const problems =
          row.kind === 'process' ? validateProcess(content) : row.kind === 'ontology' ? validateOntology(content) : [];
        if (problems.length) throw new ControlError(422, 'Resolve knowledge validation issues before publishing.');
        if (
          !(
            await client.query('SELECT 1 FROM wi_reviews WHERE workspace_id=$1 AND revision_id=$2', [
              ctx.workspace.id,
              data.revisionId,
            ])
          ).rowCount
        )
          throw new ControlError(409, 'Review this revision before publishing.');
        await client.query(
          'UPDATE wi_artifacts SET published_revision_id=$3,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
          [ctx.workspace.id, artifactId, data.revisionId],
        );
      } else
        await client.query(
          'INSERT INTO wi_reviews(workspace_id,revision_id,actor_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [ctx.workspace.id, data.revisionId, ctx.user.id],
        );
      await this.control.audit(
        ctx,
        publish ? 'knowledge.published' : 'knowledge.reviewed',
        row.kind,
        artifactId,
        { revisionId: data.revisionId },
        client,
      );
    });
    return this.get(ctx, artifactId);
  }
  async task(ctx: Context, taskId: string) {
    const row = (
      await this.pool.query('SELECT * FROM wi_tasks WHERE workspace_id=$1 AND id=$2', [ctx.workspace.id, taskId])
    ).rows[0];
    if (!row) throw new ControlError(404, 'Intelligence task not found.');
    return { record: taskRow(row), actorId: row.actor_id, answers: row.answers as Record<string, string> };
  }
}

function dataContainsInvalidText(value: unknown): boolean {
  if (typeof value === 'string') return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
  if (Array.isArray(value)) return value.some(dataContainsInvalidText);
  if (value && typeof value === 'object') return Object.values(value).some(dataContainsInvalidText);
  return false;
}
