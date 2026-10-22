import { describe, it, expect, vi } from 'vitest';
import { workingContext, type WorkingSnapshot } from './working-context';
import { validatePairing, type ProtocolMessage } from './context';
const round = (n: number): ProtocolMessage[] => [
  { role: 'assistant', content: null, reasoning_content: 'PRIVATE_REASONING', tool_calls: [{ id: `tool-${n}` }] },
  { role: 'tool', tool_call_id: `tool-${n}`, content: `evidence-${n}:` + 'x'.repeat(5000) },
];
describe('durable working context', () => {
  it('retains protected goals, complete rounds and immutable receipt identities without summarizing private reasoning', async () => {
    let saved: WorkingSnapshot | null = null;
    const summarize = vi.fn(
      async () => 'Found evidence-0 and evidence-1. Remaining work: inspect the customer account.',
    );
    const input = [
      { role: 'system', content: 'policy' },
      { role: 'user', content: JSON.stringify({ activeWorkGoal: 'Inspect this ontology' }) },
      ...round(0),
      ...round(1),
      ...round(2),
    ];
    const result = await workingContext(input, {
      maxBytes: 7000,
      retainRounds: 2,
      saved,
      summarize,
      persist: async (value) => {
        saved = { ...value, revision: 1 };
      },
    });
    expect(result.compacted).toBe(true);
    expect(() => validatePairing(result.messages)).not.toThrow();
    expect(result.messages[1].content).toContain('Inspect this ontology');
    expect(JSON.stringify(summarize.mock.calls)).not.toContain('PRIVATE_REASONING');
    expect(JSON.stringify(result.messages)).toContain('tool-2');
    summarize.mockClear();
    const replay = await workingContext(input, {
      maxBytes: 7000,
      retainRounds: 2,
      saved,
      summarize,
      persist: async () => {
        throw Error('Duplicate checkpoint');
      },
    });
    expect(replay.compacted).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
    const longer = [...input, ...round(3)];
    await workingContext(longer, { maxBytes: 7000, retainRounds: 2, saved, summarize, persist: async () => {} });
    expect(summarize).toHaveBeenCalledOnce();
    expect(JSON.stringify(summarize.mock.calls)).not.toContain('evidence-0:' + 'x'.repeat(50));
  });
  it('does not advance a checkpoint for an invalid summary or unresolved tool call', async () => {
    const persist = vi.fn();
    await expect(
      workingContext([{ role: 'assistant', tool_calls: [{ id: 'missing' }] }], {
        maxBytes: 1,
        retainRounds: 1,
        saved: null,
        summarize: async () => '',
        persist,
      }),
    ).rejects.toThrow('unresolved');
    await expect(
      workingContext([...round(1), ...round(2)], {
        maxBytes: 7000,
        retainRounds: 1,
        saved: null,
        summarize: async () => '',
        persist,
      }),
    ).rejects.toThrow('Invalid');
    expect(persist).not.toHaveBeenCalled();
  });
  it('treats its working target as maintenance and permits protected current context within request capacity', async () => {
    const input = [
      { role: 'system', content: 'Policy'.repeat(3000) },
      { role: 'user', content: JSON.stringify({ activeWorkGoal: 'Inspect the workspace' }) },
    ];
    const summarize = vi.fn();
    expect(
      (
        await workingContext(input, {
          maxBytes: 40000,
          targetBytes: 8000,
          retainRounds: 2,
          saved: null,
          summarize,
          persist: vi.fn(),
        })
      ).messages,
    ).toEqual(input);
    expect(summarize).not.toHaveBeenCalled();
  });
});
