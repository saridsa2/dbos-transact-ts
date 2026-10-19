import { z } from 'zod';
import { expressionAst, expressionNodeReferences } from './expressions';
import type { Binding } from '../native/model';
type ParameterValue =
  | { mode: 'omit' }
  | { mode: 'fixed'; value: unknown }
  | { mode: 'expression'; expression: string }
  | { mode: 'object'; fields: Record<string, Parameter> }
  | { mode: 'array'; items: Parameter[] };
export type Parameter = ParameterValue & { _editor?: { fixed?: Parameter; expression?: string; itemIds?: string[] } };
const editorSchema = z
  .lazy(() =>
    z
      .object({
        fixed: parameterSchema.optional(),
        expression: z.string().max(10000).optional(),
        itemIds: z
          .array(z.string().min(1))
          .max(1000)
          .refine((ids) => new Set(ids).size === ids.length, 'Array item IDs must be unique.')
          .optional(),
      })
      .strict(),
  )
  .optional();
export const parameterSchema: z.ZodType<Parameter> = z.lazy(() =>
  z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('omit'), _editor: editorSchema }).strict(),
    z.object({ mode: z.literal('fixed'), value: z.json(), _editor: editorSchema }).strict(),
    z.object({ mode: z.literal('expression'), expression: z.string().max(10000), _editor: editorSchema }).strict(),
    z
      .object({ mode: z.literal('object'), fields: z.record(z.string(), parameterSchema), _editor: editorSchema })
      .strict(),
    z.object({ mode: z.literal('array'), items: z.array(parameterSchema).max(1000), _editor: editorSchema }).strict(),
  ]),
);
export const codeSchema = z
  .object({
    profile: z.literal('pure-transform@1').optional(),
    inputSchema: z.record(z.string(), z.json()).optional(),
    outputSchema: z.record(z.string(), z.json()).optional(),
    version: z.literal(1),
    language: z.enum(['javascript', 'typescript']),
    source: z.string().max(100000),
    runtime: z.literal('quickjs-wasm@0.32.0'),
    dependencies: z.array(z.never()).max(0).default([]),
    mode: z.enum(['all-items', 'each-item']),
    limits: z
      .object({
        timeoutMS: z.number().int().min(10).max(30000),
        memoryMB: z.number().int().min(8).max(128),
        maxOutputBytes: z
          .number()
          .int()
          .min(1)
          .max(4 * 1024 * 1024),
      })
      .strict(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type CodeDefinition = z.infer<typeof codeSchema>;
export const defaultCode = (): CodeDefinition => ({
  version: 1,
  language: 'javascript',
  source:
    '// input is the configured input. variables contains workflow variables.\nconsole.log("Processing input");\nreturn input;',
  runtime: 'quickjs-wasm@0.32.0',
  dependencies: [],
  mode: 'all-items',
  limits: { timeoutMS: 5000, memoryMB: 32, maxOutputBytes: 1048576 },
});
export function compileParameter(value: Parameter): Binding {
  const p = parameterSchema.parse(value);
  switch (p.mode) {
    case 'omit':
      return { source: 'absent' };
    case 'fixed':
      return { source: 'literal', value: p.value };
    case 'expression':
      expressionAst(p.expression);
      return { source: 'expression', expression: p.expression };
    case 'object':
      return {
        source: 'object',
        fields: Object.fromEntries(Object.entries(p.fields).map(([k, v]) => [k, compileParameter(v)])),
      };
    case 'array':
      if (p.items.some((item) => item.mode === 'omit'))
        throw new Error('Array entries cannot be omitted; remove the entry instead.');
      return { source: 'array', items: p.items.map(compileParameter) };
  }
}
export function parameterReferences(value: Parameter): string[] {
  switch (value.mode) {
    case 'expression':
      return expressionNodeReferences(value.expression);
    case 'object':
      return Object.values(value.fields).flatMap(parameterReferences);
    case 'array':
      return value.items.flatMap(parameterReferences);
    default:
      return [];
  }
}
const path = (base: string, p?: string) =>
  base +
  (p
    ? p
        .split('.')
        .map((k) => `[${JSON.stringify(k)}]`)
        .join('')
    : '');
export function parameterFromBinding(b: Binding): Parameter {
  switch (b.source) {
    case 'absent':
      return { mode: 'omit' };
    case 'literal':
      return { mode: 'fixed', value: b.value };
    case 'expression':
      return { mode: 'expression', expression: b.expression };
    case 'object':
      return {
        mode: 'object',
        fields: Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, parameterFromBinding(v)])),
      };
    case 'array':
      return { mode: 'array', items: b.items.map(parameterFromBinding) };
    case 'node':
      return { mode: 'expression', expression: path(`$nodes[${JSON.stringify(b.nodeId)}]`, b.path) };
    default:
      return {
        mode: 'expression',
        expression: path(
          { input: '$input', item: '$item', state: '$state', execution: '$execution' }[b.source],
          b.path,
        ),
      };
  }
}
