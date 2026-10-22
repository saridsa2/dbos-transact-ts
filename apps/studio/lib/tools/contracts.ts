import { z } from 'zod';
export const fileMapSchema = z.record(z.string(), z.string()).superRefine((files, ctx) => {
  if (Object.keys(files).length > 100 || new TextEncoder().encode(JSON.stringify(files)).length > 1048576)
    ctx.addIssue({ code: 'custom', message: 'Package exceeds 100 files or 1 MiB.' });
  for (const path of Object.keys(files)) {
    if (
      !/^(?:src\/[\w./-]+\.[cm]?[jt]s|schemas\/[\w/.-]+\.json|tests\/[\w/.-]+\.json|tool\.json|README\.md)$/.test(
        path,
      ) ||
      path.split('/').some((p) => !p || p === '.' || p === '..')
    )
      ctx.addIssue({ code: 'custom', message: `Unsupported package path: ${path}` });
  }
});
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,59}$/),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    runtime: z.literal('pure-js-v1'),
    entrypoint: z.string().startsWith('src/'),
    inputSchema: z.string().startsWith('schemas/'),
    outputSchema: z.string().startsWith('schemas/'),
    effects: z.literal('pure'),
    exposure: z.array(z.enum(['agent', 'workflow'])).max(2),
    limits: z
      .object({
        timeoutMS: z.number().int().min(10).max(30000),
        memoryMB: z.number().int().min(8).max(128),
        maxOutputBytes: z.number().int().min(1).max(65536),
      })
      .strict(),
    tests: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            input: z.string().startsWith('tests/'),
            expected: z.string().startsWith('tests/'),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type ToolManifest = z.infer<typeof manifestSchema>;
export type ToolFiles = Record<string, string>;
export type ToolDiagnostic = { file: string; line?: number; column?: number; message: string };
export type ToolHead = {
  id: string;
  name: string;
  editVersion: number;
  snapshotId: string;
  hash: string;
  publishedRevision: number | null;
  enabledRevision: number | null;
  archived: boolean;
  updatedAt: string;
};
export function starterFiles(id: string, slug = 'sum-values'): ToolFiles {
  return {
    'tool.json': JSON.stringify(
      {
        schemaVersion: 1,
        id,
        slug,
        name: 'Sum values',
        description: 'Add numeric values and return their total.',
        version: '0.1.0',
        runtime: 'pure-js-v1',
        entrypoint: 'src/index.ts',
        inputSchema: 'schemas/input.schema.json',
        outputSchema: 'schemas/output.schema.json',
        effects: 'pure',
        exposure: ['agent', 'workflow'],
        limits: { timeoutMS: 5000, memoryMB: 32, maxOutputBytes: 65536 },
        tests: [{ name: 'basic', input: 'tests/basic.input.json', expected: 'tests/basic.expected.json' }],
      },
      null,
      2,
    ),
    'src/index.ts': `import type { ToolContext } from '@stackproc/toolkit';\nimport type { Input, Output } from '../.stackproc/types';\n\nexport async function run(input: Input, ctx: ToolContext): Promise<Output> {\n  ctx.log.info('Adding values', { count: input.values.length });\n  return { total: input.values.reduce((sum, value) => sum + value, 0) };\n}\n`,
    'schemas/input.schema.json': JSON.stringify(
      {
        type: 'object',
        properties: { values: { type: 'array', items: { type: 'number' }, maxItems: 1000 } },
        required: ['values'],
        additionalProperties: false,
      },
      null,
      2,
    ),
    'schemas/output.schema.json': JSON.stringify(
      { type: 'object', properties: { total: { type: 'number' } }, required: ['total'], additionalProperties: false },
      null,
      2,
    ),
    'tests/basic.input.json': '{ "values": [1, 2, 3] }\n',
    'tests/basic.expected.json': '{ "total": 6 }\n',
    'README.md': '# Sum values\n\nAdds the supplied values. No external effects.\n',
  };
}
