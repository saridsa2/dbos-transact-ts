import { describe, it, expect, vi } from 'vitest';
import { AgentResponseError, minimaxAgentModel } from './model';
describe('MiniMax agent protocol', () => {
  const request = {
    model: 'MiniMax-M2.7',
    messages: [{ role: 'user', content: 'Inspect this workspace' }],
    tools: [],
    outputTokens: 1024,
    signal: new AbortController().signal,
  };
  it('separates private continuation, preserves tool call IDs, and uses only the fixed MiniMax endpoint', async () => {
    const transport = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: 'r',
            model: 'MiniMax-M2.7',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'private protocol',
                  tool_calls: [
                    { id: 'c', type: 'function', function: { name: 'workspace_describe_v1', arguments: '{}' } },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 10 },
          }),
        ),
    );
    const result = await minimaxAgentModel(transport as typeof fetch).complete(request, 'fixture-key');
    expect(result.calls).toEqual([{ id: 'c', name: 'workspace_describe_v1', arguments: {} }]);
    expect(result.text).toBe('');
    expect(result.message.reasoning_content).toBe('private protocol');
    expect(transport.mock.calls[0][0]).toBe('https://api.minimax.io/v1/chat/completions');
  });
  it('does not dispatch truncated or malformed tool responses', async () => {
    const transport = async () =>
      new Response(
        JSON.stringify({
          id: 'r',
          model: 'MiniMax-M2.7',
          choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
        }),
      );
    await expect(minimaxAgentModel(transport).complete(request, 'fixture-key')).rejects.toMatchObject({
      finishReason: 'length',
      outputLimit: 1024,
    });
    await expect(minimaxAgentModel(transport).complete(request, 'fixture-key')).rejects.toThrow(
      'No tools from this response were run',
    );
  });
});

describe('MiniMax tool argument normalization', () => {
  const request = {
    model: 'MiniMax-M2.7',
    messages: [],
    tools: [],
    outputTokens: 1024,
    signal: new AbortController().signal,
  };
  const transport = (args: string[]) => async () =>
    new Response(
      JSON.stringify({
        id: 'formatting-fixture',
        model: 'MiniMax-M2.7',
        usage: { prompt_tokens: 12, completion_tokens: 5 },
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: args.map((arguments_, i) => ({
                id: `call-${i}`,
                type: 'function',
                function: { name: 'workspace_describe_v1', arguments: arguments_ },
              })),
            },
          },
        ],
      }),
    );
  it('normalizes a complete JSON fence in both executable calls and protocol history', async () => {
    const result = await minimaxAgentModel(transport(['```json\n{}\n```'])).complete(request, 'fixture');
    expect(result.calls[0].arguments).toEqual({});
    expect((result.message.tool_calls as any[])[0].function.arguments).toBe('{}');
  });
  it.each(['[]', 'null', '"object"', '```json\n{', '{} trailing text', 'prefix ```json\n{}\n```'])(
    'rejects invalid input before exposing any executable call: %s',
    async (args) => {
      await expect(minimaxAgentModel(transport(['{}', args])).complete(request, 'fixture')).rejects.toMatchObject({
        finishReason: 'invalid_tool_arguments',
        usage: { input: 12, output: 5 },
        responseId: 'formatting-fixture',
      });
    },
  );
});
