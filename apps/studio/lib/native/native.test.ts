import { describe, expect, it } from 'vitest';
import { nativeExamples, blankNativeGraph } from './examples';
import { bind, evaluate, literal, nodeBindings, operationSchema, output } from './model';
import { parseFlow, validateFlow } from '../flows/validation';
import { executeNativeGraph } from './executor';
import type { AgentFlow, FlowRunEvent } from '../flows/types';

describe('native graph contracts', () => {
  it('validates every example and embedded child graph', () => {
    for (const example of nativeExamples()) {
      validateFlow(parseFlow(example.flow));
      for (const child of Object.values(example.flow.definitions ?? {})) validateFlow(child);
    }
  });
  it('resolves nested bindings without treating literal JSON as references', () => {
    const context = { input: { variables: { ids: [7, 9] } }, outputs: { previous: { value: 3 } } };
    expect(
      bind(
        {
          source: 'object',
          fields: { id: { source: 'input', path: 'variables.ids.1' }, value: output('previous', 'value') },
        },
        context,
      ),
    ).toEqual({ id: 9, value: 3 });
    expect(nodeBindings({ kind: 'assign', value: literal({ source: 'node', nodeId: 'absent' }) })).toEqual([
      literal({ source: 'node', nodeId: 'absent' }),
    ]);
    expect(() => bind(output('absent'), context)).toThrow('not available');
    expect(() => bind({ source: 'input', path: 'constructor' }, context)).toThrow('Unsafe');
    expect(() => bind({ source: 'input', path: 'variables.missing' }, context)).toThrow('unavailable');
  });
  it('compares structured JSON independently of object key order', () => {
    expect(
      evaluate(
        { operator: 'eq', left: literal({ a: 1, b: 2 }), right: literal({ b: 2, a: 1 }) },
        { input: {}, outputs: {} },
      ),
    ).toBe(true);
    expect(
      evaluate({ operator: 'eq', left: literal(['a']), right: literal({ 0: 'a' }) }, { input: {}, outputs: {} }),
    ).toBe(false);
  });
  it('distinguishes empty arrays and objects', () => {
    expect(evaluate({ operator: 'eq', left: literal([]), right: literal({}) }, { input: {}, outputs: {} })).toBe(false);
  });
  it('rejects unbounded iteration, bad node kinds, drafts, cycles and downstream bindings', () => {
    expect(
      operationSchema.safeParse({
        kind: 'loop',
        workflowRef: 'body',
        initial: literal(0),
        while: { operator: 'truthy', left: literal(true) },
        maxIterations: 1001,
      }).success,
    ).toBe(false);
    const graph = blankNativeGraph();
    graph.nodes[1].config.operation = { kind: 'return', value: output('result') };
    expect(() => validateFlow(graph)).toThrow('upstream');
    graph.nodes[1].config.operation = { kind: 'assign', value: literal(1) };
    expect(() => parseFlow(graph)).toThrow('do not match');
    graph.nodes[1].config.operation = { kind: 'return', value: literal(1) };
    graph.nodes[1].config.operationDraft = '{';
    expect(() => parseFlow(graph)).toThrow('invalid operation');
    delete graph.nodes[1].config.operationDraft;
    graph.edges.push({ id: 'cycle', source: 'result', target: 'start' });
    expect(() => validateFlow(graph)).toThrow('Cycles');
  });
});

describe('native control flow', () => {
  async function trace(
    flow: AgentFlow,
    operation: (
      id: string,
    ) => Promise<{ value: unknown; outcome?: 'success' | 'error' | 'true' | 'false' | 'timeout' }>,
  ) {
    const events: FlowRunEvent[] = [];
    for await (const event of executeNativeGraph(flow, {}, 'execution', async (node, context) => {
      expect(context.executionId).toBe(`execution/${node.id}`);
      return operation(node.id);
    }))
      events.push(event);
    return events;
  }
  it('routes timeout directly to compensation and prunes the paid branch', async () => {
    const graph = nativeExamples().find((example) => example.id === 'checkout')!.flow;
    const events = await trace(graph, async (id) => ({
      value: id === 'failure' ? { status: 'cancelled' } : null,
      outcome: id === 'receive' ? 'timeout' : 'success',
    }));
    const completed = events.flatMap((event) => (event.type === 'node.completed' ? [event.nodeId] : []));
    expect(completed).toEqual(['start', 'reserve', 'payment', 'receive', 'restore', 'failure']);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', output: { result: { status: 'cancelled' } } });
    expect(events.filter((event) => event.type === 'run.waiting')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run.resumed')).toHaveLength(1);
  });
  it('routes a failed operation through the explicit error port', async () => {
    const graph = nativeExamples().find((example) => example.id === 'checkout')!.flow;
    const events = await trace(graph, async (id) => {
      if (id === 'reserve') throw new Error('out of stock');
      return { value: id === 'unavailable' ? 'out-of-stock' : null };
    });
    expect(events.some((event) => event.type === 'node.failed' && event.nodeId === 'reserve')).toBe(true);
    expect(events.some((event) => event.type === 'node.completed' && event.nodeId === 'reserve')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', output: { result: 'out-of-stock' } });
  });
  it('fails unhandled errors instead of claiming a successful result', async () => {
    const graph = blankNativeGraph();
    await expect(
      trace(graph, async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
  });
});
