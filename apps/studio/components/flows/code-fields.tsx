'use client';
import { ControlInput, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { CodeEditor } from './code-editor';
import { FieldValidation } from './field-validation';
import { ParameterFields } from './parameter-fields';
import type { FlowNodeData } from '@/lib/flows/types';
import type { ConfigTab } from '@/lib/native/node-config';
export function CodeFields({
  node,
  tab,
  onChange,
  scoped = false,
  variables = [],
  readOnly = false,
}: {
  node: FlowNodeData;
  scoped?: boolean;
  variables?: { id: string; name: string }[];
  readOnly?: boolean;
  tab: ConfigTab;
  onChange: (patch: Partial<FlowNodeData>) => void;
}) {
  const code = node.config.code;
  if (node.kind === 'setVariables' || node.config.variableAssignment)
    return (
      <ParameterFields
        label="Workflow variables"
        path="config.parameters.values"
        value={node.config.parameters?.values ?? { mode: 'object', fields: {} }}
        onChange={(values) => onChange({ config: { parameters: { ...node.config.parameters, values } } })}
      />
    );
  if (!code) return null;
  if (tab === 'inputs')
    return (
      <ParameterFields
        label="Code input"
        schema={node.config.ports?.input?.schema}
        path="config.parameters.input"
        value={node.config.parameters?.input ?? { mode: 'fixed', value: {} }}
        onChange={(input) => onChange({ config: { parameters: { ...node.config.parameters, input } } })}
      />
    );
  if (tab === 'operation')
    return (
      <>
        <FieldValidation path="config.code.language" label="Language">
          <ControlSelect
            aria-label="Code language"
            value={code.language}
            onChange={(e) =>
              onChange({
                config: { code: { ...code, language: e.target.value as typeof code.language, revision: undefined } },
              })
            }
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
          </ControlSelect>
        </FieldValidation>
        {scoped ? (
          <p>Pure transform · One invocation. Use For each for repeated workflow execution.</p>
        ) : (
          <FieldValidation path="config.code.mode" label="Execution mode">
            <ControlSelect
              aria-label="Code execution mode"
              value={code.mode}
              onChange={(e) =>
                onChange({
                  config: { code: { ...code, mode: e.target.value as typeof code.mode, revision: undefined } },
                })
              }
            >
              <option value="all-items">Once for all input</option>
              <option value="each-item">Once per array item</option>
            </ControlSelect>
          </FieldValidation>
        )}
        <FieldValidation path="config.code.source" label="Source code">
          <CodeEditor
            value={code.source}
            language={code.language}
            readOnly={readOnly}
            completions={[
              ...variables.map((d) => ({
                label: `variables[${JSON.stringify(d.id)}]`,
                displayLabel: `variables · ${d.name}`,
              })),
              ...Object.keys((node.config.ports?.input?.schema.properties ?? {}) as object).map((key) => ({
                label: `input[${JSON.stringify(key)}]`,
                displayLabel: `input · ${key}`,
              })),
            ]}
            onChange={(source) => onChange({ config: { code: { ...code, source, revision: undefined } } })}
          />
        </FieldValidation>
        <p>
          Return a JSON value. Available: input, variables, console.{' '}
          {scoped ? 'Use For each to create separate durable invocations.' : 'In per-item mode: item and index.'} Local
          async computations are supported. External I/O and package imports are disabled.
        </p>
        <small>Runtime: {code.runtime} · Dependencies: none</small>
      </>
    );
  if (tab === 'execution')
    return (
      <>
        <p>Isolated runtime limits</p>
        {(
          [
            { key: 'timeoutMS', label: 'Wall-clock timeout (ms)', min: 10, max: 30000 },
            { key: 'memoryMB', label: 'Guest memory (MiB)', min: 8, max: 128 },
            { key: 'maxOutputBytes', label: 'Maximum output bytes', min: 1, max: 4194304 },
          ] as const
        ).map((f) => (
          <FieldValidation key={f.key} path={`config.code.limits.${f.key}`} label={f.label}>
            <ControlInput
              aria-label={f.label}
              type="number"
              min={f.min}
              max={f.max}
              value={code.limits[f.key]}
              onChange={(e) =>
                onChange({
                  config: {
                    code: { ...code, revision: undefined, limits: { ...code.limits, [f.key]: Number(e.target.value) } },
                  },
                })
              }
            />
          </FieldValidation>
        ))}
      </>
    );
  return null;
}
