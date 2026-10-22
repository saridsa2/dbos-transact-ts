import { describe, it, expect, vi } from 'vitest';
import { ContextMemory } from './context-memory';
describe('memory readiness', () => {
  it('probes the configured adapter and counts only the current workspace and embedding model', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [{ approved: 3, indexed: 1 }] }));
    const embed = vi.fn(async () => [1, 0]);
    const service = { pool: { query }, memoryIndex: { embedder: { model: 'local-fixture', dimensions: 2, embed } } };
    const result = await new ContextMemory(service as any).status({ workspace: { id: 'scoped-workspace' } } as any);
    expect(result).toMatchObject({ available: true, configured: true, pending: 2, indexed: 1 });
    expect(query.mock.calls[0][1]).toEqual(['scoped-workspace', 'local-fixture']);
  });
  it('reports an unavailable adapter without exposing its error or claiming indexed memory is available', async () => {
    const service = {
      pool: { query: async () => ({ rows: [{ approved: 0, indexed: 0 }] }) },
      memoryIndex: {
        embedder: {
          model: 'fixture',
          dimensions: 2,
          embed: async () => {
            throw Error('private-adapter-error');
          },
        },
      },
    };
    const result = await new ContextMemory(service as any).status({ workspace: { id: 'workspace' } } as any);
    expect(result.available).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-adapter-error');
    expect(result.fallback).toContain('keyword');
  });
});
