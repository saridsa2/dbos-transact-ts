import type { WorkState } from '../../lib/agent/contracts';
import { ControlError } from '../control/service';
import { AgentResponseError } from './model';

/** Context preparation failures do not mean a spending allowance was exhausted. */
export function failureState(error: unknown, pending: boolean): WorkState {
  const text = error instanceof Error ? error.message : '';
  if (pending || text.startsWith('UNCERTAIN:')) return 'uncertain';
  if (text.startsWith('BUDGET:') || (error instanceof AgentResponseError && error.finishReason === 'length'))
    return 'budget_exhausted';
  if (error instanceof ControlError && error.status === 403) return 'suspended';
  return 'failed';
}
