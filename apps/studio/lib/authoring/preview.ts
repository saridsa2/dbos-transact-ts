import type { AgentFlow, FlowNodeData } from '../flows/types';
import { compileAuthoringGraph } from './compiler';
/** Compile the selected node in its graph context without requiring unrelated draft nodes to be executable. */
export function compilePreview(flow: AgentFlow, draft: FlowNodeData): AgentFlow {
  if (flow.authoringVersion !== 2)
    return compileAuthoringGraph({
      ...flow,
      authoringVersion: flow.authoringVersion ?? 1,
      nodes: flow.nodes.map((n) => (n.id === draft.id ? draft : n)),
    });
  return compileAuthoringGraph({
    ...flow,
    nodes: flow.nodes.map((n) =>
      n.id === draft.id
        ? draft
        : n.kind === 'trigger'
          ? n
          : {
              ...n,
              kind: n.kind === 'merge' ? ('merge' as const) : ('assign' as const),
              config: {
                operation: { kind: 'assign' as const, value: { source: 'literal' as const, value: null } },
                ...(n.kind === 'merge'
                  ? { parameters: { value: { mode: 'fixed' as const, value: null } }, merge: { updates: [] } }
                  : {}),
              },
            },
    ),
  });
}
