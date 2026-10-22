import { z } from 'zod';
import type { MemoryEmbedder } from './mem0-index';
import { embeddingGemmaMemoryEmbedder } from './embeddinggemma';

/** Optional local Ollama adapter; no automatic model download or hosted API fallback. */
export async function localMemoryEmbedder(
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
): Promise<MemoryEmbedder | undefined> {
  const provider = env.STUDIO_MEMORY_EMBEDDINGS_PROVIDER;
  if (provider === 'embeddinggemma') return embeddingGemmaMemoryEmbedder(env, transport);
  if (provider && !['none', 'ollama'].includes(provider))
    throw Error('Select a supported memory embedding provider: none, embeddinggemma or ollama.');
  if (provider === 'none' || (provider !== 'ollama' && env.STUDIO_MEMORY_LOCAL_EMBEDDINGS !== '1')) return undefined;
  const base = new URL(env.STUDIO_MEMORY_OLLAMA_URL ?? 'http://127.0.0.1:11434');
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw Error('Memory embeddings must use an HTTP loopback Ollama origin.');
  const name = 'nomic-embed-text:v1.5'; // Apache-2.0 model; see documentation and upstream model card.
  const tags = z.object({
    models: z.array(z.object({ name: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/) })),
  });
  const read = async (path: string, signal: AbortSignal, body?: unknown) => {
    const r = await transport(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw Error(`Local embedding server rejected the request (${r.status}).`);
    }
    const reader = r.body?.getReader();
    if (!reader) throw Error('Local embedding server returned no data.');
    const parts: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 128000) {
        await reader.cancel();
        throw Error('Embedding response too large.');
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  };
  const resolveDigest = async (signal: AbortSignal) => {
    const model = tags.parse(await read('/api/tags', signal)).models.find((m) => m.name === name);
    if (!model)
      throw Error(
        'Install the Apache-2.0 nomic-embed-text:v1.5 model in local Ollama before enabling memory embeddings.',
      );
    return model.digest;
  };
  // Resolve lazily: an optional embedding daemon must not prevent the application from starting.
  let digest: string | undefined;
  const initialize = async (signal: AbortSignal) => {
    const current = await resolveDigest(signal);
    if (digest && current !== digest)
      throw Error('Embedding model changed. Restart to create a new isolated index generation.');
    digest = current;
  };
  return {
    local: true,
    get model() {
      return `ollama:${name}:${digest ?? 'pending'}`;
    },
    dimensions: 768,
    initialize,
    async embed(text, signal, action) {
      await initialize(signal);
      const data = z.object({ embeddings: z.array(z.array(z.number().finite()).length(768)).length(1) }).parse(
        await read('/api/embed', signal, {
          model: name,
          input: `${action === 'add' ? 'search_document' : 'search_query'}: ${text}`,
          truncate: false,
          keep_alive: '2m',
        }),
      );
      return data.embeddings[0];
    },
  };
}
