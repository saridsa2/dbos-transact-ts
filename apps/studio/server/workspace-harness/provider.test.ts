import { describe, it, expect, vi } from 'vitest';
import { minimaxAgentModel } from '../agent/model';
import { schemaValidator, validateStructured } from './schema';
import { AgentExtensions } from './extensions';
import { harnessOptionsSchema } from './options';
const input = () => ({
  model: 'MiniMax-M2.7',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [],
  outputTokens: 100,
  signal: AbortSignal.timeout(3000),
});
const success = () =>
  new Response(
    JSON.stringify({
      id: 'r',
      model: 'MiniMax-M2.7',
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'Ready', reasoning_content: 'PRIVATE' } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
describe('provider and extension contracts', () => {
  it('retries only bounded 429 rejections and preserves private protocol separately', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(success());
    const result = await minimaxAgentModel(transport).complete(input(), 'fixture');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Ready');
    expect(result.message.reasoning_content).toBe('PRIVATE');
    expect(JSON.stringify({ ...result, message: undefined })).not.toContain('PRIVATE');
  });
  it('does not replay ambiguous network or server failures', async () => {
    for (const transport of [
      vi.fn().mockRejectedValue(new Error('lost connection')),
      vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    ]) {
      await expect(minimaxAgentModel(transport).complete(input(), 'fixture')).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('cancels a pending rate-limit retry', async () => {
    const controller = new AbortController(),
      transport = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '2' } }));
    const result = minimaxAgentModel(transport).complete({ ...input(), signal: controller.signal }, 'fixture');
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('validates JSON Schema without coercing values and supports 2020 arrays', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'integer' } },
      required: ['n'],
      additionalProperties: false,
    };
    expect(validateStructured(schema, '{"n":"9"}').valid).toBe(false);
    expect(validateStructured(schema, '{"n":9}').valid).toBe(true);
    expect(validateStructured(schema, '```json\n{}\n```').valid).toBe(false);
    const validate = schemaValidator({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      prefixItems: [{ type: 'integer' }],
      items: false,
    });
    expect(validate([1])).toBe(true);
    expect(validate([1, 2])).toBe(false);
  });
  it('rejects duplicate offerings, invalid schemas and stale extension versions', () => {
    const registry = new AgentExtensions(),
      tool = {
        name: 'read',
        description: 'Read fixture',
        effect: 'read' as const,
        inputSchema: { type: 'object' },
        execute: async () => ({}),
      };
    registry.register({ id: 'fixture', version: '1', tools: [tool] });
    expect(() => registry.resolve([{ id: 'fixture', version: '2' }])).toThrow('changed');
    expect(() => registry.register({ id: 'other', version: '1', tools: [tool, tool] })).toThrow('Duplicate');
    expect(() =>
      new AgentExtensions().register({
        id: 'bad',
        version: '1',
        tools: [{ ...tool, inputSchema: { type: 'incorrect' } }],
      }),
    ).toThrow();
  });
  it('rejects duplicate runtime bindings', () => {
    const id = crypto.randomUUID();
    expect(harnessOptionsSchema.safeParse({ skills: [id, id] }).success).toBe(false);
    expect(
      harnessOptionsSchema.safeParse({
        extensions: [
          { id: 'test', version: '1' },
          { id: 'test', version: '1' },
        ],
      }).success,
    ).toBe(false);
  });
});
