import { describe, expect, it } from 'vitest';
import { embeddingGemmaMemoryEmbedder } from './embeddinggemma';
import { Mem0Index, similarity } from './mem0-index';
import { SecretVault } from '../../control/secrets';

// Explicit opt-in: requires the independently provisioned real model worker. No downloads here.
describe.skipIf(process.env.STUDIO_EMBEDDING_INTEGRATION !== '1')('real local EmbeddingGemma retrieval', () => {
  it('runs the real Mem0 add/search path with Gemma and encrypted, scoped projection storage', async () => {
    // In-memory SQL fixture isolates this test from customer records; model and Mem0 engine are real.
    const stored: any[] = [],
      events: any[] = [];
    const service: any = {
      control: { vault: new SecretVault(Buffer.alloc(32, 7)), transaction: async (fn: any) => fn(service.pool) },
      features: {
        event: async (...args: any[]) => {
          events.push(args);
        },
      },
      pool: {
        query: async (sql: string, p: any[]) => {
          if (sql.startsWith('SELECT 1')) return { rowCount: 1, rows: [{}] };
          if (sql.startsWith('INSERT INTO wa_memory_vectors')) {
            stored.push({
              workspace_id: p[0],
              memory_id: p[1],
              version: p[2],
              embedding_model: p[3],
              vector: p[4],
              payload: p[5],
            });
          }
          if (sql.includes('SELECT memory_id,version'))
            return { rows: stored.filter((r) => r.workspace_id === p[0] && r.embedding_model === p[1]) };
          if (sql.includes('SELECT v.*'))
            return {
              rows: stored.filter(
                (r) => r.workspace_id === p[0] && r.embedding_model === p[1] && p[2].includes(r.memory_id),
              ),
            };
          return { rows: [] };
        },
      },
    };
    const records = [
      {
        id: 'ownership',
        version: 1,
        content: 'Identify and verify the natural persons who ultimately own or control a corporate customer.',
      },
      { id: 'lunch', version: 1, content: 'The cafeteria serves lunch at noon.' },
    ];
    const index = new Mem0Index(service, embeddingGemmaMemoryEmbedder(process.env));
    const result = await index.rank(
      'banking-test',
      'test-work',
      'Who really owns this business?',
      records,
      AbortSignal.timeout(15000),
    );
    expect(result!.scores.get('ownership')).toBeGreaterThan(result!.scores.get('lunch')!);
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain(records[0].content);
    expect(events).toHaveLength(3); // Two document embeddings, one query; no reasoning model call.
    const other = await index.rank('other-workspace', 'test-work', 'owners', [], AbortSignal.timeout(15000));
    expect(other!.scores.size).toBe(0);
  });
  it('retrieves banking evidence through the same adapter used by memory recall', async () => {
    const model = embeddingGemmaMemoryEmbedder(process.env);
    const signal = AbortSignal.timeout(15000);
    await model.initialize!(signal);
    const relevant = await model.embed(
      'Identify and verify the natural persons who ultimately own or control a corporate customer.',
      signal,
      'add',
    );
    const irrelevant = await model.embed('The cafeteria serves lunch at noon.', signal, 'add');
    const query = await model.embed('How should we check the real owners behind a business?', signal, 'search');
    expect(similarity(query, relevant)).toBeGreaterThan(similarity(query, irrelevant));
    const invalid = await fetch('http://127.0.0.1:11435/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stackproc-embedding': '1' },
      body: JSON.stringify({ text: 'x '.repeat(10000), action: 'search' }),
    });
    expect(invalid.status).toBe(400);
    const browser = await fetch('http://127.0.0.1:11435/health', {
      headers: { origin: 'https://example.test', 'x-stackproc-embedding': '1' },
    });
    expect(browser.status).toBe(403);
  });
});
