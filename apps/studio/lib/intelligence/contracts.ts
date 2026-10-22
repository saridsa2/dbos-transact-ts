import { z } from 'zod';
import { ontologySchema } from '../knowledge/ontology';
import { processSchema } from '../knowledge/process';
import { id } from '../knowledge/contracts';
export const analysisSchema = z
  .object({
    summary: z.string().min(1).max(5000),
    ontology: ontologySchema,
    process: processSchema,
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const taskRequestSchema = z
  .object({ sourceId: id, sourceRevisionId: id, connectionId: id, connectionRevision: z.number().int().positive() })
  .strict();
export type IntelligenceTask = {
  id: string;
  name: string;
  status: 'queued' | 'analyzing' | 'needs_clarification' | 'ready' | 'failed' | 'cancelled' | 'applied';
  sourceId: string;
  sourceRevisionId: string;
  connectionId: string;
  connectionRevision: number;
  summary: string | null;
  error: string | null;
  analysis: Analysis | null;
  editVersion: number;
  flowId: string | null;
  createdAt: string;
  updatedAt: string;
};
