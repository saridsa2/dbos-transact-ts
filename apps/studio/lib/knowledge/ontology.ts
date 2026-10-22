import { z } from 'zod';
import { checkSchema, assertValue } from '../authoring/contracts';
import { playgroundDocumentSchema } from './playground-document';
import { duplicateIssues, evidenceList, id, type KnowledgeIssue } from './contracts';
export const propertySchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(200),
    type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']),
    required: z.boolean().default(false),
    nullable: z.boolean().default(false),
    description: z.string().max(2000).default(''),
    unit: z.string().max(100).optional(),
    format: z.enum(['date', 'date-time']).optional(),
    enum: z.array(z.string().max(2000)).max(1000).optional(),
    identifier: z.boolean().optional(),
    schema: z.record(z.string(), z.json()).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    evidence: evidenceList,
  })
  .strict();
export const entitySchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
    parentId: id.optional(),
    properties: z.array(propertySchema).max(100),
    evidence: evidenceList,
  })
  .strict();
export const ontologySchema = z
  .object({
    schemaVersion: z.literal(1),
    description: z.string().max(10000).default(''),
    entities: z.array(entitySchema).max(200),
    playground: playgroundDocumentSchema.optional(),
    relationships: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            sourceId: id,
            targetId: id,
            min: z.number().int().min(0),
            max: z.number().int().min(0).nullable(),
            evidence: evidenceList,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type Ontology = z.infer<typeof ontologySchema>;
export function validateOntology(value: unknown): KnowledgeIssue[] {
  const parsed = ontologySchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      path: i.path.join('.'),
      severity: 'error',
      message: i.message,
    }));
  const model = parsed.data,
    entities = new Map(model.entities.map((e) => [e.id, e]));
  const issues = [
    ...duplicateIssues(model.entities, 'entities'),
    ...duplicateIssues(model.relationships, 'relationships'),
  ];
  model.entities.forEach((e, i) => {
    issues.push(...duplicateIssues(e.properties, `entities.${i}.properties`));
    e.properties.forEach((p, j) => {
      if (!p.schema) return;
      try {
        checkSchema(p.schema);
        if (p.schema.type !== p.type) throw new Error('Property schema type must match the property type.');
        if (Object.hasOwn(p.schema, 'default'))
          assertValue({ ...p.schema, type: p.nullable ? [p.type, 'null'] : p.type }, p.schema.default, 'Default');
      } catch (error) {
        issues.push({
          code: 'property_schema',
          path: `entities.${i}.properties.${j}.schema`,
          severity: 'error',
          message: error instanceof Error ? error.message : 'Invalid property schema.',
        });
      }
    });
    const seen = new Set([e.id]);
    let parent = e.parentId;
    while (parent) {
      if (seen.has(parent)) {
        issues.push({
          code: 'inheritance_cycle',
          path: `entities.${i}.parentId`,
          severity: 'error',
          message: 'Entity inheritance cannot contain a cycle.',
        });
        break;
      }
      seen.add(parent);
      const next = entities.get(parent);
      if (!next) {
        issues.push({
          code: 'unknown_parent',
          path: `entities.${i}.parentId`,
          severity: 'error',
          message: `Unknown parent: ${parent}`,
        });
        break;
      }
      if (e.properties.some((p) => next.properties.some((q) => p.id === q.id)))
        issues.push({
          code: 'inherited_property',
          path: `entities.${i}.properties`,
          severity: 'error',
          message: 'Inherited property IDs cannot be redefined.',
        });
      parent = next.parentId;
    }
  });
  model.relationships.forEach((r, i) => {
    if (!entities.has(r.sourceId) || !entities.has(r.targetId))
      issues.push({
        code: 'unknown_entity',
        path: `relationships.${i}`,
        severity: 'error',
        message: 'Select existing source and target entities.',
      });
    if (r.max !== null && r.max < r.min)
      issues.push({
        code: 'cardinality',
        path: `relationships.${i}.max`,
        severity: 'error',
        message: 'Maximum cardinality must be at least the minimum.',
      });
  });
  return issues;
}
/** Structural projection only. Units/currency are annotations, not implicit conversions. */
export function entityJsonSchema(model: Ontology, entityId: string): Record<string, unknown> {
  const issues = validateOntology(model);
  if (issues.length) throw new Error(issues[0].message);
  const entities = new Map(model.entities.map((e) => [e.id, e]));
  const entity = entities.get(entityId);
  if (!entity) throw new Error('Entity not found.');
  const props: z.infer<typeof propertySchema>[] = [];
  let current: typeof entity | undefined = entity;
  while (current) {
    props.unshift(...current.properties);
    current = current.parentId ? entities.get(current.parentId) : undefined;
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      props.map((p) => [
        p.id,
        {
          ...p.schema,
          type: p.nullable ? [p.type, 'null'] : p.type,
          description: p.description || p.name,
          ...(p.type === 'array' ? { items: {} } : {}),
          ...(p.format ? { format: p.format } : {}),
          ...(p.enum ? { enum: p.enum } : {}),
          ...(p.unit ? { 'x-unit': p.unit } : {}),
          ...(p.currency ? { 'x-currency': p.currency } : {}),
        },
      ]),
    ),
    required: props.filter((p) => p.required).map((p) => p.id),
  };
}
