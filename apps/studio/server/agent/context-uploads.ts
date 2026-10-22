import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Context } from '../../lib/control/contracts';
import { canManage } from '../../lib/control/contracts';
import { CONTEXT_UPLOAD_LIMIT } from '../../lib/agent/context-uploads';
import { ControlError } from '../control/service';
import type { AgentService } from './service';
const uploadSchema = z
  .object({
    sessionId: z.string().uuid(),
    clientKey: z.string().uuid(),
    filename: z.string().min(1).max(200),
    data: z
      .string()
      .min(1)
      .max(Math.ceil(CONTEXT_UPLOAD_LIMIT / 3) * 4),
  })
  .strict();
const projection = `u.id AS "uploadId",'source' AS kind,u.artifact_id AS id,u.revision_id AS "revisionId",u.filename AS name,a.edit_version AS "editVersion",u.media_type AS "mediaType",u.byte_size AS size`;
export class ContextUploads {
  constructor(private readonly service: AgentService) {}
  async permissions(ctx: Context, c = this.service.pool as PoolClient | typeof this.service.pool) {
    const row = (
      await c.query('SELECT editor_upload,edit_version FROM wa_context_permissions WHERE workspace_id=$1', [
        ctx.workspace.id,
      ])
    ).rows[0];
    const editorUpload = row?.editor_upload ?? true;
    return {
      editVersion: row?.edit_version ?? 0,
      editorUpload,
      canManage: canManage(ctx.workspace.role),
      canUpload: canManage(ctx.workspace.role) || (ctx.workspace.role === 'editor' && editorUpload),
    };
  }
  async configure(ctx: Context, input: unknown) {
    if (!canManage(ctx.workspace.role))
      throw new ControlError(403, 'Only owners and admins can change context permissions.');
    const data = z
      .object({ expectedVersion: z.number().int().nonnegative(), editorUpload: z.boolean() })
      .strict()
      .parse(input);
    await this.service.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-context-policy:'||$1,0))", [ctx.workspace.id]);
      const old = await this.permissions(ctx, c);
      if (old.editVersion !== data.expectedVersion)
        throw new ControlError(409, 'Context permissions changed. Refresh before saving.');
      await c.query(
        'INSERT INTO wa_context_permissions(workspace_id,editor_upload,updated_by) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET editor_upload=$2,updated_by=$3,edit_version=wa_context_permissions.edit_version+1,updated_at=now()',
        [ctx.workspace.id, data.editorUpload, ctx.user.id],
      );
      await this.service.control.audit(
        ctx,
        'agent.context_permissions_changed',
        'workspace',
        ctx.workspace.id,
        { previousEditorUpload: old.editorUpload, editorUpload: data.editorUpload },
        c,
      );
    });
    return this.permissions(ctx);
  }
  async pending(ctx: Context, sessionId: string) {
    return (
      await this.service.pool.query(
        `SELECT ${projection} FROM wa_context_uploads u JOIN wi_artifacts a ON a.workspace_id=u.workspace_id AND a.id=u.artifact_id WHERE u.workspace_id=$1 AND u.session_id=$2 AND u.request_id IS NULL AND u.detached_at IS NULL ORDER BY u.created_at,u.id`,
        [ctx.workspace.id, sessionId],
      )
    ).rows;
  }
  async upload(ctx: Context, input: unknown) {
    // Re-read membership and policy at the write boundary; client visibility grants nothing.
    ctx = await this.service.control.authorizePrincipal(ctx.user.id, ctx.workspace.id, 'read');
    if (!(await this.permissions(ctx)).canUpload) {
      await this.service.control.audit(ctx, 'agent.context_upload_denied', 'workspace', ctx.workspace.id, {
        role: ctx.workspace.role,
      });
      throw new ControlError(
        403,
        'Your workspace role cannot upload context. Ask an owner or admin to review People → Context permissions.',
      );
    }
    const data = uploadSchema.parse(input);
    if (!/\.(txt|md)$/i.test(data.filename) || /[/\\\x00-\x1f]/.test(data.filename))
      throw new ControlError(422, 'Select a text (.txt) or Markdown (.md) file.');
    const bytes = Buffer.from(data.data, 'base64');
    if (bytes.toString('base64') !== data.data) throw new ControlError(400, 'Invalid file encoding.');
    if (bytes.length > CONTEXT_UPLOAD_LIMIT)
      throw new ControlError(413, 'Context file exceeds the 250 KB upload limit.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ControlError(422, 'The file must contain valid UTF-8 text.');
    }
    if (text.length > 200000) throw new ControlError(422, 'Context documents may contain at most 200,000 characters.');
    const hash = createHash('sha256').update(bytes).digest('hex'),
      mediaType = /\.md$/i.test(data.filename) ? 'text/markdown' : 'text/plain';
    return this.service.control.transaction(async (c) => {
      // Policy changes serialize with uploads as well as with other policy changes.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-context-policy:'||$1,0))", [ctx.workspace.id]);
      const member = (
        await c.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2 FOR SHARE', [
          ctx.workspace.id,
          ctx.user.id,
        ])
      ).rows[0];
      if (!member) throw new ControlError(403, 'Workspace access was revoked.');
      ctx = { ...ctx, workspace: { ...ctx.workspace, role: member.role } };
      if (!(await this.permissions(ctx, c)).canUpload) {
        await this.service.control.audit(ctx, 'agent.context_upload_denied', 'workspace', ctx.workspace.id, {
          role: ctx.workspace.role,
        });
        throw new ControlError(403, 'Context upload permission changed.');
      }
      const session = (
        await c.query('SELECT * FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          data.sessionId,
        ])
      ).rows[0];
      if (!session || session.deleted_at) throw new ControlError(404, 'Conversation not found.');
      if (session.archived_at) throw new ControlError(409, 'Restore the conversation before uploading context.');
      const existing = (
        await c.query(
          `SELECT ${projection},u.content_hash,u.session_id FROM wa_context_uploads u JOIN wi_artifacts a ON a.workspace_id=u.workspace_id AND a.id=u.artifact_id WHERE u.workspace_id=$1 AND u.actor_id=$2 AND u.client_key=$3`,
          [ctx.workspace.id, ctx.user.id, data.clientKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.content_hash !== hash || existing.session_id !== data.sessionId || existing.name !== data.filename)
          throw new ControlError(409, 'Upload key was already used for a different file.');
        const { content_hash, session_id, ...receipt } = existing;
        return receipt;
      }
      const count = (
        await c.query(
          'SELECT count(*)::int AS count FROM wa_context_uploads WHERE workspace_id=$1 AND session_id=$2 AND request_id IS NULL AND detached_at IS NULL',
          [ctx.workspace.id, data.sessionId],
        )
      ).rows[0].count;
      if (count >= 10) throw new ControlError(422, 'Attach at most ten context files.');
      const saved = await this.service.knowledge.save(
        ctx,
        { name: data.filename, kind: 'source', content: { schemaVersion: 1, mediaType, text } },
        undefined,
        c,
      );
      const uploadId = crypto.randomUUID();
      await c.query(
        'INSERT INTO wa_context_uploads(workspace_id,id,session_id,actor_id,client_key,artifact_id,revision_id,filename,media_type,byte_size,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          ctx.workspace.id,
          uploadId,
          data.sessionId,
          ctx.user.id,
          data.clientKey,
          saved.artifact.id,
          saved.revision.id,
          data.filename,
          mediaType,
          bytes.length,
          hash,
        ],
      );
      await this.service.control.audit(
        ctx,
        'agent.context_uploaded',
        'agent_session',
        data.sessionId,
        {
          uploadId,
          filename: data.filename,
          artifactId: saved.artifact.id,
          revisionId: saved.revision.id,
          bytes: bytes.length,
          contentHash: hash,
          role: ctx.workspace.role,
        },
        c,
      );
      return {
        uploadId,
        kind: 'source',
        id: saved.artifact.id,
        revisionId: saved.revision.id,
        name: data.filename,
        editVersion: saved.artifact.editVersion,
        mediaType,
        size: bytes.length,
      };
    });
  }
  async detach(ctx: Context, sessionId: string, uploadId: string) {
    await this.service.control.transaction(async (c) => {
      const row = (
        await c.query('SELECT deleted_at FROM wa_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          sessionId,
        ])
      ).rows[0];
      if (!row || row.deleted_at) throw new ControlError(404, 'Conversation not found.');
      const result = await c.query(
        'UPDATE wa_context_uploads SET detached_at=COALESCE(detached_at,now()) WHERE workspace_id=$1 AND session_id=$2 AND id=$3 AND request_id IS NULL RETURNING artifact_id',
        [ctx.workspace.id, sessionId, uploadId],
      );
      if (!result.rowCount) throw new ControlError(404, 'Pending context upload not found.');
      await this.service.control.audit(
        ctx,
        'agent.context_detached',
        'agent_session',
        sessionId,
        { uploadId, artifactId: result.rows[0].artifact_id },
        c,
      );
    });
    return { id: uploadId };
  }
}
