'use client';
import { useWorkspaceRefresh, useWorkspaceStream } from '@/hooks/use-workspace-events';
import { useEventCallback, useInterval } from 'usehooks-ts';
import { useEffect, useRef, useState } from 'react';
import type { AgentFlow } from '@/lib/flows/types';

type Receipt = { runId: string; key: string; scheduledFor: number; number: number; updated: boolean; input: unknown };
type Run = { status: string; error?: string; output?: { result?: unknown } };
export function NativeInvocation({
  flow,
  input,
  onClose,
  onStarted,
}: {
  flow: AgentFlow;
  input: string;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [key, setKey] = useState('default');
  const [period, setPeriod] = useState(5000);
  const [value, setValue] = useState(input);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, setBusy] = useState(false);
  const receiptRef = useRef(receipt);
  receiptRef.current = receipt;
  const { status: streamStatus } = useWorkspaceStream();
  const refreshRun = useEventCallback(async () => {
    if (!receipt) return;
    const id = receipt.runId;
    try {
      const response = await fetch(`/api/runs/${id}`);
      if (response.status !== 404 && !response.ok) throw new Error('Could not refresh execution status.');
      const detail = response.ok ? await response.json() : null;
      if (receiptRef.current?.runId === id) {
        setRun(detail);
        setPollError('');
      }
    } catch {
      if (receiptRef.current?.runId === id)
        setPollError('Execution status is temporarily unavailable. Live updates will retry after reconnecting.');
    }
  });
  useEffect(() => {
    void refreshRun();
  }, [receipt, refreshRun]);
  useWorkspaceRefresh(refreshRun);
  // This timer only paints the countdown; execution state comes from SSE.
  useInterval(() => setNow(Date.now()), receipt && !run ? 250 : null);
  const remaining = receipt ? Math.max(0, (receipt.scheduledFor - now) / 1000) : 0;
  return (
    <div className="native-modal-backdrop">
      <section role="dialog" aria-modal="true" aria-label="Debounced invocation" className="native-modal">
        <h2>Debounced invocation</h2>
        <p>
          Runs the saved workflow after a quiet period. Submit again with the same key before it starts to replace its
          input and restart the countdown.
        </p>
        <label>
          Key
          <input value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label>
          Quiet period (milliseconds)
          <input
            type="number"
            min={1}
            max={86400000}
            value={period}
            onChange={(event) => setPeriod(Number(event.target.value))}
          />
        </label>
        <label>
          Workflow input (JSON)
          <textarea rows={6} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        {receipt && (
          <section className="native-invocation-receipt" aria-label="Latest accepted submission">
            <p role="status" key={receipt.number}>
              <strong>Submission {receipt.number} accepted.</strong>{' '}
              {receipt.updated ? 'Pending run updated with your latest input.' : 'New run scheduled.'}
            </p>
            <p>
              {run
                ? `Execution: ${run.status}`
                : remaining > 0
                  ? `Starts in ${remaining.toFixed(1)} seconds`
                  : 'Quiet period ended. Waiting for the worker to start…'}
            </p>
            <small>
              Key: {receipt.key} · Run: {receipt.runId.slice(0, 12)}
              <br />
              Start requested for {new Date(receipt.scheduledFor).toLocaleTimeString()}
            </small>
            <details>
              <summary>Accepted input</summary>
              <pre>{JSON.stringify(receipt.input, null, 2)}</pre>
            </details>
            {run?.output && (
              <details>
                <summary>Result</summary>
                <pre>{JSON.stringify(run.output.result, null, 2)}</pre>
              </details>
            )}
            {run?.error && <p role="alert">{run.error}</p>}
            {run && (
              <button
                onClick={() => {
                  onStarted(receipt.runId);
                  onClose();
                }}
              >
                View run →
              </button>
            )}
          </section>
        )}
        {pollError && <p role="alert">{pollError}</p>}
        {receipt && streamStatus !== 'live' && (
          <p role="status">Live updates {streamStatus}. Your accepted submission remains queued.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button onClick={onClose}>Close</button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const parsed = JSON.parse(value);
                const response = await fetch(`/api/flows/${flow.id}/debounce`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ key, periodMS: period, input: parsed }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error);
                const acceptedAt = Date.now();
                setNow(acceptedAt);
                setRun(null);
                setPollError('');
                setReceipt((previous) => ({
                  runId: payload.runId,
                  key,
                  scheduledFor: payload.scheduledFor ?? acceptedAt + period,
                  number: (previous?.number ?? 0) + 1,
                  updated: previous?.runId === payload.runId,
                  input: parsed,
                }));
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Invocation failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Submitting…' : receipt ? 'Submit again' : 'Submit latest input'}
          </button>
        </footer>
      </section>
    </div>
  );
}
