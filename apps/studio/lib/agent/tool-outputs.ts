import { artifactPageSchema } from './artifact-reading';
import { z } from 'zod';
import type { toolNames } from './contracts';
import { id, issueSchema } from '../knowledge/contracts';
import { interactionDefinitionSchema } from './interactions';
import { ontologySchema } from '../knowledge/ontology';
import { processDocumentSchema as processSchema } from '../knowledge/process';
export type AgentToolName = (typeof toolNames)[number];
const named = z.object({ id, name: z.string().min(1).max(300) });
const resource = named.extend({
  kind: z.enum(['ontology', 'process', 'source']),
  revisionId: id,
  editVersion: z.number().int().positive(),
});
const revision = z.object({ id, content: z.unknown(), reviewed: z.boolean() });
const source = z.object({
  schemaVersion: z.literal(1),
  mediaType: z.enum(['text/plain', 'text/markdown']),
  text: z.string().max(200000),
});
const artifact = z.object({ artifact: resource, revision }).superRefine((v, c) => {
  const schema =
    v.artifact.kind === 'ontology' ? ontologySchema : v.artifact.kind === 'process' ? processSchema : source;
  if (!schema.safeParse(v.revision.content).success)
    c.addIssue({ code: 'custom', path: ['revision', 'content'], message: 'Artifact content does not match its kind.' });
});
/** A versioned operation chooses its schema and renderer. Model output never names React components. */
export const toolOutputDefinitions = {
  agent_definition_search_v1: {
    title: 'Workspace specialists',
    renderer: 'agent-definitions',
    schema: z.object({
      items: z
        .array(
          z.object({
            agentId: id,
            revision: z.number().int().positive(),
            hash: z.string(),
            name: z.string(),
            description: z.string(),
          }),
        )
        .max(50),
    }),
  },
  workspace_suggestion_propose_v1: {
    title: 'Suggested assignment',
    renderer: 'workspace-suggestion',
    schema: z.object({ id, state: z.string(), summary: z.string() }),
  },
  agent_tool_search_v1: {
    title: 'Approved tool offerings',
    renderer: 'tool-search',
    schema: z.object({
      items: z
        .array(z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) }))
        .max(10),
    }),
  },
  agent_memory_propose_v1: {
    title: 'Proposed workspace memory',
    renderer: 'structured-question',
    schema: z.object({
      question: z.string(),
      interaction: interactionDefinitionSchema.safeExtend({ id: z.string().uuid() }),
      memoryId: z.string().uuid(),
    }),
  },
  agent_result_read_v1: {
    title: 'Recorded observation',
    renderer: 'recorded-text',
    schema: z.object({
      id: z.string().uuid(),
      offset: z.number().int(),
      total: z.number().int(),
      text: z.string().max(8000),
    }),
  },
  agent_skill_read_v1: {
    title: 'Workspace skill',
    renderer: 'skill',
    schema: z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string(),
      revision: z.number().int(),
      content: z.string().max(16000),
      hash: z.string(),
    }),
  },
  agent_plan_v1: {
    title: 'Agent plan',
    renderer: 'plan',
    schema: z.object({
      revision: z.number().int(),
      steps: z.array(z.object({ id: z.string(), label: z.string(), status: z.string() })).max(24),
    }),
  },
  agent_delegate_v1: {
    title: 'Delegated tasks',
    renderer: 'tasks',
    schema: z.object({ pendingTasks: z.array(z.string().uuid()).max(8) }),
  },
  agent_task_status_v1: {
    title: 'Task status',
    renderer: 'tasks',
    schema: z.object({
      items: z
        .array(
          z.object({
            id: z.string().uuid(),
            title: z.string(),
            workId: z.string().uuid(),
            depth: z.number(),
            state: z.string(),
            error: z.string().nullable(),
            response: z.string().nullable(),
          }),
        )
        .max(8),
    }),
  },
  agent_task_result_v1: {
    title: 'Task response',
    renderer: 'recorded-text',
    schema: z.object({
      id: z.string().uuid(),
      state: z.string(),
      offset: z.number().int(),
      total: z.number().int(),
      text: z.string().max(8000),
    }),
  },
  agent_code_v1: {
    title: 'Isolated code result',
    renderer: 'code-result',
    schema: z.object({ value: z.unknown(), logs: z.array(z.string()), revision: z.string() }),
  },
  workspace_describe_v1: {
    title: 'Workspace resources',
    renderer: 'workspace-resources',
    schema: z.object({
      knowledge: z.array(resource).max(500),
      workflows: z.array(named.extend({ editVersion: z.number().int().positive() })).max(50),
    }),
  },
  artifact_read_v1: {
    title: 'Artifact inspection',
    renderer: 'artifact-inspector',
    schema: z.union([artifact, artifactPageSchema]),
  },
  capability_search_v1: {
    title: 'Available operations',
    renderer: 'capability-list',
    schema: z.object({ steps: z.array(named).max(50), transactions: z.array(named).max(50) }),
  },
  ontology_validate_v1: {
    title: 'Ontology validation',
    renderer: 'validation-report',
    schema: z.object({ issues: z.array(issueSchema).max(10000) }),
  },
  process_propose_v1: {
    title: 'Process proposal',
    renderer: 'proposal-reference',
    schema: z.object({ proposalId: id, summary: z.string().min(1).max(2000), hash: z.string().min(1).max(200) }),
  },
  ontology_propose_v1: {
    title: 'Ontology proposal',
    renderer: 'proposal-reference',
    schema: z.object({ proposalId: id, summary: z.string().min(1).max(2000), hash: z.string().min(1).max(200) }),
  },
  ask_user_v1: {
    title: 'Clarification',
    renderer: 'question',
    schema: z.object({ question: z.string().min(1).max(2000) }),
  },
  ask_user_v2: {
    title: 'Requested input',
    renderer: 'structured-question',
    schema: z.object({
      question: z.string().min(1).max(2000),
      interaction: interactionDefinitionSchema.safeExtend({ id: z.string().uuid() }),
    }),
  },
  memory_search_v2: {
    title: 'Scoped workspace memory',
    renderer: 'memory-list',
    schema: z.object({
      items: z
        .array(
          z.object({
            id,
            version: z.number().int(),
            scope: z.enum(['agent', 'workspace']),
            content: z.string().max(4000),
            evidence: z.array(z.unknown()),
            score: z.number(),
          }),
        )
        .max(20),
      truncated: z.boolean(),
    }),
  },
  agent_memory_propose_v2: {
    title: 'Memory awaiting review',
    renderer: 'memory-list',
    schema: z.object({ id, version: z.number().int(), state: z.literal('proposed'), notice: z.string() }),
  },
  agent_history_read_v1: {
    title: 'Historical checkpoints',
    renderer: 'memory-list',
    schema: z.object({
      items: z
        .array(z.object({ generation: z.number(), phase: z.string(), summary: z.unknown(), sources: z.unknown() }))
        .max(3),
      nextBeforeGeneration: z.number().nullable(),
    }),
  },
  agent_result_read_v2: {
    title: 'Recorded observation',
    renderer: 'observation',
    schema: z.object({
      id,
      sourceWorkId: id,
      offset: z.number().int(),
      total: z.number().int(),
      text: z.string().max(12000),
    }),
  },
  memory_search_v1: {
    title: 'Workspace decisions',
    renderer: 'memory-list',
    schema: z.object({ items: z.array(z.object({ id, content: z.string().max(10000), decision_id: id })).max(10) }),
  },
} as const satisfies Record<AgentToolName, { title: string; renderer: string; schema: z.ZodType }>;
export function resolveToolOutput(name: string, output: unknown) {
  const error = z.object({ error: z.string().min(1) }).safeParse(output);
  if (error.success) return { state: 'error' as const, message: error.data.error };
  if (!Object.prototype.hasOwnProperty.call(toolOutputDefinitions, name))
    return { state: 'unsupported' as const, message: 'This tool has no registered result view.' };
  const tool = name as AgentToolName;
  const definition = toolOutputDefinitions[tool];
  const parsed = definition.schema.safeParse(output);
  if (!parsed.success)
    return {
      state: 'invalid' as const,
      message: 'This result does not match the registered tool output. Technical details are available below.',
    };
  return { state: 'ready' as const, tool, title: definition.title, renderer: definition.renderer, data: parsed.data };
}
