'use client';
import { useEffect, useState } from 'react';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { Plus, X } from '@/components/fa-icons';
import type { AgentFlow, FlowNodeData } from '@/lib/flows/types';
import { operationSchema, type Binding, type NativeOperation, type Predicate } from '@/lib/native/model';
import { configDefinition, type ConfigTab } from '@/lib/native/node-config';
import { FieldValidation } from './field-validation';
import { ParameterFields } from './parameter-fields';
import { parameterFromBinding } from '@/lib/authoring/model';
import { BindingFields, PredicateFields } from './binding-fields';
export function NativeNodeFields({
  node,
  onChange,
  tab = 'operation',
  flow,
  upstream,
  onInspectDefinition,
  onCreateDefinition,
  fields,
}: {
  node: FlowNodeData;
  onChange: (patch: Partial<FlowNodeData>) => void;
  tab?: ConfigTab;
  fields?: string[];
  flow?: AgentFlow;
  upstream?: FlowNodeData[];
  onInspectDefinition?: (ref: string) => void;
  onCreateDefinition?: () => string;
}) {
  const [catalog, setCatalog] = useState<{
    steps: { id: string; name: string }[];
    transactions: { id: string; name: string }[];
  }>({ steps: [], transactions: [] });
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [text, setText] = useState(node.config.operationDraft ?? JSON.stringify(node.config.operation, null, 2));
  useEffect(() => {
    let active = true;
    void fetch('/api/native/catalog')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load registered operations.');
        return response.json();
      })
      .then((result) => {
        if (active) {
          setCatalog(result);
          setCatalogError('');
        }
      })
      .catch((err) => {
        if (active) setCatalogError(err.message);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const op = node.config.operation!;
  const def = configDefinition(node)!;
  const choices = upstream ?? [];
  function update(key: string, value: unknown) {
    const operation = { ...op, [key]: value };
    if (value === undefined) delete (operation as Record<string, unknown>)[key];
    onChange({ config: { operation: operation as NativeOperation, operationDraft: undefined } });
  }
  function renderParameter(key: string, binding: Binding, label: string) {
    return (
      <ParameterFields
        value={node.config.parameters?.[key] ?? parameterFromBinding(binding)}
        schema={key === 'input' ? node.config.ports?.input?.schema : undefined}
        optional={key === 'partition' || key === 'delaySeconds'}
        onChange={(next) => onChange({ config: { parameters: { ...node.config.parameters, [key]: next } } })}
        label={label}
        path={`config.parameters.${key}`}
      />
    );
  }
  if (tab === 'advanced')
    return (
      <>
        <p>Advanced view of this node’s operation and bindings. The operation kind must remain {node.kind}.</p>
        <TextArea
          aria-label="Operation configuration JSON"
          label="Operation JSON"
          rows={18}
          value={text}
          onChange={(raw) => {
            setText(raw);
            try {
              const operation = operationSchema.parse(JSON.parse(raw));
              if (operation.kind !== node.kind) throw new Error('Operation kind must match the node.');
              onChange({ config: { operation, operationDraft: undefined } });
            } catch {
              onChange({ config: { operationDraft: raw } });
            }
          }}
        />
        {node.config.operationDraft !== undefined && (
          <p role="alert">Invalid operation JSON. Fix it before applying.</p>
        )}
      </>
    );
  return (
    <div className="nc-fields">
      {def.fields
        .filter((f) => (fields ? fields.includes(f.key) : f.tab === tab))
        .map((field) => {
          const value = (op as unknown as Record<string, unknown>)[field.key];
          const handlers = op.kind === 'transaction' ? catalog.transactions : catalog.steps;
          return (
            <fieldset key={field.key} className="nc-config-field">
              <legend>{field.label}</legend>
              <FieldValidation path={`config.operation.${field.key}`}>
                {field.optional && (
                  <ControlButton
                    onClick={() =>
                      update(
                        field.key,
                        value === undefined
                          ? field.control === 'binding'
                            ? { source: 'literal', value: 0 }
                            : ''
                          : undefined,
                      )
                    }
                  >
                    {value === undefined ? 'Configure' : 'Remove option'}
                  </ControlButton>
                )}
                {(value !== undefined || !field.optional) && (
                  <>
                    {field.control === 'handler' && (
                      <>
                        <ControlSelect
                          aria-label={field.label}
                          value={String(value ?? '')}
                          disabled={catalogLoading}
                          onChange={(e) => update(field.key, e.target.value)}
                        >
                          <option value="">Select an operation</option>
                          {!handlers.some((h) => h.id === value) && value !== undefined && (
                            <option value={String(value)}>{String(value)} (not registered)</option>
                          )}
                          {handlers.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name} · {h.id}
                            </option>
                          ))}
                        </ControlSelect>
                        {catalogLoading && <small role="status">Loading registered operations…</small>}
                        {catalogError && <p role="alert">{catalogError}</p>}
                      </>
                    )}
                    {field.control === 'text' && (
                      <ParameterFields
                        value={node.config.parameters?.[field.key] ?? { mode: 'fixed', value: String(value ?? '') }}
                        onChange={(next) =>
                          onChange({ config: { parameters: { ...node.config.parameters, [field.key]: next } } })
                        }
                        label={field.label}
                        path={`config.parameters.${field.key}`}
                      />
                    )}
                    {field.control === 'number' && (
                      <ControlInput
                        aria-label={field.label}
                        type={field.control === 'number' ? 'number' : 'text'}
                        min={field.min}
                        max={field.max}
                        value={String(value ?? '')}
                        onChange={(e) =>
                          update(field.key, field.control === 'number' ? Number(e.target.value) : e.target.value)
                        }
                      />
                    )}
                    {field.control === 'select' && (
                      <ControlSelect
                        aria-label={field.label}
                        value={String(value ?? '')}
                        onChange={(e) => update(field.key, e.target.value)}
                      >
                        {field.options?.map((option) => <option key={option}>{option}</option>)}
                      </ControlSelect>
                    )}
                    {field.control === 'queue' && (
                      <ControlSelect
                        aria-label={field.label}
                        value={String(value ?? '')}
                        onChange={(e) => update(field.key, e.target.value || undefined)}
                      >
                        <option value="">No queue</option>
                        {!flow?.queues?.some((q) => q.key === value) && Boolean(value) && (
                          <option value={String(value)}>{String(value)} (not configured)</option>
                        )}
                        {flow?.queues?.map((q) => <option key={q.key}>{q.key}</option>)}
                      </ControlSelect>
                    )}
                    {field.control === 'workflow' && (
                      <>
                        {onCreateDefinition && (
                          <ControlButton iconLeading={Plus} onClick={() => update(field.key, onCreateDefinition())}>
                            New inner graph
                          </ControlButton>
                        )}
                        <ControlSelect
                          aria-label={field.label}
                          value={String(value ?? '')}
                          onChange={(e) => update(field.key, e.target.value)}
                        >
                          <option value="">Select a child workflow</option>
                          {!flow?.definitions?.[String(value)] && Boolean(value) && (
                            <option value={String(value)}>{String(value)} (not found)</option>
                          )}
                          {Object.entries(flow?.definitions ?? {}).map(([ref, definition]) => (
                            <option value={ref} key={ref}>
                              {definition.name} · {ref}
                            </option>
                          ))}
                        </ControlSelect>
                        {onInspectDefinition && flow?.definitions?.[String(value)] && (
                          <ControlButton onClick={() => onInspectDefinition(String(value))}>
                            Open referenced graph
                          </ControlButton>
                        )}
                      </>
                    )}
                    {field.control === 'binding' && renderParameter(field.key, value as Binding, field.label)}
                    {field.control === 'predicate' &&
                      (() => {
                        const predicate = value as Predicate;
                        return (
                          <>
                            <ControlSelect
                              aria-label={`${field.label} operator`}
                              value={predicate.operator}
                              onChange={(e) =>
                                update(field.key, {
                                  ...predicate,
                                  operator: e.target.value,
                                  ...(e.target.value !== 'truthy' && !predicate.right
                                    ? { right: { source: 'literal', value: null } }
                                    : {}),
                                })
                              }
                            >
                              {['truthy', 'eq', 'neq', 'gt', 'lt'].map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </ControlSelect>
                            <p>Left value</p>
                            {renderParameter(`${field.key}.left`, predicate.left, `${field.label} left`)}
                            {predicate.operator !== 'truthy' && (
                              <>
                                <p>Right value</p>
                                {renderParameter(
                                  `${field.key}.right`,
                                  predicate.right ?? { source: 'literal', value: null },
                                  `${field.label} right`,
                                )}
                              </>
                            )}
                          </>
                        );
                      })()}
                    {field.control === 'branches' && (
                      <>
                        {(value as { id?: string; name?: string; workflowRef: string; input: Binding }[]).map(
                          (branch, index) => (
                            <fieldset key={index} className="nc-entry">
                              <legend>{branch.name ?? `Branch ${index + 1}`}</legend>
                              {flow?.authoringVersion === 2 && (
                                <ControlInput
                                  aria-label={`Branch ${index + 1} name`}
                                  value={branch.name ?? ''}
                                  placeholder={`Branch ${index + 1}`}
                                  onChange={(e) =>
                                    update(
                                      field.key,
                                      (value as (typeof branch)[]).map((b, i) =>
                                        i === index ? { ...b, name: e.target.value } : b,
                                      ),
                                    )
                                  }
                                />
                              )}
                              {flow?.authoringVersion === 2 && (
                                <small>Branch ID: {branch.id ?? 'Missing · add a new branch'}</small>
                              )}
                              <label>
                                Child workflow
                                <ControlSelect
                                  aria-label={`Branch ${index + 1} workflow`}
                                  value={branch.workflowRef}
                                  onChange={(e) =>
                                    update(
                                      field.key,
                                      (value as (typeof branch)[]).map((b, i) =>
                                        i === index ? { ...b, workflowRef: e.target.value } : b,
                                      ),
                                    )
                                  }
                                >
                                  <option value="">Select a workflow</option>
                                  {!flow?.definitions?.[branch.workflowRef] && (
                                    <option value={branch.workflowRef}>{branch.workflowRef} (not found)</option>
                                  )}
                                  {Object.entries(flow?.definitions ?? {}).map(([ref, definition]) => (
                                    <option key={ref} value={ref}>
                                      {definition.name}
                                    </option>
                                  ))}
                                </ControlSelect>
                              </label>
                              {onCreateDefinition && (
                                <ControlButton
                                  iconLeading={Plus}
                                  onClick={() => {
                                    const ref = onCreateDefinition();
                                    update(
                                      field.key,
                                      (value as (typeof branch)[]).map((b, i) =>
                                        i === index ? { ...b, workflowRef: ref } : b,
                                      ),
                                    );
                                  }}
                                >
                                  New branch graph
                                </ControlButton>
                              )}
                              {onInspectDefinition && branch.workflowRef && (
                                <ControlButton onClick={() => onInspectDefinition(branch.workflowRef)}>
                                  Open branch
                                </ControlButton>
                              )}
                              {renderParameter(`branches.${index}.input`, branch.input, `Branch ${index + 1} input`)}
                              <ControlButton
                                iconLeading={X}
                                onClick={() => {
                                  const parameters = Object.fromEntries(
                                    Object.entries(node.config.parameters ?? {}).flatMap(([key, p]) => {
                                      const match = /^branches\.(\d+)\.input$/.exec(key);
                                      if (!match) return [[key, p]];
                                      const i = Number(match[1]);
                                      return i === index ? [] : [[`branches.${i > index ? i - 1 : i}.input`, p]];
                                    }),
                                  );
                                  onChange({
                                    config: {
                                      operation: {
                                        ...op,
                                        [field.key]: (value as (typeof branch)[]).filter((_, i) => i !== index),
                                      } as NativeOperation,
                                      parameters,
                                      operationDraft: undefined,
                                    },
                                  });
                                }}
                              >
                                Remove branch
                              </ControlButton>
                            </fieldset>
                          ),
                        )}
                        <ControlButton
                          iconLeading={Plus}
                          onClick={() =>
                            update(field.key, [
                              ...(value as object[]),
                              {
                                id: crypto.randomUUID(),
                                name: `Branch ${(value as object[]).length + 1}`,
                                workflowRef: Object.keys(flow?.definitions ?? {})[0] ?? '',
                                input: { source: 'input' },
                              },
                            ])
                          }
                        >
                          Add branch
                        </ControlButton>
                      </>
                    )}
                  </>
                )}
              </FieldValidation>
            </fieldset>
          );
        })}
    </div>
  );
}
