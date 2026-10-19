import { createNativeRuntime } from './native-runtime';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { AgentFlow, FlowExecutionInput, FlowRunEvent } from '../lib/flows/types';
import { executeFlow } from '../lib/flows/executor';
import { validateFlow } from '../lib/flows/validation';
import { NodeRegistry } from './registry';
import { StudioStore } from './store';

export type ApprovalDecision = { approved: boolean; action: string; note: string };

/** One registered interpreter, with the immutable graph snapshot as a durable
 * argument. Recovery replays traversal and reuses completed node results. */
export function createRuntime(store: StudioStore, registry: NodeRegistry) {
  const native = createNativeRuntime(store, registry);
  const runGraph = DBOS.registerWorkflow(
    async (flow: AgentFlow, input: FlowExecutionInput, runId: string) => {
      let sequence = 0;
      const emit = async (event: FlowRunEvent) => {
        const index = sequence++;
        return DBOS.runStep(() => store.appendEvent(runId, index, event), {
          name: `event:${index}:${event.type}`,
          retriesAllowed: true,
          maxAttempts: 5,
        });
      };
      try {
        let output: Record<string, unknown> = {};
        for await (const event of executeFlow(flow, input, {
          runId,
          executeNode: (node, context) =>
            DBOS.runStep(() => registry.execute(node, { ...context, signal: DBOS.stepStatus?.timeoutSignal }), {
              name: `node:${node.id}`,
              retriesAllowed: (node.config.execution?.maxAttempts ?? 1) > 1,
              maxAttempts: node.config.execution?.maxAttempts ?? 1,
              intervalSeconds: node.config.execution?.intervalSeconds ?? 1,
              timeoutMS: node.config.execution?.timeoutMS ?? 60000,
            }),
          beforeApproval: (node) =>
            DBOS.runStep(() => store.openApproval(runId, node), {
              name: `approval:${node.id}`,
              retriesAllowed: true,
              maxAttempts: 5,
            }),
          approve: async (node) => {
            // DBOS.recv is called at workflow level, outside a step. A restart
            // reuses the persisted wait/message rather than auto-approving.
            let decision: ApprovalDecision | null = null;
            while (!decision)
              decision = await DBOS.recv<ApprovalDecision>(`approval:${node.id}`, { timeoutSeconds: 86400 });
            return decision;
          },
        })) {
          await emit(event);
          if (event.type === 'run.completed') output = event.output;
        }
        return output;
      } catch (error) {
        await emit({
          type: 'run.failed',
          runId,
          flowId: flow.id,
          error: error instanceof Error ? error.message : 'Run failed.',
          timestamp: new Date().toISOString(),
        });
        throw error;
      }
    },
    { name: 'studio.executeGraph.v1' },
  );

  async function dispatch(runId: string, flow: AgentFlow, input: FlowExecutionInput) {
    const handle = await DBOS.startWorkflow(runGraph, { workflowID: runId })(flow, input, runId);
    void handle.getResult().catch(() => {
      /* Persisted by the interpreter; API reads run state. */
    });
    return handle;
  }
  return {
    runGraph,
    native,
    async start(flow: AgentFlow, input: FlowExecutionInput = {}, actorId?: string) {
      if (flow.schemaVersion === 2) return native.start(flow, input, actorId);
      validateFlow(flow);
      const runId = crypto.randomUUID();
      await store.createRun(runId, flow, input, undefined, undefined, actorId);
      // Queued runs are durable in the application DB. If dispatch is interrupted,
      // startup/background reconciliation submits the same workflow ID again.
      await dispatch(runId, flow, input);
      return runId;
    },
    async reconcile() {
      for (const run of await store.queuedRuns()) {
        if (run.graph.schemaVersion === 2) await native.dispatch(run.id, run.graph, run.input);
        else await dispatch(run.id, run.graph, run.input);
      }
      for (const approval of await store.outbox()) {
        await DBOS.send(
          approval.run_id,
          approval.decision,
          `approval:${approval.node_id}`,
          `studio-approval:${approval.id}`,
        );
        await store.markSent(approval.id);
      }
    },
  };
}
