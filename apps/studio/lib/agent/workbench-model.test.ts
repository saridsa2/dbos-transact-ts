import { describe, expect, it } from 'vitest';
import { questionFields, questionResponse } from './workbench-model';
import { interactionAnswerMatches, type AgentInteraction } from './interactions';
const interaction: AgentInteraction = {
  id: '1e98757d-e7ae-4bf5-8041-c327b6868f02',
  question: 'Choose scope',
  fields: [
    {
      id: 'scope',
      label: 'Scope',
      type: 'multiselect',
      required: true,
      options: [
        { id: 'retail', label: 'Retail' },
        { id: 'loans', label: 'Loans' },
      ],
    },
    {
      id: 'detail',
      label: 'Detail',
      type: 'select',
      required: true,
      options: [{ id: 'core', label: 'Core concepts' }],
    },
  ],
};
describe('catalog form to durable question adapter', () => {
  it('preserves machine IDs and produces the exact structured answer the server accepts', () => {
    expect(questionFields(interaction).map((field) => field.name)).toEqual([
      'field_0_option_0',
      'field_0_option_1',
      'field_1',
    ]);
    const response = questionResponse(interaction, { field_0_option_0: true, field_0_option_1: true, field_1: 'core' });
    expect(response.values).toEqual({ scope: ['retail', 'loans'], detail: 'core' });
    expect(interactionAnswerMatches(JSON.stringify(response.values), response)).toBe(true);
  });
  it('blocks required empty choices and invented options before enqueuing', () => {
    expect(() => questionResponse(interaction, { field_1: 'core' })).toThrow('scope');
    expect(() => questionResponse(interaction, { field_0_option_0: true, field_1: 'invented' })).toThrow('detail');
  });
  it('preserves an explicit false boolean and does not forward unexpected form fields', () => {
    const form: AgentInteraction = {
      ...interaction,
      fields: [{ id: 'approved', label: 'Approve', type: 'boolean', required: true }],
    };
    expect(questionResponse(form, { field_0: false, unrelated: 'ignore' }).values).toEqual({ approved: false });
  });
  it('cannot collide generated checkbox keys with model-defined field IDs', () => {
    const form: AgentInteraction = {
      ...interaction,
      fields: [interaction.fields[0], { id: 'field_0_option_0', label: 'Notes', type: 'text', required: true }],
    };
    expect(new Set(questionFields(form).map((field) => field.name)).size).toBe(3);
    expect(questionResponse(form, { field_0_option_0: true, field_1: 'Checked' }).values).toEqual({
      scope: ['retail'],
      field_0_option_0: 'Checked',
    });
  });
});
