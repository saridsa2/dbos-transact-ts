import type { AgentFlow } from './types';

/** Persist one coherent editor draft, including workflow settings and run-input defaults. */
export async function saveWorkflowDraft(
  flow: AgentFlow,
  runInput: string,
  request: typeof fetch = fetch,
): Promise<AgentFlow> {
  const draft = { ...flow, ...(flow.schemaVersion === 2 ? { defaultInput: JSON.parse(runInput) } : {}) };
  const create = draft.id === 'starter-flow';
  const response = await request(create ? '/api/flows' : `/api/flows/${encodeURIComponent(draft.id)}`, {
    method: create ? 'POST' : 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(draft),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not save workflow. Your changes are still in the draft.');
  }
  return response.json();
}
