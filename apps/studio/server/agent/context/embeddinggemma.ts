import { z } from 'zod';
import type { MemoryEmbedder } from './mem0-index';

// Weights, precision, task prompts and dimensions define the vector space together.
export const EMBEDDING_GEMMA_MODEL =
  'sentence-transformers:google/embeddinggemma-2@914f7f89142e33e77833254d9c9b90c3cef7303b:text:f32:retrieval-v1:768';

/** Independently provisioned local Sentence Transformers worker; never downloads weights on request. */
export function embeddingGemmaMemoryEmbedder(
  env: Record<string, string | undefined>,
  transport: typeof fetch = fetch,
): MemoryEmbedder {
  const base = new URL(env.STUDIO_MEMORY_EMBEDDINGGEMMA_URL ?? 'http://127.0.0.1:11435');
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw Error('Memory embeddings must use an HTTP loopback EmbeddingGemma origin.');
  const read = async (path: string, signal: AbortSignal, body?: unknown) => {
    const response = await transport(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal,
      headers: { 'x-stackproc-embedding': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`Local embedding runtime rejected the request (${response.status}).`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Local embedding runtime returned no data.');
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64000) {
        await reader.cancel();
        throw Error('Embedding response too large.');
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  };
  const initialize = async (signal: AbortSignal) => {
    z.object({
      model: z.literal(EMBEDDING_GEMMA_MODEL),
      dimensions: z.literal(768),
      local: z.literal(true),
      textOnly: z.literal(true),
    }).parse(await read('/health', signal));
  };
  return {
    local: true,
    model: EMBEDDING_GEMMA_MODEL,
    dimensions: 768,
    initialize,
    async embed(text, signal, action = 'search') {
      signal.throwIfAborted();
      if (!text.trim() || Buffer.byteLength(text) > 32000) throw Error('Invalid embedding input size.');
      const data = z
        .object({ model: z.literal(EMBEDDING_GEMMA_MODEL), embedding: z.array(z.number().finite()).length(768) })
        .parse(await read('/embed', signal, { text, action }));
      const norm = Math.hypot(...data.embedding);
      if (Math.abs(norm - 1) > 0.01) throw Error('Local embedding runtime returned an unnormalized vector.');
      return data.embedding;
    },
  };
}
