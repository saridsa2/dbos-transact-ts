import type { EscalationSummary } from './types';

/**
 * Reduce a flat open-escalation list to a nodeId → escalation map for one flow.
 * If a node somehow has more than one open escalation (two concurrent runs
 * paused at the same node), keep the most recently created one.
 */
export function mapEscalationsByNode(
  escalations: EscalationSummary[],
  flowId: string,
  runId?: string,
): Record<string, EscalationSummary> {
  const map: Record<string, EscalationSummary> = {};
  for (const escalation of escalations) {
    if (escalation.flowId !== flowId || (runId && escalation.runId !== runId)) continue;
    const existing = map[escalation.nodeId];
    if (!existing || new Date(escalation.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      map[escalation.nodeId] = escalation;
    }
  }
  return map;
}
