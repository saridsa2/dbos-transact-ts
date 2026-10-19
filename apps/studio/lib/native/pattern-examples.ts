import { graph, node, edge, end, object } from './graph';
import { input, output, literal, type Binding } from './model';
import type { AgentFlow } from '../flows/types';
const item: Binding = { source: 'item' };
const state: Binding = { source: 'state' };
const step = (id: string, name: string, handler: string, binding: Binding) =>
  node(id, name, { kind: 'step', handler, input: binding });
const txn = (id: string, name: string, handler: string, binding: Binding) =>
  node(id, name, { kind: 'transaction', handler, input: binding });
const event = (id: string, key: string, value: Binding) => node(id, `Publish ${key}`, { kind: 'event', key, value });
function branchLayout(flow: AgentFlow) {
  flow.nodes.forEach((node, index) => {
    node.position = { x: -700 + (index % 4) * 380, y: Math.floor(index / 4) * 300 };
  });
  return flow;
}
export function patternExamples(): {
  id: string;
  title: string;
  description: string;
  source: string;
  flow: AgentFlow;
}[] {
  const page = graph('index-page', 'Index one page', [
    txn('index', 'Index page in Postgres', 'example.document.index', item),
    end(output('index')),
  ]);
  const document = graph('index-document', 'Parse and index one document', [
    step('parse', 'Parse document into text pages', 'example.document.parse', item),
    node('pages', 'Index every page', {
      kind: 'foreach',
      workflowRef: 'index-page',
      items: output('parse'),
      mode: 'sequential',
      maxItems: 1000,
    }),
    step(
      'summary',
      'Count indexed pages',
      'example.document.summary',
      object({ document: item, pages: output('pages') }),
    ),
    end(output('summary')),
  ]);
  const documents = graph('document-ingestion', 'Document ingestion pipeline', [
    node('enqueue', 'Enqueue every document', {
      kind: 'foreach',
      workflowRef: 'index-document',
      items: input('variables.documents'),
      mode: 'start',
      queueRef: 'indexing',
      maxItems: 100,
    }),
    node('collect', 'Collect document results', { kind: 'await', handles: output('enqueue') }),
    step('totals', 'Aggregate document and page totals', 'example.document.totals', output('collect')),
    event('progress', 'indexing_complete', output('totals')),
    end(output('totals')),
  ]);
  documents.definitions = { 'index-document': document, 'index-page': page };
  documents.queues = [{ key: 'indexing', globalConcurrency: 3 }];
  documents.defaultInput = {
    variables: {
      documents: [
        {
          id: 'guide',
          title: 'Workflow guide',
          text: 'A workflow checkpoints completed operations.\fQueues control concurrency.',
        },
        {
          id: 'notes',
          title: 'Recovery notes',
          pages: ['Restarting replays completed steps.', 'A durable wait survives a restart.'],
        },
      ],
    },
  };

  const human = branchLayout(
    graph(
      'human-review',
      'Human-in-the-loop',
      [
        event('pending', 'agent_status', literal('pending_approval')),
        node('review', 'Review request', {
          kind: 'review',
          instruction: input('variables.instruction'),
          timeoutSeconds: input('variables.timeoutSeconds'),
        }),
        node('decision', 'Approved?', {
          kind: 'decision',
          predicate: { operator: 'truthy', left: output('review', 'approved') },
        }),
        event('working', 'agent_status', literal('working')),
        step('work', 'Continue approved task', 'core.identity', input('variables.task')),
        node('approved', 'Return successful task', {
          kind: 'return',
          value: object({ status: literal('approved'), task: output('work') }),
        }),
        event('denied', 'agent_status', literal('denied')),
        node('rejected', 'Return denied task', { kind: 'return', value: literal({ status: 'denied' }) }),
      ],
      [
        edge('start', 'pending'),
        edge('pending', 'review'),
        edge('review', 'decision'),
        edge('review', 'denied', 'timeout'),
        edge('decision', 'working', 'true'),
        edge('decision', 'denied', 'false'),
        edge('working', 'work'),
        edge('work', 'approved'),
        edge('denied', 'rejected'),
      ],
    ),
  );
  human.defaultInput = {
    variables: {
      task: 'Publish the reviewed report',
      instruction: 'Review this report before publishing. Approve or reject using Resolve.',
      timeoutSeconds: 300,
    },
  };

  const outbox = graph('outbox', 'Transactional outbox workflow', [
    txn('insert', 'Create order atomically', 'example.order.create', input('variables')),
    event('created', 'order_id_event', output('insert', 'orderId')),
    node('dispatch-gap', 'Wait before notification', { kind: 'delay', durationMS: input('variables.delayMS') }),
    step('notify', 'Deliver local order notification', 'example.order.notify', output('insert')),
    txn('sent', 'Mark notification sent', 'example.order.sent', output('insert')),
    end(output('sent')),
  ]);
  outbox.nodes.find((node) => node.id === 'notify')!.config.execution = { maxAttempts: 3, intervalSeconds: 0.1 };
  outbox.defaultInput = {
    variables: { customer: 'Example customer', item: 'Durable workflow handbook', quantity: 1, delayMS: 1000 },
  };

  const iteration = graph('worker-iteration', 'Worker iteration', [
    node('wait', 'Simulate work duration', { kind: 'delay', durationMS: literal(150) }),
    step('advance', 'Complete one work item', 'example.increment', state),
    event('progress', 'workflow_progress', output('advance')),
    end(output('advance')),
  ]);
  const workerBody = graph('worker-job', 'Background worker job', [
    event('started', 'workflow_progress', literal({ count: 0 })),
    node('work', 'Process bounded work items', {
      kind: 'loop',
      workflowRef: 'worker-iteration',
      initial: literal({ count: 0 }),
      while: { operator: 'lt', left: { source: 'state', path: 'count' }, right: input('variables.numSteps') },
      maxIterations: 100,
    }),
    event('finished', 'workflow_progress', output('work', 'state')),
    end(output('work')),
  ]);
  const worker = graph('queue-worker', 'Queue worker', [
    node('enqueue', 'Submit job to worker queue', {
      kind: 'workflow',
      workflowRef: 'worker-job',
      input: input('variables'),
      mode: 'start',
      queueRef: 'workers',
    }),
    node('collect', 'Await background job', { kind: 'await', handles: output('enqueue') }),
    end(output('collect')),
  ]);
  worker.definitions = { 'worker-job': workerBody, 'worker-iteration': iteration };
  worker.queues = [{ key: 'workers', globalConcurrency: 2, workerConcurrency: 2 }];
  worker.defaultInput = { variables: { numSteps: 4 } };

  const deployment = graph('deployment-job', 'Deployment stages', [
    event('started', 'deploy_status', literal('started')),
    ...['build', 'test', 'deploy'].flatMap((phase) => [
      step(phase, `Run local ${phase} example`, 'example.deployment.stage', literal({ phase })),
      step(
        `${phase}-notice`,
        `Record ${phase} notification`,
        'example.notification',
        literal({ channel: 'local-deployments', message: `${phase} completed` }),
      ),
      event(`${phase}-status`, 'deploy_status', literal(`${phase}_completed`)),
    ]),
    end(literal({ status: 'deployed', adapter: 'local-example' })),
  ]);
  const deploy = graph('deployment-tracker', 'CI/CD Slackbot pattern', [
    node('enqueue', 'Enqueue deployment', {
      kind: 'workflow',
      workflowRef: 'deployment-job',
      input: input('variables'),
      mode: 'start',
      queueRef: 'deployments',
    }),
    node('collect', 'Await deployment', { kind: 'await', handles: output('enqueue') }),
    end(output('collect')),
  ]);
  deploy.definitions = { 'deployment-job': deployment };
  deploy.queues = [{ key: 'deployments', globalConcurrency: 1 }];
  deploy.defaultInput = { variables: {} };

  const transfer = graph('copy-object', 'Copy one object', [
    step('copy', 'Copy object into local mirror', 'example.mirror.copy', item),
    end(output('copy')),
  ]);
  transfer.nodes.find((node) => node.id === 'copy')!.config.execution = { maxAttempts: 3, intervalSeconds: 0.1 };
  const mirror = graph('object-mirror', 'S3Mirror pattern', [
    step('plan', 'List and filter missing objects', 'example.mirror.plan', input('variables')),
    node('enqueue', 'Enqueue missing object copies', {
      kind: 'foreach',
      workflowRef: 'copy-object',
      items: output('plan'),
      mode: 'start',
      queueRef: 'transfers',
      maxItems: 100,
    }),
    event('tasks', 'tasks', output('enqueue')),
    end(output('enqueue')),
  ]);
  mirror.definitions = { 'copy-object': transfer };
  mirror.queues = [{ key: 'transfers', globalConcurrency: 15, workerConcurrency: 3 }];
  mirror.defaultInput = {
    variables: {
      source: [
        { key: 'guide.txt', content: 'Workflow guide' },
        { key: 'notes.txt', content: 'Recovery notes' },
        { key: 'already-copied.txt', content: 'Skip this object' },
      ],
      existingKeys: ['already-copied.txt'],
    },
  };

  const refundReview = branchLayout(
    graph(
      'refund-review',
      'Review high-value refund',
      [
        node('review', 'Review refund request', {
          kind: 'review',
          instruction: literal('Approve or reject this high-value refund. This changes local example records only.'),
          timeoutSeconds: input('variables.timeoutSeconds'),
        }),
        node('approved', 'Refund approved?', {
          kind: 'decision',
          predicate: { operator: 'truthy', left: output('review', 'approved') },
        }),
        txn(
          'refund',
          'Record approved refund',
          'example.refund.status',
          object({ orderId: input('variables.orderId'), status: literal('REFUNDED') }),
        ),
        node('success', 'Return approval', { kind: 'return', value: output('refund') }),
        txn(
          'deny',
          'Record rejected refund',
          'example.refund.status',
          object({ orderId: input('variables.orderId'), status: literal('REFUND_REJECTED') }),
        ),
        node('failure', 'Return rejection', { kind: 'return', value: output('deny') }),
      ],
      [
        edge('start', 'review'),
        edge('review', 'approved'),
        edge('review', 'deny', 'timeout'),
        edge('approved', 'refund', 'true'),
        edge('approved', 'deny', 'false'),
        edge('refund', 'success'),
        edge('deny', 'failure'),
      ],
    ),
  );
  const refund = branchLayout(
    graph(
      'customer-refund',
      'Customer service refund flow',
      [
        txn('lookup', 'Look up local example purchase', 'example.refund.lookup', input('variables')),
        node('threshold', 'Price exceeds review threshold?', {
          kind: 'decision',
          predicate: { operator: 'gt', left: output('lookup', 'price'), right: literal(1000) },
        }),
        txn(
          'pending',
          'Mark pending review',
          'example.refund.status',
          object({ orderId: output('lookup', 'orderId'), status: literal('PENDING_REFUND') }),
        ),
        node('start-review', 'Start human review in background', {
          kind: 'workflow',
          workflowRef: 'refund-review',
          input: object({ orderId: output('lookup', 'orderId'), timeoutSeconds: input('variables.timeoutSeconds') }),
          mode: 'start',
        }),
        node('pending-result', 'Return pending review', {
          kind: 'return',
          value: object({ status: literal('pending-review'), reviewRunId: output('start-review') }),
        }),
        txn(
          'refund',
          'Refund low-value order',
          'example.refund.status',
          object({ orderId: output('lookup', 'orderId'), status: literal('REFUNDED') }),
        ),
        node('success', 'Return automatic refund', { kind: 'return', value: output('refund') }),
      ],
      [
        edge('start', 'lookup'),
        edge('lookup', 'threshold'),
        edge('threshold', 'pending', 'true'),
        edge('pending', 'start-review'),
        edge('start-review', 'pending-result'),
        edge('threshold', 'refund', 'false'),
        edge('refund', 'success'),
      ],
    ),
  );
  refund.definitions = { 'refund-review': refundReview };
  refund.defaultInput = {
    variables: { customer: 'Example customer', item: 'Example purchase', price: 1500, timeoutSeconds: 300 },
  };

  const researchBody = graph('research-pass', 'Search and accumulate findings', [
    step(
      'search',
      'Search supplied local article corpus',
      'example.research.search',
      object({ state, articles: input('variables.articles'), topic: input('variables.topic') }),
    ),
    end(output('search')),
  ]);
  const research = graph('research-pattern', 'Hacker News research pattern', [
    node('research', 'Run bounded research passes', {
      kind: 'loop',
      workflowRef: 'research-pass',
      initial: literal({ count: 0, findings: [], queries: [] }),
      while: { operator: 'lt', left: { source: 'state', path: 'count' }, right: input('variables.maxPasses') },
      maxIterations: 10,
    }),
    step('report', 'Assemble findings and source links', 'example.research.report', output('research', 'state')),
    end(output('report')),
  ]);
  research.definitions = { 'research-pass': researchBody };
  research.defaultInput = {
    variables: {
      topic: 'durable workflows',
      maxPasses: 2,
      articles: [
        {
          id: '1',
          title: 'Durable workflows and recovery',
          text: 'Checkpointing lets workflows resume after a crash.',
          url: 'https://news.ycombinator.com/',
        },
        {
          id: '2',
          title: 'Workflow queues',
          text: 'Queues limit concurrent workflow execution.',
          url: 'https://news.ycombinator.com/',
        },
      ],
    },
  };
  return [
    {
      id: 'documents',
      title: 'Document ingestion pipeline',
      description:
        'Queue documents, parse text pages, index them in local Postgres and collect totals. PDF/vector adapters remain configurable.',
      source: 'dbos-demo-apps/python/document-detective',
      flow: documents,
    },
    {
      id: 'human-review',
      title: 'Human-in-the-loop',
      description:
        'Publish pending status, wait for an actual reviewer decision, then continue or deny. Resolve opens the review form.',
      source: 'dbos-demo-apps/python/agent-inbox',
      flow: human,
    },
    {
      id: 'outbox',
      title: 'Transactional outbox',
      description:
        'Commit an order, deliver an idempotent local notification, then record sent status. Restart in the gap to test recovery.',
      source: 'dbos-demo-apps/python/transactional-outbox/atomic_workflow.py',
      flow: outbox,
    },
    {
      id: 'worker',
      title: 'Queue worker',
      description:
        'Submit a job to a worker queue, execute bounded work items and publish progress. Runs through the local Studio worker.',
      source: 'dbos-demo-apps/typescript/queue-worker',
      flow: worker,
    },
    {
      id: 'refund',
      title: 'Customer service refund flow',
      description:
        'Apply a price policy, automatically refund small orders or start a human review child. Uses local records; no model or payment calls.',
      source: 'dbos-demo-apps/python/reliable-refunds-langchain',
      flow: refund,
    },
    {
      id: 'deploy',
      title: 'CI/CD Slackbot pattern',
      description:
        'Serialize deployment jobs and track build/test/deploy events with local notification records. Slack and deployment adapters are replaceable.',
      source: 'dbos-demo-apps/python/deploy-tracker-slackbot',
      flow: deploy,
    },
    {
      id: 'mirror',
      title: 'S3Mirror pattern',
      description:
        'Filter existing keys, start queued copy children and publish their IDs. Copies supplied objects into a local mirror, without AWS access.',
      source: 'dbos-demo-apps/python/s3mirror',
      flow: mirror,
    },
    {
      id: 'research',
      title: 'Hacker News research pattern',
      description:
        'Search a supplied article corpus, accumulate findings across bounded passes and produce source links. No live search or model calls.',
      source: 'dbos-demo-apps/typescript/hacker-news-agent · control/data pattern',
      flow: research,
    },
  ];
}
