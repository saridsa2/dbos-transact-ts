import { entityIconFor } from './entity-presentation';
import { entityColors } from './material-colors';
import type { Ontology } from './ontology';
import { playgroundDocumentSchema, type PlaygroundDocument } from './playground-document';
/** Adapt the upstream editor while keeping Stack Proc IDs, evidence and exact cardinalities. */
export function toPlayground(model: Ontology, name: string): PlaygroundDocument {
  const saved = model.playground;
  const entityIds = new Set(model.entities.map((e) => e.id));
  const relationships: PlaygroundDocument['relationships'] = model.relationships.map((r) => {
    const prior = saved?.relationships.find((v) => v.id === r.id);
    return {
      ...prior,
      id: r.id,
      name: r.name,
      from: r.sourceId,
      to: r.targetId,
      kind: 'association',
      cardinality: prior?.cardinality ?? (r.max === 1 ? 'many-to-one' : 'many-to-many'),
    };
  });
  for (const e of model.entities)
    if (e.parentId && entityIds.has(e.parentId)) {
      const prior = saved?.relationships.find((r) => r.kind === 'subclass' && r.from === e.id && r.to === e.parentId);
      let key = prior?.id ?? `inherits:${e.id}`;
      while (relationships.some((r) => r.id === key)) key += '_';
      relationships.push({
        id: key,
        name: prior?.name ?? 'is a',
        from: e.id,
        to: e.parentId,
        kind: 'subclass',
        cardinality: 'many-to-one',
      });
    }
  return {
    ...saved,
    name,
    description: model.description,
    relationships,
    entityTypes: model.entities.map((e, i) => {
      const prior = saved?.entityTypes.find((v) => v.id === e.id);
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        icon: prior?.icon ?? entityIconFor(e.name, e.description),
        color: prior?.color ?? entityColors[i % entityColors.length].hex,
        properties: e.properties.map((p) => {
          const old = prior?.properties.find((v) => v.stackprocId === p.id);
          const type =
            p.format === 'date'
              ? 'date'
              : p.format === 'date-time'
                ? 'datetime'
                : p.enum
                  ? 'enum'
                  : p.type === 'number'
                    ? old?.type === 'decimal'
                      ? 'decimal'
                      : 'double'
                    : p.type;
          return {
            name: p.name,
            type,
            stackprocId: p.id,
            ...(p.schema ? { schema: p.schema } : {}),
            required: p.required,
            nullable: p.nullable,
            description: p.description,
            ...(p.unit ? { unit: p.unit } : {}),
            ...(p.enum ? { values: p.enum } : {}),
            isIdentifier: p.identifier ?? old?.isIdentifier ?? false,
          };
        }),
      };
    }),
  };
}
export function fromPlayground(input: unknown, previous: Ontology): Ontology {
  const doc = playgroundDocumentSchema.parse(input);
  const oldDoc = previous.playground;
  const entities: Ontology['entities'] = doc.entityTypes.map((e) => {
    const old = previous.entities.find((v) => v.id === e.id);
    const parents = doc.relationships.filter((r) => r.kind === 'subclass' && r.from === e.id);
    if (parents.length > 1)
      throw new Error(
        `${e.name}: Stack Proc supports one parent entity. Remove the extra inheritance relationship before saving.`,
      );
    const used = new Set<string>();
    const properties: Ontology['entities'][number]['properties'] = e.properties.map((p) => {
      // Imported RDF has no stable property ID. Allocate once, then retain on edits/reordering.
      const stable = p.stackprocId ?? crypto.randomUUID();
      if (used.has(stable)) throw new Error(`${e.name}: duplicate property reference.`);
      used.add(stable);
      const prior = old?.properties.find((v) => v.id === stable);
      p.stackprocId = stable;
      const type =
        p.type === 'decimal' || p.type === 'double'
          ? 'number'
          : ['date', 'datetime', 'enum'].includes(p.type)
            ? 'string'
            : (p.type as Ontology['entities'][number]['properties'][number]['type']);
      return {
        ...prior,
        id: stable,
        name: p.name,
        type,
        required: p.required ?? prior?.required ?? false,
        nullable: p.nullable ?? prior?.nullable ?? false,
        description: p.description ?? '',
        evidence: prior?.evidence ?? [],
        schema: p.schema,
        unit: p.unit,
        format: p.type === 'date' ? 'date' : p.type === 'datetime' ? 'date-time' : undefined,
        enum: p.type === 'enum' ? (p.values ?? []) : undefined,
        identifier: p.isIdentifier ?? false,
      };
    });
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      parentId: parents[0]?.to,
      properties,
      evidence: old?.evidence ?? [],
    };
  });
  const relationships: Ontology['relationships'] = doc.relationships
    .filter((r) => r.kind !== 'subclass')
    .map((r) => {
      const prior = previous.relationships.find((v) => v.id === r.id);
      const old = oldDoc?.relationships.find((v) => v.id === r.id);
      const unchanged =
        prior && (old?.cardinality ?? (prior.max === 1 ? 'many-to-one' : 'many-to-many')) === r.cardinality;
      return {
        id: r.id,
        name: r.name,
        sourceId: r.from,
        targetId: r.to,
        min: unchanged ? prior.min : 0,
        max: unchanged ? prior.max : ['one-to-one', 'many-to-one'].includes(r.cardinality) ? 1 : null,
        evidence: prior?.evidence ?? [],
      };
    });
  return { schemaVersion: 1, description: doc.description, entities, relationships, playground: doc };
}
