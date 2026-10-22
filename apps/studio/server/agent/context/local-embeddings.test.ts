import { describe, it, expect, vi } from 'vitest';
import { localMemoryEmbedder } from './local-embeddings';
describe('optional local embeddings', () => {
  it('stays disabled without opt-in and rejects non-loopback endpoints', async () => {
    const request = vi.fn();
    expect(await localMemoryEmbedder({}, request)).toBeUndefined();
    await expect(
      localMemoryEmbedder(
        { STUDIO_MEMORY_LOCAL_EMBEDDINGS: '1', STUDIO_MEMORY_OLLAMA_URL: 'https://external.example' },
        request,
      ),
    ).rejects.toThrow('loopback');
    expect(request).not.toHaveBeenCalled();
  });
  it('uses explicit provider selection and does not silently substitute another provider', async () => {
    const request = vi.fn();
    expect(
      await localMemoryEmbedder(
        { STUDIO_MEMORY_EMBEDDINGS_PROVIDER: 'none', STUDIO_MEMORY_LOCAL_EMBEDDINGS: '1' },
        request,
      ),
    ).toBeUndefined();
    await expect(localMemoryEmbedder({ STUDIO_MEMORY_EMBEDDINGS_PROVIDER: 'minimax' }, request)).rejects.toThrow(
      'supported',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('allows startup while offline and recovers when the configured server becomes available', async () => {
    let online = false;
    const request = vi.fn(async (url: any) => {
      if (!online) throw Error('offline');
      return String(url).endsWith('/api/tags')
        ? Response.json({ models: [{ name: 'nomic-embed-text:v1.5', digest: 'a'.repeat(64) }] })
        : Response.json({ embeddings: [Array(768).fill(0.1)] });
    });
    const model = await localMemoryEmbedder({ STUDIO_MEMORY_EMBEDDINGS_PROVIDER: 'ollama' }, request as any);
    expect(request).not.toHaveBeenCalled();
    await expect(model!.embed('query', new AbortController().signal)).rejects.toThrow('offline');
    online = true;
    expect(await model!.embed('query', new AbortController().signal)).toHaveLength(768);
    expect(model!.model).toContain('a'.repeat(64));
  });
  it('pins the local model digest, uses task prefixes and refuses silent truncation or model changes', async () => {
    let digest = 'a'.repeat(64);
    const bodies: any[] = [];
    const request = vi.fn(async (url: any, init: any) => {
      expect(new URL(url).hostname).toBe('127.0.0.1');
      expect(init.redirect).toBe('error');
      if (String(url).endsWith('/api/tags'))
        return Response.json({ models: [{ name: 'nomic-embed-text:v1.5', digest }] });
      bodies.push(JSON.parse(init.body));
      return Response.json({ embeddings: [Array(768).fill(0.1)] });
    });
    const model = await localMemoryEmbedder({ STUDIO_MEMORY_LOCAL_EMBEDDINGS: '1' }, request as any);
    expect(request).not.toHaveBeenCalled();
    expect(model!.model).toContain('pending');
    await model!.embed('Banking evidence', new AbortController().signal, 'add');
    expect(model!.model).toContain(digest);
    expect(bodies[0]).toMatchObject({ input: 'search_document: Banking evidence', truncate: false });
    digest = 'b'.repeat(64);
    await expect(model!.embed('query', new AbortController().signal)).rejects.toThrow('model changed');
    expect(bodies).toHaveLength(1);
  });
});
