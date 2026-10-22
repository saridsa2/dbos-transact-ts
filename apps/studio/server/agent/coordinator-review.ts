import { z } from 'zod';
import { agentRevisionRefSchema, definitionSchema } from '../../lib/agent/definitions';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import { usageTotals } from './context';
import { enqueueWorkspaceRequest } from './intake';
import type { AgentService } from './service';
export class CoordinatorReview {
  private afterWorkspace = '';
  constructor(readonly service: AgentService) {}
  async get(ctx: Context) {
    const row = (
      await this.service.pool.query(
        `SELECT target,enabled,edit_version AS "editVersion",max_runs AS "maxRuns",daily_tokens AS "dailyTokens",error,(SELECT count(*)::int FROM wa_coordinator_changes WHERE workspace_id=$1) AS pending FROM wa_coordinator_rules WHERE workspace_id=$1`,
        [ctx.workspace.id],
      )
    ).rows[0];
    return row ?? { enabled: false, editVersion: 0, maxRuns: 4, dailyTokens: 200000, pending: 0 };
  }
  async save(ctx: Context, input: unknown) {
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Only administrators can configure automatic reviews.');
    const data = z
      .object({
        clientKey: z.string().uuid(),
        expectedVersion: z.number().int().nonnegative(),
        target: agentRevisionRefSchema,
        enabled: z.boolean(),
        maxRuns: z.number().int().min(1).max(12),
        dailyTokens: z.number().int().min(1024).max(1000000),
      })
      .strict()
      .parse(input);
    return this.service.definitions.mutate(ctx, 'coordinator.review.configure', data.clientKey, data, async (c) => {
      const binding = (
        await c.query('SELECT agent_id,revision,content_hash FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [
          ctx.workspace.id,
        ])
      ).rows[0];
      if (
        data.enabled &&
        (binding?.agent_id !== data.target.agentId ||
          binding.revision !== data.target.revision ||
          binding.content_hash !== data.target.hash)
      )
        throw new ControlError(409, 'Select the active workspace coordinator revision.');
      const old = (
        await c.query('SELECT edit_version FROM wa_coordinator_rules WHERE workspace_id=$1 FOR UPDATE', [
          ctx.workspace.id,
        ])
      ).rows[0];
      if ((old?.edit_version ?? 0) !== data.expectedVersion)
        throw new ControlError(409, 'Automatic review settings changed.');
      if (data.enabled) {
        const snapshot = await this.service.definitions.resolve(ctx, data.target, c);
        if (snapshot.definition.context.scope === 'selected' && !snapshot.definition.context.followHead)
          throw new ControlError(
            422,
            'Automatic knowledge review requires following saved resource revisions or workspace inventory access.',
          );
      }
      await c.query(
        'INSERT INTO wa_coordinator_rules(workspace_id,target,actor_id,enabled,max_runs,daily_tokens) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET target=$2,actor_id=$3,enabled=$4,max_runs=$5,daily_tokens=$6,error=NULL,edit_version=wa_coordinator_rules.edit_version+1,updated_at=now()',
        [ctx.workspace.id, data.target, ctx.user.id, data.enabled, data.maxRuns, data.dailyTokens],
      );
      await this.service.control.audit(
        ctx,
        'agent.automatic_review_configured',
        'workspace_agent',
        data.target.agentId,
        { enabled: data.enabled, maxRuns: data.maxRuns, dailyTokens: data.dailyTokens },
        c,
      );
      return { editVersion: (old?.edit_version ?? 0) + 1 };
    });
  }
  async reconcile() {
    // Release unused reservations only after a recorded terminal outcome. Unknown calls keep their full reservation.
    const finished = (
      await this.service.pool.query(
        `SELECT a.*,r.work_item_id,w.state AS work_state FROM wa_coordinator_admissions a JOIN wa_requests r ON r.workspace_id=a.workspace_id AND r.id=a.request_id LEFT JOIN wa_work_items w ON w.workspace_id=r.workspace_id AND w.id=r.work_item_id WHERE a.charged_tokens IS NULL AND (r.state='rejected' OR w.state IN ('completed','failed','uncertain','cancelled','budget_exhausted')) LIMIT 50`,
      )
    ).rows;
    for (const row of finished) {
      const usage = row.work_item_id
        ? await usageTotals(this.service, row.workspace_id, row.work_item_id)
        : { tokens: 0 };
      const unknown = row.work_item_id
        ? (
            await this.service.pool.query(
              "SELECT 1 FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND state IN ('issued','uncertain') LIMIT 1",
              [row.workspace_id, row.work_item_id],
            )
          ).rowCount
        : 0;
      await this.service.pool.query(
        'UPDATE wa_coordinator_admissions SET charged_tokens=$3 WHERE workspace_id=$1 AND request_id=$2 AND charged_tokens IS NULL',
        [row.workspace_id, row.request_id, unknown ? Math.max(usage.tokens, row.reserved_tokens) : usage.tokens],
      );
    }
    const rules = (
      await this.service.pool.query(
        'SELECT * FROM wa_coordinator_rules WHERE enabled AND workspace_id>$1 ORDER BY workspace_id LIMIT 100',
        [this.afterWorkspace],
      )
    ).rows;
    this.afterWorkspace = rules.at(-1)?.workspace_id ?? '';
    for (const saved of rules) {
      try {
        const ctx = await this.service.control.authorizePrincipal(saved.actor_id, saved.workspace_id, 'execute');
        await this.service.control.transaction(async (c) => {
          await this.service.definitions.lock(c, saved.workspace_id);
          const rule = (await c.query('SELECT * FROM wa_coordinator_rules WHERE workspace_id=$1', [saved.workspace_id]))
            .rows[0];
          if (!rule.enabled) return;
          const binding = (
            await c.query(
              'SELECT agent_id,revision,content_hash FROM wa_workspace_agent_bindings WHERE workspace_id=$1',
              [saved.workspace_id],
            )
          ).rows[0];
          if (
            binding?.agent_id !== rule.target.agentId ||
            binding.revision !== rule.target.revision ||
            binding.content_hash !== rule.target.hash
          )
            throw Error('Workspace coordinator changed. Review the automatic review rule.');
          // Capture changes even while the coordinator/model is paused. Resolving
          // execution permissions first would roll back capture and lose those events
          // when legacy event intake acknowledges the outbox later in this cycle.
          const revision = (
            await c.query(
              'SELECT definition FROM wa_agent_revisions WHERE workspace_id=$1 AND agent_id=$2 AND revision=$3 AND content_hash=$4',
              [saved.workspace_id, rule.target.agentId, rule.target.revision, rule.target.hash],
            )
          ).rows[0];
          if (!revision) throw Error('The pinned coordinator revision is unavailable.');
          const scope = definitionSchema.parse(revision.definition).context;
          if (scope.scope === 'selected')
            await c.query(
              'DELETE FROM wa_coordinator_changes WHERE workspace_id=$1 AND NOT (artifact_id=ANY($2::text[]))',
              [saved.workspace_id, scope.resources.map((r) => r.id)],
            );
          const events = (
            await c.query(
              "SELECT * FROM wa_domain_outbox WHERE workspace_id=$1 AND delivered_at IS NULL AND event_type='knowledge.saved' ORDER BY created_at,id LIMIT 50",
              [saved.workspace_id],
            )
          ).rows;
          for (const event of events) {
            if (scope.scope === 'selected' && !scope.resources.some((r) => r.id === event.entity_id)) continue;
            await c.query(
              'INSERT INTO wa_coordinator_changes(workspace_id,artifact_id,kind,event_id) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,artifact_id) DO UPDATE SET kind=$3,event_id=$4',
              [saved.workspace_id, event.entity_id, event.entity_kind, event.id],
            );
            await c.query('UPDATE wa_domain_outbox SET delivered_at=now() WHERE workspace_id=$1 AND id=$2', [
              saved.workspace_id,
              event.id,
            ]);
          }
          const pending = (
            await c.query(
              'SELECT * FROM wa_coordinator_changes WHERE workspace_id=$1 ORDER BY created_at,artifact_id LIMIT 10',
              [saved.workspace_id],
            )
          ).rows;
          if (!pending.length) return;
          let snapshot;
          try {
            snapshot = await this.service.definitions.resolve(ctx, rule.target, c);
          } catch (error) {
            if (!(error instanceof ControlError)) throw error;
            await c.query('UPDATE wa_coordinator_rules SET error=$2 WHERE workspace_id=$1', [
              saved.workspace_id,
              error.message,
            ]);
            return;
          }
          const busy = (
            await c.query(
              `SELECT 1 FROM wa_coordinator_admissions a JOIN wa_requests r ON r.workspace_id=a.workspace_id AND r.id=a.request_id LEFT JOIN wa_work_items w ON w.workspace_id=r.workspace_id AND w.id=r.work_item_id WHERE a.workspace_id=$1 AND (r.state='queued' OR w.state IN ('queued','preparing','reasoning','executing_tool','waiting_for_user','waiting_for_tasks','ready_for_review') OR (w.state='suspended' AND a.rule_version=$2)) LIMIT 1`,
              [saved.workspace_id, rule.edit_version],
            )
          ).rowCount;
          if (busy) return;
          const day = (await c.query("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day")).rows[0].day;
          const budget = (
            await c.query(
              'SELECT count(*)::int AS runs,COALESCE(sum(COALESCE(charged_tokens,reserved_tokens)),0)::int AS tokens FROM wa_coordinator_admissions WHERE workspace_id=$1 AND day=$2',
              [saved.workspace_id, day],
            )
          ).rows[0];
          const remaining = rule.daily_tokens - budget.tokens;
          if (budget.runs >= rule.max_runs || remaining < 1024) {
            await c.query(
              "UPDATE wa_coordinator_rules SET error='Daily review admission limit reached; changes remain queued for a later UTC day.' WHERE workspace_id=$1",
              [saved.workspace_id],
            );
            return;
          }
          const attachments = [];
          for (const change of pending) {
            const resource = (
              await c.query('SELECT revision_id,kind FROM wi_artifacts WHERE workspace_id=$1 AND id=$2 FOR SHARE', [
                saved.workspace_id,
                change.artifact_id,
              ])
            ).rows[0];
            if (resource)
              attachments.push({ id: change.artifact_id, kind: resource.kind, revisionId: resource.revision_id });
          }
          const request = await enqueueWorkspaceRequest(
            this.service,
            ctx,
            {
              clientRequestId: crypto.randomUUID(),
              agent: rule.target,
              text: 'Review saved knowledge changes against the accepted workspace purpose. Inspect the attached revisions, identify evidence-backed gaps and record useful bounded specialist suggestions. Do not dispatch assignments or apply domain changes.',
              attachments,
              context: { surface: 'intelligence' },
            },
            'workspace-event',
            undefined,
            c,
            { totalTokens: remaining, ruleVersion: rule.edit_version },
          );
          const reserve = Math.min(remaining, snapshot.policyCeiling.runtime.totalTokens);
          await c.query(
            'INSERT INTO wa_coordinator_admissions(workspace_id,request_id,rule_version,day,reserved_tokens) VALUES($1,$2,$3,$4,$5)',
            [saved.workspace_id, request.requestId, rule.edit_version, day, reserve],
          );
          await c.query('DELETE FROM wa_coordinator_changes WHERE workspace_id=$1 AND artifact_id=ANY($2::text[])', [
            saved.workspace_id,
            pending.map((p) => p.artifact_id),
          ]);
          await c.query('UPDATE wa_coordinator_rules SET error=NULL WHERE workspace_id=$1', [saved.workspace_id]);
          await this.service.control.audit(
            ctx,
            'agent.automatic_review_admitted',
            'agent_request',
            request.requestId,
            { ruleVersion: rule.edit_version, reservedTokens: reserve },
            c,
          );
        });
      } catch (error) {
        await this.service.pool.query('UPDATE wa_coordinator_rules SET error=$2 WHERE workspace_id=$1', [
          saved.workspace_id,
          error instanceof Error ? error.message : 'Automatic review is blocked.',
        ]);
      }
    }
  }
}
