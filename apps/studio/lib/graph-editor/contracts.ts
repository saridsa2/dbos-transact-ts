import type { ComponentType, ReactNode } from 'react';
import type { MessageDescriptor } from '@lingui/core';
export type Point = { x: number; y: number };
export type HandleSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeSource = { nodeId: string; handle: HandleSide } | null;
export type EdgeEndpoint = 'source' | 'target';
export type CanvasStatus = 'idle' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped';
export type CanvasAction = { id: string; labelKey: MessageDescriptor };
export type CanvasNode = {
  id: string;
  kind: string;
  name: string;
  description: string;
  position: Point;
  size: { width: number; height: number };
  icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  chips?: string[];
  issues?: string[];
  readiness?: string;
  body?: ReactNode;
};
export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: HandleSide;
  targetHandle?: HandleSide;
  branch?: { label: string; tone: 'true' | 'false' };
};
export function canvasHandlePoint(node: Pick<CanvasNode, 'position' | 'size'>, side: HandleSide): Point {
  const { x, y } = node.position,
    { width, height } = node.size;
  return side === 'top'
    ? { x: x + width / 2, y }
    : side === 'bottom'
      ? { x: x + width / 2, y: y + height }
      : side === 'left'
        ? { x, y: y + height / 2 }
        : { x: x + width, y: y + height / 2 };
}
export function canvasEdgeEndpoints(edge: CanvasEdge, source: CanvasNode, target: CanvasNode) {
  return {
    source: canvasHandlePoint(source, edge.sourceHandle ?? 'right'),
    target: canvasHandlePoint(target, edge.targetHandle ?? 'left'),
  };
}
export function screenPoint(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  viewport: Point & { zoom: number },
) {
  return {
    x: (client.x - rect.left - rect.width / 2 - viewport.x) / viewport.zoom,
    y: (client.y - rect.top - rect.height / 2 - viewport.y) / viewport.zoom,
  };
}
