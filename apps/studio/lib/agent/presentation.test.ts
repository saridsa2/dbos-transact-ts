import { describe, it, expect } from 'vitest';
import { activityTitle, activityError, receiptStatus, toolLabel } from './presentation';
describe('activity presentation', () => {
  it('bounds single-paragraph and Unicode instructions without changing their persisted content', () => {
    const goal = 'Review onboarding requirements ' + '🧭'.repeat(1000);
    const title = activityTitle(goal);
    expect(Array.from(title).length).toBeLessThanOrEqual(80);
    expect(title).toContain('Review onboarding');
    expect(title).not.toContain('\ud83e…');
    expect(goal.length).toBeGreaterThan(1000);
    expect(activityTitle('\n# Review onboarding\nPrivate detail')).toBe('Review onboarding');
    expect(activityTitle('')).toBe('Activity');
  });
  it('keeps protocol errors out of answers without masking uncertainty', () => {
    expect(activityError('Unexpected token ` is not valid JSON')).not.toContain('Unexpected token');
    expect(activityError('Uncertain outcome; inspect receipt')).toBe('Uncertain outcome; inspect receipt');
  });
  it('explains memory failures without library names or internal stack details', () => {
    expect(activityError('Choose a scope before enabling Mem0.')).not.toMatch(/mem0/i);
    expect(activityError('Mem0 adapter failed at /private/runtime/index.mjs')).not.toContain('/private/');
    expect(activityError('Mem0 inference is disabled; memory requires approval.')).toContain('approved');
  });
  it('keeps raw validation arrays out of primary activity surfaces', () => {
    const raw = JSON.stringify([{ code: 'invalid_value', path: ['items', 5, 'kind'], message: 'Invalid option' }]);
    expect(activityError(raw)).toContain('Inspect Execution');
    expect(activityError(raw)).not.toContain('invalid_value');
  });
  it('distinguishes failed and in-progress receipts from neutral records', () => {
    expect(receiptStatus('execution_error')).toBe('error');
    expect(receiptStatus('run.failed')).toBe('error');
    expect(receiptStatus('run.started')).toBe('running');
    expect(receiptStatus('answer')).toBeUndefined();
    expect(toolLabel('artifact_read_v1')).toBe('Read saved knowledge');
  });
});
