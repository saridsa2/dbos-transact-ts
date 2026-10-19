import type { Parameter } from './model';
import type { ValueSchema } from './contracts';
import type { FlowNodeData } from '../flows/types';

/** Display hints, never a substitute for runtime input/output validation. */
export function valueShape(value: unknown): ValueSchema {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? valueShape(value[0]) : {} };
  if (value === undefined) return {};
  if (value === null) return { type: 'null' };
  if (typeof value === 'object')
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value).map(([key, v]) => [key, valueShape(v)])),
    };
  return { type: typeof value };
}
export function parameterShape(parameter?: Parameter): ValueSchema {
  if (!parameter || parameter.mode === 'expression' || parameter.mode === 'omit') return {};
  if (parameter.mode === 'fixed') return valueShape(parameter.value);
  if (parameter.mode === 'array') return { type: 'array', items: parameterShape(parameter.items[0]) };
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(parameter.fields)
        .filter(([, v]) => v.mode !== 'omit')
        .map(([key, v]) => [key, parameterShape(v)]),
    ),
  };
}
export function nodeResultShape(node: FlowNodeData): ValueSchema {
  const explicit = node.config.ports?.output?.schema;
  if (explicit && Object.keys(explicit).length) return explicit;
  if (['construct', 'merge'].includes(node.kind)) return parameterShape(node.config.parameters?.value);
  return {};
}
/** Reject known mismatches; unknown shapes remain referenceable and are checked at execution. */
export function shapeMismatch(destination?: ValueSchema, source?: ValueSchema): string | undefined {
  if (!destination || !source) return;
  const types = (s: ValueSchema) =>
    typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? (s.type as string[]) : [];
  const targetTypes = types(destination),
    sourceTypes = types(source);
  if (
    targetTypes.length &&
    sourceTypes.length &&
    sourceTypes.every((type) => !targetTypes.includes(type) && !(type === 'integer' && targetTypes.includes('number')))
  )
    return 'This value has an incompatible type.';
  if (targetTypes.includes('array') && sourceTypes.includes('array'))
    return shapeMismatch(destination.items as ValueSchema | undefined, source.items as ValueSchema | undefined);
  if (targetTypes.includes('object') && sourceTypes.includes('object')) {
    const targetProperties = destination.properties as Record<string, ValueSchema> | undefined;
    const sourceProperties = source.properties as Record<string, ValueSchema> | undefined;
    for (const [key, schema] of Object.entries(targetProperties ?? {})) {
      const mismatch = shapeMismatch(schema, sourceProperties?.[key]);
      if (mismatch) return `${key}: ${mismatch}`;
    }
  }
}
