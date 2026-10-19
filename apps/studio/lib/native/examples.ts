import { scopedExamples } from '../authoring/examples';
import type { AgentFlow } from '../flows/types';
import { input, output, literal } from './model';
import { object, node, graph, edge, end } from './graph';
import { defaultCode } from '../authoring/model';
import { patternExamples } from './pattern-examples';
export function blankNativeGraph(): AgentFlow {
  return { ...graph('starter-flow', 'Untitled workflow', [end(input('variables'))]), defaultInput: { variables: {} } };
}
export function nativeExamples(): {
  id: string;
  title: string;
  description: string;
  source: string;
  flow: AgentFlow;
}[] {
  const reminder = graph('reminder', 'Reminder', [
    node('confirmation', 'Prepare confirmation', {
      kind: 'step',
      handler: 'example.confirmation',
      input: input('variables.email'),
    }),
    node('wait', 'Wait until reminder', { kind: 'delay', durationMS: input('variables.delayMS') }),
    node('reminder', 'Prepare reminder', {
      kind: 'step',
      handler: 'example.reminder',
      input: input('variables.email'),
    }),
    end(output('reminder')),
  ]);
  reminder.defaultInput = { variables: { email: 'person@example.test', delayMS: 1500 } };
  const health = graph('health-check', 'Check client health', [
    node('check', 'Check congestion', { kind: 'step', handler: 'example.health', input: { source: 'item' } }),
    end(output('check')),
  ]);
  const replacement = graph('replacement', 'Replace client', [
    node('decommission', 'Decommission client', {
      kind: 'step',
      handler: 'example.decommission',
      input: { source: 'item' },
    }),
    node('machine', 'Start replacement machine', {
      kind: 'step',
      handler: 'example.machine',
      input: { source: 'item' },
    }),
    node('startup', 'Run startup script', { kind: 'step', handler: 'example.startup', input: output('machine') }),
    node('register', 'Register replacement', { kind: 'step', handler: 'example.register', input: output('startup') }),
    end(output('register')),
  ]);
  const autoscale = graph('autoscaling', 'Transaction Director autoscaling', [
    node('checking', 'Publish checking progress', {
      kind: 'event',
      key: 'progress',
      value: literal({ phase: 'checking' }),
    }),
    node('health', 'Check each client', {
      kind: 'foreach',
      workflowRef: 'health-check',
      items: input('variables.clients'),
      mode: 'sequential',
      maxItems: 100,
    }),
    node('filter', 'Collect unhealthy clients', {
      kind: 'step',
      handler: 'example.filterHealth',
      input: output('health'),
    }),
    node('replacing', 'Publish replacement progress', {
      kind: 'event',
      key: 'progress',
      value: literal({ phase: 'replacing' }),
    }),
    node('replace', 'Replace unhealthy clients', {
      kind: 'foreach',
      workflowRef: 'replacement',
      items: output('filter'),
      mode: 'sequential',
      maxItems: 100,
    }),
    node('done', 'Publish completion', { kind: 'event', key: 'progress', value: literal({ phase: 'done' }) }),
    end(output('replace')),
  ]);
  autoscale.definitions = { 'health-check': health, replacement };
  autoscale.schedule = { enabled: false, cron: '0 * * * * *' };
  autoscale.defaultInput = {
    variables: {
      clients: [
        { id: 'client-1', unhealthy: true },
        { id: 'client-2', unhealthy: false },
        { id: 'client-3', unhealthy: true },
      ],
    },
  };
  const task = graph('queue-task', 'Queued task', [
    node('wait', 'Process task', { kind: 'delay', durationMS: literal(100) }),
    end({ source: 'item' }),
  ]);
  const queued = graph('queued-tasks', 'Queued fan-out and collection', [
    node('launch', 'Enqueue all tasks', {
      kind: 'foreach',
      workflowRef: 'queue-task',
      items: input('variables.tasks'),
      mode: 'start',
      queueRef: 'tasks',
      maxItems: 100,
    }),
    node('collect', 'Collect results in input order', { kind: 'await', handles: output('launch') }),
    end(output('collect')),
  ]);
  queued.definitions = { 'queue-task': task };
  queued.queues = [{ key: 'tasks', globalConcurrency: 2, rateLimit: { limitPerPeriod: 20, periodSec: 1 } }];
  queued.defaultInput = { variables: { tasks: ['task-a', 'task-b', 'task-c'] } };
  const checkout = graph(
    'checkout',
    'Payment and inventory compensation',
    [
      node('reserve', 'Reserve example inventory', {
        kind: 'transaction',
        handler: 'example.reserve',
        input: literal({ quantity: 1 }),
      }),
      node('payment', 'Publish payment readiness', { kind: 'event', key: 'payment_ready', value: literal(true) }),
      node('receive', 'Wait for payment', {
        kind: 'receive',
        topic: 'payment',
        timeoutSeconds: input('variables.timeoutSeconds'),
      }),
      node('paid', 'Payment received?', {
        kind: 'decision',
        predicate: { operator: 'eq', left: output('receive'), right: literal('paid') },
      }),
      node('record', 'Record successful payment', {
        kind: 'transaction',
        handler: 'example.ledger',
        input: literal({ status: 'paid' }),
      }),
      node('restore', 'Restore reserved inventory', {
        kind: 'transaction',
        handler: 'example.restoreInventory',
        input: literal({ reason: 'payment failed or timed out' }),
      }),
      node('success', 'Return paid order', { kind: 'return', value: literal({ status: 'paid' }) }),
      node('failure', 'Return cancelled order', { kind: 'return', value: literal({ status: 'cancelled' }) }),
      node('unavailable', 'Return out of stock', { kind: 'return', value: literal({ status: 'out-of-stock' }) }),
    ],
    [
      edge('start', 'reserve'),
      edge('reserve', 'payment'),
      edge('reserve', 'unavailable', 'error'),
      edge('payment', 'receive'),
      edge('receive', 'paid'),
      edge('receive', 'restore', 'timeout'),
      edge('paid', 'record', 'true'),
      edge('paid', 'restore', 'false'),
      edge('record', 'success'),
      edge('restore', 'failure'),
    ],
  );
  checkout.nodes.forEach((node, index) => {
    node.position = { x: -900 + (index % 5) * 400, y: Math.floor(index / 5) * 300 };
  });
  checkout.defaultInput = { variables: { timeoutSeconds: 30 } };
  const body = graph('counter-body', 'Loop body', [
    node('advance', 'Advance loop state', { kind: 'step', handler: 'example.increment', input: { source: 'state' } }),
    end(output('advance')),
  ]);
  const loop = graph('bounded-loop', 'Bounded stateful loop', [
    node('repeat', 'Repeat until count reaches limit', {
      kind: 'loop',
      workflowRef: 'counter-body',
      initial: input('variables.initial'),
      while: { operator: 'lt', left: { source: 'state', path: 'count' }, right: literal(3) },
      maxIterations: 5,
    }),
    end(output('repeat')),
  ]);
  loop.definitions = { 'counter-body': body };
  loop.defaultInput = { variables: { initial: { count: 0 } } };
  const transaction = graph('transactions', 'Transactional toolbox', [
    node('write', 'Insert ledger entry', { kind: 'transaction', handler: 'example.ledger', input: input('variables') }),
    node('count', 'Count committed entries', {
      kind: 'transaction',
      handler: 'example.ledgerCount',
      input: literal(null),
    }),
    end(output('count')),
  ]);
  transaction.defaultInput = { variables: { message: 'Hello, durable transactions' } };
  const delayed = graph('delayed', 'Delayed child dispatch', [
    node('start-task', 'Schedule child start', {
      kind: 'workflow',
      workflowRef: 'queue-task',
      input: object({ item: literal('delayed task') }),
      mode: 'start',
      queueRef: 'delayed',
      delaySeconds: input('variables.delaySeconds'),
    }),
    node('collect', 'Await dispatched task', { kind: 'await', handles: output('start-task') }),
    end(output('collect')),
  ]);
  delayed.definitions = { 'queue-task': task };
  delayed.queues = [{ key: 'delayed', globalConcurrency: 2 }];
  delayed.defaultInput = { variables: { delaySeconds: 1 } };
  const authored = graph('code-and-variables', 'Code and workflow variables', [
    {
      id: 'prepare',
      name: 'Set calculation variables',
      kind: 'setVariables',
      position: { x: 0, y: 0 },
      config: {
        parameters: {
          values: {
            mode: 'object',
            fields: {
              factor: { mode: 'expression', expression: '$input.variables.factor' },
              items: { mode: 'expression', expression: '$input.variables.items' },
            },
          },
        },
      },
    },
    {
      id: 'calculate',
      name: 'Transform items with TypeScript',
      kind: 'code',
      position: { x: 0, y: 0 },
      config: {
        parameters: { input: { mode: 'expression', expression: '$vars.items' } },
        code: {
          ...defaultCode(),
          language: 'typescript',
          source:
            'const items: number[] = input;\nconsole.log("Transforming", items.length, "items");\nreturn items.map(value => value * variables.factor);',
        },
      },
    },
    end({ source: 'expression', expression: 'sum($nodes["calculate"])' }),
  ]);
  authored.authoringVersion = 1;
  authored.variables = { factor: { mode: 'fixed', value: 1 }, items: { mode: 'array', items: [] } };
  authored.defaultInput = { variables: { items: [1, 2, 3], factor: 3 } };
  return [
    ...scopedExamples(),
    {
      id: 'code-and-variables',
      title: 'Code and workflow variables',
      description:
        'Set structured variables, transform items with isolated TypeScript, then sum the result. Returns 18 with the default input.',
      source: 'Stack Proc · authoring example (local computation)',
      flow: authored,
    },
    ...patternExamples(),
    {
      id: 'reminder',
      title: 'Reminder',
      description: 'Step → durable wait → step. Restart while waiting.',
      source: 'dbos-transact-ts/README.md · reminderWorkflowFunction',
      flow: reminder,
    },
    {
      id: 'autoscaling',
      title: 'Transaction Director',
      description:
        'Nested workflows, health filtering, sequential replacements and progress events. Local example handlers.',
      source: 'txd-dbos/main.go',
      flow: autoscale,
    },
    {
      id: 'checkout',
      title: 'Payment and compensation',
      description: 'Real local transactions, payment message timeout, branching and inventory restoration.',
      source: 'dbos-demo-apps/typescript/widget-store',
      flow: checkout,
    },
    {
      id: 'queue',
      title: 'Queued fan-out',
      description: 'Start all child workflows before collecting their results in input order.',
      source: 'dbos-demo-apps/typescript/dbos-node-toolbox',
      flow: queued,
    },
    {
      id: 'loop',
      title: 'Stateful loop',
      description: 'A bounded loop with separate child execution identities and accumulated state.',
      source: 'dbos-demo-apps/typescript/hacker-news-agent · control-flow pattern',
      flow: loop,
    },
    {
      id: 'transactions',
      title: 'Transactional toolbox',
      description: 'Datasource transactions preserve data and checkpoint results atomically.',
      source: 'dbos-demo-apps/typescript/dbos-node-toolbox',
      flow: transaction,
    },
    {
      id: 'delayed',
      title: 'Delayed dispatch',
      description: 'Delay starting a queued child, then await its result.',
      source: 'dbos-demo-apps/typescript/queue-patterns',
      flow: delayed,
    },
  ].map((example) => ({
    ...example,
    flow: { ...example.flow, sourceReference: example.source, description: example.description },
  }));
}
