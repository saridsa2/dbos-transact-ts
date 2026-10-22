import { references } from '../native/model';
import { parseFlow } from '../flows/validation';
import { PROCESS_AGENT_HANDLER, PROCESS_NAMED_AGENT_HANDLER } from './agent';
import type { AgentFlow, FlowNodeData } from '../flows/types';
import type { ProcessDocument, ProcessElement } from './model';

/** A disposable editor/compiler projection. Process documents remain the source of truth. */
export function projectProcessElement(element: ProcessElement, document: ProcessDocument): FlowNodeData {
  const base = {
    id: element.kind === 'start' ? 'trigger' : element.id,
    name: element.name,
    position: document.presentation.positions[element.id] ?? { x: 0, y: 0 },
  };
  if (element.kind === 'start')
    return {
      ...base,
      kind: 'trigger',
      config: {
        ports: {
          output: {
            id: 'value',
            schema: { type: 'object', properties: { variables: document.inputSchema }, required: ['variables'] },
            cardinality: 'single',
            required: true,
          },
        },
      },
    };
  if (element.kind === 'end')
    return {
      ...base,
      kind: 'return',
      config: {
        operation: { kind: 'return', value: { source: 'literal', value: null } },
        parameters: { value: element.value },
      },
    };
  if (element.kind === 'decision')
    return {
      ...base,
      kind: 'decision',
      config: {
        operation: {
          kind: 'decision',
          predicate: {
            operator: element.operator,
            left: { source: 'literal', value: null },
            right: { source: 'literal', value: null },
          },
        },
        parameters: { 'predicate.left': element.left, 'predicate.right': element.right },
      },
    };
  if (element.kind === 'merge')
    return {
      ...base,
      kind: 'merge',
      config: { parameters: { value: { mode: 'expression', expression: '$nodeInput' } } },
    };
  if (element.binding.kind === 'agent')
    return {
      ...base,
      kind: 'step',
      config: {
        operation: {
          kind: 'step',
          handler: 'agentRef' in element.binding.definition ? PROCESS_NAMED_AGENT_HANDLER : PROCESS_AGENT_HANDLER,
          input: { source: 'literal', value: null },
        },
        parameters: {
          input: {
            mode: 'object',
            fields: {
              ...('agentRef' in element.binding.definition ? { version: { mode: 'fixed' as const, value: 2 } } : {}),
              definition: { mode: 'fixed', value: element.binding.definition },
              input: element.binding.input,
            },
          },
        },
      },
    };
  if (element.binding.kind === 'construct')
    return { ...base, kind: 'construct', config: { parameters: { value: element.binding.value } } };
  if (element.binding.kind === 'operation')
    return {
      ...base,
      kind: element.binding.operation.kind,
      config: {
        operation: element.binding.operation,
        parameters: element.binding.parameters,
        ...(element.binding.execution ? { execution: element.binding.execution } : {}),
        ...(element.binding.ports ? { ports: element.binding.ports } : {}),
      },
    };
  // Unresolved intent is visible in the editor but validation prevents execution.
  return { ...base, kind: 'construct', config: {} };
}
export function projectProcess(document: ProcessDocument, name: string, id = 'process-preview'): AgentFlow {
  const entry = document.graph.elements.find((n) => n.kind === 'start')?.id;
  return {
    id,
    name,
    schemaVersion: 2,
    authoringVersion: 2,
    declarations: [],
    description: document.purpose,
    defaultInput: { variables: document.defaultInput },
    ...(document.implementations ? { definitions: document.implementations as AgentFlow['definitions'] } : {}),
    nodes: document.graph.elements.map((n) => projectProcessElement(n, document)),
    edges: document.graph.flows.map((e) => ({
      id: e.id,
      source: e.source === entry ? 'trigger' : e.source,
      target: e.target === entry ? 'trigger' : e.target,
      condition: e.outcome ?? 'success',
      ...(e.outcome ? { label: e.outcome } : {}),
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })),
  };
}

/** Require the complete child closure in the document; compilation never resolves mutable workspace references. */
export function assertCapturedProcessWorkflows(document: ProcessDocument) {
  const root = projectProcess(document, 'Captured process');
  let visits = 0;
  function visit(flow: AgentFlow, ancestors: string[]) {
    if (++visits > 100 || ancestors.length > 12)
      throw new Error('Process subprocess expansion exceeds the supported limit.');
    if (ancestors.includes(flow.id))
      throw new Error('Recursive subprocesses are not supported. Use bounded repetition.');
    for (const node of flow.nodes)
      for (const ref of node.config.operation ? references(node.config.operation) : []) {
        const child = root.definitions?.[ref] ?? flow.definitions?.[ref];
        if (!child) throw new Error(`Capture subprocess ${ref} and its dependencies in this process revision.`);
        visit(parseFlow(child), [...ancestors, flow.id]);
      }
  }
  visit(root, []);
}
