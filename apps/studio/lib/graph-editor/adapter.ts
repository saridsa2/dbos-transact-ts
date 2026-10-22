import type { CanvasEdge, CanvasNode, HandleSide, Point } from './contracts';
export type EditorNode = Pick<CanvasNode, 'id' | 'name' | 'kind' | 'position' | 'size'>;
export type EditorScene = { nodes: EditorNode[]; edges: CanvasEdge[] };
export type EditorIssue = { message: string; path?: string; severity?: 'error' | 'warning' };
export type DiagramCommand =
  | { type: 'move'; positions: Record<string, Point> }
  | { type: 'delete'; ids: string[] }
  | {
      type: 'connect';
      id: string;
      source: string;
      target: string;
      sourceHandle?: HandleSide;
      targetHandle?: HandleSide;
    }
  | { type: 'reconnect'; id: string; endpoint: 'source' | 'target'; nodeId: string; handle: HandleSide }
  | { type: 'reroute'; id: string }
  | { type: 'arrange' };
/** The core knows geometry and gestures. The adapter owns document semantics and legal edits. */
export interface EditorAdapter<Document, Command = DiagramCommand> {
  readonly id: 'workflow' | 'process';
  readonly routing: 'rope' | 'elbow';
  readonly containers: 'none' | 'structured';
  project(document: Document): EditorScene;
  apply(document: Document, command: Command): Document;
  validate(document: Document): EditorIssue[];
  configuration(document: Document, nodeId: string): { id: string; kind: string } | null;
}
/** Enforce immutable inspection at the command boundary, including domain extensions. */
export function executeEditorCommand<D, C>(adapter: EditorAdapter<D, C>, document: D, command: C, readOnly = false): D {
  if (readOnly) throw new Error('This diagram is read-only.');
  return adapter.apply(document, command);
}
