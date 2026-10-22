'use client';
import { useEffect, useState } from 'react';
import { ControlButton, ControlModal } from '@/components/control/controls';
import { controlRequest } from '@/components/control/access';
export function ProcessCompilation({
  artifactId,
  expectedVersion,
  mode,
  onClose,
  navigate,
}: {
  artifactId: string;
  expectedVersion: number;
  mode: 'preview' | 'history';
  onClose: () => void;
  navigate: (url: string) => void;
}) {
  const [preview, setPreview] = useState<{
    digest: string;
    nodes: { id: string; name: string; kind: string }[];
    connections: { source: string; target: string }[];
    subprocesses: { id: string; name: string }[];
  } | null>(null);
  const [implementations, setImplementations] = useState<
    { revisionId: string; flowId: string; drifted: boolean; available: boolean; currentRevision: boolean }[]
  >([]);
  const [runs, setRuns] = useState<{ id: string; flow_id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (mode === 'preview') {
          const result = await controlRequest(`/api/knowledge/artifacts/${artifactId}/compile-preview`, {
            expectedVersion,
          });
          if (alive) setPreview(result);
        } else {
          const [result, records] = await Promise.all([
            controlRequest(`/api/knowledge/artifacts/${artifactId}/implementations`),
            controlRequest('/api/runs'),
          ]);
          if (alive) {
            setImplementations(result.items);
            setRuns(records);
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [artifactId, expectedVersion, mode]);
  const orderedNodes: NonNullable<typeof preview>['nodes'] = [];
  if (preview) {
    const remaining = new Set(preview.nodes.map((node) => node.id));
    while (remaining.size) {
      const next = preview.nodes.find(
        (node) =>
          remaining.has(node.id) &&
          !(preview.connections ?? []).some((edge) => edge.target === node.id && remaining.has(edge.source)),
      );
      if (!next) break;
      orderedNodes.push(next);
      remaining.delete(next.id);
    }
  }
  return (
    <ControlModal
      label={mode === 'preview' ? 'Review compilation' : 'Implementations and runs'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <section className="cp-modal process-settings">
        <header className="sp-dialog-header">
          <h2>{mode === 'preview' ? 'Review compilation' : 'Implementations and runs'}</h2>
          <p>
            {mode === 'preview'
              ? 'Create an executable workflow from this saved process revision. This does not start a run.'
              : 'Generated implementations retain their source revision and captured bindings.'}
          </p>
        </header>
        <div className="sp-dialog-body">
          {loading && <p role="status">Loading…</p>}
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
          {preview && (
            <>
              <p>
                {preview.nodes.length} runtime nodes · {preview.subprocesses.length} captured subprocesses
              </p>
              <ol>
                {orderedNodes.map((node) => (
                  <li key={node.id}>
                    {node.name} · {node.kind}
                  </li>
                ))}
              </ol>
              <p>Human approvals use workspace execution permissions. Responsibility lanes do not grant access.</p>
            </>
          )}
          {!loading && mode === 'history' && !implementations.length && (
            <p>No workflow has been compiled from this process.</p>
          )}
          {implementations.map((item) => (
            <section className="process-implementation" key={item.flowId}>
              <p>
                {item.currentRevision ? 'Current process revision' : 'Earlier process revision'} ·{' '}
                {item.drifted ? 'Implementation changed' : 'Matches compilation'}
              </p>
              <ControlButton
                disabled={!item.available}
                onPress={() => navigate(`/flows?flow=${encodeURIComponent(item.flowId)}`)}
              >
                Open workflow
              </ControlButton>
              {runs
                .filter((run) => run.flow_id === item.flowId)
                .map((run) => (
                  <ControlButton
                    key={run.id}
                    onPress={() =>
                      navigate(
                        `/processes?id=${artifactId}&revision=${encodeURIComponent(item.revisionId)}&run=${encodeURIComponent(run.id)}`,
                      )
                    }
                  >
                    Inspect {run.status} run · {run.id.slice(0, 8)}
                  </ControlButton>
                ))}
            </section>
          ))}
        </div>
        <footer className="cp-actions">
          <ControlButton disabled={busy} onPress={onClose}>
            {preview ? 'Cancel' : 'Close'}
          </ControlButton>
          {preview && (
            <ControlButton
              className="cp-primary"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setError('');
                void controlRequest(`/api/knowledge/artifacts/${artifactId}/generate`, {
                  expectedVersion,
                  previewDigest: preview.digest,
                })
                  .then((result) => {
                    onClose();
                    navigate(`/flows?flow=${encodeURIComponent(result.flowId)}`);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Compiling…' : 'Create workflow'}
            </ControlButton>
          )}
        </footer>
      </section>
    </ControlModal>
  );
}
