import type { WorkspaceRequest } from './contracts';
import { activityError } from './presentation';
export async function agentRequest(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/api/agent/${path}`, {
    method,
    headers: data === undefined ? undefined : { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(activityError(result.error?.message ?? 'Agent request failed.'));
  return result;
}
export type AgentIntent = Pick<WorkspaceRequest, 'clientRequestId' | 'text'> &
  Partial<Omit<WorkspaceRequest, 'clientRequestId' | 'text'>>;
