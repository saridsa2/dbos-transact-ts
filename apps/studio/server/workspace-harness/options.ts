import { z } from 'zod';
export const harnessOptionsSchema = z
  .object({
    contextBytes: z.number().int().min(8192).max(240000).default(180000),
    retainRounds: z.number().int().min(1).max(12).default(4),
    compact: z.boolean().default(true),
    totalTokens: z.number().int().min(1024).max(1000000).default(200000),
    maxTotalTokens: z.number().int().min(1024).max(1000000).optional(),
    durationMs: z.number().int().min(1000).max(1800000).default(600000),
    concurrency: z.number().int().min(1).max(8).default(3),
    mcp: z
      .array(
        z
          .object({
            connectionId: z.string().uuid(),
            revision: z.number().int().positive(),
            tools: z
              .array(
                z
                  .object({
                    name: z.string().min(1).max(80),
                    hash: z.string().regex(/^[a-f0-9]{64}$/),
                    effect: z.enum(['read', 'write']),
                  })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    extensions: z
      .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/), version: z.string().min(1).max(80) }).strict())
      .max(20)
      .default([]),
    skills: z.array(z.string().uuid()).max(20).default([]),
    delegation: z.boolean().default(false),
    maxChildren: z.number().int().min(1).max(8).default(3),
    maxDepth: z.number().int().min(1).max(3).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.maxTotalTokens !== undefined && v.maxTotalTokens < v.totalTokens)
      ctx.addIssue({
        code: 'custom',
        path: ['maxTotalTokens'],
        message: 'Maximum tokens must cover the initial allowance.',
      });
    for (const [field, values] of [
      ['skills', v.skills],
      ['extensions', v.extensions.map((e) => e.id)],
      ['mcp', v.mcp.map((e) => e.connectionId)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate configuration binding.' });
    if (v.mcp.reduce((n, b) => n + b.tools.length, 0) > 40)
      ctx.addIssue({ code: 'custom', path: ['mcp'], message: 'Enable at most 40 MCP tools.' });
    for (const b of v.mcp)
      if (new Set(b.tools.map((t) => t.name)).size !== b.tools.length)
        ctx.addIssue({ code: 'custom', path: ['mcp'], message: 'Duplicate MCP tool binding.' });
  });
export type HarnessOptions = z.infer<typeof harnessOptionsSchema>;
