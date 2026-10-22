import type { EditorAdapter, DiagramCommand } from '../graph-editor/adapter';
import { layoutPositions } from '../graph-editor/layout';
import { edgeBranch } from './edge-branch';
import type { AgentFlow, FlowNodeKind } from './types';
export type WorkflowDiagram = Pick<AgentFlow, 'nodes' | 'edges'>;
const sizes: Partial<Record<FlowNodeKind, { width: number; height: number }>> = {
  trigger: { width: 270, height: 126 },
  prompt: { width: 300, height: 154 },
  llm: { width: 320, height: 210 },
  tool: { width: 300, height: 176 },
  condition: { width: 284, height: 142 },
  approval: { width: 292, height: 142 },
  output: { width: 310, height: 172 },
};
export const workflowNodeSize = (kind: FlowNodeKind) => sizes[kind] ?? { width: 284, height: 142 };
export const workflowEditorAdapter: EditorAdapter<WorkflowDiagram> = {
  id: 'workflow',
  routing: 'rope',
  containers: 'none',
  project: (document) => ({
    nodes: document.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      position: n.position,
      size: workflowNodeSize(n.kind),
    })),
    edges: document.edges.map((e) => ({
      ...e,
      branch: edgeBranch(e.condition, document.nodes.find((n) => n.id === e.source)?.kind) ?? undefined,
    })),
  }),
  configuration: (document, id) => {
    const n = document.nodes.find((n) => n.id === id);
    return n ? { id: n.id, kind: n.kind } : null;
  },
  validate: (document) =>
    document.edges
      .filter((e) => !document.nodes.some((n) => n.id === e.source) || !document.nodes.some((n) => n.id === e.target))
      .map((e) => ({ path: `edges.${e.id}`, message: 'Connection references a missing node.', severity: 'error' })),
  apply(document, command) {
    const next = structuredClone(document),
      node = (id: string) => {
        const n = next.nodes.find((n) => n.id === id);
        if (!n) throw new Error('Node not found.');
        return n;
      };
    switch (command.type) {
      case 'move':
        for (const [id, p] of Object.entries(command.positions)) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Invalid node position.');
          node(id).position = { x: Math.round(p.x), y: Math.round(p.y) };
        }
        break;
      case 'delete':
        next.nodes = next.nodes.filter((n) => !command.ids.includes(n.id));
        next.edges = next.edges.filter((e) => ![e.id, e.source, e.target].some((id) => command.ids.includes(id)));
        break;
      case 'connect':
        node(command.source);
        node(command.target);
        if (command.source === command.target) throw new Error('A node cannot connect to itself.');
        if (next.edges.some((e) => e.source === command.source && e.target === command.target)) return document;
        next.edges.push({
          id: command.id,
          source: command.source,
          target: command.target,
          sourceHandle: command.sourceHandle,
          targetHandle: command.targetHandle,
          condition: 'always',
        });
        break;
      case 'reconnect': {
        node(command.nodeId);
        const edge = next.edges.find((e) => e.id === command.id);
        if (!edge) throw new Error('Connection not found.');
        if (command.nodeId === (command.endpoint === 'source' ? edge.target : edge.source)) return document;
        if (command.endpoint === 'source') {
          edge.source = command.nodeId;
          edge.sourceHandle = command.handle;
        } else {
          edge.target = command.nodeId;
          edge.targetHandle = command.handle;
        }
        break;
      }
      case 'reroute': {
        const e = next.edges.find((e) => e.id === command.id);
        if (!e) throw new Error('Connection not found.');
        const pairs = [
          ['right', 'left'],
          ['bottom', 'top'],
          ['left', 'right'],
          ['top', 'bottom'],
        ] as const;
        const i = pairs.findIndex(([s, t]) => s === (e.sourceHandle ?? 'right') && t === (e.targetHandle ?? 'left'));
        [e.sourceHandle, e.targetHandle] = pairs[(i + 1) % pairs.length];
        break;
      }
      case 'arrange': {
        const positions = layoutPositions(
          next.nodes.map((n) => n.id),
          next.edges,
        );
        next.nodes.forEach((n) => {
          n.position = positions[n.id];
        });
        break;
      }
    }
    return next;
  },
};
