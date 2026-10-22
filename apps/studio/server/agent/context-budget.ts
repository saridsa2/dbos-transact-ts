import { z } from 'zod';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import { harnessOptionsSchema } from '../workspace-harness/options';
import { usageTotals } from './context';
import { contentHash } from '../../lib/knowledge/contracts';
export class ContextBudget {
  constructor(readonly service: AgentService) {}
  async root(workspace: string, id: string, c: any = this.service.pool): Promise<string> {
    const row = (
      await c.query(
        `WITH RECURSIVE ancestors(id,path) AS (SELECT $2::text,ARRAY[$2::text] UNION ALL SELECT t.parent_work_id,a.path||t.parent_work_id FROM wa_agent_tasks t JOIN ancestors a ON t.child_work_id=a.id WHERE t.workspace_id=$1 AND NOT t.parent_work_id=ANY(a.path)) SELECT id FROM ancestors ORDER BY cardinality(path) DESC LIMIT 1`,
        [workspace, id],
      )
    ).rows[0];
    return row.id;
  }
  async allowance(workspace: string, id: string) {
    const { work, config } = await this.service.authorize(workspace, id),
      base = harnessOptionsSchema.parse(config.runtime ?? {});
    const granted = Number(
      (
        await this.service.pool.query(
          'SELECT COALESCE(sum(additional_tokens),0)::float8 tokens FROM wa_work_budget_grants WHERE workspace_id=$1 AND work_item_id=$2',
          [workspace, id],
        )
      ).rows[0].tokens,
    );
    const ceiling = base.maxTotalTokens ?? base.totalTokens;
    return { tokens: Math.min(ceiling, base.totalTokens + granted), base, work, config };
  }
  async reserve(
    workspace: string,
    workId: string,
    key: string,
    promptBytes: number,
    output: number,
    expectedScopeHash?: string,
  ) {
    const root = await this.root(workspace, workId),
      budget = await this.allowance(workspace, root);
    const authorized = expectedScopeHash ? await this.service.authorize(workspace, workId) : null;
    return this.service.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-budget:'||$1||':'||$2,0))", [workspace, root]);
      if (expectedScopeHash) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-memory:'||$1,0))", [workspace]);
        if ((await this.service.memory.scope(authorized!.ctx, workId, c, false)).hash !== expectedScopeHash)
          throw Error('CONTEXT: Memory scope changed before request admission.');
      }
      const prior = (
        await c.query(
          'SELECT * FROM wa_context_admissions WHERE workspace_id=$1 AND work_item_id=$2 AND invocation_id=$3',
          [workspace, workId, key],
        )
      ).rows[0];
      if (prior && Number(prior.estimated_tokens) !== Math.ceil((promptBytes / 3) * 1.2) + Number(prior.output_tokens))
        throw Error('CONTEXT: Prepared request changed after budget admission.');
      if (prior)
        return { allowed: true, outputTokens: prior.output_tokens, estimatedTokens: Number(prior.estimated_tokens) };
      const usage = (
        await c.query(
          `WITH RECURSIVE family(id) AS (SELECT $2::text UNION SELECT t.child_work_id FROM wa_agent_tasks t JOIN family f ON t.parent_work_id=f.id WHERE t.workspace_id=$1) SELECT COALESCE((SELECT sum(COALESCE((result->'usage'->>'input')::bigint,0)+COALESCE((result->'usage'->>'output')::bigint,0)) FROM wa_calls WHERE workspace_id=$1 AND work_item_id IN (SELECT id FROM family) AND state IN ('completed','failed')),0)+COALESCE((SELECT sum(estimated_tokens) FROM wa_context_admissions WHERE workspace_id=$1 AND work_item_id IN (SELECT id FROM family) AND state='reserved'),0) used`,
          [workspace, root],
        )
      ).rows[0];
      // Conservative estimate, never presented as an exact provider token count.
      const prompt = Math.ceil((promptBytes / 3) * 1.2),
        remaining = budget.tokens - Number(usage.used),
        outputTokens = Math.min(output, Math.max(0, remaining - prompt));
      if (outputTokens < Math.min(512, output))
        return { allowed: false, outputTokens: 0, estimatedTokens: prompt, remaining };
      const estimatedTokens = prompt + outputTokens;
      await c.query(
        'INSERT INTO wa_context_admissions(workspace_id,work_item_id,invocation_id,estimated_tokens,output_tokens) VALUES($1,$2,$3,$4,$5)',
        [workspace, workId, key, estimatedTokens, outputTokens],
      );
      return { allowed: true, outputTokens, estimatedTokens };
    });
  }
  async settle(workspace: string, workId: string, key: string) {
    await this.service.pool.query(
      "UPDATE wa_context_admissions SET state='settled' WHERE workspace_id=$1 AND work_item_id=$2 AND invocation_id=$3",
      [workspace, workId, key],
    );
  }
  async resume(ctx: Context, workId: string, input: unknown) {
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Only owners/admins can extend an activity budget.');
    const data = z
        .object({
          clientKey: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
          additionalTokens: z.number().int().min(1024).max(1000000),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(input),
      hash = await contentHash({ workId, ...data });
    const budget = await this.allowance(ctx.workspace.id, workId);
    if (!budget.work.execution_snapshot?.definition.memory)
      throw new ControlError(409, 'This activity does not use the resumable memory profile.');
    const currentScope = await this.service.memory.scope(ctx, workId);
    const recordedScope = (
      await this.service.pool.query(
        "SELECT manifest->'context'->>'scopeHash' hash FROM wa_context_manifests WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY turn_no DESC LIMIT 1",
        [ctx.workspace.id, workId],
      )
    ).rows[0]?.hash;
    if (recordedScope && recordedScope !== currentScope.hash)
      throw new ControlError(
        409,
        'Knowledge, memory or policy changed. Start a linked activity to rebuild authorized context.',
      );
    if ((await this.root(ctx.workspace.id, workId)) !== workId)
      throw new ControlError(409, 'Resume the root activity.');
    return this.service.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-budget:'||$1||':'||$2,0))", [
        ctx.workspace.id,
        workId,
      ]);
      const prior = (
        await c.query('SELECT * FROM wa_work_budget_grants WHERE workspace_id=$1 AND actor_id=$2 AND client_key=$3', [
          ctx.workspace.id,
          ctx.user.id,
          data.clientKey,
        ])
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ControlError(409, 'Resume key changed.');
        return prior.result;
      }
      const work = (
        await c.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
          ctx.workspace.id,
          workId,
        ])
      ).rows[0];
      if (work.edit_version !== data.expectedVersion || work.state !== 'budget_exhausted')
        throw new ControlError(409, 'Activity is not at the expected budget checkpoint.');
      if (
        (
          await c.query(
            "SELECT 1 FROM wa_calls WHERE workspace_id=$1 AND work_item_id IN (WITH RECURSIVE family(id) AS (SELECT $2::text UNION SELECT t.child_work_id FROM wa_agent_tasks t JOIN family f ON t.parent_work_id=f.id WHERE t.workspace_id=$1) SELECT id FROM family) AND state IN ('issued','uncertain') LIMIT 1",
            [ctx.workspace.id, workId],
          )
        ).rowCount
      )
        throw new ControlError(409, 'Resolve the uncertain provider outcome before resuming.');
      const session = (
        await c.query('SELECT archived_at,deleted_at FROM wa_sessions WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          work.session_id,
        ])
      ).rows[0];
      if (session?.archived_at || session?.deleted_at)
        throw new ControlError(409, 'Restore the session before resuming.');
      const fresh = budget;
      if (fresh.tokens + data.additionalTokens > (fresh.base.maxTotalTokens ?? fresh.base.totalTokens))
        throw new ControlError(409, 'Extension exceeds the pinned/current workspace budget ceiling.');
      const last = (
        await c.query(
          "SELECT * FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND kind='model' AND state IN ('completed','failed') AND NOT COALESCE((result->>'compaction')::boolean,false) ORDER BY turn_no DESC LIMIT 1",
          [ctx.workspace.id, workId],
        )
      ).rows[0];
      const nextTurn = last ? Number(last.turn_no) + 1 : Number(work.turn_no);
      const { config } = budget;
      if (
        (await usageTotals(this.service, ctx.workspace.id, workId, c)).duration >= fresh.base.durationMs ||
        Number(work.tool_count) >= config.limits.tools
      )
        throw new ControlError(
          409,
          'The original time or tool ceiling is exhausted. Start a linked activity under a reviewed policy.',
        );
      if (nextTurn >= config.limits.turns)
        throw new ControlError(
          409,
          'The original reasoning-turn ceiling is exhausted. Start a linked activity under a reviewed policy.',
        );
      if (last?.private_result) {
        const message = JSON.parse(
          this.service.control.vault.open(last.private_result, `agent:${ctx.workspace.id}:${last.id}`),
        );
        for (const call of message.tool_calls ?? []) {
          await c.query(
            "INSERT INTO wa_calls(workspace_id,id,work_item_id,turn_no,kind,call_key,state,request_hash,request,result,completed_at) SELECT $1,$2,$3,$4,'tool',$5,'completed',$6,$7,$8,now() WHERE NOT EXISTS(SELECT 1 FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$3 AND kind='tool' AND call_key=$5)",
            [
              ctx.workspace.id,
              crypto.randomUUID(),
              workId,
              last.turn_no,
              `${last.turn_no}:${call.id}`,
              await contentHash(call),
              { name: call.function.name, providerId: call.id },
              { skipped: true, reason: 'Budget pause before dispatch; resume re-evaluates the next action.' },
            ],
          );
        }
      }
      const id = crypto.randomUUID(),
        result = { workItemId: workId, state: 'queued', grantedTokens: data.additionalTokens };
      await c.query(
        'INSERT INTO wa_work_budget_grants(workspace_id,work_item_id,id,actor_id,client_key,request_hash,additional_tokens,reason,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [ctx.workspace.id, workId, id, ctx.user.id, data.clientKey, hash, data.additionalTokens, data.reason, result],
      );
      await c.query(
        "UPDATE wa_work_items SET state='queued',error=NULL,turn_no=$3,edit_version=edit_version+1 WHERE workspace_id=$1 AND id=$2",
        [ctx.workspace.id, workId, nextTurn],
      );
      await c.query(
        'INSERT INTO wa_command_outbox(workspace_id,id,work_item_id,command_key,start_turn) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, crypto.randomUUID(), workId, `memory-resume:${id}`, nextTurn],
      );
      await this.service.control.audit(
        ctx,
        'agent.budget_extended',
        'agent_work_item',
        workId,
        { additionalTokens: data.additionalTokens, reason: data.reason },
        c,
      );
      return result;
    });
  }
}
