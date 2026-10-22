import { changeProcessLanes, assignProcessLane, resizeProcessLane } from '../lib/processes/lanes';
import { migrateProcess } from '../lib/processes/model';
import { starterFiles } from '../lib/tools/contracts';
import { graph as toolGraph, node as toolNode, end as toolEnd } from '../lib/native/graph';
import { readFileSync } from 'node:fs';
import { toPlayground, fromPlayground } from '../lib/knowledge/playground';
import { knowledgeFixtures } from '../lib/knowledge/fixtures';
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
import type { AgentFlow, FlowNodeData, FlowRunEvent } from '../lib/flows/types';

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
  it('reviews a compilation preview, rejects stale digests and reports implementation drift', async () => {
    const fixture = knowledgeFixtures()[0];
    const created = await request('/api/knowledge/artifacts', {
      name: 'Compilation review fixture',
      kind: 'process',
      content: migrateProcess(fixture.process),
    }).then((r) => r.json());
    await request(`/api/knowledge/artifacts/${created.artifact.id}/review`, {
      revisionId: created.revision.id,
      expectedVersion: 1,
    });
    const path = `/api/knowledge/artifacts/${created.artifact.id}`;
    const preview = await request(`${path}/compile-preview`, { expectedVersion: 1 }).then((r) => r.json());
    expect(preview.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.nodes).toHaveLength(3);
    expect((await request(`${path}/generate`, { expectedVersion: 1, previewDigest: '0'.repeat(64) })).status).toBe(409);
    const generated = await request(`${path}/generate`, { expectedVersion: 1, previewDigest: preview.digest }).then(
      (r) => r.json(),
    );
    expect(generated.flowId).toBeTruthy();
    const duplicate = await request(`${path}/generate`, { expectedVersion: 1, previewDigest: preview.digest }).then(
      (r) => r.json(),
    );
    expect(duplicate.flowId).toBe(generated.flowId);
    const before = await api(`${path}/implementations`).then((r) => r.json());
    expect(before.items[0].drifted).toBe(false);
    const graph = await api(`/api/flows/${generated.flowId}`).then((r) => r.json());
    graph.name = 'Changed implementation';
    expect((await request(`/api/flows/${generated.flowId}`, graph, 'PUT')).status).toBe(200);
    const after = await api(`${path}/implementations`).then((r) => r.json());
    expect(after.items[0].drifted).toBe(true);
  });
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

  it('lists workspace activities independently of sessions and opens older activity messages', async () => {
    await agentConfig(false);
    const channel = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Activity isolation test',
    }).then((r) => r.json());
    const first = await request(`/api/agent/sessions/${channel.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: 'First independent activity',
    }).then((r) => r.json());
    await agentWait(first.workItemId, 'completed');
    const version = await api(`/api/agent/sessions/${channel.id}`).then((r) => r.json());
    const second = await request(`/api/agent/sessions/${channel.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: version.session.editVersion,
      text: 'Second independent activity',
    }).then((r) => r.json());
    await agentWait(second.workItemId, 'completed');
    const response = await api('/api/agent/activities');
    expect(response.status).toBe(200);
    const rows = (await response.json()).items;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.workItemId, goal: 'First independent activity' }),
        expect.objectContaining({ id: second.workItemId, goal: 'Second independent activity' }),
      ]),
    );
    const older = await api(`/api/agent/work-items/${first.workItemId}`).then((r) => r.json());
    expect(older.messages.some((m: any) => m.id === first.workItemId)).toBe(true);
    expect(older.messages.some((m: any) => m.id === second.workItemId || m.workItemId === second.workItemId)).toBe(
      false,
    );
    const other = clientApi();
    await post(other, '/api/control/session/development', {
      email: `activity-isolation-${crypto.randomUUID()}@example.test`,
      displayName: 'Other activity workspace',
    });
    await post(other, '/api/control/onboarding', {
      customerName: 'Other activity customer',
      workspaceName: 'Other activity workspace',
    });
    expect((await other('/api/agent/activities').then((r) => r.json())).items).toEqual([]);
    expect((await other(`/api/agent/work-items/${first.workItemId}`)).status).toBe(404);
  });

  async function agentConfig(allowModel = false) {
    let connection: any;
    if (allowModel) {
      const response = await request('/api/control/connections', {
        name: 'Agent fixture MiniMax',
        provider: 'minimax',
        config: { model: 'MiniMax-M2.7' },
        secret: 'fixture-not-a-real-key',
      });
      expect(response.status).toBe(201);
      connection = await response.json();
    }
    const state = await api('/api/agent/state').then((r) => r.json());
    const response = await request(
      '/api/agent/configuration',
      {
        expectedVersion: state.configuration?.editVersion ?? 0,
        enabled: true,
        mode: allowModel ? 'assist' : 'observe',
        allowModel,
        ...(connection ? { connectionId: connection.id, connectionRevision: connection.revision ?? 1 } : {}),
        triggers: [],
        limits: { turns: 4, tools: 8, outputTokens: 1024 },
      },
      'PUT',
    );
    expect(response.status).toBe(200);
    return response.json();
  }
  async function agentWait(workId: string, state: string) {
    for (let i = 0; i < 200; i++) {
      const work = await api(`/api/agent/work-items/${workId}`).then((r) => r.json());
      if (work.state === state) return work;
      if (['failed', 'suspended', 'uncertain'].includes(work.state) && state !== work.state)
        throw new Error(`Agent failed: ${JSON.stringify(work)} ${log}`);
      await delay(100);
    }
    throw new Error(`Agent did not reach ${state}: ${log}`);
  }
  async function intakeWait(requestId: string) {
    for (let i = 0; i < 200; i++) {
      const receipt = await api(`/api/agent/requests/${requestId}`).then((r) => r.json());
      if (receipt.state === 'dispatched') return receipt;
      if (receipt.state === 'rejected') throw new Error(`Intake rejected: ${JSON.stringify(receipt)}`);
      await delay(100);
    }
    throw new Error('Intake did not dispatch.');
  }
  it('accepts shell intents idempotently and dispatches persisted context through the partitioned harness queue', async () => {
    await agentConfig();
    const artifact = await request('/api/knowledge/artifacts', {
      name: 'Shell context fixture',
      kind: 'ontology',
      content: knowledgeFixtures()[0].ontology,
    }).then((r) => r.json());
    const input = {
      clientRequestId: crypto.randomUUID(),
      text: 'Inspect the saved ontology from this screen',
      context: {
        surface: 'ontology',
        resource: { kind: 'ontology', id: artifact.artifact.id, revisionId: artifact.revision.id },
      },
    };
    const response = await request('/api/agent/requests', input);
    expect(response.status).toBe(202);
    const receipt = await response.json();
    expect(receipt.state).toBe('queued');
    expect((await request('/api/agent/requests', input).then((r) => r.json())).requestId).toBe(receipt.requestId);
    expect((await request('/api/agent/requests', { ...input, text: 'Reused key with another intent' })).status).toBe(
      409,
    );
    await crash();
    await start();
    const dispatched = await intakeWait(receipt.requestId);
    await agentWait(dispatched.workItemId, 'completed');
    const context = (await pool.query('SELECT request_context FROM wa_work_items WHERE id=$1', [dispatched.workItemId]))
      .rows[0].request_context;
    expect(context.resource.revisionId).toBe(artifact.revision.id);
    const ambient = await api('/api/agent/ambient').then((r) => r.json());
    expect(ambient.session.id).toBe(dispatched.sessionId);
    expect(ambient.modelQueue).toBe('stackproc.agent.harness.v1');
    const system = new pg.Pool({
      connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/studio_integration_dbos',
    });
    try {
      const workflow = (
        await system.query(
          'SELECT queue_name,queue_partition_key FROM dbos.workflow_status WHERE workflow_uuid LIKE $1',
          [
            `wa:%:${(await pool.query('SELECT id FROM wa_command_outbox WHERE work_item_id=$1', [dispatched.workItemId])).rows[0].id}`,
          ],
        )
      ).rows[0];
      expect(workflow.queue_name).toBe('stackproc.agent.harness.v1');
      expect(workflow.queue_partition_key).toBeTruthy();
    } finally {
      await system.end();
    }
  });
  it('routes full-screen chat through intake to the selected conversation', async () => {
    await agentConfig(false);
    const selected = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Full-screen conversation',
    }).then((r) => r.json());
    const reply = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      sessionId: selected.id,
      origin: 'workbench',
      text: 'Inspect the workspace in this conversation',
      context: { surface: 'intelligence' },
    });
    expect(reply.status).toBe(202);
    const dispatched = await intakeWait((await reply.json()).requestId);
    expect(dispatched.sessionId).toBe(selected.id);
    await agentWait(dispatched.workItemId, 'completed');
    const ambient = await api(`/api/agent/ambient?session=${selected.id}`).then((r) => r.json());
    expect(ambient.session.id).toBe(selected.id);
    expect(ambient.messages.some((m: any) => m.content === 'Inspect the workspace in this conversation')).toBe(true);
    expect(
      (
        await request('/api/agent/requests', {
          clientRequestId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          text: 'Wrong conversation',
          context: { surface: 'intelligence' },
        })
      ).status,
    ).toBe(404);
  });
  it('holds follow-up intents while the ambient agent waits and prioritizes a queued clarification answer', async () => {
    await agentConfig(true);
    const first = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[AGENT_ASK]',
      context: { surface: 'control' },
    }).then((r) => r.json());
    const current = await intakeWait(first.requestId);
    const question = await agentWait(current.workItemId, 'waiting_for_user');
    const next = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: 'A follow-up goal from the ontology editor',
      context: { surface: 'ontology' },
    }).then((r) => r.json());
    await delay(1200);
    expect((await api(`/api/agent/requests/${next.requestId}`).then((r) => r.json())).state).toBe('queued');
    await crash();
    await start();
    const answer = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      kind: 'answer',
      text: 'Finance owns Account.',
      context: { surface: 'workspace' },
      workItemId: question.id,
      expectedVersion: question.editVersion,
      remember: true,
    }).then((r) => r.json());
    expect(answer.state).toBe('queued');
    await intakeWait(answer.requestId);
    await agentWait(question.id, 'completed');
    const dispatched = await intakeWait(next.requestId);
    expect(dispatched.sessionId).toBe(current.sessionId);
    await agentWait(dispatched.workItemId, 'completed');
    await agentConfig(false);
  }, 30000);

  it('saves MiniMax enablement with revision conflicts and administrator-only configuration', async () => {
    const configured = await agentConfig(true);
    const { sponsorId, editVersion, ...policy } = configured;
    const input = {
      ...policy,
      expectedVersion: editVersion,
      runtime: { compact: false, totalTokens: 50000 },
      limits: { turns: 3, tools: 6, outputTokens: 2048 },
      triggers: ['run.failed'],
    };
    const saved = await request('/api/agent/configuration', input, 'PUT');
    expect(saved.status).toBe(200);
    const current = await saved.json();
    expect(current).toMatchObject({
      enabled: true,
      allowModel: true,
      mode: 'assist',
      connectionId: configured.connectionId,
      connectionRevision: configured.connectionRevision,
      runtime: { compact: false, totalTokens: 50000 },
      limits: input.limits,
      triggers: input.triggers,
    });
    expect((await request('/api/agent/configuration', input, 'PUT')).status).toBe(409);
    const member = clientApi();
    const email = `settings-editor-${crypto.randomUUID()}@example.test`;
    await post(member, '/api/control/session/development', { email, displayName: 'Settings editor' });
    const invitation = await request('/api/control/invitations', { email, role: 'editor' }).then((r) => r.json());
    await post(member, '/api/control/invitations/accept', { token: invitation.token });
    expect(
      (await post(member, '/api/agent/configuration', { ...input, expectedVersion: current.editVersion }, 'PUT'))
        .status,
    ).toBe(403);
    const state = await api('/api/agent/state').then((r) => r.json());
    expect(state.configuration.editVersion).toBe(current.editVersion);
    expect(
      (
        await request(
          '/api/agent/configuration',
          { ...input, expectedVersion: current.editVersion, enabled: false },
          'PUT',
        )
      ).status,
    ).toBe(200);
  });
  it('reads a large ontology source through durable revision-pinned pages and evidence', async () => {
    const source = readFileSync(new URL('./fixtures/rdf/w3c-org.rdf', import.meta.url), 'utf8');
    const artifact = await request('/api/knowledge/artifacts', {
      name: 'Large ORG source',
      kind: 'source',
      content: { schemaVersion: 1, mediaType: 'text/plain', text: source },
    }).then((r) => r.json());
    const configured = await agentConfig(true);
    const { sponsorId, editVersion, ...policy } = configured;
    expect(
      (
        await request(
          '/api/agent/configuration',
          { ...policy, expectedVersion: editVersion, limits: { turns: 8, tools: 12, outputTokens: 2048 } },
          'PUT',
        )
      ).status,
    ).toBe(200);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Large ontology inspection',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: `[HARNESS_LARGE_SOURCE] ${artifact.artifact.id}`,
    }).then((r) => r.json());
    await agentWait(receipt.workItemId, 'completed');
    const observations = (
      await pool.query(
        "SELECT result FROM wa_calls WHERE work_item_id=$1 AND kind='tool' AND state='completed' ORDER BY turn_no",
        [receipt.workItemId],
      )
    ).rows.map((r) => r.result);
    expect(observations).toHaveLength(4);
    expect(observations.every((r) => r.revision.id === artifact.revision.id)).toBe(true);
    expect(observations[0].page.view).toBe('summary');
    expect(observations[1].summary.entityCount).toBe(9);
    expect(observations[2].page.entityId).toBe('organization');
    expect(observations[3].evidence[0]).toMatchObject({ kind: 'source', revisionId: artifact.revision.id });
    await crash();
    await start();
    const reopened = await api(`/api/agent/work-items/${receipt.workItemId}`).then((r) => r.json());
    expect(reopened.state).toBe('completed');
    expect(
      (
        await pool.query("SELECT count(*)::int AS n FROM wa_calls WHERE work_item_id=$1 AND kind='tool'", [
          receipt.workItemId,
        ])
      ).rows[0].n,
    ).toBe(4);
  }, 30000);
  it('previews RDF/XML on the server and persists its native projection and source as a revision', async () => {
    const source = readFileSync(new URL('./fixtures/rdf/ecommerce-step-1.rdf', import.meta.url), 'utf8');
    const previous = { schemaVersion: 1, description: '', entities: [], relationships: [] };
    const response = await request('/api/knowledge/rdf/preview', { source, previous });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview.model.entities.length).toBeGreaterThan(1);
    const savedResponse = await request('/api/knowledge/artifacts', {
      name: 'RDF projection integration fixture',
      kind: 'ontology',
      content: preview.model,
    });
    expect(savedResponse.status).toBe(201);
    const saved = await savedResponse.json();
    const reopened = await api(`/api/knowledge/artifacts/${saved.artifact.id}`).then((r) => r.json());
    expect(reopened.revision.content.playground.rdfSource).toBe(source);
    expect((await request('/api/knowledge/rdf/preview', { source: '<broken', previous })).status).toBe(422);
    expect(
      (
        await request('/api/knowledge/rdf/preview', {
          source: '<!DOCTYPE rdf SYSTEM "https://example.test/remote"><rdf/>',
          previous,
        })
      ).status,
    ).toBe(400);
  });
  it('previews standard vocabularies and BPMN drafts without executing imported behavior', async () => {
    for (const file of ['w3c-org.rdf', 'w3c-skos.rdf']) {
      const source = readFileSync(new URL(`./fixtures/rdf/${file}`, import.meta.url), 'utf8');
      const response = await request('/api/knowledge/rdf/preview', {
        source,
        previous: { schemaVersion: 1, description: '', entities: [], relationships: [] },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).warnings.some((w: string) => w.includes('omitted'))).toBe(true);
    }
    const source = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="sample"><startEvent id="start"/><userTask id="review"/><endEvent id="end"/><sequenceFlow id="a" sourceRef="start" targetRef="review"/><sequenceFlow id="b" sourceRef="review" targetRef="end"/></process></definitions>`;
    const preview = await request('/api/knowledge/bpmn/preview', { source });
    expect(preview.status).toBe(200);
    const content = (await preview.json()).document;
    expect(content.graph.elements.find((e: { id: string }) => e.id === 'review').binding.kind).toBe('requirement');
    const saved = await request('/api/knowledge/artifacts', { name: 'Imported BPMN draft', kind: 'process', content });
    expect(saved.status).toBe(201);
    const record = await saved.json();
    expect(record.revision.content.bpmnSource.xml).toBe(source);
    const generation = await request(`/api/knowledge/artifacts/${record.artifact.id}/compile-preview`, {
      expectedVersion: record.artifact.editVersion,
    });
    expect(generation.status).toBe(422);
    expect((await request('/api/knowledge/bpmn/preview', { source: '<broken' })).status).toBe(422);
    expect((await request('/api/knowledge/bpmn/preview', { source: '<!DOCTYPE definitions>' + source })).status).toBe(
      400,
    );
    const collaboration = readFileSync(new URL('./fixtures/bpmn/pizza-collaboration.bpmn', import.meta.url), 'utf8');
    const selection = await request('/api/knowledge/bpmn/preview', { source: collaboration }).then((r) => r.json());
    expect(selection.processes.length).toBeGreaterThan(1);
    const blocked = await request('/api/knowledge/bpmn/preview', {
      source: collaboration,
      processId: selection.processes[0].id,
    }).then((r) => r.json());
    expect(blocked.document).toBeNull();
    expect(blocked.diagnostics.some((d: { severity: string }) => d.severity === 'error')).toBe(true);
  });
  it('persists idempotent agent sessions and indexes context without a model call', async () => {
    await agentConfig();
    const key = crypto.randomUUID();
    const session = await request('/api/agent/sessions', { clientKey: key, title: 'Persistent agent session' }).then(
      (r) => r.json(),
    );
    expect(
      await request('/api/agent/sessions', { clientKey: key, title: 'Persistent agent session' }).then((r) => r.json()),
    ).toEqual(session);
    const message = { clientMessageId: crypto.randomUUID(), expectedSessionVersion: 1, text: 'Inspect the workspace' };
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, message).then((r) => r.json());
    expect(await request(`/api/agent/sessions/${session.id}/messages`, message).then((r) => r.json())).toEqual(receipt);
    expect(
      (await request(`/api/agent/sessions/${session.id}/messages`, { ...message, text: 'Different goal' })).status,
    ).toBe(409);
    await agentWait(receipt.workItemId, 'completed');
    await crash();
    await start();
    const reopened = await api(`/api/agent/sessions/${session.id}`).then((r) => r.json());
    expect(reopened.messages[0].content).toBe('Inspect the workspace');
    expect(reopened.workItems[0].state).toBe('completed');
    expect(
      (await pool.query('SELECT count(*) FROM wa_calls WHERE work_item_id=$1', [receipt.workItemId])).rows[0].count,
    ).toBe('0');
  });
  it('executes a recorded agent tool loop and resumes a durable question after restart', async () => {
    await agentConfig(true);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Agent clarification',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: '[AGENT_ASK] inspect Account ownership',
    }).then((r) => r.json());
    const waiting = await agentWait(receipt.workItemId, 'waiting_for_user');
    await crash();
    await start();
    const answer = {
      clientKey: crypto.randomUUID(),
      expectedVersion: waiting.editVersion,
      answer: 'Finance owns the Account concept.',
      remember: true,
    };
    expect((await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, answer)).status).toBe(202);
    expect((await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, answer)).status).toBe(202);
    const complete = await agentWait(receipt.workItemId, 'completed');
    expect(JSON.stringify(complete)).not.toContain('fixture-private-continuation');
    expect(
      (await pool.query('SELECT count(*) FROM wa_memories WHERE work_item_id=$1', [receipt.workItemId])).rows[0].count,
    ).toBe('1');
    const messages = await api(`/api/agent/sessions/${session.id}`).then((r) => r.json());
    expect(JSON.stringify(messages)).not.toContain('fixture-private-continuation');
    expect(complete.activity.some((a: any) => a.kind === 'tool')).toBe(true);
  });

  it('persists structured agent controls and validates typed answers before resuming once', async () => {
    await agentConfig(true);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Structured agent controls',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: '[AGENT_FORM]',
    }).then((r) => r.json());
    const waiting = await agentWait(receipt.workItemId, 'waiting_for_user');
    expect(waiting.interaction.fields).toHaveLength(3);
    const interactionId = waiting.interaction.id;
    await crash();
    await start();
    const reopened = await api(`/api/agent/work-items/${receipt.workItemId}`).then((r) => r.json());
    expect(reopened.interaction.id).toBe(interactionId);
    const invalid = {
      clientKey: crypto.randomUUID(),
      expectedVersion: waiting.editVersion,
      answer: '{}',
      response: { interactionId, values: { team: 'admin', limit: 'nine', enabled: true } },
    };
    expect((await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, invalid)).status).toBe(400);
    const values = { team: 'finance', limit: 0, enabled: false };
    const answer = {
      clientKey: crypto.randomUUID(),
      expectedVersion: waiting.editVersion,
      answer: JSON.stringify(values),
      response: { interactionId, values },
    };
    expect((await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, answer)).status).toBe(202);
    expect((await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, answer)).status).toBe(202);
    expect(
      (
        await request(`/api/agent/work-items/${receipt.workItemId}/decisions`, {
          ...answer,
          clientKey: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    const complete = await agentWait(receipt.workItemId, 'completed');
    expect(complete.interaction).toBeNull();
    expect(
      (await pool.query('SELECT count(*) FROM wa_decisions WHERE work_item_id=$1', [receipt.workItemId])).rows[0].count,
    ).toBe('1');
  }, 30000);

  it('persists response resource references with the work that produced them', async () => {
    await agentConfig(true);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Response links',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: 'Inspect workspace resources',
    }).then((r) => r.json());
    await agentWait(receipt.workItemId, 'completed');
    const detail = await api(`/api/agent/sessions/${session.id}`).then((r) => r.json());
    const answer = detail.messages.find((m: any) => m.role === 'assistant');
    expect(answer.workItemId).toBe(receipt.workItemId);
    expect(Array.isArray(answer.resources)).toBe(true);
    const stored = (await pool.query('SELECT resource_refs FROM wa_messages WHERE id=$1', [answer.id])).rows[0];
    expect(stored.resource_refs).toEqual(answer.resources);
    await crash();
    await start();
    const reopened = await api(`/api/agent/sessions/${session.id}`).then((r) => r.json());
    expect(reopened.messages.find((m: any) => m.id === answer.id).resources).toEqual(answer.resources);
  }, 30000);

  it('does not repeat an issued agent model request after a crash', async () => {
    await agentConfig(true);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Interrupted agent request',
    }).then((r) => r.json());
    const interruptGoal = `[AGENT_INTERRUPT] ${crypto.randomUUID()}`;
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: interruptGoal,
    }).then((r) => r.json());
    for (let i = 0; i < 100; i++) {
      if (
        (await pool.query("SELECT id FROM wa_calls WHERE work_item_id=$1 AND state='issued'", [receipt.workItemId]))
          .rowCount
      )
        break;
      await delay(100);
    }
    // An issued receipt precedes provider dispatch. Synchronize on this request's
    // committed fixture entry so the original in-flight INSERT cannot race the baseline.
    let entered = false;
    for (let i = 0; i < 100; i++) {
      entered = Boolean(
        (
          await pool.query('SELECT 1 FROM studio_test_effects WHERE effect_key=$1', [
            `agent-interrupt:${interruptGoal}`,
          ])
        ).rowCount,
      );
      if (entered) break;
      await delay(50);
    }
    expect(entered).toBe(true);
    const before = (await pool.query("SELECT count(*) FROM studio_test_effects WHERE effect_key='agent-model'")).rows[0]
      .count;
    await crash();
    await start();
    const result = await agentWait(receipt.workItemId, 'uncertain');
    expect(result.error).toContain('not automatically repeated');
    expect(
      (await pool.query("SELECT count(*) FROM wa_calls WHERE work_item_id=$1 AND kind='model'", [receipt.workItemId]))
        .rows[0].count,
    ).toBe('1');
    expect(
      (await pool.query("SELECT count(*) FROM studio_test_effects WHERE effect_key='agent-model'")).rows[0].count,
    ).toBe(before);
  });
  it('stages agent ontology edits for review and applies a single immutable revision idempotently', async () => {
    await agentConfig(true);
    const original = await request('/api/knowledge/artifacts', {
      name: 'Agent proposal fixture',
      kind: 'ontology',
      content: knowledgeFixtures()[0].ontology,
    }).then((r) => r.json());
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Review ontology proposal',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: '[AGENT_PROPOSE] encoded',
      attachments: [{ kind: 'ontology', id: original.artifact.id, revisionId: original.revision.id }],
    }).then((r) => r.json());
    const result = await agentWait(receipt.workItemId, 'ready_for_review');
    expect(result.proposals).toHaveLength(1);
    expect((await api(`/api/knowledge/artifacts/${original.artifact.id}`).then((r) => r.json())).revision.id).toBe(
      original.revision.id,
    );
    const proposal = result.proposals[0];
    const applied = await request(`/api/agent/change-sets/${proposal.id}/apply`, { hash: proposal.hash });
    expect(applied.status).toBe(200);
    const appliedReceipt = await applied.json();
    expect(
      (await request(`/api/agent/change-sets/${proposal.id}/apply`, { hash: proposal.hash }).then((r) => r.json()))
        .revisionId,
    ).toBe(appliedReceipt.revisionId);
    expect(
      (await api(`/api/knowledge/artifacts/${original.artifact.id}`).then((r) => r.json())).revision.content
        .description,
    ).toBe('Reviewed account domain');
  });
  it('ingests a workspace change into durable ambient agent work only for enabled triggers', async () => {
    const config = await agentConfig(true);
    await request(
      '/api/agent/configuration',
      {
        expectedVersion: config.editVersion,
        enabled: true,
        mode: 'assist',
        allowModel: true,
        connectionId: config.connectionId,
        connectionRevision: config.connectionRevision,
        triggers: ['knowledge.saved'],
        limits: config.limits,
      },
      'PUT',
    );
    const saved = await request('/api/knowledge/artifacts', {
      name: 'Ambient event fixture',
      kind: 'ontology',
      content: knowledgeFixtures()[0].ontology,
    }).then((r) => r.json());
    let workId: string | undefined;
    for (let i = 0; i < 150; i++) {
      const rows = await pool.query(
        'SELECT i.work_item_id FROM wa_inbox i JOIN wa_domain_outbox o ON o.workspace_id=i.workspace_id AND o.id=i.source_event_id WHERE o.entity_id=$1',
        [saved.artifact.id],
      );
      workId = rows.rows[0]?.work_item_id;
      if (workId) break;
      await delay(100);
    }
    expect(workId).toBeTruthy();
    await agentWait(workId!, 'completed');
    await agentConfig(false);
  });

  it('deletes a saved workflow and schedule while preserving its run snapshot and auditing the deletion', async () => {
    const draft = structuredClone(scopedExamples()[0].flow);
    draft.schedule = { enabled: true, cron: '0 0 0 1 1 *', timezone: 'UTC' };
    const saved = await save(draft);
    const events = await run(saved, saved.defaultInput);
    const runId = events[0].runId;
    await terminal(runId);
    const system = new pg.Pool({
      connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/studio_integration_dbos',
    });
    try {
      expect(
        (await system.query('SELECT 1 FROM dbos.workflow_schedules WHERE schedule_name=$1', [`studio-${saved.id}`]))
          .rowCount,
      ).toBe(1);
      expect((await api(`/api/flows/${saved.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await api(`/api/flows/${saved.id}`)).status).toBe(404);
      expect((await api('/api/flows').then((r) => r.json())).some((flow: AgentFlow) => flow.id === saved.id)).toBe(
        false,
      );
      expect(
        (await system.query('SELECT 1 FROM dbos.workflow_schedules WHERE schedule_name=$1', [`studio-${saved.id}`]))
          .rowCount,
      ).toBe(0);
      const retained = await api(`/api/runs/${runId}`).then((r) => r.json());
      expect(retained.graph.id).toBe(saved.id);
      expect(retained.status).toBe('succeeded');
      expect(
        (await pool.query("SELECT 1 FROM cp_audit WHERE entity_id=$1 AND action='workflow.deleted'", [saved.id]))
          .rowCount,
      ).toBe(1);
      expect((await api(`/api/flows/${saved.id}`, { method: 'DELETE' })).status).toBe(404);
    } finally {
      await system.end();
    }
  });

  it('denies deleting another workspace workflow', async () => {
    const saved = await save(blankNativeGraph());
    const outsider = clientApi();
    await post(outsider, '/api/control/session/development', {
      email: `delete-outsider-${crypto.randomUUID()}@example.test`,
      displayName: 'Other owner',
    });
    await post(outsider, '/api/control/onboarding', {
      customerName: 'Other delete customer',
      workspaceName: 'Other delete workspace',
    });
    expect((await outsider(`/api/flows/${saved.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(`/api/flows/${saved.id}`)).status).toBe(200);
  });

  async function knowledgeSource(text = 'Calculate invoice amount times factor.') {
    const response = await request('/api/knowledge/artifacts', {
      name: 'Fixture procedure',
      kind: 'source',
      content: { schemaVersion: 1, mediaType: 'text/plain', text },
    });
    expect(response.status).toBe(201);
    return response.json();
  }
  async function waitIntelligence(id: string, status: string) {
    for (let i = 0; i < 200; i++) {
      const response = await api(`/api/intelligence/tasks/${id}`);
      expect(response.status).toBe(200);
      const task = await response.json();
      if (task.status === status) return task;
      if (task.status === 'failed') throw new Error(`Task failed: ${task.error}\n${log}`);
      await delay(100);
    }
    throw new Error(`Timed out waiting for intelligence ${status}: ${log}`);
  }
  async function intelligenceTask(text?: string) {
    const source = await knowledgeSource(text);
    const response = await request('/api/control/connections', {
      name: 'Fixture MiniMax',
      provider: 'minimax',
      config: { model: 'MiniMax-M2.7' },
      secret: 'fixture-not-a-real-key',
    });
    expect(response.status).toBe(201);
    const connection = await response.json();
    const created = await request('/api/intelligence/tasks', {
      sourceId: source.artifact.id,
      sourceRevisionId: source.revision.id,
      connectionId: connection.id,
      connectionRevision: 1,
    });
    expect(created.status).toBe(202);
    return { source, task: await created.json(), connection };
  }
  it('persists the Microsoft designer document and retains earlier immutable revisions', async () => {
    const original = knowledgeFixtures()[0].ontology;
    const document = toPlayground(original, 'Visual model');
    document.entityTypes[0].properties.push({
      name: 'Issued',
      type: 'date',
      stackprocId: 'issued',
      description: 'Issue date',
    });
    document.entityTypes[0].properties.push({
      name: 'Preferences',
      type: 'object',
      stackprocId: 'preferences',
      required: true,
      nullable: false,
      schema: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        default: { tags: ['priority'] },
      },
    });
    document.rdfMetadata = { ontologyIri: 'https://example.test/model', imports: [], preservedSourceFeatures: [] };
    const content = fromPlayground(document, original);
    const createdResponse = await request('/api/knowledge/artifacts', {
      name: 'Visual model',
      kind: 'ontology',
      content,
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const reopened = await api(`/api/knowledge/artifacts/${created.artifact.id}`).then((r) => r.json());
    expect(reopened.revision.content.playground).toEqual(document);
    expect(
      reopened.revision.content.entities[0].properties.find((p: { id: string }) => p.id === 'issued'),
    ).toMatchObject({ format: 'date' });
    expect(
      reopened.revision.content.entities[0].properties.find((p: { id: string }) => p.id === 'preferences'),
    ).toMatchObject({ required: true, nullable: false, schema: document.entityTypes[0].properties.at(-1)!.schema });
    document.entityTypes[0].name = 'Renamed entity';
    expect(
      (
        await request(
          `/api/knowledge/artifacts/${created.artifact.id}`,
          {
            name: 'Visual model',
            kind: 'ontology',
            content: fromPlayground(document, reopened.revision.content),
            expectedVersion: 1,
          },
          'PUT',
        )
      ).status,
    ).toBe(200);
    const old = await api(`/api/knowledge/artifacts/${created.artifact.id}?revision=${created.revision.id}`).then((r) =>
      r.json(),
    );
    expect(old.revision.content.playground.entityTypes[0].name).toBe(original.entities[0].name);
  });
  it('versions knowledge immutably and rejects stale writes and foreign evidence', async () => {
    const source = await knowledgeSource();
    const fixture = knowledgeFixtures()[0];
    const created = await request('/api/knowledge/artifacts', {
      name: 'Invoice model',
      kind: 'ontology',
      content: fixture.ontology,
    }).then((r) => r.json());
    const changed = structuredClone(fixture.ontology);
    changed.entities[0].name = 'Changed label';
    expect(
      (
        await request(
          `/api/knowledge/artifacts/${created.artifact.id}`,
          { name: 'Renamed', kind: 'ontology', content: changed, expectedVersion: 1 },
          'PUT',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/knowledge/artifacts/${created.artifact.id}`,
          { name: 'Stale', kind: 'ontology', content: fixture.ontology, expectedVersion: 1 },
          'PUT',
        )
      ).status,
    ).toBe(409);
    const original = await api(`/api/knowledge/artifacts/${created.artifact.id}?revision=${created.revision.id}`).then(
      (r) => r.json(),
    );
    expect(original.revision.content.entities[0].name).toBe('invoice');
    changed.entities[0].evidence = [{ kind: 'source', revisionId: source.revision.id, blockId: 'missing' }];
    expect(
      (await request('/api/knowledge/artifacts', { name: 'Invalid evidence', kind: 'ontology', content: changed }))
        .status,
    ).toBe(422);
    const outsider = clientApi();
    await post(outsider, '/api/control/session/development', {
      email: `knowledge-other-${crypto.randomUUID()}@example.test`,
      displayName: 'Other knowledge owner',
    });
    await post(outsider, '/api/control/onboarding', {
      customerName: 'Other customer',
      workspaceName: 'Other workspace',
    });
    expect((await outsider(`/api/knowledge/revisions/${source.revision.id}`)).status).toBe(404);
    changed.entities[0].evidence = [{ kind: 'source', revisionId: source.revision.id, blockId: 'block-1' }];
    expect(
      (
        await post(outsider, '/api/knowledge/artifacts', {
          name: 'Foreign evidence',
          kind: 'ontology',
          content: changed,
        })
      ).status,
    ).toBe(422);
  });
  it('persists swimlane geometry and membership while retaining executable process behavior', async () => {
    let content = changeProcessLanes(migrateProcess(knowledgeFixtures()[0].process), [
      { id: 'operations', name: 'Operations' },
      { id: 'risk', name: 'Risk', role: 'editor' },
    ]);
    content = assignProcessLane(content, ['calculate'], 'risk');
    content = resizeProcessLane(content, 'operations', 420);
    const savedResponse = await request('/api/knowledge/artifacts', {
      name: 'Swimlane persistence fixture',
      kind: 'process',
      content,
    });
    expect(savedResponse.status).toBe(201);
    const saved = await savedResponse.json(),
      path = `/api/knowledge/artifacts/${saved.artifact.id}`;
    const reopened = await api(path).then((r) => r.json());
    expect(reopened.revision.content).toEqual(content);
    expect((await request(`${path}/review`, { revisionId: saved.revision.id, expectedVersion: 1 })).status).toBe(200);
    const generated = await request(`${path}/generate`, { expectedVersion: 1 }).then((r) => r.json());
    const graph = await api(`/api/flows/${generated.flowId}`).then((r) => r.json());
    expect(graph.nodes.find((n: any) => n.id === 'calculate').position).toEqual(
      content.presentation.positions.calculate,
    );
    const events = await run(graph, graph.defaultInput);
    const result = await terminal(events[0].runId);
    expect(result.status).toBe('succeeded');
    expect(result.output.result).toBe(knowledgeFixtures()[0].expected);
    const manifest = (
      await pool.query('SELECT manifest FROM wi_manual_generations WHERE process_revision_id=$1', [saved.revision.id])
    ).rows[0].manifest;
    expect(manifest.lanes).toEqual(content.lanes);
    const invalid = structuredClone(content);
    invalid.presentation.pool!.heights.risk = -1;
    expect(
      (await request(path, { name: 'Invalid lanes', kind: 'process', content: invalid, expectedVersion: 1 }, 'PUT'))
        .status,
    ).toBe(400);
  });
  it('saves visual process graphs, preserves old revisions and compiles supported activity intent', async () => {
    const fixture = knowledgeFixtures()[0];
    const original = await request('/api/knowledge/artifacts', {
      name: 'Visual process migration',
      kind: 'process',
      content: fixture.process,
    }).then((r) => r.json());
    const content = migrateProcess(fixture.process);
    content.presentation.positions.calculate = { x: 333, y: 777 };
    const savedResponse = await request(
      `/api/knowledge/artifacts/${original.artifact.id}`,
      { name: 'Visual process migration', kind: 'process', content, expectedVersion: 1 },
      'PUT',
    );
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    const reopened = await api(`/api/knowledge/artifacts/${original.artifact.id}`).then((r) => r.json());
    expect(reopened.revision.content).toEqual(content);
    const old = await api(`/api/knowledge/artifacts/${original.artifact.id}?revision=${original.revision.id}`).then(
      (r) => r.json(),
    );
    expect(old.revision.content.schemaVersion).toBe(1);
    expect(
      (
        await request(
          `/api/knowledge/artifacts/${original.artifact.id}`,
          { name: 'Stale', kind: 'process', content, expectedVersion: 1 },
          'PUT',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/knowledge/artifacts/${original.artifact.id}/review`, {
          revisionId: saved.revision.id,
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);
    const generated = await request(`/api/knowledge/artifacts/${original.artifact.id}/generate`, {
      expectedVersion: 2,
    }).then((r) => r.json());
    expect(generated.flowId).toBeTruthy();
    const lineage = await pool.query('SELECT manifest FROM wi_manual_generations WHERE process_revision_id=$1', [
      saved.revision.id,
    ]);
    expect(lineage.rows[0].manifest.generator).toBe('visual-linear-process@2');
    expect(lineage.rows[0].manifest.entry.processElementId).toBe(content.graph.elements[0].id);
    const intent = structuredClone(content);
    const activity = intent.graph.elements.find((n) => n.id === 'calculate')!;
    if (activity.kind === 'activity')
      activity.binding = { kind: 'requirement', performer: 'agent', capability: 'Review evidence' };
    const unresolved = await request('/api/knowledge/artifacts', {
      name: 'Unresolved visual agent',
      kind: 'process',
      content: intent,
    }).then((r) => r.json());
    expect(unresolved.artifact.id).toBeTruthy();
    expect(
      (await request(`/api/knowledge/artifacts/${unresolved.artifact.id}/generate`, { expectedVersion: 1 })).ok,
    ).toBe(false);
    const broken = structuredClone(content);
    broken.graph.flows[0].target = 'absent';
    expect(
      (await request('/api/knowledge/artifacts', { name: 'Broken graph', kind: 'process', content: broken })).status,
    ).toBe(422);
  });
  it('generates a reviewed manual process without a model and retains its execution lineage', async () => {
    const fixture = knowledgeFixtures()[1];
    const created = await request('/api/knowledge/artifacts', {
      name: fixture.name,
      kind: 'process',
      content: fixture.process,
    }).then((r) => r.json());
    expect(
      (await request(`/api/knowledge/artifacts/${created.artifact.id}/generate`, { expectedVersion: 1 })).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/knowledge/artifacts/${created.artifact.id}/review`, {
          revisionId: created.revision.id,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(200);
    const generated = await request(`/api/knowledge/artifacts/${created.artifact.id}/generate`, { expectedVersion: 1 });
    expect(generated.status).toBe(200);
    const { flowId } = await generated.json();
    expect(
      await request(`/api/knowledge/artifacts/${created.artifact.id}/generate`, { expectedVersion: 1 }).then((r) =>
        r.json(),
      ),
    ).toEqual({ flowId });
    const flow = await api(`/api/flows/${flowId}`).then((r) => r.json());
    const events = await run(flow, flow.defaultInput),
      detail = await terminal(events[0].runId);
    expect(detail.output.result).toBe(23);
    expect(detail.graph.sourceReference).toBe(`process:${created.revision.id}`);
  });
  it('analyzes a source with the fixture MiniMax adapter and applies a new workflow exactly once', async () => {
    const { task } = await intelligenceTask();
    const ready = await waitIntelligence(task.id, 'ready');
    expect(ready.analysis.ontology.entities[0].evidence[0].kind).toBe('source');
    const first = await request(`/api/intelligence/tasks/${task.id}/apply`, { expectedVersion: ready.editVersion });
    expect(first.status).toBe(200);
    const applied = await first.json();
    expect(
      await request(`/api/intelligence/tasks/${task.id}/apply`, { expectedVersion: ready.editVersion }).then((r) =>
        r.json(),
      ),
    ).toEqual(applied);
    const flow = await api(`/api/flows/${applied.flowId}`).then((r) => r.json());
    expect(flow.generationManifestId).toBe(task.id);
    const events = await run(flow, flow.defaultInput),
      detail = await terminal(events[0].runId);
    expect(detail.output.result).toBe(120);
    expect(detail.graph.generationManifestId).toBe(task.id);
    const manifest = await api(`/api/intelligence/tasks/${task.id}/manifest`).then((r) => r.json());
    expect(manifest.elements).toHaveLength(2);
    expect(
      (await pool.query('SELECT count(*)::int n FROM wi_applications WHERE task_id=$1', [task.id])).rows[0].n,
    ).toBe(1);
  });
  it('resumes intelligence clarification after restart without repeating the completed model call', async () => {
    const { task } = await intelligenceTask('[ASK] Calculate invoice total; clarify the business owner.');
    const waiting = await waitIntelligence(task.id, 'needs_clarification');
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
        .rows[0].n,
    ).toBe(1);
    await crash();
    await start();
    await delay(500);
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await request(`/api/intelligence/tasks/${task.id}/answers`, {
          expectedVersion: waiting.editVersion,
          answers: { owner: 'Finance' },
        })
      ).status,
    ).toBe(200);
    const ready = await waitIntelligence(task.id, 'ready');
    expect(ready.analysis.process.questions[0].answer).toBe('Finance');
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
        .rows[0].n,
    ).toBe(2);
    const accepted = await request(`/api/intelligence/tasks/${task.id}/knowledge`, {
      expectedVersion: ready.editVersion,
    });
    expect(accepted.status).toBe(200);
    const ids = await accepted.json();
    expect(
      await request(`/api/intelligence/tasks/${task.id}/knowledge`, { expectedVersion: ready.editVersion }).then((r) =>
        r.json(),
      ),
    ).toEqual(ids);
    expect((await request(`/api/intelligence/tasks/${task.id}/cancel`, {})).status).toBe(200);
  });
  it('requires reviewed ontology revisions and blocks unsupported process generation', async () => {
    const fixture = knowledgeFixtures()[0];
    const ontology = await request('/api/knowledge/artifacts', {
      name: 'Domain model',
      kind: 'ontology',
      content: fixture.ontology,
    }).then((r) => r.json());
    fixture.process.ontologyRefs = [{ artifactId: ontology.artifact.id, revisionId: ontology.revision.id }];
    const process = await request('/api/knowledge/artifacts', {
      name: 'Pinned process',
      kind: 'process',
      content: fixture.process,
    }).then((r) => r.json());
    await request(`/api/knowledge/artifacts/${process.artifact.id}/review`, {
      revisionId: process.revision.id,
      expectedVersion: 1,
    });
    expect(
      (await request(`/api/knowledge/artifacts/${process.artifact.id}/generate`, { expectedVersion: 1 })).status,
    ).toBe(422);
    await request(`/api/knowledge/artifacts/${ontology.artifact.id}/review`, {
      revisionId: ontology.revision.id,
      expectedVersion: 1,
    });
    expect(
      (await request(`/api/knowledge/artifacts/${process.artifact.id}/generate`, { expectedVersion: 1 })).status,
    ).toBe(200);
    const blocked = knowledgeFixtures()[1].process;
    blocked.steps.unshift({
      id: 'send',
      name: 'Send notification',
      kind: 'requirement',
      capability: 'Notification adapter required',
      evidence: [],
    });
    const draft = await request('/api/knowledge/artifacts', {
      name: 'Blocked process',
      kind: 'process',
      content: blocked,
    }).then((r) => r.json());
    await request(`/api/knowledge/artifacts/${draft.artifact.id}/review`, {
      revisionId: draft.revision.id,
      expectedVersion: 1,
    });
    expect(
      (await request(`/api/knowledge/artifacts/${draft.artifact.id}/generate`, { expectedVersion: 1 })).status,
    ).toBe(422);
    expect(
      (
        await request(`/api/knowledge/artifacts/${draft.artifact.id}/publish`, {
          revisionId: draft.revision.id,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(422);
  });
  it('does not repeat an uncertain model request after a crash', async () => {
    const { task } = await intelligenceTask('[INTERRUPT] Calculate invoice total.');
    for (let i = 0; i < 100; i++) {
      if (
        (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
          .rows[0].n === 1
      )
        break;
      await delay(100);
    }
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
        .rows[0].n,
    ).toBe(1);
    await crash();
    await start();
    const failed = await waitIntelligence(task.id, 'failed');
    expect(failed.error).toContain('uncertain outcome');
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_test_effects WHERE effect_key=$1', [`model:${task.id}`]))
        .rows[0].n,
    ).toBe(1);
  });
  it('rejects concurrent stale workflow saves without losing the winning graph or provenance', async () => {
    const flow = await save(blankNativeGraph());
    const results = await Promise.all([
      request(`/api/flows/${flow.id}`, { ...flow, name: 'First writer' }, 'PUT'),
      request(`/api/flows/${flow.id}`, { ...flow, name: 'Second writer' }, 'PUT'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loaded = await api(`/api/flows/${flow.id}`).then((r) => r.json());
    expect(loaded.editVersion).toBe(2);
    expect(['First writer', 'Second writer']).toContain(loaded.name);
    expect(
      (await pool.query('SELECT count(*)::int n FROM studio_flow_revisions WHERE flow_id=$1', [flow.id])).rows[0].n,
    ).toBe(2);
    expect((await request(`/api/flows/${flow.id}`, { ...flow, editVersion: undefined }, 'PUT')).status).toBe(409);
  });
  it('rejects stale proposals, cancels authoring tasks and preserves accepted knowledge', async () => {
    const { task } = await intelligenceTask();
    const ready = await waitIntelligence(task.id, 'ready');
    const analysis = structuredClone(ready.analysis);
    analysis.summary = 'Human corrected summary';
    expect(
      (await request(`/api/intelligence/tasks/${task.id}`, { expectedVersion: ready.editVersion, analysis }, 'PUT'))
        .status,
    ).toBe(200);
    expect(
      (await request(`/api/intelligence/tasks/${task.id}/apply`, { expectedVersion: ready.editVersion })).status,
    ).toBe(409);
    const current = await api(`/api/intelligence/tasks/${task.id}`).then((r) => r.json());
    const accepted = await request(`/api/intelligence/tasks/${task.id}/knowledge`, {
      expectedVersion: current.editVersion,
    }).then((r) => r.json());
    expect((await api(`/api/knowledge/artifacts/${accepted.processId}`)).status).toBe(200);
    expect((await request(`/api/intelligence/tasks/${task.id}/cancel`, {})).status).toBe(200);
    expect(
      (await request(`/api/intelligence/tasks/${task.id}/apply`, { expectedVersion: current.editVersion })).status,
    ).toBe(409);
    expect((await pool.query('SELECT 1 FROM wi_applications WHERE task_id=$1', [task.id])).rowCount).toBe(0);
    expect((await api(`/api/knowledge/artifacts/${accepted.processId}`)).status).toBe(200);
  });
  it('denies viewer knowledge mutations and rejects incompatible model connections', async () => {
    const source = await knowledgeSource();
    const other = await request('/api/control/connections', {
      name: 'Wrong model',
      provider: 'openai',
      config: {},
      secret: 'fixture',
    }).then((r) => r.json());
    expect(
      (
        await request('/api/intelligence/tasks', {
          sourceId: source.artifact.id,
          sourceRevisionId: source.revision.id,
          connectionId: other.id,
          connectionRevision: 1,
        })
      ).status,
    ).toBe(422);
    const email = `knowledge-viewer-${crypto.randomUUID()}@example.test`,
      invitation = await request('/api/control/invitations', { email, role: 'viewer' }).then((r) => r.json());
    const viewer = clientApi();
    await post(viewer, '/api/control/session/development', { email, displayName: 'Knowledge viewer' });
    await post(viewer, '/api/control/invitations/accept', { token: invitation.token });
    expect((await viewer('/api/knowledge/artifacts')).status).toBe(200);
    expect(
      (
        await post(viewer, '/api/knowledge/artifacts', {
          name: 'Forbidden',
          kind: 'ontology',
          content: knowledgeFixtures()[0].ontology,
        })
      ).status,
    ).toBe(403);
    expect((await post(viewer, '/api/intelligence/tasks', {})).status).toBe(403);
    expect(
      (
        await post(viewer, `/api/knowledge/artifacts/${source.artifact.id}/review`, {
          revisionId: source.revision.id,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(403);
  });
  it('persists workflow variable settings across a fresh fetch without changing stable references', async () => {
    const saved = await save(structuredClone(scopedExamples()[0].flow));
    const updated = {
      ...saved,
      declarations: saved.declarations!.map((declaration) => ({
        ...declaration,
        name: 'Renamed multiplier',
        schema: { type: 'integer' },
        initial: { mode: 'fixed' as const, value: 9 },
        writable: true,
      })),
      schedule: { enabled: false, cron: '0 * * * * *', timezone: 'UTC' },
    };
    expect((await request(`/api/flows/${saved.id}`, updated, 'PUT')).status).toBe(200);
    const response = await api(`/api/flows/${saved.id}`);
    expect(response.status).toBe(200);
    const loaded = await response.json();
    expect(loaded.declarations).toEqual(updated.declarations);
    expect(
      loaded.nodes.find((node: FlowNodeData) => node.id === 'prepare').config.parameters.values.fields.factor,
    ).toEqual({
      mode: 'expression',
      expression: '$input.variables.factor',
    });
    expect(loaded.schedule).toEqual(updated.schedule);
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
    const privateAgentSession = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Private workspace conversation',
    }).then((r) => r.json());
    expect((await other(`/api/agent/sessions/${privateAgentSession.id}`)).status).toBe(404);
    const privateRequest = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: 'Private intent',
      context: { surface: 'workspace' },
    }).then((r) => r.json());
    expect((await other(`/api/agent/requests/${privateRequest.requestId}`)).status).toBe(404);
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
    const protectedFlow = await save(blankNativeGraph());
    expect((await viewer(`/api/flows/${protectedFlow.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await post(viewer, '/api/authoring/test-code', { definition: defaultCode(), input: {} })).status).toBe(403);
    expect((await viewer('/api/agent/state')).status).toBe(200);
    expect(
      (
        await post(viewer, '/api/agent/requests', {
          clientRequestId: crypto.randomUUID(),
          text: 'Denied',
          context: { surface: 'workspace' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(viewer, '/api/agent/sessions', { clientKey: crypto.randomUUID(), title: 'Denied' })).status,
    ).toBe(403);
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
    // Use the fixture database's real sequence. Exponentially advancing it on every
    // suite run eventually overflows bigint; cursor comparisons below remain exact.
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
  it('resumes a structured answer through durable intake after JSONB reorders its fields', async () => {
    await agentConfig(true);
    const goal = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[AGENT_FORM]',
      context: { surface: 'workspace' },
    }).then((r) => r.json());
    const dispatched = await intakeWait(goal.requestId);
    const history = await api(`/api/agent/sessions/${dispatched.sessionId}`).then((r) => r.json());
    const ordinals = history.messages.map((m: any) => Number(m.ordinal));
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    const waiting = await agentWait(dispatched.workItemId, 'waiting_for_user');
    // Intentionally reverse PostgreSQL JSONB's object-key order.
    const values = { enabled: false, limit: 0, team: 'finance' };
    const payload = {
      clientRequestId: crypto.randomUUID(),
      kind: 'answer',
      text: JSON.stringify(values),
      context: { surface: 'workspace' },
      workItemId: waiting.id,
      expectedVersion: waiting.editVersion,
      response: { interactionId: waiting.interaction.id, values },
    };
    expect((await request('/api/agent/requests', { ...payload, text: '{"team":"sales"}' })).status).toBe(400);
    const accepted = await request('/api/agent/requests', payload);
    expect(accepted.status).toBe(202);
    const answer = await accepted.json();
    expect((await request('/api/agent/requests', payload).then((r) => r.json())).requestId).toBe(answer.requestId);
    await intakeWait(answer.requestId);
    await agentWait(waiting.id, 'completed');
    expect(
      (await pool.query('SELECT count(*) FROM wa_decisions WHERE work_item_id=$1', [waiting.id])).rows[0].count,
    ).toBe('1');
    await agentConfig(false);
  }, 30000);
  it('pauses the source port at the first typed question and records later tool calls as skipped', async () => {
    await agentConfig(true);
    const goal = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[AGENT_BATCH_PAUSE]',
      context: { surface: 'workspace' },
    }).then((r) => r.json());
    const dispatched = await intakeWait(goal.requestId);
    const waiting = await agentWait(dispatched.workItemId, 'waiting_for_user');
    expect(waiting.engine.engine).toBe('stackproc-workspace-harness');
    expect(waiting.engine.provider).toBe('integration-fixture');
    expect(waiting.tools).toBe(1);
    expect(waiting.interaction.fields[0].id).toBe('domain');
    const calls = (
      await pool.query(
        "SELECT request,result FROM wa_calls WHERE work_item_id=$1 AND kind='tool' ORDER BY created_at",
        [waiting.id],
      )
    ).rows;
    expect(calls).toHaveLength(2);
    expect(calls[1].result.skipped).toBe(true);
    expect(calls[1].result.interaction).toBeUndefined();
    const values = { domain: 'banking' };
    const answer = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      kind: 'answer',
      text: JSON.stringify(values),
      context: { surface: 'workspace' },
      workItemId: waiting.id,
      expectedVersion: waiting.editVersion,
      response: { interactionId: waiting.interaction.id, values },
    }).then((r) => r.json());
    await intakeWait(answer.requestId);
    const completed = await agentWait(waiting.id, 'completed');
    expect(completed.tools).toBe(1);
    expect(completed.turns).toBe(2);
    await agentConfig(false);
  }, 30000);
  it('renders proposal direction as a typed choice and resumes the same work after submission', async () => {
    await agentConfig(true);
    const goal = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[HARNESS_CHOICE_FORM]',
      context: { surface: 'intelligence' },
    }).then((r) => r.json());
    const dispatched = await intakeWait(goal.requestId);
    const waiting = await agentWait(dispatched.workItemId, 'waiting_for_user');
    expect(waiting.interaction.question).toContain('ontology proposal');
    expect(waiting.interaction.fields[0].type).toBe('select');
    expect(waiting.interaction.fields[0].options.map((option: any) => option.id)).toEqual([
      'properties',
      'subclasses',
      'both',
      'other',
    ]);
    const values = { direction: 'both' };
    const answer = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      kind: 'answer',
      text: JSON.stringify(values),
      context: { surface: 'intelligence' },
      workItemId: waiting.id,
      expectedVersion: waiting.editVersion,
      response: { interactionId: waiting.interaction.id, values },
    }).then((r) => r.json());
    await intakeWait(answer.requestId);
    expect((await agentWait(waiting.id, 'completed')).id).toBe(waiting.id);
    expect(
      (await pool.query('SELECT count(*) FROM wa_decisions WHERE work_item_id=$1', [waiting.id])).rows[0].count,
    ).toBe('1');
    await agentConfig(false);
  }, 30000);
  it('suspends prior-engine work instead of silently resuming it with the owned port', async () => {
    await agentConfig(true);
    const goal = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[AGENT_ASK]',
      context: { surface: 'workspace' },
    }).then((r) => r.json());
    const dispatched = await intakeWait(goal.requestId);
    const waiting = await agentWait(dispatched.workItemId, 'waiting_for_user');
    const before = (
      await pool.query("SELECT count(*) FROM wa_calls WHERE work_item_id=$1 AND kind='model'", [waiting.id])
    ).rows[0].count;
    await pool.query('UPDATE wa_work_items SET engine_provenance=$2 WHERE id=$1', [
      waiting.id,
      { engine: 'harness2', revision: 'historical' },
    ]);
    const answer = await request('/api/agent/requests', {
      clientRequestId: crypto.randomUUID(),
      kind: 'answer',
      text: 'Finance',
      context: { surface: 'workspace' },
      workItemId: waiting.id,
      expectedVersion: waiting.editVersion,
    }).then((r) => r.json());
    await intakeWait(answer.requestId);
    const suspended = await agentWait(waiting.id, 'suspended');
    expect(suspended.error).toContain('different agent engine revision');
    expect(
      (await pool.query("SELECT count(*) FROM wa_calls WHERE work_item_id=$1 AND kind='model'", [waiting.id])).rows[0]
        .count,
    ).toBe(before);
    await agentConfig(false);
  }, 30000);
  it('executes authored tools through agent discovery and pinned DBOS steps across restart', async () => {
    const id = crypto.randomUUID(),
      files = starterFiles(id);
    files['src/index.ts'] =
      `import type { Input,Output } from '../.stackproc/types'; export function run(input:Input):Output {return {total:input.values[0]===99?Math.random():input.values.reduce((a,b)=>a+b,0)};}`;
    let savedTool = await request('/api/tools/uploads', {
      id,
      files,
      expectedVersion: 0,
      commandKey: crypto.randomUUID(),
    }).then((r) => r.json());
    const test = await request(`/api/tools/${id}/tests`, { hash: savedTool.tool.hash }).then((r) => r.json());
    expect(test.success).toBe(true);
    const published = await request(`/api/tools/${id}/releases`, {
      hash: savedTool.tool.hash,
      version: '0.1.0',
      expectedVersion: 1,
      commandKey: crypto.randomUUID(),
    }).then((r) => r.json());
    expect(published.revision).toBe(1);
    savedTool = await request(`/api/tools/${id}/bindings`, {
      revision: 1,
      expectedVersion: 1,
      commandKey: crypto.randomUUID(),
    }).then((r) => r.json());
    await agentConfig(true);
    const session = await request('/api/agent/sessions', {
      clientKey: crypto.randomUUID(),
      title: 'Authored tool discovery',
    }).then((r) => r.json());
    const receipt = await request(`/api/agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: '[HARNESS_AUTHORED]',
    }).then((r) => r.json());
    await agentWait(receipt.workItemId, 'completed');
    const calls = (
      await pool.query(
        "SELECT request,result FROM wa_calls WHERE work_item_id=$1 AND kind='tool' ORDER BY created_at",
        [receipt.workItemId],
      )
    ).rows;
    expect(calls.some((c) => c.request.name.startsWith('workspace_tools__') && c.result.output?.total === 54)).toBe(
      true,
    );
    const provenance = (
      await pool.query('SELECT engine_provenance FROM wa_work_items WHERE id=$1', [receipt.workItemId])
    ).rows[0].engine_provenance;
    expect(provenance.authoredTools).toContainEqual(expect.objectContaining({ id, revision: 1 }));
    const flow = toolGraph(crypto.randomUUID(), 'Authored tool checkpoint', [
      toolNode('calculate', 'Calculate', {
        kind: 'step',
        handler: `workspace_tool.${id}.r1`,
        input: { source: 'literal', value: { values: [99] } },
      }),
      toolNode('pause', 'Pause', { kind: 'delay', durationMS: { source: 'literal', value: 3000 } }),
      toolEnd({ source: 'node', nodeId: 'calculate' }),
    ]);
    const saved = await save(flow),
      stream = await request('/api/flows/run', { flow: saved, input: {} }),
      reader = stream.body!.getReader();
    const first = await reader.read(),
      runId = JSON.parse(new TextDecoder().decode(first.value).trim().split('\n')[0]).runId;
    let recorded: any;
    for (let i = 0; i < 100; i++) {
      const before = await api(`/api/runs/${runId}`).then((r) => r.json());
      recorded = before.events.find(
        (r: any) => r.event.type === 'node.completed' && r.event.nodeId === 'calculate',
      )?.event;
      if (recorded) break;
      await delay(50);
    }
    expect(recorded).toBeDefined();
    await request(`/api/tools/${id}/bindings`, {
      revision: null,
      expectedVersion: savedTool.tool.editVersion,
      commandKey: crypto.randomUUID(),
    });
    await crash();
    await reader.cancel().catch(() => {});
    await start();
    const done = await terminal(runId);
    expect(done.status).toBe('succeeded');
    const completions = done.events.filter(
      (r: any) => r.event.type === 'node.completed' && r.event.nodeId === 'calculate',
    );
    expect(completions).toHaveLength(1);
    expect(completions[0].event.output).toEqual(recorded.output);
  });
});
