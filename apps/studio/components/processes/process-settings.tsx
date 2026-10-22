'use client';
import { useEffect, useState } from 'react';
import { ControlButton, ControlInput, ControlModal, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { Tabs } from '@/components/application/tabs/tabs';
import { SchemaFields } from '@/components/flows/schema-fields';
import { FixedValue } from '@/components/knowledge/fixed-value';
import { controlRequest } from '@/components/control/access';
import { ChevronUp, ChevronDown, Trash01 } from '@/components/fa-icons';
import { RecordAction } from '@/components/control/work-area';
import { changeProcessLanes, resizeProcessLane, processPool } from '@/lib/processes/lanes';
import { processV2Schema, type ProcessDocument } from '@/lib/processes/model';
import type { KnowledgeArtifact } from '@/lib/knowledge/contracts';
export function ProcessSettings({
  value,
  name,
  initialSection = 'general',
  readOnly,
  onApply,
  onClose,
}: {
  value: ProcessDocument;
  name: string;
  initialSection?: string;
  readOnly: boolean;
  onApply: (value: ProcessDocument, name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(value)),
    [title, setTitle] = useState(name),
    [tab, setTab] = useState(initialSection),
    [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]),
    [modules, setModules] = useState<KnowledgeArtifact[]>([]),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  useEffect(() => {
    let alive = true;
    void controlRequest('/api/knowledge/artifacts?kind=ontology')
      .then((r) => {
        if (alive) setModules(r.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    void controlRequest('/api/flows')
      .then((r) => {
        if (alive) setWorkflows(Array.isArray(r) ? r : (r.items ?? []));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const close = () =>
    !readOnly && (title !== name || JSON.stringify(draft) !== JSON.stringify(value)) ? setDiscard(true) : onClose();
  return (
    <ControlModal label="Process settings" onClose={close}>
      <section className="cp-modal process-settings">
        <header className="sp-dialog-header">
          <h2>Process settings</h2>
          <p>Define the business purpose, input and pinned domain knowledge.</p>
        </header>
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="process-settings-tabs">
          <Tabs.List aria-label="Process settings sections" type="underline">
            <Tabs.Item id="general">General</Tabs.Item>
            <Tabs.Item id="input">Input</Tabs.Item>
            <Tabs.Item id="knowledge">Knowledge</Tabs.Item>
            <Tabs.Item id="lanes">Swimlanes</Tabs.Item>
            <Tabs.Item id="implementations">Subprocesses</Tabs.Item>
          </Tabs.List>
          <Tabs.Panel id={tab} className="sp-dialog-body">
            <fieldset disabled={readOnly} className="nc-edit-fields">
              {tab === 'general' && (
                <>
                  <label>
                    Process name
                    <ControlInput value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <TextArea
                    label="Purpose"
                    value={draft.purpose}
                    onChange={(purpose) => setDraft({ ...draft, purpose })}
                  />
                  {draft.questions.map((q, i) => (
                    <label key={q.id}>
                      {q.question}
                      <ControlInput
                        value={q.answer ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            questions: draft.questions.map((item, n) =>
                              n === i ? { ...item, answer: e.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </>
              )}
              {tab === 'input' && (
                <>
                  <SchemaFields
                    label="Process input fields"
                    value={draft.inputSchema}
                    onChange={(inputSchema) =>
                      setDraft({ ...draft, inputSchema: processV2Schema.shape.inputSchema.parse(inputSchema) })
                    }
                  />
                  <h3>Default run input</h3>
                  <FixedValue
                    value={draft.defaultInput}
                    label="Run input"
                    root
                    onChange={(defaultInput) => setDraft({ ...draft, defaultInput })}
                  />
                  <p className="wi-notice">
                    Expressions receive these fields under $input.variables, preserving existing workflow behavior.
                  </p>
                </>
              )}
              {tab === 'lanes' && (
                <>
                  <p>
                    One process pool with ordered responsibility lanes. Drag activities between lanes on the canvas.
                    Removing a lane keeps its activities in Unassigned.
                  </p>
                  {(draft.lanes ?? []).map((lane, index) => (
                    <section className="process-lane-editor" key={lane.id}>
                      <header>
                        <strong>Lane {index + 1}</strong>
                        <div>
                          <RecordAction
                            label={`Move ${lane.name} up`}
                            icon={ChevronUp}
                            disabled={index === 0}
                            onPress={() => {
                              const lanes = [...draft.lanes!];
                              [lanes[index - 1], lanes[index]] = [lanes[index], lanes[index - 1]];
                              setDraft(changeProcessLanes(draft, lanes));
                            }}
                          />
                          <RecordAction
                            label={`Move ${lane.name} down`}
                            icon={ChevronDown}
                            disabled={index === draft.lanes!.length - 1}
                            onPress={() => {
                              const lanes = [...draft.lanes!];
                              [lanes[index + 1], lanes[index]] = [lanes[index], lanes[index + 1]];
                              setDraft(changeProcessLanes(draft, lanes));
                            }}
                          />
                          <RecordAction
                            label={`Remove lane ${lane.name}, keep activities`}
                            icon={Trash01}
                            onPress={() =>
                              setDraft(
                                changeProcessLanes(
                                  draft,
                                  draft.lanes!.filter((l) => l.id !== lane.id),
                                ),
                              )
                            }
                          />
                        </div>
                      </header>
                      <div className="process-lane-editor-fields">
                        <label>
                          Lane name
                          <ControlInput
                            value={lane.name}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                lanes: draft.lanes!.map((l) => (l.id === lane.id ? { ...l, name: e.target.value } : l)),
                              })
                            }
                          />
                        </label>
                        <label>
                          Responsibility role
                          <ControlSelect
                            value={lane.role ?? ''}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                lanes: draft.lanes!.map((l) => {
                                  if (l.id !== lane.id) return l;
                                  const { role, ...rest } = l;
                                  return e.target.value
                                    ? { ...rest, role: e.target.value as 'owner' | 'admin' | 'editor' | 'viewer' }
                                    : rest;
                                }),
                              })
                            }
                          >
                            <option value="">No role specified</option>
                            {['owner', 'admin', 'editor', 'viewer'].map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </ControlSelect>
                        </label>
                        <label>
                          Height (px)
                          <ControlInput
                            type="number"
                            min={280}
                            max={3000}
                            step={20}
                            value={processPool(draft)?.rows.find((r) => r.id === lane.id)?.height ?? 320}
                            onChange={(e) => {
                              const height = Number(e.target.value);
                              if (Number.isFinite(height)) setDraft(resizeProcessLane(draft, lane.id, height));
                            }}
                          />
                        </label>
                      </div>
                    </section>
                  ))}
                  <ControlButton
                    disabled={(draft.lanes?.length ?? 0) >= 30}
                    onPress={() =>
                      setDraft(
                        changeProcessLanes(draft, [
                          ...(draft.lanes ?? []),
                          { id: crypto.randomUUID(), name: `Lane ${(draft.lanes?.length ?? 0) + 1}` },
                        ]),
                      )
                    }
                  >
                    Add lane
                  </ControlButton>
                  <p className="wi-notice">
                    Responsibility roles describe ownership. Existing workspace permissions still control approvals and
                    execution.
                  </p>
                </>
              )}
              {tab === 'implementations' && (
                <>
                  <p>
                    Capture an existing workflow snapshot for subprocess, parallel or repetition activities. Later
                    workflow edits do not change this process revision.
                  </p>
                  {Object.entries(draft.implementations ?? {}).map(([ref, flow]) => (
                    <div className="wi-section-heading" key={ref}>
                      <span>
                        {flow.name} · {ref}
                      </span>
                      <RecordAction
                        label={`Remove subprocess ${flow.name}`}
                        icon={Trash01}
                        onPress={() => {
                          const next = { ...draft.implementations };
                          delete next[ref];
                          setDraft({ ...draft, implementations: next });
                        }}
                      />
                    </div>
                  ))}
                  <ControlSelect
                    aria-label="Capture subprocess workflow"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      void controlRequest(`/api/flows/${encodeURIComponent(id)}`)
                        .then((flow) => {
                          const parsed = processV2Schema.shape.implementations.parse({ [id]: flow });
                          setDraft((old) => ({ ...old, implementations: { ...old.implementations, ...parsed } }));
                        })
                        .catch((e) => setError(e.message));
                    }}
                  >
                    <option value="">Choose a workflow snapshot</option>
                    {workflows.map((flow) => (
                      <option key={flow.id} value={flow.id}>
                        {flow.name}
                      </option>
                    ))}
                  </ControlSelect>
                </>
              )}
              {tab === 'knowledge' && (
                <>
                  <p>Ontology references are pinned to a revision.</p>
                  {draft.ontologyRefs.map((ref) => (
                    <div className="wi-section-heading" key={ref.artifactId}>
                      <span>{modules.find((m) => m.id === ref.artifactId)?.name ?? ref.artifactId}</span>
                      <small>Revision: {ref.revisionId}</small>
                      {!readOnly && (
                        <RecordAction
                          label={`Remove ontology ${ref.artifactId}`}
                          icon={Trash01}
                          onPress={() =>
                            setDraft({ ...draft, ontologyRefs: draft.ontologyRefs.filter((r) => r !== ref) })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <ControlSelect
                    aria-label="Add ontology reference"
                    value=""
                    onChange={(e) => {
                      const item = modules.find((m) => m.id === e.target.value);
                      if (item)
                        setDraft({
                          ...draft,
                          ontologyRefs: [
                            ...draft.ontologyRefs,
                            { artifactId: item.id, revisionId: item.publishedRevisionId ?? item.revisionId },
                          ],
                        });
                    }}
                  >
                    <option value="">Choose an ontology</option>
                    {modules
                      .filter((m) => !draft.ontologyRefs.some((r) => r.artifactId === m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </ControlSelect>
                </>
              )}
            </fieldset>
          </Tabs.Panel>
        </Tabs>
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        {discard && (
          <div role="alert">
            <p>Discard unapplied settings?</p>
            <ControlButton onPress={() => setDiscard(false)}>Keep editing</ControlButton>
            <ControlButton onPress={onClose}>Discard changes</ControlButton>
          </div>
        )}
        <footer className="cp-actions">
          <ControlButton onPress={close}>{readOnly ? 'Close' : 'Cancel'}</ControlButton>
          {!readOnly && (
            <ControlButton
              className="cp-primary"
              onPress={() => {
                const parsed = processV2Schema.safeParse(draft);
                if (!parsed.success || !title.trim()) {
                  setError(
                    parsed.success ? 'Enter a process name.' : parsed.error.issues.map((i) => i.message).join(' '),
                  );
                  return;
                }
                onApply(parsed.data, title.trim());
                onClose();
              }}
            >
              Apply to draft
            </ControlButton>
          )}
        </footer>
      </section>
    </ControlModal>
  );
}
