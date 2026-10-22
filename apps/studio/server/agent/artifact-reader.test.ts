import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { readArtifact } from './artifact-reader';
import { artifactReadSchema } from '../../lib/agent/artifact-reading';
import { runAgentTool } from './tools';
const source = readFileSync(new URL('../fixtures/rdf/w3c-org.rdf', import.meta.url), 'utf8');
const artifactId = crypto.randomUUID(),
  revisionId = crypto.randomUUID();
function record(text = source, kind = 'source', content?: unknown): any {
  return {
    artifact: { id: artifactId, name: 'W3C ORG', kind, revisionId, editVersion: 2 },
    revision: {
      id: revisionId,
      reviewed: true,
      contentHash: 'hash',
      content: content ?? { schemaVersion: 1, mediaType: 'text/plain', text },
    },
  };
}
const read = (item: any, args: object = {}, blocks: any[] = []) =>
  readArtifact(item, artifactReadSchema.parse({ id: artifactId, ...args }), blocks) as any;
describe('large artifact reading (issue #4)', () => {
  it('returns a usable index instead of rejecting original W3C ORG', () => {
    expect(Buffer.byteLength(source)).toBeGreaterThan(64000);
    const p = read(record());
    expect(p.page.view).toBe('summary');
    expect(p.availableViews).toContain('search');
    expect(p.warnings.join(' ')).toContain('Only metadata');
    expect(p).not.toHaveProperty('error');
  });
  it('reconstructs every source character through revision-pinned bounded continuation', () => {
    let args: any = { view: 'text', limit: 8000 },
      joined = '',
      pages = 0;
    do {
      const p = read(record(), args);
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(24000);
      expect(p.revision.id).toBe(revisionId);
      joined += p.page.text;
      args = p.continuation;
      pages++;
    } while (args && pages < 100);
    expect(args).toBeNull();
    expect(pages).toBeGreaterThan(1);
    expect(joined).toBe(source.replace(/\r\n?/g, '\n'));
  });
  it('exposes entity/property structure without repeating embedded RDF', () => {
    const index = read(record(), { view: 'entities', limit: 8000 });
    const entities = JSON.parse(index.page.text);
    expect(entities).toHaveLength(9);
    const org = entities.find((e: any) => e.id === 'organization');
    const detail = read(record(), { view: 'entity', entityId: org.id, limit: 8000 });
    expect(detail.summary.entityCount).toBe(9);
    expect(JSON.parse(detail.page.text).entity.properties.length).toBeGreaterThan(0);
    expect(detail.page.text).not.toContain('rdfSource');
    expect(read(record(), { view: 'entity', entityId: org.id, limit: 8000 }).page.text).toBe(detail.page.text);
    expect(detail.warnings.join(' ')).toContain('supported RDF subset');
  });
  it('searches literal text with exact offsets and source-block evidence, without inventing complete coverage', () => {
    const text = 'İ prefix [org] first\n\n[org] second';
    const blocks = [
      { id: 'block-1', ordinal: 0, text: 'İ prefix [org] first' },
      { id: 'block-2', ordinal: 1, text: '[org] second' },
    ];
    const p = read(record(text), { view: 'search', query: '[org]', limit: 6 }, blocks);
    expect(p.page.offset).toBe(text.indexOf('[org]'));
    expect(p.page.complete).toBe(false);
    expect(p.evidence).toEqual([{ kind: 'source', revisionId, blockId: 'block-1' }]);
    const next = read(record(text), p.continuation, blocks);
    expect(next.evidence[0].blockId).toBe('block-2');
    expect(read(record(text), { view: 'search', query: 'not here' }).page.text).toBe('');
  });
  it('reads oversized individual entities and Unicode without losing content', () => {
    const content = {
      schemaVersion: 1,
      description: '',
      entities: [{ id: 'large', name: 'Large', description: '😀'.repeat(20000), properties: [], evidence: [] }],
      relationships: [],
    };
    let args: any = { view: 'entity', entityId: 'large', limit: 8000 },
      joined = '';
    do {
      const p = read(record('', 'ontology', content), args);
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(24000);
      joined += p.page.text;
      args = p.continuation;
    } while (args);
    expect(JSON.parse(joined).entity.description).toBe(content.entities[0].description);
  });
  it('keeps small auto reads compatible and rejects unsupported selections', () => {
    const r = record('Small source');
    expect(read(r)).toBe(r);
    expect(() => read(record(), { view: 'entity', entityId: 'missing' })).toThrow('Entity not found');
    expect(() => read(record('<!DOCTYPE rdf><rdf/>'), { view: 'structure' })).toThrow('DTD');
    expect(() => artifactReadSchema.parse({ id: artifactId, view: 'search' })).toThrow();
    expect(() => read(r, { view: 'structure' })).toThrow('text/search');
  });
  it('looks up authorized immutable revisions before paging and validates the page tool output', async () => {
    const get = vi.fn().mockResolvedValue(record()),
      blocks = vi.fn().mockResolvedValue([{ id: 'block-1', ordinal: 0, text: source }]);
    const service: any = { knowledge: { get, blocks } };
    const ctx: any = { workspace: { id: 'workspace-a' } };
    const p: any = await runAgentTool(service, {} as any, ctx, crypto.randomUUID(), 'artifact_read_v1', {
      id: artifactId,
      revisionId,
      view: 'text',
      limit: 4000,
    });
    expect(get).toHaveBeenCalledWith(ctx, artifactId, revisionId);
    expect(blocks).toHaveBeenCalledWith(ctx, artifactId, revisionId);
    expect(p.page.nextOffset).toBeGreaterThan(0);
    get.mockRejectedValue(new Error('Artifact not found.'));
    await expect(
      runAgentTool(service, {} as any, ctx, crypto.randomUUID(), 'artifact_read_v1', { id: artifactId, revisionId }),
    ).rejects.toThrow('not found');
  });
});
