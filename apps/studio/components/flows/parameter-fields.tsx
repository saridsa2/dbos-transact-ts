'use client';
import { useState, type ReactNode } from 'react';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { TextArea } from '@/components/base/textarea/textarea';
import { Plus, X, ChevronUp, ChevronDown, ChevronRight, Link2 } from '@/components/fa-icons';
import type { Parameter } from '@/lib/authoring/model';
import { PropertyName } from './binding-fields';
import { CodeEditor } from './code-editor';
import { useMapping } from './mapping-context';
import type { ValueSchema } from '@/lib/authoring/contracts';
import { FieldValidation } from './field-validation';

function initial(type: string): Parameter {
  if (type === 'object') return { mode: 'object', fields: {} };
  if (type === 'array') return { mode: 'array', items: [] };
  return {
    mode: 'fixed',
    value: type === 'number' || type === 'integer' ? 0 : type === 'boolean' ? false : type === 'null' ? null : '',
  };
}
export function ParameterFields({
  value,
  onChange: commit,
  schema,
  optional = false,
  label,
  depth = 0,
  path = 'parameter',
  displayLabel,
  compact = false,
  actions,
}: {
  value: Parameter;
  onChange: (value: Parameter) => void;
  label: string;
  schema?: ValueSchema;
  optional?: boolean;
  depth?: number;
  path?: string;
  displayLabel?: ReactNode;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const mapping = useMapping();
  const { _editor: _inactive, ...activeValue } = value;
  const [expanded, setExpanded] = useState(true);
  const declaredType = typeof schema?.type === 'string' ? schema.type : undefined;
  const type =
    value.mode === 'object'
      ? 'object'
      : value.mode === 'array'
        ? 'array'
        : value.mode === 'fixed'
          ? value.value === null
            ? 'null'
            : Array.isArray(value.value)
              ? 'array'
              : typeof value.value
          : 'string';
  const composite = value.mode !== 'expression' && value.mode !== 'omit' && (type === 'object' || type === 'array');
  function change(next: Parameter) {
    commit({ ...next, _editor: { ...value._editor, ...next._editor } });
  }
  function mode(next: string) {
    if (next === 'expression')
      change({ mode: 'expression', expression: value._editor?.expression ?? '', _editor: { fixed: activeValue } });
    else if (next === 'omit')
      change({
        mode: 'omit',
        _editor: {
          fixed: value.mode === 'expression' ? value._editor?.fixed : activeValue,
          expression: value.mode === 'expression' ? value.expression : value._editor?.expression,
        },
      });
    else
      change({
        ...(value._editor?.fixed ?? initial(declaredType ?? 'string')),
        _editor: {
          ...value._editor,
          expression: value.mode === 'expression' ? value.expression : value._editor?.expression,
        },
      });
  }
  if (depth > 12) return <p>Maximum nested editor depth reached.</p>;
  const enumValues = Array.isArray(schema?.enum) ? schema.enum : undefined;
  return (
    <FieldValidation path={path}>
      <div className={`nc-parameter${compact ? ' nc-parameter-compact' : ''}`}>
        <div className="nc-value-toolbar">
          {composite && (
            <ControlButton
              iconLeading={expanded ? ChevronDown : ChevronRight}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            />
          )}
          <div className="nc-value-name">{displayLabel ?? label}</div>
          <div className="nc-value-options">
            {value.mode !== 'expression' && value.mode !== 'omit' && !declaredType && (
              <ControlSelect
                aria-label={`${label} type`}
                value={type}
                onChange={(e) => change(initial(e.target.value))}
              >
                {[
                  ['string', 'Text'],
                  ['number', 'Number'],
                  ['boolean', 'Boolean'],
                  ['object', 'Object'],
                  ['array', 'List'],
                  ['null', 'Null'],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </ControlSelect>
            )}
            <ControlSelect
              aria-label={`${label} mode`}
              value={value.mode === 'expression' ? 'expression' : value.mode === 'omit' ? 'omit' : 'fixed'}
              onChange={(e) => mode(e.target.value)}
            >
              <option value="fixed">Fixed</option>
              <option value="expression">Expression</option>
              {(optional || value.mode === 'omit') && (
                <option value="omit">{optional ? 'Omit' : 'Not configured'}</option>
              )}
            </ControlSelect>
            {!mapping.readOnly && mapping.openPicker && (
              <Tooltip title="Use workflow data">
                <ControlButton
                  iconLeading={Link2}
                  aria-label={`Use workflow data for ${label}`}
                  onClick={() =>
                    mapping.openPicker?.({
                      path,
                      label,
                      schema,
                      replaceRequired: value.mode !== 'omit' && !(value.mode === 'fixed' && value.value === ''),
                      insert: (expression) =>
                        change({
                          mode: 'expression',
                          expression,
                          _editor: { fixed: value.mode === 'expression' ? value._editor?.fixed : activeValue },
                        }),
                    })
                  }
                />
              </Tooltip>
            )}
            {actions}
          </div>
        </div>
        {value.mode === 'omit' ? (
          <small>{optional ? 'No value will be sent.' : 'Choose Fixed or Expression to configure this value.'}</small>
        ) : value.mode === 'expression' ? (
          <>
            <CodeEditor
              value={value.expression}
              language="javascript"
              expression
              readOnly={mapping.readOnly}
              ariaLabel={`${label} expression`}
              onChange={(expression) => change({ mode: 'expression', expression })}
              completions={mapping.suggestions}
            />
            {mapping.preview &&
              (() => {
                const result = mapping.preview(value.expression);
                return (
                  <small role="status">
                    {result.error
                      ? `Preview unavailable: ${result.error}`
                      : `Preview: ${JSON.stringify(result.value)?.slice(0, 300)}`}
                  </small>
                );
              })()}
          </>
        ) : (
          <>
            {composite &&
              expanded &&
              type === 'object' &&
              (() => {
                const stored =
                  value.mode === 'object'
                    ? value.fields
                    : Object.fromEntries(
                        Object.entries(value.mode === 'fixed' ? (value.value as object) : {}).map(([k, v]) => [
                          k,
                          { mode: 'fixed' as const, value: v },
                        ]),
                      );
                const fields: Record<string, Parameter> = {
                  ...Object.fromEntries(
                    Object.keys((schema?.properties ?? {}) as object).map((key) => [key, { mode: 'omit' as const }]),
                  ),
                  ...stored,
                };
                return (
                  <div className="nc-object-fields">
                    {Object.entries(fields).map(([key, p], index) => (
                      <ParameterFields
                        key={key}
                        label={`${label}.${key}`}
                        path={`${path}.fields.${key}`}
                        depth={depth + 1}
                        displayLabel={
                          Object.hasOwn((schema?.properties ?? {}) as object, key) ? (
                            key
                          ) : (
                            <PropertyName
                              name={key}
                              names={Object.keys(fields)}
                              label={`${label} field ${index + 1} name`}
                              compact
                              onRename={(next) =>
                                change({
                                  mode: 'object',
                                  fields: Object.fromEntries(
                                    Object.entries(fields).map(([k, v]) => [k === key ? next : k, v]),
                                  ),
                                })
                              }
                            />
                          )
                        }
                        schema={(schema?.properties as Record<string, ValueSchema> | undefined)?.[key]}
                        optional={!!schema?.properties && !(schema.required as string[] | undefined)?.includes(key)}
                        value={p}
                        onChange={(next) => change({ mode: 'object', fields: { ...fields, [key]: next } })}
                        actions={
                          <ControlButton
                            iconLeading={X}
                            aria-label={`Remove ${label}.${key}`}
                            disabled={!!(schema?.required as string[] | undefined)?.includes(key)}
                            onClick={() =>
                              change({
                                mode: 'object',
                                fields: Object.fromEntries(Object.entries(fields).filter(([k]) => k !== key)),
                              })
                            }
                          />
                        }
                      />
                    ))}
                    {schema?.additionalProperties !== false && (
                      <ControlButton
                        iconLeading={Plus}
                        onClick={() => {
                          let n = 1;
                          while (Object.hasOwn(fields, `field${n}`)) n++;
                          change({ mode: 'object', fields: { ...fields, [`field${n}`]: initial('string') } });
                        }}
                      >
                        Add field
                      </ControlButton>
                    )}
                  </div>
                );
              })()}
            {composite &&
              expanded &&
              type === 'array' &&
              (() => {
                const items =
                  value.mode === 'array'
                    ? value.items
                    : (value.mode === 'fixed' ? (value.value as unknown[]) : []).map((v) => ({
                        mode: 'fixed' as const,
                        value: v,
                      }));
                const ids = items.map((_, i) => value._editor?.itemIds?.[i] ?? `item-${i}`);
                const itemSchema = schema?.items as ValueSchema | undefined;
                return (
                  <div className="nc-array-fields">
                    {items.map((p, index) => (
                      <div className="nc-array-item" key={ids[index]}>
                        <div className="nc-array-heading">
                          <span>{index + 1}</span>
                          <ControlButton
                            iconLeading={ChevronUp}
                            disabled={index === 0}
                            aria-label={`Move item ${index + 1} up`}
                            onClick={() => {
                              const next = [...items],
                                keys = [...ids];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              [keys[index - 1], keys[index]] = [keys[index], keys[index - 1]];
                              change({ mode: 'array', items: next, _editor: { itemIds: keys } });
                            }}
                          />
                        </div>
                        <ParameterFields
                          value={p}
                          schema={itemSchema}
                          label={`${label}[${index}]`}
                          displayLabel={`Item ${index + 1}`}
                          compact
                          depth={depth + 1}
                          path={`${path}.items.${index}`}
                          onChange={(next) =>
                            change({ mode: 'array', items: items.map((p, i) => (i === index ? next : p)) })
                          }
                        />
                        <ControlButton
                          iconLeading={X}
                          aria-label={`Remove ${label} item ${index + 1}`}
                          disabled={typeof schema?.minItems === 'number' && items.length <= schema.minItems}
                          onClick={() =>
                            change({
                              mode: 'array',
                              items: items.filter((_, i) => i !== index),
                              _editor: { itemIds: ids.filter((_, i) => i !== index) },
                            })
                          }
                        />
                      </div>
                    ))}
                    <ControlButton
                      iconLeading={Plus}
                      disabled={typeof schema?.maxItems === 'number' && items.length >= schema.maxItems}
                      onClick={() =>
                        change({
                          mode: 'array',
                          items: [...items, initial(typeof itemSchema?.type === 'string' ? itemSchema.type : 'string')],
                          _editor: { itemIds: [...ids, crypto.randomUUID()] },
                        })
                      }
                    >
                      Add item
                    </ControlButton>
                  </div>
                );
              })()}
            {value.mode === 'fixed' && enumValues ? (
              <ControlSelect
                aria-label={`${label} value`}
                value={JSON.stringify(value.value)}
                onChange={(e) => change({ mode: 'fixed', value: JSON.parse(e.target.value) })}
              >
                {enumValues.map((v) => (
                  <option key={JSON.stringify(v)} value={JSON.stringify(v)}>
                    {String(v)}
                  </option>
                ))}
              </ControlSelect>
            ) : value.mode === 'fixed' && type === 'string' ? (
              <TextArea
                aria-label={`${label} value`}
                value={String(value.value ?? '')}
                onChange={(v) => change({ mode: 'fixed', value: v })}
                rows={1}
              />
            ) : value.mode === 'fixed' && type === 'number' ? (
              <ControlInput
                type="number"
                step={declaredType === 'integer' ? 1 : 'any'}
                aria-label={`${label} value`}
                value={Number(value.value)}
                onChange={(e) => change({ mode: 'fixed', value: Number(e.target.value) })}
              />
            ) : value.mode === 'fixed' && type === 'boolean' ? (
              <ControlSelect
                aria-label={`${label} value`}
                value={String(value.value)}
                onChange={(e) => change({ mode: 'fixed', value: e.target.value === 'true' })}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </ControlSelect>
            ) : value.mode === 'fixed' && type === 'null' ? (
              <small>Null value</small>
            ) : null}
          </>
        )}
      </div>
    </FieldValidation>
  );
}
