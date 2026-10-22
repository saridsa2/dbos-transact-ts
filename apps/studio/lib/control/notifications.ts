import type { WorkspaceNotification } from './contracts';
/** Keep notification destinations consistent across menus and execution views. */
export function notificationDestination(event: WorkspaceNotification): string {
  const id = encodeURIComponent(event.entityId);
  switch (event.entityType) {
    case 'ontology':
    case 'process':
      return event.entityType === 'process' ? `/processes?id=${id}` : `/knowledge?id=${id}&view=${event.entityType}`;
    case 'source':
      return `/sources?id=${id}`;
    case 'agent_request':
      return `/intelligence?request=${id}`;
    case 'agent_work_item':
      return `/intelligence?work=${id}`;
    case 'workspace_agent':
      return '/intelligence';
    case 'intelligence_task':
      return `/intelligence?task=${id}`;
    case 'workflow':
      return `/flows?flow=${id}`;
    case 'run':
      return event.action === 'run.debounced' && !event.resourceName ? '/control?tab=runs' : `/flows?run=${id}`;
    case 'connection':
      return `/control?tab=connections&connection=${id}`;
    case 'user':
      return `/control?tab=team&member=${id}`;
    case 'invitation':
      return '/control?tab=team';
    default:
      return '/control';
  }
}
