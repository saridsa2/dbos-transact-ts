import type { Ontology } from '../knowledge/ontology';
import type { ProcessDocument } from '../processes/model';
export type ProposalChange = { id: string; change: 'Added' | 'Changed' | 'Removed'; name: string; detail: string };
function changes<T extends { id: string; name?: string }>(
  before: readonly T[],
  after: readonly T[],
  kind: string,
): ProposalChange[] {
  const saved = new Map(before.map((row) => [row.id, row]));
  const next = new Map(after.map((row) => [row.id, row]));
  return [
    ...after.flatMap<ProposalChange>((row) => {
      const previous = saved.get(row.id);
      if (!previous)
        return [{ id: `${kind}:${row.id}`, change: 'Added' as const, name: row.name ?? row.id, detail: kind }];
      const fields = Object.keys(row).filter(
        (key) =>
          JSON.stringify((previous as Record<string, unknown>)[key]) !==
          JSON.stringify((row as Record<string, unknown>)[key]),
      );
      return fields.length
        ? [
            {
              id: `${kind}:${row.id}`,
              change: 'Changed' as const,
              name: row.name ?? row.id,
              detail: `${kind} · ${fields.join(', ')}`,
            },
          ]
        : [];
    }),
    ...before
      .filter((row) => !next.has(row.id))
      .map((row) => ({ id: `${kind}:${row.id}`, change: 'Removed' as const, name: row.name ?? row.id, detail: kind })),
  ];
}
export function ontologyChanges(before: Ontology, after: Ontology): ProposalChange[] {
  const entityChanges = changes(
    before.entities.map(({ properties, ...e }) => e),
    after.entities.map(({ properties, ...e }) => e),
    'Entity',
  );
  const properties = after.entities.flatMap((entity) =>
    changes(
      before.entities.find((old) => old.id === entity.id)?.properties ?? [],
      entity.properties,
      `Property of ${entity.name}`,
    ),
  );
  // Removed entity rows already account for all of their removed properties.
  return [...entityChanges, ...properties, ...changes(before.relationships, after.relationships, 'Relationship')];
}
export function processChanges(before: ProcessDocument, after: ProcessDocument): ProposalChange[] {
  return [
    ...changes(before.graph.elements, after.graph.elements, 'Process element'),
    ...changes(before.graph.flows, after.graph.flows, 'Sequence route'),
    ...changes(before.lanes ?? [], after.lanes ?? [], 'Responsibility lane'),
  ];
}
