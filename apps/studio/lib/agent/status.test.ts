import { describe, it, expect } from 'vitest';
import { agentStatus } from './status';
describe('visible agent execution state', () => {
  it.each([
    ['queued', 'Queued'],
    ['preparing', 'Preparing'],
    ['reasoning', 'Thinking'],
    ['executing_tool', 'Running a tool'],
    ['waiting_for_tasks', 'Delegated agents working'],
  ])('shows %s as active', (state, label) => {
    expect(agentStatus(state)).toMatchObject({ label, active: true });
  });
  it('does not animate completed or waiting states and makes accepted answers visible immediately', () => {
    expect(agentStatus('waiting_for_user')).toMatchObject({ label: 'Waiting for your answer', active: false });
    expect(agentStatus('completed')).toMatchObject({ label: 'Completed', active: false });
    expect(agentStatus('waiting_for_user', 'Continuing…')).toMatchObject({ label: 'Continuing…', active: true });
  });
});
