import { describe, it, expect, vi } from 'vitest';
import { readChatStream } from './stream';
import { prepareContext, microcompact, validatePairing } from './context';
import { HarnessHooks } from './hooks';
import { query, type QueryHost } from './query';
function stream(frames: unknown[], done = true) {
  const text =
    frames.map((f) => 'data: ' + JSON.stringify(f) + '\r\n\r\n').join('') + (done ? 'data: [DONE]\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const frame = (delta: unknown, finish_reason: string | null = null) => ({
  id: 'response',
  model: 'MiniMax-M2.7',
  choices: [{ index: 0, delta, finish_reason }],
});
describe('provider streams and context boundaries', () => {
  it('accepts MiniMax’s explicit terminal usage envelope without a DONE marker', async () => {
    const result = await readChatStream(
      stream(
        [
          frame({ content: 'Ready' }, 'stop'),
          {
            id: 'r',
            model: 'MiniMax-M2.7',
            choices: [],
            usage: { prompt_tokens: 12, completion_tokens: 2 },
            base_resp: { status_code: 0, status_msg: 'success' },
          },
        ],
        false,
      ),
    );
    expect(result.choices[0].message.content).toBe('Ready');
    expect(result.usage.prompt_tokens).toBe(12);
  });
  it('assembles split UTF-8 frames and tool arguments while never projecting private reasoning', async () => {
    const visible: string[] = [];
    const result = await readChatStream(
      stream([
        frame({ reasoning_content: 'PRIVATE' }),
        frame({ content: 'Hello café. <thi' }),
        frame({ content: 'nk>HIDDEN' }),
        frame({ content: '</think> Done.' }),
        frame({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"id":' } }] }),
        frame({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }),
        frame({}, 'tool_calls'),
      ]),
      async (t) => {
        visible.push(t);
      },
    );
    expect(visible.join('')).toBe('Hello café.  Done.');
    expect(result.choices[0].message.reasoning_content).toBe('PRIVATE');
    expect(result.choices[0].message.tool_calls?.[0].function.arguments).toBe('{"id":"a"}');
  });
  it('rejects interrupted output even if some public text arrived', async () => {
    await expect(readChatStream(stream([frame({ content: 'Partial response' })], false))).rejects.toThrow(
      'complete receipt',
    );
  });
  it('compacts only complete rounds and keeps latest tool pairs intact', async () => {
    const source = [
      { role: 'system', content: 'policy' },
      { role: 'user', content: 'x'.repeat(10000) },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
      { role: 'tool', tool_call_id: 'a', content: 'old' },
      { role: 'assistant', content: 'old response' },
      { role: 'user', content: 'Current question' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'b' }] },
      { role: 'tool', tool_call_id: 'b', content: 'latest' },
    ];
    const summarize = vi.fn(async () => 'Earlier user decision and receipt a.');
    const compacted = await prepareContext(source, { maxBytes: 2048, retainRounds: 1, compact: true, summarize });
    expect(summarize).toHaveBeenCalledOnce();
    expect(compacted.at(-1)?.tool_call_id).toBe('b');
    expect(() => validatePairing(compacted)).not.toThrow();
    expect(compacted[0].content).toBe('policy');
  });
  it('does not drop unresolved results or fabricate summaries', async () => {
    await expect(
      prepareContext([{ role: 'assistant', tool_calls: [{ id: 'a' }] }], {
        maxBytes: 1,
        retainRounds: 1,
        compact: true,
        summarize: async () => 'fake',
      }),
    ).rejects.toThrow('unresolved');
  });
  it('microcompacts old observations with retrievable receipt identities', () => {
    const input = [
      { role: 'assistant', tool_calls: [{ id: 'a' }] },
      { role: 'tool', tool_call_id: 'a', content: 'x'.repeat(9000) },
      { role: 'assistant', content: 'latest' },
    ];
    const result = microcompact(input, 1, () => 'receipt-id');
    expect(result.replacements).toBe(1);
    expect(JSON.parse(String(result.messages[1].content)).receipt).toBe('receipt-id');
    expect(String(input[1].content).length).toBe(9000);
  });
  it('fails closed when a trusted lifecycle hook denies an action', async () => {
    const after = vi.fn(async () => {});
    const hooks = new HarnessHooks([async () => ({ deny: 'policy' }), after]);
    await expect(
      hooks.run('before_tool', { workspaceId: 'w', workId: 'i', turn: 1, invocationId: 'c' }),
    ).rejects.toThrow('denied');
    expect(after).not.toHaveBeenCalled();
  });
  it('batches only consecutive authorized reads and serializes a write barrier', async () => {
    let active = 0,
      max = 0;
    const log: string[] = [];
    let first = true;
    const host: QueryHost = {
      startTurn: 0,
      maxTurns: 3,
      concurrency: 3,
      isReadOnly: (n) => n === 'read',
      complete: async () =>
        first
          ? ((first = false),
            {
              text: '',
              calls: [
                { id: 'a', name: 'read', arguments: {} },
                { id: 'b', name: 'read', arguments: {} },
                { id: 'c', name: 'write', arguments: {} },
              ],
            })
          : { text: 'Done', calls: [] },
      runTool: async (call) => {
        active++;
        max = Math.max(max, active);
        log.push(call.id + 'start');
        await new Promise((r) => setTimeout(r, 5));
        log.push(call.id + 'end');
        active--;
        return {};
      },
      skipTool: async () => {},
      checkpoint: async () => {},
      finish: async () => {},
      suspend: async () => {},
      exhausted: async () => {},
    };
    await query(host);
    expect(max).toBe(2);
    expect(log.indexOf('cstart')).toBeGreaterThan(log.indexOf('bend'));
  });
});
