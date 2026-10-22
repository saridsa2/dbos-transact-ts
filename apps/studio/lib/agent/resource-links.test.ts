import { describe, it, expect } from 'vitest';
import { collectAgentResources, type AgentResource } from './resource-links';
const resources: AgentResource[] = [
  { id: 'bank', name: 'Banking', kind: 'ontology' },
  { id: 'flow1', name: 'Typed variables and code', kind: 'workflow' },
];
describe('verified tool resource metadata', () => {
  it('extracts only recognized resource metadata from specific recorded tools', () => {
    const calls = [
      {
        name: 'workspace_describe_v1',
        result: {
          knowledge: [resources[0]],
          workflows: [{ id: 'flow1', name: 'Typed variables and code', href: 'javascript:bad' }],
        },
      },
      { name: 'artifact_read_v1', result: { artifact: resources[0] } },
      { name: 'invented', result: { artifact: { id: 'fake', name: 'Fake', kind: 'source' } } },
    ];
    expect(collectAgentResources(calls)).toEqual(resources);
  });
});
