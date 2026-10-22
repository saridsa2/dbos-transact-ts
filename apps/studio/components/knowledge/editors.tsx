'use client';
import { useEffect, useState } from 'react';
import { FixedValue } from './fixed-value';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { TextArea } from '@/components/base/textarea/textarea';
import { RecordAction } from '@/components/control/work-area';
import { Plus, Trash01, ChevronUp, ChevronDown } from '@/components/fa-icons';
import { ParameterFields } from '@/components/flows/parameter-fields';
import { controlRequest } from '@/components/control/access';
import type { KnowledgeArtifact, ArtifactRef } from '@/lib/knowledge/contracts';
import { SchemaFields } from '@/components/flows/schema-fields';
import type { Ontology } from '@/lib/knowledge/ontology';
import type { Process } from '@/lib/knowledge/process';
import type { Evidence } from '@/lib/knowledge/contracts';
export const blankOntology = (): Ontology => ({ schemaVersion: 1, description: '', entities: [], relationships: [] });
export const blankProcess = (): Process => ({
  schemaVersion: 1,
  purpose: 'Describe the business process.',
  ontologyRefs: [],
  inputSchema: { type: 'object' },
  defaultInput: {},
  steps: [
    {
      id: 'result',
      name: 'Return result',
      kind: 'return',
      value: { mode: 'expression', expression: '$input.variables' },
      evidence: [],
    },
  ],
  questions: [],
});
function EvidenceLinks({ items }: { items: Evidence[] }) {
  return items.length ? (
    <div className="wi-evidence">
      {items.map((e, i) =>
        e.kind === 'source' ? (
          <a
            key={i}
            href={`/sources?revision=${encodeURIComponent(e.revisionId)}&block=${encodeURIComponent(e.blockId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Source · {e.blockId} ↗
          </a>
        ) : (
          <span key={i}>{e.kind === 'inference' ? 'Agent inference · review required' : 'User decision'}</span>
        ),
      )}
    </div>
  ) : null;
}
export { OntologyEditor } from './ontology-editor';
export function ProcessEditor({
  value,
  onChange,
  readOnly = false,
  section = 'all',
}: {
  section?: 'all' | 'overview' | 'input' | 'steps';
  value: Process;
  onChange: (v: Process) => void;
  readOnly?: boolean;
}) {
  function move(i: number, delta: number) {
    const steps = [...value.steps];
    [steps[i], steps[i + delta]] = [steps[i + delta], steps[i]];
    onChange({ ...value, steps });
  }
  return (
    <div className="wi-editor">
      {(section === 'all' || section === 'overview') && (
        <>
          <TextArea
            label="Purpose"
            value={value.purpose}
            isReadOnly={readOnly}
            onChange={(purpose) => onChange({ ...value, purpose })}
          />
          <OntologyBindings
            value={value.ontologyRefs}
            readOnly={readOnly}
            onChange={(ontologyRefs) => onChange({ ...value, ontologyRefs })}
          />
        </>
      )}
      {(section === 'all' || section === 'input') && (
        <>
          {readOnly ? (
            <section className="wi-card">
              <h2>Workflow input</h2>
              <pre>{JSON.stringify({ schema: value.inputSchema, defaults: value.defaultInput }, null, 2)}</pre>
            </section>
          ) : (
            <>
              <SchemaFields
                label="Workflow input fields"
                value={value.inputSchema}
                onChange={(inputSchema) => onChange({ ...value, inputSchema: inputSchema as Process['inputSchema'] })}
              />
              <FixedObject
                value={value.defaultInput}
                onChange={(defaultInput) => onChange({ ...value, defaultInput })}
              />
            </>
          )}
        </>
      )}
      {(section === 'all' || section === 'steps') && (
        <>
          <div className="wi-section-heading">
            <h2>Process steps</h2>
            {!readOnly && (
              <ControlButton
                iconLeading={Plus}
                onClick={() =>
                  onChange({
                    ...value,
                    steps: [
                      ...value.steps,
                      {
                        id: crypto.randomUUID(),
                        name: 'Required business action',
                        kind: 'requirement',
                        capability: 'Describe the operation this action needs.',
                        evidence: [],
                      },
                    ],
                  })
                }
              >
                Add step
              </ControlButton>
            )}
          </div>
          {value.steps.map((step, i) => (
            <section className="wi-card" key={step.id}>
              <div className="wi-section-heading">
                <h3>
                  {i + 1}. {step.name}
                </h3>
                {!readOnly && (
                  <div className="wi-inline-actions">
                    <RecordAction
                      label={`Move ${step.name} up`}
                      icon={ChevronUp}
                      disabled={i === 0}
                      onPress={() => move(i, -1)}
                    />
                    <RecordAction
                      label={`Move ${step.name} down`}
                      icon={ChevronDown}
                      disabled={i === value.steps.length - 1}
                      onPress={() => move(i, 1)}
                    />
                    <RecordAction
                      label={`Remove step ${step.name}`}
                      icon={Trash01}
                      onPress={() => onChange({ ...value, steps: value.steps.filter((_, n) => n !== i) })}
                    />
                  </div>
                )}
              </div>
              <div className="wi-form-grid">
                <label>
                  Step name
                  <ControlInput
                    value={step.name}
                    readOnly={readOnly}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        steps: value.steps.map((s, n) => (n === i ? { ...s, name: e.target.value } : s)),
                      })
                    }
                  />
                </label>
                <label>
                  Operation
                  <ControlSelect
                    value={step.kind}
                    disabled={readOnly}
                    onChange={(e) => {
                      const kind = e.target.value as typeof step.kind;
                      onChange({
                        ...value,
                        steps: value.steps.map((s, n) =>
                          n === i
                            ? {
                                id: s.id,
                                name: s.name,
                                evidence: s.evidence,
                                ...(kind === 'requirement'
                                  ? { kind, capability: 'Describe the required capability.' }
                                  : {
                                      kind,
                                      value:
                                        s.kind === 'requirement' ? { mode: 'fixed' as const, value: null } : s.value,
                                    }),
                              }
                            : s,
                        ),
                      });
                    }}
                  >
                    <option value="requirement">Business capability requirement</option>
                    <option value="construct">Construct a value</option>
                    <option value="return">Return the result</option>
                  </ControlSelect>
                </label>
              </div>
              {step.kind === 'requirement' ? (
                <TextArea
                  label="Required capability"
                  value={step.capability}
                  isReadOnly={readOnly}
                  onChange={(capability) =>
                    onChange({
                      ...value,
                      steps: value.steps.map((s, n) =>
                        n === i && s.kind === 'requirement' ? { ...s, capability } : s,
                      ),
                    })
                  }
                />
              ) : readOnly ? (
                <p>
                  {step.value.mode === 'expression'
                    ? step.value.expression
                    : step.value.mode === 'fixed'
                      ? JSON.stringify(step.value.value)
                      : 'Structured value'}
                </p>
              ) : (
                <ParameterFields
                  label={step.kind === 'return' ? 'Result' : 'Constructed value'}
                  path={`steps.${i}.value`}
                  value={step.value}
                  onChange={(parameter) =>
                    onChange({
                      ...value,
                      steps: value.steps.map((s, n) =>
                        n === i && s.kind !== 'requirement' ? { ...s, value: parameter } : s,
                      ),
                    })
                  }
                />
              )}
              <small>Reference: {step.id}</small>
              <EvidenceLinks items={step.evidence} />
            </section>
          ))}
          {value.questions.length > 0 && (
            <section className="wi-card">
              <h2>Clarifications</h2>
              {value.questions.map((q, i) => (
                <label key={q.id}>
                  {q.question}
                  <ControlInput
                    value={q.answer ?? ''}
                    readOnly={readOnly}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        questions: value.questions.map((v, n) => (n === i ? { ...v, answer: e.target.value } : v)),
                      })
                    }
                  />
                </label>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FixedObject({
  value,
  onChange,
}: {
  value: Process['defaultInput'];
  onChange: (v: Process['defaultInput']) => void;
}) {
  return (
    <section className="wi-card">
      <h2>Default run input</h2>
      <p>Concrete values used when a workflow run starts.</p>
      <FixedValue value={value} onChange={onChange} label="Run input" root />
    </section>
  );
}

function OntologyBindings({
  value,
  onChange,
  readOnly,
}: {
  value: ArtifactRef[];
  onChange: (v: ArtifactRef[]) => void;
  readOnly: boolean;
}) {
  const [modules, setModules] = useState<KnowledgeArtifact[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void controlRequest('/api/knowledge/artifacts?kind=ontology')
      .then((data) => {
        if (active) setModules(data.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="wi-card">
      <h2>Domain ontology references</h2>
      <p>References are pinned to a revision. Review referenced drafts before generating a workflow.</p>
      {error && <p role="alert">{error}</p>}
      {value.map((ref) => (
        <div className="wi-section-heading" key={`${ref.artifactId}:${ref.revisionId}`}>
          <a
            href={`/knowledge?id=${encodeURIComponent(ref.artifactId)}&revision=${encodeURIComponent(ref.revisionId)}`}
            target="_blank"
            rel="noreferrer"
          >
            {modules.find((m) => m.id === ref.artifactId)?.name ?? ref.artifactId}
          </a>
          <small>Revision: {ref.revisionId}</small>
          {!readOnly && (
            <RecordAction
              label={`Remove ontology reference ${ref.artifactId}`}
              icon={Trash01}
              onPress={() => onChange(value.filter((v) => v !== ref))}
            />
          )}
        </div>
      ))}
      {!readOnly && (
        <ControlSelect
          aria-label="Add ontology reference"
          value=""
          onChange={(e) => {
            const module = modules.find((m) => m.id === e.target.value);
            if (module)
              onChange([
                ...value,
                { artifactId: module.id, revisionId: module.publishedRevisionId ?? module.revisionId },
              ]);
          }}
        >
          <option value="">Select an ontology</option>
          {modules
            .filter((m) => !value.some((ref) => ref.artifactId === m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.publishedRevisionId ? 'Published' : 'Current draft'}
              </option>
            ))}
        </ControlSelect>
      )}
    </section>
  );
}
