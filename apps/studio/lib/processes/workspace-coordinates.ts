import type { Point } from '../graph-editor/contracts';
/** Process coordinates are relative to a scrolling sheet, never a centered/panned world. */
export function processSheetPoint(
  client: Point,
  rect: { left: number; top: number },
  scroll: Point,
  zoom: number,
  origin: Point,
): Point {
  return {
    x: (client.x - rect.left + scroll.x) / zoom + origin.x,
    y: (client.y - rect.top + scroll.y) / zoom + origin.y,
  };
}
