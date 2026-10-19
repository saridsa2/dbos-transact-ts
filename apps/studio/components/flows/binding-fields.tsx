'use client';
import { useEffect, useState } from 'react';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { Plus, X } from '@/components/fa-icons';
import type { Binding, Predicate } from '@/lib/native/model';
import type { FlowNodeData } from '@/lib/flows/types';

const types = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const;
function valueType(value: unknown): (typeof types)[number] {
  return value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'object'
        ? 'object'
        : typeof value === 'number'
          ? 'number'
          : typeof value === 'boolean'
            ? 'boolean'
            : 'string';
}
function initial(type: string): unknown {
  return type === 'number'
    ? 0
    : type === 'boolean'
      ? false
      : type === 'object'
        ? {}
        : type === 'array'
          ? []
          : type === 'null'
            ? null
            : '';
}
const newKey = (obj: object) => {
  let n = 1;
  while (Object.hasOwn(obj, `field${n}`)) n++;
  return `field${n}`;
};
export function PropertyName({
  name,
  names,
  onRename,
  label,
  readOnly = false,
  compact = false,
}: {
  name: string;
  names: string[];
  onRename: (key: string) => void;
  label: string;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const invalid = !text.trim() || (text !== name && names.includes(text));
  return (
    <div>
      <ControlInput
        aria-label={label}
        readOnly={readOnly}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!invalid) onRename(text);
          else setText(name);
        }}
      />
      {(!compact || invalid) && (
        <small>Field name{invalid ? ' must be unique and non-empty. Changes revert on blur.' : ''}</small>
      )}
    </div>
  );
}
export function LiteralFields({
  value,
  onChange,
  label,
  depth = 0,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  depth?: number;
}) {
  const type = valueType(value);
  if (depth > 10) return <p>Nested values beyond 10 levels can be edited in Advanced.</p>;
  const object = type === 'object' ? (value as Record<string, unknown>) : {};
  return (
    <div className="nc-value">
      <ControlSelect
        aria-label={`${label} value type`}
        value={type}
        onChange={(e) => onChange(initial(e.target.value))}
      >
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </ControlSelect>
      {type === 'string' && (
        <TextArea aria-label={`${label} value`} value={String(value ?? '')} onChange={onChange} rows={2} />
      )}
      {type === 'number' && (
        <ControlInput
          aria-label={`${label} value`}
          type="number"
          step="any"
          value={Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )}
      {type === 'boolean' && (
        <ControlSelect
          aria-label={`${label} value`}
          value={String(value)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </ControlSelect>
      )}
      {type === 'object' && (
        <>
          <div className="nc-children">
            {Object.entries(object).map(([key, item], index) => (
              <div className="nc-entry" key={index}>
                <div className="nc-entry-heading">
                  <PropertyName
                    name={key}
                    names={Object.keys(object)}
                    label={`${label} field ${index + 1} name`}
                    onRename={(next) =>
                      onChange(Object.fromEntries(Object.entries(object).map(([k, v]) => [k === key ? next : k, v])))
                    }
                  />
                  <ControlButton
                    aria-label={`Remove ${label}.${key}`}
                    iconLeading={X}
                    onClick={() => onChange(Object.fromEntries(Object.entries(object).filter(([k]) => k !== key)))}
                  />
                </div>
                <LiteralFields
                  value={item}
                  onChange={(next) => onChange({ ...object, [key]: next })}
                  label={`${label}.${key}`}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
          <ControlButton iconLeading={Plus} onClick={() => onChange({ ...object, [newKey(object)]: '' })}>
            Add field
          </ControlButton>
        </>
      )}
      {type === 'array' && (
        <>
          <div className="nc-children">
            {(value as unknown[]).map((item, index) => (
              <div className="nc-entry" key={index}>
                <div className="nc-entry-heading">
                  <strong>Item {index + 1}</strong>
                  <ControlButton
                    aria-label={`Remove ${label} item ${index + 1}`}
                    iconLeading={X}
                    onClick={() => onChange((value as unknown[]).filter((_, i) => i !== index))}
                  />
                </div>
                <LiteralFields
                  value={item}
                  onChange={(next) => onChange((value as unknown[]).map((v, i) => (i === index ? next : v)))}
                  label={`${label}[${index}]`}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
          <ControlButton iconLeading={Plus} onClick={() => onChange([...(value as unknown[]), ''])}>
            Add item
          </ControlButton>
        </>
      )}
    </div>
  );
}
export function BindingFields({
  value,
  onChange,
  label,
  upstream,
  depth = 0,
}: {
  value: Binding;
  onChange: (binding: Binding) => void;
  label: string;
  upstream: FlowNodeData[];
  depth?: number;
}) {
  if (depth > 10) return <p>Deep bindings can be edited in Advanced.</p>;
  const sources = [
    ['literal', 'Fixed value'],
    ['input', 'Workflow input'],
    ['node', 'Upstream node'],
    ['object', 'Object with bindings'],
    ['array', 'Array with bindings'],
    ['item', 'Iteration item'],
    ['state', 'Loop state'],
    ['execution', 'Execution identity'],
  ];
  return (
    <div className="nc-binding">
      <label>
        Value source
        <ControlSelect
          aria-label={`${label} source`}
          value={value.source}
          onChange={(e) => {
            const source = e.target.value as Exclude<Binding['source'], 'expression'>;
            onChange(
              source === 'literal'
                ? { source, value: null }
                : source === 'node'
                  ? { source, nodeId: upstream[0]?.id ?? '' }
                  : source === 'object'
                    ? { source, fields: {} }
                    : source === 'array'
                      ? { source, items: [] }
                      : { source },
            );
          }}
        >
          {sources.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </ControlSelect>
      </label>
      {value.source === 'literal' && (
        <LiteralFields
          value={value.value}
          onChange={(next) => onChange({ source: 'literal', value: next })}
          label={label}
          depth={depth}
        />
      )}
      {value.source === 'node' && (
        <label>
          Upstream node
          <ControlSelect
            aria-label={`${label} upstream node`}
            value={value.nodeId}
            onChange={(e) => onChange({ ...value, nodeId: e.target.value })}
          >
            <option value="">Select an upstream node</option>
            {!upstream.some((n) => n.id === value.nodeId) && value.nodeId && (
              <option value={value.nodeId}>{value.nodeId} (not upstream)</option>
            )}
            {upstream.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </ControlSelect>
        </label>
      )}
      {['input', 'node', 'item', 'state', 'execution'].includes(value.source) && 'source' in value && (
        <label>
          Property path <small>(optional)</small>
          <ControlInput
            aria-label={`${label} path`}
            placeholder="e.g. variables.documents"
            value={'path' in value ? (value.path ?? '') : ''}
            onChange={(e) => onChange({ ...value, path: e.target.value || undefined } as Binding)}
          />
        </label>
      )}
      {['item', 'state', 'execution'].includes(value.source) && (
        <small>This source is available only in its runtime scope.</small>
      )}
      {value.source === 'object' && (
        <>
          <div className="nc-children">
            {Object.entries(value.fields).map(([key, binding], index) => (
              <div className="nc-entry" key={index}>
                <div className="nc-entry-heading">
                  <PropertyName
                    name={key}
                    names={Object.keys(value.fields)}
                    label={`${label} binding ${index + 1} name`}
                    onRename={(next) =>
                      onChange({
                        ...value,
                        fields: Object.fromEntries(
                          Object.entries(value.fields).map(([k, v]) => [k === key ? next : k, v]),
                        ),
                      })
                    }
                  />
                  <ControlButton
                    aria-label={`Remove binding ${label}.${key}`}
                    iconLeading={X}
                    onClick={() =>
                      onChange({
                        ...value,
                        fields: Object.fromEntries(Object.entries(value.fields).filter(([k]) => k !== key)),
                      })
                    }
                  />
                </div>
                <BindingFields
                  value={binding}
                  onChange={(next) => onChange({ ...value, fields: { ...value.fields, [key]: next } })}
                  label={`${label}.${key}`}
                  upstream={upstream}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
          <ControlButton
            iconLeading={Plus}
            onClick={() =>
              onChange({
                ...value,
                fields: { ...value.fields, [newKey(value.fields)]: { source: 'literal', value: '' } },
              })
            }
          >
            Add binding
          </ControlButton>
        </>
      )}
      {value.source === 'array' && (
        <>
          <div className="nc-children">
            {value.items.map((b, index) => (
              <div className="nc-entry" key={index}>
                <div className="nc-entry-heading">
                  <strong>Binding {index + 1}</strong>
                  <ControlButton
                    aria-label={`Remove ${label} binding ${index + 1}`}
                    iconLeading={X}
                    onClick={() => onChange({ ...value, items: value.items.filter((_, i) => i !== index) })}
                  />
                </div>
                <BindingFields
                  value={b}
                  onChange={(next) =>
                    onChange({ ...value, items: value.items.map((v, i) => (i === index ? next : v)) })
                  }
                  label={`${label}[${index}]`}
                  upstream={upstream}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
          <ControlButton
            iconLeading={Plus}
            onClick={() => onChange({ ...value, items: [...value.items, { source: 'literal', value: null }] })}
          >
            Add binding
          </ControlButton>
        </>
      )}
    </div>
  );
}
export function PredicateFields({
  value,
  onChange,
  label,
  upstream,
}: {
  value: Predicate;
  onChange: (value: Predicate) => void;
  label: string;
  upstream: FlowNodeData[];
}) {
  return (
    <div className="nc-predicate">
      <label>
        Comparison
        <ControlSelect
          aria-label={`${label} operator`}
          value={value.operator}
          onChange={(e) => {
            const operator = e.target.value as Predicate['operator'];
            onChange({
              ...value,
              operator,
              ...(operator !== 'truthy' && !value.right ? { right: { source: 'literal', value: null } } : {}),
            });
          }}
        >
          <option value="truthy">Is truthy</option>
          <option value="eq">Equals</option>
          <option value="neq">Does not equal</option>
          <option value="gt">Greater than</option>
          <option value="lt">Less than</option>
        </ControlSelect>
      </label>
      <fieldset>
        <legend>Left value</legend>
        <BindingFields
          value={value.left}
          onChange={(left) => onChange({ ...value, left })}
          label={`${label} left`}
          upstream={upstream}
        />
      </fieldset>
      {value.operator !== 'truthy' && (
        <fieldset>
          <legend>Right value</legend>
          <BindingFields
            value={value.right ?? { source: 'literal', value: null }}
            onChange={(right) => onChange({ ...value, right })}
            label={`${label} right`}
            upstream={upstream}
          />
        </fieldset>
      )}
    </div>
  );
}
