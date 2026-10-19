import type { FlowRunEvent } from '@/lib/flows/types';

/** Inspect the latest invocation in event order; never pair timings across attempts or runs. */
export function executionInspection(events: FlowRunEvent[], nodeId: string) {
  const nodeEvents = events.filter((event) => 'nodeId' in event && event.nodeId === nodeId);
  const last = nodeEvents.at(-1);
  if (!last) return {};
  const invocation: FlowRunEvent[] = [];
  for (let i = nodeEvents.length - 1; i >= 0; i--) {
    const event = nodeEvents[i];
    if (event.runId !== last.runId) break;
    if (i < nodeEvents.length - 1 && ['node.completed', 'node.failed', 'node.skipped'].includes(event.type)) break;
    invocation.unshift(event);
    if (event.type === 'node.started') break;
  }
  const startedAt = invocation.find((event) => event.type === 'node.started')?.timestamp;
  const endedAt = ['node.completed', 'node.failed', 'node.skipped'].includes(last.type) ? last.timestamp : undefined;
  const elapsed = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
  return {
    runId: last.runId,
    startedAt,
    endedAt,
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined,
    presence: last.type === 'node.completed' ? last.presence : undefined,
    reason: last.type === 'node.skipped' ? last.reason : undefined,
  };
}
