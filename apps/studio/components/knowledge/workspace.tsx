'use client';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useControl, controlRequest } from '@/components/control/access';
import { ControlButton, ControlInput, ControlModal } from '@/components/control/controls';
import { WorkArea, TableViewport, RecordAction, EmptyState } from '@/components/control/work-area';
import { Table } from '@/components/application/table/table';
import { TextArea } from '@/components/base/textarea/textarea';
import { Plus, UploadIcon, Edit01, Check, Eye } from '@/components/fa-icons';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import type { KnowledgeArtifact, KnowledgeIssue, KnowledgeRevision } from '@/lib/knowledge/contracts';
import { ontologySchema, validateOntology, type Ontology } from '@/lib/knowledge/ontology';
import { processSchema, validateProcess, type Process } from '@/lib/knowledge/process';
import { OntologyEditor, ProcessEditor, blankOntology, blankProcess } from './editors';
type Detail = { artifact: KnowledgeArtifact; revision: KnowledgeRevision; issues: KnowledgeIssue[] };
export function KnowledgeWorkspace({ sources = false }: { sources?: boolean }) {
  const { session } = useControl(),
    baseEditable = session.workspace?.role !== 'viewer',
    manager = ['owner', 'admin'].includes(session.workspace?.role ?? '');
  const router = useRouter(),
    search = useSearchParams(),
    selected = search.get('id'),
    revision = search.get('revision'),
    block = search.get('block');
  const kind = sources ? 'source' : search.get('view') === 'process' ? 'process' : 'ontology';
  const [items, setItems] = useState<KnowledgeArtifact[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null),
    [name, setName] = useState(''),
    [content, setContent] = useState<unknown>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [newKind, setNewKind] = useState<string | null>(null),
    [sourceName, setSourceName] = useState(''),
    [text, setText] = useState('');
  const [processTab, setProcessTab] = useState<'overview' | 'input' | 'steps'>('overview');
  const [canUploadSource, setCanUploadSource] = useState(false);
  const editable = baseEditable && (!sources || canUploadSource);
  const guardNavigation = useUnsavedChanges(dirty);
  const file = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await controlRequest(`/api/knowledge/artifacts?kind=${kind}`);
      if (sources) {
        const permissions = await controlRequest('/api/agent/context-permissions');
        setCanUploadSource(permissions.canUpload);
      }
      setItems(data.items);
      setCursor(data.nextCursor);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load knowledge.');
    } finally {
      setLoading(false);
    }
  }, [kind, sources, session.workspace?.id]);
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);
  useWorkspaceRefresh(refresh);
  const load = useCallback(async () => {
    if (!selected && !revision) {
      setDetail(null);
      return;
    }
    setError('');
    try {
      let artifactId = selected;
      if (!artifactId && revision) {
        const source = await controlRequest(`/api/knowledge/revisions/${encodeURIComponent(revision)}`);
        artifactId = source.artifact.id;
      }
      const data = await controlRequest(
        `/api/knowledge/artifacts/${encodeURIComponent(artifactId!)}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`,
      );
      if (data.artifact.kind === 'process') {
        router.replace(
          `/processes?id=${encodeURIComponent(data.artifact.id)}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}${block ? `&element=${encodeURIComponent(block)}` : ''}`,
        );
        return;
      }
      if (data.artifact.kind === 'ontology') {
        router.replace(
          `/ontology?id=${encodeURIComponent(data.artifact.id)}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}`,
        );
        return;
      }
      setDetail(data);
      setName(data.artifact.name);
      setContent(data.revision.content);
      setDirty(false);
      setProcessTab('overview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load artifact.');
    }
  }, [selected, revision, router]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  const issues =
    detail?.artifact.kind === 'ontology'
      ? validateOntology(content)
      : detail?.artifact.kind === 'process'
        ? validateProcess(content)
        : [];
  const readOnly = !editable || Boolean(revision && revision !== detail?.artifact.revisionId);
  if (detail)
    return (
      <WorkArea
        title={name}
        description={`${detail.artifact.kind} · revision ${detail.artifact.editVersion}${dirty ? ' · Unsaved changes' : ''}`}
        scroll
        contextKey={detail.artifact.kind === 'process' ? `${detail.artifact.id}:${processTab}` : detail.artifact.id}
        navigation={
          detail.artifact.kind === 'process'
            ? {
                label: 'Process sections',
                value: processTab,
                items: [
                  { id: 'overview', label: 'Overview' },
                  { id: 'input', label: 'Inputs' },
                  { id: 'steps', label: `Steps (${(content as Process).steps.length})` },
                ],
                onChange: (id) => setProcessTab(id as typeof processTab),
              }
            : undefined
        }
        actions={
          <>
            <ControlButton
              disabled={busy}
              onClick={() => {
                guardNavigation(() => router.push(sources ? '/sources' : `/knowledge?view=${kind}`));
              }}
            >
              Back
            </ControlButton>
            {!readOnly && detail.artifact.kind !== 'source' && (
              <ControlButton
                disabled={busy || !dirty || issues.some((i) => i.severity === 'error')}
                className="cp-primary"
                onClick={() =>
                  void action(async () => {
                    const updated = await controlRequest(
                      `/api/knowledge/artifacts/${detail.artifact.id}`,
                      { name, kind: detail.artifact.kind, content, expectedVersion: detail.artifact.editVersion },
                      'PUT',
                    );
                    setDetail(updated);
                    setDirty(false);
                  })
                }
              >
                Save revision
              </ControlButton>
            )}
            {!readOnly && (
              <ControlButton
                disabled={busy || dirty || detail.revision.reviewed}
                iconLeading={Check}
                onClick={() =>
                  void action(async () => {
                    const updated = await controlRequest(`/api/knowledge/artifacts/${detail.artifact.id}/review`, {
                      revisionId: detail.revision.id,
                      expectedVersion: detail.artifact.editVersion,
                    });
                    setDetail({ ...updated, issues });
                  })
                }
              >
                {detail.revision.reviewed ? 'Reviewed' : 'Mark reviewed'}
              </ControlButton>
            )}
            {manager && detail.artifact.kind !== 'source' && (
              <ControlButton
                disabled={
                  busy ||
                  dirty ||
                  !detail.revision.reviewed ||
                  detail.artifact.publishedRevisionId === detail.revision.id
                }
                onClick={() =>
                  void action(async () => {
                    const updated = await controlRequest(`/api/knowledge/artifacts/${detail.artifact.id}/publish`, {
                      revisionId: detail.revision.id,
                      expectedVersion: detail.artifact.editVersion,
                    });
                    setDetail({ ...updated, issues });
                  })
                }
              >
                Publish revision
              </ControlButton>
            )}
            {detail.artifact.kind === 'process' && editable && (
              <ControlButton
                className="cp-primary"
                disabled={busy || dirty || !detail.revision.reviewed || issues.length > 0}
                onClick={() =>
                  void action(async () => {
                    const result = await controlRequest(`/api/knowledge/artifacts/${detail.artifact.id}/generate`, {
                      expectedVersion: detail.artifact.editVersion,
                    });
                    router.push(`/flows?flow=${encodeURIComponent(result.flowId)}`);
                  })
                }
              >
                Create workflow draft
              </ControlButton>
            )}
          </>
        }
        status={
          error ? (
            <p className="cp-error" role="alert">
              {error}
            </p>
          ) : undefined
        }
      >
        <div className={`wi-detail${detail.artifact.kind === 'process' ? ' wi-process-detail' : ''}`}>
          {issues.length > 0 && <IssueList issues={issues} />}
          {detail.artifact.kind !== 'source' && (detail.artifact.kind !== 'process' || processTab === 'overview') && (
            <label>
              Artifact name
              <ControlInput
                value={name}
                readOnly={readOnly}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
          )}
          {detail.artifact.kind === 'ontology' ? (
            <OntologyEditor
              value={content as Ontology}
              readOnly={readOnly}
              onChange={(v) => {
                setContent(v);
                setDirty(true);
              }}
            />
          ) : detail.artifact.kind === 'process' ? (
            <ProcessEditor
              section={processTab}
              value={content as Process}
              readOnly={readOnly}
              onChange={(v) => {
                setContent(v);
                setDirty(true);
              }}
            />
          ) : (
            <SourceBlocks sourceId={detail.artifact.id} revisionId={detail.revision.id} selectedBlock={block} />
          )}
        </div>
      </WorkArea>
    );
  return (
    <WorkArea
      title={sources ? 'Sources' : 'Knowledge'}
      description={
        sources
          ? 'Import and inspect process documents for your workspace.'
          : 'Define the domain and process knowledge used to build workflows.'
      }
      scroll={false}
      contextKey={kind}
      actions={
        <>
          <ControlInput
            aria-label="Search knowledge"
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ControlButton onClick={() => void refresh()}>Refresh</ControlButton>
          {editable && (
            <ControlButton
              iconLeading={sources ? UploadIcon : Plus}
              className="cp-primary"
              onClick={() => {
                setSourceName('');
                setText('');
                setNewKind(kind);
              }}
            >
              {sources ? 'Import document' : kind === 'process' ? 'New process' : 'New ontology'}
            </ControlButton>
          )}
        </>
      }
      navigation={
        sources
          ? undefined
          : {
              label: 'Knowledge views',
              value: kind,
              items: [
                { id: 'ontology', label: 'Ontologies' },
                { id: 'process', label: 'Processes' },
              ],
              onChange: (id) => router.push(`/knowledge?view=${id}`),
            }
      }
      status={
        error ? (
          <p className="cp-error" role="alert">
            {error}
          </p>
        ) : undefined
      }
      footer={
        <>
          <span>{items.length} loaded</span>
          {cursor && (
            <ControlButton
              onClick={() =>
                void action(async () => {
                  const data = await controlRequest(
                    `/api/knowledge/artifacts?kind=${kind}&cursor=${encodeURIComponent(cursor)}`,
                  );
                  setItems((old) => [...old, ...data.items]);
                  setCursor(data.nextCursor);
                })
              }
            >
              Load more
            </ControlButton>
          )}
        </>
      }
    >
      {loading ? (
        <EmptyState title="Loading knowledge…">Please wait.</EmptyState>
      ) : items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())).length ? (
        <TableViewport label="Knowledge records">
          <Table aria-label={sources ? 'Source documents' : 'Knowledge artifacts'}>
            <Table.Header>
              <Table.Head isRowHeader>Name</Table.Head>
              <Table.Head>Revision</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Actions</Table.Head>
            </Table.Header>
            <Table.Body>
              {items
                .filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
                .map((item) => (
                  <Table.Row id={item.id} key={item.id}>
                    <Table.Cell>
                      <strong>{item.name}</strong>
                    </Table.Cell>
                    <Table.Cell>{item.editVersion}</Table.Cell>
                    <Table.Cell>{item.publishedRevisionId === item.revisionId ? 'Published' : 'Draft'}</Table.Cell>
                    <Table.Cell>
                      <RecordAction
                        label={`Open ${item.name}`}
                        icon={sources ? Eye : Edit01}
                        href={`${sources ? '/sources' : kind === 'ontology' ? '/ontology' : '/processes'}?id=${encodeURIComponent(item.id)}${sources ? '' : `&view=${kind}`}`}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
            </Table.Body>
          </Table>
        </TableViewport>
      ) : (
        <EmptyState title={query ? 'No matching records' : sources ? 'No source documents' : 'No knowledge yet'}>
          {sources
            ? 'Import a text or Markdown process document to begin.'
            : 'Create an ontology or process to define your workspace.'}
        </EmptyState>
      )}
      {newKind && (
        <ControlModal
          label={sources ? 'Import source document' : 'Create knowledge artifact'}
          onClose={() => {
            if (!busy) setNewKind(null);
          }}
        >
          <form
            className="cp-modal"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const data = await controlRequest('/api/knowledge/artifacts', {
                  name: sourceName,
                  kind: newKind,
                  content:
                    newKind === 'source'
                      ? { schemaVersion: 1, mediaType: 'text/plain', text }
                      : newKind === 'ontology'
                        ? blankOntology()
                        : blankProcess(),
                });
                setNewKind(null);
                router.push(
                  `${sources ? '/sources' : newKind === 'ontology' ? '/ontology' : '/processes'}?id=${data.artifact.id}${sources ? '' : `&view=${newKind}`}`,
                );
              });
            }}
          >
            <header className="sp-dialog-header">
              <h2>{sources ? 'Import process document' : 'Create knowledge'}</h2>
              <p>
                {sources
                  ? 'Text and Markdown are supported in this increment. PDF, DOCX and scanned documents need additional extraction adapters.'
                  : 'Start with a name, then define its structured content.'}
              </p>
            </header>
            <div className="sp-dialog-body">
              <label>
                Name
                <ControlInput
                  required
                  value={sourceName}
                  maxLength={200}
                  onChange={(e) => setSourceName(e.target.value)}
                />
              </label>
              {sources && (
                <>
                  <input
                    hidden
                    ref={file}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      if (!selected) return;
                      void action(async () => {
                        if (!/\.(txt|md)$/i.test(selected.name)) throw new Error('Select a .txt or .md document.');
                        if (selected.size > 250000) throw new Error('Document exceeds the 250 KB text import limit.');
                        const bytes = await selected.arrayBuffer();
                        setText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                        if (!sourceName) setSourceName(selected.name.replace(/\.[^.]+$/, ''));
                      });
                      e.target.value = '';
                    }}
                  />
                  <ControlButton iconLeading={UploadIcon} onClick={() => file.current?.click()}>
                    Choose text or Markdown file
                  </ControlButton>
                  <TextArea label="Document content" value={text} onChange={setText} rows={10} />
                </>
              )}
              {error && (
                <p className="cp-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer>
              <ControlButton onClick={() => setNewKind(null)} disabled={busy}>
                Cancel
              </ControlButton>
              <ControlButton
                type="submit"
                className="cp-primary"
                disabled={busy || !sourceName.trim() || (sources && !text.trim())}
              >
                {sources ? 'Import source' : 'Create draft'}
              </ControlButton>
            </footer>
          </form>
        </ControlModal>
      )}
    </WorkArea>
  );
}
export function IssueList({ issues }: { issues: KnowledgeIssue[] }) {
  return (
    <section className="wi-issues" aria-label="Validation issues">
      <h2>Needs attention</h2>
      <ul>
        {issues.map((i, n) => (
          <li key={`${i.path}-${n}`}>
            <strong>{i.severity === 'error' ? 'Error: ' : ''}</strong>
            {i.message}
            <small>{i.path}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function SourceBlocks({
  sourceId,
  revisionId,
  selectedBlock,
}: {
  sourceId: string;
  revisionId: string;
  selectedBlock?: string | null;
}) {
  const [blocks, setBlocks] = useState<{ id: string; text: string }[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void controlRequest(`/api/knowledge/artifacts/${sourceId}/blocks?revision=${encodeURIComponent(revisionId)}`)
      .then((data) => {
        if (active) setBlocks(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [sourceId, revisionId]);
  useEffect(() => {
    if (selectedBlock) document.getElementById(selectedBlock)?.scrollIntoView({ block: 'nearest' });
  }, [selectedBlock, blocks]);
  return (
    <div className="wi-source-blocks">
      {error && <p role="alert">{error}</p>}
      {blocks.map((b) => (
        <section className={`wi-source-block${selectedBlock === b.id ? ' selected' : ''}`} id={b.id} key={b.id}>
          <small>{b.id}</small>
          <p>{b.text}</p>
        </section>
      ))}
    </div>
  );
}
