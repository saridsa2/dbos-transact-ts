export const agentActiveStates = ['queued', 'preparing', 'reasoning', 'executing_tool', 'waiting_for_tasks'] as const;
const labels: Record<string, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  reasoning: 'Thinking',
  executing_tool: 'Running a tool',
  waiting_for_tasks: 'Delegated agents working',
  waiting_for_user: 'Waiting for your answer',
  ready_for_review: 'Ready for review',
  completed: 'Completed',
  cancelled: 'Stopped',
  failed: 'Failed',
  uncertain: 'Outcome needs review',
  budget_exhausted: 'Work limit reached',
  suspended: 'Paused',
};
export const workStatus = (state?: string): string => labels[state ?? ''] ?? 'Ready';
export function agentStatus(state?: string, pendingLabel?: string) {
  const active = !!pendingLabel || agentActiveStates.some((s) => s === state);
  const color = active
    ? 'blue'
    : ['failed', 'uncertain'].includes(state ?? '')
      ? 'error'
      : ['waiting_for_user', 'ready_for_review', 'suspended', 'budget_exhausted'].includes(state ?? '')
        ? 'warning'
        : state === 'completed'
          ? 'success'
          : 'gray';
  return { label: pendingLabel ?? workStatus(state), active, color } as const;
}
