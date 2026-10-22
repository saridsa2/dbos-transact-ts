import { describe, expect, it, vi } from 'vitest';
import { localMemoryEmbedder } from './local-embeddings';
import { EMBEDDING_GEMMA_MODEL, embeddingGemmaMemoryEmbedder } from './embeddinggemma';
import { vectorIdentity } from './mem0-index';

const vector = () => [1, ...Array(767).fill(0)];
describe('local EmbeddingGemma adapter', () => {
  it('selects Gemma explicitly, pins the vector space, and never contacts Ollama', async () => {
    const requests: any[] = [];
    const request = vi.fn(async (url: any, init: any) => {
      expect(new URL(url).origin).toBe('http://127.0.0.1:11435');
      expect(init.redirect).toBe('error');
      expect(init.headers['x-stackproc-embedding']).toBe('1');
      requests.push({ path: new URL(url).pathname, ...init });
      return Response.json(
        String(url).endsWith('/health')
          ? { model: EMBEDDING_GEMMA_MODEL, dimensions: 768, local: true, textOnly: true }
          : { model: EMBEDDING_GEMMA_MODEL, embedding: vector() },
      );
    });
    const embedder = await localMemoryEmbedder(
      { STUDIO_MEMORY_EMBEDDINGS_PROVIDER: 'embeddinggemma', STUDIO_MEMORY_LOCAL_EMBEDDINGS: '1' },
      request as any,
    );
    expect(request).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await embedder!.initialize!(signal);
    await embedder!.embed('Approved banking evidence', signal, 'add');
    await embedder!.embed('Who owns this business?', signal, 'search');
    expect(requests.map((r) => r.path)).toEqual(['/health', '/embed', '/embed']);
    expect(JSON.parse(requests[1].body)).toEqual({ text: 'Approved banking evidence', action: 'add' });
    expect(JSON.parse(requests[2].body).action).toBe('search');
    expect(requests[2].signal).toBe(signal);
    expect(vectorIdentity('w', 'm', 1, embedder!.model)).not.toBe(vectorIdentity('w', 'm', 1, 'ollama:nomic:768'));
  });
  it('rejects external endpoints, mismatched models, and invalid vectors', async () => {
    for (const origin of ['https://127.0.0.1:11435', 'http://external.example', 'http://127.0.0.1:11435/path'])
      expect(() => embeddingGemmaMemoryEmbedder({ STUDIO_MEMORY_EMBEDDINGGEMMA_URL: origin })).toThrow('loopback');
    const signal = new AbortController().signal;
    for (const bad of [Array(767).fill(0.1), Array(768).fill(0), Array(768).fill(1)]) {
      const model = embeddingGemmaMemoryEmbedder({}, async () =>
        Response.json({ model: EMBEDDING_GEMMA_MODEL, embedding: bad }),
      );
      await expect(model.embed('query', signal)).rejects.toThrow();
    }
    const model = embeddingGemmaMemoryEmbedder({}, async () =>
      Response.json({ model: 'different-revision', embedding: vector() }),
    );
    await expect(model.embed('query', signal)).rejects.toThrow();
    await expect(model.initialize!(signal)).rejects.toThrow();
  });
  it('respects aborts, input/output bounds, and does not retry unavailable inference', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    const model = embeddingGemmaMemoryEmbedder({}, request);
    const signal = new AbortController().signal;
    await expect(model.embed('x'.repeat(32001), signal)).rejects.toThrow('size');
    await expect(model.embed('query', AbortSignal.abort())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(model.embed('query', signal)).rejects.toThrow('503');
    expect(request).toHaveBeenCalledTimes(1);
    const oversized = embeddingGemmaMemoryEmbedder({}, async () => new Response(' '.repeat(64001)));
    await expect(oversized.embed('query', signal)).rejects.toThrow('too large');
  });
});
