import { describe, expect, it } from 'vitest';
import { nodeEditorContract, editorIssueLocation } from './editor-contract';
import { nodeConfigDefinitions } from '../native/node-config';
import type { FlowNodeData } from '../flows/types';
const node = (kind: FlowNodeData['kind'], config: FlowNodeData['config'] = {}): FlowNodeData => ({
  id: 'test',
  name: 'Test',
  kind,
  config,
  position: { x: 0, y: 0 },
});

describe('atomic node editor ownership', () => {
  it('assigns every native operation field exactly once without changing runtime definitions', () => {
    for (const [kind, definition] of Object.entries(nodeConfigDefinitions)) {
      const n = node(kind as FlowNodeData['kind'], { operation: { kind } as any });
      const before = JSON.stringify(n);
      const contract = nodeEditorContract(n);
      const fields = Object.values(contract.sections).flatMap((pages) => pages.flatMap((page) => page.fields ?? []));
      expect([...fields].sort(), kind).toEqual(definition.fields.map((f) => f.key).sort());
      expect(new Set(fields).size, kind).toBe(fields.length);
      expect(JSON.stringify(n)).toBe(before);
      expect(Object.values(contract.sections).every((pages) => pages.length > 0)).toBe(true);
    }
  });
  it('keeps receive behavior in Process and routes timeout diagnostics there', () => {
    const n = node('receive', {
      operation: { kind: 'receive', topic: 'review', timeoutSeconds: { source: 'literal', value: 60 } },
    });
    expect(nodeEditorContract(n).sections.input[0].renderer).toBe('empty');
    expect(editorIssueLocation(n, 'config.parameters.timeoutSeconds: Must be positive')).toEqual({
      section: 'process',
      page: 'operation',
    });
  });
  it('distinguishes controls, workflow invocation and legacy approval composition', () => {
    expect(nodeEditorContract(node('foreach')).classification).toBe('control');
    expect(nodeEditorContract(node('workflow')).classification).toBe('invocation');
    expect(nodeEditorContract(node('review')).classification).toBe('legacy-composition');
  });
  it('owns code input, source, limits, output contract and retry diagnostics separately', () => {
    const n = node('code');
    expect(editorIssueLocation(n, 'config.parameters.input: Invalid reference')).toEqual({
      section: 'input',
      page: 'values',
    });
    expect(editorIssueLocation(n, 'config.code.source: Invalid code')).toEqual({ section: 'process', page: 'editor' });
    expect(editorIssueLocation(n, 'config.code.limits.timeoutMS: Too large')).toEqual({
      section: 'process',
      page: 'limits',
    });
    expect(editorIssueLocation(n, 'config.ports.output.schema: Invalid schema')).toEqual({
      section: 'output',
      page: 'output-contract',
    });
    expect(editorIssueLocation(n, 'config.execution.maxAttempts: Too many')).toEqual({
      section: 'process',
      page: 'execution',
    });
  });
  it('puts freeform construction in Process without repeated schema editing', () => {
    const n = node('construct');
    const contract = nodeEditorContract(n);
    expect(contract.sections.process[0].renderer).toBe('authoring');
    expect(contract.sections.output[0].renderer).toBe('result');
    expect(editorIssueLocation(n, 'config.parameters.value.fields.tags.items.0: Invalid expression')).toEqual({
      section: 'process',
      page: 'values',
    });
  });
});
