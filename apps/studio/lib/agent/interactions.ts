import { z } from 'zod';
import { canonicalJson } from '../knowledge/contracts';
const fieldId = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v));
const option = z.object({ id: fieldId, label: z.string().min(1).max(200) }).strict();
export const agentFieldSchema = z
  .object({
    id: fieldId,
    label: z.string().min(1).max(200),
    hint: z.string().max(500).optional(),
    type: z.enum(['text', 'number', 'boolean', 'select', 'multiselect']),
    required: z.boolean().default(true),
    options: z.array(option).min(1).max(20).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (['select', 'multiselect'].includes(v.type) && !v.options)
      c.addIssue({ code: 'custom', path: ['options'], message: 'Choices require options.' });
    if (v.options && new Set(v.options.map((o) => o.id)).size !== v.options.length)
      c.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique.' });
  });
export const interactionDefinitionSchema = z
  .object({ question: z.string().min(1).max(2000), fields: z.array(agentFieldSchema).min(1).max(10) })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.fields.map((f) => f.id)).size !== v.fields.length)
      c.addIssue({ code: 'custom', path: ['fields'], message: 'Field IDs must be unique.' });
  });
export const interactionResponseSchema = z
  .object({
    interactionId: z.string().uuid(),
    values: z.record(
      fieldId,
      z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.array(z.string().max(64)).max(20)]),
    ),
  })
  .strict();
export type AgentInteraction = z.infer<typeof interactionDefinitionSchema> & { id: string };
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
export function interactionErrors(definition: AgentInteraction, response: InteractionResponse): Record<string, string> {
  const errors: Record<string, string> = {};
  if (response.interactionId !== definition.id)
    return { _form: 'This question has changed. Refresh before answering.' };
  for (const key of Object.keys(response.values))
    if (!definition.fields.some((f) => f.id === key)) errors[key] = 'Unknown field.';
  for (const field of definition.fields) {
    const value = response.values[field.id];
    const missing = value === undefined || value === '' || (Array.isArray(value) && !value.length);
    if (missing) {
      if (field.required) errors[field.id] = 'This field is required.';
      continue;
    }
    if (field.type === 'text' && typeof value !== 'string') errors[field.id] = 'Enter text.';
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      errors[field.id] = 'Enter a number.';
    if (field.type === 'boolean' && typeof value !== 'boolean') errors[field.id] = 'Choose yes or no.';
    if (field.type === 'select' && (typeof value !== 'string' || !field.options?.some((o) => o.id === value)))
      errors[field.id] = 'Choose an available option.';
    if (
      field.type === 'multiselect' &&
      (!Array.isArray(value) ||
        new Set(value).size !== value.length ||
        value.some((v) => !field.options?.some((o) => o.id === v)))
    )
      errors[field.id] = 'Choose available options once each.';
  }
  return errors;
}

/** PostgreSQL JSONB may reorder object keys; compare the typed data, not its serialization. */
export function interactionAnswerMatches(answer: string, response: InteractionResponse): boolean {
  try {
    return canonicalJson(JSON.parse(answer)) === canonicalJson(response.values);
  } catch {
    return false;
  }
}
