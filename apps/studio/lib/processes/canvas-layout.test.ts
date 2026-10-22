import { describe, it, expect } from 'vitest';
import { processCanvasPool, processCanvasRegions } from './canvas-layout';
import { migrateProcess } from './model';
import { knowledgeFixtures } from '../knowledge/fixtures';
import { changeProcessLanes, assignProcessLane, resizeProcessLane } from './lanes';
import { processEditorAdapter } from './editor-adapter';
import type { CanvasNode } from '../graph-editor/contracts';
const fixture = () =>
  changeProcessLanes(migrateProcess(knowledgeFixtures()[0].process), [
    { id: 'operations', name: 'Operations' },
    { id: 'risk', name: 'Risk' },
  ]);
const nodes = (doc: ReturnType<typeof fixture>) =>
  processEditorAdapter
    .project(doc)
    .nodes.map((n) => ({ ...n, description: '', icon: () => null, color: '#444', bg: '#fff' }) satisfies CanvasNode);
describe('partitioned process canvas', () => {
  it('gives each activity exactly one responsibility region and local coordinates that roundtrip to world coordinates', () => {
    const doc = assignProcessLane(fixture(), ['calculate'], 'risk'),
      scene = nodes(doc),
      { pool, regions } = processCanvasRegions(doc, scene);
    expect(pool.explicit).toBe(true);
    expect(regions[0].nodes).toHaveLength(0);
    expect(regions[1].nodes.map((n) => n.id)).toEqual(['calculate']);
    expect(
      regions
        .flatMap((r) => r.nodes)
        .map((n) => n.id)
        .sort(),
    ).toEqual(scene.map((n) => n.id).sort());
    for (const r of regions)
      for (const n of r.nodes) {
        expect({ x: n.position.x + r.origin.x, y: n.position.y + r.origin.y }).toEqual(
          scene.find((s) => s.id === n.id)!.position,
        );
      }
    expect(scene.map((n) => ({ id: n.id, position: n.position }))).toEqual(
      nodes(doc).map((n) => ({ id: n.id, position: n.position })),
    );
  });
  it('moves region ownership on reassignment without changing flow endpoints or executable bindings', () => {
    const before = assignProcessLane(fixture(), ['calculate'], 'operations'),
      after = assignProcessLane(before, ['calculate'], 'risk');
    expect(processCanvasRegions(before, nodes(before)).regions[0].nodes.map((n) => n.id)).toContain('calculate');
    expect(processCanvasRegions(after, nodes(after)).regions[1].nodes.map((n) => n.id)).toContain('calculate');
    expect(before.graph.flows).toEqual(after.graph.flows);
    expect(before.graph.elements.find((n) => n.id === 'calculate')?.kind).toBe(
      after.graph.elements.find((n) => n.id === 'calculate')?.kind,
    );
  });
  it('resizes shared lane boundaries while local activity placement remains stable', () => {
    const before = assignProcessLane(fixture(), ['calculate'], 'risk'),
      after = resizeProcessLane(before, 'operations', 500);
    const a = processCanvasRegions(before, nodes(before)).regions.find((r) => r.id === 'risk')!,
      b = processCanvasRegions(after, nodes(after)).regions.find((r) => r.id === 'risk')!;
    expect(b.origin.y).toBeGreaterThan(a.origin.y);
    expect(b.nodes[0].position).toEqual(a.nodes[0].position);
  });
  it('renders legacy lane-free documents in an implicit Unassigned region without changing persisted positions', () => {
    const doc = migrateProcess(knowledgeFixtures()[0].process),
      before = structuredClone(doc),
      { pool, regions } = processCanvasRegions(doc, nodes(doc));
    expect(pool.explicit).toBe(false);
    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBeNull();
    expect(regions[0].nodes).toHaveLength(doc.graph.elements.length);
    expect(doc).toEqual(before);
    for (const n of nodes(doc)) {
      expect(n.position.x).toBeGreaterThanOrEqual(pool.contentLeft);
      expect(n.position.y).toBeGreaterThanOrEqual(pool.y);
    }
  });
  it('keeps the partition canvas available with no activities', () => {
    const doc = fixture();
    doc.graph.elements = [];
    doc.graph.flows = [];
    expect(processCanvasPool(doc).rows).toHaveLength(2);
    expect(processCanvasRegions(doc, []).regions.every((r) => !r.nodes.length)).toBe(true);
  });
});
