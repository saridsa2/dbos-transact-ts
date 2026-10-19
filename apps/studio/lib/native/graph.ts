import type { AgentFlow, FlowNodeData, FlowEdgeData } from '../flows/types';
import type { Binding, NativeOperation } from './model';
export const object = (fields: Record<string, Binding>): Binding => ({ source: 'object', fields });
export function node(id: string, name: string, op: NativeOperation): FlowNodeData {
  return { id, name, kind: op.kind, config: { operation: op }, position: { x: 0, y: 0 } };
}
export function graph(id: string, name: string, steps: FlowNodeData[], edges?: FlowEdgeData[]): AgentFlow {
  const start: FlowNodeData = {
    id: 'start',
    name: 'Start',
    kind: 'trigger',
    config: { label: 'Manual / API' },
    position: { x: -600, y: 0 },
  };
  const nodes = [start, ...steps].map((node, index) => ({ ...node, position: { x: -600 + index * 380, y: 0 } }));
  return {
    schemaVersion: 2,
    id,
    name,
    nodes,
    edges:
      edges ??
      nodes.slice(0, -1).map((node, index) => ({
        id: `edge-${index}`,
        source: node.id,
        target: nodes[index + 1].id,
        condition: 'success',
      })),
  };
}
export const edge = (
  source: string,
  target: string,
  condition: FlowEdgeData['condition'] = 'success',
): FlowEdgeData => ({
  id: `${source}-${target}-${condition}`,
  source,
  target,
  condition,
});
export const end = (value: Binding) => node('result', 'Return result', { kind: 'return', value });
