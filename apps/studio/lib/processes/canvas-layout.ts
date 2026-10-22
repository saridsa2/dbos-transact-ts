import type { CanvasNode } from '../graph-editor/contracts';
import type { ProcessDocument } from './model';
import {
  processPool,
  processElementSize,
  POOL_TITLE_WIDTH,
  LANE_HEADER_WIDTH,
  LANE_DEFAULT_HEIGHT,
  type PoolRow,
} from './lanes';
/** Every process canvas has a responsibility region, even before explicit lanes are added. */
export function processCanvasPool(document: ProcessDocument) {
  const declared = processPool(document);
  if (declared) return { ...declared, explicit: true };
  const elements = document.graph.elements,
    positions = elements.map((n) => document.presentation.positions[n.id] ?? { x: 0, y: 0 });
  const left = Math.min(0, ...positions.map((p) => p.x)) - 36,
    top = Math.min(0, ...positions.map((p) => p.y)) - 36;
  const x = left - POOL_TITLE_WIDTH - LANE_HEADER_WIDTH,
    width = Math.max(1100, ...elements.map((n, i) => positions[i].x + processElementSize(n).width + 36 - x));
  const height = Math.max(
    LANE_DEFAULT_HEIGHT,
    ...elements.map((n, i) => positions[i].y + processElementSize(n).height + 36 - top),
  );
  return {
    x,
    y: top,
    width,
    height,
    contentLeft: left,
    rows: [{ id: null, name: 'Unassigned', top, height, count: elements.length } satisfies PoolRow],
    explicit: false,
  };
}
/** Partition membership comes from domain assignment; coordinates become local to that region. */
export function processCanvasRegions(document: ProcessDocument, nodes: CanvasNode[]) {
  const pool = processCanvasPool(document);
  const regions = pool.rows.map((row) => ({
    ...row,
    origin: { x: pool.contentLeft, y: row.top },
    nodes: [] as CanvasNode[],
  }));
  for (const node of nodes) {
    const element = document.graph.elements.find((e) => e.id === node.id);
    const region = regions.find((r) => r.id === (element?.laneId ?? null)) ?? regions.find((r) => r.id === null);
    if (!region) throw new Error(`No process region for activity ${node.id}.`);
    region.nodes.push({
      ...node,
      position: { x: node.position.x - region.origin.x, y: node.position.y - region.origin.y },
    });
  }
  return { pool, regions };
}
