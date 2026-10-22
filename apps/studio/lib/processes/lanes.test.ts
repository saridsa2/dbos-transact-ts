import { describe, it, expect } from 'vitest';
import { knowledgeFixtures } from '../knowledge/fixtures';
import { migrateProcess, applyProcessCommand, processV2Schema } from './model';
import {
  normalizeProcessLanes,
  processPool,
  changeProcessLanes,
  assignProcessLane,
  resizeProcessLane,
  arrangeProcessLanes,
  processElementSize,
} from './lanes';
import { generateWorkflow } from '../intelligence/generation';
function fixture() {
  return changeProcessLanes(migrateProcess(knowledgeFixtures()[0].process), [
    { id: 'operations', name: 'Operations' },
    { id: 'risk', name: 'Risk', role: 'editor' },
  ]);
}
function inside(doc: ReturnType<typeof fixture>) {
  const pool = processPool(doc)!;
  for (const element of doc.graph.elements) {
    const row = pool.rows.find((r) => r.id === (element.laneId ?? null))!,
      pos = doc.presentation.positions[element.id],
      size = processElementSize(element);
    expect(pos.x).toBeGreaterThanOrEqual(pool.contentLeft);
    expect(pos.y).toBeGreaterThanOrEqual(row.top);
    expect(pos.y + size.height).toBeLessThanOrEqual(row.top + row.height);
    expect(pos.x + size.width).toBeLessThanOrEqual(pool.x + pool.width);
  }
}
describe('process swimlanes', () => {
  it('retains empty lanes and displays unassigned elements within one shared pool', () => {
    const doc = fixture(),
      pool = processPool(doc)!;
    expect(pool.rows.map((r) => [r.id, r.count])).toEqual([
      ['operations', 0],
      ['risk', 0],
      [null, 3],
    ]);
    expect(pool.rows[1].top).toBe(pool.rows[0].top + pool.rows[0].height);
    expect(pool.rows[2].top).toBe(pool.rows[1].top + pool.rows[1].height);
    inside(doc);
  });
  it('normalizes old responsibility annotations without mutating the saved document', () => {
    const original = migrateProcess(knowledgeFixtures()[0].process);
    original.lanes = [{ id: 'operations', name: 'Operations' }];
    original.graph.elements[1].laneId = 'operations';
    const before = structuredClone(original),
      doc = normalizeProcessLanes(original);
    expect(original).toEqual(before);
    expect(doc.graph).toEqual(before.graph);
    expect(normalizeProcessLanes(doc)).toEqual(doc);
    expect(processV2Schema.parse(doc)).toEqual(doc);
    inside(doc);
  });
  it('reorders rows while preserving activity offsets, expressions and all connections', () => {
    let doc = assignProcessLane(fixture(), ['calculate'], 'operations');
    doc = assignProcessLane(doc, ['result'], 'risk');
    const before = structuredClone(doc),
      oldPool = processPool(doc)!;
    doc = changeProcessLanes(doc, [...doc.lanes!].reverse());
    const pool = processPool(doc)!;
    expect(doc.graph).toEqual(before.graph);
    for (const n of doc.graph.elements) {
      const oldRow = oldPool.rows.find((r) => r.id === (n.laneId ?? null))!,
        row = pool.rows.find((r) => r.id === (n.laneId ?? null))!;
      expect(doc.presentation.positions[n.id].y - row.top).toBe(before.presentation.positions[n.id].y - oldRow.top);
    }
    inside(doc);
  });
  it('resizes one row and shifts every later row and its activities together', () => {
    let doc = assignProcessLane(fixture(), ['calculate'], 'operations');
    doc = assignProcessLane(doc, ['result'], 'risk');
    const before = structuredClone(doc);
    doc = resizeProcessLane(doc, 'operations', 520);
    expect(doc.presentation.positions.result.y - before.presentation.positions.result.y).toBe(200);
    expect(doc.presentation.positions.calculate).toEqual(before.presentation.positions.calculate);
    expect(doc.graph).toEqual(before.graph);
    expect(resizeProcessLane(doc, 'operations', 10).presentation.pool!.heights.operations).toBe(280);
    inside(doc);
  });
  it('assigns a dragged activity by its center and preserves executable content', () => {
    const before = assignProcessLane(fixture(), ['calculate'], 'operations'),
      pool = processPool(before)!,
      risk = pool.rows.find((r) => r.id === 'risk')!;
    const next = applyProcessCommand(before, {
      type: 'move',
      positions: { calculate: { x: pool.contentLeft + 100, y: risk.top + 80 } },
    });
    expect(next.graph.elements.find((n) => n.id === 'calculate')!.laneId).toBe('risk');
    expect(next.graph.flows).toEqual(before.graph.flows);
    expect((next.graph.elements[1] as any).binding).toEqual((before.graph.elements[1] as any).binding);
    inside(next);
  });
  it('prevents drops over headers and outside lane content, and expands all lane widths together', () => {
    const before = fixture(),
      pool = processPool(before)!;
    const next = applyProcessCommand(before, {
      type: 'move',
      positions: { calculate: { x: pool.x - 100, y: pool.y - 100 } },
    });
    inside(next);
    const wide = applyProcessCommand(next, {
      type: 'move',
      positions: { calculate: { x: pool.x + pool.width + 400, y: pool.rows[2].top + 60 } },
    });
    expect(processPool(wide)!.width).toBeGreaterThan(pool.width);
    inside(wide);
  });
  it('removes a lane without deleting activities or sequence flows', () => {
    const before = assignProcessLane(fixture(), ['calculate'], 'risk'),
      next = changeProcessLanes(
        before,
        before.lanes!.filter((l) => l.id !== 'risk'),
      );
    expect(next.graph.elements.map((n) => n.id)).toEqual(before.graph.elements.map((n) => n.id));
    expect(next.graph.elements[1].laneId).toBeUndefined();
    expect(next.graph.flows).toEqual(before.graph.flows);
    inside(next);
    const none = changeProcessLanes(next, []);
    expect(processPool(none)).toBeNull();
    expect(none.presentation.pool).toBeUndefined();
  });
  it('arranges rank-aligned branches without overlapping activities inside the same lane', () => {
    let doc = fixture();
    doc.graph.elements.push(
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `sibling-${i}`,
        name: `Sibling ${i}`,
        kind: 'activity' as const,
        evidence: [],
        binding: { kind: 'construct' as const, value: { mode: 'fixed' as const, value: i } },
        laneId: 'risk',
      })),
    );
    doc = arrangeProcessLanes(doc);
    inside(doc);
    const ids = doc.graph.elements.filter((n) => n.laneId === 'risk').map((n) => n.id);
    const points = ids.map((id) => doc.presentation.positions[id]);
    expect(new Set(points.map((p) => `${p.x}:${p.y}`)).size).toBe(24);
    expect(processV2Schema.safeParse(doc).success).toBe(true);
  });
  it('keeps executable bindings identical when lane geometry and ordering change', async () => {
    let doc = assignProcessLane(fixture(), ['calculate'], 'operations');
    const old = await generateWorkflow('Lanes', doc, { artifactId: 'p', revisionId: 'r' });
    doc = resizeProcessLane(doc, 'operations', 600);
    doc = changeProcessLanes(doc, [...doc.lanes!].reverse());
    const next = await generateWorkflow('Lanes', doc, { artifactId: 'p', revisionId: 'r' });
    expect(next.flow.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config }))).toEqual(
      old.flow.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config })),
    );
    expect(next.flow.edges).toEqual(old.flow.edges);
    expect(next.manifest.lanes).toEqual(doc.lanes);
  });
  it('rejects hostile lane geometry', () => {
    const doc = fixture();
    doc.presentation.pool!.heights.risk = -20;
    expect(processV2Schema.safeParse(doc).success).toBe(false);
    expect(() => resizeProcessLane(fixture(), 'risk', Infinity)).toThrow();
  });
});
