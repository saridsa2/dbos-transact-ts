import type { AgentFlow, FlowExecutionInput, FlowNodeData, FlowRunEvent } from '../flows/types';
import { assertValue, assertUpdates, ports, validatePort, type ScopeSnapshot } from './contracts';
import { validateFlow } from '../flows/validation';
import { bind, type BindingContext } from '../native/model';
export type Outcome = 'success' | 'error' | 'true' | 'false' | 'timeout';
export type OperationResult = { value: unknown; outcome?: Outcome; metadata?: { logs: string[]; revision: string } };
export type NativeContext = BindingContext & { runId: string; nodeId: string; executionId: string };

/** The outer graph is a DAG. Iteration/parallel nodes launch scoped child
 * executions, so a node definition can repeat without reusing an execution ID. */
export async function* executeScopedGraph(
  flow: AgentFlow,
  input: FlowExecutionInput,
  runId: string,
  execute: (node: FlowNodeData, context: NativeContext) => Promise<OperationResult>,
): AsyncGenerator<FlowRunEvent, unknown> {
  validateFlow(flow);
  const outputs: Record<string, unknown> = {};
  const initial: Record<string, unknown> = Object.fromEntries(
    Object.entries(flow._compiled?.variables ?? {}).map(([key, binding]) => [key, bind(binding, { input, outputs })]),
  );
  for (const d of flow.declarations ?? []) assertValue(d.schema, initial[d.id], `Initial variable ${d.name}`);
  const states = new Map<string, Record<string, unknown>>();
  const inherited = input._scope?.captures ?? {};
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
    const predecessors = flow.edges
      .filter((e) => e.target === node.id && outcomes.has(e.source) && selected(e.source).some((s) => s.id === e.id))
      .map((e) => e.source);
    // A Merge starts with the last common predecessor snapshot; branch-local writes are never implicitly merged.
    function ancestors(id: string): Set<string> {
      const seen = new Set<string>([id]);
      const pending = [id];
      while (pending.length) {
        const t = pending.pop()!;
        for (const e of flow.edges)
          if (e.target === t && !seen.has(e.source) && states.has(e.source)) {
            seen.add(e.source);
            pending.push(e.source);
          }
      }
      return seen;
    }
    let before: Record<string, unknown> = initial;
    if (predecessors.length === 1) before = states.get(predecessors[0]) ?? initial;
    else if (predecessors.length > 1) {
      const all = predecessors.map(ancestors);
      const common = [...all[0]].filter((id) => all.every((a) => a.has(id)));
      const last = common.sort((a, b) => (ancestors(a).has(b) ? -1 : ancestors(b).has(a) ? 1 : 0))[0];
      before = last ? (states.get(last) ?? initial) : initial;
    }
    let variables = structuredClone({ ...inherited, ...before });
    const nodeInput =
      predecessors.length === 1
        ? outputs[predecessors[0]]
        : predecessors.length
          ? Object.fromEntries(predecessors.filter((id) => Object.hasOwn(outputs, id)).map((id) => [id, outputs[id]]))
          : input;
    const available = new Set(predecessors.flatMap((id) => [...ancestors(id)]));
    const visibleOutputs = Object.fromEntries(Object.entries(outputs).filter(([id]) => available.has(id)));
    const publicInput = {
      ...(input.userInput !== undefined ? { userInput: input.userInput } : {}),
      variables: input.variables ?? {},
    };
    function freeze(value: unknown) {
      if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
      }
      return value;
    }
    freeze(variables);
    const context: NativeContext = {
      input: publicInput,
      outputs: visibleOutputs,
      variables,
      nodeInput,
      item: input._scope?.item ?? input.variables?.item,
      index: input._scope?.index ?? (input.variables?.index as number | undefined),
      state: input.variables?.state,
      runId,
      nodeId: node.id,
      executionId: `${runId}/${node.id}`,
      execution: { workflowID: runId, executionId: `${runId}/${node.id}` },
    };
    let result: OperationResult;
    try {
      const declared = ports(node);

      const operation = node.config.operation;
      if (operation && 'input' in operation && operation.kind !== 'step')
        validatePort(declared.input, bind(operation.input, context), `Node ${node.name} parameters`);
      result = await execute(node, context);
      validatePort(declared.output, result.value, `Node ${node.name} output`);
      if (waiting) yield { type: 'run.resumed', runId, flowId: flow.id, nodeId: node.id, timestamp: timestamp() };
      if (result.value !== undefined) outputs[node.id] = result.value;
      if (node.config.variableAssignment) {
        if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value))
          throw new Error('Set variables must produce an object.');
        variables = { ...variables, ...assertUpdates(flow, result.value) };
      }
      if (node.config.compiledUpdates) {
        const updates = Object.fromEntries(
          Object.entries(node.config.compiledUpdates).map(([id, b]) => [id, bind(b, context)]),
        );
        variables = { ...variables, ...assertUpdates(flow, updates) };
      }
      states.set(
        node.id,
        Object.fromEntries(
          Object.entries(variables).filter(([id]) => (flow.declarations ?? []).some((d) => d.id === id)),
        ),
      );
      outcomes.set(node.id, result.outcome ?? 'success');
      yield {
        type: 'node.completed',
        ...base,
        output: result.value === undefined ? null : result.value,
        presence: result.value === undefined ? 'absent' : 'present',
        scope: {
          id: runId,
          variables: context.variables ?? {},
          nodeInput: context.nodeInput,
          item: context.item,
          index: context.index,
        },
        ...(result.metadata ? { metadata: result.metadata } : {}),
        timestamp: timestamp(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed.';
      yield { type: 'node.failed', ...base, error: message, timestamp: timestamp() };
      if (!outgoing(node.id).some((edge) => edge.condition === 'error')) throw error;
      outputs[node.id] = { error: message };
      states.set(node.id, before);
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
