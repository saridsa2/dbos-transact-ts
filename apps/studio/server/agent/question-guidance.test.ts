import { describe, expect, it } from 'vitest';
import { questionGuidance } from './question-guidance';
import { modelTools, runAgentTool } from './tools';
import { questionFields, questionResponse } from '../../lib/agent/workbench-model';

describe('structured clarification contract', () => {
  it('only offers typed questions for new model turns', () => {
    const names = modelTools.map((tool) => tool.function.name);
    expect(names).toContain('ask_user_v2');
    expect(names).not.toContain('ask_user_v1');
    expect(questionGuidance(names)).toContain('MUST call ask_user_v2');
    expect(questionGuidance(['workspace_describe_v1'])).toBe('');
  });
  it('routes proposal choices through the existing catalog form and validated answer adapter', async () => {
    const result = await runAgentTool({} as any, {} as any, {} as any, crypto.randomUUID(), 'ask_user_v2', {
      question: 'Which direction should the ontology proposal take?',
      fields: [
        {
          id: 'direction',
          label: 'Direction',
          type: 'select',
          required: true,
          options: [
            { id: 'properties', label: 'Add concrete properties and enums' },
            { id: 'subclasses', label: 'Create organization subclasses' },
            { id: 'both', label: 'Both' },
            { id: 'other', label: 'Another direction' },
          ],
        },
        { id: 'details', label: 'Additional details', type: 'text', required: false },
      ],
    });
    const interaction = (result as any).interaction;
    expect(questionFields(interaction)[0].options).toHaveLength(4);
    expect(questionResponse(interaction, { field_0: 'both' }).values).toEqual({ direction: 'both' });
    expect(questionResponse(interaction, { field_0: 'other', field_1: 'Only government agencies' }).values).toEqual({
      direction: 'other',
      details: 'Only government agencies',
    });
  });
  it('keeps the legacy execution contract available for old work', async () => {
    await expect(
      runAgentTool({} as any, {} as any, {} as any, crypto.randomUUID(), 'ask_user_v1', { question: 'Legacy?' }),
    ).resolves.toEqual({ question: 'Legacy?' });
  });
});
