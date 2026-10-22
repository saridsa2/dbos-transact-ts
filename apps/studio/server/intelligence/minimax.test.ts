import { describe, it, expect, vi } from 'vitest';
import { minimaxAdapter } from './minimax';
import { knowledgeFixtures } from '../../lib/knowledge/fixtures';
const fixture = () => ({
  summary: 'Source analysis',
  ontology: knowledgeFixtures()[0].ontology,
  process: knowledgeFixtures()[0].process,
});
const request = () => ({
  taskId: 'task',
  model: 'MiniMax-M2.7',
  source: { revisionId: 'revision', blocks: [{ id: 'block-1', text: 'Invoice procedure.' }] },
  answers: {},
  signal: new AbortController().signal,
});
const response = (content: unknown, extra = {}) =>
  new Response(
    JSON.stringify({
      id: 'response',
      model: 'MiniMax-M2.7',
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify(content), reasoning_content: 'private reasoning' },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 30 },
      ...extra,
    }),
  );
describe('MiniMax structured authoring adapter', () => {
  it('calls only the official endpoint, separates reasoning and validates output', async () => {
    const transport = vi.fn(async () => response(fixture()));
    const result = await minimaxAdapter(transport as typeof fetch).generate(request(), 'test-only-secret');
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.minimax.io/v1/chat/completions');
    expect(init.redirect).toBe('error');
    const sent = JSON.parse(String(init.body));
    expect(sent.reasoning_split).toBe(true);
    expect(sent.model).toBe('MiniMax-M2.7');
    expect(result.analysis.summary).toBe('Source analysis');
    expect(JSON.stringify(result)).not.toContain('private reasoning');
    expect(JSON.stringify(result)).not.toContain('test-only-secret');
  });
  it('rejects malformed, truncated and provider-error responses', async () => {
    for (const payload of [
      response({ summary: 'bad' }),
      response(fixture(), { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
      response(fixture(), { base_resp: { status_code: 1004 } }),
    ])
      await expect(minimaxAdapter((async () => payload) as typeof fetch).generate(request(), 'secret')).rejects.toThrow(
        'valid analysis',
      );
  });
  it('does not echo provider bodies or credentials in errors', async () => {
    const transport = vi.fn(async () => new Response('secret diagnostics', { status: 401 }));
    await expect(minimaxAdapter(transport as typeof fetch).generate(request(), 'secret')).rejects.toThrow('HTTP 401');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('enforces source and response bounds without silently truncating', async () => {
    const transport = vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const large = request();
    large.source.blocks[0].text = 'x'.repeat(80001);
    await expect(minimaxAdapter(transport as typeof fetch).generate(large, 'secret')).rejects.toThrow('too large');
    expect(transport).not.toHaveBeenCalled();
    await expect(minimaxAdapter(transport as typeof fetch).generate(request(), 'secret')).rejects.toThrow('size limit');
  });
});
