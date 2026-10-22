'use client';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { controlRequest, useControl } from '@/components/control/access';
import { ControlButton, ControlInput } from '@/components/control/controls';
import { StackProcLogo } from '@/components/control/stackproc-logo';
import { OntologyEditor } from './ontology-editor';
import { IssueList } from './workspace';
import { ontologySchema, validateOntology, type Ontology } from '@/lib/knowledge/ontology';
import type { KnowledgeArtifact, KnowledgeRevision } from '@/lib/knowledge/contracts';

type Detail = { artifact: KnowledgeArtifact; revision: KnowledgeRevision };
export function OntologyWorkspace() {
  const search = useSearchParams(),
    router = useRouter(),
    { session } = useControl();
  const id = search.get('id'),
    revision = search.get('revision');
  const [detail, setDetail] = useState<Detail | null>(null),
    [value, setValue] = useState<Ontology | null>(null),
    [name, setName] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [editorError, setEditorError] = useState(''),
    [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const editCount = useRef(0);
  const readOnly =
    session.workspace?.role === 'viewer' || Boolean(revision && revision !== detail?.artifact.revisionId);
  const manager = ['owner', 'admin'].includes(session.workspace?.role ?? '');
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setValue(null);
    setError('');
    setDirty(false);
    if (!id) {
      setError('Select an ontology from Workspace knowledge.');
      return;
    }
    controlRequest(
      `/api/knowledge/artifacts/${encodeURIComponent(id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`,
    )
      .then((data) => {
        if (cancelled) return;
        if (data.artifact.kind !== 'ontology') throw new Error('This record is not an ontology.');
        setValue(ontologySchema.parse(data.revision.content));
        setName(data.artifact.name);
        setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load ontology.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, revision, session.workspace?.id]);
  const guardNavigation = useUnsavedChanges(dirty);
  const issues = value ? validateOntology(value) : [];
  async function action(type: 'save' | 'review' | 'publish') {
    if (!detail || !value) return;
    setBusy(true);
    setError('');
    const count = editCount.current;
    try {
      const base = `/api/knowledge/artifacts/${detail.artifact.id}`;
      const data =
        type === 'save'
          ? await controlRequest(
              base,
              { name, kind: 'ontology', content: value, expectedVersion: detail.artifact.editVersion },
              'PUT',
            )
          : await controlRequest(`${base}/${type}`, {
              revisionId: detail.revision.id,
              expectedVersion: detail.artifact.editVersion,
            });
      setDetail(data);
      if (count === editCount.current) setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update ontology.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sp-ontology-workspace">
      <header className="sp-ontology-header">
        <StackProcLogo />
        <div className="sp-ontology-title">
          <ControlInput
            aria-label="Ontology name"
            value={name}
            readOnly={readOnly || busy}
            placeholder="Ontology name"
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
              editCount.current++;
            }}
          />
          {detail && (
            <span className="sp-ontology-revision" aria-label={`Revision ${detail.artifact.editVersion}`}>
              r{detail.artifact.editVersion}
            </span>
          )}
          <span className="sp-ontology-save-state" data-dirty={dirty || undefined} role="status">
            {readOnly ? 'Read only' : dirty ? 'Unsaved' : detail?.revision.reviewed ? 'Reviewed' : 'Draft'}
          </span>
        </div>
        <div className="sp-ontology-header-tools" ref={setToolbarContainer} />
        <div className="sp-ontology-actions">
          {!readOnly && (
            <>
              <ControlButton
                className="cp-primary"
                disabled={busy || !dirty || !!editorError || !name.trim() || issues.some((i) => i.severity === 'error')}
                onClick={() => void action('save')}
              >
                Save
              </ControlButton>
              {!detail?.revision.reviewed && (
                <ControlButton disabled={busy || dirty || !detail} onClick={() => void action('review')}>
                  Mark reviewed
                </ControlButton>
              )}
              {manager && (
                <ControlButton
                  disabled={
                    busy ||
                    dirty ||
                    !detail?.revision.reviewed ||
                    detail?.artifact.publishedRevisionId === detail?.revision.id
                  }
                  onClick={() => void action('publish')}
                >
                  Publish
                </ControlButton>
              )}
            </>
          )}
          <ControlButton
            disabled={busy}
            onClick={() => {
              guardNavigation(() => router.push('/knowledge?view=ontology'));
            }}
          >
            Back
          </ControlButton>
        </div>
      </header>
      {error && (
        <p className="cp-error sp-ontology-status" role="alert">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <div className="sp-ontology-status">
          <IssueList issues={issues} />
        </div>
      )}
      {value ? (
        <div className="sp-ontology-surface" inert={busy}>
          <OntologyEditor
            toolbarContainer={toolbarContainer}
            onValidityChange={setEditorError}
            name={name}
            value={value}
            readOnly={readOnly}
            onChange={(next) => {
              setValue(next);
              setDirty(true);
              editCount.current++;
            }}
          />
        </div>
      ) : (
        !error && <p className="sp-ontology-status">Loading ontology…</p>
      )}
    </main>
  );
}
