'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import { Tabs } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { ControlButton, ControlInput } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { CodeFields } from './code-fields';
import { ResultValue, ResultLogs } from './result-value';
import { executionInspection } from '@/lib/authoring/execution-inspection';
import { FieldIssues, FieldValidation, ErrorMark } from './field-validation';
import { compilePreview } from '@/lib/authoring/preview';
import { evaluateExpression } from '@/lib/authoring/expressions';
import { compileParameter } from '@/lib/authoring/model';
import { bind } from '@/lib/native/model';
import { AuthoringFields } from './authoring-fields';
import { MappingContext } from './mapping-context';
import { SchemaTree } from './schema-tree';
import { type MappingTarget, type ScopeSnapshot, ports } from '@/lib/authoring/contracts';
import { ControlSelect } from '@/components/control/controls';
import { Activity, X } from '@/components/fa-icons';
import type { AgentFlow, FlowNodeData, FlowNodeStatus, FlowRunEvent } from '@/lib/flows/types';
import {
  configDefinition,
  previewNodeInputs,
  upstreamNodes,
  validateNodeConfiguration,
} from '@/lib/native/node-config';
import { LiteralFields } from './binding-fields';
import { nodeHelp } from '@/lib/authoring/node-help';
import { SchemaFields } from './schema-fields';
import { valueShape, nodeResultShape } from '@/lib/authoring/editor-shapes';
import { nodeEditorContract, editorIssueLocation, type EditorSection } from '@/lib/authoring/editor-contract';
import { NativeNodeFields } from './native-node-fields';
import { flowSchema } from '@/lib/flows/validation';

type Props = {
  node: FlowNodeData;
  flow: AgentFlow;
  readOnly: boolean;
  runInput: string;
  outputs: Record<string, unknown>;
  status: FlowNodeStatus;
  error?: string;
  scope?: ScopeSnapshot;
  metadata?: { logs: string[]; revision: string };
  events?: FlowRunEvent[];
  onApply: (node: FlowNodeData, input: string, definitions?: AgentFlow['definitions']) => void;
  onClose: () => void;
  onInspectDefinition?: (ref: string) => void;
  renderLegacy: (node: FlowNodeData, onChange: (patch: Partial<FlowNodeData>) => void) => ReactNode;
};
export function NodeConfigDialog({
  node,
  flow: parentFlow,
  readOnly,
  runInput,
  outputs,
  status,
  error,
  metadata,
  events = [],
  scope,
  onApply,
  onClose,
  onInspectDefinition,
  renderLegacy,
}: Props) {
  const [definitions, setDefinitions] = useState(parentFlow.definitions ?? {});
  const flow = { ...parentFlow, definitions };
  const [mappingTarget, setMappingTarget] = useState<MappingTarget | null>(null);
  const [contextMode, setContextMode] = useState(scope ? 'recorded' : 'schema');
  const [pendingMapping, setPendingMapping] = useState<{ target: MappingTarget; expression: string } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [draft, setDraft] = useState<FlowNodeData>(() => structuredClone(node));
  const [sample, setSample] = useState<unknown>(() => {
    try {
      return JSON.parse(runInput);
    } catch {
      return { userInput: runInput };
    }
  });
  const contract = nodeEditorContract(draft);
  const [section, setSection] = useState<EditorSection>('process');
  const [pages, setPages] = useState<Record<EditorSection, string>>({
    input: contract.sections.input[0].id,
    process: contract.sections.process[0].id,
    output: contract.sections.output[0].id,
  });
  const [view, setView] = useState<'configure' | 'results' | 'help'>(readOnly ? 'results' : 'configure');
  const [resultPage, setResultPage] = useState(readOnly ? 'result' : 'setup');
  const execution = executionInspection(events, node.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const pickerRef = useRef<HTMLElement | null>(null);
  const activePage = contract.sections[section].find((p) => p.id === pages[section]) ?? contract.sections[section][0];
  function dismissPicker() {
    setPickerOpen(false);
    setPendingMapping(null);
    const label = mappingTarget?.label;
    requestAnimationFrame(() => {
      const trigger = label
        ? document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(`Use workflow data for ${label}`)}"]`)
        : null;
      (trigger ?? pickerTrigger.current)?.focus();
    });
  }
  useEffect(() => {
    if (pickerOpen) pickerRef.current?.focus();
  }, [pickerOpen]);
  function revealIssue(issue: string) {
    const location = editorIssueLocation(draft, issue);
    setSection(location.section);
    setPages((old) => ({ ...old, [location.section]: location.page }));
    setView('configure');
    requestAnimationFrame(() => {
      const path = issue.split(':')[0];
      const group = document.querySelector(`[data-field-path="${CSS.escape(path)}"]`);
      group?.scrollIntoView({ block: 'nearest' });
      (
        group?.querySelector<HTMLElement>('[contenteditable="true"],textarea') ??
        group?.querySelector<HTMLElement>('input,select')
      )?.focus();
    });
  }
  const [submitted, setSubmitted] = useState(false);
  const [testResult, setTestResult] = useState<{
    value?: unknown;
    logs?: string[];
    revision?: string;
    error?: string;
    fingerprint?: string;
    startedAt?: string;
    endedAt?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const testAbort = useRef<AbortController | null>(null);
  useEffect(() => () => testAbort.current?.abort(), []);
  const [preview, setPreview] = useState<{ value?: unknown; error?: string } | null>(null);
  const upstream = upstreamNodes(flow, node.id);
  const definition = configDefinition(draft);
  const help = nodeHelp(draft);
  const modified =
    JSON.stringify(definitions) !== JSON.stringify(parentFlow.definitions ?? {}) ||
    JSON.stringify(draft) !== JSON.stringify(node) ||
    JSON.stringify(sample) !==
      (() => {
        try {
          return JSON.stringify(JSON.parse(runInput));
        } catch {
          return JSON.stringify({ userInput: runInput });
        }
      })();
  function update(patch: Partial<FlowNodeData>) {
    setDraft((old) => ({ ...old, ...patch, config: { ...old.config, ...patch.config } }));
    setPreview(null);
  }
  function validation() {
    if (readOnly) return [];
    const errors = validateNodeConfiguration(draft, flow);
    if (flow.authoringVersion === 2) {
      try {
        compilePreview(flow, draft);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid configuration';
        if (!errors.some((e) => e.includes(message))) errors.push(`config.parameters: ${message}`);
      }
    }
    if (flow.schemaVersion === 2) {
      const result = flowSchema.shape.defaultInput.unwrap().strict().safeParse(sample);
      if (!result.success) errors.push(...result.error.issues.map((i) => `sample.${i.path.join('.')}: ${i.message}`));
    }
    return errors;
  }
  const issues = submitted ? validation() : [];
  function showErrors(errors: string[]) {
    setSubmitted(true);
    if (errors.length) revealIssue(errors[0]);
  }
  function apply() {
    const errors = validation();
    showErrors(errors);
    if (flow.authoringVersion === 2) {
      if (!flowSchema.shape.nodes.element.safeParse(draft).success) return;
    } else if (errors.length) return;
    onApply(
      flow.authoringVersion === 2 ? { ...draft, config: { ...draft.config, issues: errors } } : draft,
      flow.schemaVersion === 2
        ? JSON.stringify(sample, null, 2)
        : typeof sample === 'object' && sample !== null && 'userInput' in sample
          ? String(sample.userInput ?? '')
          : JSON.stringify(sample),
      definitions,
    );
    onClose();
  }
  function createDefinition() {
    const id = crypto.randomUUID();
    setDefinitions((old) => ({
      ...old,
      [id]: {
        id,
        name: `Inner workflow ${Object.keys(old).length + 1}`,
        schemaVersion: 2,
        authoringVersion: 2,
        declarations: [],
        nodes: [
          { id: 'start', name: 'Start', kind: 'trigger', config: {}, position: { x: -300, y: 0 } },
          {
            id: 'result',
            name: 'Return result',
            kind: 'return',
            config: { operation: { kind: 'return', value: { source: 'input', path: 'variables' } } },
            position: { x: 80, y: 0 },
          },
        ],
        edges: [{ id: 'start-result', source: 'start', target: 'result', sourcePort: 'value', targetPort: 'input' }],
      },
    }));
    return id;
  }
  function previewVariables() {
    if (flow.authoringVersion === 2) {
      if (contextMode === 'recorded' && scope) return scope.variables;
      return Object.fromEntries(
        (flow.declarations ?? []).map((d) => [d.id, bind(compileParameter(d.initial), { input: sample, outputs: {} })]),
      );
    }
    const variables = Object.fromEntries(
      Object.entries(flow.variables ?? {}).map(([key, parameter]) => [
        key,
        bind(compileParameter(parameter), { input: sample, outputs }),
      ]),
    );
    // Recorded completions are inserted in execution order. Apply only ancestors of this node.
    const assignments = new Set(
      upstream.filter((n) => n.kind === 'setVariables' || n.config.variableAssignment).map((n) => n.id),
    );
    for (const [id, output] of Object.entries(outputs)) {
      if (assignments.has(id) && output !== null && typeof output === 'object' && !Array.isArray(output))
        Object.assign(variables, output);
    }
    return variables;
  }
  function previewInputs() {
    if (contextMode === 'schema') {
      setPreview({ error: 'Unresolved: select Sample input or a Recorded invocation to resolve values.' });
      setView('results');
      return;
    }
    const errors = validation();
    showErrors(errors);
    if (errors.length) {
      setView('configure');
      return;
    }
    try {
      const compiled = compilePreview(flow, draft);
      const vars = previewVariables();
      setPreview({
        value: previewNodeInputs(
          compiled.nodes.find((n) => n.id === draft.id)!,
          sample,
          outputs,
          vars,
          contextMode === 'recorded' && scope
            ? { nodeInput: scope.nodeInput, item: scope.item, index: scope.index }
            : undefined,
          flow.authoringVersion === 2,
        ),
      });
    } catch (err) {
      setPreview({ error: err instanceof Error ? err.message : 'Could not resolve inputs.' });
    }
    setView('results');
  }
  const fingerprint = JSON.stringify({ draft, sample, contextMode, scope: contextMode === 'recorded' ? scope : null });
  const latestFingerprint = useRef(fingerprint);
  latestFingerprint.current = fingerprint;
  function close() {
    if (testing) {
      setDiscardOpen(true);
      return;
    }
    if (modified && !readOnly) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }
  async function testCode() {
    const errors = validation();
    showErrors(errors);
    if (errors.length) return;
    setTesting(true);
    const capturedFingerprint = fingerprint;
    const startedAt = new Date().toISOString();
    try {
      const compiled = compilePreview(flow, draft);
      const vars = previewVariables();
      const target = compiled.nodes.find((n) => n.id === draft.id)!;
      const op = target.config.operation!;
      if (op.kind !== 'step') throw new Error('Select a code node.');
      const invocation = bind(op.input, {
        input: sample,
        outputs,
        variables: vars,
        nodeInput: contextMode === 'recorded' ? scope?.nodeInput : undefined,
        item: contextMode === 'recorded' ? scope?.item : undefined,
        index: contextMode === 'recorded' ? scope?.index : undefined,
      }) as {
        definition: unknown;
        input: unknown;
      };
      testAbort.current?.abort();
      testAbort.current = new AbortController();
      const response = await fetch('/api/authoring/test-code', {
        signal: testAbort.current.signal,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...invocation, variables: vars }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Code test failed.');
      setTestResult({ ...result, fingerprint: capturedFingerprint, startedAt, endedAt: new Date().toISOString() });
    } catch (err) {
      setTestResult({
        error: err instanceof Error ? err.message : 'Code test failed.',
        fingerprint: capturedFingerprint,
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      setTesting(false);
      if (latestFingerprint.current === capturedFingerprint) {
        setResultPage('result');
        setView('results');
      }
    }
  }
  function renderPage() {
    const page = activePage;
    if (page.renderer === 'empty') return <p className="nc-empty">{page.description}</p>;
    if (page.renderer === 'details')
      return (
        <>
          <FieldValidation path="name" label="Node name">
            <ControlInput
              aria-label="Node name"
              value={draft.name}
              maxLength={200}
              onChange={(e) => update({ name: e.target.value })}
            />
          </FieldValidation>
          <TextArea
            label="Description"
            value={draft.description ?? ''}
            onChange={(description) => update({ description })}
            rows={3}
          />
        </>
      );
    if (page.renderer === 'native')
      return (
        <NativeNodeFields
          node={draft}
          onChange={update}
          fields={page.fields}
          flow={flow}
          upstream={upstream}
          onCreateDefinition={flow.authoringVersion === 2 ? createDefinition : undefined}
          onInspectDefinition={
            onInspectDefinition && !modified
              ? (ref) => {
                  onClose();
                  onInspectDefinition(ref);
                }
              : undefined
          }
        />
      );
    if (page.renderer === 'authoring' && flow.authoringVersion !== 2 && draft.kind === 'setVariables')
      return <CodeFields node={draft} tab="inputs" onChange={update} readOnly={readOnly} />;
    if (page.renderer === 'authoring')
      return <AuthoringFields node={draft} flow={flow} tab="inputs" onChange={update} />;
    if (page.renderer === 'code')
      return (
        <CodeFields
          node={draft}
          tab={page.tab!}
          onChange={update}
          scoped={flow.authoringVersion === 2}
          variables={[...(flow.declarations ?? []), ...(flow.captures ?? [])]}
          readOnly={readOnly}
        />
      );
    if (page.renderer === 'legacy') return renderLegacy(draft, update);
    if (page.renderer === 'execution')
      return (
        <>
          <p>
            These settings apply to each fresh durable step attempt. Completed checkpoints replay their recorded result.
          </p>
          <FieldValidation path="config.execution.maxAttempts" label="Maximum attempts">
            <ControlInput
              aria-label="Maximum attempts"
              type="number"
              min={1}
              max={20}
              value={draft.config.execution?.maxAttempts ?? 1}
              onChange={(e) =>
                update({
                  config: {
                    execution: { ...draft.config.execution, maxAttempts: Number(e.target.value) },
                  },
                })
              }
            />
          </FieldValidation>
          <FieldValidation path="config.execution.intervalSeconds" label="Retry interval (seconds)">
            <ControlInput
              aria-label="Retry interval (seconds)"
              type="number"
              min={0.001}
              max={3600}
              step="any"
              value={draft.config.execution?.intervalSeconds ?? 1}
              onChange={(e) =>
                update({
                  config: {
                    execution: { ...draft.config.execution, intervalSeconds: Number(e.target.value) },
                  },
                })
              }
            />
          </FieldValidation>
          <FieldValidation path="config.execution.timeoutMS" label="Attempt timeout (milliseconds)">
            <ControlInput
              aria-label="Attempt timeout (milliseconds)"
              type="number"
              min={1}
              max={3600000}
              value={draft.config.execution?.timeoutMS ?? 60000}
              onChange={(e) =>
                update({
                  config: {
                    execution: { ...draft.config.execution, timeoutMS: Number(e.target.value) },
                  },
                })
              }
            />
          </FieldValidation>
        </>
      );
    if (page.renderer === 'contract') {
      const direction = page.direction!;
      const port = ports(draft)[direction];
      return (
        <>
          <p>
            {direction === 'input' ? 'Define the data your code accepts.' : 'Define the value your code returns.'} This
            contract validates execution; it does not execute the node.
          </p>
          <FieldValidation path={`config.ports.${direction}`}>
            <SchemaFields
              label={direction === 'input' ? 'Input shape' : 'Return shape'}
              value={port.schema}
              onChange={(schema) =>
                update({ config: { ports: { ...draft.config.ports, [direction]: { ...port, schema } } } })
              }
            />
            <label>
              Value shape
              <ControlSelect
                aria-label={`${direction} cardinality`}
                value={port.cardinality}
                onChange={(e) =>
                  update({
                    config: {
                      ports: {
                        ...draft.config.ports,
                        [direction]: { ...port, cardinality: e.target.value as 'single' | 'collection' },
                      },
                    },
                  })
                }
              >
                <option value="single">One value</option>
                <option value="collection">Collection</option>
              </ControlSelect>
            </label>
          </FieldValidation>
        </>
      );
    }
    return (
      <>
        <h3>{draft.kind === 'trigger' ? 'Workflow input' : 'Result available to following steps'}</h3>
        {['construct', 'merge'].includes(draft.kind) ? (
          <>
            <p>The value configured in Process becomes this node’s result. Following steps can reference its fields.</p>
            <SchemaTree
              schema={nodeResultShape(draft)}
              path={`$nodes[${JSON.stringify(draft.id)}]`}
              label="Result"
              selectable={false}
            />
          </>
        ) : draft.kind === 'setVariables' ? (
          <p>The configured assignments update declared writable variables in this scope.</p>
        ) : draft.kind === 'receive' || draft.kind === 'waitEvent' ? (
          <p>
            Produces the received value. The existing operation returns null on timeout; handle that case explicitly in
            the graph.
          </p>
        ) : ['delay', 'send', 'event'].includes(draft.kind) ? (
          <p>This operation signals completion. It does not define a data result.</p>
        ) : (
          <SchemaTree
            schema={nodeResultShape(draft)}
            path={`$nodes[${JSON.stringify(draft.id)}]`}
            label="Result"
            selectable={false}
          />
        )}
        <small>Actual execution values are available in Test & results.</small>
      </>
    );
  }
  function availableData() {
    return (
      <>
        <section>
          <h4>Workflow start</h4>
          <SchemaTree schema={valueShape(sample)} path="$input" label="Workflow input" />
          {scope && <SchemaTree schema={valueShape(scope.nodeInput)} path="$nodeInput" label="Current node input" />}
        </section>
        {Boolean(flow.declarations?.length || flow.captures?.length || flow.variables) && (
          <section>
            <h4>Workflow values</h4>
            {[...(flow.declarations ?? []), ...(flow.captures ?? [])].map((d) => (
              <SchemaTree key={d.id} schema={d.schema} path={`$vars[${JSON.stringify(d.id)}]`} label={d.name} />
            ))}
            {flow.authoringVersion !== 2 &&
              Object.keys(flow.variables ?? {}).map((id) => (
                <SchemaTree key={id} schema={{}} path={`$vars[${JSON.stringify(id)}]`} label={id} />
              ))}
          </section>
        )}
        {scope && (Object.hasOwn(scope, 'item') || Object.hasOwn(scope, 'index')) && (
          <section>
            <h4>Current iteration</h4>
            <SchemaTree schema={{}} path="$item" label="Current item" />
            <SchemaTree schema={{ type: 'integer' }} path="$index" label="Item index" />
          </section>
        )}
        {upstream.map((n) => (
          <section key={n.id}>
            <h4>{n.name}</h4>
            <SchemaTree schema={nodeResultShape(n)} path={`$nodes[${JSON.stringify(n.id)}]`} label="Result" />
          </section>
        ))}
      </>
    );
  }
  return (
    <MappingContext.Provider
      value={{
        readOnly,
        target: pickerOpen ? mappingTarget : null,
        setTarget: setMappingTarget,
        openPicker: (target) => {
          pickerTrigger.current = document.activeElement as HTMLElement;
          setMappingTarget(target);
          setPickerOpen(true);
        },
        requestInsert: (expression) => {
          if (!mappingTarget) return;
          if (mappingTarget.replaceRequired) setPendingMapping({ target: mappingTarget, expression });
          else {
            mappingTarget.insert(expression);
            dismissPicker();
          }
        },
        suggestions: [
          { label: '$input', info: 'Workflow input' },
          { label: '$nodeInput', info: 'Current node input' },
          ...Object.keys((sample as any)?.variables ?? {}).map((key) => ({
            label: `$input["variables"][${JSON.stringify(key)}]`,
            displayLabel: `Input · ${key}`,
          })),
          ...upstream.map((n) => ({ label: `$nodes[${JSON.stringify(n.id)}]`, displayLabel: `${n.name} · result` })),
          ...[...(flow.declarations ?? []), ...(flow.captures ?? [])].map((d) => ({
            label: `$vars[${JSON.stringify(d.id)}]`,
            displayLabel: d.name,
          })),
          { label: '$item', info: 'Current item' },
          { label: '$index', info: 'Item index' },
        ],
        preview:
          contextMode === 'schema'
            ? undefined
            : (expression) => {
                try {
                  return {
                    value: evaluateExpression(expression, {
                      input: sample,
                      outputs,
                      variables: previewVariables(),
                      nodeInput: scope?.nodeInput,
                      item: scope?.item,
                      index: scope?.index,
                    }),
                  };
                } catch (err) {
                  return { error: err instanceof Error ? err.message : 'Unavailable value' };
                }
              },
      }}
    >
      <FieldIssues.Provider value={issues}>
        <ModalOverlay
          isOpen
          isDismissable
          onOpenChange={(open) => {
            if (!open) close();
          }}
          className="nc-overlay"
        >
          <Modal className="nc-modal">
            <Dialog aria-label={`Configure ${node.name}`} className="nc-dialog">
              <header className="nc-header">
                <div className="nc-heading">
                  <Activity />
                  <div>
                    <span>
                      {definition?.title ?? node.kind} ·{' '}
                      {contract.classification === 'control'
                        ? 'Control structure'
                        : contract.classification === 'legacy-composition'
                          ? 'Legacy composition'
                          : contract.classification === 'invocation'
                            ? 'Workflow invocation'
                            : contract.classification === 'entry'
                              ? 'Entry point'
                              : 'Operation'}
                      {readOnly ? ' · execution snapshot' : ''}
                    </span>
                    <h2>{draft.name || 'Untitled node'}</h2>
                  </div>
                </div>
                <Button color="tertiary" iconLeading={X} aria-label="Close node configuration" onPress={close} />
              </header>
              <Tabs
                orientation="vertical"
                selectedKey={view === 'configure' ? section : view}
                onSelectionChange={(key) => {
                  const selected = String(key);
                  if (pickerOpen) dismissPicker();
                  if (selected === 'help' || selected === 'results') {
                    setView(selected);
                    if (selected === 'results' && contextMode === 'schema')
                      setContextMode(scope ? 'recorded' : 'sample');
                  } else {
                    setSection(selected as EditorSection);
                    setView('configure');
                  }
                }}
                className="nc-workspace"
              >
                <Tabs.List
                  aria-label="Node configuration"
                  orientation="vertical"
                  type="line"
                  className="nc-section-nav"
                >
                  {(['input', 'process', 'output'] as const).map((id) => (
                    <Tabs.Item
                      id={id}
                      key={id}
                      aria-label={`${id === 'input' ? 'Input' : id === 'process' ? 'Process' : 'Output'}${issues.some((issue) => editorIssueLocation(draft, issue).section === id) ? ' — contains errors' : ''}`}
                    >
                      {id === 'input' ? 'Input' : id === 'process' ? 'Process' : 'Output'}
                      {issues.some((issue) => editorIssueLocation(draft, issue).section === id) && <ErrorMark />}
                    </Tabs.Item>
                  ))}
                  <Tabs.Item id="results" className="nc-inspection-tab">
                    Test & results
                  </Tabs.Item>
                  <Tabs.Item id="help">Help</Tabs.Item>
                </Tabs.List>
                <Tabs.Panel id={view === 'configure' ? section : view} className="nc-section-panel">
                  {pickerOpen ? (
                    <section
                      className="nc-picker"
                      ref={pickerRef}
                      tabIndex={-1}
                      aria-label={`Choose data for ${mappingTarget?.label}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          if (pendingMapping) setPendingMapping(null);
                          else dismissPicker();
                        }
                      }}
                    >
                      <header>
                        <div>
                          <h3>Use workflow data</h3>
                          <p>Choose a value for {mappingTarget?.label}.</p>
                        </div>
                        <ControlButton onClick={dismissPicker}>Back to field</ControlButton>
                      </header>
                      <div className="nc-picker-body">{availableData()}</div>
                    </section>
                  ) : view === 'help' ? (
                    <section className="nc-help" aria-label={`Help for ${draft.name}`}>
                      <header>
                        <h3>{definition?.title ?? draft.kind}</h3>
                        <p>{help.purpose}</p>
                      </header>
                      <dl>
                        <div>
                          <dt>Input</dt>
                          <dd>{help.input}</dd>
                        </div>
                        <div>
                          <dt>Process</dt>
                          <dd>{help.process}</dd>
                        </div>
                        <div>
                          <dt>Output</dt>
                          <dd>{help.output}</dd>
                        </div>
                      </dl>
                      <h4>Things to know</h4>
                      <ul>
                        {help.tips.map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                      {help.reference && (
                        <a href={help.reference} target="_blank" rel="noreferrer">
                          Read the DBOS documentation ↗
                        </a>
                      )}
                    </section>
                  ) : view === 'configure' ? (
                    <>
                      <div className="nc-section-heading">
                        <h3>
                          {section === 'input'
                            ? 'What this node receives'
                            : section === 'process'
                              ? 'What this node does'
                              : 'What this node produces'}
                        </h3>
                      </div>
                      <Tabs
                        selectedKey={activePage.id}
                        onSelectionChange={(key) => setPages((old) => ({ ...old, [section]: String(key) }))}
                        className="nc-config-tabs"
                      >
                        <Tabs.List
                          aria-label={`${section} sections`}
                          type="underline"
                          className={contract.sections[section].length === 1 ? 'sr-only' : undefined}
                        >
                          {contract.sections[section].map((page) => (
                            <Tabs.Item
                              id={page.id}
                              key={page.id}
                              aria-label={`${page.label}${
                                issues.some((issue) => {
                                  const loc = editorIssueLocation(draft, issue);
                                  return loc.section === section && loc.page === page.id;
                                })
                                  ? ' — contains errors'
                                  : ''
                              }`}
                            >
                              {page.label}
                              {issues.some((issue) => {
                                const loc = editorIssueLocation(draft, issue);
                                return loc.section === section && loc.page === page.id;
                              }) && <ErrorMark />}
                            </Tabs.Item>
                          ))}
                        </Tabs.List>
                        {issues.length > 0 && (
                          <div role="alert" className="nc-errors">
                            <strong>Check the configuration</strong>
                            <ul>
                              {issues.map((issue, i) => (
                                <li key={i}>
                                  <Button color="link-destructive" onPress={() => revealIssue(issue)}>
                                    {issue.replace(/^config\.(parameters|code|merge)\./, '')}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <Tabs.Panel id={activePage.id} className="nc-config-body" key={`${section}:${activePage.id}`}>
                          <fieldset disabled={readOnly} className="nc-edit-fields">
                            {renderPage()}
                          </fieldset>
                          {readOnly && <p className="nc-readonly">Viewing an immutable execution snapshot.</p>}
                        </Tabs.Panel>
                      </Tabs>
                    </>
                  ) : (
                    <section className="nc-results" aria-label="Test and execution results">
                      <header className="nc-execution-summary">
                        <h3>{readOnly ? `Node execution · ${status}` : 'Test & results'}</h3>
                        {readOnly ? (
                          <p>
                            {execution.startedAt
                              ? `Started ${new Date(execution.startedAt).toLocaleString()}`
                              : 'Start time not recorded'}
                            {execution.elapsedMs !== undefined &&
                              ` · Elapsed ${execution.elapsedMs < 1000 ? `${execution.elapsedMs} ms` : `${(execution.elapsedMs / 1000).toFixed(2)} s`}`}
                          </p>
                        ) : testResult ? (
                          <p>
                            {testResult.fingerprint !== fingerprint
                              ? 'Stale test · configuration or test data changed'
                              : 'Latest standalone test'}{' '}
                            · {testResult.error ? 'Failed' : 'Succeeded'}
                          </p>
                        ) : (
                          <p>Preview resolved inputs or test code before running the workflow.</p>
                        )}
                      </header>
                      <Tabs
                        selectedKey={resultPage}
                        onSelectionChange={(key) => setResultPage(String(key))}
                        className="nc-result-tabs"
                      >
                        <Tabs.List
                          aria-label={readOnly ? 'Execution views' : 'Test views'}
                          orientation="horizontal"
                          type="underline"
                        >
                          {!readOnly && <Tabs.Item id="setup">Test setup</Tabs.Item>}
                          <Tabs.Item id="result">Result</Tabs.Item>
                          {readOnly && <Tabs.Item id="input">Input</Tabs.Item>}
                          <Tabs.Item id="logs">Logs</Tabs.Item>
                          {readOnly && <Tabs.Item id="details">Details</Tabs.Item>}
                        </Tabs.List>
                        <Tabs.Panel id={resultPage} className="nc-result-panel">
                          {resultPage === 'setup' && !readOnly ? (
                            <div className="nc-results-context">
                              <p>
                                Preview resolves inputs without executing an operation. Test code runs a standalone code
                                test without a workflow checkpoint.
                              </p>
                              <label>
                                Test data source
                                <ControlSelect
                                  aria-label="Test data source"
                                  value={contextMode}
                                  onChange={(e) => {
                                    setContextMode(e.target.value);
                                    setPreview(null);
                                  }}
                                >
                                  <option value="sample">Workflow test input</option>
                                  {scope && <option value="recorded">Recorded invocation</option>}
                                </ControlSelect>
                              </label>
                              {contextMode === 'sample' && (
                                <details>
                                  <summary>Edit workflow test input</summary>
                                  <LiteralFields
                                    label="Workflow test input"
                                    value={sample}
                                    onChange={(next) => {
                                      setSample(next);
                                      setPreview(null);
                                    }}
                                  />
                                </details>
                              )}
                              <div className="nc-result-actions">
                                <ControlButton onClick={previewInputs}>Preview inputs</ControlButton>
                                {draft.config.code && (
                                  <ControlButton disabled={testing} onClick={() => void testCode()}>
                                    {testing ? 'Testing…' : 'Test code'}
                                  </ControlButton>
                                )}
                                {testing && (
                                  <ControlButton onClick={() => testAbort.current?.abort()}>Cancel test</ControlButton>
                                )}
                              </div>
                              {preview &&
                                (preview.error ? (
                                  <p role="alert">{preview.error}</p>
                                ) : (
                                  <ResultValue
                                    key={JSON.stringify(preview.value)}
                                    value={preview.value}
                                    label="Resolved inputs"
                                  />
                                ))}
                            </div>
                          ) : resultPage === 'result' ? (
                            readOnly ? (
                              <>
                                {error && <p role="alert">{error}</p>}
                                {execution.presence === 'absent' ? (
                                  <p className="nc-empty">This node completed without an output value.</p>
                                ) : Object.hasOwn(outputs, node.id) ? (
                                  <ResultValue
                                    key={JSON.stringify(outputs[node.id])}
                                    value={outputs[node.id]}
                                    label="Output"
                                  />
                                ) : (
                                  <p className="nc-empty">
                                    {status === 'skipped'
                                      ? `Node skipped${execution.reason ? `: ${execution.reason}` : '.'}`
                                      : status === 'running' || status === 'waiting'
                                        ? 'This node has not produced an output yet.'
                                        : 'No output was recorded for this node.'}
                                  </p>
                                )}
                              </>
                            ) : testResult ? (
                              <>
                                {testResult.error ? (
                                  <p role="alert">{testResult.error}</p>
                                ) : (
                                  <ResultValue
                                    key={JSON.stringify(testResult.value)}
                                    value={testResult.value}
                                    label="Test output"
                                  />
                                )}
                                <p className="nc-result-note">
                                  Standalone test ·{' '}
                                  {testResult.startedAt && new Date(testResult.startedAt).toLocaleString()}
                                  {testResult.startedAt &&
                                    testResult.endedAt &&
                                    ` · ${Date.parse(testResult.endedAt) - Date.parse(testResult.startedAt)} ms`}
                                </p>
                              </>
                            ) : (
                              <p className="nc-empty">
                                {draft.config.code
                                  ? 'No code test yet. Run Test code from Test setup.'
                                  : 'Run the workflow to record this node’s output. Open that execution from All runs.'}
                              </p>
                            )
                          ) : resultPage === 'input' && readOnly ? (
                            scope && Object.hasOwn(scope, 'nodeInput') ? (
                              <ResultValue value={scope.nodeInput} label="Captured input" />
                            ) : (
                              <p className="nc-empty">
                                This execution did not capture the resolved input for this node.
                              </p>
                            )
                          ) : resultPage === 'logs' ? (
                            <ResultLogs logs={readOnly ? metadata?.logs : testResult?.logs} />
                          ) : resultPage === 'details' && readOnly ? (
                            <dl className="nc-execution-details">
                              <div>
                                <dt>Node ID</dt>
                                <dd>
                                  <code>{node.id}</code>
                                </dd>
                              </div>
                              {execution.runId && (
                                <div>
                                  <dt>Run ID</dt>
                                  <dd>
                                    <code>{execution.runId}</code>
                                  </dd>
                                </div>
                              )}
                              {execution.startedAt && (
                                <div>
                                  <dt>Started</dt>
                                  <dd>{execution.startedAt}</dd>
                                </div>
                              )}
                              {execution.endedAt && (
                                <div>
                                  <dt>Ended</dt>
                                  <dd>{execution.endedAt}</dd>
                                </div>
                              )}
                              {scope && (
                                <div>
                                  <dt>Execution scope</dt>
                                  <dd>
                                    <code>{scope.id}</code>
                                  </dd>
                                </div>
                              )}
                              {metadata?.revision && (
                                <div>
                                  <dt>Code revision</dt>
                                  <dd>
                                    <code>{metadata.revision}</code>
                                  </dd>
                                </div>
                              )}
                            </dl>
                          ) : null}
                        </Tabs.Panel>
                      </Tabs>
                    </section>
                  )}
                </Tabs.Panel>
              </Tabs>
              {pendingMapping && (
                <section className="nc-discard" aria-label="Replace field mapping">
                  <p>Replace the current value of {pendingMapping.target.label}?</p>
                  <ControlButton onClick={() => setPendingMapping(null)}>Keep value</ControlButton>
                  <ControlButton
                    className="cp-primary"
                    onClick={() => {
                      pendingMapping.target.insert(pendingMapping.expression);
                      setPendingMapping(null);
                      dismissPicker();
                    }}
                  >
                    Replace mapping
                  </ControlButton>
                </section>
              )}
              {discardOpen && (
                <section className="nc-discard" aria-label="Unsaved node changes">
                  <p>
                    {testing
                      ? 'A standalone test is running. Discarding cancels that test.'
                      : 'Discard staged node changes?'}
                  </p>
                  <ControlButton onClick={() => setDiscardOpen(false)}>Keep editing</ControlButton>
                  <ControlButton
                    onClick={() => {
                      testAbort.current?.abort();
                      onClose();
                    }}
                  >
                    Discard changes
                  </ControlButton>
                </section>
              )}
              <footer className="nc-footer">
                <p>
                  {readOnly
                    ? 'Recorded results remain unchanged.'
                    : 'Apply updates the graph draft. Save the workflow to persist it.'}
                </p>
                <div>
                  <ControlButton onClick={close}>{readOnly ? 'Close' : 'Cancel'}</ControlButton>
                  {!readOnly && (
                    <ControlButton className="cp-primary" onClick={apply}>
                      Apply
                    </ControlButton>
                  )}
                </div>
              </footer>
            </Dialog>
          </Modal>
        </ModalOverlay>
      </FieldIssues.Provider>
    </MappingContext.Provider>
  );
}
