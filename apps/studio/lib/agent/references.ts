import { z } from 'zod';
export const agentRevisionRefSchema = z
  .object({
    agentId: z.string().uuid(),
    revision: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
