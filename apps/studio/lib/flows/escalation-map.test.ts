import { describe, expect, it } from 'vitest';
import { mapEscalationsByNode } from './escalation-map';
import type { EscalationSummary } from './types';

function esc(p: Partial<EscalationSummary>): EscalationSummary {
  return {
    id: 'e',
    runId: 'r',
    flowId: 'f1',
    flowName: 'F',
    runStatus: 'waiting',
    nodeId: 'n1',
    nodeName: 'N',
    kind: 'approval',
    instruction: '',
    status: 'open',
    note: null,
    assigneeLabel: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(0).toISOString(),
    ...p,
  } as EscalationSummary;
}

describe('mapEscalationsByNode', () => {
  it('keys escalations for the given flow by nodeId', () => {
    const map = mapEscalationsByNode([esc({ id: 'a', nodeId: 'n1' }), esc({ id: 'b', nodeId: 'n2' })], 'f1');
    expect(Object.keys(map).sort()).toEqual(['n1', 'n2']);
    expect(map.n1.id).toBe('a');
  });

  it('ignores escalations from other flows', () => {
    const map = mapEscalationsByNode([esc({ nodeId: 'n1', flowId: 'other' })], 'f1');
    expect(map).toEqual({});
  });

  it('keeps the most recently created escalation when a node has more than one', () => {
    const map = mapEscalationsByNode(
      [
        esc({ id: 'old', nodeId: 'n1', createdAt: new Date(1000).toISOString() }),
        esc({ id: 'new', nodeId: 'n1', createdAt: new Date(5000).toISOString() }),
      ],
      'f1',
    );
    expect(map.n1.id).toBe('new');
  });
});

it('scopes approvals to the viewed run even when another run reached the same node later', () => {
  const map = mapEscalationsByNode(
    [
      esc({ id: 'viewed', runId: 'run-a', createdAt: new Date(1000).toISOString() }),
      esc({ id: 'other', runId: 'run-b', createdAt: new Date(5000).toISOString() }),
    ],
    'f1',
    'run-a',
  );
  expect(map.n1.id).toBe('viewed');
});
