import { z } from 'zod';
import { definitionSchema } from './definitions';
export const setupResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    purpose: z.string().min(1).max(4000),
    goals: z.array(z.string().min(1).max(1000)).min(1).max(20),
    gaps: z.array(z.string().min(1).max(1000)).max(20),
    evidenceReceiptIds: z.array(z.string().uuid()).max(100),
    coordinator: definitionSchema.refine((v) => v.kind === 'coordinator', 'Setup must propose a coordinator.'),
  })
  .strict();
