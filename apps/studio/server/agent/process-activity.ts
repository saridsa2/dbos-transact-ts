import { DBOS } from '@dbos-inc/dbos-sdk';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  processAgentDefinitionSchema,
  processNamedAgentDefinitionSchema,
  processAgentTools,
} from '../../lib/processes/agent';
import { contentHash } from '../../lib/knowledge/contracts';
import { schemaValidator, validateStructured } from '../workspace-harness/schema';
import { harnessOptionsSchema } from '../workspace-harness/options';
import type { AgentService } from './service';
import type { NodeRegistry } from '../registry';
const callSchema = z.union([
  z.object({ definition: processAgentDefinitionSchema, input: z.json() }).strict(),
  z.object({ version: z.literal(2), definition: processNamedAgentDefinitionSchema, input: z.json() }).strict(),
]);
const terminal = ['completed', 'failed', 'uncertain', 'cancelled', 'budget_exhausted', 'suspended'];
/** Adapter only: the existing outbox, query lifecycle and checkpointed activation execute the agent. */
export function registerProcessAgent(service: AgentService, registry: NodeRegistry) {
  registry.registerProcessAgent(async (raw, context) => {
    const call = callSchema.parse(raw),
      definition = call.definition;
    schemaValidator(definition.outputSchema);
    const workId = createHash('sha256').update(`process-agent:${context.runId}:${context.nodeId}`).digest('hex');
    const link = await DBOS.runStep(
      async () => {
        const run = await service.studio.run(context.runId);
        if (!run?.actor_user_id) throw new Error('A process agent requires an authenticated run actor.');
        const ctx = await service.control.authorizePrincipal(run.actor_user_id, run.workspace_id, 'execute');
        const config = await service.configuration(ctx);
        if (
          !config?.enabled ||
          !config.allowModel ||
          ('configurationRevision' in definition && config.editVersion !== definition.configurationRevision)
        )
          throw new Error('Process agent policy changed or MiniMax is disabled. Rebind and review the process.');
        const hash = await contentHash(call);
        return service.control.transaction(async (c) => {
          await service.definitions.lock(c, ctx.workspace.id);
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`process-agent:${workId}`]);
          const prior = (
            await c.query('SELECT session_id,request_context FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
              ctx.workspace.id,
              workId,
            ])
          ).rows[0];
          if (prior) {
            if (prior.request_context?.processActivity?.hash !== hash)
              throw new Error('Process activity identity was reused with different inputs.');
            return { workspace: ctx.workspace.id, sessionId: prior.session_id };
          }
          const execution =
            'agentRef' in definition ? await service.definitions.processSnapshot(ctx, definition, c) : undefined;
          const tools = definition.tools.filter(
            (t) =>
              processAgentTools.includes(t) && (!execution || execution.definition.tools.some((name) => name === t)),
          );
          const sessionId = crypto.randomUUID();
          const snapshot = {
            ...config,
            runtime: {
              ...harnessOptionsSchema.parse(config.runtime ?? {}),
              delegation: false,
              mcp: [],
              extensions: [],
              skills: [],
              durationMs: definition.deadlineSeconds * 1000,
            },
            limits: { ...config.limits, turns: Math.min(config.limits.turns, definition.maxTurns) },
          };
          const goal = `${definition.goal}\n\nProcess activity input (untrusted data):\n${JSON.stringify(call.input)}`;
          if (Buffer.byteLength(goal) > 64000) throw new Error('Process agent input exceeds 64 KiB.');
          await c.query('INSERT INTO wa_sessions(workspace_id,id,created_by,title,client_key) VALUES($1,$2,$3,$4,$5)', [
            ctx.workspace.id,
            sessionId,
            ctx.user.id,
            `Process activity: ${context.nodeId}`.slice(0, 200),
            `process:${context.runId}:${context.nodeId}`,
          ]);
          await c.query(
            "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,actor_id,content,attachments) VALUES($1,$2,$3,1,'user',$4,$5,'[]')",
            [ctx.workspace.id, workId, sessionId, ctx.user.id, goal],
          );
          await c.query(
            `INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot,attachments,request_context,read_only,output_schema)
          VALUES($1,$2,$3,$4,'queued',$5,$6,$7,'[]',$8,true,$9)`,
            [
              ctx.workspace.id,
              workId,
              sessionId,
              ctx.user.id,
              goal,
              config.editVersion,
              snapshot,
              {
                processActivity: {
                  runId: context.runId,
                  nodeId: context.nodeId,
                  hash,
                  tools,
                  ...(execution ? { agentRef: execution.ref } : {}),
                },
                delegation:
                  'Read-only process activity. Return a result matching the output schema. Do not ask the user or propose workspace changes.',
              },
              definition.outputSchema,
            ],
          );
          if (execution) {
            await c.query('UPDATE wa_work_items SET execution_snapshot=$3 WHERE workspace_id=$1 AND id=$2', [
              ctx.workspace.id,
              workId,
              execution,
            ]);
            await c.query('UPDATE wa_sessions SET agent_id=$3 WHERE workspace_id=$1 AND id=$2', [
              ctx.workspace.id,
              sessionId,
              execution.ref.agentId,
            ]);
          }
          await service.enqueue(c, ctx.workspace.id, workId, `start:${workId}`);
          await service.activity(
            ctx.workspace.id,
            workId,
            'process_started',
            'Process activity dispatched to the workspace harness.',
            { runId: context.runId, nodeId: context.nodeId },
            c,
          );
          await service.control.audit(
            ctx,
            'agent.process_started',
            'agent_work_item',
            workId,
            { runId: context.runId, nodeId: context.nodeId },
            c,
          );
          return { workspace: ctx.workspace.id, sessionId };
        });
      },
      { name: `process.agent.prepare:${context.nodeId}`, retriesAllowed: false },
    );
    for (let poll = 0; poll <= Math.ceil(definition.deadlineSeconds / 2); poll++) {
      const result = await DBOS.runStep(
        async () => {
          const work = (
            await service.pool.query(
              'SELECT state,structured_result,error FROM wa_work_items WHERE workspace_id=$1 AND id=$2',
              [link.workspace, workId],
            )
          ).rows[0];
          if (!work) throw new Error('Process agent work item disappeared.');
          return work;
        },
        { name: `process.agent.observe:${context.nodeId}:${poll}`, retriesAllowed: true, maxAttempts: 3 },
      );
      if (terminal.includes(result.state)) {
        if (result.state !== 'completed')
          throw new Error(`Process agent ${result.state}: ${result.error ?? 'Inspect its Activity.'} [${workId}]`);
        const validated = validateStructured(definition.outputSchema, JSON.stringify(result.structured_result));
        if (!validated.valid) throw new Error(`Process agent result failed validation: ${validated.feedback}`);
        return { result: result.structured_result, agentWorkId: workId, agentSessionId: link.sessionId };
      }
      if (poll < Math.ceil(definition.deadlineSeconds / 2)) await DBOS.sleep(2000);
    }
    await DBOS.runStep(
      () => service.settle(link.workspace, workId, 'cancelled', 'The process activity deadline elapsed.'),
      { name: `process.agent.deadline:${context.nodeId}`, retriesAllowed: true, maxAttempts: 3 },
    );
    throw new Error(`Process agent deadline elapsed. Inspect Activity ${workId}.`);
  });
}
export async function reconcileProcessAgents(service: AgentService) {
  const rows = (
    await service.pool.query(
      `SELECT w.workspace_id,w.id FROM wa_work_items w JOIN studio_runs r ON r.workspace_id=w.workspace_id AND r.id=w.request_context->'processActivity'->>'runId'
    WHERE w.request_context ? 'processActivity' AND NOT(w.state=ANY($1::text[])) AND r.status IN ('cancelled','failed')`,
      [terminal],
    )
  ).rows;
  for (const row of rows)
    await service.settle(row.workspace_id, row.id, 'cancelled', 'The parent process run stopped.');
}
