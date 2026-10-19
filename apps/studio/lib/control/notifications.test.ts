import { describe, it, expect } from 'vitest';
import { notificationDestination } from './notifications';
import type { WorkspaceNotification } from './contracts';
const event: WorkspaceNotification = {
  id: '1',
  kind: 'workspace',
  action: 'workflow.saved',
  entityType: 'workflow',
  entityId: 'graph/with spaces',
  title: 'Workflow saved',
  createdAt: '2026-10-18T00:00:00Z',
};
describe('notification actions', () => {
  it('opens a saved graph directly, with a safely encoded identifier', () => {
    expect(notificationDestination(event)).toBe('/flows?flow=graph%2Fwith%20spaces');
  });
  it('opens actual execution traces and sends undispatched debounce receipts to history', () => {
    expect(notificationDestination({ ...event, entityType: 'run', entityId: 'run-1', action: 'run.completed' })).toBe(
      '/flows?run=run-1',
    );
    expect(notificationDestination({ ...event, entityType: 'run', action: 'run.debounced' })).toBe('/control?tab=runs');
    expect(
      notificationDestination({ ...event, entityType: 'run', action: 'run.debounced', resourceName: 'Started graph' }),
    ).toContain('/flows?run=');
  });
  it('opens the correct connection or people section instead of silently returning to overview', () => {
    expect(notificationDestination({ ...event, entityType: 'connection', entityId: 'connection-1' })).toBe(
      '/control?tab=connections&connection=connection-1',
    );
    expect(notificationDestination({ ...event, entityType: 'user', entityId: 'member-1' })).toBe(
      '/control?tab=team&member=member-1',
    );
    expect(notificationDestination({ ...event, entityType: 'invitation' })).toBe('/control?tab=team');
  });
});
