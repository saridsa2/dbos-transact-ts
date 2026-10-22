import { describe, expect, it } from 'vitest';
import { scopedExamples } from './examples';
import { refreshNodeConfigurationIssues, validateNodeConfiguration } from '../native/node-config';
import { compilePreview } from './preview';
import { compileAuthoringGraph } from './compiler';
import { bind } from '../native/model';
import { executeScopedGraph } from './scoped-executor';
import { isolatedCodeRunner } from '../../server/code/runner';
import type { FlowExecutionInput, FlowRunEvent } from '../flows/types';

const calculation = () => structuredClone(scopedExamples()[0].flow);
async function calculate(input: FlowExecutionInput) {
  const flow = calculation();
  flow.declarations![0].initial = { mode: 'fixed', value: 9 };
  const compiled = compileAuthoringGraph(flow);
  const events: FlowRunEvent[] = [];
  for await (const event of executeScopedGraph(compiled, input, 'variable-settings-test', async (node, context) => {
    if (node.kind === 'trigger') return { value: input };
    const operation = node.config.operation!;
    if (operation.kind === 'assign' || operation.kind === 'return') return { value: bind(operation.value, context) };
    if (operation.kind === 'step' && operation.handler === 'stackproc.code.v1') {
      const invocation = bind(operation.input, context) as {
        definition: Parameters<typeof isolatedCodeRunner.execute>[0];
        input: unknown;
      };
      return isolatedCodeRunner.execute(invocation.definition, invocation.input, context.variables ?? {});
    }
    throw new Error('Unexpected operation in calculation fixture');
  }))
    events.push(event);
  return events;
}

describe('variable settings and configuration updates', () => {
  it('accepts a declared writable target regardless of its label or initial value', () => {
    const flow = calculation();
    flow.declarations![0] = {
      ...flow.declarations![0],
      name: 'Changed label',
      schema: { type: 'integer' },
      initial: { mode: 'fixed', value: 9 },
    };
    expect(validateNodeConfiguration(flow.nodes[1], flow)).toEqual([]);
    expect(() => compilePreview(flow, flow.nodes[1])).not.toThrow();
  });
  it('clears stale target errors after allowing writes without mutating the old draft', () => {
    const flow = calculation();
    flow.declarations![0].writable = false;
    const blocked = refreshNodeConfigurationIssues(flow);
    expect(blocked[1].config.issues?.join()).toContain('read-only');
    flow.nodes = blocked;
    flow.declarations![0].writable = true;
    const refreshed = refreshNodeConfigurationIssues(flow);
    expect(refreshed[1].config.issues).toEqual([]);
    expect(blocked[1].config.issues?.join()).toContain('read-only');
  });
  it('distinguishes removed declarations from read-only declarations', () => {
    const flow = calculation();
    flow.declarations = [];
    expect(validateNodeConfiguration(flow.nodes[1], flow).join()).toContain("Variable 'factor' is not declared");
  });
  it('replaces initial 9 with run input 3 and returns 18, with the intermediate list ending in 9', async () => {
    const events = await calculate({ variables: { items: [1, 2, 3], factor: 3 } });
    expect(events.find((e) => e.type === 'node.completed' && e.nodeId === 'calculate')).toMatchObject({
      output: [3, 6, 9],
    });
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', output: { result: 18 } });
  });
  it('uses run input 9 to produce [9,18,27] and final result 54', async () => {
    const events = await calculate({ variables: { items: [1, 2, 3], factor: 9 } });
    expect(events.find((e) => e.type === 'node.completed' && e.nodeId === 'calculate')).toMatchObject({
      output: [9, 18, 27],
    });
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', output: { result: 54 } });
  });
});
