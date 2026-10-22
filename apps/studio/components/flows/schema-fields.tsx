'use client';
import { useState } from 'react';
import { ErrorMark } from './field-validation';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Plus, X } from '@/components/fa-icons';
import type { ValueSchema } from '@/lib/authoring/contracts';
export function SchemaFields({
  value,
  onChange,
  label = 'Value schema',
  depth = 0,
  types = ['any', 'string', 'number', 'integer', 'boolean', 'null', 'object', 'array'],
}: {
  value: ValueSchema;
  onChange: (schema: ValueSchema) => void;
  label?: string;
  depth?: number;
  types?: readonly string[];
}) {
  const type = typeof value.type === 'string' ? value.type : 'any';
  const properties = (value.properties ?? {}) as Record<string, ValueSchema>;
  const required = (value.required ?? []) as string[];
  if (depth > 8) return <p>Use a referenced schema for deeper types.</p>;
  return (
    <fieldset className="nc-schema">
      <legend>{label}</legend>
      <ControlSelect
        aria-label={`${label} type`}
        value={type}
        onChange={(e) =>
          onChange(
            e.target.value === 'any'
              ? {}
              : e.target.value === 'object'
                ? { type: 'object', properties: {}, additionalProperties: false }
                : e.target.value === 'array'
                  ? { type: 'array', items: {} }
                  : { type: e.target.value },
          )
        }
      >
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </ControlSelect>
      {type === 'object' && (
        <>
          <Checkbox
            className="nc-checkbox-row"
            label="Allow additional properties"
            isSelected={value.additionalProperties !== false}
            onChange={(v) => onChange({ ...value, additionalProperties: v })}
          />
          {Object.entries(properties).map(([key, schema]) => (
            <div className="nc-schema-property" key={key}>
              <strong>{key}</strong>
              <ControlButton
                iconLeading={X}
                aria-label={`Remove schema property ${key}`}
                onClick={() =>
                  onChange({
                    ...value,
                    properties: Object.fromEntries(Object.entries(properties).filter(([k]) => k !== key)),
                    required: required.filter((k) => k !== key),
                  })
                }
              />
              <Checkbox
                className="nc-checkbox-row"
                label={`${key} required`}
                isSelected={required.includes(key)}
                onChange={(v) =>
                  onChange({ ...value, required: v ? [...required, key] : required.filter((k) => k !== key) })
                }
              />
              <SchemaFields
                label={`${label}.${key}`}
                value={schema}
                depth={depth + 1}
                onChange={(s) => onChange({ ...value, properties: { ...properties, [key]: s } })}
              />
            </div>
          ))}
          <AddProperty
            names={Object.keys(properties)}
            onAdd={(name) => onChange({ ...value, properties: { ...properties, [name]: { type: 'string' } } })}
          />
        </>
      )}
      {type === 'array' && (
        <SchemaFields
          label={`${label} item`}
          value={(value.items ?? {}) as ValueSchema}
          onChange={(items) => onChange({ ...value, items })}
          depth={depth + 1}
        />
      )}
    </fieldset>
  );
}
function AddProperty({ names, onAdd }: { names: string[]; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const duplicate = names.includes(name.trim());
  return (
    <div className="nc-property-add">
      <ControlInput
        aria-label="New schema property name"
        placeholder="Property name"
        value={name}
        aria-invalid={duplicate || undefined}
        onChange={(e) => setName(e.target.value)}
      />
      <ControlButton
        disabled={!name.trim() || duplicate}
        iconLeading={Plus}
        onClick={() => {
          onAdd(name.trim());
          setName('');
        }}
      >
        Add property
      </ControlButton>
      {duplicate && (
        <p className="nc-field-errors" role="alert">
          <ErrorMark /> Property name must be unique.
        </p>
      )}
    </div>
  );
}
