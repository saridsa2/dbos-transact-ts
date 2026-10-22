import { moveProcessNodes } from './lanes';
import { z } from 'zod';
import { id, evidenceList, refSchema, type KnowledgeIssue } from '../knowledge/contracts';
import { parameterSchema } from '../authoring/model';
import { processActivityAgentSchema } from './agent';
import { references, operationSchema } from '../native/model';
import { flowSchema } from '../flows/validation';
import type { Process } from '../knowledge/process';
const side = z.enum(['top', 'right', 'bottom', 'left']);
const base = { id, name: z.string().trim().min(1).max(200), evidence: evidenceList, laneId: id.optional() };
export const processOperationSchema = operationSchema.refine(
  (op) => !['assign', 'return', 'decision'].includes(op.kind),
  'Use process data, End or Decision elements for this operation.',
);
export const processElementSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('start') }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('activity'),
      binding: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('construct'), value: parameterSchema }).strict(),
        z.object({ kind: z.literal('agent'), definition: processActivityAgentSchema, input: parameterSchema }).strict(),
        z
          .object({
            kind: z.literal('operation'),
            operation: processOperationSchema,
            parameters: z.record(z.string(), parameterSchema).default({}),
            execution: flowSchema.shape.nodes.element.shape.config.shape.execution,
            ports: flowSchema.shape.nodes.element.shape.config.shape.ports,
          })
          .strict(),
        z
          .object({
            kind: z.literal('requirement'),
            capability: z.string().min(1).max(2000),
            performer: z.enum(['system', 'human', 'agent']),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('decision'),
      operator: z.enum(['eq', 'neq', 'gt', 'lt', 'truthy']),
      left: parameterSchema,
      right: parameterSchema,
    })
    .strict(),
  z.object({ ...base, kind: z.literal('merge') }).strict(),
  z.object({ ...base, kind: z.literal('end'), value: parameterSchema }).strict(),
]);
export const processV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    bpmnSource: z
      .object({
        xml: z.string().max(1024 * 1024),
        processId: z.string().min(1).max(2000),
        idMap: z.record(z.string(), id),
      })
      .strict()
      .optional(),
    purpose: z.string().min(1).max(10000),
    ontologyRefs: z.array(refSchema).max(20).default([]),
    inputSchema: z.record(z.string(), z.json()).default({ type: 'object' }),
    defaultInput: z.record(z.string(), z.json()).default({}),
    questions: z
      .array(z.object({ id, question: z.string().min(1).max(2000), answer: z.string().max(5000).optional() }).strict())
      .max(50)
      .default([]),
    lanes: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(200),
            role: z.enum(['owner', 'admin', 'editor', 'viewer']).optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    implementations: z.record(id, flowSchema).optional(),
    graph: z
      .object({
        elements: z.array(processElementSchema).max(200),
        flows: z
          .array(
            z
              .object({
                id,
                source: id,
                target: id,
                sourceHandle: side.optional(),
                targetHandle: side.optional(),
                outcome: z.enum(['success', 'true', 'false', 'timeout', 'error']).optional(),
              })
              .strict(),
          )
          .max(400),
      })
      .strict(),
    presentation: z
      .object({
        pool: z
          .object({
            x: z.number().finite().min(-100000).max(100000),
            y: z.number().finite().min(-100000).max(100000),
            width: z.number().finite().min(600).max(201000),
            heights: z.record(id, z.number().finite().min(280).max(3000)),
            unassignedHeight: z.number().finite().min(280).max(3000).optional(),
          })
          .strict()
          .optional(),
        positions: z.record(
          id,
          z
            .object({
              x: z.number().finite().min(-100000).max(100000),
              y: z.number().finite().min(-100000).max(100000),
            })
            .strict(),
        ),
      })
      .strict(),
    compatibility: z.object({ sourceVersion: z.literal(1), inputEnvelope: z.literal('variables') }).strict(),
  })
  .strict();
export type ProcessDocument = z.infer<typeof processV2Schema>;
export type ProcessElement = z.infer<typeof processElementSchema>;
export function migrateProcess(value: Process | ProcessDocument): ProcessDocument {
  if (value.schemaVersion === 2) return processV2Schema.parse(value);
  const used = new Set(value.steps.map((step) => step.id));
  let entry = 'process-start';
  while (used.has(entry)) entry += '-entry';
  const elements: ProcessElement[] = [
    { id: entry, name: 'Start', kind: 'start', evidence: [] },
    ...value.steps.map((step) =>
      step.kind === 'return'
        ? { id: step.id, name: step.name, kind: 'end' as const, value: step.value, evidence: step.evidence }
        : {
            id: step.id,
            name: step.name,
            kind: 'activity' as const,
            evidence: step.evidence,
            binding:
              step.kind === 'construct'
                ? { kind: 'construct' as const, value: step.value }
                : { kind: 'requirement' as const, capability: step.capability, performer: 'system' as const },
          },
    ),
  ];
  return processV2Schema.parse({
    schemaVersion: 2,
    purpose: value.purpose,
    ontologyRefs: value.ontologyRefs,
    inputSchema: value.inputSchema,
    defaultInput: value.defaultInput,
    questions: value.questions,
    graph: {
      elements,
      flows: elements.slice(1).map((node, i) => ({ id: `sequence-${i}`, source: elements[i].id, target: node.id })),
    },
    presentation: {
      positions: Object.fromEntries(
        elements.map((node, i) => [node.id, { x: (i - (elements.length - 1) / 2) * 390 - 142, y: -70 }]),
      ),
    },
    compatibility: { sourceVersion: 1, inputEnvelope: 'variables' },
  });
}
export function processGraphIssues(value: ProcessDocument): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];
  const add = (code: string, path: string, message: string, severity: 'error' | 'warning' = 'warning') =>
    issues.push({ code, path, message, severity });
  const { elements, flows } = value.graph,
    ids = new Set<string>();
  for (const n of elements) {
    if (n.id === 'trigger' && n.kind !== 'start')
      add('reserved_id', `graph.elements.${n.id}`, 'The trigger ID is reserved.', 'error');
    if (ids.has(n.id)) add('duplicate', `graph.elements.${n.id}`, 'Element IDs must be unique.', 'error');
    ids.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of flows) {
    if (edgeIds.has(e.id)) add('duplicate', `graph.flows.${e.id}`, 'Connection IDs must be unique.', 'error');
    edgeIds.add(e.id);
    if (!ids.has(e.source) || !ids.has(e.target))
      add('endpoint', `graph.flows.${e.id}`, 'A connection references a missing element.', 'error');
    if (e.source === e.target)
      add('self_connection', `graph.flows.${e.id}`, 'Self connections are not supported.', 'error');
  }
  const starts = elements.filter((n) => n.kind === 'start'),
    ends = elements.filter((n) => n.kind === 'end');
  if (starts.length !== 1) add('start', 'graph.elements', 'Add exactly one Start.');
  if (ends.length !== 1) add('end', 'graph.elements', 'This delivery supports one End.');
  for (const n of elements) {
    const incoming = flows.filter((e) => e.target === n.id),
      outgoing = flows.filter((e) => e.source === n.id);
    if ((n.kind === 'start' && incoming.length) || (n.kind === 'end' && outgoing.length))
      add(
        'direction',
        `graph.elements.${n.id}`,
        'Start cannot have incoming connections and End cannot have outgoing connections.',
        'error',
      );
    if (incoming.length > 1 && n.kind !== 'merge')
      add('branch', `graph.elements.${n.id}`, 'Use a Merge to combine alternative routes.');
    const timed =
      n.kind === 'activity' &&
      n.binding.kind === 'operation' &&
      ['review', 'receive', 'waitEvent'].includes(n.binding.operation.kind);
    if (n.kind === 'decision') {
      if (outgoing.length !== 2 || !['true', 'false'].every((outcome) => outgoing.some((e) => e.outcome === outcome)))
        add('decision_routes', `graph.elements.${n.id}`, 'Decision needs exactly one True and one False route.');
    } else if (timed) {
      if (
        outgoing.length !== 2 ||
        !['success', 'timeout'].every((outcome) => outgoing.some((e) => (e.outcome ?? 'success') === outcome))
      )
        add('timeout_routes', `graph.elements.${n.id}`, 'A durable task needs separate Success and Timeout routes.');
    } else if (outgoing.length > 1)
      add(
        'branch',
        `graph.elements.${n.id}`,
        'Use a Decision for alternative routes or a Parallel activity for concurrent child workflows.',
      );
    if (n.kind !== 'decision' && !timed && outgoing.some((e) => e.outcome && e.outcome !== 'success'))
      add('route_outcome', `graph.elements.${n.id}`, 'This element only produces a Success route.');
    if (n.laneId && !value.lanes?.some((lane) => lane.id === n.laneId))
      add('lane', `graph.elements.${n.id}`, 'Select an existing responsibility lane.', 'error');
    if (n.kind !== 'start' && incoming.length === 0)
      add('disconnected', `graph.elements.${n.id}`, `${n.name} needs an incoming connection.`);
    if (n.kind !== 'end' && outgoing.length === 0)
      add('disconnected', `graph.elements.${n.id}`, `${n.name} needs an outgoing connection.`);
    if (n.kind === 'activity' && n.binding.kind === 'operation') {
      const op = n.binding.operation;
      if ('handler' in op && (!op.handler || op.handler === 'unbound'))
        add('missing_capability', `graph.elements.${n.id}`, `${n.name}: select a registered system operation.`);
      for (const ref of references(op))
        if (!value.implementations?.[ref])
          add(
            'missing_subprocess',
            `graph.elements.${n.id}`,
            `${n.name}: capture subprocess ${ref} in Process settings.`,
          );
      if ((op.kind === 'workflow' || op.kind === 'foreach') && op.mode === 'start')
        add(
          'detached_subprocess',
          `graph.elements.${n.id}`,
          'Process subprocesses must await completion. Use a workflow implementation for detached dispatch.',
        );
    }
    if (n.kind === 'activity' && n.binding.kind === 'requirement')
      add(
        'missing_capability',
        `graph.elements.${n.id}`,
        `${n.name}: ${n.binding.performer} activity needs an executable binding.`,
      );
  }
  // Kahn traversal checks all branches; incomplete drafts remain editable.
  const indegree = new Map(elements.map((n) => [n.id, flows.filter((e) => e.target === n.id).length]));
  const pending = elements.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  let visited = 0;
  while (pending.length) {
    const current = pending.shift()!;
    visited++;
    for (const e of flows.filter((e) => e.source === current)) {
      const count = (indegree.get(e.target) ?? 1) - 1;
      indegree.set(e.target, count);
      if (!count) pending.push(e.target);
    }
  }
  if (visited !== elements.length)
    add('cycle', 'graph.flows', 'Use explicit bounded repetition; cycles cannot compile.');
  if (starts.length === 1) {
    const seen = new Set<string>(),
      queue = [starts[0].id];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...flows.filter((e) => e.source === current).map((e) => e.target));
    }
    if (seen.size !== elements.length)
      add('unreachable', 'graph.elements', 'Every element must be reachable from Start.');
  }
  const laneIds = value.lanes?.map((lane) => lane.id) ?? [];
  if (new Set(laneIds).size !== laneIds.length) add('duplicate', 'lanes', 'Lane IDs must be unique.', 'error');
  const questionIds = new Set<string>();
  for (const q of value.questions) {
    if (questionIds.has(q.id)) add('duplicate', 'questions', 'Question IDs must be unique.', 'error');
    questionIds.add(q.id);
    if (!q.answer?.trim()) add('unanswered_question', `questions.${q.id}`, q.question);
  }
  if (elements.length > 50) add('limit', 'graph.elements', 'Compilation supports at most 49 activities plus Start.');
  return issues;
}
export function linearProcess(value: ProcessDocument): Process {
  const issues = processGraphIssues(value);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  if (
    value.graph.elements.some(
      (n) =>
        n.kind === 'decision' ||
        n.kind === 'merge' ||
        (n.kind === 'activity' && ['operation', 'agent'].includes(n.binding.kind)),
    )
  )
    throw new Error('This process requires structured compilation.');
  const elements = value.graph.elements;
  let node: ProcessElement = elements.find((n) => n.kind === 'start')!;
  const steps: Process['steps'] = [];
  while (node.kind !== 'end') {
    const edge = value.graph.flows.find((e) => e.source === node.id)!;
    node = elements.find((n) => n.id === edge.target)!;
    if (node.kind === 'end')
      steps.push({ id: node.id, name: node.name, kind: 'return', value: node.value, evidence: node.evidence });
    else if (node.kind === 'activity' && node.binding.kind === 'construct')
      steps.push({
        id: node.id,
        name: node.name,
        kind: 'construct',
        value: node.binding.value,
        evidence: node.evidence,
      });
  }
  return {
    schemaVersion: 1,
    purpose: value.purpose,
    ontologyRefs: value.ontologyRefs,
    inputSchema: value.inputSchema,
    defaultInput: value.defaultInput,
    questions: value.questions,
    steps,
  };
}
export type ProcessCommand =
  | { type: 'move'; positions: Record<string, { x: number; y: number }> }
  | { type: 'delete'; ids: string[] }
  | {
      type: 'connect';
      source: string;
      target: string;
      sourceHandle?: z.infer<typeof side>;
      targetHandle?: z.infer<typeof side>;
      id: string;
    }
  | { type: 'add'; element: ProcessElement; position: { x: number; y: number } };
export function applyProcessCommand(value: ProcessDocument, command: ProcessCommand): ProcessDocument {
  const draft = structuredClone(value);
  if (command.type === 'move')
    for (const [id, pos] of Object.entries(command.positions)) {
      if (!draft.graph.elements.some((n) => n.id === id)) throw new Error('Element not found.');
      draft.presentation.positions[id] = pos;
    }
  if (command.type === 'delete') {
    draft.graph.elements = draft.graph.elements.filter((n) => !command.ids.includes(n.id));
    draft.graph.flows = draft.graph.flows.filter(
      (e) => !command.ids.includes(e.id) && !command.ids.includes(e.source) && !command.ids.includes(e.target),
    );
    for (const id of command.ids) delete draft.presentation.positions[id];
  }
  if (command.type === 'add') {
    draft.graph.elements.push(command.element);
    draft.presentation.positions[command.element.id] = command.position;
  }
  if (command.type === 'connect') {
    const source = draft.graph.elements.find((n) => n.id === command.source),
      target = draft.graph.elements.find((n) => n.id === command.target);
    if (!source || !target || source.id === target.id || source.kind === 'end' || target.kind === 'start')
      throw new Error('Connect an activity or Start to an activity or End.');
    const timed =
      source.kind === 'activity' &&
      source.binding.kind === 'operation' &&
      ['review', 'receive', 'waitEvent'].includes(source.binding.operation.kind);
    const outgoing = draft.graph.flows.filter((e) => e.id !== command.id && e.source === source.id);
    const incoming = draft.graph.flows.filter((e) => e.id !== command.id && e.target === target.id);
    if (
      outgoing.length >= (source.kind === 'decision' || timed ? 2 : 1) ||
      (incoming.length && target.kind !== 'merge')
    )
      throw new Error('Use one incoming and one outgoing connection per activity; use Decision and Merge for routing.');
    const downstream = new Set<string>(),
      queue = [target.id];
    while (queue.length) {
      const current = queue.shift()!;
      if (downstream.has(current)) continue;
      downstream.add(current);
      queue.push(...draft.graph.flows.filter((e) => e.id !== command.id && e.source === current).map((e) => e.target));
    }
    if (downstream.has(source.id)) throw new Error('Use a bounded repetition structure instead of a cycle.');
    const previous = draft.graph.flows.find((e) => e.id === command.id);
    const outcome =
      previous?.source === source.id
        ? previous.outcome
        : source.kind === 'decision'
          ? outgoing.some((e) => e.outcome === 'true')
            ? 'false'
            : 'true'
          : timed
            ? outgoing.some((e) => (e.outcome ?? 'success') === 'success')
              ? 'timeout'
              : 'success'
            : undefined;
    draft.graph.flows = draft.graph.flows.filter((e) => e.id !== command.id);
    draft.graph.flows.push({
      id: command.id,
      source: source.id,
      target: target.id,
      ...(outcome ? { outcome } : {}),
      ...(command.sourceHandle ? { sourceHandle: command.sourceHandle } : {}),
      ...(command.targetHandle ? { targetHandle: command.targetHandle } : {}),
    });
  }
  return processV2Schema.parse(
    command.type === 'move' ? moveProcessNodes(value, draft, Object.keys(command.positions)) : draft,
  );
}
