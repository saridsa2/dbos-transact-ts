import { DBOS } from '@dbos-inc/dbos-sdk';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import { ControlError } from '../control/service';
import { enqueueWorkspaceRequest } from './intake';
export function createAgentSchedules(service: AgentService) {
  const scheduled = DBOS.registerWorkflow(
    async (time: Date, context: unknown) => {
      const saved = context as { workspace: string; id: string; revision: number };
      await DBOS.runStep(
        async () => {
          const row = (
            await service.pool.query(
              'SELECT * FROM wa_agent_schedules WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND enabled',
              [saved.workspace, saved.id, saved.revision],
            )
          ).rows[0];
          if (!row) return;
          const ctx = await service.control.authorizePrincipal(row.created_by, row.workspace_id, 'execute');
          const config = await service.configuration(ctx);
          if (!config?.enabled || !config.allowModel || config.mode !== 'assist') return;
          const clientRequestId = createHash('sha256')
            .update(`${row.workspace_id}:${row.id}:${time.toISOString()}`)
            .digest('hex');
          await enqueueWorkspaceRequest(
            service,
            ctx,
            { clientRequestId, text: row.goal, context: { surface: 'workspace' } },
            'workspace-event',
          );
        },
        { name: 'agent.scheduled_request', retriesAllowed: false },
      );
    },
    { name: 'stackproc.agent.scheduled.v1' },
  );
  return {
    async sync() {
      const rows = (
        await service.pool.query(
          'SELECT * FROM wa_agent_schedules WHERE applied_revision IS DISTINCT FROM revision AND error IS NULL',
        )
      ).rows;
      for (const row of rows) {
        try {
          const scheduleName = `agent-${row.workspace_id}-${row.id}`;
          if (row.enabled)
            await DBOS.applySchedules([
              {
                scheduleName,
                workflowFn: scheduled,
                schedule: row.cron,
                cronTimezone: row.timezone,
                context: { workspace: row.workspace_id, id: row.id, revision: row.revision },
              },
            ]);
          else await DBOS.deleteSchedule(scheduleName);
          await service.pool.query(
            'UPDATE wa_agent_schedules SET applied_revision=$3,error=NULL WHERE workspace_id=$1 AND id=$2 AND revision=$3',
            [row.workspace_id, row.id, row.revision],
          );
        } catch {
          await service.pool.query(
            'UPDATE wa_agent_schedules SET error=$3 WHERE workspace_id=$1 AND id=$2 AND revision=$4',
            [
              row.workspace_id,
              row.id,
              'Schedule could not be applied. Check its cron expression and timezone.',
              row.revision,
            ],
          );
        }
      }
    },
  };
}
export async function listAgentSchedules(service: AgentService, ctx: Context) {
  return {
    items: (
      await service.pool.query(
        'SELECT id,name,cron,timezone,enabled,revision,applied_revision AS "appliedRevision",error FROM wa_agent_schedules WHERE workspace_id=$1 ORDER BY name,id',
        [ctx.workspace.id],
      )
    ).rows,
  };
}
export async function saveAgentSchedule(service: AgentService, ctx: Context, input: unknown) {
  if (!['owner', 'admin'].includes(ctx.workspace.role))
    throw new ControlError(403, 'Only administrators can schedule agent work.');
  const data = z
    .object({
      id: z.string().uuid().optional(),
      expectedRevision: z.number().int().nonnegative(),
      name: z.string().min(1).max(150),
      cron: z.string().min(1).max(200),
      timezone: z.string().min(1).max(100),
      goal: z.string().min(1).max(10000),
      enabled: z.boolean(),
    })
    .strict()
    .parse(input);
  try {
    new Intl.DateTimeFormat('en', { timeZone: data.timezone }).format();
  } catch {
    throw new ControlError(400, 'Invalid timezone.');
  }
  const id = data.id ?? crypto.randomUUID();
  return service.control.transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-schedule:'||$1||':'||$2,0))", [
      ctx.workspace.id,
      id,
    ]);
    const before = (
      await c.query('SELECT revision FROM wa_agent_schedules WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
        ctx.workspace.id,
        id,
      ])
    ).rows[0];
    if ((before?.revision ?? 0) !== data.expectedRevision) throw new ControlError(409, 'Schedule revision changed.');
    const revision = data.expectedRevision + 1;
    await c.query(
      'INSERT INTO wa_agent_schedules(workspace_id,id,created_by,name,cron,timezone,goal,enabled,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,id) DO UPDATE SET name=$4,cron=$5,timezone=$6,goal=$7,enabled=$8,revision=$9,error=NULL',
      [ctx.workspace.id, id, ctx.user.id, data.name, data.cron, data.timezone, data.goal, data.enabled, revision],
    );
    await service.control.audit(
      ctx,
      'agent.schedule_saved',
      'agent_schedule',
      id,
      { revision, enabled: data.enabled },
      c,
    );
    return { id, revision, state: 'pending' };
  });
}
