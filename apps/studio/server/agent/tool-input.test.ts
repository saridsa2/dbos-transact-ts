import { describe, it, expect, vi } from 'vitest';
import { normalizeToolInput } from './tool-input';
import { toolArguments } from '../../lib/agent/contracts';
import { runAgentTool, modelTools } from './tools';
const ontology = { schemaVersion: 1, description: 'Banking', entities: [], relationships: [] };
const args = { id: crypto.randomUUID(), expectedVersion: 2, summary: 'Define banking', content: ontology };
describe('ontology proposal input contract', () => {
  it('advertises a complete ontology object instead of an unconstrained value', () => {
    const tool = modelTools.find((t) => t.function.name === 'ontology_propose_v1')!;
    expect((tool.function.parameters as any).properties.content.type).toBe('object');
    expect(toolArguments.ontology_propose_v1.safeParse({ ...args, content: 'not an object' }).success).toBe(false);
  });
  it('accepts a single JSON encoding then validates every ontology field', () => {
    const original = { ...args, content: JSON.stringify(ontology) };
    expect(
      toolArguments.ontology_propose_v1.parse(normalizeToolInput('ontology_propose_v1', original)).content,
    ).toEqual(ontology);
    expect(typeof original.content).toBe('string');
    for (const content of ['broken', '[]', 'null', JSON.stringify(JSON.stringify(ontology))])
      expect(() => normalizeToolInput('ontology_propose_v1', { ...args, content })).toThrow('content:');
    expect(() =>
      toolArguments.ontology_propose_v1.parse(
        normalizeToolInput('ontology_propose_v1', { ...args, content: '{"schemaVersion":1}' }),
      ),
    ).toThrow();
  });
  it('stages decoded content without applying changes and keeps stale revision checks', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service: any = {
      knowledge: {
        get: vi.fn().mockResolvedValue({ artifact: { kind: 'ontology', editVersion: 2 } }),
        validate: vi.fn().mockImplementation(async (_ctx, _kind, content) => ({ content })),
      },
      pool: { query },
    };
    const ctx: any = { workspace: { id: crypto.randomUUID() } };
    const result = await runAgentTool(service, {} as any, ctx, crypto.randomUUID(), 'ontology_propose_v1', {
      ...args,
      content: JSON.stringify(ontology),
    });
    expect(result).toHaveProperty('proposalId');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1][5]).toEqual(ontology);
    query.mockClear();
    await expect(
      runAgentTool(service, {} as any, ctx, crypto.randomUUID(), 'ontology_propose_v1', {
        ...args,
        expectedVersion: 1,
      }),
    ).rejects.toThrow('Ontology changed');
    expect(query).not.toHaveBeenCalled();
  });
});
