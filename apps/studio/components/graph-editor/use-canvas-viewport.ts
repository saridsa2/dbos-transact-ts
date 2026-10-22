'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { screenPoint } from '@/lib/graph-editor/contracts';
/** Existing workflow coordinate system and anchored wheel zoom, shared with processes. */
export function useCanvasViewport() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.86 });
  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, delta: number) =>
      setViewport((current) => {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return current;
        const nextZoom = Math.max(0.42, Math.min(1.9, current.zoom + delta));
        const p = screenPoint({ x: clientX, y: clientY }, rect, current);
        return {
          zoom: nextZoom,
          x: clientX - rect.left - rect.width / 2 - p.x * nextZoom,
          y: clientY - rect.top - rect.height / 2 - p.y * nextZoom,
        };
      }),
    [],
  );
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAtPoint(e.clientX, e.clientY, e.deltaY > 0 ? -0.08 : 0.08);
    };
    board.addEventListener('wheel', wheel, { passive: false });
    return () => board.removeEventListener('wheel', wheel);
  });
  const screenToWorld = (x: number, y: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    return rect ? screenPoint({ x, y }, rect, viewport) : { x: 0, y: 0 };
  };
  const zoomBy = (delta: number) => setViewport((p) => ({ ...p, zoom: Math.max(0.42, Math.min(1.9, p.zoom + delta)) }));
  const fit = () => setViewport({ x: 0, y: 0, zoom: 0.86 });
  return { boardRef, viewport, setViewport, screenToWorld, zoomAtPoint, zoomBy, fit };
}
