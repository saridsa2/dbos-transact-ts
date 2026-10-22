'use client';
import { useRef, useState } from 'react';
import type { Point } from '@/lib/graph-editor/contracts';
import { processSheetPoint } from '@/lib/processes/workspace-coordinates';
/** A document scroller with explicit zoom. Wheel/trackpad gestures remain native scrolling. */
export function useProcessViewport(origin: Point) {
  const boardRef = useRef<HTMLDivElement | null>(null),
    [zoom, setZoom] = useState(1);
  const screenToWorld = (x: number, y: number) => {
    const board = boardRef.current;
    if (!board) return origin;
    return processSheetPoint(
      { x, y },
      board.getBoundingClientRect(),
      { x: board.scrollLeft, y: board.scrollTop },
      zoom,
      origin,
    );
  };
  const zoomBy = (delta: number) =>
    setZoom((current) => Math.max(0.5, Math.min(1.5, Math.round((current + delta) * 100) / 100)));
  const fit = () => {
    setZoom(1);
    boardRef.current?.scrollTo({ left: 0, top: 0 });
  };
  return { boardRef, viewport: { x: 0, y: 0, zoom }, screenToWorld, zoomBy, fit };
}
