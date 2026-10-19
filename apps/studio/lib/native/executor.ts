import type { AgentFlow, FlowExecutionInput, FlowNodeData, FlowRunEvent } from '../flows/types';
import { validateFlow } from '../flows/validation';
import { bind, type BindingContext } from './model';
export type Outcome = 'success' | 'error' | 'true' | 'false' | 'timeout';
export type OperationResult = { value: unknown; outcome?: Outcome; metadata?: { logs: string[]; revision: string } };
export type NativeContext = BindingContext & { runId: string; nodeId: string; executionId: string };

/** The outer graph is a DAG. Iteration/parallel nodes launch scoped child
 * executions, so a node definition can repeat without reusing an execution ID. */
export async function* executeNativeGraph(
  flow: AgentFlow,
  input: FlowExecutionInput,
  runId: string,
  execute: (node: FlowNodeData, context: NativeContext) => Promise<OperationResult>,
): AsyncGenerator<FlowRunEvent, unknown> {
  validateFlow(flow);
  const outputs: Record<string, unknown> = {};
  let variables: Record<string, unknown> = Object.fromEntries(
    Object.entries(flow._compiled?.variables ?? {}).map(([key, binding]) => [key, bind(binding, { input, outputs })]),
  );
  const outcomes = new Map<string, Outcome>();
  const entry = flow.nodes.find((node) => node.kind === 'trigger')!;
  const outgoing = (id: string) => flow.edges.filter((edge) => edge.source === id);
  function selected(id: string) {
    const edges = outgoing(id);
    const outcome = outcomes.get(id)!;
    return edges.filter((edge) => {
      const port = edge.condition || 'success';
      if (port === 'always') return outcome !== 'error';
      if (port === 'success' && outcome === 'timeout' && !edges.some((edge) => edge.condition === 'timeout'))
        return true;
      return port === outcome || (port === 'success' && ['true', 'false'].includes(outcome));
    });
  }
  function reachable() {
    const seen = new Set<string>();
    const queue = [entry.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const edges = outcomes.has(id) ? selected(id) : outgoing(id);
      queue.push(...edges.map((edge) => edge.target));
    }
    return seen;
  }
  const timestamp = () => new Date().toISOString();
  yield { type: 'run.started', runId, flowId: flow.id, timestamp: timestamp() };
  let returned: unknown = null;
  while (true) {
    const possible = reachable();
    const node = flow.nodes.find(
      (node) =>
        possible.has(node.id) &&
        !outcomes.has(node.id) &&
        flow.edges
          .filter((edge) => edge.target === node.id)
          .every((edge) => outcomes.has(edge.source) || !possible.has(edge.source)),
    );
    if (!node) break;
    const base = { runId, nodeId: node.id, nodeName: node.name, nodeKind: node.kind };
    yield { type: 'node.started', ...base, timestamp: timestamp() };
    const waiting = ['delay', 'receive', 'waitEvent', 'await', 'review'].includes(node.kind);
    if (waiting) {
      yield { type: 'node.waiting', ...base, instruction: `Waiting: ${node.name}`, timestamp: timestamp() };
      yield { type: 'run.waiting', runId, flowId: flow.id, nodeId: node.id, timestamp: timestamp() };
    }
    let result: OperationResult;
    try {
      result = await execute(node, {
        input,
        outputs,
        variables,
        item: input.variables?.item,
        state: input.variables?.state,
        runId,
        nodeId: node.id,
        executionId: `${runId}/${node.id}`,
        execution: { workflowID: runId, executionId: `${runId}/${node.id}` },
      });
      if (waiting) yield { type: 'run.resumed', runId, flowId: flow.id, nodeId: node.id, timestamp: timestamp() };
      outputs[node.id] = result.value ?? null;
      if (node.config.variableAssignment) {
        if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value))
          throw new Error('Set variables must produce an object.');
        variables = { ...variables, ...result.value };
      }
      outcomes.set(node.id, result.outcome ?? 'success');
      yield {
        type: 'node.completed',
        ...base,
        output: outputs[node.id],
        ...(result.metadata ? { metadata: result.metadata } : {}),
        timestamp: timestamp(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed.';
      yield { type: 'node.failed', ...base, error: message, timestamp: timestamp() };
      if (!outgoing(node.id).some((edge) => edge.condition === 'error')) throw error;
      outputs[node.id] = { error: message };
      outcomes.set(node.id, 'error');
    }
    if (node.kind === 'return' && outcomes.get(node.id) !== 'error') {
      returned = outputs[node.id];
      break;
    }
  }
  for (const node of flow.nodes)
    if (!outcomes.has(node.id))
      yield {
        type: 'node.skipped',
        runId,
        nodeId: node.id,
        reason: 'No executed path reached this node.',
        timestamp: timestamp(),
      };
  yield {
    type: 'run.completed',
    runId,
    flowId: flow.id,
    output: { result: returned, nodes: outputs },
    timestamp: timestamp(),
  };
  return returned;
}
