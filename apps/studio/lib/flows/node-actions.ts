import type { MessageDescriptor } from '@lingui/core';
import type { EscalationSummary, FlowNodeData, FlowNodeStatus } from './types';

/**
 * Plain message descriptor — mirrors the convention in
 * components/agent42/escalations-client.tsx, which avoids the `@lingui/core/macro`
 * `msg` macro so this stays a pure module that needs no babel transform to run
 * (in tests or at runtime). The rendering component turns it into text via
 * `_(labelKey)`.
 */
function msg(message: string): MessageDescriptor {
  return { id: message, message };
}

/**
 * The set of actions a node can expose. This union grows by one entry per new
 * action; each addition also adds one availability clause in getNodeActions and
 * one surface entry in components/flows/node-action-surfaces.tsx. Nothing else
 * changes — that is the whole point of the framework.
 */
export type NodeActionId = 'resolve-escalation';

export type NodeActionDescriptor = {
  id: NodeActionId;
  /** Lingui message; the rendering component turns it into text via `_(...)`. */
  labelKey: MessageDescriptor;
  tone?: 'default' | 'primary';
};

/**
 * Everything getNodeActions needs to decide availability. Extensible: future
 * actions add fields (e.g. a nodeOutputs map for a "View output" action).
 */
export type NodeActionContext = {
  escalationsByNodeId: Record<string, EscalationSummary>;
};

/**
 * Pure. Given a node, its live run status, and context, return the ordered list
 * of actions available on it right now. Deterministic and side-effect-free so
 * it can be unit-tested exhaustively.
 */
export function getNodeActions(
  node: FlowNodeData,
  status: FlowNodeStatus,
  ctx: NodeActionContext,
): NodeActionDescriptor[] {
  const actions: NodeActionDescriptor[] = [];

  // resolve-escalation: a paused approval node with an open escalation waiting
  // on a human. Every escalating node is kind "approval" at runtime (the
  // executor enforces it); the approval/human_task/referral distinction lives
  // on the *escalation* (EscalationSummary.kind), not the node, and only shapes
  // the resolve form's buttons downstream — availability just needs the open
  // escalation to exist.
  if (
    status === 'waiting' &&
    (node.kind === 'approval' || node.kind === 'review') &&
    ctx.escalationsByNodeId[node.id]
  ) {
    actions.push({
      id: 'resolve-escalation',
      labelKey: msg('Resolve'),
      tone: 'primary',
    });
  }

  return actions;
}
