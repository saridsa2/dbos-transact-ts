import { z } from 'zod';
import { id } from './contracts';
// The upstream visual model is retained in the same immutable workspace revision.
// Its display metadata does not confer executable capabilities.
const property = z
  .object({
    name: z.string().max(200),
    type: z.enum(['string', 'integer', 'decimal', 'double', 'date', 'datetime', 'boolean', 'enum', 'object', 'array']),
    stackprocId: id.optional(),
    schema: z.record(z.string(), z.json()).optional(),
    required: z.boolean().optional(),
    nullable: z.boolean().optional(),
    isIdentifier: z.boolean().optional(),
    unit: z.string().max(100).optional(),
    values: z.array(z.string().max(2000)).max(1000).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
export const playgroundDocumentSchema = z
  .object({
    rdfSource: z
      .string()
      .max(1024 * 1024)
      .optional(),
    name: z.string().max(200),
    description: z.string().max(10000),
    entityTypes: z
      .array(
        z
          .object({
            id,
            name: z.string().max(200),
            description: z.string().max(2000),
            icon: z.string().max(100),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            properties: z.array(property).max(100),
          })
          .strict(),
      )
      .max(200),
    relationships: z
      .array(
        z
          .object({
            id,
            name: z.string().max(200),
            from: id,
            to: id,
            cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
            kind: z.enum(['association', 'subclass']).optional(),
            description: z.string().max(2000).optional(),
            attributes: z
              .array(z.object({ name: z.string().max(200), type: z.string().max(100) }).strict())
              .max(100)
              .optional(),
          })
          .strict(),
      )
      .max(700),
    rdfMetadata: z
      .object({
        ontologyIri: z.string().max(2000).optional(),
        versionIri: z.string().max(2000).optional(),
        versionInfo: z.string().max(2000).optional(),
        license: z.string().max(2000).optional(),
        imports: z.array(z.string().max(2000)).max(200),
        preservedSourceFeatures: z.array(z.enum(['owlImports', 'shacl'])).max(2),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PlaygroundDocument = z.infer<typeof playgroundDocumentSchema>;
