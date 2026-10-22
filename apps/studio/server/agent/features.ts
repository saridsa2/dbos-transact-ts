import { z } from 'zod';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contentHash } from '../../lib/knowledge/contracts';
import { ControlError } from '../control/service';
const uuid = z.string().uuid();
const skillSchema = z
  .object({
    id: uuid.optional(),
    expectedRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    content: z.string().min(1).max(16000),
    enabled: z.boolean().default(true),
  })
  .strict();
export class AgentFeatures {
  constructor(readonly service: AgentService) {}
  async event(
    workspace: string,
    workId: string,
    key: string,
    kind: string,
    payload: unknown,
    db: Pick<AgentService['pool'], 'query'> = this.service.pool,
  ) {
    await db.query(
      'INSERT INTO wa_harness_events(workspace_id,work_item_id,event_key,kind,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [workspace, workId, key, kind, payload],
    );
  }
  async events(ctx: Context, workId: string, after = '0') {
    if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n)
      throw new ControlError(400, 'Invalid event cursor.');
    if (
      !(
        await this.service.pool.query('SELECT 1 FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          workId,
        ])
      ).rowCount
    )
      throw new ControlError(404, 'Work item not found.');
    return (
      await this.service.pool.query(
        'SELECT id::text,kind,payload,created_at AS "createdAt" FROM wa_harness_events WHERE workspace_id=$1 AND work_item_id=$2 AND id>$3 ORDER BY id LIMIT 200',
        [ctx.workspace.id, workId, after],
      )
    ).rows;
  }
  async stream(request: IncomingMessage, response: ServerResponse, ctx: Context, workId: string, after: string) {
    await this.events(ctx, workId, after);
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 1500\n\n');
    let closed = false,
      busy = false,
      cursor = after;
    const pump = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const current = await this.service.control.context(request);
        if (current.workspace.id !== ctx.workspace.id || current.workspace.role !== ctx.workspace.role)
          throw Error('Access changed');
        const rows = await this.events(current, workId, cursor);
        for (const event of rows) {
          if (closed) break;
          response.write(`id: ${event.id}\nevent: agent\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.id;
          if (response.writableLength > 256 * 1024) throw Error('Slow stream');
        }
        if (rows.length < 200) {
          const state = (
            await this.service.pool.query('SELECT state FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
              ctx.workspace.id,
              workId,
            ])
          ).rows[0]?.state;
          if (!['queued', 'preparing', 'reasoning', 'executing_tool'].includes(state)) {
            response.write(`event: state\ndata: ${JSON.stringify({ state })}\n\n`);
            closed = true;
            clearInterval(timer);
            response.end();
          } else if (!rows.length) response.write(': keepalive\n\n');
        }
      } catch {
        closed = true;
        clearInterval(timer);
        response.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void pump(), 500);
    response.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
    await pump();
  }
  async skills(ctx: Context) {
    return {
      items: (
        await this.service.pool.query(
          'SELECT id,name,description,revision,enabled,content_hash AS hash FROM wa_skills WHERE workspace_id=$1 ORDER BY name,id',
          [ctx.workspace.id],
        )
      ).rows,
    };
  }
  async saveSkill(ctx: Context, input: unknown) {
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Only administrators can install workspace skills.');
    const data = skillSchema.parse(input),
      id = data.id ?? crypto.randomUUID(),
      hash = await contentHash(data.content);
    return this.service.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-skill:'||$1||':'||$2,0))", [
        ctx.workspace.id,
        id,
      ]);
      const previous = (
        await c.query('SELECT revision FROM wa_skills WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          id,
        ])
      ).rows[0];
      if ((previous?.revision ?? 0) !== data.expectedRevision) throw new ControlError(409, 'Skill revision changed.');
      const revision = data.expectedRevision + 1;
      await c.query(
        'INSERT INTO wa_skills(workspace_id,id,name,description,content,content_hash,revision,enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,id) DO UPDATE SET name=$3,description=$4,content=$5,content_hash=$6,revision=$7,enabled=$8,updated_at=now()',
        [ctx.workspace.id, id, data.name, data.description, data.content, hash, revision, data.enabled, ctx.user.id],
      );
      await c.query(
        'INSERT INTO wa_skill_revisions(workspace_id,id,revision,content,content_hash) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, id, revision, data.content, hash],
      );
      await this.service.control.audit(ctx, 'agent.skill_saved', 'agent_skill', id, { revision, hash }, c);
      return { id, revision, hash };
    });
  }
  async skillContext(ctx: Context, ids: string[], pins?: { id: string; revision: number }[]) {
    const result = [];
    for (const id of ids) {
      const pin = pins?.find((p) => p.id === id);
      const row = (
        await this.service.pool.query(
          'SELECT s.id,s.name,s.description,r.revision,r.content,r.content_hash AS hash FROM wa_skills s JOIN wa_skill_revisions r ON r.workspace_id=s.workspace_id AND r.id=s.id AND r.revision=COALESCE($3,s.revision) WHERE s.workspace_id=$1 AND s.id=$2 AND s.enabled',
          [ctx.workspace.id, id, pin?.revision ?? null],
        )
      ).rows[0];
      if (!row) throw new ControlError(403, 'A configured skill is missing or disabled.');
      result.push(row);
    }
    return result;
  }
  async steer(ctx: Context, workId: string, input: unknown) {
    const data = z
      .object({
        clientKey: uuid,
        text: z.string().trim().min(1).max(10000),
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    return this.service.control.transaction(async (c) => {
      const parent = (
        await c.query('SELECT session_id FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          workId,
        ])
      ).rows[0];
      if (!parent) throw new ControlError(404, 'Work item not found.');
      const session = await c.query(
        'SELECT id FROM wa_sessions WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
        [ctx.workspace.id, parent.session_id],
      );
      if (!session.rowCount) throw new ControlError(404, 'Agent session not found.');
      const work = (
        await c.query(
          'SELECT state,edit_version,session_id FROM wa_work_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [ctx.workspace.id, workId],
        )
      ).rows[0];
      if (!work) throw new ControlError(404, 'Work item not found.');
      const existing = (
        await c.query('SELECT text FROM wa_work_directives WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3', [
          ctx.workspace.id,
          workId,
          data.clientKey,
        ])
      ).rows[0];
      if (existing) {
        if (existing.text !== data.text) throw new ControlError(409, 'Guidance key was used for other text.');
        return { id: data.clientKey };
      }
      if (
        !['queued', 'preparing', 'reasoning', 'executing_tool', 'waiting_for_tasks', 'waiting_for_user'].includes(
          work.state,
        ) ||
        work.edit_version !== data.expectedVersion
      )
        throw new ControlError(409, 'Work changed or is finished.');
      await c.query(
        'INSERT INTO wa_work_directives(workspace_id,work_item_id,id,actor_id,text) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, workId, data.clientKey, ctx.user.id, data.text],
      );
      const ordinal = (
        await c.query(
          'SELECT COALESCE(max(ordinal),0)+1 AS n FROM wa_messages WHERE workspace_id=$1 AND session_id=$2',
          [ctx.workspace.id, work.session_id],
        )
      ).rows[0].n;
      await c.query(
        "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,actor_id,client_key,content) VALUES($1,$2,$3,$4,'user',$5,$6,$7)",
        [
          ctx.workspace.id,
          crypto.randomUUID(),
          work.session_id,
          ordinal,
          ctx.user.id,
          `guidance:${data.clientKey}`,
          data.text,
        ],
      );
      await c.query(
        'UPDATE wa_sessions SET edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, work.session_id],
      );
      await c.query('UPDATE wa_work_items SET edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2', [
        ctx.workspace.id,
        workId,
      ]);
      await this.service.activity(
        ctx.workspace.id,
        workId,
        'guidance',
        'User guidance queued for the next model boundary.',
        { text: data.text },
        c,
      );
      await this.service.control.audit(ctx, 'agent.guidance', 'agent_work_item', workId, {}, c);
      return { id: data.clientKey };
    });
  }
  async fork(ctx: Context, parentId: string, input: unknown) {
    const data = z
      .object({
        clientKey: uuid,
        title: z.string().trim().min(1).max(200),
        throughOrdinal: z
          .string()
          .regex(/^\d{1,18}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    return this.service.control.transaction(async (c) => {
      const parent = (
        await c.query('SELECT id FROM wa_sessions WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [
          ctx.workspace.id,
          parentId,
        ])
      ).rows[0];
      if (!parent) throw new ControlError(404, 'Parent session not found.');
      const cutoff =
        data.throughOrdinal ??
        (
          await c.query(
            'SELECT COALESCE(max(ordinal),0)::text AS ordinal FROM wa_messages WHERE workspace_id=$1 AND session_id=$2',
            [ctx.workspace.id, parentId],
          )
        ).rows[0].ordinal;
      const existing = (
        await c.query(
          'SELECT s.id,s.title,f.parent_session_id,f.through_ordinal::text FROM wa_sessions s JOIN wa_session_forks f ON f.workspace_id=s.workspace_id AND f.session_id=s.id WHERE s.workspace_id=$1 AND s.created_by=$2 AND s.client_key=$3',
          [ctx.workspace.id, ctx.user.id, data.clientKey],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.title !== data.title ||
          existing.parent_session_id !== parentId ||
          (data.throughOrdinal && existing.through_ordinal !== cutoff)
        )
          throw new ControlError(409, 'Fork key was used for different input.');
        return { id: existing.id };
      }
      if (
        cutoff !== '0' &&
        !(
          await c.query('SELECT 1 FROM wa_messages WHERE workspace_id=$1 AND session_id=$2 AND ordinal=$3', [
            ctx.workspace.id,
            parentId,
            cutoff,
          ])
        ).rowCount
      )
        throw new ControlError(422, 'Select an existing message checkpoint.');
      const id = crypto.randomUUID();
      await c.query('INSERT INTO wa_sessions(workspace_id,id,created_by,title,client_key) VALUES($1,$2,$3,$4,$5)', [
        ctx.workspace.id,
        id,
        ctx.user.id,
        data.title,
        data.clientKey,
      ]);
      await c.query(
        'INSERT INTO wa_session_forks(workspace_id,session_id,parent_session_id,through_ordinal) VALUES($1,$2,$3,$4)',
        [ctx.workspace.id, id, parentId, cutoff],
      );
      const rows = (
        await c.query(
          'SELECT role,content,attachments,resource_refs,ordinal FROM wa_messages WHERE workspace_id=$1 AND session_id=$2 AND ordinal<=$3 ORDER BY ordinal',
          [ctx.workspace.id, parentId, cutoff],
        )
      ).rows;
      for (const m of rows)
        await c.query(
          'INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,content,attachments,resource_refs) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            ctx.workspace.id,
            crypto.randomUUID(),
            id,
            m.ordinal,
            m.role,
            m.content,
            JSON.stringify(m.attachments),
            JSON.stringify(m.resource_refs),
          ],
        );
      await this.service.control.audit(
        ctx,
        'agent.session_forked',
        'agent_session',
        id,
        { parentId, throughOrdinal: cutoff },
        c,
      );
      return { id };
    });
  }
}
