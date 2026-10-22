import { describe, it, expect } from 'vitest';
import { toolNames } from './contracts';
import { resolveToolOutput, toolOutputDefinitions } from './tool-outputs';
const empty = { schemaVersion: 1, description: '', entities: [], relationships: [] };
describe('specific tool output bindings', () => {
  it('binds every registered tool to a named renderer and output schema', () =>
    expect(Object.keys(toolOutputDefinitions).sort()).toEqual([...toolNames].sort()));
  it('keeps mismatched and unknown tool results explicit instead of inferring by shape', () => {
    expect(resolveToolOutput('ontology_validate_v1', { knowledge: [], workflows: [] }).state).toBe('invalid');
    expect(resolveToolOutput('invented_tool', { issues: [] }).state).toBe('unsupported');
    expect(resolveToolOutput('artifact_read_v1', { error: 'Not found' })).toEqual({
      state: 'error',
      message: 'Not found',
    });
  });
  it('validates artifact kind against its content', () => {
    const result = {
      artifact: { id: 'domain', name: 'Domain', kind: 'ontology', revisionId: 'r1', editVersion: 1 },
      revision: { id: 'r1', reviewed: false, content: empty },
    };
    expect(resolveToolOutput('artifact_read_v1', result).state).toBe('ready');
    expect(
      resolveToolOutput('artifact_read_v1', {
        ...result,
        revision: { ...result.revision, content: { text: 'wrong kind' } },
      }).state,
    ).toBe('invalid');
  });
});
