import { memorySearchSchema, memoryProposalSchema, resultReadSchema } from './memory';
import { artifactReadSchema } from './artifact-reading';
import { processV2Schema } from '../processes/model';
import { harnessOptionsSchema } from '../../server/workspace-harness/options';
import { interactionDefinitionSchema, interactionResponseSchema } from './interactions';
import { z } from 'zod';
import { id } from '../knowledge/contracts';
import { ontologySchema } from '../knowledge/ontology';
export const limitsSchema = z
  .object({
    turns: z.number().int().min(1).max(12).default(12),
    tools: z.number().int().min(1).max(24).default(24),
    outputTokens: z.number().int().min(256).max(16384).default(16384),
  })
  .strict();
export const agentConfigurationSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    enabled: z.boolean(),
    mode: z.enum(['observe', 'assist']),
    connectionId: id.optional(),
    connectionRevision: z.number().int().positive().optional(),
    allowModel: z.boolean().default(false),
    runtime: harnessOptionsSchema.optional(),
    triggers: z
      .array(z.enum(['knowledge.saved', 'workflow.saved', 'run.failed']))
      .max(3)
      .default([]),
    limits: limitsSchema.default({ turns: 12, tools: 24, outputTokens: 16384 }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.allowModel && (!v.connectionId || !v.connectionRevision))
      ctx.addIssue({
        code: 'custom',
        message: 'Select a MiniMax connection and its revision.',
        path: ['connectionId'],
      });
    if (new Set(v.triggers).size !== v.triggers.length) ctx.addIssue({ code: 'custom', message: 'Duplicate trigger.' });
  });
export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;
export const attachmentSchema = z
  .object({
    kind: z.enum(['source', 'ontology', 'process']),
    id,
    revisionId: id,
  })
  .strict();
export const messageSchema = z
  .object({
    clientMessageId: id,
    expectedSessionVersion: z.number().int().positive(),
    text: z.string().trim().min(1).max(10000),
    attachments: z.array(attachmentSchema).max(10).default([]),
    outputSchema: z.record(z.string(), z.json()).optional(),
  })
  .strict();
export const workStates = [
  'queued',
  'preparing',
  'reasoning',
  'executing_tool',
  'waiting_for_user',
  'waiting_for_tasks',
  'ready_for_review',
  'completed',
  'cancelled',
  'failed',
  'uncertain',
  'budget_exhausted',
  'suspended',
] as const;
export type WorkState = (typeof workStates)[number];
export const terminalStates: readonly WorkState[] = [
  'completed',
  'cancelled',
  'failed',
  'uncertain',
  'budget_exhausted',
  'suspended',
];
export const toolNames = [
  'agent_definition_search_v1',
  'workspace_suggestion_propose_v1',
  'workspace_describe_v1',
  'artifact_read_v1',
  'capability_search_v1',
  'ontology_validate_v1',
  'ontology_propose_v1',
  'process_propose_v1',
  'ask_user_v1',
  'ask_user_v2',
  'memory_search_v1',
  'memory_search_v2',
  'agent_memory_propose_v2',
  'agent_result_read_v2',
  'agent_history_read_v1',
  'agent_result_read_v1',
  'agent_skill_read_v1',
  'agent_plan_v1',
  'agent_delegate_v1',
  'agent_task_status_v1',
  'agent_task_result_v1',
  'agent_code_v1',
  'agent_tool_search_v1',
  'agent_memory_propose_v1',
] as const;
export const toolArguments = {
  memory_search_v2: memorySearchSchema,
  agent_memory_propose_v2: memoryProposalSchema,
  agent_result_read_v2: resultReadSchema,
  agent_history_read_v1: z
    .object({
      stream: z.enum(['work', 'session']).default('work'),
      beforeGeneration: z.number().int().positive().max(2147483647).optional(),
      limit: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  agent_definition_search_v1: z.object({ query: z.string().max(200).default('') }).strict(),
  workspace_suggestion_propose_v1: z
    .object({
      key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      goal: z.string().min(1).max(4000),
      rationale: z.string().min(1).max(2000),
      successCriteria: z.string().min(1).max(2000),
      executor: z
        .object({
          agentId: z.string().uuid(),
          revision: z.number().int().positive(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .nullable(),
      context: z.array(attachmentSchema).max(10),
      basis: z.enum(['inspection_gap', 'observed']).default('inspection_gap'),
      evidenceReceiptIds: z
        .array(z.string().uuid())
        .max(100)
        .default([])
        .refine((v) => new Set(v).size === v.length, 'Duplicate evidence receipts.'),
    })
    .strict(),
  workspace_describe_v1: z.object({}).strict(),
  artifact_read_v1: artifactReadSchema,
  capability_search_v1: z.object({ query: z.string().max(200).default('') }).strict(),
  ontology_validate_v1: z.object({ id, revisionId: id.optional() }).strict(),
  ontology_propose_v1: z
    .object({
      id,
      expectedVersion: z.number().int().positive(),
      content: ontologySchema.describe(
        'The complete ontology object. Pass an object, never a JSON-encoded string. Preserve stable IDs and existing evidence.',
      ),
      summary: z.string().min(1).max(2000),
    })
    .strict(),
  process_propose_v1: z
    .object({
      id,
      expectedVersion: z.number().int().positive(),
      content: processV2Schema,
      summary: z.string().min(1).max(2000),
    })
    .strict(),
  ask_user_v2: interactionDefinitionSchema,
  ask_user_v1: z.object({ question: z.string().min(1).max(2000) }).strict(),
  memory_search_v1: z.object({ query: z.string().max(200) }).strict(),
  agent_result_read_v1: z
    .object({
      id: z.string().uuid(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(8000).default(4000),
    })
    .strict(),
  agent_skill_read_v1: z.object({ id: z.string().uuid() }).strict(),
  agent_plan_v1: z
    .object({
      steps: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
              label: z.string().min(1).max(200),
              status: z.enum(['pending', 'running', 'completed', 'blocked']),
            })
            .strict(),
        )
        .max(24),
    })
    .strict(),
  agent_delegate_v1: z
    .object({
      tasks: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
              title: z.string().min(1).max(150),
              goal: z.string().min(1).max(8000),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  agent_task_status_v1: z.object({}).strict(),
  agent_task_result_v1: z
    .object({
      id: z.string().uuid(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(8000).default(4000),
    })
    .strict(),
  agent_code_v1: z
    .object({
      source: z.string().min(1).max(20000),
      language: z.enum(['javascript', 'typescript']).default('javascript'),
      input: z.json(),
    })
    .strict(),
  agent_tool_search_v1: z
    .object({ query: z.string().max(200), limit: z.number().int().min(1).max(10).default(5) })
    .strict(),
  agent_memory_propose_v1: z
    .object({ content: z.string().min(1).max(1500), evidence: z.array(z.string().min(1).max(200)).max(10) })
    .strict(),
};
export function checkAgentBudget(turns: number, tools: number, limits: { turns: number; tools: number }) {
  return turns < limits.turns && tools < limits.tools;
}

export const workspaceRequestSchema = z
  .object({
    agent: z
      .object({
        agentId: z.string().uuid(),
        revision: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    clientRequestId: id,
    origin: z.enum(['shell', 'workbench']).default('shell'),
    kind: z.enum(['goal', 'answer']).default('goal'),
    text: z.string().trim().min(1).max(10000),
    context: z
      .object({
        surface: z.enum(['workspace', 'workflow', 'ontology', 'knowledge', 'source', 'control', 'intelligence']),
        resource: attachmentSchema.optional(),
        workflowId: id.optional(),
      })
      .strict(),
    attachments: z.array(attachmentSchema).max(10).default([]),
    outputSchema: z.record(z.string(), z.json()).optional(),
    sessionId: id.optional(),
    workItemId: id.optional(),
    expectedVersion: z.number().int().positive().optional(),
    remember: z.boolean().default(false),
    response: interactionResponseSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.response && value.kind !== 'answer')
      ctx.addIssue({ code: 'custom', path: ['response'], message: 'Structured responses require an answer.' });
    if (value.kind === 'answer' && value.agent)
      ctx.addIssue({ code: 'custom', path: ['agent'], message: 'Answers retain their original agent.' });
    if (value.kind === 'answer' && (!value.workItemId || !value.expectedVersion))
      ctx.addIssue({
        code: 'custom',
        path: ['workItemId'],
        message: 'An answer must reference the current question and its version.',
      });
  });
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;
