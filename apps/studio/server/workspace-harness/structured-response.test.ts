import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredResult, StructuredResponseError, withStructuredRepair } from './structured-response';
import { minimaxAgentModel } from '../agent/model';
const contract = structuredResult('record_test_result', z.object({ ok: z.boolean() }).strict());
const valid = { text: '', calls: [{ id: 'one', name: contract.name, arguments: { ok: true } }] };
describe('shared structured results', () => {
  it('sends schema and named tool choice through the real provider adapter', async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'r',
            model: 'MiniMax-M2.7',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'one', type: 'function', function: { name: contract.name, arguments: '{"ok":true}' } },
                  ],
                },
              },
            ],
          }),
        ),
    );
    const reply = await minimaxAgentModel(transport).complete(
      {
        model: 'MiniMax-M2.7',
        messages: [{ role: 'user', content: 'Return result' }],
        tools: contract.tools,
        toolChoice: contract.toolChoice,
        outputTokens: 500,
        signal: new AbortController().signal,
      },
      'fixture',
    );
    const body = JSON.parse((transport.mock.calls as any)[0][1].body);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: contract.name } });
    expect(body.tools[0].function.parameters.additionalProperties).toBe(false);
    expect(body.tools[0].function.parameters.required).toEqual(['ok']);
    expect(contract.validate(reply, 'r')).toEqual({ ok: true });
  });
  it.each([
    { text: '```json\n{"ok":true}\n```', calls: [] },
    { text: '', calls: [{ id: 'wrong', name: 'delete_workspace', arguments: { ok: true } }] },
    { text: '', calls: [...valid.calls, ...valid.calls] },
    { text: '', calls: [{ ...valid.calls[0], arguments: { ok: 'true' } }] },
    { text: '', calls: [{ ...valid.calls[0], arguments: { ok: true, grantPermissions: true } }] },
  ])('rejects prose, unknown/extra calls and invalid schemas without dispatching anything', (reply) => {
    expect(() => contract.validate(reply as any, 'r')).toThrow(StructuredResponseError);
  });
  it('repairs one received invalid result; never retries network or uncertain failures', async () => {
    const attempt = vi.fn(async (repair?: unknown) => {
      if (!repair) return contract.validate({ text: 'fenced JSON', calls: [] }, 'bad');
      return contract.validate(valid, 'repair');
    });
    expect(await withStructuredRepair(attempt)).toEqual({ ok: true });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[1][0]).toMatchObject({
      receiptId: 'bad',
      issues: [{ code: 'invalid_return_tool', path: '' }],
    });
    const network = vi.fn(async () => {
      throw Error('UNCERTAIN: disconnected');
    });
    await expect(withStructuredRepair(network)).rejects.toThrow('UNCERTAIN');
    expect(network).toHaveBeenCalledOnce();
  });
});
