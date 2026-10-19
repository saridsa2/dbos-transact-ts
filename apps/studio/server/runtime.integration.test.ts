import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankNativeGraph } from '../lib/native/examples';
import { scopedExamples } from '../lib/authoring/examples';
import { defaultCode } from '../lib/authoring/model';
import { nativeExamples } from '../lib/native/examples';
import { createStarterFlow } from '../lib/flows/templates';
import type { AgentFlow, FlowRunEvent } from '../lib/flows/types';

describe.skipIf(process.env.STUDIO_INTEGRATION !== '1')('DBOS/Postgres service integration', () => {
  let service: ChildProcess | undefined;
  let pool: pg.Pool;
  let log = '';
  const base = 'http://127.0.0.1:3022';
  const appUrl = 'postgresql://postgres:dbos@127.0.0.1:55432/studio_integration';
  function clientApi() {
    const cookies = new Map<string, string>();
    return async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
      const response = await fetch(`${base}${path}`, { ...init, headers });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0];
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    };
  }
  const api = clientApi();
  const post = (client: ReturnType<typeof clientApi>, path: string, value: unknown, method = 'POST') =>
    client(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  async function start() {
    service = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUDIO_PORT: '3022',
        STUDIO_DATABASE_URL: appUrl,
        DBOS_SYSTEM_DATABASE_URL: 'postgresql://postgres:dbos@127.0.0.1:55432/studio_integration_dbos',
        STUDIO_ADAPTER_MODULE: 'server/fixtures/integration-adapter.ts',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    service.stdout!.on('data', (chunk) => {
      log = (log + chunk).slice(-10000);
    });
    service.stderr!.on('data', (chunk) => {
      log = (log + chunk).slice(-10000);
    });
    for (let i = 0; i < 200; i++) {
      if (service.exitCode !== null) throw new Error(`Service exited: ${log}`);
      if (
        await api(`/api/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        return;
      await delay(100);
    }
    throw new Error(`Service failed to start: ${log}`);
  }
  async function crash() {
    if (service && service.exitCode === null) {
      const exit = once(service, 'exit');
      service.kill('SIGKILL');
      await exit;
    }
    service = undefined;
  }
  async function request(path: string, payload: unknown, method = 'POST') {
    return api(`${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  async function save(flow: AgentFlow) {
    const response = await request('/api/flows', flow);
    expect(response.status).toBe(201);
    return (await response.json()) as AgentFlow;
  }
  async function run(flow: AgentFlow, input = {}) {
    const response = await request('/api/flows/run', { flow, input });
    expect(response.status).toBe(200);
    return (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as FlowRunEvent);
  }
  const example = (id: string) => structuredClone(nativeExamples().find((item) => item.id === id)!.flow);
  async function terminal(id: string) {
    for (let i = 0; i < 200; i++) {
      const detail = await api(`/api/runs/${id}`).then((response) => response.json());
      if (['succeeded', 'failed'].includes(detail.status)) return detail;
      await delay(100);
    }
    throw new Error(`Run did not finish: ${id}\n${log}`);
  }
  async function nativeRun(id: string, variables?: Record<string, unknown>) {
    const draft = example(id);
    const flow = await save(draft);
    const events = await run(flow, variables ? { variables } : flow.defaultInput);
    return terminal(events[0].runId);
  }
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/studio' });
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='studio_integration'")).rowCount)
      await admin.query('CREATE DATABASE studio_integration');
    await admin.end();
    pool = new pg.Pool({ connectionString: appUrl });
    await pool.query('CREATE TABLE IF NOT EXISTS studio_test_effects(effect_key text NOT NULL)');
    await start();
    expect(
      (
        await request('/api/control/session/development', {
          email: `owner-${crypto.randomUUID()}@example.test`,
          displayName: 'Integration owner',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('/api/control/onboarding', {
          customerName: 'Integration customer',
          workspaceName: 'Integration workspace',
        })
      ).status,
    ).toBe(201);
  }, 30000);
  afterAll(async () => {
    await crash();
    await pool?.end();
  });

  it('recovers a waiting run after SIGKILL without repeating its completed tool, and uses the original graph snapshot', async () => {
    const effectKey = crypto.randomUUID();
    const draft = createStarterFlow();
    draft.nodes.push({
      id: 'counter',
      kind: 'tool',
      name: 'Record side effect',
      position: { x: 0, y: 0 },
      config: { toolId: 'integration-counter' },
    });
    draft.edges = draft.edges.filter((edge) => edge.id !== 'e1');
    draft.edges.push(
      { id: 'to-counter', source: 'trigger-1', target: 'counter' },
      { id: 'from-counter', source: 'counter', target: 'prompt-1' },
    );
    const flow = await save(draft);
    const events = await run(flow, { userInput: 'Recovery request', variables: { effectKey } });
    const runId = events[0].runId;
    expect(events.at(-1)?.type).toBe('run.waiting');
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM studio_test_effects WHERE effect_key=$1', [effectKey])).rows[0]
        .n,
    ).toBe(1);
    // The durable run must not switch to this newly edited graph on recovery.
    await request(
      `/api/flows/${flow.id}`,
      { ...flow, name: 'Edited while running', nodes: [flow.nodes[0]], edges: [] },
      'PUT',
    );
    await crash();
    await start();
    const approvals = await api(`/api/escalations`).then((response) => response.json());
    const approval = approvals.find((item: { runId: string }) => item.runId === runId);
    expect(approval).toBeTruthy();
    const decision = await request(`/api/escalations/${approval.id}`, { action: 'approve', note: 'Restart verified' });
    expect(decision.status).toBe(200);
    const stream = await api(`/api/runs/${runId}/events`);
    await stream.text();
    const detail = await api(`/api/runs/${runId}`).then((response) => response.json());
    expect(detail.status).toBe('succeeded');
    expect(detail.output).toHaveProperty('output-approved');
    expect(detail.output).not.toHaveProperty('output-rejected');
    expect(
      detail.events.filter(
        (row: { event: FlowRunEvent }) => row.event.type === 'node.completed' && row.event.nodeId === 'counter',
      ),
    ).toHaveLength(1);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM studio_test_effects WHERE effect_key=$1', [effectKey])).rows[0]
        .n,
    ).toBe(1);
  });
  it('routes rejected decisions and rejects duplicate decisions', async () => {
    const flow = await save(createStarterFlow());
    const events = await run(flow);
    const runId = events[0].runId;
    const approvals = await api(`/api/escalations`).then((response) => response.json());
    const approval = approvals.find((item: { runId: string }) => item.runId === runId);
    expect((await request(`/api/escalations/${approval.id}`, { action: 'reject' })).status).toBe(200);
    expect((await request(`/api/escalations/${approval.id}`, { action: 'approve' })).status).toBe(409);
    await (await api(`/api/runs/${runId}/events`)).text();
    const detail = await api(`/api/runs/${runId}`).then((response) => response.json());
    expect(detail.output).toHaveProperty('output-rejected');
    expect(detail.output).not.toHaveProperty('output-approved');
  });
  it('fails a tool run honestly and blocks cyclic graphs before dispatch', async () => {
    const draft = createStarterFlow();
    draft.nodes[1].kind = 'tool';
    draft.nodes[1].config = { toolId: 'missing' };
    const flow = await save(draft);
    const events = await run(flow);
    expect(events.at(-1)?.type).toBe('run.failed');
    flow.edges.push({ id: 'cycle', source: 'prompt-1', target: 'trigger-1' });
    expect((await request('/api/flows/run', { flow })).status).toBe(400);
  });
  it('runs nested health/replacement graphs and persists progress and child identities', async () => {
    const detail = await nativeRun('autoscaling');
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toHaveLength(2);
    expect(detail.children).toHaveLength(5);
    expect(new Set(detail.children.map((child: { id: string }) => child.id)).size).toBe(5);
    expect(
      detail.events.filter(
        (row: { event: FlowRunEvent }) =>
          row.event.type === 'node.completed' && ['checking', 'replacing', 'done'].includes(row.event.nodeId),
      ),
    ).toHaveLength(3);
  });
  it('starts queued children before collection and preserves input order', async () => {
    const detail = await nativeRun('queue');
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual(['task-a', 'task-b', 'task-c']);
    expect(detail.children).toHaveLength(3);
    const launch = detail.events.find(
      (row: { event: FlowRunEvent }) => row.event.type === 'node.completed' && row.event.nodeId === 'launch',
    );
    expect(launch.event.output).toHaveLength(3);
    expect(new Set(launch.event.output)).toEqual(new Set(detail.children.map((child: { id: string }) => child.id)));
  });
  it('gives each loop iteration a child execution and carries state forward', async () => {
    const detail = await nativeRun('loop');
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ state: { count: 3 }, iterations: 3 });
    expect(detail.children).toHaveLength(3);
    expect(new Set(detail.children.map((child: { id: string }) => child.id)).size).toBe(3);
  });
  it('uses datasource transactions and restores inventory on payment timeout', async () => {
    const ledger = await nativeRun('transactions');
    expect(ledger.status).toBe('succeeded');
    expect(ledger.output.result).toBe(1);
    const detail = await nativeRun('checkout', { timeoutSeconds: 0.15 });
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ status: 'cancelled' });
    expect(
      (await pool.query('SELECT available FROM studio_example_inventory WHERE run_id=$1', [detail.id])).rows[0]
        .available,
    ).toBe(1);
    expect(
      detail.events.some(
        (row: { event: FlowRunEvent }) => row.event.type === 'node.skipped' && row.event.nodeId === 'record',
      ),
    ).toBe(true);
  });
  it('recovers a native payment wait without reserving twice and receives an idempotent message', async () => {
    const flow = await save(example('checkout'));
    const events = await run(flow, { variables: { timeoutSeconds: 20 } });
    const id = events[0].runId;
    expect(events.at(-1)?.type).toBe('run.waiting');
    await crash();
    await start();
    const message = { topic: 'payment', value: 'paid', idempotencyKey: crypto.randomUUID() };
    expect((await request(`/api/runs/${id}/messages`, message)).status).toBe(202);
    const detail = await terminal(id);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ status: 'paid' });
    expect(
      (await pool.query('SELECT available FROM studio_example_inventory WHERE run_id=$1', [id])).rows[0].available,
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM studio_example_ledger WHERE run_id=$1', [id])).rows[0].n,
    ).toBe(1);
    expect(
      detail.events.filter(
        (row: { event: FlowRunEvent }) => row.event.type === 'node.completed' && row.event.nodeId === 'reserve',
      ),
    ).toHaveLength(1);
  });
  it('recovers a durable delay and dispatches a delayed child through its queue', async () => {
    const flow = await save(example('reminder'));
    const events = await run(flow, { variables: { email: 'recovery@example.test', delayMS: 1800 } });
    const id = events[0].runId;
    await crash();
    await start();
    const detail = await terminal(id);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ reminder: 'recovery@example.test' });
    expect(
      detail.events.filter(
        (row: { event: FlowRunEvent }) => row.event.type === 'node.completed' && row.event.nodeId === 'confirmation',
      ),
    ).toHaveLength(1);
    const delayed = await nativeRun('delayed', { delaySeconds: 0.3 });
    expect(delayed.status).toBe('succeeded');
    expect(delayed.output.result).toBe('delayed task');
  }, 15000);

  it('coalesces keyed invocations using the latest input and recovers the pending dispatch', async () => {
    const draft = example('reminder');
    draft.nodes = draft.nodes.filter((node) => !['confirmation', 'wait'].includes(node.id));
    draft.edges = [
      { id: 'a', source: 'start', target: 'reminder' },
      { id: 'b', source: 'reminder', target: 'result' },
    ];
    const flow = await save(draft);
    const key = crypto.randomUUID();
    const dispatch = async (email: string) =>
      (
        await request(`/api/flows/${flow.id}/debounce`, { key, periodMS: 1800, input: { variables: { email } } })
      ).json();
    const first = await dispatch('first@example.test');
    const latest = await dispatch('latest@example.test');
    expect(first.runId).toBeTruthy();
    expect(latest.runId).toBe(first.runId);
    expect(latest.scheduledFor).toBeGreaterThanOrEqual(first.scheduledFor);
    await crash();
    await start();
    const detail = await terminal(first.runId);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ reminder: 'latest@example.test' });
    const next = await dispatch('next@example.test');
    expect(next.runId).not.toBe(first.runId);
    const rerun = await terminal(next.runId);
    expect(rerun.output.result).toEqual({ reminder: 'next@example.test' });
    expect((await pool.query('SELECT count(*)::int AS n FROM studio_runs WHERE flow_id=$1', [flow.id])).rows[0].n).toBe(
      2,
    );
  }, 15000);
  it('invokes saved schedules and removes the schedule when disabled', async () => {
    const draft = example('transactions');
    draft.schedule = { enabled: true, cron: '*/1 * * * * *', timezone: 'UTC' };
    const flow = await save(draft);
    let rows: { id: string }[] = [];
    for (let i = 0; i < 60; i++) {
      rows = (await pool.query('SELECT id FROM studio_runs WHERE flow_id=$1', [flow.id])).rows;
      if (rows.length) break;
      await delay(100);
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(
      (await request(`/api/flows/${flow.id}`, { ...flow, schedule: { ...flow.schedule, enabled: false } }, 'PUT'))
        .status,
    ).toBe(200);
    expect((await terminal(rows[0].id)).status).toBe('succeeded');
    expect(
      (await request(`/api/flows/${flow.id}`, { ...flow, schedule: { enabled: true, cron: 'invalid' } }, 'PUT')).status,
    ).toBe(400);
    const saved = await api(`/api/flows/${flow.id}`).then((response) => response.json());
    expect(saved.schedule.enabled).toBe(false);
    const invalid = example('transactions');
    invalid.schedule = { enabled: true, cron: '*/1 * * * * *' };
    invalid.nodes[1].config.operation = {
      kind: 'transaction',
      handler: 'missing.handler',
      input: { source: 'literal', value: null },
    };
    const before = (await pool.query('SELECT count(*)::int AS n FROM studio_flows')).rows[0].n;
    expect((await request('/api/flows', invalid)).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM studio_flows')).rows[0].n).toBe(before);
  }, 15000);
  it('executes parallel child scopes and publishes/waits for events and sends/receives messages', async () => {
    const draft = example('queue');
    draft.nodes = draft.nodes.filter((node) => node.id !== 'collect');
    draft.nodes.find((node) => node.id === 'launch')!.kind = 'parallel';
    draft.nodes.find((node) => node.id === 'launch')!.config.operation = {
      kind: 'parallel',
      branches: [
        { workflowRef: 'queue-task', input: { source: 'literal', value: { item: 'left' } } },
        { workflowRef: 'queue-task', input: { source: 'literal', value: { item: 'right' } } },
      ],
    };
    draft.nodes.find((node) => node.id === 'result')!.config.operation = {
      kind: 'return',
      value: { source: 'node', nodeId: 'launch' },
    };
    draft.edges = [
      { id: 'a', source: 'start', target: 'launch' },
      { id: 'b', source: 'launch', target: 'result' },
    ];
    const parallel = await save(draft);
    const events = await run(parallel, {});
    const detail = await terminal(events[0].runId);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual(['left', 'right']);
    const message = example('transactions');
    const ownID = { source: 'execution', path: 'workflowID' } as const;
    const literal = (value: unknown) => ({ source: 'literal', value }) as const;
    const operations = [
      { kind: 'event', key: 'ready', value: literal({ ready: true }) },
      { kind: 'waitEvent', workflowID: ownID, key: 'ready', timeoutSeconds: literal(1) },
      { kind: 'send', workflowID: ownID, topic: 'self', value: literal('hello') },
      { kind: 'receive', topic: 'self', timeoutSeconds: literal(1) },
      { kind: 'return', value: { source: 'node', nodeId: 'operation-3' } },
    ];
    message.nodes = [
      message.nodes[0],
      ...operations.map((operation, index) => ({
        id: `operation-${index}`,
        kind: operation.kind,
        name: operation.kind,
        position: { x: index * 400, y: 0 },
        config: { operation },
      })),
    ] as AgentFlow['nodes'];
    message.edges = message.nodes
      .slice(0, -1)
      .map((node, index) => ({ id: `edge-${index}`, source: node.id, target: message.nodes[index + 1].id }));
    const flow = await save(message);
    const sent = await run(flow, {});
    const received = await terminal(sent[0].runId);
    expect(received.status).toBe('succeeded');
    expect(received.output.result).toBe('hello');
  });
  it('binds queue partitions per collection item', async () => {
    const draft = example('queue');
    draft.queues![0].partitionConcurrency = 1;
    const operation = draft.nodes.find((node) => node.id === 'launch')!.config.operation!;
    if (operation.kind !== 'foreach') throw new Error('Invalid fixture');
    operation.partition = { source: 'item', path: 'tenant' };
    const flow = await save(draft);
    const input = [
      { tenant: 'a', value: 1 },
      { tenant: 'b', value: 2 },
      { tenant: 'a', value: 3 },
    ];
    const events = await run(flow, { variables: { tasks: input } });
    const detail = await terminal(events[0].runId);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual(input);
  });
  async function approvalFor(id: string) {
    for (let i = 0; i < 50; i++) {
      const approvals = await api(`/api/escalations`).then((response) => response.json());
      const approval = approvals.find((item: { runId: string }) => item.runId === id);
      if (approval) return approval;
      await delay(50);
    }
    throw new Error('Review task did not appear.');
  }
  it('indexes document pages in nested queued workflows and recovers without duplicate index rows', async () => {
    const draft = example('documents');
    draft.nodes.push({
      id: 'pause',
      kind: 'delay',
      name: 'Pause after dispatch',
      position: { x: 0, y: 0 },
      config: { operation: { kind: 'delay', durationMS: { source: 'literal', value: 1500 } } },
    });
    draft.edges = draft.edges.filter((edge) => edge.source !== 'enqueue');
    draft.edges.push(
      { id: 'pause-in', source: 'enqueue', target: 'pause' },
      { id: 'pause-out', source: 'pause', target: 'collect' },
    );
    const flow = await save(draft);
    const events = await run(flow, flow.defaultInput);
    const id = events[0].runId;
    expect(events.at(-1)?.type).toBe('run.waiting');
    await crash();
    await start();
    const detail = await terminal(id);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toMatchObject({ documentCount: 2, pageCount: 4 });
    const ids = detail.children.map((child: { id: string }) => child.id);
    expect(ids).toHaveLength(2);
    const pages = await pool.query(
      "SELECT p.* FROM studio_example_pages p JOIN studio_runs r ON p.execution_id=r.id||'/index' WHERE r.parent_id=ANY($1::text[])",
      [ids],
    );
    expect(pages.rows).toHaveLength(4);
    expect(new Set(pages.rows.map((row) => row.execution_id)).size).toBe(4);
    expect(pages.rows.every((row) => row.search_vector !== null)).toBe(true);
  }, 15000);
  it('supports native human approve/reject decisions and expires timed-out review tasks', async () => {
    for (const action of ['approve', 'reject']) {
      const flow = await save(example('human-review'));
      const events = await run(flow, flow.defaultInput);
      const id = events[0].runId;
      const approval = await approvalFor(id);
      expect(approval.instruction).toContain('Review this report');
      expect((await request(`/api/escalations/${approval.id}`, { action })).status).toBe(200);
      const detail = await terminal(id);
      expect(detail.status).toBe('succeeded');
      expect(detail.output.result.status).toBe(action === 'approve' ? 'approved' : 'denied');
    }
    const detail = await nativeRun('human-review', {
      task: 'Timeout test',
      instruction: 'Expire this review',
      timeoutSeconds: 0.15,
    });
    expect(detail.output.result).toEqual({ status: 'denied' });
    expect((await pool.query('SELECT status FROM studio_approvals WHERE run_id=$1', [detail.id])).rows[0].status).toBe(
      'expired',
    );
  });
  it('recovers the outbox gap, sends one local notification and commits sent status', async () => {
    const flow = await save(example('outbox'));
    const events = await run(flow, {
      variables: { customer: 'Local tester', item: 'Book', quantity: 1, delayMS: 1500 },
    });
    const id = events[0].runId;
    expect(
      (await pool.query('SELECT notification_status FROM studio_example_orders WHERE id=$1', [id])).rows[0]
        .notification_status,
    ).toBe('PENDING');
    await crash();
    await start();
    const detail = await terminal(id);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual({ orderId: id, status: 'SENT' });
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM studio_example_notifications WHERE id=$1', [`${id}/notify`]))
        .rows[0].n,
    ).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM studio_example_orders WHERE id=$1', [id])).rows[0].n).toBe(
      1,
    );
  }, 15000);
  it('runs queued worker/deployment examples and detached mirror copies with progress', async () => {
    const worker = await nativeRun('worker');
    expect(worker.status).toBe('succeeded');
    expect(worker.output.result).toEqual({ state: { count: 4 }, iterations: 4 });
    const deploy = await nativeRun('deploy');
    expect(deploy.status).toBe('succeeded');
    expect(deploy.output.result).toMatchObject({ status: 'deployed', adapter: 'local-example' });
    const deployment = await terminal(deploy.children[0].id);
    expect(
      deployment.events.filter(
        (row: { event: FlowRunEvent }) => row.event.type === 'node.completed' && row.event.nodeId.endsWith('-status'),
      ),
    ).toHaveLength(3);
    const mirror = await nativeRun('mirror');
    expect(mirror.status).toBe('succeeded');
    expect(mirror.output.result).toHaveLength(2);
    for (const id of mirror.output.result) {
      const child = await terminal(id);
      expect(child.output.result.copied).toBe(true);
      expect(child.output.result.key).not.toBe('already-copied.txt');
    }
  }, 20000);
  it('routes high-value refunds to a detached reviewer and automatically refunds small orders', async () => {
    const low = await nativeRun('refund', { customer: 'Local tester', item: 'Book', price: 50, timeoutSeconds: 20 });
    expect(low.output.result.status).toBe('REFUNDED');
    expect(low.children).toHaveLength(0);
    const high = await nativeRun('refund');
    expect(high.output.result.status).toBe('pending-review');
    const id = high.output.result.reviewRunId;
    const approval = await approvalFor(id);
    expect((await request(`/api/escalations/${approval.id}`, { action: 'approve' })).status).toBe(200);
    const reviewed = await terminal(id);
    expect(reviewed.output.result.status).toBe('REFUNDED');
    expect(
      (await pool.query('SELECT status FROM studio_example_refunds WHERE order_id=$1', [high.id])).rows[0].status,
    ).toBe('REFUNDED');
  });
  it('accumulates research findings and source links over bounded passes', async () => {
    const research = await nativeRun('research');
    expect(research.status).toBe('succeeded');
    expect(research.children).toHaveLength(2);
    expect(research.output.result).toMatchObject({
      passes: 2,
      queries: ['durable', 'workflows'],
      adapter: 'local-corpus',
    });
    expect(research.output.result.findings).toHaveLength(1);
    expect(research.output.result.findings[0].url).toBeTruthy();
  });
  it('scopes workflows, references, runs and connections to a customer workspace', async () => {
    const anonymous = clientApi();
    expect((await anonymous('/api/flows')).status).toBe(401);
    const other = clientApi();
    expect(
      (
        await post(other, '/api/control/session/development', {
          email: `other-${crypto.randomUUID()}@example.test`,
          displayName: 'Other customer',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(other, '/api/control/onboarding', {
          customerName: 'Other customer',
          workspaceName: 'Other workspace',
        })
      ).status,
    ).toBe(201);
    const ownerSession = await api('/api/control/session').then((response) => response.json());
    expect((await other('/api/flows', { headers: { 'x-studio-workspace': ownerSession.workspace.id } })).status).toBe(
      403,
    );
    const flow = await save(example('transactions'));
    expect((await other(`/api/flows/${flow.id}`)).status).toBe(404);
    expect((await post(other, `/api/flows/${flow.id}`, flow, 'PUT')).status).toBe(404);
    expect((await post(other, '/api/flows/run', { flow })).status).toBe(400);
    const privateChild = await save(example('reminder'));
    const draft = example('delayed');
    const operation = draft.nodes.find((node) => node.id === 'start-task')!.config.operation!;
    if (operation.kind !== 'workflow') throw new Error('Invalid fixture');
    operation.workflowRef = privateChild.id;
    delete draft.definitions;
    const created = await post(other, '/api/flows', draft);
    expect(created.status).toBe(201);
    const otherFlow = await created.json();
    expect(
      (await post(other, '/api/flows/run', { flow: otherFlow, input: { variables: { delaySeconds: 0 } } })).status,
    ).toBe(400);
    const events = await run(flow, flow.defaultInput);
    const runId = events[0].runId;
    expect((await other(`/api/runs/${runId}`)).status).toBe(404);
    expect((await other(`/api/runs/${runId}/events`)).status).toBe(404);
    const ownFlows = await other('/api/flows').then((response) => response.json());
    expect(ownFlows.some((item: { id: string }) => item.id === flow.id)).toBe(false);
  });
  it('stores encrypted credentials, returns metadata only, audits rotation and revokes access', async () => {
    const secret = `fixture-${crypto.randomUUID()}`;
    const created = await request('/api/control/connections', {
      name: 'OpenAI fixture',
      provider: 'openai',
      config: { project: 'fixture-project' },
      secret,
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const rows = await api('/api/control/connections').then((response) => response.json());
    const connection = rows.find((item: { id: string }) => item.id === id);
    expect(connection.hasSecret).toBe(true);
    expect(connection.revision).toBe(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(connection.validationStatus).toBe('not_tested');
    const sealed = (await pool.query('SELECT sealed FROM cp_connection_secrets WHERE connection_id=$1', [id])).rows[0]
      .sealed;
    expect(JSON.stringify(sealed)).not.toContain(secret);
    expect(
      (await request(`/api/control/connections/${id}/rotate`, { revision: 1, secret: 'rotated-fixture' })).status,
    ).toBe(200);
    expect(
      (await request(`/api/control/connections/${id}/rotate`, { revision: 1, secret: 'stale-fixture' })).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/control/connections/${id}`,
          { revision: 2, name: 'Updated fixture', config: { project: 'new-project' } },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await request(`/api/control/connections/${id}/revoke`, { revision: 3 })).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM cp_connection_secrets WHERE connection_id=$1', [id])).rowCount).toBe(0);
    const audit = await api('/api/control/audit').then((response) => response.json());
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).not.toContain('rotated-fixture');
    expect(
      audit.events
        .filter((event: { entityId: string }) => event.entityId === id)
        .map((event: { action: string }) => event.action),
    ).toEqual(['connection.revoked', 'connection.updated', 'credential.rotated', 'connection.created']);
  });
  it('binds invitations to email, prevents reuse and enforces viewer and editor permissions', async () => {
    const email = `viewer-${crypto.randomUUID()}@example.test`;
    const invite = await request('/api/control/invitations', { email, role: 'viewer' }).then((response) =>
      response.json(),
    );
    const outsider = clientApi();
    await post(outsider, '/api/control/session/development', {
      email: `wrong-${crypto.randomUUID()}@example.test`,
      displayName: 'Wrong invitee',
    });
    expect((await post(outsider, '/api/control/invitations/accept', { token: invite.token })).status).toBe(403);
    const viewer = clientApi();
    await post(viewer, '/api/control/session/development', { email, displayName: 'Viewer fixture' });
    expect((await post(viewer, '/api/control/invitations/accept', { token: invite.token })).status).toBe(200);
    expect((await post(viewer, '/api/control/invitations/accept', { token: invite.token })).status).toBe(409);
    expect((await viewer('/api/flows')).status).toBe(200);
    expect((await post(viewer, '/api/authoring/test-code', { definition: defaultCode(), input: {} })).status).toBe(403);
    expect((await viewer('/api/control/connections')).status).toBe(200);
    expect((await post(viewer, '/api/flows', example('transactions'))).status).toBe(403);
    expect(
      (await post(viewer, '/api/control/connections', { name: 'bad', provider: 'openai', config: {}, secret: 'test' }))
        .status,
    ).toBe(403);
    expect((await viewer('/api/control/audit')).status).toBe(403);
    const viewerUser = await viewer('/api/control/session').then((response) => response.json());
    expect((await request(`/api/control/members/${viewerUser.user.id}`, { role: 'editor' }, 'PATCH')).status).toBe(200);
    expect((await post(viewer, '/api/flows', example('transactions'))).status).toBe(201);
    expect((await post(viewer, '/api/control/invitations', { email: 'bad@example.test', role: 'admin' })).status).toBe(
      403,
    );
    expect((await request(`/api/control/members/${viewerUser.user.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await viewer('/api/flows')).status).toBe(403);
  });
  it('preserves workspace attribution for native children, debounced runs and audit events', async () => {
    const detail = await nativeRun('queue');
    const session = await api('/api/control/session').then((response) => response.json());
    const rows = await pool.query('SELECT workspace_id FROM studio_runs WHERE id=$1 OR parent_id=$1', [detail.id]);
    expect(rows.rows).toHaveLength(4);
    expect(rows.rows.every((row) => row.workspace_id === session.workspace.id)).toBe(true);
    const audit = await api('/api/control/audit').then((response) => response.json());
    expect(
      audit.events.some(
        (event: { entityId: string; action: string; actor: string }) =>
          event.entityId === detail.id && event.action === 'run.requested' && event.actor === 'Integration owner',
      ),
    ).toBe(true);
    const runs = await api('/api/control/runs').then((response) => response.json());
    expect(runs.find((run: { id: string }) => run.id === detail.id).actor).toBe('Integration owner');
  });
  function eventReader(response: Response) {
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    return async (name: string, predicate: (event: any) => boolean = () => true): Promise<any> => {
      while (true) {
        const split = buffer.indexOf('\n\n');
        if (split >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const lines = frame.split('\n');
          if (lines.find((line) => line.startsWith('event: '))?.slice(7) !== name) continue;
          const data = lines.find((line) => line.startsWith('data: '));
          if (data) {
            const event = JSON.parse(data.slice(6));
            if (predicate(event)) return event;
          }
          continue;
        }
        const { done, value } = await reader.read();
        if (done) throw new Error('SSE connection ended before expected event.');
        buffer += decoder.decode(value, { stream: true });
      }
    };
  }
  it('pushes workspace notifications live and replays disconnected events without exposing Azure credentials', async () => {
    // Cross a decimal boundary: event IDs travel as strings but must sort numerically.
    // This advances only the isolated integration database's notification sequence.
    const maxId = Number(
      (await pool.query('SELECT COALESCE(max(id),0)::text AS id FROM cp_workspace_events')).rows[0].id,
    );
    const boundary = 10 ** String(Math.max(maxId, 1)).length;
    await pool.query("SELECT setval('cp_workspace_events_id_seq',$1)", [boundary - 2]);
    const session = await api('/api/control/session').then((r) => r.json());
    const latest = await api('/api/control/notifications').then((r) => r.json());
    const abort = new AbortController(),
      timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await api(`/api/control/events?workspace=${session.workspace.id}&after=${latest.cursor}`, {
        signal: abort.signal,
      });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const next = eventReader(response);
      await next('ready');
      const created = await request('/api/control/connections', {
        name: 'SSE Azure fixture',
        provider: 'azure',
        config: { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222' },
        secret: 'azure-private-fixture',
      });
      expect(created.status).toBe(201);
      const connection = await created.json();
      const live = await next('workspace', (event) => event.entityId === connection.id);
      expect(live.title).toBe('Connection added');
      expect(JSON.stringify(live)).not.toContain('azure-private-fixture');
      abort.abort();
      expect(
        (
          await request(
            `/api/control/connections/${connection.id}`,
            {
              name: 'Renamed Azure fixture',
              config: {
                tenantId: '11111111-1111-4111-8111-111111111111',
                clientId: '22222222-2222-4222-8222-222222222222',
              },
              revision: 1,
            },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      const replayAbort = new AbortController(),
        replayTimeout = setTimeout(() => replayAbort.abort(), 5000);
      try {
        const replay = await api(`/api/control/events?workspace=${session.workspace.id}&after=0`, {
          headers: { 'Last-Event-ID': live.id },
          signal: replayAbort.signal,
        });
        const replayed = await eventReader(replay)('workspace', (event) => event.entityId === connection.id);
        expect(replayed.action).toBe('connection.updated');
        expect(BigInt(replayed.id) > BigInt(live.id)).toBe(true);
      } finally {
        clearTimeout(replayTimeout);
        replayAbort.abort();
      }
      const notifications = await api('/api/control/notifications').then((r) => r.json());
      expect(JSON.stringify(notifications)).not.toContain('azure-private-fixture');
      expect(notifications.events[0].entityId).toBe(connection.id);
      expect(notifications.events[0].action).toBe('connection.updated');
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });
  it('pushes real DBOS execution progress and outcomes through the workspace event stream', async () => {
    const session = await api('/api/control/session').then((r) => r.json());
    const latest = await api('/api/control/notifications').then((r) => r.json());
    const abort = new AbortController(),
      timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await api(`/api/control/events?workspace=${session.workspace.id}&after=${latest.cursor}`, {
        signal: abort.signal,
      });
      const next = eventReader(response);
      await next('ready');
      const detail = await nativeRun('transactions');
      const progress = await next(
        'workspace',
        (event) => event.action === 'execution.progress' && event.entityId === detail.id,
      );
      expect(progress.kind).toBe('execution');
      const completed = await next(
        'workspace',
        (event) => event.action === 'run.completed' && event.entityId === detail.id,
      );
      expect(completed.title).toBe('Workflow execution completed');
      const notifications = await api('/api/control/notifications').then((r) => r.json());
      expect(notifications.events.some((event: any) => event.action === 'execution.progress')).toBe(false);
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });
  it('requires authenticated workspace access for SSE and rejects invalid cursors', async () => {
    const guest = clientApi();
    expect((await guest('/api/control/notifications')).status).toBe(401);
    expect((await guest('/api/control/events?workspace=local')).status).toBe(401);
    const session = await api('/api/control/session').then((r) => r.json());
    expect((await api('/api/control/events?workspace=not-a-member')).status).toBe(403);
    expect((await api(`/api/control/events?workspace=${session.workspace.id}&after=bad`)).status).toBe(400);
    expect((await api(`/api/control/events?workspace=${session.workspace.id}&after=99999999999999999999`)).status).toBe(
      400,
    );
  });
  it('closes an existing notification stream when workspace membership is removed', async () => {
    const email = `sse-viewer-${crypto.randomUUID()}@example.test`;
    const invitation = await request('/api/control/invitations', { email, role: 'viewer' }).then((r) => r.json());
    const viewer = clientApi();
    await post(viewer, '/api/control/session/development', { email, displayName: 'SSE viewer' });
    await post(viewer, '/api/control/invitations/accept', { token: invitation.token });
    const session = await viewer('/api/control/session').then((r) => r.json());
    const latest = await viewer('/api/control/notifications').then((r) => r.json());
    const abort = new AbortController(),
      timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await viewer(`/api/control/events?workspace=${session.workspace.id}&after=${latest.cursor}`, {
        signal: abort.signal,
      });
      const next = eventReader(response);
      await next('ready');
      expect((await request(`/api/control/members/${session.user.id}`, undefined, 'DELETE')).status).toBe(200);
      expect(await next('access-changed')).toEqual({});
      expect((await viewer('/api/control/notifications')).status).toBe(403);
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });
  it('persists notification reads per user and denies marking foreign workspace notifications', async () => {
    const saved = await save(example('transactions'));
    const initial = await api('/api/control/notifications').then((r) => r.json());
    const event = initial.events.find((item: any) => item.entityId === saved.id);
    expect(event.resourceName).toBe(saved.name);
    expect(event.readAt).toBeUndefined();
    const marked = await request('/api/control/notifications/read', { ids: [event.id] });
    expect(marked.status).toBe(200);
    expect((await marked.json())[0].readAt).toBeTruthy();
    const refreshed = await api('/api/control/notifications').then((r) => r.json());
    expect(refreshed.events.find((item: any) => item.id === event.id).readAt).toBeTruthy();
    const email = `notification-viewer-${crypto.randomUUID()}@example.test`;
    const invitation = await request('/api/control/invitations', { email, role: 'viewer' }).then((r) => r.json());
    const viewer = clientApi();
    await post(viewer, '/api/control/session/development', { email, displayName: 'Notification viewer' });
    await post(viewer, '/api/control/invitations/accept', { token: invitation.token });
    const viewerNotifications = await viewer('/api/control/notifications').then((r) => r.json());
    expect(viewerNotifications.events.find((item: any) => item.id === event.id).readAt).toBeUndefined();
    expect((await post(viewer, '/api/control/notifications/read', { ids: [event.id] })).status).toBe(200);
    const outsider = clientApi();
    await post(outsider, '/api/control/session/development', {
      email: `outside-${crypto.randomUUID()}@example.test`,
      displayName: 'Other customer',
    });
    await post(outsider, '/api/control/onboarding', {
      customerName: 'Other notification customer',
      workspaceName: 'Other notifications',
    });
    const denied = await post(outsider, '/api/control/notifications/read', { ids: [event.id] });
    expect(await denied.json()).toEqual([]);
    expect((await request('/api/control/notifications/read', { ids: ['invalid'] })).status).toBe(400);
    expect((await post(clientApi(), '/api/control/notifications/read', { ids: [event.id] })).status).toBe(401);
  });

  it('executes scoped code, isolated document iterations and named parallel merges', async () => {
    for (const example of scopedExamples()) {
      const saved = await save(example.flow);
      expect(saved.authoringVersion).toBe(2);
      const events = await run(saved, saved.defaultInput ?? {});
      const detail = await terminal(events[0].runId);
      expect(detail.status, JSON.stringify(detail)).toBe('succeeded');
      if (example.id === 'typed-scope-code') expect(detail.output.result).toBe(18);
      if (example.id === 'explicit-documents')
        expect(detail.output.result).toEqual([
          { id: 'a', title: 'GUIDE', index: 'Review batch' },
          { id: 'b', title: 'FAQ', index: 'Review batch' },
          { id: 'c', title: 'NOTES', index: 'Review batch' },
        ]);
      if (example.id === 'explicit-merge') {
        expect(detail.output.result).toEqual({ accountId: 'A-9', available: true });
        expect(events.find((e) => e.type === 'node.completed' && e.nodeId === 'result')).toMatchObject({
          scope: { variables: { accountId: 'A-9' } },
        });
      }
      expect(detail.graph._compiled.version).toBe(2);
    }
  });
  it('saves an incomplete scoped draft but rejects execution without running code', async () => {
    const flow = scopedExamples()[0].flow;
    flow.nodes.find((n) => n.kind === 'code')!.config.code!.source = '';
    const saved = await save(flow);
    expect(saved.nodes.find((n) => n.kind === 'code')!.config.code!.source).toBe('');
    expect((await request('/api/flows/run', { flow: saved, input: saved.defaultInput })).status).toBe(400);
  });
  it('persists the authoring model and executes variables, expressions and code through DBOS', async () => {
    const blank = blankNativeGraph();
    const code = defaultCode();
    code.source = 'console.log("mapped"); return input.map(x => x * variables.factor);';
    const flow: AgentFlow = {
      ...blank,
      id: crypto.randomUUID(),
      authoringVersion: 1,
      variables: { factor: { mode: 'fixed', value: 2 } },
      nodes: [
        blank.nodes[0],
        {
          id: 'vars',
          kind: 'setVariables',
          name: 'Set numbers',
          position: { x: 200, y: 0 },
          config: {
            parameters: {
              values: {
                mode: 'object',
                fields: { numbers: { mode: 'expression', expression: '$input.variables.numbers' } },
              },
            },
          },
        },
        {
          id: 'code',
          kind: 'code',
          name: 'Map numbers',
          position: { x: 400, y: 0 },
          config: { code, parameters: { input: { mode: 'expression', expression: '$vars.numbers' } } },
        },
        {
          id: 'return',
          kind: 'return',
          name: 'Return',
          position: { x: 600, y: 0 },
          config: {
            operation: { kind: 'return', value: { source: 'literal', value: null } },
            parameters: { value: { mode: 'expression', expression: '$nodes["code"]' } },
          },
        },
      ],
      edges: [
        { id: 'e1', source: blank.nodes[0].id, target: 'vars' },
        { id: 'e2', source: 'vars', target: 'code' },
        { id: 'e3', source: 'code', target: 'return' },
      ],
    };
    const saved = await save(flow);
    expect(saved.nodes[2].kind).toBe('code');
    expect(saved.nodes[2].config.parameters?.input.mode).toBe('expression');
    const events = await run(saved, { variables: { numbers: [2, 3] } });
    const detail = await terminal(events[0].runId);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toEqual([4, 6]);
    const event = events.find((e) => e.type === 'node.completed' && e.nodeId === 'code') as Extract<
      FlowRunEvent,
      { type: 'node.completed' }
    >;
    expect(event.metadata?.logs).toEqual(['log: mapped']);
    expect(event.metadata?.revision).toHaveLength(64);
    expect(detail.graph.nodes.find((n: any) => n.id === 'code').config.code.revision).toHaveLength(64);
  });
  it('tests code through the authorized runner and returns bounded errors', async () => {
    const result = await request('/api/authoring/test-code', {
      definition: { ...defaultCode(), source: 'return input + 1;' },
      input: 3,
      variables: {},
    });
    expect(result.status).toBe(200);
    expect((await result.json()).value).toBe(4);
    expect(
      (
        await request('/api/authoring/test-code', {
          definition: { ...defaultCode(), source: 'throw new Error("guest failure")' },
          input: {},
        })
      ).status,
    ).toBe(422);
    expect(
      (await request('/api/authoring/test-code', { definition: { ...defaultCode(), dependencies: ['fs'] }, input: {} }))
        .status,
    ).toBe(400);
    expect((await post(clientApi(), '/api/authoring/test-code', { definition: defaultCode(), input: {} })).status).toBe(
      401,
    );
  });
  it('recovers scoped code checkpoints and reconstructs variable state after restart', async () => {
    const flow = scopedExamples()[0].flow;
    const resultIndex = flow.nodes.findIndex((n) => n.id === 'result');
    flow.nodes.splice(resultIndex, 0, {
      id: 'pause',
      name: 'Pause before return',
      kind: 'delay',
      position: { x: 0, y: 0 },
      config: { operation: { kind: 'delay', durationMS: { source: 'literal', value: 3000 } } },
    });
    flow.edges = flow.nodes.slice(1).map((n, i) => ({ id: `edge-${i}`, source: flow.nodes[i].id, target: n.id }));
    const saved = await save(flow);
    const response = await request('/api/flows/run', { flow: saved, input: saved.defaultInput });
    const reader = response.body!.getReader();
    const first = await reader.read();
    const id = JSON.parse(new TextDecoder().decode(first.value).trim().split('\n')[0]).runId;
    let before: any;
    for (let i = 0; i < 100; i++) {
      before = await api(`/api/runs/${id}`).then((r) => r.json());
      if (before.events.some((r: any) => r.event.type === 'node.completed' && r.event.nodeId === 'calculate')) break;
      await delay(50);
    }
    const recorded = before.events.find(
      (r: any) => r.event.type === 'node.completed' && r.event.nodeId === 'calculate',
    ).event;
    await crash();
    await reader.cancel().catch(() => {});
    await start();
    const detail = await terminal(id);
    expect(detail.status).toBe('succeeded');
    expect(detail.output.result).toBe(18);
    const completions = detail.events.filter(
      (r: any) => r.event.type === 'node.completed' && r.event.nodeId === 'calculate',
    );
    expect(completions).toHaveLength(1);
    expect(completions[0].event.metadata.revision).toBe(recorded.metadata.revision);
  });
  it('recovers a completed code step using its pinned checkpoint after a worker crash', async () => {
    const blank = blankNativeGraph();
    const flow: AgentFlow = {
      ...blank,
      id: crypto.randomUUID(),
      authoringVersion: 1,
      nodes: [
        blank.nodes[0],
        {
          id: 'code',
          kind: 'code',
          name: 'Random sample',
          position: { x: 200, y: 0 },
          config: {
            code: { ...defaultCode(), source: 'return Math.random();' },
            parameters: { input: { mode: 'fixed', value: {} } },
          },
        },
        {
          id: 'pause',
          kind: 'delay',
          name: 'Pause',
          position: { x: 400, y: 0 },
          config: { operation: { kind: 'delay', durationMS: { source: 'literal', value: 3000 } } },
        },
        {
          id: 'return',
          kind: 'return',
          name: 'Return',
          position: { x: 600, y: 0 },
          config: {
            operation: { kind: 'return', value: { source: 'literal', value: null } },
            parameters: { value: { mode: 'expression', expression: '$nodes["code"]' } },
          },
        },
      ],
      edges: [
        { id: 'a', source: blank.nodes[0].id, target: 'code' },
        { id: 'b', source: 'code', target: 'pause' },
        { id: 'c', source: 'pause', target: 'return' },
      ],
    };
    const saved = await save(flow);
    const response = await request('/api/flows/run', { flow: saved, input: {} });
    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstEvent = JSON.parse(new TextDecoder().decode(first.value).trim().split('\n')[0]);
    const id = firstEvent.runId;
    let before: any;
    for (let i = 0; i < 100; i++) {
      before = await api(`/api/runs/${id}`).then((r) => r.json());
      if (before.events.some((row: any) => row.event.type === 'node.completed' && row.event.nodeId === 'code')) break;
      await delay(50);
    }
    const recorded = before.events.find(
      (row: any) => row.event.type === 'node.completed' && row.event.nodeId === 'code',
    ).event;
    await crash();
    await reader.cancel().catch(() => {});
    await start();
    const done = await terminal(id);
    expect(done.status).toBe('succeeded');
    expect(done.output.result).toBe(recorded.output);
    expect(
      done.events.filter((row: any) => row.event.type === 'node.completed' && row.event.nodeId === 'code'),
    ).toHaveLength(1);
  }, 30000);
});
