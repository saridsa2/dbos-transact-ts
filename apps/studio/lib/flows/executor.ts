// Ported from StackProc's executeFlow traversal. Keep branch pruning and join readiness
// independent of the runtime. DBOS supplies checkpointed node/approval adapters.
import type { AgentFlow, FlowExecutionInput, FlowNodeData, FlowRunEvent } from './types';
import { validateFlow } from './validation';
export type ExecutionContext = {
  input: FlowExecutionInput;
  outputs: Record<string, unknown>;
  signal?: AbortSignal;
  deliverable?: { title: string; content: string };
};
export type NodeExecutor = (node: FlowNodeData, context: ExecutionContext) => Promise<unknown>;
export async function* executeFlow(
  flow: AgentFlow,
  input: FlowExecutionInput = {},
  options: {
    runId: string;
    executeNode: NodeExecutor;
    approve?: NodeExecutor;
    beforeApproval?: NodeExecutor;
    resume?: { outputs: Record<string, unknown>; resolvedNode: { nodeId: string; output: unknown } };
  },
): AsyncGenerator<FlowRunEvent> {
  validateFlow(flow);
  const runId = options.runId;
  const context: ExecutionContext = { input, outputs: options.resume ? { ...options.resume.outputs } : {} };
  yield { type: 'run.started', runId, flowId: flow.id, timestamp: new Date().toISOString() };
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const incomingCount = new Map<string, number>();
  for (const node of flow.nodes) incomingCount.set(node.id, 0);
  for (const edge of flow.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const completed = new Set<string>(options.resume ? Object.keys(options.resume.outputs) : []);

  const queue = options.resume
    ? computeResumeFrontier(flow, nodesById, completed, context.outputs)
    : flow.nodes
        .filter((node) => node.kind === 'trigger' || (incomingCount.get(node.id) ?? 0) === 0)
        .map((node) => node.id);
  const queued = new Set(queue);

  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || completed.has(nodeId)) continue;

    const node = nodesById.get(nodeId);
    if (!node) continue;

    yield {
      type: 'node.started',
      runId,
      nodeId: node.id,
      nodeName: node.name,
      nodeKind: node.kind,
      timestamp: new Date().toISOString(),
    };

    let output: unknown;
    try {
      if (node.kind === 'approval') {
        await options.beforeApproval?.(node, context);
        yield {
          type: 'node.waiting',
          runId,
          nodeId: node.id,
          nodeName: node.name,
          nodeKind: node.kind,
          instruction: node.config.approvalMessage || node.name,
          timestamp: new Date().toISOString(),
        };
        yield { type: 'run.waiting', runId, flowId: flow.id, nodeId: node.id, timestamp: new Date().toISOString() };
        if (!options.approve) throw new Error('No approval adapter is configured.');
        output = await options.approve(node, context);
        yield { type: 'run.resumed', runId, flowId: flow.id, nodeId: node.id, timestamp: new Date().toISOString() };
      } else {
        output = await options.executeNode(node, context);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Node execution failed.';
      yield {
        type: 'node.failed',
        runId,
        nodeId: node.id,
        nodeName: node.name,
        nodeKind: node.kind,
        error: message,
        timestamp: new Date().toISOString(),
      };
      throw error;
    }
    context.outputs[node.id] = output;
    completed.add(node.id);

    yield {
      type: 'node.completed',
      runId,
      nodeId: node.id,
      nodeName: node.name,
      nodeKind: node.kind,
      output,
      timestamp: new Date().toISOString(),
    };

    const potentiallyReachable = computePotentiallyReachable(flow, nodesById, context.outputs, completed);

    for (const edge of nextEdges(flow, node, output)) {
      const target = nodesById.get(edge.target);
      if (!target || completed.has(target.id) || queued.has(target.id)) continue;

      const dependencies = dependenciesOf(flow, target.id);
      const ready = dependencies.every(
        (dependencyId) => completed.has(dependencyId) || !potentiallyReachable.has(dependencyId),
      );
      if (ready || node.kind === 'condition') {
        queue.push(target.id);
        queued.add(target.id);
      }
    }

    // A completed node can shrink `potentiallyReachable` for branches that have
    // nothing to do with its own successors (e.g. a sibling condition resolving
    // and pruning its untaken edge). That can newly satisfy the readiness of some
    // OTHER join further downstream that this node never points to directly.
    // Re-sweep every not-yet-completed, not-yet-queued node against the SAME
    // freshly computed `potentiallyReachable` set so those joins aren't left to
    // rot as node.skipped. Nodes on dead branches stay untouched here (they're
    // not potentiallyReachable) so the final node.skipped sweep still catches them.
    for (const candidate of flow.nodes) {
      if (completed.has(candidate.id) || queued.has(candidate.id)) continue;
      if (!potentiallyReachable.has(candidate.id)) continue;

      const dependencies = dependenciesOf(flow, candidate.id);
      const ready = dependencies.every(
        (dependencyId) => completed.has(dependencyId) || !potentiallyReachable.has(dependencyId),
      );
      if (ready) {
        queue.push(candidate.id);
        queued.add(candidate.id);
      }
    }
  }

  const skippedNodes = flow.nodes.filter((node) => !completed.has(node.id));
  for (const node of skippedNodes) {
    yield {
      type: 'node.skipped',
      runId,
      nodeId: node.id,
      reason: 'No executable path reached this node.',
      timestamp: new Date().toISOString(),
    };
  }

  yield {
    type: 'run.completed',
    runId,
    flowId: flow.id,
    output: context.outputs,
    deliverable: context.deliverable,
    timestamp: new Date().toISOString(),
  };
}

function dependenciesOf(flow: AgentFlow, nodeId: string) {
  return flow.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
}

/**
 * Replays the primary traversal (BFS from the trigger/zero-incoming start set,
 * following only taken edges) over a checkpoint's completed-node set to figure
 * out which nodes should be queued when resuming a paused run.
 *
 * Nodes that were never reached via a *taken* edge (e.g. the untaken branch of
 * a condition) are intentionally excluded here — they fall out as node.skipped
 * at the end of the run, exactly as they would in a fresh, uninterrupted run.
 */
function computeResumeFrontier(
  flow: AgentFlow,
  nodesById: Map<string, FlowNodeData>,
  completed: Set<string>,
  outputs: Record<string, unknown>,
): string[] {
  const startIds = flow.nodes
    .filter((node) => node.kind === 'trigger' || dependenciesOf(flow, node.id).length === 0)
    .map((node) => node.id);

  const visited = new Set<string>();
  const candidates = new Set<string>();
  const bfsQueue: string[] = [...startIds];

  while (bfsQueue.length) {
    const nodeId = bfsQueue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) continue;

    if (completed.has(nodeId)) {
      for (const edge of nextEdges(flow, node, outputs[nodeId])) {
        if (!visited.has(edge.target)) bfsQueue.push(edge.target);
      }
    } else {
      candidates.add(nodeId);
    }
  }

  const potentiallyReachable = computePotentiallyReachable(flow, nodesById, outputs, completed);

  return Array.from(candidates).filter((nodeId) => {
    const dependencies = dependenciesOf(flow, nodeId);
    return dependencies.every((dependencyId) => completed.has(dependencyId) || !potentiallyReachable.has(dependencyId));
  });
}

/**
 * Computes the set of nodes that might still execute given the current completion
 * state: everything reachable from the trigger/zero-incoming start set, where a
 * COMPLETED condition only propagates through the edges it actually took (per its
 * recorded output), while an UNCOMPLETED condition and every other node kind
 * propagate through all of their outgoing edges (both branches, or the single
 * successor set, are still structurally possible).
 *
 * A dependency that is NOT in this set can never complete -- e.g. the untaken
 * branch's tail after a condition has resolved -- so callers treat "completed OR
 * not potentially reachable" as satisfied when checking whether a join/rejoin
 * node is ready to run. This is what lets rejoin nodes (both branch tails feed a
 * shared successor) proceed once the taken branch finishes, instead of waiting
 * forever on a branch that will never execute.
 */
function computePotentiallyReachable(
  flow: AgentFlow,
  nodesById: Map<string, FlowNodeData>,
  outputs: Record<string, unknown>,
  completed: Set<string>,
): Set<string> {
  const startIds = flow.nodes
    .filter((node) => node.kind === 'trigger' || dependenciesOf(flow, node.id).length === 0)
    .map((node) => node.id);

  const visited = new Set<string>();
  const bfsQueue: string[] = [...startIds];

  while (bfsQueue.length) {
    const nodeId = bfsQueue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) continue;

    // Approval nodes branch on `output.approved` the same way a condition
    // branches on its raw output (see nextEdges below) -- a completed
    // approval only propagates through its taken (approved/rejected) edges,
    // same as a completed condition.
    const edgesToFollow =
      (node.kind === 'condition' || node.kind === 'approval') && completed.has(nodeId)
        ? nextEdges(flow, node, outputs[nodeId])
        : flow.edges.filter((edge) => edge.source === nodeId);

    for (const edge of edgesToFollow) {
      if (!visited.has(edge.target)) bfsQueue.push(edge.target);
    }
  }

  return visited;
}

function nextEdges(flow: AgentFlow, node: FlowNodeData, output: unknown) {
  const outgoing = flow.edges.filter((edge) => edge.source === node.id);

  if (node.kind === 'condition') {
    const condition = Boolean(output);
    return outgoing.filter((edge) => {
      if (!edge.condition || edge.condition === 'always') return true;
      return condition ? edge.condition === 'true' : edge.condition === 'false';
    });
  }

  if (node.kind === 'approval') {
    // An approval branches on `output.approved` like a condition branches on
    // its boolean output, EXCEPT unlabeled edges are NOT an unconditional
    // "always" pass-through here: they're the approval ("true") path, same
    // as an edge explicitly labeled "true". Only a literal "always" label
    // bypasses the approve/reject branch; only "false" is the rejection
    // path. This is what lets a rejected approval with no "false" edge
    // leave its (unlabeled) downstream unreachable -> node.skipped, instead
    // of always continuing regardless of the decision.
    const approved = Boolean((output as { approved?: unknown } | null | undefined)?.approved);
    return outgoing.filter((edge) => {
      if (edge.condition === 'always') return true;
      if (edge.condition === 'false') return !approved;
      return approved; // unlabeled or "true"
    });
  }

  return outgoing;
}
