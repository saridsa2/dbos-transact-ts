import { describe, it, expect, vi } from 'vitest';
import { query, type QueryHost, type Reply } from './query';
function host(replies: Reply[]): QueryHost {
  return {
    startTurn: 0,
    maxTurns: 4,
    complete: vi.fn(async () => replies.shift() ?? null),
    runTool: vi.fn(async () => ({})),
    skipTool: vi.fn(async () => {}),
    checkpoint: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    suspend: vi.fn(async () => {}),
    exhausted: vi.fn(async () => {}),
  };
}
const call = (id: string, name = 'read') => ({ id, name, arguments: {} });
describe('standalone workspace harness lifecycle', () => {
  it('continues after a tool checkpoint and returns the actual final response', async () => {
    const h = host([
      { text: '', calls: [call('a')] },
      { text: 'Found Banking.', calls: [] },
    ]);
    await query(h);
    expect(h.runTool).toHaveBeenCalledWith(call('a'), 0, 0);
    expect(h.checkpoint).toHaveBeenCalledWith(1);
    expect(h.finish).toHaveBeenCalledWith('Found Banking.');
    expect(h.suspend).not.toHaveBeenCalled();
  });
  it('pauses at a question and records remaining calls as skipped without executing them', async () => {
    const h = host([{ text: '', calls: [call('a', 'ask'), call('b', 'write')] }]);
    h.runTool = vi.fn(async () => ({ question: 'Which domain?' }));
    await query(h);
    expect(h.runTool).toHaveBeenCalledTimes(1);
    expect(h.skipTool).toHaveBeenCalledWith(call('b', 'write'), 0, 1);
    expect(h.suspend).toHaveBeenCalledWith({ state: 'waiting_for_user', message: 'Which domain?', nextTurn: 1 });
    expect(h.complete).toHaveBeenCalledTimes(1);
  });
  it('suspends proposals for review instead of dispatching subsequent mutations', async () => {
    const h = host([{ text: '', calls: [call('a'), call('b')] }]);
    h.runTool = vi.fn(async () => ({ proposalId: 'p', summary: 'Review entity changes.' }));
    await query(h);
    expect(h.runTool).toHaveBeenCalledTimes(1);
    expect(h.suspend).toHaveBeenCalledWith({
      state: 'ready_for_review',
      message: 'Review entity changes.',
      nextTurn: 1,
    });
  });
  it('resumes at the persisted turn and observes a bounded total turn budget', async () => {
    const h = host([{ text: '', calls: [call('a')] }]);
    h.startTurn = 3;
    await query(h);
    expect(h.complete).toHaveBeenCalledWith(3);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.exhausted).toHaveBeenCalledOnce();
  });
  it('rejects duplicate tool identity before any operation runs', async () => {
    const h = host([{ text: '', calls: [call('a'), call('a')] }]);
    await expect(query(h)).rejects.toThrow('duplicate tool calls');
    expect(h.runTool).not.toHaveBeenCalled();
  });
  it('propagates interrupted effects to the durable host without automatic replay', async () => {
    const h = host([{ text: '', calls: [call('a')] }]);
    h.runTool = vi.fn(async () => {
      throw Error('uncertain effect');
    });
    await expect(query(h)).rejects.toThrow('uncertain effect');
    expect(h.runTool).toHaveBeenCalledOnce();
    expect(h.finish).not.toHaveBeenCalled();
  });
  it('does not fabricate success on an empty model response', async () => {
    const h = host([{ text: ' ', calls: [] }]);
    await expect(query(h)).rejects.toThrow('without a response');
    expect(h.finish).not.toHaveBeenCalled();
  });
});
