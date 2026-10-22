import { z } from 'zod';
import { memoryPolicySchema } from './memory';
import { limitsSchema, attachmentSchema } from './contracts';
import type { HarnessOptions } from '../../server/workspace-harness/options';

// Initial published profiles use the built-in reviewed-knowledge capabilities.
// Extension/MCP/delegation profiles require separately pinned manifests.
export const definitionToolNames = [
  'workspace_describe_v1',
  'artifact_read_v1',
  'capability_search_v1',
  'ontology_validate_v1',
  'ontology_propose_v1',
  'process_propose_v1',
  'ask_user_v2',
  'memory_search_v2',
  'agent_memory_propose_v2',
  'agent_result_read_v2',
  'agent_history_read_v1',
  'agent_definition_search_v1',
  'workspace_suggestion_propose_v1',
] as const;
export { agentRevisionRefSchema } from './references';
import { agentRevisionRefSchema } from './references';
export const definitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(['coordinator', 'specialist']),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000),
    instructions: z.string().trim().min(1).max(16000),
    model: z
      .object({
        provider: z.literal('minimax'),
        connectionId: z.string().uuid(),
        connectionRevision: z.number().int().positive(),
      })
      .strict(),
    tools: z
      .array(z.enum(definitionToolNames))
      .min(1)
      .max(definitionToolNames.length)
      .refine((v) => new Set(v).size === v.length, 'Duplicate tools.'),
    context: z
      .object({
        scope: z.enum(['selected', 'workspace_inventory']),
        resources: z.array(attachmentSchema).max(100),
        followHead: z.boolean().default(false),
      })
      .strict(),
    memory: memoryPolicySchema.optional(),
    limits: limitsSchema,
    interaction: z.enum(['interactive', 'structured_output']),
    outputSchema: z.record(z.string(), z.json()).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.interaction === 'structured_output' && (!v.outputSchema || v.tools.includes('ask_user_v2')))
      c.addIssue({
        code: 'custom',
        message: 'Structured-output agents require an output schema and cannot ask interactive questions.',
      });
    if (v.context.scope === 'workspace_inventory' && v.kind !== 'coordinator')
      c.addIssue({ code: 'custom', message: 'Specialists require selected context.' });
    if (v.kind !== 'coordinator' && v.tools.includes('workspace_suggestion_propose_v1'))
      c.addIssue({ code: 'custom', message: 'Only coordinators may suggest specialist assignments.' });
    if (new Set(v.context.resources.map((r) => r.id)).size !== v.context.resources.length)
      c.addIssue({ code: 'custom', message: 'Duplicate context resource.' });
  });
export type AgentDefinition = z.infer<typeof definitionSchema>;
export type AgentRevisionRef = z.infer<typeof agentRevisionRefSchema>;
export type AgentExecutionSnapshot = {
  schemaVersion: 1;
  ref: AgentRevisionRef;
  definition: AgentDefinition;
  actorId: string;
  workspacePolicyVersion: number;
  hash: string;
  policyCeiling: { limits: z.infer<typeof limitsSchema>; runtime: HarnessOptions };
  contextResources?: z.infer<typeof attachmentSchema>[];
  automaticReview?: { ruleVersion: number };
};
