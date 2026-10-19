import type { FlowEdgeData, FlowNodeKind } from './types';

export type EdgeBranch = {
  /** Human-readable connector definition, e.g. "approved" or "true". */
  label: string;
  /** Visual tone used for the edge color + label pill. */
  tone: 'true' | 'false';
};

/**
 * The readable "definition" of a connector, or null for a plain "always" edge
 * (which carries no branch decision and stays neutral/unlabeled).
 *
 * Approval-node branches read as approved / rejected; condition-node (and any
 * other true/false) branches read as true / false. Pure and deterministic so
 * it can be unit-tested without rendering the canvas.
 */
export function edgeBranch(
  condition: FlowEdgeData['condition'],
  sourceKind: FlowNodeKind | undefined,
): EdgeBranch | null {
  if (condition === 'error' || condition === 'timeout') return { label: condition, tone: 'false' };
  if (condition !== 'true' && condition !== 'false') {
    return null;
  }
  const isApproval = sourceKind === 'approval';
  if (condition === 'true') {
    return { label: isApproval ? 'approved' : 'true', tone: 'true' };
  }
  return { label: isApproval ? 'rejected' : 'false', tone: 'false' };
}
