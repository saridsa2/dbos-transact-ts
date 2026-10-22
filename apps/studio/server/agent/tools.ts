import { builtinToolDescriptions } from '../../lib/agent/tool-catalog';
import { readArtifact } from './artifact-reader';
import { normalizeToolInput } from './tool-input';
import { isolatedCodeRunner } from '../code/runner';
import { defaultCode } from '../../lib/authoring/model';
import { harnessOptionsSchema } from '../workspace-harness/options';
import { resolveToolOutput } from '../../lib/agent/tool-outputs';
import { z } from 'zod';
import { toolArguments, toolNames } from '../../lib/agent/contracts';
import { contentHash } from '../../lib/knowledge/contracts';
import { validateOntology } from '../../lib/knowledge/ontology';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import type { NodeRegistry } from '../registry';
// Keep the v1 execution contract for historical receipts, but offer only typed
// questions to new model turns so the existing generative form can render them.
export const modelTools = toolNames
  .filter((name) => name !== 'ask_user_v1')
  .map((name) => ({
    type: 'function',
    function: {
      name,
      description: builtinToolDescriptions[name],
      parameters: z.toJSONSchema(toolArguments[name], { io: 'input' }),
    },
  }));
async function executeAgentTool(
  service: AgentService,
  registry: NodeRegistry,
  ctx: Context,
  workId: string,
  name: string,
  input: unknown,
) {
  const schema = toolArguments[name as keyof typeof toolArguments];
  if (!schema) throw new Error(`Tool ${name} is not registered.`);
  const args: any = schema.parse(normalizeToolInput(name, input));
  const execution = await service.definitions?.guard(ctx, workId, name, args);
  if (name === 'agent_definition_search_v1') return service.coordination.specialists(ctx, args.query);
  if (name === 'workspace_suggestion_propose_v1') return service.coordination.propose(ctx, workId, args);
  if (name === 'agent_history_read_v1') return service.memory.readHistory(ctx, workId, args);
  switch (name) {
    case 'memory_search_v2':
      return service.memory.search(ctx, workId, args);
    case 'agent_memory_propose_v2':
      return service.memory.propose(ctx, workId, args, await contentHash({ workId, args }));
    case 'agent_result_read_v2':
      return service.memory.readResult(ctx, workId, args);
    case 'agent_tool_search_v1':
      throw new Error('Tool search requires the active runtime catalogue.');
    case 'agent_memory_propose_v1': {
      const id = crypto.randomUUID();
      await service.pool.query(
        'INSERT INTO wa_memory_proposals(workspace_id,id,work_item_id,content,evidence) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, id, workId, args.content, JSON.stringify(args.evidence)],
      );
      const question = `Remember this workspace guidance? ${args.content}`;
      return {
        question,
        interaction: {
          id,
          question,
          fields: [{ id: 'approved', label: 'Accept this workspace memory', type: 'boolean', required: true }],
        },
        memoryId: id,
      };
    }
    case 'agent_result_read_v1': {
      const row = (
        await service.pool.query(
          "SELECT result FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3 AND kind='tool' AND state='completed'",
          [ctx.workspace.id, workId, args.id],
        )
      ).rows[0];
      if (!row) throw new Error('Recorded observation not found in this work item.');
      const text = JSON.stringify(row.result);
      return {
        id: args.id,
        offset: args.offset,
        total: text.length,
        text: text.slice(args.offset, args.offset + args.limit),
      };
    }
    case 'agent_skill_read_v1': {
      const { work, config } = await service.authorize(ctx.workspace.id, workId);
      const options = harnessOptionsSchema.parse(config.runtime ?? {});
      if (!options.skills.includes(args.id)) throw new Error('This skill is not configured for this work item.');
      const [skill] = await service.features.skillContext(ctx, [args.id], work.engine_provenance?.skills);
      return skill;
    }
    case 'agent_plan_v1': {
      if (
        new Set(args.steps.map((s: any) => s.id)).size !== args.steps.length ||
        args.steps.filter((s: any) => s.status === 'running').length > 1
      )
        throw new Error('Plan IDs must be unique and only one step may be running.');
      const row = (
        await service.pool.query(
          'INSERT INTO wa_agent_plans(workspace_id,work_item_id,steps) VALUES($1,$2,$3) ON CONFLICT(workspace_id,work_item_id) DO UPDATE SET steps=$3,revision=wa_agent_plans.revision+1,updated_at=now() RETURNING revision,steps',
          [ctx.workspace.id, workId, JSON.stringify(args.steps)],
        )
      ).rows[0];
      await service.activity(ctx.workspace.id, workId, 'plan', 'Agent plan updated.', row);
      return row;
    }
    case 'agent_delegate_v1':
      return service.tasks.delegate(ctx, workId, args);
    case 'agent_task_status_v1':
      return service.tasks.list(ctx, workId);
    case 'agent_task_result_v1': {
      const task = (await service.tasks.list(ctx, workId)).items.find((t) => t.id === args.id);
      if (!task) throw new Error('Task not found in this work item.');
      const text = task.response ?? '';
      return {
        id: args.id,
        state: task.state,
        offset: args.offset,
        total: text.length,
        text: text.slice(args.offset, args.offset + args.limit),
      };
    }
    case 'agent_code_v1': {
      const code = defaultCode();
      code.source = args.source;
      code.language = args.language;
      code.limits.timeoutMS = 1000;
      code.limits.maxOutputBytes = 32000;
      return isolatedCodeRunner.execute(code, args.input, {});
    }
    case 'workspace_describe_v1':
      return {
        knowledge: (await service.knowledge.list(ctx)).items
          .filter(
            (a) =>
              !execution ||
              execution.definition.context.scope === 'workspace_inventory' ||
              (execution.contextResources ?? execution.definition.context.resources).some((r) => r.id === a.id),
          )
          .map((a) => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
            revisionId:
              (execution?.contextResources ?? execution?.definition.context.resources)?.find((r) => r.id === a.id)
                ?.revisionId ?? a.revisionId,
            editVersion: a.editVersion,
          })),
        workflows: (execution ? [] : await service.studio.listFlows(ctx.workspace.id))
          .slice(0, 50)
          .map((f) => ({ id: f.id, name: f.name, editVersion: f.editVersion })),
      };
    case 'artifact_read_v1': {
      const artifact = await service.knowledge.get(ctx, args.id, args.revisionId);
      const blocks =
        artifact.artifact.kind === 'source' && ['text', 'search'].includes(args.view)
          ? await service.knowledge.blocks(ctx, args.id, artifact.revision.id)
          : [];
      return readArtifact(artifact, args, blocks);
    }
    case 'capability_search_v1': {
      const catalog = registry.nativeCatalog();
      return {
        steps: catalog.steps
          .filter((s) => `${s.id} ${s.name}`.toLowerCase().includes(args.query.toLowerCase()))
          .slice(0, 50),
        transactions: catalog.transactions
          .filter((s) => `${s.id} ${s.name}`.toLowerCase().includes(args.query.toLowerCase()))
          .slice(0, 50),
      };
    }
    case 'ontology_validate_v1': {
      const item = await service.knowledge.get(ctx, args.id, args.revisionId);
      if (item.artifact.kind !== 'ontology') throw new Error('Select an ontology artifact.');
      return { issues: validateOntology(item.revision.content) };
    }
    case 'memory_search_v1':
      return {
        items: (
          await service.pool.query(
            'SELECT id,content,decision_id FROM wa_memories WHERE workspace_id=$1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT 10',
            [ctx.workspace.id, `%${args.query}%`],
          )
        ).rows,
      };
    case 'ask_user_v2':
      return { question: args.question, interaction: { id: crypto.randomUUID(), ...args } };
    case 'ask_user_v1':
      return { question: args.question };
    case 'process_propose_v1':
    case 'ontology_propose_v1': {
      const item = await service.knowledge.get(ctx, args.id);
      const kind = name === 'process_propose_v1' ? 'process' : 'ontology';
      if (item.artifact.kind !== kind) throw new Error(`Select a ${kind} artifact.`);
      if (item.artifact.editVersion !== args.expectedVersion)
        throw new Error(
          `${kind === 'ontology' ? 'Ontology' : 'Process'} changed. Read its latest revision before proposing edits.`,
        );
      const checked = await service.knowledge.validate(ctx, kind, args.content);
      const hash = await contentHash(checked.content),
        proposalId = crypto.randomUUID();
      await service.pool.query(
        'INSERT INTO wa_change_sets(workspace_id,id,work_item_id,artifact_id,expected_version,content,content_hash,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [ctx.workspace.id, proposalId, workId, args.id, args.expectedVersion, checked.content, hash, args.summary],
      );
      return { proposalId, summary: args.summary, hash };
    }
  }
  throw new Error('Tool handler is unavailable.');
}

export async function runAgentTool(...args: Parameters<typeof executeAgentTool>) {
  const result = await executeAgentTool(...args);
  const presentation = resolveToolOutput(args[4], result);
  if (presentation.state === 'invalid' || presentation.state === 'unsupported') throw new Error(presentation.message);
  return result;
}
