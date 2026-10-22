'use client';
import { useEffect, useState } from 'react';
import { controlRequest } from '@/components/control/access';
import type { FlowNodeStatus, FlowRunEvent, FlowRunStatus } from '@/lib/flows/types';
type RecordedRun = {
  id: string;
  status: FlowRunStatus;
  graph: import('@/lib/flows/types').AgentFlow;
  input: import('@/lib/flows/types').FlowExecutionInput;
  events: { sequence: number; event: FlowRunEvent }[];
};
export function useProcessRun(runId: string | null, revisionId: string | undefined) {
  const [record, setRecord] = useState<RecordedRun | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setRecord(null);
    setError('');
    if (!runId || !revisionId) return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const data: RecordedRun = await controlRequest(`/api/runs/${encodeURIComponent(runId)}`);
        if (!alive) return;
        if (data.graph.sourceReference !== `process:${revisionId}`)
          throw new Error(
            'This run belongs to another process revision. Open its saved process revision from Implementations.',
          );
        setRecord(data);
        if (['queued', 'running', 'waiting'].includes(data.status)) timer = setTimeout(refresh, 1500);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, revisionId]);
  const statuses = new Map<string, FlowNodeStatus>();
  for (const row of record?.events ?? []) {
    const event = row.event;
    if ('nodeId' in event && event.nodeId) {
      const status = (
        {
          'node.started': 'running',
          'node.waiting': 'waiting',
          'node.completed': 'succeeded',
          'node.failed': 'failed',
          'node.skipped': 'skipped',
        } as Record<string, FlowNodeStatus>
      )[event.type];
      if (status) statuses.set(event.nodeId, status);
    }
  }
  return { record, statuses, error };
}
