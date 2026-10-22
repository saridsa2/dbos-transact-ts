'use client';
import type { HTMLAttributes, RefObject } from 'react';
/** Extracted workflow canvas surface. Domain hosts provide state, commands and rendered elements. */
export function GraphSurface({
  boardRef,
  viewport,
  children,
  overlay,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  boardRef: RefObject<HTMLDivElement | null>;
  viewport: { x: number; y: number; zoom: number };
  overlay?: React.ReactNode;
}) {
  return (
    <div {...props} ref={boardRef} role="application">
      {overlay}
      <div
        className="board-world"
        style={{
          transform: `translate(calc(50% + ${viewport.x}px), calc(50% + ${viewport.y}px)) scale(${viewport.zoom})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
