/** Display labels never replace the full, persisted instruction. */
export function activityTitle(goal?: string | null): string {
  const line = (goal ?? '')
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/^\s*#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return 'Activity';
  const sentence = line.match(/^(.{8,90}?[.!?])(?:\s|$)/u)?.[1] ?? line;
  const points = Array.from(sentence);
  if (points.length <= 80) return sentence;
  const prefix = points.slice(0, 79).join('');
  const boundary = prefix.lastIndexOf(' ');
  return `${boundary > 45 ? prefix.slice(0, boundary) : prefix}…`;
}
export function activityError(error: string): string {
  if (/Mem0 inference is disabled/i.test(error))
    return 'Memory must be reviewed and approved before an agent can recall it.';
  if (/mem0/i.test(error))
    return 'Semantic memory could not be used. Check memory readiness and the agent’s published retrieval settings. Authorized keyword recall remains available.';
  if (/"code"\s*:\s*"(?:invalid_|unrecognized_keys|too_)/.test(error) && /"path"\s*:/.test(error))
    return 'The activity could not validate a model response. Inspect Execution for details before continuing.';
  if (/Unexpected token|is not valid JSON|JSON at position|JSON input/i.test(error))
    return 'The model returned an invalid response. Check Execution for details, then send a smaller instruction. No request was automatically repeated.';
  return error;
}
export function receiptStatus(kind: string): 'ok' | 'error' | 'running' | undefined {
  if (/failed|error|uncertain|budget_exhausted/.test(kind)) return 'error';
  if (/started|queued|reasoning|executing/.test(kind)) return 'running';
  if (/completed|succeeded/.test(kind)) return 'ok';
  return undefined;
}
const toolLabels: Record<string, string> = {
  workspace_describe_v1: 'Inspect workspace',
  artifact_read_v1: 'Read saved knowledge',
  capability_search_v1: 'Find capabilities',
  ontology_validate_v1: 'Validate ontology',
  ontology_propose_v1: 'Propose ontology changes',
  process_propose_v1: 'Propose process changes',
  ask_user_v2: 'Ask for clarification',
  memory_search_v2: 'Recall approved memory',
  agent_memory_propose_v2: 'Propose memory for review',
  agent_result_read_v2: 'Read execution evidence',
  agent_history_read_v1: 'Read activity history',
  agent_definition_search_v1: 'Find specialists',
  workspace_suggestion_propose_v1: 'Suggest activities',
};
export function toolLabel(name: string) {
  return toolLabels[name] ?? name.replace(/_v\d+$/, '').replaceAll('_', ' ');
}
