import { describe, expect, it } from 'vitest';
import { executionInspection } from './execution-inspection';
import type { FlowRunEvent } from '@/lib/flows/types';
const base = { runId: 'r1', nodeId: 'n1', nodeName: 'Test', nodeKind: 'step' as const };
const start = (timestamp: string, runId = 'r1'): FlowRunEvent => ({ ...base, runId, type: 'node.started', timestamp });
const end = (timestamp: string, runId = 'r1'): FlowRunEvent => ({
  ...base,
  runId,
  type: 'node.completed',
  timestamp,
  output: null,
  presence: 'present',
});
describe('execution inspection', () => {
  it('uses the latest invocation and preserves a present null result', () => {
    const info = executionInspection(
      [
        start('2026-10-18T00:00:00Z'),
        end('2026-10-18T00:00:01Z'),
        start('2026-10-18T00:00:03Z'),
        end('2026-10-18T00:00:05Z'),
      ],
      'n1',
    );
    expect(info.elapsedMs).toBe(2000);
    expect(info.presence).toBe('present');
  });
  it('does not pair an old start with an incomplete historical attempt or another run', () => {
    expect(
      executionInspection(
        [start('2026-10-18T00:00:00Z'), end('2026-10-18T00:00:01Z'), end('2026-10-18T00:00:05Z')],
        'n1',
      ).elapsedMs,
    ).toBeUndefined();
    expect(
      executionInspection([start('2026-10-18T00:00:00Z'), end('2026-10-18T00:00:05Z', 'r2')], 'n1').elapsedMs,
    ).toBeUndefined();
  });
  it('does not invent timing for waiting, missing or invalid events', () => {
    expect(executionInspection([], 'n1')).toEqual({});
    expect(executionInspection([start('invalid'), end('2026-10-18T00:00:05Z')], 'n1').elapsedMs).toBeUndefined();
    expect(
      executionInspection([start('2026-10-18T00:00:05Z'), end('2026-10-18T00:00:01Z')], 'n1').elapsedMs,
    ).toBeUndefined();
    expect(executionInspection([start('2026-10-18T00:00:00Z')], 'n1').endedAt).toBeUndefined();
  });
});
