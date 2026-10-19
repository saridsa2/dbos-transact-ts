import { describe, expect, it } from 'vitest';
import { executeFlow } from './executor';
import type { AgentFlow, FlowNodeData, FlowNodeKind, FlowRunEvent } from './types';
import { createStarterFlow } from './templates';
import { validateFlow } from './validation';
import { NodeRegistry } from '../../server/registry';

function node(id: string, kind: FlowNodeKind = 'prompt'): FlowNodeData {
  return { id, kind, name: id, config: {}, position: { x: 0, y: 0 } };
}
function graph(nodes: FlowNodeData[], edges: [string, string, ('true' | 'false' | 'always')?][]): AgentFlow {
  return {
    id: 'graph',
    name: 'Graph',
    nodes,
    edges: edges.map(([source, target, condition], i) => ({ id: `edge-${i}`, source, target, condition })),
  };
}
async function collect(flow: AgentFlow, approve = true) {
  const registry = new NodeRegistry();
  const events: FlowRunEvent[] = [];
  for await (const event of executeFlow(
    flow,
    { userInput: 'Request' },
    {
      runId: 'run',
      executeNode: (node, context) => registry.execute(node, context),
      approve: async () => ({ approved: approve }),
    },
  ))
    events.push(event);
  return events;
}
const completed = (events: FlowRunEvent[]) =>
  events.flatMap((event) => (event.type === 'node.completed' ? [event.nodeId] : []));

describe('StackProc graph traversal port', () => {
  it('preserves approved/rejected branch selection and waits before continuing', async () => {
    for (const decision of [true, false]) {
      const events = await collect(createStarterFlow(), decision);
      expect(completed(events)).toContain(decision ? 'output-approved' : 'output-rejected');
      expect(completed(events)).not.toContain(decision ? 'output-rejected' : 'output-approved');
      expect(events.findIndex((event) => event.type === 'run.waiting')).toBeLessThan(
        events.findIndex((event) => event.type === 'run.resumed'),
      );
      expect(events.at(-1)?.type).toBe('run.completed');
    }
  });
  it('waits for both parents before executing a diamond join', async () => {
    const flow = graph(
      [node('start', 'trigger'), node('a'), node('b'), node('join'), node('out', 'output')],
      [
        ['start', 'a'],
        ['start', 'b'],
        ['a', 'join'],
        ['b', 'join'],
        ['join', 'out'],
      ],
    );
    expect(completed(await collect(flow))).toEqual(['start', 'a', 'b', 'join', 'out']);
  });
  it('executes a rejoin after pruning an untaken condition branch', async () => {
    const condition = node('condition', 'condition');
    condition.config.expression = 'false';
    const flow = graph(
      [node('start', 'trigger'), condition, node('yes'), node('no'), node('join')],
      [
        ['start', 'condition'],
        ['condition', 'yes', 'true'],
        ['condition', 'no', 'false'],
        ['yes', 'join'],
        ['no', 'join'],
      ],
    );
    expect(completed(await collect(flow))).toEqual(['start', 'condition', 'no', 'join']);
  });
  it('rechecks joins when a different branch shrinks reachability', async () => {
    const c1 = node('c1', 'condition');
    c1.config.expression = 'true';
    const c2 = node('c2', 'condition');
    c2.config.expression = 'false';
    const flow = graph(
      [node('start', 'trigger'), c1, c2, node('a'), node('dead'), node('other'), node('join')],
      [
        ['start', 'c1'],
        ['start', 'c2'],
        ['c1', 'a', 'true'],
        ['c2', 'dead', 'true'],
        ['c2', 'other', 'false'],
        ['a', 'join'],
        ['dead', 'join'],
      ],
    );
    const done = completed(await collect(flow));
    expect(done).toContain('join');
    expect(done).not.toContain('dead');
    expect(done.filter((id) => id === 'join')).toHaveLength(1);
  });
  it('does not auto-approve when an approval adapter is missing', async () => {
    const events: FlowRunEvent[] = [];
    const registry = new NodeRegistry();
    await expect(async () => {
      for await (const event of executeFlow(
        createStarterFlow(),
        {},
        { runId: 'run', executeNode: (n, c) => registry.execute(n, c) },
      ))
        events.push(event);
    }).rejects.toThrow('No approval adapter');
    expect(events.some((event) => event.type === 'node.failed')).toBe(true);
    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
  });
  it('rejects cycles, duplicate nodes, and dangling edges', () => {
    expect(() =>
      validateFlow(
        graph(
          [node('a'), node('b')],
          [
            ['a', 'b'],
            ['b', 'a'],
          ],
        ),
      ),
    ).toThrow('Cycles');
    expect(() => validateFlow(graph([node('a'), node('a')], []))).toThrow('unique');
    expect(() => validateFlow(graph([node('a')], [['a', 'missing']]))).toThrow('missing');
  });
});

describe('domain adapter boundary', () => {
  it('runs a registered domain tool with the inherited input context', async () => {
    const registry = new NodeRegistry();
    registry.registerTool('domain.lookup', 'Domain lookup', async (_node, context) => ({
      reference: context.input.variables?.reference,
    }));
    const tool = node('lookup', 'tool');
    tool.config.toolId = 'domain.lookup';
    expect(await registry.execute(tool, { input: { variables: { reference: 'abc' } }, outputs: {} })).toEqual({
      reference: 'abc',
    });
    expect(registry.resources().tools.some((tool) => tool.id === 'domain.lookup')).toBe(true);
  });
  it('fails clearly for unconfigured model and tool nodes', async () => {
    const registry = new NodeRegistry();
    const context = { input: {}, outputs: {} };
    await expect(registry.execute(node('model', 'llm'), context)).rejects.toThrow('No model adapter');
    await expect(registry.execute(node('tool', 'tool'), context)).rejects.toThrow('not registered');
  });
});
