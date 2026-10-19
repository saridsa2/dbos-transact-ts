import { z } from 'zod';
import { evaluateExpression } from '../authoring/expressions';
import type { AgentFlow } from '../flows/types';

export type Binding =
  | { source: 'absent' }
  | { source: 'expression'; expression: string }
  | { source: 'literal'; value: unknown }
  | { source: 'input' | 'item' | 'state' | 'execution'; path?: string }
  | { source: 'node'; nodeId: string; path?: string }
  | { source: 'object'; fields: Record<string, Binding> }
  | { source: 'array'; items: Binding[] };
export type Predicate = { operator: 'eq' | 'neq' | 'gt' | 'lt' | 'truthy'; left: Binding; right?: Binding };
export type NativeOperation =
  | { kind: 'step' | 'transaction'; handler: string; input: Binding }
  | { kind: 'assign' | 'return'; value: Binding }
  | { kind: 'delay'; durationMS: Binding }
  | { kind: 'decision'; predicate: Predicate }
  | {
      kind: 'workflow';
      workflowRef: string;
      input: Binding;
      mode: 'await' | 'start';
      queueRef?: string;
      partition?: Binding;
      delaySeconds?: Binding;
    }
  | { kind: 'await'; handles: Binding }
  | {
      kind: 'foreach';
      workflowRef: string;
      items: Binding;
      mode: 'sequential' | 'parallel' | 'start';
      maxItems: number;
      concurrency?: number;
      queueRef?: string;
      partition?: Binding;
    }
  | { kind: 'loop'; workflowRef: string; initial: Binding; while: Predicate; maxIterations: number }
  | { kind: 'parallel'; branches: { id?: string; name?: string; workflowRef: string; input: Binding }[] }
  | { kind: 'send'; workflowID: Binding; topic: string; value: Binding }
  | { kind: 'receive'; topic: string; timeoutSeconds: Binding }
  | { kind: 'review'; instruction: Binding; timeoutSeconds: Binding }
  | { kind: 'event'; key: string; value: Binding }
  | { kind: 'waitEvent'; workflowID: Binding; key: string; timeoutSeconds: Binding };
export type NativeKind = NativeOperation['kind'];
export const nativeKinds = [
  'step',
  'transaction',
  'assign',
  'return',
  'delay',
  'decision',
  'workflow',
  'await',
  'foreach',
  'loop',
  'parallel',
  'send',
  'receive',
  'review',
  'event',
  'waitEvent',
] as const;
export type QueueResource = {
  key: string;
  globalConcurrency?: number;
  workerConcurrency?: number;
  partitionConcurrency?: number;
  rateLimit?: { limitPerPeriod: number; periodSec: number };
};
export type ScheduleResource = { enabled: boolean; cron: string; timezone?: string };
export type NativeGraph = AgentFlow & { schemaVersion: 2 };

const path = z
  .string()
  .max(1000)
  .refine(
    (value) => !value.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)),
    'Unsafe binding path',
  );
export const bindingSchema: z.ZodType<Binding> = z.lazy(() =>
  z.discriminatedUnion('source', [
    z.object({ source: z.literal('absent') }),
    z.object({ source: z.literal('expression'), expression: z.string().min(1).max(10000) }),
    z.object({ source: z.literal('literal'), value: z.json() }),
    z.object({ source: z.enum(['input', 'item', 'state', 'execution']), path: path.optional() }),
    z.object({ source: z.literal('node'), nodeId: z.string().min(1), path: path.optional() }),
    z.object({ source: z.literal('object'), fields: z.record(z.string(), bindingSchema) }),
    z.object({ source: z.literal('array'), items: z.array(bindingSchema) }),
  ]),
);
export const predicateSchema = z
  .object({
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'truthy']),
    left: bindingSchema,
    right: bindingSchema.optional(),
  })
  .refine((value) => value.operator === 'truthy' || value.right !== undefined, {
    message: 'Comparison predicates require a right binding.',
  });
const ref = z.string().min(1).max(128);
export const operationSchema: z.ZodType<NativeOperation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['step', 'transaction']), handler: ref, input: bindingSchema }),
  z.object({ kind: z.enum(['assign', 'return']), value: bindingSchema }),
  z.object({ kind: z.literal('delay'), durationMS: bindingSchema }),
  z.object({ kind: z.literal('decision'), predicate: predicateSchema }),
  z.object({
    kind: z.literal('workflow'),
    workflowRef: ref,
    input: bindingSchema,
    mode: z.enum(['await', 'start']),
    queueRef: ref.optional(),
    partition: bindingSchema.optional(),
    delaySeconds: bindingSchema.optional(),
  }),
  z.object({ kind: z.literal('await'), handles: bindingSchema }),
  z.object({
    kind: z.literal('foreach'),
    workflowRef: ref,
    items: bindingSchema,
    mode: z.enum(['sequential', 'parallel', 'start']),
    maxItems: z.number().int().min(1).max(1000),
    concurrency: z.number().int().min(1).max(100).optional(),
    queueRef: ref.optional(),
    partition: bindingSchema.optional(),
  }),
  z.object({
    kind: z.literal('loop'),
    workflowRef: ref,
    initial: bindingSchema,
    while: predicateSchema,
    maxIterations: z.number().int().min(1).max(1000),
  }),
  z.object({
    kind: z.literal('parallel'),
    branches: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          name: z.string().max(200).optional(),
          workflowRef: ref,
          input: bindingSchema,
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({ kind: z.literal('send'), workflowID: bindingSchema, topic: ref, value: bindingSchema }),
  z.object({ kind: z.literal('receive'), topic: ref, timeoutSeconds: bindingSchema }),
  z.object({ kind: z.literal('review'), instruction: bindingSchema, timeoutSeconds: bindingSchema }),
  z.object({ kind: z.literal('event'), key: ref, value: bindingSchema }),
  z.object({ kind: z.literal('waitEvent'), workflowID: bindingSchema, key: ref, timeoutSeconds: bindingSchema }),
]);
export const queueSchema = z.object({
  key: ref,
  globalConcurrency: z.number().int().positive().optional(),
  workerConcurrency: z.number().int().positive().optional(),
  partitionConcurrency: z.number().int().positive().optional(),
  rateLimit: z.object({ limitPerPeriod: z.number().int().positive(), periodSec: z.number().positive() }).optional(),
});
export const literal = (value: unknown): Binding => ({ source: 'literal', value });
export const input = (path?: string): Binding => ({ source: 'input', ...(path ? { path } : {}) });
export const output = (nodeId: string, path?: string): Binding => ({
  source: 'node',
  nodeId,
  ...(path ? { path } : {}),
});
export function references(op: NativeOperation): string[] {
  if ('workflowRef' in op) return [op.workflowRef];
  return op.kind === 'parallel' ? op.branches.map((branch) => branch.workflowRef) : [];
}
export type BindingContext = {
  input: unknown;
  nodeInput?: unknown;
  index?: number;
  outputs: Record<string, unknown>;
  variables?: Record<string, unknown>;
  item?: unknown;
  state?: unknown;
  execution?: { workflowID: string; executionId: string };
};
export function bind(binding: Binding, context: BindingContext): unknown {
  if (binding.source === 'absent') return undefined;
  if (binding.source === 'expression') return evaluateExpression(binding.expression, context);
  if (binding.source === 'literal') return binding.value;
  if (binding.source === 'object')
    return Object.fromEntries(
      Object.entries(binding.fields)
        .map(([key, value]) => [key, bind(value, context)])
        .filter(([, value]) => value !== undefined),
    );
  if (binding.source === 'array') return binding.items.map((value) => bind(value, context));
  let value: unknown;
  if (binding.source === 'node') {
    if (!Object.hasOwn(context.outputs, binding.nodeId))
      throw new Error(`Output '${binding.nodeId}' is not available on this execution path.`);
    value = context.outputs[binding.nodeId];
  } else value = context[binding.source];
  for (const part of binding.path?.split('.') ?? []) {
    if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('Unsafe binding path.');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part))
      throw new Error(`Binding path '${binding.path}' is unavailable.`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function canonical(value: unknown): string | undefined {
  if (Array.isArray(value)) return 'array:' + JSON.stringify(value.map((item) => canonical(item)));
  if (value !== null && typeof value === 'object')
    return (
      'object:' +
      JSON.stringify(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
      )
    );
  return JSON.stringify(value);
}
export function evaluate(predicate: Predicate, context: BindingContext): boolean {
  const left = bind(predicate.left, context);
  if (predicate.operator === 'truthy') return Boolean(left);
  if (!predicate.right) throw new Error('This predicate requires a right-hand value.');
  const right = bind(predicate.right, context);
  if (predicate.operator === 'eq') return canonical(left) === canonical(right);
  if (predicate.operator === 'neq') return canonical(left) !== canonical(right);
  if (typeof left !== 'number' || typeof right !== 'number')
    throw new Error('Numeric comparisons require numeric bindings.');
  return predicate.operator === 'gt' ? left > right : left < right;
}
export function nodeBindings(value: unknown): Binding[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (typeof record.source === 'string') {
    const binding = record as unknown as Binding;
    if (binding.source === 'object') return [binding, ...Object.values(binding.fields).flatMap(nodeBindings)];
    if (binding.source === 'array') return [binding, ...binding.items.flatMap(nodeBindings)];
    return [binding];
  }
  return Object.values(record).flatMap(nodeBindings);
}
