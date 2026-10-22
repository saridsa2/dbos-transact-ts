import type { ProcessDocument, ProcessElement } from './model';
import { layoutPositions } from '../graph-editor/layout';
export const LANE_MIN_HEIGHT = 280;
export const LANE_DEFAULT_HEIGHT = 320;
export const POOL_TITLE_WIDTH = 44;
export const LANE_HEADER_WIDTH = 168;
const PAD = 36;
export type ProcessLane = NonNullable<ProcessDocument['lanes']>[number];
export type PoolRow = { id: string | null; name: string; role?: string; top: number; height: number; count: number };
export function processElementSize(element: ProcessElement) {
  return { width: 284, height: element.kind === 'activity' && element.binding.kind === 'requirement' ? 214 : 142 };
}
/** Lanes share one pool boundary. Geometry never changes sequence flow or activity bindings. */
export function processPool(document: ProcessDocument) {
  if (!document.lanes?.length) return null;
  const elements = document.graph.elements;
  const positions = elements.map((n) => document.presentation.positions[n.id] ?? { x: 0, y: 0 });
  const geometry = document.presentation.pool;
  const x =
    geometry?.x ??
    Math.max(-100000, Math.min(0, ...positions.map((p) => p.x)) - POOL_TITLE_WIDTH - LANE_HEADER_WIDTH - PAD);
  const y = geometry?.y ?? Math.max(-100000, Math.min(-160, ...positions.map((p) => p.y)) - PAD);
  const contentLeft = x + POOL_TITLE_WIDTH + LANE_HEADER_WIDTH;
  const width = Math.max(
    geometry?.width ?? 1100,
    ...elements.map((n) => (document.presentation.positions[n.id]?.x ?? 0) + processElementSize(n).width + PAD - x),
  );
  const rows: PoolRow[] = document.lanes.map((lane) => ({
    ...lane,
    top: 0,
    height: Math.max(LANE_MIN_HEIGHT, geometry?.heights[lane.id] ?? LANE_DEFAULT_HEIGHT),
    count: elements.filter((n) => n.laneId === lane.id).length,
  }));
  const unassigned = elements.filter((n) => !n.laneId || !document.lanes!.some((l) => l.id === n.laneId));
  if (unassigned.length)
    rows.push({
      id: null,
      name: 'Unassigned',
      top: 0,
      height: Math.max(LANE_MIN_HEIGHT, geometry?.unassignedHeight ?? LANE_DEFAULT_HEIGHT),
      count: unassigned.length,
    });
  let top = y;
  for (const row of rows) {
    row.top = top;
    top += row.height;
  }
  return { x, y, width, height: top - y, contentLeft, rows };
}
function rowFor(document: ProcessDocument, rows: PoolRow[], element: ProcessElement) {
  return rows.find((row) => row.id === (document.lanes?.some((l) => l.id === element.laneId) ? element.laneId : null));
}
function constrain(position: { x: number; y: number }, element: ProcessElement, row: PoolRow, contentLeft: number) {
  const size = processElementSize(element);
  return {
    x: Math.max(contentLeft + PAD, Math.round(position.x)),
    y: Math.round(Math.max(row.top + PAD, Math.min(row.top + row.height - PAD - size.height, position.y))),
  };
}
/** Old documents get a deterministic view projection. No saved revision is written on read. */
export function normalizeProcessLanes(document: ProcessDocument): ProcessDocument {
  const next = structuredClone(document),
    pool = processPool(next);
  if (!pool) return next;
  next.presentation.pool = {
    x: pool.x,
    y: pool.y,
    width: pool.width,
    heights: Object.fromEntries(pool.rows.filter((r) => r.id !== null).map((r) => [r.id!, r.height])),
    ...(pool.rows.some((r) => r.id === null) ? { unassignedHeight: pool.rows.find((r) => r.id === null)!.height } : {}),
  };
  for (const element of next.graph.elements) {
    const row = rowFor(next, pool.rows, element)!;
    const position = next.presentation.positions[element.id] ?? {
      x: pool.contentLeft + PAD,
      y: row.top + (row.height - processElementSize(element).height) / 2,
    };
    next.presentation.positions[element.id] = constrain(position, element, row, pool.contentLeft);
  }
  next.presentation.pool.width = Math.max(
    pool.width,
    ...next.graph.elements.map((n) => next.presentation.positions[n.id].x + processElementSize(n).width + PAD - pool.x),
  );
  return next;
}
export function changeProcessLanes(document: ProcessDocument, lanes: ProcessLane[]): ProcessDocument {
  const before = normalizeProcessLanes(document),
    oldPool = processPool(before),
    next = structuredClone(before);
  next.lanes = structuredClone(lanes);
  for (const element of next.graph.elements)
    if (element.laneId && !lanes.some((l) => l.id === element.laneId)) delete element.laneId;
  if (!lanes.length) {
    delete next.presentation.pool;
    return next;
  }
  const pool = processPool(next)!;
  for (const element of next.graph.elements) {
    const oldRow = oldPool
      ? rowFor(before, oldPool.rows, before.graph.elements.find((n) => n.id === element.id)!)
      : undefined;
    const row = rowFor(next, pool.rows, element)!;
    const position = before.presentation.positions[element.id] ?? { x: pool.contentLeft + PAD, y: 0 };
    next.presentation.positions[element.id] = {
      x: position.x,
      y: oldRow ? row.top + position.y - oldRow.top : row.top + (row.height - processElementSize(element).height) / 2,
    };
  }
  return normalizeProcessLanes(next);
}
export function assignProcessLane(document: ProcessDocument, ids: string[], laneId: string | null): ProcessDocument {
  if (laneId !== null && !document.lanes?.some((l) => l.id === laneId))
    throw new Error('Responsibility lane not found.');
  const before = normalizeProcessLanes(document),
    oldPool = processPool(before),
    next = structuredClone(before);
  for (const element of next.graph.elements)
    if (ids.includes(element.id)) {
      if (laneId === null) delete element.laneId;
      else element.laneId = laneId;
    }
  const pool = processPool(next);
  if (pool)
    for (const element of next.graph.elements) {
      const oldRow = oldPool
        ? rowFor(before, oldPool.rows, before.graph.elements.find((n) => n.id === element.id)!)
        : undefined;
      const row = rowFor(next, pool.rows, element)!;
      const position = before.presentation.positions[element.id] ?? { x: pool.contentLeft + PAD, y: 0 };
      next.presentation.positions[element.id] = {
        x: position.x,
        y: ids.includes(element.id)
          ? row.top + (row.height - processElementSize(element).height) / 2
          : row.top + position.y - (oldRow?.top ?? row.top),
      };
    }
  return normalizeProcessLanes(next);
}
export function resizeProcessLane(document: ProcessDocument, laneId: string | null, height: number): ProcessDocument {
  if (!Number.isFinite(height)) throw new Error('Lane height must be finite.');
  const before = normalizeProcessLanes(document),
    oldPool = processPool(before);
  if (!oldPool?.rows.some((r) => r.id === laneId)) throw new Error('Responsibility lane not found.');
  const next = structuredClone(before),
    geometry = next.presentation.pool!;
  const bounded = Math.max(LANE_MIN_HEIGHT, Math.min(3000, Math.round(height)));
  if (laneId === null) geometry.unassignedHeight = bounded;
  else geometry.heights[laneId] = bounded;
  const pool = processPool(next)!;
  for (const element of next.graph.elements) {
    const oldRow = rowFor(before, oldPool.rows, element)!,
      row = rowFor(next, pool.rows, element)!;
    next.presentation.positions[element.id].y += row.top - oldRow.top;
  }
  return normalizeProcessLanes(next);
}
/** A drag changes membership only when the card's center enters a different lane. */
export function moveProcessNodes(before: ProcessDocument, next: ProcessDocument, ids: string[]): ProcessDocument {
  const pool = processPool(before);
  if (!pool) return next;
  for (const element of next.graph.elements)
    if (ids.includes(element.id)) {
      const position = next.presentation.positions[element.id],
        center = position.y + processElementSize(element).height / 2;
      const row =
        pool.rows.find((r) => center >= r.top && center < r.top + r.height) ?? rowFor(before, pool.rows, element)!;
      if (row.id === null) delete element.laneId;
      else element.laneId = row.id;
      next.presentation.positions[element.id] = constrain(position, element, row, pool.contentLeft);
    }
  return normalizeProcessLanes(next);
}
export function arrangeProcessLanes(document: ProcessDocument): ProcessDocument {
  let next = normalizeProcessLanes(document);
  const positions = layoutPositions(
      next.graph.elements.map((n) => n.id),
      next.graph.flows,
    ),
    pool = processPool(next);
  if (!pool)
    return {
      ...next,
      presentation: {
        ...next.presentation,
        positions: Object.fromEntries(
          Object.entries(positions).map(([id, p]) => [
            id,
            { x: p.x - 142, y: p.y - processElementSize(next.graph.elements.find((n) => n.id === id)!).height / 2 },
          ]),
        ),
      },
    };
  const ranks = [...new Set(Object.values(positions).map((p) => p.x))].sort((a, b) => a - b);
  const maximumByRank = new Map<number, number>();
  const slotsByLane = new Map<string | null, Map<string, { rank: number; slot: number }>>();
  for (const row of pool.rows) {
    const occupied = new Map<number, number>(),
      slots = new Map<string, { rank: number; slot: number }>();
    for (const element of next.graph.elements.filter((n) => rowFor(next, pool.rows, n)?.id === row.id)) {
      const rank = positions[element.id]?.x ?? 0,
        slot = occupied.get(rank) ?? 0;
      occupied.set(rank, slot + 1);
      slots.set(element.id, { rank, slot });
      maximumByRank.set(rank, Math.max(maximumByRank.get(rank) ?? 0, slot + 1));
    }
    slotsByLane.set(row.id, slots);
    const height = Math.max(LANE_DEFAULT_HEIGHT, PAD * 2 + Math.min(10, Math.max(1, ...occupied.values())) * 250);
    if (row.id === null) next.presentation.pool!.unassignedHeight = height;
    else next.presentation.pool!.heights[row.id] = height;
  }
  const offsets = new Map<number, number>();
  let x = 0;
  for (const rank of ranks) {
    offsets.set(rank, x);
    x += 390 * Math.max(1, Math.ceil((maximumByRank.get(rank) ?? 1) / 10));
  }
  const arranged = processPool(next)!;
  for (const row of arranged.rows)
    for (const [id, { rank, slot }] of slotsByLane.get(row.id) ?? []) {
      next.presentation.positions[id] = {
        x: arranged.contentLeft + PAD + (offsets.get(rank) ?? 0) + Math.floor(slot / 10) * 390,
        y: row.top + PAD + (slot % 10) * 250,
      };
    }
  return normalizeProcessLanes(next);
}
