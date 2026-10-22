'use client';
import type { ComponentProps } from 'react';
import { GraphSurface } from '@/components/graph-editor/graph-surface';
import { BoardNode, EdgeLayer } from '@/components/graph-editor/elements';
import type { DiagramNodeProps, DiagramEdgeProps, DiagramSurfaceProps } from '@/components/graph-editor/renderer-props';
import type { CanvasNode } from '@/lib/graph-editor/contracts';
import type { EditorNode } from '@/lib/graph-editor/adapter';
import { workflowEditorAdapter, type WorkflowDiagram } from '@/lib/flows/editor-adapter';
/** Workflow rendering owns a free-form world with one node layer. */
export function WorkflowRenderer({
  document,
  surfaceProps,
  decorateNode,
  nodeProps,
  edgeProps,
  readOnly = false,
}: {
  document: WorkflowDiagram;
  surfaceProps: DiagramSurfaceProps;
  decorateNode: (node: EditorNode) => CanvasNode;
  nodeProps: (id: string) => DiagramNodeProps;
  edgeProps: DiagramEdgeProps;
  readOnly?: boolean;
}) {
  const scene = workflowEditorAdapter.project(document),
    nodes = scene.nodes.map((n) => ({ ...decorateNode(n), ...n }));
  return (
    <GraphSurface {...surfaceProps} data-renderer="workflow">
      <EdgeLayer {...edgeProps} nodes={nodes} edges={scene.edges} routing="rope" readOnly={readOnly} />
      <div className="node-layer">
        {nodes.map((node) => (
          <BoardNode key={node.id} {...nodeProps(node.id)} node={node} readOnly={readOnly} />
        ))}
      </div>
    </GraphSurface>
  );
}
