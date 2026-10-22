import type { DiagramCommand, EditorAdapter } from '../graph-editor/adapter';
import { applyProcessCommand, processGraphIssues, type ProcessCommand, type ProcessDocument } from './model';
import {
  arrangeProcessLanes,
  processElementSize,
  normalizeProcessLanes,
  changeProcessLanes,
  assignProcessLane,
  resizeProcessLane,
} from './lanes';
export type ProcessEditorCommand =
  | DiagramCommand
  | Extract<ProcessCommand, { type: 'add' }>
  | { type: 'lanes'; lanes: NonNullable<ProcessDocument['lanes']> }
  | { type: 'assign-lane'; ids: string[]; laneId: string | null }
  | { type: 'resize-lane'; id: string | null; height: number };
export const processEditorAdapter: EditorAdapter<ProcessDocument, ProcessEditorCommand> = {
  id: 'process',
  routing: 'elbow',
  containers: 'structured',
  project: (document) => ({
    nodes: document.graph.elements.map((n) => ({
      id: n.id,
      name: n.name,
      kind: `process-${n.kind}`,
      position: document.presentation.positions[n.id] ?? { x: 0, y: 0 },
      size: processElementSize(n),
    })),
    edges: document.graph.flows.map((e) => ({
      ...e,
      ...(e.outcome
        ? {
            branch: {
              label: e.outcome.charAt(0).toUpperCase() + e.outcome.slice(1),
              tone: ['false', 'timeout', 'error'].includes(e.outcome) ? ('false' as const) : ('true' as const),
            },
          }
        : {}),
    })),
  }),
  configuration: (document, id) => {
    const n = document.graph.elements.find((n) => n.id === id);
    return n
      ? { id: n.id, kind: n.kind === 'activity' && n.binding.kind === 'operation' ? 'operation' : n.kind }
      : null;
  },
  validate: processGraphIssues,
  apply(document, command) {
    switch (command.type) {
      case 'lanes':
        return changeProcessLanes(document, command.lanes);
      case 'assign-lane':
        return assignProcessLane(document, command.ids, command.laneId);
      case 'resize-lane':
        return resizeProcessLane(document, command.id, command.height);
      case 'arrange':
        return arrangeProcessLanes(document);
      case 'reconnect': {
        const e = document.graph.flows.find((e) => e.id === command.id);
        if (!e) throw new Error('Sequence flow not found.');
        return applyProcessCommand(document, {
          ...e,
          type: 'connect',
          ...(command.endpoint === 'source'
            ? { source: command.nodeId, sourceHandle: command.handle }
            : { target: command.nodeId, targetHandle: command.handle }),
        });
      }
      case 'reroute': {
        const e = document.graph.flows.find((e) => e.id === command.id);
        if (!e) throw new Error('Sequence flow not found.');
        const sides = ['right', 'bottom', 'left', 'top'] as const;
        return applyProcessCommand(document, {
          ...e,
          type: 'connect',
          sourceHandle: sides[(sides.indexOf(e.sourceHandle ?? 'right') + 1) % 4],
        });
      }
      case 'add':
        return normalizeProcessLanes(applyProcessCommand(document, command));
      default:
        return applyProcessCommand(document, command);
    }
  },
};
