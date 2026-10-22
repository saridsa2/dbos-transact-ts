import { describe, it, expect } from 'vitest';
import { failureState } from './failure-state';
import { ControlError } from '../control/service';
import { AgentResponseError } from './model';
describe('activity stop reasons', () => {
  it('distinguishes context preparation from budget exhaustion', () => {
    expect(failureState(Error('CONTEXT: Current context cannot fit'), false)).toBe('failed');
    expect(failureState(Error('BUDGET: Approved allowance exhausted'), false)).toBe('budget_exhausted');
    expect(failureState(new AgentResponseError('length', { input: 1, output: 2 }, 'r', 2), false)).toBe(
      'budget_exhausted',
    );
  });
  it('preserves uncertain provider outcomes and authorization suspension', () => {
    expect(failureState(Error('CONTEXT: Preparation interrupted'), true)).toBe('uncertain');
    expect(failureState(Error('UNCERTAIN: No provider receipt'), false)).toBe('uncertain');
    expect(failureState(new ControlError(403, 'Access revoked'), false)).toBe('suspended');
  });
});
