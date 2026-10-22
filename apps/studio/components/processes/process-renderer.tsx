'use client';
import { useEffect, useState, type ComponentProps } from 'react';
import { BoardNode, EdgeLayer } from '@/components/graph-editor/elements';
import type { DiagramNodeProps, DiagramEdgeProps, DiagramSurfaceProps } from '@/components/graph-editor/renderer-props';
import type { CanvasNode } from '@/lib/graph-editor/contracts';
import type { ProcessDocument } from '@/lib/processes/model';
import { processEditorAdapter } from '@/lib/processes/editor-adapter';
import { processCanvasRegions } from '@/lib/processes/canvas-layout';
import { ProcessSwimlanes } from './process-swimlanes';
/** Process rendering owns the partitioned pool and lane-local activity trees. */
export function ProcessRenderer({
  document,
  surfaceProps,
  nodes,
  nodeProps,
  edgeProps,
  laneProps,
  readOnly = false,
}: {
  document: ProcessDocument;
  surfaceProps: DiagramSurfaceProps;
  nodes: CanvasNode[];
  nodeProps: (id: string) => DiagramNodeProps;
  edgeProps: DiagramEdgeProps;
  laneProps: Omit<ComponentProps<typeof ProcessSwimlanes>, 'document' | 'readOnly' | 'renderActivities' | 'sheetSize'>;
  readOnly?: boolean;
}) {
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const board = surfaceProps.boardRef.current;
    if (!board) return;
    const update = () => setAvailable({ width: board.clientWidth, height: board.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(board);
    return () => observer.disconnect();
  }, [surfaceProps.boardRef]);
  const { regions, pool } = processCanvasRegions(document, nodes),
    scene = processEditorAdapter.project(document);
  const { boardRef, viewport, overlay, ...attributes } = surfaceProps;
  const width = Math.max(pool.width, available.width / viewport.zoom),
    height = Math.max(pool.height, available.height / viewport.zoom);
  const origin = { x: pool.x, y: pool.y };
  const sheetNodes = nodes.map((node) => ({
    ...node,
    position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
  }));
  const preview = edgeProps.connectionPreview;
  const sheetEdges = {
    ...edgeProps,
    connectionPreview: preview
      ? {
          source: { x: preview.source.x - origin.x, y: preview.source.y - origin.y },
          target: { x: preview.target.x - origin.x, y: preview.target.y - origin.y },
        }
      : null,
  };
  return (
    <div {...attributes} ref={boardRef} role="application" data-renderer="process" className="process-scroll-surface">
      {overlay}
      <div className="process-sheet-extent" style={{ width: width * viewport.zoom, height: height * viewport.zoom }}>
        <div className="process-sheet" style={{ width, height, transform: `scale(${viewport.zoom})` }}>
          <ProcessSwimlanes
            {...laneProps}
            document={document}
            sheetSize={{ width, height }}
            readOnly={readOnly}
            renderActivities={(row) =>
              regions
                .find((r) => r.id === row.id)!
                .nodes.map((node) => (
                  <BoardNode key={node.id} {...nodeProps(node.id)} node={node} readOnly={readOnly} />
                ))
            }
          />
          <EdgeLayer {...sheetEdges} nodes={sheetNodes} edges={scene.edges} routing="elbow" readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}
