'use client';
import { receiptStatus } from '@/lib/agent/presentation';
import { ContextInspector } from './memory';
import { useEffect, useState } from 'react';
import { agentRequest } from '@/lib/agent/client';
import { emptyLiveRun, receiveRunEvent, spanDuration } from '@/lib/agent/live-run';
import type { WorkDetail } from '@/lib/agent/workbench-model';
import { agentActiveStates, workStatus } from '@/lib/agent/status';
import { TraceViewer, type TraceSpan } from '@/vendor/aisdkagents/trace-viewer';
import { Tabs } from '@/components/application/tabs/tabs';
import { ControlInput, ControlSelect, ControlButton } from '@/components/control/controls';
import { ArtifactPanel } from '@/vendor/aisdkagents/artifact-panel';
import { RunLog } from '@/vendor/aisdkagents/run-log';
import { AgentRunTree, type AgentRunNode } from '@/vendor/aisdkagents/agent-run-tree';

export function RunInspector({ id }: { id: string }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [run, setRun] = useState(emptyLiveRun(id));
  const [error, setError] = useState('');
  const [view, setView] = useState('summary');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [receipt, setReceipt] = useState<string>();
  const [callId, setCallId] = useState<string>();
  useEffect(() => {
    let alive = true,
      fetching = false;
    let projected = emptyLiveRun(id);
    setRun(projected);
    setWork(null);
    setError('');
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await agentRequest(`work-items/${encodeURIComponent(id)}`);
        if (alive) setWork(next);
      } catch (error) {
        if (alive) setError(error instanceof Error ? error.message : 'Could not load run.');
      } finally {
        fetching = false;
      }
    };
    void load();
    const stream = new EventSource(`/api/agent/work-items/${encodeURIComponent(id)}/events`);
    stream.addEventListener('agent', (event) => {
      try {
        projected = receiveRunEvent(projected, JSON.parse((event as MessageEvent).data));
        setRun(projected);
      } catch {
        setError('An activity receipt could not be read. Reopen this run to resync.');
      }
    });
    stream.addEventListener('state', () => {
      stream.close();
      void load();
    });
    // Delegated workers may finish after the parent's stream has settled into waiting_for_tasks.
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
      stream.close();
    };
  }, [id]);
  if (!work) return <p role={error ? 'alert' : 'status'}>{error || 'Loading run…'}</p>;
  const active = agentActiveStates.includes(work.state as (typeof agentActiveStates)[number]);
  const spans: TraceSpan[] = run.spans.flatMap((span) => {
    const durationMs = spanDuration(span);
    if (durationMs === null || !span.startedAt) return [];
    return [
      {
        id: span.id,
        kind: span.kind,
        name: span.name ?? 'MiniMax',
        startMs: Date.parse(span.startedAt),
        durationMs,
        status: span.state === 'failed' ? 'error' : 'ok',
        usage: span.usage,
        attributes: { Turn: span.turn },
      },
    ];
  });
  const status = (state: string): AgentRunNode['status'] =>
    ['failed', 'uncertain', 'budget_exhausted', 'suspended'].includes(state)
      ? 'error'
      : state === 'queued'
        ? 'queued'
        : agentActiveStates.some((s) => s === state)
          ? 'running'
          : 'done';
  const agents: AgentRunNode[] = [
    {
      id: work.id,
      name: 'Recorded execution',
      task: work.goal,
      status: status(work.state),
      step: workStatus(work.state),
      steps: run.spans.map((span) => ({
        id: span.id,
        label:
          (span.name ?? 'MiniMax response') + (span.state === 'running' && !active ? ' · no completion receipt' : ''),
        status:
          span.state === 'failed' || (span.state === 'running' && !active)
            ? 'error'
            : span.state === 'running'
              ? 'running'
              : 'done',
      })),
      agents: work.tasks.map((task) => ({
        id: task.workId,
        name: task.title,
        status: status(task.state),
        output: task.response,
      })),
    },
  ];
  const selectedReceipt = work.activity.find((event) => event.id === receipt);
  const receipts = work.activity.filter(
    (event) =>
      (kind === 'all' || event.kind === kind) &&
      `${event.summary} ${event.kind}`.toLowerCase().includes(query.toLowerCase()) &&
      (!callId || event.detail.callId === callId),
  );
  return (
    <div className="wi-inspector">
      <h2>Execution details</h2>
      <p>
        {workStatus(work.state)} · {work.usage.tokens.toLocaleString()} recorded tokens
      </p>
      {error && (
        <p role="alert" className="wi-error">
          {error}
        </p>
      )}
      <Tabs selectedKey={view} onSelectionChange={(key) => setView(String(key))}>
        <Tabs.List aria-label="Execution views" type="underline">
          <Tabs.Item id="summary">Summary</Tabs.Item>
          <Tabs.Item id="trace">Trace</Tabs.Item>
          <Tabs.Item id="receipts">Receipts</Tabs.Item>
          <Tabs.Item id="memory">Context and memory</Tabs.Item>
        </Tabs.List>
      </Tabs>
      {view === 'memory' && <ContextInspector id={id} />}
      {view === 'summary' && (
        <>
          <AgentRunTree agents={agents} title="Execution tree" working={active} showTimers={false} showTokens={false} />
          {run.spans.some((span) => span.state === 'failed') && (
            <p className="wi-notice">
              Some individual calls failed. The activity status above describes the overall outcome; inspect the trace
              and receipts for recovery details.
            </p>
          )}
          {work.state === 'uncertain' && (
            <p className="wi-error">
              The outcome is uncertain. Inspect recorded tool results before starting new work; a mutation may already
              have completed.
            </p>
          )}
          <ControlButton onPress={() => setView('trace')}>Inspect model and tool calls</ControlButton>
        </>
      )}
      {view === 'trace' && (
        <>
          {spans.length ? (
            <TraceViewer spans={spans} title="Model and tool calls" onSelect={(span) => setCallId(span.id)} />
          ) : (
            <p className="wi-secondary">Call timings appear when both start and completion receipts are recorded.</p>
          )}
          {callId && <ControlButton onPress={() => setView('receipts')}>Read selected call receipts</ControlButton>}
        </>
      )}
      {view === 'receipts' && (
        <>
          <ControlInput
            aria-label="Search execution receipts"
            placeholder="Search events"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ControlSelect aria-label="Receipt event type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All event types</option>
            {[...new Set(work.activity.map((event) => event.kind))].map((type) => (
              <option key={type} value={type}>
                {type.replaceAll('_', ' ')}
              </option>
            ))}
          </ControlSelect>
          {callId && <ControlButton onPress={() => setCallId(undefined)}>Show all calls</ControlButton>}
          <RunLog
            title="Recorded receipts"
            caption={callId ? 'Filtered to the selected call' : 'Raw event records'}
            visibleColumns={['started']}
            runs={receipts.map((event) => ({
              id: event.id,
              name: event.summary,
              stateLabel: event.kind.replaceAll('_', ' '),
              startedAt: event.createdAt,
              status: receiptStatus(event.kind),
            }))}
            onSelect={(row) => setReceipt(row.id)}
          />
          {selectedReceipt && (
            <ArtifactPanel
              title="Receipt detail"
              kind="document"
              filename="execution-receipt.json"
              versions={[
                {
                  id: selectedReceipt.id,
                  label: selectedReceipt.kind,
                  content: '```json\n' + JSON.stringify(selectedReceipt, null, 2) + '\n```',
                },
              ]}
              className="wi-receipt-detail"
            />
          )}
        </>
      )}
      {work.error && (
        <p role="alert" className="wi-error">
          {work.error}
        </p>
      )}
    </div>
  );
}
