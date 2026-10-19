import { z } from 'zod';
import Ajv from 'ajv';
import type { AgentFlow, FlowNodeData } from '../flows/types';
import { parameterSchema, type Parameter } from './model';
export type ValueSchema = Record<string, unknown>;
export const valueSchema = z.record(z.string(), z.json());
export const declarationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    schema: valueSchema,
    initial: parameterSchema,
    writable: z.boolean().default(true),
  })
  .strict();
export type Declaration = { id: string; name: string; schema: ValueSchema; initial: Parameter; writable: boolean };
export const portSchema = z
  .object({
    id: z.enum(['input', 'value']),
    schema: valueSchema,
    cardinality: z.enum(['single', 'collection']).default('single'),
    required: z.boolean().default(true),
  })
  .strict();
export type Port = z.infer<typeof portSchema>;
export const mergeSchema = z
  .object({
    updates: z.array(z.object({ variableId: z.string().min(1), value: parameterSchema }).strict()).default([]),
  })
  .strict();
export type Merge = z.infer<typeof mergeSchema>;
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: false,
});
const cache = new Map<string, ReturnType<typeof ajv.compile>>();
export function assertValue(schema: ValueSchema, value: unknown, label: string) {
  const key = JSON.stringify(schema);
  let check = cache.get(key);
  if (!check) {
    check = ajv.compile(schema);
    if (cache.size > 200) cache.clear();
    cache.set(key, check);
  }
  if (!check(value))
    throw new Error(`${label}: ${check.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
}
export function checkSchema(schema: ValueSchema) {
  if (!ajv.validateSchema(schema)) throw new Error('Invalid value schema.');
  ajv.compile(schema);
}
export function ports(node: FlowNodeData): { input: Port; output: Port } {
  return {
    input: node.config.ports?.input ?? { id: 'input', schema: {}, cardinality: 'single', required: true },
    output: node.config.ports?.output ?? { id: 'value', schema: {}, cardinality: 'single', required: true },
  };
}
export function validatePort(port: Port, value: unknown, label: string) {
  if (value === undefined) {
    if (port.required) throw new Error(`${label}: required value is absent.`);
    return;
  }
  if (port.cardinality === 'collection' && !Array.isArray(value)) throw new Error(`${label}: expected a collection.`);
  assertValue(port.schema, value, label);
}
export function assertUpdates(flow: AgentFlow, updates: unknown): Record<string, unknown> {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates))
    throw new Error('Variable updates must be an object keyed by declaration ID.');
  for (const [id, value] of Object.entries(updates)) {
    const declaration = flow.declarations?.find((d) => d.id === id);
    if (!declaration)
      throw new Error(
        `Variable '${id}' is undeclared or inherited read-only. Declare a local variable to override it.`,
      );
    if (!declaration.writable) throw new Error(`Variable '${declaration.name}' is read-only.`);
    assertValue(declaration.schema, value, `Variable ${declaration.name}`);
  }
  return updates as Record<string, unknown>;
}
export function validateContracts(flow: AgentFlow) {
  const declarations = flow.declarations ?? [];
  if (
    new Set(declarations.map((d) => d.id)).size !== declarations.length ||
    new Set(declarations.map((d) => d.name)).size !== declarations.length
  )
    throw new Error('Variable IDs and names must be unique.');
  declarations.forEach((d) => checkSchema(d.schema));
  for (const node of flow.nodes) {
    const { input, output } = ports(node);
    checkSchema(input.schema);
    checkSchema(output.schema);
    const incoming = flow.edges.filter((e) => e.target === node.id);
    if (incoming.length > 1 && node.kind !== 'merge')
      throw new Error(`Node ${node.name}: use an explicit Merge for multiple incoming paths.`);
    if (node.kind === 'merge') {
      const ids = node.config.merge?.updates.map((u) => u.variableId) ?? [];
      if (new Set(ids).size !== ids.length) throw new Error(`Node ${node.name}: duplicate variable update target.`);
      for (const id of ids)
        if (!declarations.some((d) => d.id === id && d.writable))
          throw new Error(`Node ${node.name}: '${id}' is not a declared writable variable.`);
    }
    if (node.config.code) {
      if (!node.config.code.source.trim()) throw new Error(`Node ${node.name}: source code is required.`);
      if (node.config.code.profile !== 'pure-transform@1')
        throw new Error(`Node ${node.name}: select the installed Pure transform profile.`);
      if (node.config.code.mode !== 'all-items')
        throw new Error(`Node ${node.name}: use For each for repeated invocations.`);
    }
    const op = node.config.operation;
    if (
      op?.kind === 'parallel' &&
      (new Set(op.branches.map((b) => b.id)).size !== op.branches.length || op.branches.some((b) => !b.id))
    )
      throw new Error(`Node ${node.name}: branches need unique stable IDs.`);
  }
  for (const edge of flow.edges)
    if ((edge.sourcePort && edge.sourcePort !== 'value') || (edge.targetPort && edge.targetPort !== 'input'))
      throw new Error(`Edge ${edge.id}: unknown data port.`);
}
export type ScopeSnapshot = {
  id: string;
  variables: Record<string, unknown>;
  nodeInput?: unknown;
  item?: unknown;
  index?: number;
};
export type MappingTarget = {
  path: string;
  label: string;
  schema?: ValueSchema;
  replaceRequired?: boolean;
  insert: (expression: string) => void;
};
export function schemaType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
export function parameterValue(parameter: Parameter): unknown {
  return parameter.mode === 'fixed' ? parameter.value : undefined;
}
