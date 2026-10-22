import type { AgentService } from './service';
import type { NodeRegistry } from '../registry';
import type { AgentModel } from './model';
import { createWorkspaceAgentRuntime } from './workspace-runtime';
/** Explicit cutover: the owned source port is the workspace runtime. No silent engine fallback. */
export function createAgentRuntime(service: AgentService, registry: NodeRegistry, fixture?: AgentModel) {
  if (fixture && process.env.STUDIO_INTEGRATION !== '1')
    throw new Error('Injected agent models are available only in integration tests.');
  return createWorkspaceAgentRuntime(service, registry, fixture, !!fixture);
}
