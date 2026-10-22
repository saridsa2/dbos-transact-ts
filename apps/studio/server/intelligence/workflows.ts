import { DBOS } from '@dbos-inc/dbos-sdk';
import { ControlError } from '../control/service';
import type { Context } from '../../lib/control/contracts';
import { IntelligenceService } from './service';
import { minimaxAdapter, type AuthoringModelAdapter } from './minimax';
export function createIntelligenceRuntime(
  service: IntelligenceService,
  adapter: AuthoringModelAdapter = minimaxAdapter(),
) {
  const k = service.knowledge;
  async function principal(workspaceId: string, taskId: string): Promise<Context> {
    const row = (
      await k.pool.query('SELECT actor_id FROM wi_tasks WHERE workspace_id=$1 AND id=$2', [workspaceId, taskId])
    ).rows[0];
    if (!row) throw new ControlError(404, 'Task not found.');
    return service.control.authorizePrincipal(row.actor_id, workspaceId, 'execute');
  }
  const workflow = DBOS.registerWorkflow(
    async (workspaceId: string, taskId: string) => {
      try {
        for (let turn = 0; turn < 3; turn++) {
          const state = await DBOS.runStep(
            async () => {
              const ctx = await principal(workspaceId, taskId);
              return (await k.task(ctx, taskId)).record.status;
            },
            { name: `state:${turn}` },
          );
          if (['cancelled', 'applied'].includes(state)) return;
          await DBOS.runStep(
            async () => {
              const ctx = await principal(workspaceId, taskId);
              await service.control.transaction(async (client) => {
                const result = await client.query(
                  "UPDATE wi_tasks SET status='analyzing',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('cancelled','applied') RETURNING id",
                  [workspaceId, taskId],
                );
                if (result.rowCount)
                  await service.control.audit(ctx, 'intelligence.analyzing', 'intelligence_task', taskId, {}, client);
              });
            },
            { name: `begin:${turn}` },
          );
          const analysis = await DBOS.runStep(
            async () => {
              const ctx = await principal(workspaceId, taskId),
                task = await k.task(ctx, taskId);
              if (task.record.status === 'cancelled') return null;
              const previous = (
                await k.pool.query(
                  'SELECT status,result FROM wi_model_calls WHERE workspace_id=$1 AND task_id=$2 AND turn=$3',
                  [workspaceId, taskId, turn],
                )
              ).rows[0];
              if (previous?.status === 'completed') return previous.result as { waiting: boolean };
              if (previous)
                throw new ControlError(
                  409,
                  'The previous MiniMax request has an uncertain outcome after interruption. Start a new task to authorize another request.',
                );

              if (['ready', 'needs_clarification'].includes(task.record.status) && task.record.analysis)
                return { waiting: task.record.status === 'needs_clarification' };
              const connection = (await service.control.connections(ctx)).find(
                (c) =>
                  c.id === task.record.connectionId &&
                  c.provider === 'minimax' &&
                  c.status === 'configured' &&
                  c.revision === task.record.connectionRevision,
              );
              if (!connection) throw new ControlError(422, 'MiniMax connection was changed or revoked.');
              const credential = await service.control.resolveCredential(
                workspaceId,
                connection.id,
                connection.revision,
              );
              if (!('secret' in credential) || !credential.secret)
                throw new ControlError(503, 'MiniMax credential is unavailable.');
              const blocks = await k.blocks(ctx, task.record.sourceId, task.record.sourceRevisionId);
              const reservation = await k.pool.query(
                "INSERT INTO wi_model_calls(workspace_id,task_id,turn,status) VALUES($1,$2,$3,'reserved') ON CONFLICT DO NOTHING RETURNING turn",
                [workspaceId, taskId, turn],
              );
              if (!reservation.rowCount)
                throw new ControlError(409, 'Another worker already reserved this MiniMax request. Reload the task.');
              const cancelled = new AbortController();
              let checking = false;
              const timer = setInterval(() => {
                if (checking) return;
                checking = true;
                void k.pool
                  .query('SELECT status FROM wi_tasks WHERE workspace_id=$1 AND id=$2', [workspaceId, taskId])
                  .then((r) => {
                    if (r.rows[0]?.status === 'cancelled') cancelled.abort();
                  })
                  .catch(() => cancelled.abort())
                  .finally(() => {
                    checking = false;
                  });
              }, 500);
              try {
                const result = await adapter.generate(
                  {
                    model: String(connection.config.model ?? 'MiniMax-M2.7'),
                    taskId,
                    source: { revisionId: task.record.sourceRevisionId, blocks },
                    answers: task.answers,
                    signal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(120000)]),
                  },
                  credential.secret,
                );
                result.analysis.process.questions = result.analysis.process.questions.map((q) => ({
                  ...q,
                  ...(task.answers[q.id] ? { answer: task.answers[q.id] } : {}),
                }));
                await principal(workspaceId, taskId);
                result.analysis = await service.validateAnalysis(ctx, taskId, result.analysis);
                // Persist only validated final output and metadata; reasoning and credentials never leave the adapter.
                await service.control.transaction(async (client) => {
                  const waiting = result.analysis.process.questions.some((q) => !q.answer?.trim());
                  const update = await client.query(
                    "UPDATE wi_tasks SET analysis=$3,summary=$4,status=$5,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='analyzing' RETURNING id,edit_version",
                    [
                      workspaceId,
                      taskId,
                      result.analysis,
                      result.analysis.summary,
                      waiting ? 'needs_clarification' : 'ready',
                    ],
                  );
                  if (update.rowCount)
                    await client.query(
                      'INSERT INTO wi_proposal_revisions(workspace_id,task_id,task_version,analysis,actor_id) VALUES($1,$2,$3,$4,$5)',
                      [workspaceId, taskId, update.rows[0].edit_version, result.analysis, ctx.user.id],
                    );
                  await client.query(
                    "UPDATE wi_model_calls SET status='completed',result=$4,completed_at=now() WHERE workspace_id=$1 AND task_id=$2 AND turn=$3",
                    [workspaceId, taskId, turn, { waiting: update.rowCount ? waiting : false }],
                  );
                  if (update.rowCount)
                    await service.control.audit(
                      ctx,
                      waiting ? 'intelligence.clarification' : 'intelligence.ready',
                      'intelligence_task',
                      taskId,
                      {
                        model: result.model,
                        responseId: result.responseId,
                        usage: result.usage,
                        adapter: adapter.id,
                        adapterVersion: adapter.version,
                      },
                      client,
                    );
                });
                return { waiting: result.analysis.process.questions.some((q) => !q.answer?.trim()) };
              } finally {
                clearInterval(timer);
              }
            },
            { name: `analyze:${turn}`, retriesAllowed: false },
          );
          if (!analysis || !analysis.waiting) return;
          // Durable user wait. Poll authoritative state only on workflow timeout/wakeup.
          while (true) {
            await DBOS.recv('authoring-answer', { timeoutSeconds: 86400 });
            const state = await DBOS.runStep(
              async () => {
                const ctx = await principal(workspaceId, taskId),
                  task = await k.task(ctx, taskId);
                return { status: task.record.status, answered: Object.keys(task.answers).length > 0 };
              },
              { name: `resume:${turn}:${DBOS.workflowID}` },
            );
            if (['cancelled', 'ready', 'applied'].includes(state.status)) return;
            if (state.answered) break;
          }
        }
        await DBOS.runStep(
          async () => {
            const ctx = await principal(workspaceId, taskId);
            await k.pool.query(
              "UPDATE wi_tasks SET status='failed',error='Analysis reached its three-call limit. Review the retained proposal manually or start a new task.',edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('cancelled','applied')",
              [workspaceId, taskId],
            );
            await service.control.audit(ctx, 'intelligence.failed', 'intelligence_task', taskId);
          },
          { name: 'budget-exhausted' },
        );
      } catch (error) {
        await DBOS.runStep(
          async () => {
            const row = (
              await k.pool.query('SELECT actor_id FROM wi_tasks WHERE workspace_id=$1 AND id=$2', [workspaceId, taskId])
            ).rows[0];
            const message =
              error instanceof ControlError
                ? error.message
                : 'Analysis failed. Check the source and MiniMax connection, then start a new task.';
            await k.pool.query(
              "WITH changed AS (UPDATE wi_tasks SET status='failed',error=$3,edit_version=edit_version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('cancelled','applied') RETURNING id) INSERT INTO cp_audit(workspace_id,actor_id,action,entity_type,entity_id) SELECT $1,$4,'intelligence.failed','intelligence_task',id FROM changed",
              [workspaceId, taskId, message, row?.actor_id ?? null],
            );
          },
          { name: 'record-failure' },
        );
      }
    },
    { name: 'stackproc.intelligence.authoring.v1' },
  );
  let reconciling = false;
  return {
    async reconcile() {
      if (reconciling) return;
      reconciling = true;
      try {
        const rows = (await k.pool.query('SELECT * FROM wi_outbox WHERE NOT delivered ORDER BY created_at LIMIT 25'))
          .rows;
        for (const row of rows) {
          const workflowID = `intelligence:${row.workspace_id}:${row.task_id}`;
          if (row.kind === 'start') await DBOS.startWorkflow(workflow, { workflowID })(row.workspace_id, row.task_id);
          else await DBOS.send(workflowID, { kind: row.kind, ...row.payload }, 'authoring-answer', row.id);
          await k.pool.query('UPDATE wi_outbox SET delivered=true WHERE id=$1', [row.id]);
        }
      } finally {
        reconciling = false;
      }
    },
  };
}
