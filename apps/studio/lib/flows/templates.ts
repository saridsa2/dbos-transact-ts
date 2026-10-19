import type { AgentFlow } from './types';
export function isStarterFlow(flow: { id: string }) {
  return flow.id === 'starter-flow';
}
export function createStarterFlow(): AgentFlow {
  return {
    id: 'starter-flow',
    name: 'Review and route',
    description: 'A domain-neutral workflow with a durable human decision.',
    nodes: [
      { id: 'trigger-1', kind: 'trigger', name: 'Start', position: { x: -650, y: -100 }, config: {} },
      {
        id: 'prompt-1',
        kind: 'prompt',
        name: 'Prepare request',
        position: { x: -280, y: -100 },
        config: { prompt: 'Review this request: {{userInput}}' },
      },
      {
        id: 'approval-1',
        kind: 'approval',
        name: 'Review request',
        position: { x: 110, y: -100 },
        config: { approvalMessage: 'Approve or reject the request to continue.' },
      },
      {
        id: 'output-approved',
        kind: 'output',
        name: 'Approved result',
        position: { x: 510, y: -240 },
        config: { outputKey: 'approved' },
      },
      {
        id: 'output-rejected',
        kind: 'output',
        name: 'Rejected result',
        position: { x: 510, y: 100 },
        config: { outputKey: 'rejected' },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'prompt-1', condition: 'always' },
      { id: 'e2', source: 'prompt-1', target: 'approval-1', condition: 'always' },
      { id: 'e3', source: 'approval-1', target: 'output-approved', condition: 'true' },
      { id: 'e4', source: 'approval-1', target: 'output-rejected', condition: 'false' },
    ],
  };
}
