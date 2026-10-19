'use client';
import { ControlButton, ControlInput } from '@/components/control/controls';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Plus, X } from '@/components/fa-icons';
import { ParameterFields } from './parameter-fields';
import { SchemaFields } from './schema-fields';
import type { Declaration } from '@/lib/authoring/contracts';
export function DeclarationFields({
  value,
  onChange,
}: {
  value: Declaration[];
  onChange: (value: Declaration[]) => void;
}) {
  function update(id: string, patch: Partial<Declaration>) {
    onChange(value.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  return (
    <>
      <p>
        Declared variables are writable only in this workflow scope. Branch/iteration captures are read-only. Mapping
        uses stable IDs, so renaming a label preserves references.
      </p>
      {value.map((d) => (
        <fieldset key={d.id} className="nc-entry">
          <legend>{d.name}</legend>
          <ControlInput
            aria-label={`Variable ${d.id} name`}
            value={d.name}
            onChange={(e) => update(d.id, { name: e.target.value })}
          />
          <small>ID: {d.id}</small>
          <Checkbox
            label="Writable in this scope"
            isSelected={d.writable}
            onChange={(writable) => update(d.id, { writable })}
          />
          <SchemaFields label={`${d.name} schema`} value={d.schema} onChange={(schema) => update(d.id, { schema })} />
          <ParameterFields
            value={d.initial}
            schema={d.schema}
            label={`${d.name} initial value`}
            onChange={(initial) => update(d.id, { initial })}
          />
          <ControlButton
            iconLeading={X}
            aria-label={`Remove variable ${d.name}`}
            onClick={() => onChange(value.filter((v) => v.id !== d.id))}
          />
        </fieldset>
      ))}
      <ControlButton
        iconLeading={Plus}
        onClick={() => {
          const id = crypto.randomUUID();
          onChange([
            ...value,
            {
              id,
              name: `Variable ${value.length + 1}`,
              schema: { type: 'string' },
              initial: { mode: 'fixed', value: '' },
              writable: true,
            },
          ]);
        }}
      >
        Add variable
      </ControlButton>
    </>
  );
}
