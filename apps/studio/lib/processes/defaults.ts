import type { NativeOperation } from '../native/model';
const literal = (value: unknown) => ({ source: 'literal' as const, value });
export const processOperations = {
  step: 'System operation',
  review: 'Human approval',
  delay: 'Timer',
  receive: 'Wait for message',
  waitEvent: 'Wait for event',
  workflow: 'Subprocess',
  foreach: 'Repeat for each',
  loop: 'Bounded loop',
  parallel: 'Parallel subprocesses',
} as const;
export type ProcessOperationKind = keyof typeof processOperations;
export function defaultProcessOperation(kind: ProcessOperationKind): NativeOperation {
  switch (kind) {
    case 'step':
      return { kind, handler: 'unbound', input: literal({}) };
    case 'review':
      return {
        kind,
        instruction: literal('Review the process and approve or reject.'),
        timeoutSeconds: literal(86400),
      };
    case 'delay':
      return { kind, durationMS: literal(1000) };
    case 'receive':
      return { kind, topic: 'process-message', timeoutSeconds: literal(86400) };
    case 'waitEvent':
      return {
        kind,
        key: 'process-event',
        workflowID: { source: 'execution', path: 'workflowID' },
        timeoutSeconds: literal(86400),
      };
    case 'workflow':
      return { kind, workflowRef: 'unbound', input: literal({}), mode: 'await' };
    case 'foreach':
      return { kind, workflowRef: 'unbound', items: literal([]), mode: 'sequential', maxItems: 100 };
    case 'loop':
      return {
        kind,
        workflowRef: 'unbound',
        initial: literal({}),
        while: { operator: 'truthy', left: literal(false) },
        maxIterations: 10,
      };
    case 'parallel':
      return {
        kind,
        branches: [
          { id: 'branch-1', name: 'Branch 1', workflowRef: 'unbound', input: literal({}) },
          { id: 'branch-2', name: 'Branch 2', workflowRef: 'unbound', input: literal({}) },
        ],
      };
  }
}
