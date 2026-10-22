'use client';
import { useEffect, useState } from 'react';
import { agentRequest } from '@/lib/agent/client';
import { DecisionInbox } from '@/vendor/aisdkagents/decision-inbox';
import { ArtifactPanel } from '@/vendor/aisdkagents/artifact-panel';
import { ControlButton, ControlModal } from '@/components/control/controls';
import { GenerativeForm } from '@/vendor/aisdkagents/generative-form';
import { MemoryGraph } from './memory-graph';
import { WorkflowIcon, DatabaseIcon, TimerIcon, Check } from '@/components/fa-icons';
import { AgentGate } from '@/vendor/aisdkagents/agent-gate';
/** Composition of runtime metadata and existing controls; never changes access. */
export function MemoryReadiness() {
  const [status, setStatus] = useState<any>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    setStatus(undefined);
    void agentRequest('memory/status')
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => {
        if (alive) setError('Memory readiness could not be checked.');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  return (
    <section className="wi-section wi-memory-readiness" aria-label="Memory runtime readiness">
      <h2>Memory readiness</h2>
      {!status && !error && <p role="status">Checking local embeddings…</p>}
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          <p role="status">
            {!status.configured
              ? 'Local embeddings are not configured'
              : status.available
                ? 'Local embeddings are available'
                : 'Local embeddings are currently unavailable'}
          </p>
          {status.model && (
            <p className="wi-secondary">
              Model: {status.model.includes('embeddinggemma') ? 'EmbeddingGemma 2 (local)' : 'Configured local model'} ·{' '}
              {status.dimensions} dimensions
            </p>
          )}
          <ul className="wi-readiness-indicators" aria-label="Graph and retrieval readiness">
            <li data-state={status.graph?.initialized ? 'ready' : 'pending'}>
              <span className="wi-readiness-icon">
                <WorkflowIcon aria-hidden="true" />
              </span>
              <div>
                <span>Workspace graph</span>
                <strong>{status.graph?.initialized ? 'Initialized' : 'Not initialized'}</strong>
              </div>
            </li>
            <li data-state="ready">
              <span className="wi-readiness-icon">
                <DatabaseIcon aria-hidden="true" />
              </span>
              <div>
                <span>Memory records</span>
                <strong>
                  {[
                    'approved_memory_version',
                    'history_segment',
                    'working_context',
                    'accepted_answer',
                    'workspace_understanding',
                  ].reduce((count, kind) => count + (status.graph?.nodes?.[kind] ?? 0), 0)}{' '}
                  in graph
                </strong>
              </div>
            </li>
            <li
              data-state={
                status.graph?.extraction?.quarantined || status.graph?.extraction?.uncertain ? 'pending' : 'ready'
              }
            >
              <span className="wi-readiness-icon">
                <TimerIcon aria-hidden="true" />
              </span>
              <div>
                <span>Relationships</span>
                <strong>
                  {status.graph?.extraction?.ready ?? 0} prepared · {status.graph?.extraction?.pending ?? 0} pending
                </strong>
              </div>
            </li>
            <li data-state={status.available ? 'ready' : 'pending'}>
              <span className="wi-readiness-icon">
                <Check aria-hidden="true" />
              </span>
              <div>
                <span>Semantic retrieval</span>
                <strong>
                  {status.indexed} of {status.approved} approved memories indexed
                </strong>
              </div>
            </li>
          </ul>
          {status.graph?.extraction?.quarantined || status.graph?.extraction?.uncertain ? (
            <p role="status">
              {status.graph.extraction.quarantined ?? 0} relationship responses need review ·{' '}
              {status.graph.extraction.uncertain ?? 0} have an uncertain outcome. Saved memories remain in the graph.
            </p>
          ) : null}
          <p className="wi-secondary">
            Relationships are prepared from approved memories during agent activities. Pending or failed extraction
            never removes a saved memory from the graph.
          </p>
          <p className="wi-secondary">
            {status.fallback} Memory still follows the published agent policy and source permissions.
          </p>
        </>
      )}
      <ControlButton onPress={() => setAttempt((value) => value + 1)}>Check readiness</ControlButton>
    </section>
  );
}
export function WorkspaceMemory({ manager }: { manager: boolean }) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState(''),
    [cursor, setCursor] = useState<string | null>(null),
    [revoking, setRevoking] = useState<any>(),
    [busy, setBusy] = useState(false);
  const load = async (after?: string) => {
    try {
      setError('');
      const page = await agentRequest('memory' + (after ? '?cursor=' + encodeURIComponent(after) : ''));
      setItems((previous) => (after ? [...previous, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load memory.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (manager) void load();
    else setLoading(false);
  }, [manager]);
  const decide = async (row: any, decision: string) => {
    setBusy(true);
    try {
      await agentRequest(`memory/${row.id}/review`, {
        clientKey: crypto.randomUUID(),
        expectedVersion: row.version,
        decision,
      });
      setRevoking(undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update memory.');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  if (!manager)
    return (
      <p role="status">
        Owners and admins manage approved workspace memory. Agents retrieve only memory allowed by their published
        policy.
      </p>
    );
  if (loading) return <p role="status">Loading workspace memory…</p>;
  const approved = items.filter((r) => r.state === 'approved'),
    row = approved.find((r) => r.id === selected);
  return (
    <div className="wi-suggestion-list">
      {error && (
        <p role="alert" className="wi-error">
          {error}
          <ControlButton onPress={() => void load()}>Retry</ControlButton>
        </p>
      )}
      <section className="wi-section">
        <h2>Reviewed knowledge for future activities</h2>
        <p>
          Memory preserves approved guidance with source evidence. It does not grant tools or knowledge access. Agents
          must enable a memory policy in a reviewed, published revision.
        </p>
      </section>
      <MemoryGraph />
      <MemoryReadiness />
      {items.some((r) => r.state === 'proposed') ? (
        <DecisionInbox
          title="Memory awaiting review"
          approveLabel="Approve memory"
          denyLabel="Reject memory"
          shortcuts={false}
          askReason={false}
          items={items
            .filter((r) => r.state === 'proposed')
            .map((r) => ({
              id: r.id,
              title: r.content,
              description: `Requested scope: ${r.scope}. Review all supporting evidence before approving.`,
              fields: r.evidence.map((e: any) => ({ label: e.kind, value: `${e.id} · ${e.revisionId}` })),
            }))}
          onDecide={async (item, decision) => {
            const current = items.find((r) => r.id === item.id);
            if (current) await decide(current, decision.approved ? 'approve' : 'reject');
          }}
        />
      ) : (
        <section className="wi-section">
          <h2>No memory awaiting review</h2>
          <p>Source-backed memory proposals from agents will appear here for owner or admin approval.</p>
        </section>
      )}
      <section className="wi-section">
        <h2>Approved memory</h2>
        {!approved.length ? (
          <p>No approved memory. Agents can propose entries through their permitted memory tool.</p>
        ) : (
          <ul className="wi-approved-memory-list" aria-label="Approved memory entries">
            {approved.map((r) => (
              <li key={r.id}>
                <ControlButton
                  className="wi-approved-memory-entry"
                  aria-pressed={selected === r.id}
                  aria-controls="wi-approved-memory-detail"
                  onPress={() => setSelected(r.id)}
                >
                  <span className="wi-approved-memory-content">{r.content}</span>
                  <span className="wi-approved-memory-meta">
                    {r.scope === 'workspace' ? 'Workspace' : 'Agent'} memory · Version {r.version} · {r.evidence.length}{' '}
                    evidence references
                  </span>
                </ControlButton>
              </li>
            ))}
          </ul>
        )}
        {row && (
          <div id="wi-approved-memory-detail" className="wi-approved-memory-detail">
            <ArtifactPanel
              title="Memory and provenance"
              kind="document"
              filename="memory.md"
              versions={[
                {
                  id: `${row.id}:${row.version}`,
                  label: `Version ${row.version}`,
                  content: [
                    '## Approved guidance',
                    row.content,
                    '## Scope and version',
                    `- Scope: ${row.scope === 'workspace' ? 'Workspace' : 'Agent'}`,
                    `- Version: ${row.version}`,
                    `- Expires: ${row.expiresAt ?? 'No expiry'}`,
                    '## Supporting evidence',
                    ...row.evidence.map(
                      (e: any, index: number) =>
                        `${index + 1}. **${e.kind}** — record \`${e.id}\`, revision \`${e.revisionId}\``,
                    ),
                  ].join('\n\n'),
                },
              ]}
            />
            <ControlButton disabled={busy} onPress={() => setRevoking(row)}>
              Revoke memory
            </ControlButton>
          </div>
        )}
      </section>
      {cursor && (
        <ControlButton disabled={busy} onPress={() => void load(cursor)}>
          Load more memory
        </ControlButton>
      )}
      {revoking && (
        <ControlModal
          label="Revoke workspace memory"
          onClose={() => {
            if (!busy) setRevoking(undefined);
          }}
        >
          <AgentGate
            variant="plan"
            title="Revoke memory"
            planTitle="Exclude this memory from future context"
            planSummary={revoking.content}
            plan={[
              {
                id: 'revoke',
                title: 'Invalidate derived context',
                detail: 'Future requests will rebuild context without this memory. Audit history is retained.',
              },
            ]}
            disabled={busy}
            approveLabel="Revoke memory"
            rejectLabel="Keep memory"
            onReject={() => setRevoking(undefined)}
            onApprove={() => void decide(revoking, 'revoke').catch(() => {})}
          />
        </ControlModal>
      )}
    </div>
  );
}
export function ContextInspector({ id }: { id: string }) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void agentRequest(`work-items/${id}/context`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading context checkpoints…</p>;
  return (
    <ArtifactPanel
      title="Context and memory checkpoints"
      kind="document"
      filename="context-manifest.json"
      versions={[
        { id, label: 'Recorded context metadata', content: '```json\n' + JSON.stringify(data, null, 2) + '\n```' },
      ]}
    />
  );
}

export function ResumeBudget({
  work,
  onSaved,
  onClose,
}: {
  work: { id: string; editVersion: number };
  onSaved: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState('');
  const key = useState(() => crypto.randomUUID())[0];
  useEffect(() => {
    void agentRequest(`work-items/${work.id}/context`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [work.id]);
  return (
    <ControlModal label="Resume activity from checkpoint" onClose={onClose}>
      <div className="wi-section">
        <h2>Resume from checkpoint</h2>
        <p>
          Completed tool receipts are retained. An extension cannot exceed the published policy ceiling or repeat an
          uncertain request.
        </p>
        {data?.budget && (
          <p>
            Current allowance: {data.budget.tokens.toLocaleString()} tokens. Maximum:{' '}
            {data.budget.ceiling.toLocaleString()} tokens.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {data?.budget && data.budget.ceiling > data.budget.tokens ? (
          <GenerativeForm
            object={{ additionalTokens: Math.min(20000, data.budget.ceiling - data.budget.tokens), reason: '' }}
            fields={[
              { name: 'additionalTokens', label: 'Additional tokens', type: 'number', required: true },
              { name: 'reason', label: 'Reason for extension', type: 'text', required: true },
            ]}
            submitLabel="Approve extension and resume"
            onSubmit={async (values) => {
              try {
                await agentRequest(`work-items/${work.id}/resume`, {
                  clientKey: key,
                  expectedVersion: work.editVersion,
                  additionalTokens: Number(values.additionalTokens),
                  reason: String(values.reason),
                });
                onSaved();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not resume.');
                throw e;
              }
            }}
          />
        ) : (
          data && (
            <p>
              The current policy does not permit an additional token grant. Start a linked activity under a reviewed
              policy.
            </p>
          )
        )}
        <ControlButton onPress={onClose}>Close</ControlButton>
      </div>
    </ControlModal>
  );
}
