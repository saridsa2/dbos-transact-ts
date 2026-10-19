import { describe, expect, it } from 'vitest';
import { getNodeActions } from './node-actions';
import type { EscalationSummary, FlowNodeData } from './types';

function node(partial: Partial<FlowNodeData>): FlowNodeData {
  return {
    id: 'n1',
    kind: 'approval',
    name: 'Approve',
    description: '',
    position: { x: 0, y: 0 },
    config: {},
    ...partial,
  } as FlowNodeData;
}

function esc(nodeId: string, kind: EscalationSummary['kind'] = 'approval'): EscalationSummary {
  return {
    id: 'e1',
    runId: 'r1',
    flowId: 'f1',
    flowName: 'Flow',
    runStatus: 'waiting',
    nodeId,
    nodeName: 'Approve',
    kind,
    instruction: '',
    status: 'open',
    note: null,
    assigneeLabel: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(0).toISOString(),
  } as EscalationSummary;
}

describe('getNodeActions', () => {
  it('offers resolve-escalation on a waiting approval node with an open escalation', () => {
    const ctx = { escalationsByNodeId: { n1: esc('n1') } };
    const actions = getNodeActions(node({ kind: 'approval' }), 'waiting', ctx);
    expect(actions.map((a) => a.id)).toEqual(['resolve-escalation']);
  });

  it("offers resolve regardless of the escalation's kind (human_task/referral live on the approval node)", () => {
    // The pausing node is always kind "approval"; the human_task/referral
    // distinction is on the escalation and only shapes the form buttons, not
    // availability.
    for (const kind of ['human_task', 'referral'] as const) {
      const ctx = { escalationsByNodeId: { n1: esc('n1', kind) } };
      const actions = getNodeActions(node({ kind: 'approval' }), 'waiting', ctx);
      expect(actions.map((a) => a.id)).toEqual(['resolve-escalation']);
    }
  });

  it('offers nothing when the node is waiting but has no escalation', () => {
    const actions = getNodeActions(node({ kind: 'approval' }), 'waiting', {
      escalationsByNodeId: {},
    });
    expect(actions).toEqual([]);
  });

  it('offers Resolve for native human review nodes', () => {
    expect(
      getNodeActions(node({ kind: 'review' }), 'waiting', { escalationsByNodeId: { n1: esc('n1') } }),
    ).toHaveLength(1);
  });
  it('offers nothing when an approval node is not waiting', () => {
    const ctx = { escalationsByNodeId: { n1: esc('n1') } };
    expect(getNodeActions(node({ kind: 'approval' }), 'succeeded', ctx)).toEqual([]);
    expect(getNodeActions(node({ kind: 'approval' }), 'idle', ctx)).toEqual([]);
  });

  it('offers nothing for a non-approval kind even while waiting with an escalation', () => {
    const ctx = { escalationsByNodeId: { n1: esc('n1') } };
    expect(getNodeActions(node({ kind: 'tool' }), 'waiting', ctx)).toEqual([]);
    expect(getNodeActions(node({ kind: 'llm' }), 'waiting', ctx)).toEqual([]);
  });
});
