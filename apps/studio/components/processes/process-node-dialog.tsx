'use client';
import { useEffect, useState } from 'react';
import { processIcon } from './process-icons';
import { ConfigurationDialog } from '@/components/graph-editor/configuration-dialog';
import { Tabs } from '@/components/application/tabs/tabs';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { ParameterFields } from '@/components/flows/parameter-fields';
import { X } from '@/components/fa-icons';
import { flowSchema } from '@/lib/flows/validation';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { SchemaFields } from '@/components/flows/schema-fields';
import { controlRequest } from '@/components/control/access';
import { processAgentDefinitionSchema, processAgentTools } from '@/lib/processes/agent';
import { NodeConfigDialog } from '@/components/flows/node-config-dialog';
import { parameterFromBinding } from '@/lib/authoring/model';
import { projectProcess, projectProcessElement } from '@/lib/processes/projection';
import { defaultProcessOperation, processOperations, type ProcessOperationKind } from '@/lib/processes/defaults';
import type { ProcessDocument } from '@/lib/processes/model';
import type { AgentFlow } from '@/lib/flows/types';
import type { AgentDefinition, AgentRevisionRef } from '@/lib/agent/definitions';
import { processElementSchema, type ProcessElement } from '@/lib/processes/model';
export function ProcessNodeDialog({
  element,
  document,
  readOnly,
  onApply,
  onClose,
}: {
  element: ProcessElement;
  document: ProcessDocument;
  readOnly: boolean;
  onApply: (element: ProcessElement, definitions?: AgentFlow['definitions']) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(element)),
    [section, setSection] = useState('process'),
    [page, setPage] = useState('general'),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const [specialists, setSpecialists] = useState<
    { id: string; name: string; published: AgentRevisionRef & { definition: AgentDefinition } }[]
  >([]);
  const [agentsError, setAgentsError] = useState('');
  useEffect(() => {
    let active = true;
    void controlRequest('/api/agent/definitions')
      .then(async (data) => {
        const items = await Promise.all(
          data.items
            .filter(
              (d: { enabled: boolean; archivedAt: string | null; kind: string }) =>
                d.enabled && !d.archivedAt && d.kind === 'specialist',
            )
            .map((d: { id: string }) => controlRequest(`/api/agent/definitions/${d.id}`)),
        );
        if (active) setSpecialists(items.filter((d) => d.published?.definition.interaction === 'structured_output'));
      })
      .catch((e) => {
        if (active) setAgentsError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const Icon = processIcon(draft);
  const agent = draft.kind === 'activity' && draft.binding.kind === 'agent';
  const dirty = JSON.stringify(draft) !== JSON.stringify(element);
  const close = () => (dirty && !readOnly ? setDiscard(true) : onClose());
  if (draft.kind === 'decision' || (draft.kind === 'activity' && draft.binding.kind === 'operation')) {
    const flow = projectProcess(document, 'Process'),
      node = projectProcessElement(draft, document);
    return (
      <NodeConfigDialog
        presentation={{
          icon: Icon,
          label: `Process activity · ${draft.kind === 'decision' ? 'Decision' : draft.kind === 'activity' && draft.binding.kind === 'operation' ? (processOperations[draft.binding.operation.kind as ProcessOperationKind] ?? draft.binding.operation.kind) : draft.kind}`,
        }}
        persistenceLabel="Apply updates the process draft. Save revision to persist it."
        node={node}
        flow={flow}
        readOnly={readOnly}
        runInput={JSON.stringify(flow.defaultInput)}
        outputs={{}}
        status="idle"
        onClose={onClose}
        renderLegacy={() => null}
        onApply={(configured, _input, definitions) => {
          if (draft.kind === 'decision' && configured.config.operation?.kind === 'decision') {
            const predicate = configured.config.operation.predicate;
            onApply(
              {
                ...draft,
                name: configured.name,
                operator: predicate.operator,
                left: configured.config.parameters?.['predicate.left'] ?? parameterFromBinding(predicate.left),
                right:
                  configured.config.parameters?.['predicate.right'] ??
                  parameterFromBinding(predicate.right ?? { source: 'literal', value: null }),
              },
              definitions,
            );
          } else if (draft.kind === 'activity' && configured.config.operation)
            onApply(
              {
                ...draft,
                name: configured.name,
                binding: {
                  kind: 'operation',
                  operation: configured.config.operation,
                  parameters: configured.config.parameters ?? {},
                  ...(configured.config.execution ? { execution: configured.config.execution } : {}),
                  ...(configured.config.ports
                    ? { ports: flowSchema.shape.nodes.element.shape.config.shape.ports.parse(configured.config.ports) }
                    : {}),
                },
              },
              definitions,
            );
          onClose();
        }}
      />
    );
  }
  return (
    <ConfigurationDialog label={`Configure ${element.name}`} onClose={close}>
      <header className="nc-header">
        <div className="nc-heading">
          <Icon />
          <div>
            <span>
              Process {element.kind} · {readOnly ? 'saved revision' : 'business definition'}
            </span>
            <h2>{draft.name}</h2>
          </div>
        </div>
        <ControlButton iconLeading={X} aria-label="Close process configuration" onPress={close} />
      </header>
      <Tabs
        orientation="vertical"
        selectedKey={section}
        onSelectionChange={(k) => setSection(String(k))}
        className="nc-workspace"
      >
        <Tabs.List
          aria-label="Process element configuration"
          orientation="vertical"
          type="line"
          className="nc-section-nav"
        >
          <Tabs.Item id="input">Input</Tabs.Item>
          <Tabs.Item id="process">Process</Tabs.Item>
          <Tabs.Item id="output">Output</Tabs.Item>
          <Tabs.Item id="help">Help</Tabs.Item>
        </Tabs.List>
        <Tabs.Panel id={section} className="nc-section-panel">
          <div className="nc-section-heading">
            <h3>
              {section === 'input'
                ? 'What this activity receives'
                : section === 'process'
                  ? 'What this activity does'
                  : section === 'output'
                    ? 'What this activity produces'
                    : 'About this process activity'}
            </h3>
          </div>
          <Tabs
            selectedKey={section === 'process' && agent ? page : 'general'}
            onSelectionChange={(k) => setPage(String(k))}
            className="nc-config-tabs"
          >
            <Tabs.List
              aria-label="Activity settings"
              type="underline"
              className={section !== 'process' || !agent ? 'sr-only' : undefined}
            >
              <Tabs.Item id="general">General</Tabs.Item>
              {section === 'process' && agent && <Tabs.Item id="execution">Execution</Tabs.Item>}
              {section === 'process' && agent && <Tabs.Item id="tools">Allowed tools</Tabs.Item>}
            </Tabs.List>
            <Tabs.Panel id={section === 'process' && agent ? page : 'general'} className="nc-config-body">
              <fieldset disabled={readOnly} className="nc-edit-fields">
                {section === 'process' && (!agent || page === 'general') && (
                  <>
                    <label>
                      Name
                      <ControlInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <label>
                      Responsibility lane
                      <ControlSelect
                        aria-label="Activity responsibility lane"
                        value={draft.laneId ?? ''}
                        onChange={(e) => setDraft({ ...draft, laneId: e.target.value || undefined })}
                      >
                        <option value="">Unassigned</option>
                        {document.lanes?.map((lane) => (
                          <option key={lane.id} value={lane.id}>
                            {lane.name}
                          </option>
                        ))}
                      </ControlSelect>
                    </label>
                    {draft.kind === 'start' ? (
                      <p>Receives the process input. Configure its schema, defaults and purpose in Process settings.</p>
                    ) : draft.kind === 'end' ? (
                      <p>Completes the process with the value configured under Output.</p>
                    ) : draft.kind === 'merge' ? (
                      <p>
                        Combines the selected decision route. Output contains the values from the executed incoming
                        route.
                      </p>
                    ) : (
                      draft.kind === 'activity' && (
                        <>
                          <label>
                            Activity type
                            <ControlSelect
                              value={
                                draft.binding.kind === 'construct'
                                  ? 'construct'
                                  : draft.binding.kind === 'requirement'
                                    ? draft.binding.performer
                                    : draft.binding.kind === 'agent'
                                      ? 'bound-agent'
                                      : 'operation'
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === 'bound-agent') return;
                                setPage('general');
                                setDraft({
                                  ...draft,
                                  binding:
                                    value in processOperations
                                      ? {
                                          kind: 'operation',
                                          operation: defaultProcessOperation(value as ProcessOperationKind),
                                          parameters: {},
                                        }
                                      : value === 'construct'
                                        ? { kind: 'construct', value: { mode: 'fixed', value: null } }
                                        : {
                                            kind: 'requirement',
                                            performer: value as 'system' | 'human' | 'agent',
                                            capability:
                                              draft.binding.kind === 'requirement'
                                                ? draft.binding.capability
                                                : 'Describe the required business action.',
                                          },
                                });
                              }}
                            >
                              <option value="construct">Construct data</option>
                              <option value="system">System intent (unbound)</option>
                              {Object.entries(processOperations).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                              <option value="human">Human activity</option>
                              <option value="agent">Agent intent (unbound)</option>
                              {draft.binding.kind === 'agent' && (
                                <option value="bound-agent">Agent activity — workspace harness</option>
                              )}
                            </ControlSelect>
                          </label>
                          {(draft.binding.kind === 'agent' ||
                            (draft.binding.kind === 'requirement' && draft.binding.performer === 'agent')) && (
                            <>
                              <label>
                                Published specialist
                                <ControlSelect
                                  value={
                                    draft.binding.kind === 'agent' && 'agentRef' in draft.binding.definition
                                      ? `${draft.binding.definition.agentRef.agentId}:r${draft.binding.definition.agentRef.revision}`
                                      : ''
                                  }
                                  onChange={(e) => {
                                    const selected = specialists.find(
                                      (a) => `${a.id}:r${a.published.revision}` === e.target.value,
                                    );
                                    if (!selected) return;
                                    const { definition, agentId, revision, hash } = selected.published;
                                    setDraft({
                                      ...draft,
                                      binding: {
                                        kind: 'agent',
                                        definition: {
                                          agentRef: { agentId, revision, hash },
                                          goal:
                                            draft.binding.kind === 'requirement'
                                              ? draft.binding.capability
                                              : draft.binding.kind === 'agent'
                                                ? draft.binding.definition.goal
                                                : draft.name,
                                          tools: processAgentTools.filter((t) =>
                                            definition.tools.some((name) => name === t),
                                          ),
                                          outputSchema: definition.outputSchema!,
                                          maxTurns: Math.min(8, definition.limits.turns),
                                          deadlineSeconds: 300,
                                        },
                                        input:
                                          draft.binding.kind === 'agent'
                                            ? draft.binding.input
                                            : { mode: 'expression', expression: '$input.variables' },
                                      },
                                    });
                                  }}
                                >
                                  <option value="">Select a structured-output specialist</option>
                                  {draft.binding.kind === 'agent' &&
                                    'agentRef' in draft.binding.definition &&
                                    !specialists.some(
                                      (a) =>
                                        draft.binding.kind === 'agent' &&
                                        'agentRef' in draft.binding.definition &&
                                        a.id === draft.binding.definition.agentRef.agentId &&
                                        a.published.revision === draft.binding.definition.agentRef.revision,
                                    ) && (
                                      <option
                                        value={`${draft.binding.definition.agentRef.agentId}:r${draft.binding.definition.agentRef.revision}`}
                                      >
                                        Pinned specialist · r{draft.binding.definition.agentRef.revision}
                                      </option>
                                    )}
                                  {specialists.map((a) => (
                                    <option key={a.id} value={`${a.id}:r${a.published.revision}`}>
                                      {a.name} · r{a.published.revision}
                                    </option>
                                  ))}
                                </ControlSelect>
                              </label>
                              <p className="wi-notice">
                                Publish and enable a structured-output specialist in Workspace intelligence → Agents.
                                Selecting it pins its revision and result schema; saving this process does not run it.
                              </p>
                              {agentsError && <p role="alert">{agentsError}</p>}
                            </>
                          )}
                          {draft.binding.kind === 'agent' && (
                            <>
                              <p>
                                Read-only process activity · pinned{' '}
                                {'agentRef' in draft.binding.definition ? 'specialist' : 'workspace policy'} r
                                {'configurationRevision' in draft.binding.definition
                                  ? draft.binding.definition.configurationRevision
                                  : draft.binding.definition.agentRef.revision}
                                . Model calls, tool calls and recovery use the existing durable workspace harness.
                              </p>
                              <TextArea
                                label="Agent goal"
                                value={draft.binding.definition.goal}
                                onChange={(goal) => {
                                  if (draft.binding.kind === 'agent')
                                    setDraft({
                                      ...draft,
                                      binding: { ...draft.binding, definition: { ...draft.binding.definition, goal } },
                                    });
                                }}
                              />
                            </>
                          )}
                          {draft.binding.kind === 'requirement' && (
                            <>
                              <TextArea
                                label="Required capability"
                                value={draft.binding.capability}
                                onChange={(capability) => {
                                  if (draft.binding.kind === 'requirement')
                                    setDraft({ ...draft, binding: { ...draft.binding, capability } });
                                }}
                              />
                              <p className="wi-notice">
                                This is business intent. An executable {draft.binding.performer} binding is required
                                before compilation. No agent or external operation is run by this diagram.
                              </p>
                            </>
                          )}
                        </>
                      )
                    )}
                  </>
                )}
                {section === 'process' &&
                  page === 'execution' &&
                  draft.kind === 'activity' &&
                  draft.binding.kind === 'agent' && (
                    <>
                      {' '}
                      <label>
                        Deadline (seconds)
                        <ControlInput
                          type="number"
                          min={10}
                          max={1800}
                          value={draft.binding.definition.deadlineSeconds}
                          onChange={(e) => {
                            if (draft.binding.kind === 'agent')
                              setDraft({
                                ...draft,
                                binding: {
                                  ...draft.binding,
                                  definition: {
                                    ...draft.binding.definition,
                                    deadlineSeconds: Number(e.target.value),
                                  },
                                },
                              });
                          }}
                        />
                      </label>
                      <label>
                        Maximum reasoning turns
                        <ControlInput
                          type="number"
                          min={1}
                          max={12}
                          value={draft.binding.definition.maxTurns}
                          onChange={(e) => {
                            if (draft.binding.kind === 'agent')
                              setDraft({
                                ...draft,
                                binding: {
                                  ...draft.binding,
                                  definition: { ...draft.binding.definition, maxTurns: Number(e.target.value) },
                                },
                              });
                          }}
                        />
                      </label>
                    </>
                  )}
                {section === 'process' &&
                  page === 'tools' &&
                  draft.kind === 'activity' &&
                  draft.binding.kind === 'agent' && (
                    <>
                      {' '}
                      <h3>Allowed workspace tools</h3>
                      {processAgentTools.map((tool) => (
                        <Checkbox
                          key={tool}
                          label={tool}
                          isSelected={draft.binding.kind === 'agent' && draft.binding.definition.tools.includes(tool)}
                          onChange={(checked) => {
                            if (draft.binding.kind === 'agent')
                              setDraft({
                                ...draft,
                                binding: {
                                  ...draft.binding,
                                  definition: {
                                    ...draft.binding.definition,
                                    tools: checked
                                      ? [...draft.binding.definition.tools, tool]
                                      : draft.binding.definition.tools.filter((t) => t !== tool),
                                  },
                                },
                              });
                          }}
                        />
                      ))}
                    </>
                  )}
                {section === 'input' && draft.kind === 'activity' && draft.binding.kind === 'agent' ? (
                  <ParameterFields
                    label="Agent input"
                    path={`elements.${draft.id}.binding.input`}
                    value={draft.binding.input}
                    onChange={(input) => {
                      if (draft.binding.kind === 'agent') setDraft({ ...draft, binding: { ...draft.binding, input } });
                    }}
                  />
                ) : (
                  section === 'input' && (
                    <p>
                      {draft.kind === 'start'
                        ? 'Process settings define the workflow input schema. Existing expressions retain the $input.variables compatibility envelope.'
                        : 'Use Fixed / Expression fields in Output to construct values from process input and prior activities. Executable activity input bindings are configured when that capability is supported.'}
                    </p>
                  )
                )}
                {section === 'output' &&
                  (draft.kind === 'end' ? (
                    <ParameterFields
                      label="Result"
                      path={`elements.${draft.id}.value`}
                      value={draft.value}
                      onChange={(value) => setDraft({ ...draft, value })}
                    />
                  ) : draft.kind === 'activity' && draft.binding.kind === 'construct' ? (
                    <ParameterFields
                      label="Constructed value"
                      path={`elements.${draft.id}.binding.value`}
                      value={draft.binding.value}
                      onChange={(value) => setDraft({ ...draft, binding: { kind: 'construct', value } })}
                    />
                  ) : (
                    <p>
                      {draft.kind === 'start'
                        ? 'Provides the process input to subsequent activities.'
                        : draft.kind === 'activity' && draft.binding.kind === 'agent'
                          ? 'Returns { result, agentWorkId, agentSessionId }. The result is validated against the pinned schema; the IDs open the actual Activity history.'
                          : 'The output contract will be supplied by the executable activity binding. This unresolved activity cannot compile.'}
                    </p>
                  ))}
                {section === 'output' && draft.kind === 'activity' && draft.binding.kind === 'agent' && (
                  <>
                    {' '}
                    <fieldset disabled={'agentRef' in draft.binding.definition}>
                      <SchemaFields
                        label="Agent result schema"
                        value={draft.binding.definition.outputSchema}
                        onChange={(outputSchema) => {
                          if (draft.binding.kind === 'agent')
                            setDraft({
                              ...draft,
                              binding: {
                                ...draft.binding,
                                definition: {
                                  ...draft.binding.definition,
                                  outputSchema: processAgentDefinitionSchema.shape.outputSchema.parse(outputSchema),
                                },
                              },
                            });
                        }}
                      />
                    </fieldset>
                    {'agentRef' in draft.binding.definition && (
                      <p className="wi-notice">
                        This schema comes from the published specialist. Publish a new specialist revision to change its
                        contract.
                      </p>
                    )}
                  </>
                )}
                {section === 'help' && (
                  <>
                    <h3>Process activity</h3>
                    <p>
                      Connections describe execution order. Drag cards to arrange them; moving a card does not change
                      sequence. Save the process after applying configuration.
                    </p>
                    <p>Stable reference: {draft.id}</p>
                    <p>{draft.evidence.length} evidence reference(s) retained from the source definition.</p>
                  </>
                )}
              </fieldset>
              {error && (
                <p role="alert" className="cp-error">
                  {error}
                </p>
              )}
              {discard && (
                <section className="process-discard" role="alert">
                  <p>Discard unapplied configuration changes?</p>
                  <ControlButton onPress={() => setDiscard(false)}>Keep editing</ControlButton>
                  <ControlButton onPress={onClose}>Discard changes</ControlButton>
                </section>
              )}
            </Tabs.Panel>
          </Tabs>
        </Tabs.Panel>
      </Tabs>
      <footer className="nc-footer">
        <p>Apply updates the process draft. Save revision to persist it.</p>
        <div>
          <ControlButton onPress={close}>{readOnly ? 'Close' : 'Cancel'}</ControlButton>
          {!readOnly && (
            <ControlButton
              className="cp-primary"
              onPress={() => {
                const parsed = processElementSchema.safeParse(draft);
                if (!parsed.success) {
                  setError(parsed.error.issues.map((i) => i.message).join(' '));
                  return;
                }
                onApply(parsed.data);
                onClose();
              }}
            >
              Apply
            </ControlButton>
          )}
        </div>
      </footer>
    </ConfigurationDialog>
  );
}
