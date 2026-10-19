import { describe, expect, it } from 'vitest';
import { edgeBranch } from './edge-branch';

describe('edgeBranch', () => {
  it("returns null for a plain 'always' edge (no branch decision)", () => {
    expect(edgeBranch('always', 'prompt')).toBeNull();
    expect(edgeBranch(undefined, 'condition')).toBeNull();
  });

  it('labels condition-node branches true/false', () => {
    expect(edgeBranch('true', 'condition')).toEqual({ label: 'true', tone: 'true' });
    expect(edgeBranch('false', 'condition')).toEqual({ label: 'false', tone: 'false' });
  });

  it('labels approval-node branches approved/rejected but keeps the tone', () => {
    expect(edgeBranch('true', 'approval')).toEqual({
      label: 'approved',
      tone: 'true',
    });
    expect(edgeBranch('false', 'approval')).toEqual({
      label: 'rejected',
      tone: 'false',
    });
  });

  it('falls back to true/false wording when the source kind is unknown', () => {
    expect(edgeBranch('true', undefined)).toEqual({ label: 'true', tone: 'true' });
  });
});
