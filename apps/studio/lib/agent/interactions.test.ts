import { describe, it, expect } from 'vitest';
import {
  interactionAnswerMatches,
  interactionDefinitionSchema,
  interactionErrors,
  interactionResponseSchema,
  type AgentInteraction,
} from './interactions';
const question: AgentInteraction = {
  id: '00000000-0000-4000-8000-000000000001',
  question: 'Configure this process',
  fields: [
    {
      id: 'team',
      label: 'Team',
      type: 'select',
      required: true,
      options: [
        { id: 'finance', label: 'Finance' },
        { id: 'sales', label: 'Sales' },
      ],
    },
    { id: 'limit', label: 'Limit', type: 'number', required: true },
    { id: 'enabled', label: 'Enabled', type: 'boolean', required: true },
    { id: 'tags', label: 'Tags', type: 'multiselect', required: false, options: [{ id: 'a', label: 'A' }] },
  ],
};
describe('agent structured interaction responses', () => {
  it('accepts numeric zero and false as real values', () =>
    expect(
      interactionErrors(question, {
        interactionId: question.id,
        values: { team: 'finance', limit: 0, enabled: false },
      }),
    ).toEqual({}));
  it('rejects unknown fields, invalid options and wrong types', () =>
    expect(
      interactionErrors(question, {
        interactionId: question.id,
        values: { team: 'admin', limit: '9', enabled: 'false', extra: true, tags: ['a', 'a'] },
      }),
    ).toEqual({
      team: 'Choose an available option.',
      limit: 'Enter a number.',
      enabled: 'Choose yes or no.',
      extra: 'Unknown field.',
      tags: 'Choose available options once each.',
    }));
  it('rejects stale questions and missing required fields', () => {
    expect(interactionErrors(question, { interactionId: 'different', values: {} })._form).toBeTruthy();
    expect(Object.keys(interactionErrors(question, { interactionId: question.id, values: {} }))).toEqual([
      'team',
      'limit',
      'enabled',
    ]);
  });
  it('validates definitions before rendering and bounds responses', () => {
    expect(
      interactionDefinitionSchema.safeParse({
        question: 'Choose',
        fields: [{ id: 'choice', label: 'Choice', type: 'select' }],
      }).success,
    ).toBe(false);
    expect(
      interactionDefinitionSchema.safeParse({ question: 'Choose', fields: [question.fields[0], question.fields[0]] })
        .success,
    ).toBe(false);
    expect(interactionResponseSchema.safeParse({ interactionId: question.id, values: { bad: Infinity } }).success).toBe(
      false,
    );
  });
});

describe('persisted structured answer comparison', () => {
  const response = { interactionId: question.id, values: { team: 'finance', limit: 0, enabled: false, tags: ['a'] } };
  it('accepts JSONB key ordering and insignificant whitespace', () => {
    expect(interactionAnswerMatches('{ "enabled":false,"tags":["a"],"limit":0,"team":"finance" }', response)).toBe(
      true,
    );
  });
  it('rejects changed values, array order, and invalid JSON', () => {
    expect(interactionAnswerMatches('{"team":"sales","limit":0,"enabled":false,"tags":["a"]}', response)).toBe(false);
    expect(interactionAnswerMatches('not JSON', response)).toBe(false);
    expect(
      interactionAnswerMatches('{"items":["b","a"]}', { interactionId: question.id, values: { items: ['a', 'b'] } }),
    ).toBe(false);
  });
});
