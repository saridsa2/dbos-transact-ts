import { describe, expect, it } from 'vitest';
import { emptyLiveRun, receiveRunEvent, spanDuration } from './live-run';

const receipt = (
  id: string,
  kind: string,
  payload: Record<string, unknown> = {},
  createdAt = '2026-10-20T10:00:00Z',
) => ({
  id,
  kind,
  payload: { callId: 'model-a', turn: 1, ...payload },
  createdAt,
});
describe('durable run presentation receipts', () => {
  it('deduplicates reconnect replay without losing precision in event IDs', () => {
    let run = receiveRunEvent(emptyLiveRun('work-a'), receipt('9007199254740992', 'model_start'));
    const event = receipt('9007199254740993', 'text', { text: 'Hello' });
    run = receiveRunEvent(run, event);
    expect(receiveRunEvent(run, event)).toBe(run);
    expect(receiveRunEvent(run, receipt('9007199254740992', 'text', { text: 'duplicate' }))).toBe(run);
    expect(run.answer?.text).toBe('Hello');
    expect(run.cursor).toBe('9007199254740993');
  });
  it('separates model turns and removes intermediate tool-directed prose', () => {
    let run = receiveRunEvent(emptyLiveRun('work-a'), receipt('1', 'model_start'));
    run = receiveRunEvent(run, receipt('2', 'text', { text: 'Checking sources' }));
    run = receiveRunEvent(run, receipt('3', 'model_end', { hasTools: true }));
    expect(run.answer).toBeNull();
    run = receiveRunEvent(run, receipt('4', 'model_start', { callId: 'model-b', turn: 2 }));
    run = receiveRunEvent(run, receipt('5', 'text', { callId: 'model-b', turn: 2, text: 'The answer' }));
    run = receiveRunEvent(run, receipt('6', 'model_end', { callId: 'model-b', turn: 2, hasTools: false }));
    expect(run.answer?.text).toBe('The answer');
    expect(run.spans).toHaveLength(2);
  });
  it('represents tool failures and measured timings without inventing inputs or outputs', () => {
    let run = receiveRunEvent(
      emptyLiveRun('work-a'),
      receipt('1', 'tool_start', { callId: 'tool-a', name: 'ontology_propose_v1' }),
    );
    expect(spanDuration(run.spans[0])).toBeNull();
    run = receiveRunEvent(
      run,
      receipt('2', 'tool_end', { callId: 'tool-a', name: 'ontology_propose_v1', error: true }, '2026-10-20T10:00:02Z'),
    );
    expect(run.spans[0].state).toBe('failed');
    expect(spanDuration(run.spans[0])).toBe(2000);
    expect(run.spans[0]).not.toHaveProperty('input');
  });
  it('keeps timing unknown when an initial receipt is unavailable', () => {
    const run = receiveRunEvent(emptyLiveRun('work-a'), receipt('2', 'model_end', { usage: { input: 42, output: 5 } }));
    expect(run.spans[0].usage).toEqual({ input: 42, output: 5 });
    expect(spanDuration(run.spans[0])).toBeNull();
  });
  it('rejects malformed known events and unsafe cursors before advancing', () => {
    const run = emptyLiveRun('work-a');
    expect(() => receiveRunEvent(run, receipt('9223372036854775808', 'model_start'))).toThrow();
    expect(() => receiveRunEvent(run, receipt('1', 'text', { text: 5 }))).toThrow();
    expect(run.cursor).toBe('0');
  });
  it('advances over future event kinds without fabricating progress', () => {
    const run = receiveRunEvent(emptyLiveRun('work-a'), receipt('1', 'future_receipt'));
    expect(run.cursor).toBe('1');
    expect(run.spans).toEqual([]);
    expect(run.answer).toBeNull();
    expect(emptyLiveRun('work-b')).toEqual({ workId: 'work-b', cursor: '0', spans: [], answer: null });
  });
});
