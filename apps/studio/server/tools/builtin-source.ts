import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { toolArguments } from '../../lib/agent/contracts';
import { builtinToolDescriptions } from '../../lib/agent/tool-catalog';
import { ControlError } from '../control/service';

/** Only reviewed implementation paths are exposed; request values are never filesystem paths. */
const implementations: Record<string, string> = {
  agent_definition_search_v1: 'server/agent/coordination.ts',
  workspace_suggestion_propose_v1: 'server/agent/coordination.ts',
  agent_history_read_v1: 'server/agent/context-memory.ts',
  memory_search_v2: 'server/agent/context-memory.ts',
  agent_memory_propose_v2: 'server/agent/context-memory.ts',
  agent_result_read_v2: 'server/agent/context-memory.ts',
  artifact_read_v1: 'server/agent/artifact-reader.ts',
  ontology_validate_v1: 'lib/knowledge/ontology.ts',
  agent_delegate_v1: 'server/agent/tasks.ts',
  agent_task_status_v1: 'server/agent/tasks.ts',
  agent_task_result_v1: 'server/agent/tasks.ts',
  agent_tool_search_v1: 'server/agent/workspace-runtime.ts',
  agent_code_v1: 'server/code/runner.ts',
};

export async function builtinToolSource(name: string) {
  if (!Object.hasOwn(toolArguments, name)) throw new ControlError(404, 'Built-in tool not found.');
  const entrypoint = 'server/agent/tools.ts';
  const primary = implementations[name] ?? entrypoint;
  const files: Record<string, string> = {};
  const paths = [...new Set([primary, entrypoint, 'lib/agent/tool-catalog.ts'])];
  try {
    for (const path of paths) files[path] = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  } catch {
    throw new ControlError(503, 'Implementation source is unavailable in this installation.');
  }
  files['schemas/input.schema.json'] = JSON.stringify(
    z.toJSONSchema(toolArguments[name as keyof typeof toolArguments], { io: 'input' }),
    null,
    2,
  );
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { name, description: builtinToolDescriptions[name], primary, entrypoint, hash, files };
}
