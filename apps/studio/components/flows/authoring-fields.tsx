'use client';
import { ControlButton, ControlSelect } from '@/components/control/controls';
import { ParameterFields } from './parameter-fields';
import { SchemaFields } from './schema-fields';
import { X, Plus } from '@/components/fa-icons';
import type { AgentFlow, FlowNodeData } from '@/lib/flows/types';
import type { ConfigTab } from '@/lib/native/node-config';
export function AuthoringFields({
  node,
  flow,
  tab,
  onChange,
}: {
  node: FlowNodeData;
  flow: AgentFlow;
  tab: ConfigTab;
  onChange: (patch: Partial<FlowNodeData>) => void;
}) {
  if (tab === 'general')
    return (
      <>
        <p>Typed ports validate resolved inputs and outputs. Arrays remain one value until For each iterates them.</p>
        {(node.kind === 'code' || (node.config.operation && 'input' in node.config.operation)
          ? (['input', 'output'] as const)
          : (['output'] as const)
        ).map((direction) => {
          const port = node.config.ports?.[direction] ?? {
            id: direction === 'input' ? ('input' as const) : ('value' as const),
            schema: {},
            cardinality: 'single' as const,
            required: true,
          };
          return (
            <div key={direction}>
              <SchemaFields
                label={`${direction} schema`}
                value={port.schema}
                onChange={(schema) =>
                  onChange({ config: { ports: { ...node.config.ports, [direction]: { ...port, schema } } } })
                }
              />
              <ControlSelect
                aria-label={`${direction} cardinality`}
                value={port.cardinality}
                onChange={(e) =>
                  onChange({
                    config: {
                      ports: {
                        ...node.config.ports,
                        [direction]: { ...port, cardinality: e.target.value as 'single' | 'collection' },
                      },
                    },
                  })
                }
              >
                <option value="single">One value</option>
                <option value="collection">Collection</option>
              </ControlSelect>
            </div>
          );
        })}
      </>
    );
  if (node.kind === 'setVariables') {
    const values = node.config.parameters?.values;
    const fields = values?.mode === 'object' ? values.fields : {};
    const declarations = flow.declarations ?? [];
    return (
      <>
        <p>Updates are atomic and local to this workflow scope. Inherited values are read-only.</p>
        {!declarations.length && <p>Declare typed variables in Workflow settings → Variables first.</p>}
        {declarations
          .filter((d) => d.writable)
          .map((d) => (
            <fieldset className="nc-entry" key={d.id}>
              <legend>{d.name}</legend>
              <small>Stable ID: {d.id}</small>
              <ParameterFields
                label={d.name}
                path={`config.parameters.values.fields.${d.id}`}
                schema={d.schema}
                optional
                value={fields[d.id] ?? { mode: 'omit' }}
                onChange={(v) =>
                  onChange({
                    config: {
                      parameters: {
                        ...node.config.parameters,
                        values: { mode: 'object', fields: { ...fields, [d.id]: v } },
                      },
                    },
                  })
                }
              />
            </fieldset>
          ))}
      </>
    );
  }
  const parameter = node.config.parameters?.value ?? { mode: 'object' as const, fields: {} };
  return (
    <>
      <ParameterFields
        label={node.kind === 'merge' ? 'Merged output' : 'Constructed value'}
        schema={node.config.ports?.output?.schema}
        path="config.parameters.value"
        value={parameter}
        onChange={(value) => onChange({ config: { parameters: { ...node.config.parameters, value } } })}
      />
      {node.kind === 'merge' && (
        <>
          <p>Waits for selected predecessors. Parent variable updates commit only after every mapping validates.</p>
          {(node.config.merge?.updates ?? []).map((update, index) => (
            <fieldset className="nc-entry" key={index}>
              <legend>Update {index + 1}</legend>
              <ControlSelect
                aria-label={`Merge update ${index + 1} variable`}
                value={update.variableId}
                onChange={(e) =>
                  onChange({
                    config: {
                      merge: {
                        updates: node.config.merge!.updates.map((u, i) =>
                          i === index ? { ...u, variableId: e.target.value } : u,
                        ),
                      },
                    },
                  })
                }
              >
                <option value="">Select writable variable</option>
                {flow.declarations
                  ?.filter((d) => d.writable)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </ControlSelect>
              <ParameterFields
                label={`Update ${index + 1}`}
                path={`config.merge.updates.${index}.value`}
                schema={flow.declarations?.find((d) => d.id === update.variableId)?.schema}
                value={update.value}
                onChange={(value) =>
                  onChange({
                    config: {
                      merge: { updates: node.config.merge!.updates.map((u, i) => (i === index ? { ...u, value } : u)) },
                    },
                  })
                }
              />
              <ControlButton
                iconLeading={X}
                aria-label={`Remove update ${index + 1}`}
                onClick={() =>
                  onChange({ config: { merge: { updates: node.config.merge!.updates.filter((_, i) => i !== index) } } })
                }
              />
            </fieldset>
          ))}
          <ControlButton
            iconLeading={Plus}
            onClick={() =>
              onChange({
                config: {
                  merge: {
                    updates: [
                      ...(node.config.merge?.updates ?? []),
                      { variableId: '', value: { mode: 'fixed', value: null } },
                    ],
                  },
                },
              })
            }
          >
            Add variable update
          </ControlButton>
        </>
      )}
    </>
  );
}
