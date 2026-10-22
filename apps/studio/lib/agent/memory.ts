import { z } from 'zod';
export const memoryPolicySchema = z
  .object({
    version: z.literal(1),
    session: z.enum(['off', 'same_revision']),
    working: z.enum(['off', 'compact']),
    history: z.literal('observational_v1').optional(),
    index: z.literal('mem0_v1').optional(),
    approved: z.enum(['off', 'agent', 'workspace']),
    maxRetrievedEntries: z.number().int().min(0).max(20),
    maxRetrievedTokens: z.number().int().min(0).max(4000),
  })
  .strict();
export const defaultMemoryPolicy = {
  version: 1,
  session: 'same_revision',
  working: 'compact',
  approved: 'off',
  maxRetrievedEntries: 8,
  maxRetrievedTokens: 2000,
} as const;
export const memoryEvidenceSchema = z
  .object({ kind: z.enum(['source', 'ontology', 'process']), id: z.string().uuid(), revisionId: z.string().uuid() })
  .strict();
export const memorySearchSchema = z
  .object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(20).default(8) })
  .strict();
export const memoryProposalSchema = z
  .object({
    content: z.string().trim().min(1).max(4000),
    scope: z.enum(['agent', 'workspace']),
    evidence: z.array(memoryEvidenceSchema).min(1).max(20),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export const resultReadSchema = z
  .object({
    sourceWorkId: z.string().uuid().optional(),
    receiptId: z.string().uuid(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(12000).default(4000),
  })
  .strict();
