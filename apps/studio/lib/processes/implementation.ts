import { contentHash } from '../knowledge/contracts';
import type { AgentFlow } from '../flows/types';
/** Revision bookkeeping and diagnostics do not constitute implementation drift. */
export async function implementationHash(flow: AgentFlow): Promise<string> {
  const {
    editVersion: _version,
    createdAt: _created,
    updatedAt: _updated,
    diagnostics: _diagnostics,
    ...definition
  } = flow;
  return contentHash(definition);
}
