import { z } from 'zod';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import { contentHash } from '../../lib/knowledge/contracts';
import { harnessOptionsSchema } from '../workspace-harness/options';
import { ControlError } from '../control/service';
const tasksSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            title: z.string().min(1).max(150),
            goal: z.string().min(1).max(8000),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
const terminal = ['completed', 'failed', 'uncertain', 'cancelled', 'budget_exhausted', 'suspended'];
export class AgentTasks {
  constructor(readonly service: AgentService) {}
  async list(ctx: Context, parent: string) {
    return {
      items: (
        await this.service.pool.query(
          'SELECT t.id,t.title,t.child_work_id AS "workId",t.depth,w.state,w.error,(SELECT content FROM wa_messages m WHERE m.workspace_id=t.workspace_id AND m.work_item_id=t.child_work_id AND m.role=\'assistant\' ORDER BY ordinal DESC LIMIT 1) AS response FROM wa_agent_tasks t JOIN wa_work_items w ON w.workspace_id=t.workspace_id AND w.id=t.child_work_id WHERE t.workspace_id=$1 AND t.parent_work_id=$2 ORDER BY t.created_at,t.id',
          [ctx.workspace.id, parent],
        )
      ).rows,
    };
  }
  async delegate(ctx: Context, parent: string, input: unknown) {
    const data = tasksSchema.parse(input);
    if (new Set(data.tasks.map((t) => t.key)).size !== data.tasks.length)
      throw new ControlError(400, 'Task keys must be unique.');
    await this.service.authorize(ctx.workspace.id, parent);
    return this.service.control.transaction(async (c) => {
      const work = (
        await c.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          parent,
        ])
      ).rows[0];
      const options = harnessOptionsSchema.parse(work.config_snapshot.runtime ?? {});
      if (!options.delegation || work.task_depth >= options.maxDepth)
        throw new ControlError(403, 'Delegation is disabled or its depth limit was reached.');
      const existing = (
        await c.query(
          'SELECT t.*,w.state AS child_state FROM wa_agent_tasks t JOIN wa_work_items w ON w.workspace_id=t.workspace_id AND w.id=t.child_work_id WHERE t.workspace_id=$1 AND t.parent_work_id=$2',
          [ctx.workspace.id, parent],
        )
      ).rows;
      const fresh = data.tasks.filter((t) => !existing.some((r) => r.request_key === t.key));
      if (existing.length + fresh.length > options.maxChildren)
        throw new ControlError(422, 'The delegated task limit was reached.');
      const created = [];
      for (const task of data.tasks) {
        const hash = await contentHash(task),
          prior = existing.find((t) => t.request_key === task.key);
        if (prior) {
          if (prior.request_hash !== hash) throw new ControlError(409, 'Task key was used for different input.');
          if (!terminal.includes(prior.child_state)) created.push(prior.id);
          continue;
        }
        const id = crypto.randomUUID(),
          session = crypto.randomUUID(),
          child = crypto.randomUUID();
        const snapshot = structuredClone(work.config_snapshot);
        snapshot.runtime = {
          ...options,
          totalTokens: Math.max(1024, Math.floor(options.totalTokens / (data.tasks.length + 1))),
        };
        await c.query('INSERT INTO wa_sessions(workspace_id,id,created_by,title,client_key) VALUES($1,$2,$3,$4,$5)', [
          ctx.workspace.id,
          session,
          work.sponsor_id,
          task.title,
          `task:${parent}:${task.key}`,
        ]);
        await c.query(
          "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,actor_id,content,attachments) VALUES($1,$2,$3,1,'user',$4,$5,$6)",
          [ctx.workspace.id, child, session, work.sponsor_id, task.goal, JSON.stringify(work.attachments)],
        );
        await c.query(
          "INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot,attachments,request_context,read_only,task_depth) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,true,$10)",
          [
            ctx.workspace.id,
            child,
            session,
            work.sponsor_id,
            task.goal,
            work.config_revision,
            snapshot,
            JSON.stringify(work.attachments),
            {
              parentWorkId: parent,
              delegation: 'Read-only research. Return findings to the parent; do not ask the user or stage changes.',
            },
            work.task_depth + 1,
          ],
        );
        await c.query(
          'INSERT INTO wa_agent_tasks(workspace_id,id,parent_work_id,child_work_id,title,depth,request_hash,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [ctx.workspace.id, id, parent, child, task.title, work.task_depth + 1, hash, task.key],
        );
        await this.service.enqueue(c, ctx.workspace.id, child, `start:${child}`);
        created.push(id);
      }
      await this.service.activity(
        ctx.workspace.id,
        parent,
        'delegation',
        'Read-only tasks dispatched to durable workers.',
        { tasks: created },
        c,
      );
      return { pendingTasks: created };
    });
  }
  async reconcile() {
    const rows = (
      await this.service.pool.query(
        "SELECT workspace_id,id FROM wa_work_items p WHERE state='waiting_for_tasks' AND NOT EXISTS(SELECT 1 FROM wa_agent_tasks t JOIN wa_work_items c ON c.workspace_id=t.workspace_id AND c.id=t.child_work_id WHERE t.workspace_id=p.workspace_id AND t.parent_work_id=p.id AND NOT(c.state=ANY($1::text[])))",
        [terminal],
      )
    ).rows;
    for (const row of rows)
      await this.service.control.transaction(async (c) => {
        const update = await c.query(
          "UPDATE wa_work_items SET state='queued',edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2 AND state='waiting_for_tasks' RETURNING turn_no",
          [row.workspace_id, row.id],
        );
        if (update.rowCount) {
          await this.service.enqueue(c, row.workspace_id, row.id, `tasks:${row.id}:${update.rows[0].turn_no}`);
          await this.service.activity(
            row.workspace_id,
            row.id,
            'tasks_ready',
            'Delegated results are ready for the parent agent.',
            {},
            c,
          );
        }
      });
  }
}
