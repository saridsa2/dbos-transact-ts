import { z } from 'zod';
import { agentRevisionRefSchema } from '../agent/references';
export const PROCESS_AGENT_HANDLER = 'stackproc.process-agent.v1';
/** Initial process policy is deliberately read-only; workspace writes still require reviewed proposals. */
export const processAgentTools = [
  'workspace_describe_v1',
  'artifact_read_v1',
  'capability_search_v1',
  'ontology_validate_v1',
  'memory_search_v1',
] as const;
export const processAgentDefinitionSchema = z
  .object({
    configurationRevision: z.number().int().positive(),
    goal: z.string().trim().min(1).max(8000),
    tools: z
      .array(z.enum(processAgentTools))
      .max(5)
      .refine((values) => new Set(values).size === values.length, 'Tool names must be unique.'),
    outputSchema: z.record(z.string(), z.json()),
    deadlineSeconds: z.number().int().min(10).max(1800),
    maxTurns: z.number().int().min(1).max(12),
  })
  .strict();

/** Published workspace profiles use a separate v2 binding; historical v1 stays strict. */
export const PROCESS_NAMED_AGENT_HANDLER = 'stackproc.process-agent.v2';
export const processNamedAgentDefinitionSchema = processAgentDefinitionSchema
  .omit({ configurationRevision: true })
  .extend({ agentRef: agentRevisionRefSchema })
  .strict();
export const processActivityAgentSchema = z.union([processAgentDefinitionSchema, processNamedAgentDefinitionSchema]);
