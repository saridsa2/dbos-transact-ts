/** Shared descriptions for built-in tool inspection and model offerings. */
export const builtinToolDescriptions: Record<string, string> = {
  agent_definition_search_v1:
    'Find enabled published specialists in this workspace by purpose. Returns exact revisions for assignment recommendations, not permission to execute them.',
  workspace_suggestion_propose_v1:
    'Propose a bounded specialist assignment with a stable finding key, source revision context, rationale and completion criteria. Use inspection_gap for unread material; observed findings require actual artifact-read receipt IDs. Does not create agents or execute work. The user must accept it.',
  agent_tool_search_v1:
    'Search enabled workspace code tools, approved extensions and MCP offerings; load only relevant tool schemas for later turns.',
  agent_memory_propose_v1:
    'Propose durable workspace memory with evidence references. The user must explicitly approve before it is accepted.',
  agent_history_read_v1:
    'Read a page of the current authorized history checkpoints, including original tool receipt IDs and exact fragment coverage. Follow nextBeforeGeneration to inspect older lineage; summaries are not full source coverage.',
  agent_result_read_v1: 'Read a recorded tool observation by receipt ID. Use offsets for large results.',
  agent_skill_read_v1: 'Load a configured workspace skill by its pinned ID. Skills cannot grant permissions.',
  agent_plan_v1: 'Record or update this work item’s plan and progress. This does not execute steps.',
  agent_delegate_v1:
    'Delegate bounded read-only research tasks to durable background agents and wait for their results. Never delegate writes or user approvals.',
  agent_task_status_v1: 'Read the state and available results of this work item’s delegated tasks.',
  agent_task_result_v1: 'Read the recorded final response of one of this work item’s delegated tasks, with pagination.',
  agent_code_v1:
    'Run a pure JavaScript/TypeScript transform in isolated QuickJS. No filesystem, network, secrets, imports, shell or host APIs. Return the result.',
  workspace_describe_v1:
    'List workspace knowledge and workflows. Read metadata first, then inspect relevant artifacts.',
  artifact_read_v1:
    'Read a workspace artifact. Small auto reads return full content; large auto reads return an index. For large ontologies use entities then entity with entityId, or structure without embedded RDF. Use text/search for exact source assertions. All views paginate with UTF-16 offsets. Follow the returned continuation including revisionId; metadata/search results are not complete source coverage. External imports are not fetched.',
  capability_search_v1:
    'Discover executable registered operations. Missing capabilities must stay explicit requirements.',
  ontology_validate_v1: 'Validate an existing ontology revision and return structural issues.',
  process_propose_v1:
    'Stage a complete visual process draft against its expected head version for user review. Preserve stable element IDs, evidence, existing bindings and presentation unless the requested edit changes them. Never apply, compile, publish or execute it.',
  ontology_propose_v1:
    'Stage a complete ontology replacement against an expected head version. Does not apply, save or publish it. Retain IDs and existing evidence. All facts are reviewable.',
  ask_user_v2:
    'Required for any clarification or choice that needs a user answer. Renders an interactive form using text, number, boolean, select or multiselect fields; never ask via Markdown options or reply letters. Pause and wait for the validated answer; do not invent it.',
  ask_user_v1: 'Persist one clarification question and wait for a user decision.',
  memory_search_v2: 'Search approved memory within this agent and authorized evidence scope.',
  agent_memory_propose_v2: 'Propose scoped memory for owner/admin review; does not approve it.',
  agent_result_read_v2:
    'Retrieve a recorded observation using receiptId from availableEvidenceReceipts. Omit sourceWorkId for the current activity; supply an exact authorized sourceWorkId only for another compatible activity. Never invent identifiers.',
  memory_search_v1: 'Retrieve previously accepted user answers from this workspace.',
};

export function builtinToolHref(name: string): string | undefined {
  return Object.hasOwn(builtinToolDescriptions, name) ? `/tools?capability=${encodeURIComponent(name)}` : undefined;
}
