'use client';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import { ControlButton, ControlInput, ControlModal } from '@/components/control/controls';
import { WorkArea, TableViewport, RecordAction, EmptyState } from '@/components/control/work-area';
import { Table } from '@/components/application/table/table';
import { useControl } from '@/components/control/access';
import { nativeExamples, blankNativeGraph } from '@/lib/native/examples';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Edit01, Plus, UploadIcon, Trash01 } from '@/components/fa-icons';
import type { AgentFlow } from '@/lib/flows/types';

export default function StudioHome() {
  const { session } = useControl();
  const editable = session.workspace?.role !== 'viewer';
  const router = useRouter();
  const search = useSearchParams();
  const view = search.get('view') === 'examples' ? 'examples' : 'saved';
  const [flows, setFlows] = useState<AgentFlow[]>([]);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const query = queries[view] ?? '';
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentFlow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const response = await fetch('/api/flows');
      if (!response.ok) throw new Error('Could not load workflows. Please retry.');
      const data = await response.json();
      if (id === requestId.current) {
        setFlows(data);
        setLoadError('');
      }
    } catch (err) {
      if (id === requestId.current) setLoadError(err instanceof Error ? err.message : 'Could not load workflows.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current++;
    };
  }, [refresh]);
  useWorkspaceRefresh(refresh);
  async function create(flow: AgentFlow = { ...blankNativeGraph(), authoringVersion: 2, declarations: [] }) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(flow),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save workflow.');
      router.push(`/flows?flow=${encodeURIComponent(body.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workflow.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteWorkflow() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(`/api/flows/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Could not delete workflow.');
      }
      setFlows((old) => old.filter((flow) => flow.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete workflow.');
    } finally {
      setDeleting(false);
    }
  }
  const filteredFlows = flows.filter((f) =>
    `${f.name} ${f.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const examples = nativeExamples().filter((e) =>
    `${e.title} ${e.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <WorkArea
      title="Workflows"
      description={
        view === 'saved' ? 'Build and manage your saved workflows.' : 'Start a workflow from a DBOS example.'
      }
      contextKey={view}
      scroll={view === 'examples'}
      actions={
        <>
          <ControlInput
            aria-label={view === 'saved' ? 'Search workflows' : 'Search examples'}
            placeholder={view === 'saved' ? 'Search workflows' : 'Search examples'}
            value={query}
            onChange={(e) => setQueries((old) => ({ ...old, [view]: e.target.value }))}
          />
          <ControlButton onClick={() => void refresh()}>Refresh</ControlButton>
          {editable && (
            <>
              <input
                ref={upload}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await create(JSON.parse(await file.text()));
                  } catch {
                    setError('Select a valid workflow JSON file.');
                  }
                  e.target.value = '';
                }}
              />
              <ControlButton disabled={busy} iconLeading={UploadIcon} onClick={() => upload.current?.click()}>
                Import graph
              </ControlButton>
              <ControlButton className="cp-primary" disabled={busy} iconLeading={Plus} onClick={() => void create()}>
                New workflow
              </ControlButton>
            </>
          )}
        </>
      }
      navigation={{
        label: 'Workflow views',
        value: view,
        items: [
          { id: 'saved', label: 'Saved workflows' },
          { id: 'examples', label: 'Examples' },
        ],
        onChange: (id) => router.push(id === 'saved' ? '/' : '/?view=examples'),
      }}
      status={
        error ? (
          <p className="cp-error" role="alert">
            {error}
          </p>
        ) : undefined
      }
      footer={
        view === 'examples' || (!loading && !loadError) ? (
          <span>
            {view === 'saved'
              ? `${filteredFlows.length} workflows`
              : `${examples.length} examples · Local example handlers; provider access is configured separately.`}
          </span>
        ) : undefined
      }
    >
      {view === 'saved' ? (
        loading ? (
          <div className="sp-empty" role="status">
            Loading workflows…
          </div>
        ) : loadError ? (
          <div className="sp-empty" role="alert">
            <h2>Could not load workflows</h2>
            <p>{loadError}</p>
          </div>
        ) : filteredFlows.length ? (
          <TableViewport label="Scrollable workflows">
            <Table aria-label="Saved workflows">
              <Table.Header>
                <Table.Head isRowHeader>Workflow</Table.Head>
                <Table.Head>Nodes</Table.Head>
                <Table.Head>Edges</Table.Head>
                <Table.Head>Actions</Table.Head>
              </Table.Header>
              <Table.Body>
                {filteredFlows.map((f) => (
                  <Table.Row key={f.id} id={f.id}>
                    <Table.Cell>
                      <strong>{f.name}</strong>
                      <small>{f.description || 'Workflow graph'}</small>
                    </Table.Cell>
                    <Table.Cell>{f.nodes.length}</Table.Cell>
                    <Table.Cell>{f.edges.length}</Table.Cell>
                    <Table.Cell>
                      <div className="sp-row-actions">
                        <RecordAction
                          label={`Open ${f.name}`}
                          icon={Edit01}
                          href={`/flows?flow=${encodeURIComponent(f.id)}`}
                        />
                        {editable && (
                          <RecordAction
                            label={`Delete ${f.name}`}
                            icon={Trash01}
                            onPress={() => {
                              setDeleteError('');
                              setDeleteTarget(f);
                            }}
                          />
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </TableViewport>
        ) : (
          <EmptyState title={query ? 'No matching workflows' : 'No saved workflows'}>
            {query
              ? 'Try another search.'
              : editable
                ? 'Use New workflow, Import graph or the Examples tab to get started.'
                : 'Saved workflows will appear here.'}
          </EmptyState>
        )
      ) : examples.length ? (
        <div className="sp-examples">
          {examples.map((e) => (
            <article className="sp-example" key={e.id}>
              <h2>{e.title}</h2>
              <p>{e.description}</p>
              <small>{e.source}</small>
              {editable ? (
                <ControlButton disabled={busy} onClick={() => void create(e.flow)}>
                  Use example
                </ControlButton>
              ) : (
                <span>Editor access required to create a workflow.</span>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No matching examples">Try another search.</EmptyState>
      )}
      {deleteTarget && (
        <ControlModal
          label="Delete workflow"
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <section className="cp-modal">
            <header className="sp-dialog-header">
              <h2>Delete workflow?</h2>
              <p>
                Delete “{deleteTarget.name}” and its schedule? This cannot be undone. Existing runs and their history
                are retained.
              </p>
            </header>
            {deleteError && (
              <p className="cp-error" role="alert">
                {deleteError}
              </p>
            )}
            <footer>
              <ControlButton disabled={deleting} onClick={() => setDeleteTarget(null)}>
                Cancel
              </ControlButton>
              <ControlButton color="primary-destructive" disabled={deleting} onClick={() => void deleteWorkflow()}>
                {deleting ? 'Deleting…' : 'Delete workflow'}
              </ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
    </WorkArea>
  );
}
