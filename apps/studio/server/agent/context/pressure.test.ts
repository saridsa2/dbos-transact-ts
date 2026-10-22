import { describe, it, expect, vi } from 'vitest';
import { agentContext, contextCapacity, type AgentContextInput } from '../context';
import { validatePairing } from '../../workspace-harness/context';

function host(messages: Record<string, unknown>[], rebuild?: () => Promise<Record<string, unknown>[]>) {
  const activity = vi.fn();
  const authorize = vi.fn(async () => ({
    ctx: {},
    work: { execution_snapshot: { definition: { memory: { history: 'observational_v1', working: 'compact' } } } },
  }));
  const input = {
    service: { authorize, activity },
    workspace: 'w',
    workId: 'same-activity',
    turn: 2,
    options: { compact: true, contextBytes: 180000 },
    messages,
    toolBytes: 9300,
    pressureHistory: rebuild,
  } as unknown as AgentContextInput;
  return { input, activity };
}
describe('context pressure is maintenance, not a work budget', () => {
  it('continues when essential context exceeds the soft target but fits actual request capacity', async () => {
    const messages = [
      { role: 'system', content: 'instructions '.repeat(4000) },
      { role: 'user', content: JSON.stringify({ activeWorkGoal: 'Inspect missing properties' }) },
    ];
    const rebuild = vi.fn(async () => messages);
    const { input, activity } = host(messages, rebuild);
    expect(await agentContext(input)).toEqual(messages);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(activity).not.toHaveBeenCalled();
  });
  it('rebuilds with saved history, retains goals and answers, and preserves complete tool rounds', async () => {
    const goal = { role: 'user', content: JSON.stringify({ activeWorkGoal: 'Check every entity' }) };
    const answer = { role: 'user', content: JSON.stringify({ userAnswers: ['English only'] }) };
    const round = [
      { role: 'assistant', tool_calls: [{ id: 'recent' }] },
      { role: 'tool', tool_call_id: 'recent', content: 'Current result' },
    ];
    const compacted = [
      { role: 'system', content: 'Permissions' },
      goal,
      {
        role: 'user',
        content: JSON.stringify({
          historicalActivity: {
            items: [{ kind: 'finding', text: '24 entities checked; originals in receipts' }],
            remainingWork: ['Check the rest'],
          },
        }),
      },
      ...round,
      answer,
    ];
    const { input, activity } = host(
      [
        { role: 'system', content: 'Permissions' },
        goal,
        { role: 'user', content: 'Large original '.repeat(15000) },
        answer,
      ],
      vi.fn(async () => compacted),
    );
    const result = await agentContext(input);
    expect(result).toEqual(compacted);
    expect(() => validatePairing(result)).not.toThrow();
    expect(activity).toHaveBeenCalledWith(
      'w',
      'same-activity',
      'context_compacted',
      expect.any(String),
      expect.objectContaining({ capacityBytes: 180000 }),
    );
  });
  it('does not prepare history below the target and never silently drops oversized essential inputs', async () => {
    const rebuild = vi.fn(async () => []);
    const { input } = host([{ role: 'user', content: 'Short goal' }], rebuild);
    await agentContext(input);
    expect(rebuild).not.toHaveBeenCalled();
    input.messages = [{ role: 'system', content: 'x'.repeat(240000) }];
    input.pressureHistory = async () => input.messages;
    await expect(agentContext(input)).rejects.toThrow('available model input capacity');
  });
  it('accounts for tool schemas within the existing request ceiling without confusing bytes and billed tokens', () => {
    expect(contextCapacity(240000, 50000)).toEqual({ max: 198976, target: 8192 });
    expect(contextCapacity(180000, 9300)).toEqual({ max: 180000, target: 26700 });
  });
});
