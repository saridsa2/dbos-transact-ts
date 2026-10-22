import { authoringDefinitions } from '../authoring/definitions';
import { assertValue } from '../authoring/contracts';
import { compileParameter, parameterReferences } from '../authoring/model';
import type { AgentFlow, FlowNodeData } from '../flows/types';
import { flowSchema } from '../flows/validation';
import {
  bind,
  nodeBindings,
  operationSchema,
  references,
  type Binding,
  type NativeKind,
  type NativeOperation,
} from './model';

export type NativeNodeConfig<K extends NativeKind> = {
  operation: NativeOperation & { kind: K };
  execution?: FlowNodeData['config']['execution'];
};
export type ConfigTab = 'general' | 'operation' | 'inputs' | 'execution' | 'advanced';
export type ConfigField = {
  key: string;
  label: string;
  tab: 'operation' | 'inputs';
  control: 'text' | 'number' | 'select' | 'handler' | 'workflow' | 'queue' | 'binding' | 'predicate' | 'branches';
  optional?: boolean;
  options?: string[];
  min?: number;
  max?: number;
};
type Definition<K extends NativeKind> = {
  title: string;
  operationLabel: string;
  execution?: boolean;
  fields: (ConfigField & { key: Exclude<keyof NativeNodeConfig<K>['operation'], 'kind'> })[];
};

/** UI metadata is exhaustive and field keys are checked against each executor contract. */
export const nodeConfigDefinitions = {
  step: {
    title: 'Durable step',
    operationLabel: 'Operation',
    execution: true,
    fields: [
      { key: 'handler', label: 'Registered operation', tab: 'operation', control: 'handler' },
      { key: 'input', label: 'Operation inputs', tab: 'inputs', control: 'binding' },
    ],
  },
  transaction: {
    title: 'Transaction',
    operationLabel: 'Datasource operation',
    fields: [
      { key: 'handler', label: 'Registered transaction', tab: 'operation', control: 'handler' },
      { key: 'input', label: 'Transaction inputs', tab: 'inputs', control: 'binding' },
    ],
  },
  assign: {
    title: 'Map data',
    operationLabel: 'Mapping',
    fields: [{ key: 'value', label: 'Mapped value', tab: 'inputs', control: 'binding' }],
  },
  return: {
    title: 'Return',
    operationLabel: 'Result',
    fields: [{ key: 'value', label: 'Return value', tab: 'inputs', control: 'binding' }],
  },
  delay: {
    title: 'Durable wait',
    operationLabel: 'Timing',
    fields: [{ key: 'durationMS', label: 'Duration (milliseconds)', tab: 'operation', control: 'binding' }],
  },
  decision: {
    title: 'Decision',
    operationLabel: 'Conditions',
    fields: [{ key: 'predicate', label: 'Condition', tab: 'operation', control: 'predicate' }],
  },
  workflow: {
    title: 'Call workflow',
    operationLabel: 'Workflow',
    fields: [
      { key: 'workflowRef', label: 'Child workflow', tab: 'operation', control: 'workflow' },
      { key: 'mode', label: 'Invocation mode', tab: 'operation', control: 'select', options: ['await', 'start'] },
      { key: 'queueRef', label: 'Queue', tab: 'operation', control: 'queue', optional: true },
      { key: 'delaySeconds', label: 'Dispatch delay (seconds)', tab: 'operation', control: 'binding', optional: true },
      { key: 'input', label: 'Child workflow input', tab: 'inputs', control: 'binding' },
      { key: 'partition', label: 'Queue partition', tab: 'inputs', control: 'binding', optional: true },
    ],
  },
  await: {
    title: 'Await results',
    operationLabel: 'Results',
    fields: [{ key: 'handles', label: 'Workflow handles', tab: 'inputs', control: 'binding' }],
  },
  foreach: {
    title: 'For each',
    operationLabel: 'Iteration',
    fields: [
      { key: 'workflowRef', label: 'Child workflow', tab: 'operation', control: 'workflow' },
      {
        key: 'mode',
        label: 'Iteration mode',
        tab: 'operation',
        control: 'select',
        options: ['sequential', 'parallel', 'start'],
      },
      {
        key: 'concurrency',
        label: 'Maximum concurrent children',
        tab: 'operation',
        control: 'number',
        min: 1,
        max: 100,
        optional: true,
      },
      { key: 'maxItems', label: 'Maximum items', tab: 'operation', control: 'number', min: 1, max: 1000 },
      { key: 'queueRef', label: 'Queue', tab: 'operation', control: 'queue', optional: true },
      { key: 'items', label: 'Items', tab: 'inputs', control: 'binding' },
      { key: 'partition', label: 'Queue partition', tab: 'inputs', control: 'binding', optional: true },
    ],
  },
  loop: {
    title: 'Bounded loop',
    operationLabel: 'Loop',
    fields: [
      { key: 'workflowRef', label: 'Child workflow', tab: 'operation', control: 'workflow' },
      { key: 'maxIterations', label: 'Maximum iterations', tab: 'operation', control: 'number', min: 1, max: 1000 },
      { key: 'while', label: 'Continue while', tab: 'operation', control: 'predicate' },
      { key: 'initial', label: 'Initial state', tab: 'inputs', control: 'binding' },
    ],
  },
  parallel: {
    title: 'Parallel branches',
    operationLabel: 'Branches',
    fields: [{ key: 'branches', label: 'Workflow branches', tab: 'operation', control: 'branches' }],
  },
  send: {
    title: 'Send message',
    operationLabel: 'Message',
    fields: [
      { key: 'topic', label: 'Message topic', tab: 'operation', control: 'text' },
      { key: 'workflowID', label: 'Target workflow ID', tab: 'inputs', control: 'binding' },
      { key: 'value', label: 'Message value', tab: 'inputs', control: 'binding' },
    ],
  },
  receive: {
    title: 'Receive message',
    operationLabel: 'Message',
    fields: [
      { key: 'topic', label: 'Message topic', tab: 'operation', control: 'text' },
      { key: 'timeoutSeconds', label: 'Wait timeout (seconds)', tab: 'inputs', control: 'binding' },
    ],
  },
  review: {
    title: 'Human review',
    operationLabel: 'Review',
    fields: [
      { key: 'instruction', label: 'Review instructions', tab: 'inputs', control: 'binding' },
      { key: 'timeoutSeconds', label: 'Review timeout (seconds)', tab: 'inputs', control: 'binding' },
    ],
  },
  event: {
    title: 'Publish event',
    operationLabel: 'Event',
    fields: [
      { key: 'key', label: 'Event key', tab: 'operation', control: 'text' },
      { key: 'value', label: 'Event value', tab: 'inputs', control: 'binding' },
    ],
  },
  waitEvent: {
    title: 'Wait for event',
    operationLabel: 'Event',
    fields: [
      { key: 'key', label: 'Event key', tab: 'operation', control: 'text' },
      { key: 'workflowID', label: 'Target workflow ID', tab: 'inputs', control: 'binding' },
      { key: 'timeoutSeconds', label: 'Wait timeout (seconds)', tab: 'inputs', control: 'binding' },
    ],
  },
} satisfies { [K in NativeKind]: Definition<K> };
export function configDefinition(
  node: FlowNodeData,
): { title: string; operationLabel: string; execution?: boolean; fields: ConfigField[] } | undefined {
  if (node.config.code || node.kind === 'code')
    return { title: 'Code', operationLabel: 'Code', execution: true, fields: [] };
  if (node.kind === 'construct' || node.kind === 'merge')
    return { title: authoringDefinitions[node.kind]!.title, operationLabel: 'Parameters', fields: [] };
  if (node.kind === 'setVariables' || node.config.variableAssignment)
    return { title: 'Set variables', operationLabel: 'Variables', fields: [] };
  return node.config.operation ? nodeConfigDefinitions[node.config.operation.kind] : undefined;
}
export function configTabs(node: FlowNodeData): { id: ConfigTab; label: string }[] {
  if (node.kind === 'code' || node.config.code)
    return [
      { id: 'general', label: 'General' },
      { id: 'operation', label: 'Code' },
      { id: 'inputs', label: 'Inputs' },
      { id: 'execution', label: 'Execution' },
    ];
  if (['construct', 'merge'].includes(node.kind))
    return [
      { id: 'inputs', label: 'Parameters' },
      { id: 'general', label: 'Settings' },
    ];
  if (node.kind === 'setVariables' || node.config.variableAssignment)
    return [
      { id: 'general', label: 'General' },
      { id: 'inputs', label: 'Variables' },
    ];
  const def = configDefinition(node);
  return [
    { id: 'general', label: 'General' },
    ...(def
      ? [
          ...(def.fields.some((f) => f.tab === 'operation')
            ? [{ id: 'operation' as const, label: def.operationLabel }]
            : []),
          ...(def.fields.some((f) => f.tab === 'inputs') ? [{ id: 'inputs' as const, label: 'Inputs' }] : []),
          ...(def.execution ? [{ id: 'execution' as const, label: 'Execution' }] : []),
          { id: 'advanced' as const, label: 'Advanced' },
        ]
      : node.kind === 'trigger'
        ? [{ id: 'inputs' as const, label: 'Sample input' }]
        : [{ id: 'operation' as const, label: 'Configuration' }]),
  ];
}
export function upstreamNodes(flow: Pick<AgentFlow, 'nodes' | 'edges'>, nodeId: string): FlowNodeData[] {
  const seen = new Set<string>([nodeId]);
  const pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    for (const e of flow.edges)
      if (e.target === id && !seen.has(e.source)) {
        seen.add(e.source);
        pending.push(e.source);
      }
  }
  return flow.nodes.filter((n) => n.id !== nodeId && seen.has(n.id));
}
export function validateNodeConfiguration(node: FlowNodeData, flow: AgentFlow): string[] {
  const result = flowSchema.shape.nodes.element.safeParse(node);
  const errors = result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (!node.name.trim()) errors.push('name: Name is required.');
  if (node.config.operationDraft !== undefined)
    errors.push('config.operationDraft: Advanced operation JSON is invalid. Fix it before applying.');
  for (const [key, param] of Object.entries(node.config.parameters ?? {})) {
    function check(p: import('../authoring/model').Parameter, path: string) {
      if (p.mode === 'object') {
        for (const [k, v] of Object.entries(p.fields)) check(v, `${path}.fields.${k}`);
        return;
      }
      if (p.mode === 'array') {
        p.items.forEach((v, i) => check(v, `${path}.items.${i}`));
        return;
      }
      try {
        compileParameter(p);
        for (const id of parameterReferences(p))
          if (!upstreamNodes(flow, node.id).some((n) => n.id === id))
            throw new Error(`Reference '${id}' is not an upstream node.`);
      } catch (err) {
        errors.push(`${path}: ${err instanceof Error ? err.message : 'Invalid parameter.'}`);
      }
    }
    check(param, `config.parameters.${key}`);
  }
  if (flow.authoringVersion === 2) {
    if (node.config.code && !node.config.code.source.trim())
      errors.push('config.code.source: Source code is required.');
    if (node.kind === 'setVariables' && node.config.parameters?.values?.mode === 'object')
      for (const [id, p] of Object.entries(node.config.parameters.values.fields)) {
        if (p.mode === 'omit') continue;
        const d = flow.declarations?.find((d) => d.id === id);
        if (!d)
          errors.push(
            `config.parameters.values.fields.${id}: Variable '${id}' is not declared in this workflow. Add it in Workflow settings → Variables, or remove this update.`,
          );
        else if (!d.writable)
          errors.push(
            `config.parameters.values.fields.${id}: ${d.name} (${id}) is read-only. Enable “Allow nodes to update this variable” in Workflow settings → Variables and apply the settings, or remove this update.`,
          );
        else if (p.mode === 'fixed')
          try {
            assertValue(d.schema, p.value, d.name);
          } catch (err) {
            errors.push(`config.parameters.values.fields.${id}: ${err instanceof Error ? err.message : 'Wrong type'}`);
          }
      }
    for (const [index, update] of (node.config.merge?.updates ?? []).entries())
      if (
        !flow.declarations?.some((d) => d.id === update.variableId && d.writable) ||
        node.config.merge?.updates.some((u, i) => i !== index && u.variableId === update.variableId)
      )
        errors.push(`config.merge.updates.${index}.value: Select a unique declared writable variable.`);
  }
  if (!node.config.operation) return errors;
  const parsed = operationSchema.safeParse(node.config.operation);
  if (!parsed.success)
    return [...errors, ...parsed.error.issues.map((i) => `config.operation.${i.path.join('.')}: ${i.message}`)];
  const op = parsed.data;
  if (op.kind !== node.kind) errors.push('config.operation.kind: Operation kind must match the node.');
  const upstream = new Set(upstreamNodes(flow, node.id).map((n) => n.id));
  for (const b of nodeBindings(op))
    if (b.source === 'node' && !upstream.has(b.nodeId))
      errors.push(
        `config.operation.${Object.entries(op).find(([, v]) => nodeBindings(v).includes(b))?.[0] ?? 'input'}: Select an upstream node for binding ${b.nodeId}.`,
      );
  for (const ref of references(op))
    if (!flow.definitions?.[ref])
      errors.push(
        `config.operation.${op.kind === 'parallel' ? 'branches' : 'workflowRef'}: Workflow reference '${ref}' does not exist in this graph.`,
      );
  if ('queueRef' in op && op.queueRef && !flow.queues?.some((q) => q.key === op.queueRef))
    errors.push(`config.operation.queueRef: Queue '${op.queueRef}' is not configured.`);
  for (const key of ['durationMS', 'timeoutSeconds', 'delaySeconds']) {
    const b = (op as unknown as Record<string, Binding>)[key];
    if (b?.source === 'literal' && (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0))
      errors.push(`config.operation.${key}: ${key} must be a non-negative number or a runtime binding.`);
  }
  return [...new Set(errors)];
}
/** Resolves data only. It never invokes a handler, model, workflow or provider. */
export function previewNodeInputs(
  node: FlowNodeData,
  input: unknown,
  outputs: Record<string, unknown>,
  variables?: Record<string, unknown>,
  scope?: {
    nodeInput?: unknown;
    item?: unknown;
    index?: number;
    execution?: { workflowID: string; executionId: string };
  },
  fieldsOnly = false,
): unknown {
  const op = node.config.operation;
  if (!op) return input;
  function resolve(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'source' in value) {
      const b = value as Binding;
      for (const part of nodeBindings(b))
        if (['item', 'state', 'execution'].includes(part.source) && !scope)
          throw new Error(`${part.source} is only available during the corresponding runtime execution.`);
      return bind(b, { input, outputs, variables, ...scope });
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    return value;
  }
  const resolved = resolve(op) as Record<string, unknown>;
  if (!fieldsOnly) return resolved;
  if (op.kind === 'step' || op.kind === 'transaction')
    return node.config.code ? (resolved.input as { input: unknown }).input : resolved.input;
  if (op.kind === 'assign' || op.kind === 'return')
    return node.config.authoredKind === 'merge'
      ? {
          output: resolved.value,
          updates: node.config.compiledUpdates
            ? Object.fromEntries(
                Object.entries(node.config.compiledUpdates).map(([id, b]) => [
                  id,
                  bind(b, { input, outputs, variables, ...scope }),
                ]),
              )
            : {},
        }
      : resolved.value;
  return {
    ...Object.fromEntries(
      Object.entries(op)
        .filter(([, value]) => nodeBindings(value).length > 0)
        .map(([key]) => [key, resolved[key]]),
    ),
    ...Object.fromEntries(
      Object.entries(node.config.runtimeFields ?? {}).map(([key, b]) => [
        key,
        bind(b, { input, outputs, variables, ...scope }),
      ]),
    ),
  };
}

/** Workflow settings can change whether existing node updates are valid. Recompute saved UI diagnostics. */
export function refreshNodeConfigurationIssues(flow: AgentFlow): FlowNodeData[] {
  return flow.nodes.map((node) => ({
    ...node,
    config: { ...node.config, issues: validateNodeConfiguration(node, flow) },
  }));
}
