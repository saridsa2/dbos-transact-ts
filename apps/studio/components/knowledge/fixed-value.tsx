'use client';
import { useState } from 'react';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { RecordAction } from '@/components/control/work-area';
import { Trash01 } from '@/components/fa-icons';
import { Checkbox } from '@/components/base/checkbox/checkbox';
export function FixedValue({
  value,
  onChange,
  label,
  root = false,
  depth = 0,
}: {
  value: any;
  onChange: (v: any) => void;
  label: string;
  root?: boolean;
  depth?: number;
}) {
  const [newKey, setNewKey] = useState('');
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (depth > 8) return <p>Input nesting exceeds the editor limit.</p>;
  const defaults: Record<string, unknown> = {
    string: '',
    number: 0,
    boolean: false,
    object: {},
    array: [],
    null: null,
  };
  return (
    <div className="wi-fixed-value">
      {!root && (
        <ControlSelect
          aria-label={`${label} value type`}
          value={type}
          onChange={(e) => onChange(defaults[e.target.value])}
        >
          {Object.keys(defaults).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </ControlSelect>
      )}
      {type === 'object' ? (
        <>
          {Object.entries(value).map(([key, item]) => (
            <section key={key} className="wi-property">
              <div className="wi-section-heading">
                <strong>{key}</strong>
                <RecordAction
                  label={`Remove input ${label}.${key}`}
                  icon={Trash01}
                  onPress={() => onChange(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)))}
                />
              </div>
              <FixedValue
                label={`${label}.${key}`}
                value={item}
                depth={depth + 1}
                onChange={(v) => onChange({ ...value, [key]: v })}
              />
            </section>
          ))}
          <div className="wi-section-heading">
            <ControlInput
              aria-label={`${label} new field name`}
              placeholder="New field name"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <ControlButton
              disabled={
                !newKey.trim() ||
                Object.hasOwn(value, newKey.trim()) ||
                ['__proto__', 'prototype', 'constructor'].includes(newKey.trim())
              }
              onClick={() => {
                onChange({ ...value, [newKey.trim()]: '' });
                setNewKey('');
              }}
            >
              Add field
            </ControlButton>
          </div>
        </>
      ) : type === 'array' ? (
        <>
          {value.map((item: any, i: number) => (
            <section key={i} className="wi-property">
              <div className="wi-section-heading">
                <strong>Item {i + 1}</strong>
                <RecordAction
                  label={`Remove ${label} item ${i + 1}`}
                  icon={Trash01}
                  onPress={() => onChange(value.filter((_: unknown, n: number) => n !== i))}
                />
              </div>
              <FixedValue
                label={`${label}[${i}]`}
                value={item}
                depth={depth + 1}
                onChange={(v) => onChange(value.map((x: any, n: number) => (n === i ? v : x)))}
              />
            </section>
          ))}
          <ControlButton disabled={value.length >= 1000} onClick={() => onChange([...value, ''])}>
            Add item
          </ControlButton>
        </>
      ) : type === 'boolean' ? (
        <Checkbox className="wi-checkbox" label={label} isSelected={value} onChange={onChange} />
      ) : type === 'null' ? (
        <p>Null</p>
      ) : (
        <ControlInput
          aria-label={label}
          value={String(value)}
          type={type === 'number' ? 'number' : 'text'}
          onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </div>
  );
}
