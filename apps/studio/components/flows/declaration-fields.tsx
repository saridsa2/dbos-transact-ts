'use client';
import { ControlButton, ControlInput } from '@/components/control/controls';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Plus, Trash01 } from '@/components/fa-icons';
import { ParameterFields } from './parameter-fields';
import { SchemaFields } from './schema-fields';
import type { Declaration } from '@/lib/authoring/contracts';
import type { FlowNodeData } from '@/lib/flows/types';
export function DeclarationFields({
  value,
  onChange,
  nodes = [],
}: {
  value: Declaration[];
  onChange: (value: Declaration[]) => void;
  nodes?: FlowNodeData[];
}) {
  function update(id: string, patch: Partial<Declaration>) {
    onChange(value.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  return (
    <>
      <p className="nc-settings-description">
        Set each variable’s starting value. Nodes can update writable variables during a run.
      </p>
      {value.map((d) => {
        const writers = nodes.filter((node) => {
          const values = node.config.parameters?.values;
          return (
            node.kind === 'setVariables' &&
            values?.mode === 'object' &&
            values.fields[d.id] &&
            values.fields[d.id].mode !== 'omit'
          );
        });
        return (
          <section key={d.id} className="nc-variable-card" aria-label={`Variable ${d.name}`}>
            <header>
              <div>
                <h3>{d.name}</h3>
                <small>Reference: {d.id}</small>
              </div>
              <ControlButton
                color="tertiary"
                iconLeading={Trash01}
                aria-label={`Remove variable ${d.name}`}
                disabled={writers.length > 0}
                onClick={() => onChange(value.filter((v) => v.id !== d.id))}
              />
            </header>
            <label>
              Variable name
              <ControlInput
                aria-label={`Variable ${d.id} name`}
                value={d.name}
                onChange={(e) => update(d.id, { name: e.target.value })}
              />
            </label>
            <SchemaFields
              label={`${d.name} data type`}
              value={d.schema}
              onChange={(schema) => update(d.id, { schema })}
            />
            <ParameterFields
              value={d.initial}
              schema={d.schema}
              label={`${d.name} starting value`}
              onChange={(initial) => update(d.id, { initial })}
            />
            <Checkbox
              className="nc-checkbox-row"
              size="md"
              label="Allow nodes to update this variable"
              hint="When off, this variable is read-only during execution."
              isSelected={d.writable}
              onChange={(writable) => update(d.id, { writable })}
            />
            {writers.length > 0 && (
              <p className="nc-variable-update-note">
                {d.writable ? 'Can be updated by: ' : 'Update blocked in: '}
                {writers.map((node) => node.name).join(', ')}.{' '}
                {d.writable
                  ? 'The starting value may be replaced when these nodes run. Rename this variable to keep its references; remove node updates before deleting it.'
                  : 'Allow updates here or remove the update from those nodes.'}
              </p>
            )}
          </section>
        );
      })}
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
