import { describe, it, expect } from 'vitest';
import { defaultOperation } from './catalog';
import { nativeKinds } from './model';
import { blankNativeGraph, nativeExamples } from './examples';
import {
  configTabs,
  nodeConfigDefinitions,
  previewNodeInputs,
  upstreamNodes,
  validateNodeConfiguration,
} from './node-config';
import type { FlowNodeData } from '../flows/types';
describe('node configuration contract', () => {
  it('covers every executor kind and preserves each default operation field', () => {
    for (const kind of nativeKinds) {
      const op = defaultOperation(kind);
      const def = nodeConfigDefinitions[kind];
      expect(def).toBeDefined();
      for (const key of Object.keys(op).filter((k) => k !== 'kind'))
        expect(def.fields.map((f) => f.key)).toContain(key);
    }
  });
  it('validates all source-derived example nodes without changing their persisted config', () => {
    for (const example of nativeExamples()) {
      const flow = example.flow;
      for (const node of flow.nodes)
        expect(validateNodeConfiguration(node, flow), `${example.title}: ${node.name}`).toEqual([]);
    }
  });
  it('shows only effective per-node tabs and runtime execution policy', () => {
    const node = (kind: (typeof nativeKinds)[number]) =>
      ({
        id: 'n',
        name: 'Node',
        kind,
        position: { x: 0, y: 0 },
        config: { operation: defaultOperation(kind) },
      }) as FlowNodeData;
    expect(configTabs(node('step')).map((t) => t.id)).toEqual([
      'general',
      'operation',
      'inputs',
      'execution',
      'advanced',
    ]);
    expect(configTabs(node('transaction')).map((t) => t.id)).not.toContain('execution');
    expect(configTabs(node('decision')).find((t) => t.id === 'operation')?.label).toBe('Conditions');
  });
  it('finds only true upstream nodes and rejects downstream references', () => {
    const flow = blankNativeGraph();
    const a = flow.nodes[0];
    const b = {
      id: 'b',
      name: 'Map',
      kind: 'assign',
      position: { x: 0, y: 0 },
      config: { operation: { kind: 'assign', value: { source: 'node', nodeId: 'downstream' } } },
    } as FlowNodeData;
    flow.nodes.push(b, { ...b, id: 'downstream', config: { operation: defaultOperation('return') }, kind: 'return' });
    flow.edges = [
      { id: '1', source: a.id, target: 'b' },
      { id: '2', source: 'b', target: 'downstream' },
    ];
    expect(upstreamNodes(flow, 'b').map((n) => n.id)).toEqual([a.id]);
    expect(validateNodeConfiguration(b, flow).join()).toContain('upstream');
  });
  it('previews binding values without running operations and reports unavailable context', () => {
    const node = {
      id: 'n',
      name: 'Step',
      kind: 'step',
      position: { x: 0, y: 0 },
      config: {
        operation: {
          kind: 'step',
          handler: 'no-network-call',
          input: {
            source: 'object',
            fields: { x: { source: 'input', path: 'variables.value' }, upstream: { source: 'node', nodeId: 'a' } },
          },
        },
      },
    } as FlowNodeData;
    expect(previewNodeInputs(node, { variables: { value: 3 } }, { a: { ok: true } })).toEqual({
      kind: 'step',
      handler: 'no-network-call',
      input: { x: 3, upstream: { ok: true } },
    });
    expect(() => previewNodeInputs(node, { variables: {} }, {})).toThrow();
    node.config.operation = { kind: 'assign', value: { source: 'state' } };
    expect(() => previewNodeInputs(node, {}, {})).toThrow('runtime');
  });
  it('rejects invalid execution policy, broken drafts, and invalid literal duration', () => {
    const flow = blankNativeGraph();
    const node = {
      ...flow.nodes[0],
      kind: 'delay',
      config: {
        operation: { kind: 'delay', durationMS: { source: 'literal', value: -1 } },
        operationDraft: '{',
        execution: { maxAttempts: 0 },
      },
    } as FlowNodeData;
    expect(validateNodeConfiguration(node, flow).join()).toMatch(/maxAttempts/);
    expect(validateNodeConfiguration(node, flow).join()).toMatch(/Advanced/);
    expect(validateNodeConfiguration(node, flow).join()).toMatch(/non-negative/);
  });
});
