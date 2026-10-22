import { describe, expect, it } from 'vitest';
import { ontologyChanges, processChanges } from './proposal-diff';
import { ontologySchema } from '../knowledge/ontology';
import { migrateProcess } from '../processes/model';
const base = ontologySchema.parse({
  schemaVersion: 1,
  entities: [{ id: 'customer', name: 'Customer', properties: [{ id: 'name', name: 'Name', type: 'string' }] }],
  relationships: [],
});
describe('proposal review changes', () => {
  it('identifies property changes and removals independently of entity metadata', () => {
    const next = structuredClone(base);
    next.entities[0].properties = [
      { ...next.entities[0].properties[0], required: true },
      { id: 'email', name: 'Email', type: 'string', required: false, nullable: false, description: '', evidence: [] },
    ];
    const diff = ontologyChanges(base, next);
    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ change: 'Changed', name: 'Name', detail: expect.stringContaining('required') }),
        expect.objectContaining({ change: 'Added', name: 'Email' }),
      ]),
    );
    expect(diff.some((row) => row.name === 'Customer')).toBe(false);
    expect(ontologyChanges(next, base)).toContainEqual(expect.objectContaining({ change: 'Removed', name: 'Email' }));
  });
  it('preserves explicit removed-entity warnings without duplicating each property', () => {
    const next = { ...base, entities: [] };
    expect(ontologyChanges(base, next)).toEqual([expect.objectContaining({ change: 'Removed', name: 'Customer' })]);
  });
  it('reports no changes for identical saved and proposed definitions', () => {
    expect(ontologyChanges(base, structuredClone(base))).toEqual([]);
  });
  it('detects route and lane changes in visual process proposals', () => {
    const before = migrateProcess({
      schemaVersion: 1,
      purpose: 'Example',
      inputSchema: {},
      defaultInput: {},
      ontologyRefs: [],
      questions: [],
      steps: [],
    });
    const after = structuredClone(before);
    after.lanes = [{ id: 'reviewers', name: 'Reviewers' }];
    expect(processChanges(before, after)).toContainEqual(
      expect.objectContaining({ change: 'Added', name: 'Reviewers' }),
    );
  });
});
