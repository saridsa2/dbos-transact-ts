import type { NativeKind, NativeOperation } from './model';
import { input, literal } from './model';
export const nativeCatalog: { kind: NativeKind; label: string; description: string }[] = [
  { kind: 'step', label: 'Durable step', description: 'Checkpoint a registered operation' },
  { kind: 'transaction', label: 'Transaction', description: 'Execute a datasource transaction' },
  { kind: 'delay', label: 'Durable wait', description: 'Sleep through restarts' },
  { kind: 'decision', label: 'Decision', description: 'Compare typed input and outputs' },
  { kind: 'workflow', label: 'Call workflow', description: 'Start or await a child workflow' },
  { kind: 'await', label: 'Await results', description: 'Collect workflow results in order' },
  { kind: 'foreach', label: 'For each', description: 'Run a child graph for each item' },
  { kind: 'loop', label: 'Bounded loop', description: 'Repeat a child graph with state' },
  { kind: 'parallel', label: 'Parallel branches', description: 'Start all branches before joining' },
  { kind: 'send', label: 'Send message', description: 'Notify a workflow by topic' },
  { kind: 'review', label: 'Human review', description: 'Wait for an approve or reject decision' },
  { kind: 'receive', label: 'Receive message', description: 'Wait durably with a timeout' },
  { kind: 'event', label: 'Publish event', description: 'Publish durable progress or state' },
  { kind: 'waitEvent', label: 'Wait for event', description: 'Read another workflow event' },
  { kind: 'assign', label: 'Map data', description: 'Build typed values from bindings' },
  { kind: 'return', label: 'Return', description: 'Return the scope result' },
];
export function defaultOperation(kind: NativeKind): NativeOperation {
  switch (kind) {
    case 'step':
      return { kind, handler: 'core.identity', input: input('variables') };
    case 'transaction':
      return { kind, handler: 'example.ledger', input: input('variables') };
    case 'delay':
      return { kind, durationMS: literal(1000) };
    case 'decision':
      return { kind, predicate: { operator: 'truthy', left: input('variables') } };
    case 'workflow':
      return { kind, workflowRef: 'select-workflow', input: input('variables'), mode: 'await' };
    case 'await':
      return { kind, handles: literal([]) };
    case 'foreach':
      return { kind, workflowRef: 'select-workflow', items: literal([]), mode: 'sequential', maxItems: 100 };
    case 'loop':
      return {
        kind,
        workflowRef: 'select-workflow',
        initial: literal({ count: 0 }),
        while: { operator: 'lt', left: { source: 'state', path: 'count' }, right: literal(3) },
        maxIterations: 10,
      };
    case 'parallel':
      return { kind, branches: [{ workflowRef: 'select-workflow', input: input('variables') }] };
    case 'send':
      return { kind, workflowID: literal('workflow-id'), topic: 'message', value: literal('ready') };
    case 'review':
      return { kind, instruction: literal('Review this request.'), timeoutSeconds: literal(3600) };
    case 'receive':
      return { kind, topic: 'message', timeoutSeconds: literal(60) };
    case 'event':
      return { kind, key: 'progress', value: literal('running') };
    case 'waitEvent':
      return { kind, workflowID: literal('workflow-id'), key: 'progress', timeoutSeconds: literal(60) };
    case 'assign':
    case 'return':
      return { kind, value: input('variables') };
  }
}
