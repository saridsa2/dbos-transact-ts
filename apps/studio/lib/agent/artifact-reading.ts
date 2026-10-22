import { z } from 'zod';
import { id, evidenceSchema } from '../knowledge/contracts';
export const artifactReadSchema = z
  .object({
    id,
    revisionId: id.optional(),
    view: z
      .enum(['auto', 'summary', 'text', 'structure', 'entities', 'entity', 'relationships', 'json', 'search'])
      .default('auto'),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(8000).default(4000),
    entityId: z.string().min(1).max(128).optional(),
    query: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.view === 'entity' && !v.entityId)
      c.addIssue({ code: 'custom', path: ['entityId'], message: 'Select an entity ID from the entities view.' });
    if (v.view === 'search' && !v.query)
      c.addIssue({ code: 'custom', path: ['query'], message: 'Supply literal source text to search for.' });
  });
export const artifactPageSchema = z.object({
  artifact: z.object({
    id,
    name: z.string(),
    kind: z.enum(['source', 'ontology', 'process']),
    revisionId: id,
    editVersion: z.number().int().positive(),
  }),
  revision: z.object({ id, reviewed: z.boolean(), contentHash: z.string() }),
  availableViews: z.array(z.string()),
  summary: z.object({
    entityCount: z.number().int().optional(),
    relationshipCount: z.number().int().optional(),
    elementCount: z.number().int().optional(),
    sourceCharacters: z.number().int().optional(),
  }),
  page: z.object({
    view: z.string(),
    format: z.enum(['json', 'text']),
    offset: z.number().int(),
    nextOffset: z.number().int().nullable(),
    total: z.number().int(),
    text: z.string().max(8000),
    complete: z.boolean(),
    query: z.string().optional(),
    entityId: z.string().optional(),
  }),
  evidence: z.array(evidenceSchema).max(50),
  warnings: z.array(z.string()).max(30),
  continuation: z
    .object({
      id,
      revisionId: id,
      view: z.string(),
      offset: z.number().int(),
      limit: z.number().int(),
      entityId: z.string().optional(),
      query: z.string().optional(),
    })
    .nullable(),
});
