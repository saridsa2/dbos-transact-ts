import { describe, it, expect, vi } from 'vitest';
import { SecretVault } from '../../control/secrets';
import { Mem0Index, vectorIdentity, validateVector } from './mem0-index';
describe('Mem0 OSS approved-memory adapter', () => {
  it('runs the real engine with deterministic IDs, sealed payloads, scoped reads and no external calls', async () => {
    const entries: any[] = [];
    const vault = new SecretVault(Buffer.alloc(32, 9));
    const service: any = {
      control: { vault, transaction: async (fn: any) => fn(service.pool) },
      features: { event: vi.fn() },
      pool: {
        query: vi.fn(async (sql: string, p: any[]) => {
          if (sql.startsWith('SELECT 1')) return { rowCount: 1, rows: [{}] };
          if (sql.startsWith('INSERT INTO wa_memory_vectors')) {
            if (!entries.find((r) => r.workspace_id === p[0] && r.memory_id === p[1] && r.version === p[2]))
              entries.push({
                workspace_id: p[0],
                memory_id: p[1],
                version: p[2],
                embedding_model: p[3],
                vector: p[4],
                payload: p[5],
              });
            return { rows: [] };
          }
          if (sql.includes('SELECT memory_id,version')) return { rows: entries.filter((r) => r.workspace_id === p[0]) };
          if (sql.includes('SELECT v.*'))
            return { rows: entries.filter((r) => r.workspace_id === p[0] && p[2].includes(r.memory_id)) };
          return { rows: [] };
        }),
      },
    };
    const embed = vi.fn(async () => [1, 0, 0]);
    const index = new Mem0Index(service, { local: true, model: 'fixture-apache-embedding', dimensions: 3, embed });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('External request forbidden'));
    try {
      const record = { id: 'canonical', version: 2, content: 'Banking facts stay private.' };
      expect(
        (await index.rank('one', 'work', 'banking', [record], new AbortController().signal))?.scores.has('canonical'),
      ).toBe(true);
      await index.rank('one', 'work', 'banking', [record], new AbortController().signal);
      expect(entries).toHaveLength(1);
      expect(embed).toHaveBeenCalledTimes(3); // One index write; two queries.
      expect(JSON.stringify(entries)).not.toContain(record.content);
      expect(JSON.stringify(entries)).not.toContain('textLemmatized');
      const callsBeforeEmpty = embed.mock.calls.length;
      expect((await index.rank('two', 'work', 'banking', [], new AbortController().signal))?.scores.size).toBe(0);
      expect(embed.mock.calls.length).toBe(callsBeforeEmpty);
      expect(fetch).not.toHaveBeenCalled();
      expect(vectorIdentity('one', 'canonical', 2, 'fixture-apache-embedding')).not.toBe(
        vectorIdentity('two', 'canonical', 2, 'fixture-apache-embedding'),
      );
    } finally {
      fetch.mockRestore();
    }
  });
  it('rejects ambiguous embeddings and requires explicit local configuration', () => {
    expect(() => validateVector([1, NaN], 2)).toThrow();
    expect(() => validateVector([0, 0], 2)).toThrow();
    expect(() => validateVector([1], 2)).toThrow();
    expect(() => new Mem0Index({} as any, { local: false, model: 'remote', dimensions: 3 } as any)).toThrow('local');
  });
});
