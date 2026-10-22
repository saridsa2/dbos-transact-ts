import { ContextBudget } from './agent/context-budget';
import { knowledgeFixtures } from '../lib/knowledge/fixtures';
import { migrateProcess } from '../lib/processes/model';
import { generateWorkflow } from '../lib/intelligence/generation';
import { createHarness2Bridge } from './agent/harness2-bridge';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.STUDIO_INTEGRATION !== '1')('Workspace harness concepts', () => {
  let processHandle: ChildProcess,
    pool: pg.Pool,
    connection: any,
    log = '';
  const cookies = new Map<string, string>();
  const api = async (path: string, value?: unknown, method = value === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:3024/api/${path}`, {
      method,
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(value !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    });
    for (const raw of response.headers.getSetCookie()) {
      const [k, ...v] = raw.split(';')[0].split('=');
      cookies.set(k, v.join('='));
    }
    return response;
  };
  const json = async (path: string, value?: unknown, method?: string) => {
    const r = await api(path, value, method);
    const data = await r.json();
    if (!r.ok) throw Error(`${r.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const configure = async (runtime = {}, limits = { turns: 8, tools: 16, outputTokens: 1024 }) => {
    const state = await json('agent/state');
    return json(
      'agent/configuration',
      {
        expectedVersion: state.configuration?.editVersion ?? 0,
        enabled: true,
        mode: 'assist',
        allowModel: true,
        connectionId: connection.id,
        connectionRevision: connection.revision ?? 1,
        triggers: [],
        limits,
        runtime,
      },
      'PUT',
    );
  };
  const wait = async (id: string, state = 'completed') => {
    for (let i = 0; i < 300; i++) {
      const w = await json(`agent/work-items/${id}`);
      if (w.state === state) return w;
      if (['failed', 'uncertain', 'suspended', 'budget_exhausted'].includes(w.state)) throw Error(JSON.stringify(w));
      await delay(100);
    }
    throw Error(`Timed out ${id}: ${log.slice(-1000)}`);
  };
  const begin = async (text: string, extra = {}) => {
    const session = await json('agent/sessions', { title: text, clientKey: crypto.randomUUID() });
    const work = await json(`agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text,
      attachments: [],
      ...extra,
    });
    return { session, work };
  };
  const answer = async (w: any, values: unknown) =>
    json(`agent/work-items/${w.id}/decisions`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: w.editVersion,
      response: { interactionId: w.interaction.id, values },
      answer: JSON.stringify(values),
      remember: false,
    });
  const createMemoryAgent = async (
    resources: any[] = [],
    approved = 'workspace',
    profile: Record<string, unknown> = {},
    instructions = 'Inspect only authorized pinned evidence.',
  ) => {
    const definition = {
      schemaVersion: 1,
      kind: 'specialist',
      name: 'Memory reviewer',
      description: 'Scoped memory',
      instructions,
      model: { provider: 'minimax', connectionId: connection.id, connectionRevision: 1 },
      tools: [
        'artifact_read_v1',
        'memory_search_v2',
        'agent_result_read_v2',
        'agent_memory_propose_v2',
        ...(profile.history ? ['agent_history_read_v1'] : []),
      ],
      context: { scope: 'selected', resources },
      memory: {
        version: 1,
        working: 'compact',
        session: 'same_revision',
        approved,
        maxRetrievedEntries: 8,
        maxRetrievedTokens: 2000,
        ...profile,
      },
      limits: { turns: 12, tools: 24, outputTokens: 1024 },
      interaction: 'interactive',
    };
    const draft = await json('agent/definitions', { clientKey: crypto.randomUUID(), expectedVersion: 0, definition });
    const ref = await json(`agent/definitions/${draft.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    });
    const saved = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/resume`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: saved.editVersion,
    });
    return { ref, definition };
  };
  const invokeMemoryAgent = async (ref: any, text: string) => {
    const submitted = await json('agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text,
      agent: { agentId: ref.agentId, revision: ref.revision, hash: ref.hash },
      context: { surface: 'intelligence' },
    });
    for (let i = 0; i < 100; i++) {
      const receipt = await json(`agent/requests/${submitted.requestId}`);
      if (receipt.state === 'rejected') throw Error(receipt.error);
      if (receipt.workItemId) return receipt;
      await delay(50);
    }
    throw Error('Memory dispatch timed out');
  };
  it('prepares bounded encrypted observations through the durable host and indexes only approved Mem0 versions', async () => {
    await configure({}, { turns: 12, tools: 24, outputTokens: 1024 });
    const source = await json('knowledge/artifacts', {
      name: 'Observational history reference',
      kind: 'source',
      content: {
        schemaVersion: 1,
        mediaType: 'text/plain',
        text: 'Verified onboarding original evidence. '.repeat(2600),
      },
    });
    const resource = { kind: 'source', id: source.artifact.id, revisionId: source.revision.id };
    const { ref } = await createMemoryAgent([resource], 'workspace', { history: 'observational_v1', index: 'mem0_v1' });
    const started = await invokeMemoryAgent(
      ref,
      `[HARNESS_WORKING_MEMORY] ${resource.id} ${resource.revisionId} history`,
    );
    const done = await wait(started.workItemId);
    expect(done.state, done.error).toBe('completed');
    const segments = (
      await pool.query('SELECT * FROM wa_history_segments WHERE work_item_id=$1 ORDER BY generation', [done.id])
    ).rows;
    expect(segments.length).toBeGreaterThan(0);
    expect(JSON.stringify(segments)).not.toContain('Verified source pages retained');
    expect(JSON.stringify(segments)).not.toContain('private fixture reasoning');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='artifact_read_v1'",
          [done.id],
        )
      ).rows[0].n,
    ).toBe(10);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='agent_history_read_v1' AND state='completed'",
          [done.id],
        )
      ).rowCount,
    ).toBe(1);
    expect((await json(`agent/work-items/${done.id}/context`)).history.length).toBeGreaterThan(0);
    expect(done.usage.tokens).toBeLessThan(200000);
    const address = (await pool.query('SELECT workspace_id,session_id FROM wa_work_items WHERE id=$1', [done.id]))
      .rows[0];
    const high = (
      await pool.query('SELECT max(ordinal)::int n FROM wa_messages WHERE workspace_id=$1 AND session_id=$2', [
        address.workspace_id,
        address.session_id,
      ])
    ).rows[0].n;
    await pool.query(
      "INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,content) SELECT $1,gen_random_uuid()::text,$2,$3+g,CASE WHEN g%2=0 THEN 'assistant' ELSE 'user' END,'OLD_FACT: original decision. History '||g||' '||CASE WHEN g=1 THEN repeat('😀',5000) ELSE repeat('x',500) END FROM generate_series(1,700) g",
      [address.workspace_id, address.session_id, high],
    );
    const backlog = await invokeMemoryAgent(ref, '[HARNESS_STREAM]');
    const continued = await wait(backlog.workItemId);
    expect(continued.state).toBe('completed');
    const pages = (
      await pool.query(
        "SELECT source_manifest FROM wa_history_segments WHERE work_item_id=$1 AND phase='observe' ORDER BY generation",
        [continued.id],
      )
    ).rows.flatMap((r) => r.source_manifest.fragments);
    const partial = pages.find((p) => p.offset > 0);
    expect(partial).toBeDefined();
    const ranges = pages.filter((p) => p.id === partial.id).sort((a, b) => a.offset - b.offset);
    expect(ranges[0].offset).toBe(0);
    expect(ranges.at(-1).end).toBe(ranges.at(-1).total);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].offset).toBe(ranges[i - 1].end);
    expect(ranges.every((r) => r.offsetUnit === 'unicode_codepoints')).toBe(true);

    expect(
      (await pool.query("SELECT 1 FROM wa_history_segments WHERE work_item_id=$1 AND phase='reflect'", [continued.id]))
        .rowCount,
    ).toBeGreaterThan(0);
    expect(
      (await pool.query("SELECT 1 FROM wa_activity WHERE work_item_id=$1 AND kind='history_preparing'", [continued.id]))
        .rowCount,
    ).toBeGreaterThan(0);
    expect(
      (
        await pool.query('SELECT max(fragment_offset)::int n FROM wa_history_heads WHERE workspace_id=$1', [
          address.workspace_id,
        ])
      ).rows[0].n,
    ).toBe(0);
    const proposal = await json(`agent/work-items/${done.id}/memory`, {
      clientKey: crypto.randomUUID(),
      proposal: { content: 'Onboarding requires verified customer identity.', scope: 'agent', evidence: [resource] },
    });
    await json(`agent/memory/${proposal.id}/review`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: proposal.version,
      decision: 'approve',
    });
    const recalled = await invokeMemoryAgent(ref, '[HARNESS_STREAM] onboarding');
    await wait(recalled.workItemId);
    const vectors = (await pool.query('SELECT * FROM wa_memory_vectors WHERE memory_id=$1', [proposal.id])).rows;
    expect(vectors).toHaveLength(1);
    expect(JSON.stringify(vectors)).not.toContain('Onboarding requires verified');
    const again = await invokeMemoryAgent(ref, '[HARNESS_STREAM] onboarding');
    await wait(again.workItemId);
    expect(
      (await pool.query('SELECT count(*)::int n FROM wa_memory_vectors WHERE memory_id=$1', [proposal.id])).rows[0].n,
    ).toBe(1);
    await json(`agent/memory/${proposal.id}/review`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: proposal.version + 1,
      decision: 'revoke',
    });
    expect((await pool.query('SELECT 1 FROM wa_memory_vectors WHERE memory_id=$1', [proposal.id])).rowCount).toBe(0);
  }, 60000);
  it('continues one observational activity through early context pressure without narrowing the goal', async () => {
    await configure({}, { turns: 12, tools: 24, outputTokens: 1024 });
    const source = await json('knowledge/artifacts', {
      name: 'Context pressure original',
      kind: 'source',
      content: { schemaVersion: 1, mediaType: 'text/plain', text: 'Authorized onboarding source. '.repeat(3600) },
    });
    const resource = { kind: 'source', id: source.artifact.id, revisionId: source.revision.id };
    const { ref } = await createMemoryAgent(
      [resource],
      'off',
      { history: 'observational_v1' },
      'Preserve source evidence. '.repeat(600),
    );
    const started = await invokeMemoryAgent(
      ref,
      `[HARNESS_WORKING_MEMORY] ${resource.id} ${resource.revisionId} pressure`,
    );
    const done = await wait(started.workItemId);
    expect(done.state, done.error).toBe('completed');
    expect(done.id).toBe(started.workItemId);
    expect(done.activity.some((e: any) => e.kind === 'context_compacted')).toBe(true);
    const maintenance = (
      await pool.query(
        "SELECT min(turn_no)::int first_turn FROM wa_calls WHERE work_item_id=$1 AND call_key LIKE 'history:observe:%'",
        [done.id],
      )
    ).rows[0];
    expect(maintenance.first_turn).toBeLessThanOrEqual(2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='artifact_read_v1' AND state='completed'",
          [done.id],
        )
      ).rows[0].n,
    ).toBe(10);
    expect(
      (await pool.query('SELECT count(*)::int n FROM wa_work_items WHERE session_id=$1', [started.sessionId])).rows[0]
        .n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT count(*)::int n FROM wa_history_segments WHERE work_item_id=$1', [done.id])).rows[0].n,
    ).toBeGreaterThan(0);
  }, 60000);
  it('compacts published-agent observations into durable encrypted checkpoints within the original grant', async () => {
    await configure({}, { turns: 12, tools: 24, outputTokens: 1024 });
    const source = await json('knowledge/artifacts', {
      name: 'Pinned customer onboarding reference',
      kind: 'source',
      content: {
        schemaVersion: 1,
        mediaType: 'text/plain',
        text: 'Verified source evidence for customer onboarding. '.repeat(2100),
      },
    });
    const resource = { kind: 'source', id: source.artifact.id, revisionId: source.revision.id };
    const { ref } = await createMemoryAgent([resource]);
    const started = await invokeMemoryAgent(
      ref,
      `[HARNESS_WORKING_MEMORY] ${resource.id} ${resource.revisionId} onboarding`,
    );
    const done = await wait(started.workItemId);
    expect(done.usage.tokens).toBeLessThan(200000);
    const snapshots = (await pool.query('SELECT * FROM wa_work_context_snapshots WHERE work_item_id=$1', [done.id]))
      .rows;
    expect(snapshots.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshots)).not.toContain('OLD_FACT');
    expect(done.activity.some((e: any) => e.kind === 'context_compacted')).toBe(true);
    expect(
      (await pool.query("SELECT 1 FROM wa_harness_events WHERE work_item_id=$1 AND kind='memory_retrieved'", [done.id]))
        .rowCount,
    ).toBe(0);
    const inspected = await json(`agent/work-items/${done.id}/context`);
    expect(inspected.snapshots.length).toBeGreaterThan(0);
    const receiptRun = await invokeMemoryAgent(ref, `[HARNESS_MEMORY_RECEIPT] ${resource.id} ${resource.revisionId}`);
    const receiptDone = await wait(receiptRun.workItemId);
    expect(receiptDone.messages.at(-1).content).toContain('without inventing');
    expect(
      (
        await pool.query(
          "SELECT result FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='agent_result_read_v2'",
          [receiptDone.id],
        )
      ).rows[0].result.sourceWorkId,
    ).toBe(receiptDone.id);
    const proposal = {
      scope: 'agent',
      content: 'Customer onboarding requires verified source evidence.',
      evidence: [resource],
    };
    const created = await json(`agent/work-items/${done.id}/memory`, { clientKey: crypto.randomUUID(), proposal });
    let listing = await json('agent/memory');
    expect(listing.items.find((m: any) => m.id === created.id).state).toBe('proposed');
    const decision = { clientKey: crypto.randomUUID(), expectedVersion: created.version, decision: 'approve' };
    const approved = await json(`agent/memory/${created.id}/review`, decision);
    expect((await json(`agent/memory/${created.id}/review`, decision)).version).toBe(approved.version);
    const otherAgent = await createMemoryAgent([resource]);
    const isolated = await invokeMemoryAgent(otherAgent.ref, '[HARNESS_MEMORY_RESUME] onboarding');
    await wait(isolated.workItemId);
    expect(
      (
        await pool.query("SELECT 1 FROM wa_harness_events WHERE work_item_id=$1 AND kind='memory_retrieved'", [
          isolated.workItemId,
        ])
      ).rowCount,
    ).toBe(0);
    const encrypted = (await pool.query('SELECT content FROM wa_memory_versions WHERE memory_id=$1', [created.id]))
      .rows;
    expect(JSON.stringify(encrypted)).not.toContain(proposal.content);
    // API review and encrypted storage are exercised above; runtime retrieval is verified using a second activity below.
    const replay = await invokeMemoryAgent(
      ref,
      `[HARNESS_WORKING_MEMORY] ${resource.id} ${resource.revisionId} onboarding`,
    );
    await wait(replay.workItemId);
    expect(
      (
        await pool.query("SELECT 1 FROM wa_harness_events WHERE work_item_id=$1 AND kind='memory_retrieved'", [
          replay.workItemId,
        ])
      ).rowCount,
    ).toBeGreaterThan(0);
    const revoked = await json(`agent/memory/${created.id}/review`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: approved.version,
      decision: 'revoke',
    });
    expect(revoked.state).toBe('revoked');
    const afterRevocation = await invokeMemoryAgent(ref, '[HARNESS_MEMORY_RESUME] onboarding');
    await wait(afterRevocation.workItemId);
    expect(
      (
        await pool.query("SELECT 1 FROM wa_harness_events WHERE work_item_id=$1 AND kind='memory_retrieved'", [
          afterRevocation.workItemId,
        ])
      ).rowCount,
    ).toBe(0);
    const denied = { ...proposal, evidence: [{ ...resource, revisionId: crypto.randomUUID() }] };
    expect(
      (await api(`agent/work-items/${done.id}/memory`, { clientKey: crypto.randomUUID(), proposal: denied })).status,
    ).toBe(403);
    const expired = await json(`agent/work-items/${done.id}/memory`, {
      clientKey: crypto.randomUUID(),
      proposal: { ...proposal, expiresAt: '2020-01-01T00:00:00Z' },
    });
    expect(
      (
        await api(`agent/memory/${expired.id}/review`, {
          clientKey: crypto.randomUUID(),
          expectedVersion: 1,
          decision: 'approve',
        })
      ).status,
    ).toBe(409);

    const actor = (await pool.query('SELECT workspace_id,sponsor_id FROM wa_work_items WHERE id=$1', [done.id]))
      .rows[0];
    try {
      await pool.query("UPDATE cp_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2", [
        actor.workspace_id,
        actor.sponsor_id,
      ]);
      expect((await api('agent/memory')).status).toBe(403);
      expect(
        (await api(`agent/work-items/${done.id}/memory`, { clientKey: crypto.randomUUID(), proposal })).status,
      ).toBe(403);
    } finally {
      await pool.query("UPDATE cp_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2", [
        actor.workspace_id,
        actor.sponsor_id,
      ]);
    }

    expect(
      (
        await api(`agent/memory/${created.id}/review`, {
          clientKey: crypto.randomUUID(),
          expectedVersion: approved.version,
          decision: 'approve',
        })
      ).status,
    ).toBe(409);
  }, 60000);
  it('resumes a checkpoint with an idempotent approved extension inside the pinned ceiling', async () => {
    await configure({ totalTokens: 1024, maxTotalTokens: 16384 });
    const { ref } = await createMemoryAgent();
    const started = await invokeMemoryAgent(ref, '[HARNESS_MEMORY_RESUME]');
    const paused = await wait(started.workItemId, 'budget_exhausted');
    const grant = {
      clientKey: crypto.randomUUID(),
      expectedVersion: paused.editVersion,
      additionalTokens: 12000,
      reason: 'Complete bounded inspection',
    };
    expect(
      (
        await api(`agent/work-items/${paused.id}/resume`, {
          ...grant,
          clientKey: crypto.randomUUID(),
          additionalTokens: 20000,
        })
      ).status,
    ).toBe(409);
    const owner = (await pool.query('SELECT workspace_id FROM wa_work_items WHERE id=$1', [paused.id])).rows[0]
      .workspace_id;
    const failedReceipt = crypto.randomUUID();
    await pool.query(
      "INSERT INTO wa_calls(workspace_id,id,work_item_id,turn_no,kind,call_key,state,request_hash) VALUES($1,$2,$3,0,'model','turn:0','uncertain','isolated-outcome-fixture')",
      [owner, failedReceipt, paused.id],
    );
    expect(
      (await api(`agent/work-items/${paused.id}/resume`, { ...grant, clientKey: crypto.randomUUID() })).status,
    ).toBe(409);
    await pool.query("UPDATE wa_calls SET state='failed',completed_at=now(),result=$2 WHERE id=$1", [
      failedReceipt,
      { usage: { input: 0, output: 0 } },
    ]);
    const resumed = await json(`agent/work-items/${paused.id}/resume`, grant);
    expect(await json(`agent/work-items/${paused.id}/resume`, grant)).toEqual(resumed);
    const done = await wait(paused.id);
    expect(done.messages.at(-1).content).toBe('Resumed within the approved memory budget.');
    expect(
      (await pool.query('SELECT count(*)::int n FROM wa_work_budget_grants WHERE work_item_id=$1', [paused.id])).rows[0]
        .n,
    ).toBe(1);
    const stored = (await pool.query('SELECT * FROM wa_work_items WHERE id=$1', [done.id])).rows[0];
    const children = [crypto.randomUUID(), crypto.randomUUID()];
    for (const child of children) {
      await pool.query(
        "INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot) VALUES($1,$2,$3,$4,'completed','Budget reservation fixture',1,'{}')",
        [stored.workspace_id, child, stored.session_id, stored.sponsor_id],
      );
      await pool.query(
        'INSERT INTO wa_agent_tasks(workspace_id,id,parent_work_id,child_work_id,title,depth,request_hash,request_key) VALUES($1,$2,$3,$4,$5,1,$6,$4)',
        [stored.workspace_id, crypto.randomUUID(), done.id, child, 'Budget fixture', 'fixture'],
      );
    }
    const budget = new ContextBudget({
      pool,
      authorize: async () => ({ work: stored, config: { runtime: { totalTokens: 10000 } } }),
      control: {
        transaction: async (fn: any) => {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            const result = await fn(c);
            await c.query('COMMIT');
            return result;
          } catch (e) {
            await c.query('ROLLBACK');
            throw e;
          } finally {
            c.release();
          }
        },
      },
    } as any);
    const workIds = [done.id, ...children, done.id, ...children];
    const keys = workIds.map(() => crypto.randomUUID());
    const reservations = await Promise.all(
      workIds.map((id, i) => budget.reserve(stored.workspace_id, id, keys[i], 3000, 1024)),
    );
    expect(reservations.filter((r) => r.allowed)).toHaveLength(4);
    const admitted = reservations.findIndex((r) => r.allowed);
    expect(await budget.reserve(stored.workspace_id, workIds[admitted], keys[admitted], 3000, 1024)).toEqual(
      reservations[admitted],
    );
    await expect(budget.reserve(stored.workspace_id, workIds[admitted], keys[admitted], 6000, 1024)).rejects.toThrow(
      'Prepared request changed',
    );
    await configure();
  });
  it('publishes workspace-owned agents and executes pinned instructions with scoped tools and durable answers', async () => {
    await configure();
    const definition = {
      schemaVersion: 1,
      kind: 'specialist',
      name: 'Ontology reviewer',
      description: 'Review assigned knowledge',
      instructions: 'DEFINITION_MARKER: inspect only assigned context.',
      model: { provider: 'minimax', connectionId: connection.id, connectionRevision: connection.revision ?? 1 },
      tools: ['workspace_describe_v1', 'ask_user_v2'],
      context: { scope: 'selected', resources: [] },
      limits: { turns: 8, tools: 16, outputTokens: 1024 },
      interaction: 'interactive',
    };
    const create = { clientKey: crypto.randomUUID(), expectedVersion: 0, definition };
    let draft = await json('agent/definitions', create);
    expect((await json('agent/definitions', create)).id).toBe(draft.id);
    const publication = {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    };
    const ref = await json(`agent/definitions/${draft.id}/publish`, publication);
    expect((await json(`agent/definitions/${draft.id}/publish`, publication)).revision).toBe(1);
    const submit = async (text: string, agent = ref) => {
      const r = await json('agent/requests', {
        clientRequestId: crypto.randomUUID(),
        text,
        agent: { agentId: agent.agentId, revision: agent.revision, hash: agent.hash },
        context: { surface: 'intelligence' },
      });
      for (let i = 0; i < 100; i++) {
        const receipt = await json(`agent/requests/${r.requestId}`);
        if (receipt.state === 'rejected') throw Error(receipt.error);
        if (receipt.workItemId) return receipt;
        await delay(50);
      }
      throw Error('Dispatch timeout');
    };
    expect(
      (
        await api('agent/requests', {
          clientRequestId: crypto.randomUUID(),
          text: 'test',
          agent: { agentId: ref.agentId, revision: ref.revision, hash: ref.hash },
          context: { surface: 'intelligence' },
        })
      ).status,
    ).toBe(409);
    draft = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/resume`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
    });
    const started = await submit('[HARNESS_DEFINED]');
    const done = await wait(started.workItemId);
    const stored = (await pool.query('SELECT execution_snapshot,sponsor_id FROM wa_work_items WHERE id=$1', [done.id]))
      .rows[0];
    expect(stored.execution_snapshot.ref.revision).toBe(1);
    expect(stored.execution_snapshot.actorId).toBe(stored.sponsor_id);
    const continuation = await json('agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[HARNESS_DEFINED_CONTINUE]',
      sessionId: started.sessionId,
      context: { surface: 'intelligence' },
    });
    let continuationReceipt: any;
    for (let i = 0; i < 100; i++) {
      continuationReceipt = await json(`agent/requests/${continuation.requestId}`);
      if (continuationReceipt.workItemId) break;
      await delay(50);
    }
    const continued = await wait(continuationReceipt.workItemId);
    expect(continued.sessionId).toBe(started.sessionId);
    expect(continued.id).not.toBe(done.id);
    const continuedHistory = await json(`agent/sessions/${started.sessionId}`);
    expect(continuedHistory.messages.at(-1).content).toBe('Continued with the previous agent result.');
    const waiting = await wait((await submit('[HARNESS_CHOICE_FORM]')).workItemId, 'waiting_for_user');
    const queued = await json('agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: '[HARNESS_DEFINED]',
      agent: { agentId: ref.agentId, revision: ref.revision, hash: ref.hash },
      context: { surface: 'intelligence' },
    });
    let other = await json('agent/definitions', {
      clientKey: crypto.randomUUID(),
      expectedVersion: 0,
      definition: { ...definition, name: 'Independent reviewer' },
    });
    const otherRef = await json(`agent/definitions/${other.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: other.editVersion,
      draftHash: other.draftHash,
    });
    other = await json(`agent/definitions/${other.id}`);
    await json(`agent/definitions/${other.id}/resume`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: other.editVersion,
    });
    await wait((await submit('[HARNESS_DEFINED]', otherRef)).workItemId);
    expect((await json(`agent/requests/${queued.requestId}`)).state).toBe('queued');
    draft = await json(`agent/definitions/${draft.id}`);
    draft = await json(
      `agent/definitions/${draft.id}`,
      {
        clientKey: crypto.randomUUID(),
        expectedVersion: draft.editVersion,
        definition: { ...definition, instructions: 'DEFINITION_MARKER: version two.' },
      },
      'PATCH',
    );
    const second = await json(`agent/definitions/${draft.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    });
    expect(second.revision).toBe(2);
    await answer(waiting, { direction: 'both' });
    await wait(waiting.id);
    expect(
      (await pool.query('SELECT execution_snapshot FROM wa_work_items WHERE id=$1', [waiting.id])).rows[0]
        .execution_snapshot.ref.revision,
    ).toBe(1);
    const forged = await submit('[HARNESS_DEFINED_FORGED]');
    let blocked = await json(`agent/work-items/${forged.workItemId}`);
    for (let i = 0; i < 100 && !['suspended', 'failed'].includes(blocked.state); i++) {
      await delay(50);
      blocked = await json(`agent/work-items/${forged.workItemId}`);
    }
    expect(blocked.state).toBe('suspended');
    expect(
      (await pool.query("SELECT count(*) FROM wa_calls WHERE work_item_id=$1 AND kind='tool'", [blocked.id])).rows[0]
        .count,
    ).toBe('0');
    draft = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/pause`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
    });
    expect(
      (
        await api('agent/requests', {
          clientRequestId: crypto.randomUUID(),
          text: 'paused',
          agent: { agentId: ref.agentId, revision: ref.revision, hash: ref.hash },
          context: { surface: 'intelligence' },
        })
      ).status,
    ).toBe(409);
    draft = await json(`agent/definitions/${draft.id}`);
    const duplication = { clientKey: crypto.randomUUID(), expectedVersion: draft.editVersion };
    const copy = await json(`agent/definitions/${draft.id}/duplicate`, duplication);
    expect(await json(`agent/definitions/${draft.id}/duplicate`, duplication)).toEqual(copy);
    expect(copy.enabled).toBe(false);
    expect(copy.publishedRevision).toBeNull();
    await json(`agent/definitions/${copy.id}/archive`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: copy.editVersion,
    });
    expect((await json(`agent/definitions/${copy.id}`)).archivedAt).toBeTruthy();
  }, 30000);
  it('bootstraps reviewed workspace setup and activates a coordinator exactly once', async () => {
    await configure();
    const command = { clientKey: crypto.randomUUID(), goal: '[HARNESS_SETUP] Establish operations', sources: [] };
    const setup = await json('agent/setup-runs', command);
    expect((await json('agent/setup-runs', command)).id).toBe(setup.id);
    let review = await json(`agent/setup-runs/${setup.id}`);
    for (let i = 0; i < 200 && !review.bundle; i++) {
      if (review.projectionError) throw Error(review.projectionError);
      await delay(50);
      review = await json(`agent/setup-runs/${setup.id}`);
    }
    expect(review.bundle.result.purpose).toBe('Operations workspace');
    const originalHash = review.bundleHash;
    const revisedResult = {
      ...review.bundle.result,
      coordinator: {
        ...review.bundle.result.coordinator,
        instructions: review.bundle.result.coordinator.instructions + ' Prioritize evidence-backed work.',
      },
    };
    await json(`agent/setup-runs/${setup.id}/revise`, {
      clientKey: crypto.randomUUID(),
      bundleHash: originalHash,
      result: revisedResult,
    });
    review = await json(`agent/setup-runs/${setup.id}`);
    expect(review.bundleHash).not.toBe(originalHash);
    expect(
      (
        await api(`agent/setup-runs/${setup.id}/activate`, {
          clientKey: crypto.randomUUID(),
          bundleHash: originalHash,
          acceptedGaps: [0],
        })
      ).status,
    ).toBe(409);
    expect(
      (await pool.query('SELECT count(*) FROM wa_setup_bundle_versions WHERE setup_id=$1', [setup.id])).rows[0].count,
    ).toBe('2');
    expect(review.activatedAt).toBeNull();
    const ws = (await pool.query('SELECT workspace_id FROM wa_setup_runs WHERE id=$1', [setup.id])).rows[0]
      .workspace_id;
    expect(
      (await pool.query('SELECT count(*) FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [ws])).rows[0].count,
    ).toBe('0');
    expect(
      (
        await api(`agent/setup-runs/${setup.id}/activate`, {
          clientKey: crypto.randomUUID(),
          bundleHash: review.bundleHash,
          acceptedGaps: [],
        })
      ).status,
    ).toBe(422);
    const activation = { clientKey: crypto.randomUUID(), bundleHash: review.bundleHash, acceptedGaps: [0] };
    const activated = await json(`agent/setup-runs/${setup.id}/activate`, activation);
    expect((await json('agent/understanding')).content.purpose).toBe('Operations workspace');
    expect(await json(`agent/setup-runs/${setup.id}/activate`, activation)).toEqual(activated);
    const registry = await json('agent/definitions');
    expect(registry.items.some((a: any) => a.name === 'Workspace setup')).toBe(false);
    expect(registry.items.some((a: any) => a.id === activated.agentId)).toBe(true);
    const request = await json('agent/requests', {
      clientRequestId: crypto.randomUUID(),
      text: 'Inspect the workspace',
      context: { surface: 'intelligence' },
    });
    let receipt = await json(`agent/requests/${request.requestId}`);
    for (let i = 0; i < 100 && !receipt.workItemId; i++) {
      await delay(50);
      receipt = await json(`agent/requests/${request.requestId}`);
    }
    await wait(receipt.workItemId);
    expect(
      (await pool.query('SELECT execution_snapshot FROM wa_work_items WHERE id=$1', [receipt.workItemId])).rows[0]
        .execution_snapshot.ref.agentId,
    ).toBe(activated.agentId);
    // This fixture's adoption must not change the legacy paths tested below.
    await pool.query('DELETE FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [ws]);
  }, 30000);
  it('generates a specialist draft and dispatches a coordinator suggestion only after explicit acceptance', async () => {
    await configure();
    const generation = await json('agent/definition-drafts/generate', {
      clientKey: crypto.randomUUID(),
      goal: '[HARNESS_DRAFT] Review assigned knowledge',
      sources: [],
    });
    let generated = await json(`agent/setup-runs/${generation.id}`);
    for (let i = 0; i < 200 && !generated.draftAgentId; i++) {
      if (generated.projectionError) throw Error(generated.projectionError);
      await delay(50);
      generated = await json(`agent/setup-runs/${generation.id}`);
    }
    let draft = await json(`agent/definitions/${generated.draftAgentId}`);
    expect(draft.enabled).toBe(false);
    expect(draft.publishedRevision).toBeNull();
    await json(`agent/definitions/${draft.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    });
    draft = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/resume`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
    });
    const setup = await json('agent/setup-runs', {
      clientKey: crypto.randomUUID(),
      goal: '[HARNESS_SETUP] Coordinate inspections',
      sources: [],
    });
    let ready = await json(`agent/setup-runs/${setup.id}`);
    for (let i = 0; i < 200 && !ready.bundle; i++) {
      await delay(50);
      ready = await json(`agent/setup-runs/${setup.id}`);
    }
    const coordinator = await json(`agent/setup-runs/${setup.id}/activate`, {
      clientKey: crypto.randomUUID(),
      bundleHash: ready.bundleHash,
      acceptedGaps: [0],
    });
    try {
      const request = await json('agent/requests', {
        clientRequestId: crypto.randomUUID(),
        text: '[HARNESS_COORDINATE]',
        context: { surface: 'intelligence' },
      });
      let receipt = await json(`agent/requests/${request.requestId}`);
      for (let i = 0; i < 100 && !receipt.workItemId; i++) {
        await delay(50);
        receipt = await json(`agent/requests/${request.requestId}`);
      }
      await wait(receipt.workItemId);
      const suggestion = (await json('agent/suggestions')).items.find(
        (s: any) => s.proposal.executor?.agentId === draft.id,
      );
      expect(suggestion.state).toBe('proposed');
      expect(suggestion.assignmentId).toBeNull();
      const acceptance = {
        clientKey: crypto.randomUUID(),
        expectedVersion: suggestion.editVersion,
        hash: suggestion.hash,
      };
      const accepted = await json(`agent/suggestions/${suggestion.id}/accept`, acceptance);
      expect(await json(`agent/suggestions/${suggestion.id}/accept`, acceptance)).toEqual(accepted);
      let assigned = await json(`agent/requests/${accepted.requestId}`);
      for (let i = 0; i < 100 && !assigned.workItemId; i++) {
        await delay(50);
        assigned = await json(`agent/requests/${accepted.requestId}`);
      }
      const done = await wait(assigned.workItemId);
      expect(done.state).toBe('completed');
      expect(
        (await pool.query('SELECT count(*) FROM wa_agent_assignments WHERE suggestion_id=$1', [suggestion.id])).rows[0]
          .count,
      ).toBe('1');
      expect((await json(`agent/definitions/${draft.id}/summary`)).activity[0].runs).toBe(1);
    } finally {
      await pool.query('DELETE FROM wa_workspace_agent_bindings WHERE agent_id=$1', [coordinator.agentId]);
    }
  }, 30000);
  it('captures paused coordinator changes, pins saved heads and bounds opt-in reviews', async () => {
    await configure();
    let source = await json('knowledge/artifacts', {
      name: 'Automatic review source',
      kind: 'source',
      content: { schemaVersion: 1, mediaType: 'text/plain', text: 'Initial operations evidence.' },
    });
    const setup = await json('agent/setup-runs', {
      clientKey: crypto.randomUUID(),
      goal: '[HARNESS_SETUP] Watch saved operations',
      sources: [{ kind: 'source', id: source.artifact.id, revisionId: source.revision.id }],
    });
    let ready = await json(`agent/setup-runs/${setup.id}`);
    for (let i = 0; i < 200 && !ready.bundle; i++) {
      if (ready.projectionError) throw Error(ready.projectionError);
      await delay(50);
      ready = await json(`agent/setup-runs/${setup.id}`);
    }
    const activation = {
      clientKey: crypto.randomUUID(),
      bundleHash: ready.bundleHash,
      acceptedGaps: [0],
      startInspection: true,
    };
    const coordinator = await json(`agent/setup-runs/${setup.id}/activate`, activation);
    expect(await json(`agent/setup-runs/${setup.id}/activate`, activation)).toEqual(coordinator);
    const ws = (await pool.query('SELECT workspace_id FROM wa_setup_runs WHERE id=$1', [setup.id])).rows[0]
      .workspace_id;
    const dispatched = async (id: string) => {
      for (let i = 0; i < 200; i++) {
        const r = await json(`agent/requests/${id}`);
        if (r.state === 'rejected') throw Error(r.error);
        if (r.workItemId) return r;
        await delay(50);
      }
      throw Error('Review dispatch timed out');
    };
    const latest = async () => {
      for (let i = 0; i < 200; i++) {
        const rows = (await pool.query('SELECT * FROM wa_coordinator_admissions WHERE workspace_id=$1', [ws])).rows;
        if (rows.length) return rows[0];
        await delay(50);
      }
      throw Error('No automatic review admitted');
    };
    try {
      expect(coordinator.initialRequestId).toBeTruthy();
      await wait((await dispatched(coordinator.initialRequestId)).workItemId);
      expect((await json('agent/coordinator-review')).enabled).toBe(false);
      const rule = await json(
        'agent/coordinator-review',
        {
          clientKey: crypto.randomUUID(),
          expectedVersion: 0,
          target: { agentId: coordinator.agentId, revision: coordinator.revision, hash: coordinator.hash },
          enabled: true,
          maxRuns: 1,
          dailyTokens: 4096,
        },
        'PUT',
      );
      let definition = await json(`agent/definitions/${coordinator.agentId}`);
      await json(`agent/definitions/${definition.id}/pause`, {
        clientKey: crypto.randomUUID(),
        expectedVersion: definition.editVersion,
      });
      source = await json(
        `knowledge/artifacts/${source.artifact.id}`,
        {
          name: source.artifact.name,
          kind: 'source',
          expectedVersion: source.artifact.editVersion,
          content: { schemaVersion: 1, mediaType: 'text/plain', text: 'Updated while coordinator paused.' },
        },
        'PUT',
      );
      let paused: any;
      for (let i = 0; i < 100; i++) {
        paused = await json('agent/coordinator-review');
        if (paused.pending === 1 && paused.error) break;
        await delay(50);
      }
      expect(paused.pending).toBe(1);
      expect(paused.error).toMatch(/paused/);
      expect(
        (await pool.query('SELECT count(*) FROM wa_coordinator_admissions WHERE workspace_id=$1', [ws])).rows[0].count,
      ).toBe('0');
      definition = await json(`agent/definitions/${definition.id}`);
      await json(`agent/definitions/${definition.id}/resume`, {
        clientKey: crypto.randomUUID(),
        expectedVersion: definition.editVersion,
      });
      const admission = await latest(),
        receipt = await dispatched(admission.request_id);
      await wait(receipt.workItemId);
      const snapshot = (
        await pool.query('SELECT execution_snapshot FROM wa_work_items WHERE id=$1', [receipt.workItemId])
      ).rows[0].execution_snapshot;
      expect(snapshot.automaticReview.ruleVersion).toBe(rule.editVersion);
      expect(snapshot.contextResources).toEqual([
        { kind: 'source', id: source.artifact.id, revisionId: source.revision.id },
      ]);
      expect(snapshot.policyCeiling.runtime.totalTokens).toBe(4096);
      source = await json(
        `knowledge/artifacts/${source.artifact.id}`,
        {
          name: source.artifact.name,
          kind: 'source',
          expectedVersion: source.artifact.editVersion,
          content: {
            schemaVersion: 1,
            mediaType: 'text/plain',
            text: 'Next change should stay coalesced under daily quota.',
          },
        },
        'PUT',
      );
      let limited: any;
      for (let i = 0; i < 150; i++) {
        limited = await json('agent/coordinator-review');
        if (limited.pending === 1 && limited.error?.includes('Daily')) break;
        await delay(50);
      }
      expect(limited.pending).toBe(1);
      expect(limited.error).toContain('Daily');
      expect(
        (await pool.query('SELECT count(*) FROM wa_coordinator_admissions WHERE workspace_id=$1', [ws])).rows[0].count,
      ).toBe('1');
    } finally {
      const rule = await json('agent/coordinator-review');
      if (rule.editVersion)
        await json(
          'agent/coordinator-review',
          {
            clientKey: crypto.randomUUID(),
            expectedVersion: rule.editVersion,
            target: { agentId: coordinator.agentId, revision: coordinator.revision, hash: coordinator.hash },
            enabled: false,
            maxRuns: 1,
            dailyTokens: 4096,
          },
          'PUT',
        );
      await pool.query('DELETE FROM wa_workspace_agent_bindings WHERE workspace_id=$1', [ws]);
    }
  }, 30000);
  it('runs a typed process agent through the existing durable harness and rejects a stale pinned policy', async () => {
    const config = await configure();
    const process = migrateProcess(knowledgeFixtures()[0].process),
      activity = process.graph.elements[1],
      end = process.graph.elements.at(-1)!;
    if (activity.kind !== 'activity' || end.kind !== 'end') throw Error('fixture');
    activity.binding = {
      kind: 'agent',
      definition: {
        configurationRevision: config.editVersion,
        goal: '[HARNESS_PROCESS_ACTIVITY] Review the workspace',
        tools: ['workspace_describe_v1'],
        outputSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
        maxTurns: 4,
        deadlineSeconds: 60,
      },
      input: { mode: 'expression', expression: '$input.variables' },
    };
    end.value = { mode: 'expression', expression: '$nodes.calculate.result' };
    const generated = await generateWorkflow('Process agent fixture', process, {
      artifactId: 'process-test',
      revisionId: 'process-test-r1',
    });
    generated.flow.sourceReference = 'process:process-test-r1';
    const flow = await json('flows', generated.flow);
    const response = await api('flows/run', { flow, input: generated.flow.defaultInput });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const runId = events[0].runId;
    let run: any;
    for (let i = 0; i < 200; i++) {
      run = await json(`runs/${runId}`);
      if (['succeeded', 'failed'].includes(run.status)) break;
      await delay(100);
    }
    expect(run.status, JSON.stringify(run)).toBe('succeeded');
    expect(run.output.result).toEqual({ ok: true });
    const completed = run.events.find(
      (row: any) => row.event.type === 'node.completed' && row.event.nodeId === 'calculate',
    ).event.output;
    const work = await json(`agent/work-items/${completed.agentWorkId}`);
    expect(work.state).toBe('completed');
    expect(work.result).toEqual({ ok: true });
    const stored = (
      await pool.query('SELECT config_snapshot,request_context,read_only FROM wa_work_items WHERE id=$1', [
        completed.agentWorkId,
      ])
    ).rows[0];
    expect(stored.read_only).toBe(true);
    expect(stored.request_context.processActivity.runId).toBe(runId);
    expect(stored.config_snapshot.runtime.delegation).toBe(false);
    const calls = (
      await pool.query('SELECT kind,state,request FROM wa_calls WHERE work_item_id=$1', [completed.agentWorkId])
    ).rows;
    expect(calls.filter((row) => row.kind === 'model')).toHaveLength(2);
    expect(calls.filter((row) => row.kind === 'tool' && row.request.name === 'workspace_describe_v1')).toHaveLength(1);
    // New work under a superseded policy fails before a model/tool can be invoked.
    if ('configurationRevision' in activity.binding.definition)
      activity.binding.definition.configurationRevision = config.editVersion + 100;
    const stale = await generateWorkflow('Stale process agent', process, { artifactId: 'p', revisionId: 'r' });
    const staleFlow = await json('flows', stale.flow);
    const failed = await api('flows/run', { flow: staleFlow, input: stale.flow.defaultInput });
    const failedEvents = (await failed.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    let failedRun: any;
    for (let i = 0; i < 100; i++) {
      failedRun = await json(`runs/${failedEvents[0].runId}`);
      if (['succeeded', 'failed'].includes(failedRun.status)) break;
      await delay(100);
    }
    expect(failedRun.status).toBe('failed');
    expect(failedRun.error).toContain('policy changed');
  }, 30000);
  it('executes named process specialists with pinned contracts and blocks incompatible or paused profiles', async () => {
    await configure();
    const outputSchema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const definition = {
      schemaVersion: 1,
      kind: 'specialist',
      name: 'Process reviewer',
      description: 'Structured process review',
      instructions: 'Return a source-grounded typed result.',
      model: { provider: 'minimax', connectionId: connection.id, connectionRevision: connection.revision ?? 1 },
      tools: ['workspace_describe_v1'],
      context: { scope: 'selected', resources: [] },
      limits: { turns: 6, tools: 8, outputTokens: 1024 },
      interaction: 'structured_output',
      outputSchema,
    };
    let draft = await json('agent/definitions', { clientKey: crypto.randomUUID(), expectedVersion: 0, definition });
    const ref = await json(`agent/definitions/${draft.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    });
    draft = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/resume`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
    });
    const process = migrateProcess(knowledgeFixtures()[0].process),
      activity = process.graph.elements[1],
      end = process.graph.elements.at(-1)!;
    if (activity.kind !== 'activity' || end.kind !== 'end') throw Error('fixture');
    activity.binding = {
      kind: 'agent',
      definition: {
        agentRef: { agentId: ref.agentId, revision: ref.revision, hash: ref.hash },
        goal: '[HARNESS_PROCESS_ACTIVITY] Use the published reviewer',
        tools: ['workspace_describe_v1', 'artifact_read_v1'],
        outputSchema,
        maxTurns: 4,
        deadlineSeconds: 60,
      },
      input: { mode: 'expression', expression: '$input.variables' },
    };
    end.value = { mode: 'expression', expression: '$nodes.calculate.result' };
    const generated = await generateWorkflow('Named process specialist', process, { artifactId: 'p', revisionId: 'r' });
    const execute = async (candidate = generated) => {
      const flow = await json('flows', candidate.flow);
      const response = await api('flows/run', { flow, input: candidate.flow.defaultInput });
      const events = (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      for (let i = 0; i < 200; i++) {
        const run = await json(`runs/${events[0].runId}`);
        if (['succeeded', 'failed'].includes(run.status)) return run;
        await delay(50);
      }
      throw Error('Named process did not settle');
    };
    // A later publication never silently upgrades a process's pinned revision.
    draft = await json(`agent/definitions/${draft.id}`);
    draft = await json(
      `agent/definitions/${draft.id}`,
      {
        clientKey: crypto.randomUUID(),
        expectedVersion: draft.editVersion,
        definition: { ...definition, instructions: 'Revision two instructions.' },
      },
      'PATCH',
    );
    await json(`agent/definitions/${draft.id}/publish`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
      draftHash: draft.draftHash,
    });
    const run = await execute();
    expect(run.status, run.error).toBe('succeeded');
    expect(run.output.result).toEqual({ ok: true });
    const work = (
      await pool.query("SELECT * FROM wa_work_items WHERE request_context->'processActivity'->>'runId'=$1", [run.id])
    ).rows[0];
    expect(work.execution_snapshot.ref.revision).toBe(1);
    expect(work.read_only).toBe(true);
    expect(work.request_context.processActivity.tools).toEqual(['workspace_describe_v1']);
    expect(work.execution_snapshot.policyCeiling.limits.turns).toBe(4);
    expect(work.execution_snapshot.actorId).toBe(work.sponsor_id);
    activity.binding.definition.outputSchema = { type: 'string' };
    const mismatch = await execute(
      await generateWorkflow('Incompatible result contract', process, { artifactId: 'p', revisionId: 'r' }),
    );
    expect(mismatch.status).toBe('failed');
    expect(mismatch.error).toContain('schema must match');
    expect(
      (
        await pool.query("SELECT count(*) FROM wa_work_items WHERE request_context->'processActivity'->>'runId'=$1", [
          mismatch.id,
        ])
      ).rows[0].count,
    ).toBe('0');
    draft = await json(`agent/definitions/${draft.id}`);
    await json(`agent/definitions/${draft.id}/pause`, {
      clientKey: crypto.randomUUID(),
      expectedVersion: draft.editVersion,
    });
    const blocked = await execute();
    expect(blocked.status).toBe('failed');
    expect(blocked.error).toContain('paused');
    expect(
      (
        await pool.query("SELECT count(*) FROM wa_work_items WHERE request_context->'processActivity'->>'runId'=$1", [
          blocked.id,
        ])
      ).rows[0].count,
    ).toBe('0');
  }, 30000);
  it('stages visual process changes without saving and applies them only after reviewed approval', async () => {
    await configure();
    const created = await json('knowledge/artifacts', {
      name: 'Process proposal fixture',
      kind: 'process',
      content: migrateProcess(knowledgeFixtures()[0].process),
    });
    const started = await begin('[HARNESS_PROCESS_PROPOSAL]', {
      attachments: [{ kind: 'process', id: created.artifact.id, revisionId: created.revision.id }],
    });
    const work = await wait(started.work.workItemId, 'ready_for_review');
    expect(work.proposals).toHaveLength(1);
    expect(work.proposals[0].kind).toBe('process');
    expect((await json(`knowledge/artifacts/${created.artifact.id}`)).revision.id).toBe(created.revision.id);
    const applied = await json(`agent/change-sets/${work.proposals[0].id}/apply`, { hash: work.proposals[0].hash });
    const saved = await json(`knowledge/artifacts/${created.artifact.id}`);
    expect(saved.revision.id).toBe(applied.revisionId);
    expect(saved.revision.content.purpose).toBe('Reviewed visual process purpose');
    expect(saved.revision.reviewed).toBe(false);
    const duplicate = await json(`agent/change-sets/${work.proposals[0].id}/apply`, { hash: work.proposals[0].hash });
    expect(duplicate).toEqual(applied);
  }, 20000);
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: 'postgresql://postgres:dbos@127.0.0.1:55432/postgres' });
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='studio_harness_integration'")).rowCount)
      await admin.query('CREATE DATABASE studio_harness_integration');
    await admin.end();
    const url = 'postgresql://postgres:dbos@127.0.0.1:55432/studio_harness_integration';
    pool = new pg.Pool({ connectionString: url });
    await pool.query('CREATE TABLE IF NOT EXISTS studio_test_effects(effect_key text NOT NULL)');
    await pool.query('TRUNCATE studio_test_effects');
    processHandle = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        STUDIO_PORT: '3024',
        STUDIO_DATABASE_URL: url,
        DBOS_SYSTEM_DATABASE_URL: 'postgresql://postgres:dbos@127.0.0.1:55432/studio_harness_integration_dbos',
        STUDIO_ADAPTER_MODULE: 'server/fixtures/integration-adapter.ts',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processHandle.stdout!.on('data', (x) => (log = (log + x).slice(-10000)));
    processHandle.stderr!.on('data', (x) => (log = (log + x).slice(-10000)));
    for (let i = 0; i < 300; i++) {
      if (processHandle.exitCode !== null) throw Error(log);
      if (
        await api('health')
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await delay(100);
    }
    await json('control/session/development', {
      email: `harness-${crypto.randomUUID()}@example.test`,
      displayName: 'Harness verifier',
    });
    await json('control/onboarding', { customerName: 'Harness fixtures', workspaceName: 'Concept verification' });
    connection = await json('control/connections', {
      name: 'Fixture MiniMax',
      provider: 'minimax',
      config: { model: 'MiniMax-M2.7' },
      secret: 'fixture-not-a-real-key',
    });
    await configure();
  }, 40000);
  afterAll(async () => {
    if (processHandle?.exitCode === null) {
      const exit = once(processHandle, 'exit');
      processHandle.kill('SIGKILL');
      await exit;
    }
    await pool?.end();
  });
  it('loads extension schemas progressively and overlaps declared reads', async () => {
    await configure({ extensions: [{ id: 'fixture', version: '1' }], concurrency: 2 });
    const { work } = await begin('[HARNESS_PARALLEL]');
    const done = await wait(work.workItemId ?? work.id);
    expect(done.tools).toBe(3);
    const events = (
      await pool.query(
        "SELECT effect_key FROM studio_test_effects WHERE effect_key LIKE 'fixture:read:%' ORDER BY ctid",
      )
    ).rows.map((r) => r.effect_key);
    expect(events.slice(0, 2).every((x) => x.endsWith(':start'))).toBe(true);
    // Provider receives only tool-search metadata until discovery records a schema.
    const calls = (
      await pool.query("SELECT request FROM wa_calls WHERE work_item_id=$1 AND kind='tool' ORDER BY created_at", [
        done.id,
      ])
    ).rows;
    expect(calls[0].request.name).toBe('agent_tool_search_v1');
  });
  it('requires exact human approval and performs a write once', async () => {
    await configure({ extensions: [{ id: 'fixture', version: '1' }] });
    const { work } = await begin('[HARNESS_APPROVAL]');
    const w = await wait(work.workItemId ?? work.id, 'waiting_for_user');
    expect(
      (await pool.query("SELECT count(*) FROM studio_test_effects WHERE effect_key LIKE 'fixture:write:%'")).rows[0]
        .count,
    ).toBe('0');
    await answer(w, { approved: true });
    await wait(w.id);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM studio_test_effects WHERE effect_key='fixture:write:approved-effect:start'",
        )
      ).rows[0].count,
    ).toBe('1');
  });
  it('joins durable read-only research children and records isolated code results', async () => {
    await configure({ delegation: true, maxChildren: 2, maxDepth: 1 });
    const { work } = await begin('[HARNESS_DELEGATE]');
    const done = await wait(work.workItemId ?? work.id);
    expect(done.tasks).toHaveLength(2);
    expect(done.tasks.every((t: any) => t.state === 'completed')).toBe(true);
    const children = await pool.query('SELECT read_only FROM wa_work_items WHERE id=ANY($1)', [
      done.tasks.map((t: any) => t.workId),
    ]);
    expect(children.rows.every((r) => r.read_only)).toBe(true);
  }, 40000);
  it('persists plans and executes code without host privileges', async () => {
    await configure();
    const { work } = await begin('[HARNESS_PLAN_CODE]');
    const done = await wait(work.workItemId ?? work.id);
    expect(done.plan.steps[0].status).toBe('completed');
    const code = (
      await pool.query("SELECT result FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='agent_code_v1'", [
        done.id,
      ])
    ).rows[0].result;
    expect(JSON.stringify(code)).toContain('[9,18,27]');
  });
  it('repairs structured output against the host schema', async () => {
    await configure();
    const { work } = await begin('[HARNESS_STRUCTURED]', {
      outputSchema: {
        type: 'object',
        properties: { factor: { type: 'integer' } },
        required: ['factor'],
        additionalProperties: false,
      },
    });
    const done = await wait(work.workItemId ?? work.id);
    expect(done.result).toEqual({ factor: 9 });
    expect(done.turns).toBe(2);
  });
  it('keeps memory proposals separate until accepted', async () => {
    const { work } = await begin('[HARNESS_MEMORY]');
    const w = await wait(work.workItemId ?? work.id, 'waiting_for_user');
    expect(
      (
        await pool.query(
          'SELECT count(*) FROM wa_memories WHERE decision_id IN (SELECT id FROM wa_decisions WHERE work_item_id=$1)',
          [w.id],
        )
      ).rows[0].count,
    ).toBe('0');
    await answer(w, { approved: true });
    await wait(w.id);
    expect(
      (await pool.query("SELECT count(*) FROM wa_memory_proposals WHERE work_item_id=$1 AND state='accepted'", [w.id]))
        .rows[0].count,
    ).toBe('1');
  });
  it('pins skill revisions and reads them through the configured capability', async () => {
    const skill = await json('agent/skills', {
      expectedRevision: 0,
      name: 'Domain guidance',
      description: 'Use reviewed concepts',
      content: 'OLD_FACT: stable identifiers matter.',
    });
    await configure({ skills: [skill.id] });
    const { work } = await begin('[HARNESS_SKILL]');
    const done = await wait(work.workItemId ?? work.id);
    const receipt = (
      await pool.query("SELECT result FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='agent_skill_read_v1'", [
        done.id,
      ])
    ).rows[0];
    expect(JSON.stringify(receipt.result)).toContain('OLD_FACT');
  });
  it('streams public text with replay cursors and excludes private reasoning', async () => {
    await configure();
    const { work } = await begin('[HARNESS_STREAM]');
    const done = await wait(work.workItemId ?? work.id);
    const r = await api(`agent/work-items/${done.id}/events`);
    const text = await r.text();
    expect(text).toContain('Feature scenario completed.');
    expect(text).not.toContain('private fixture reasoning');
    const ids = [...text.matchAll(/^id: (\d+)/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(1);
    const replay = await api(`agent/work-items/${done.id}/events?after=${ids.at(-1)}`).then((r) => r.text());
    expect(replay).not.toContain('event: agent');
  });
  it('steers at a model boundary and forks history without copying work or approval', async () => {
    const { session, work } = await begin('[HARNESS_STEER]');
    const id = work.workItemId ?? work.id;
    let active = await json(`agent/work-items/${id}`);
    for (let i = 0; i < 100 && active.state !== 'reasoning'; i++) {
      await delay(30);
      active = await json(`agent/work-items/${id}`);
    }
    const steering = {
      clientKey: crypto.randomUUID(),
      expectedVersion: active.editVersion,
      text: 'Prioritize banking.',
    };
    await json(`agent/work-items/${id}/steer`, steering);
    await json(`agent/work-items/${id}/steer`, steering);
    await wait(id);
    const h = await json(`agent/sessions/${session.id}`);
    expect(h.messages.at(-1).content).toContain('Guidance received');
    const payload = { clientKey: crypto.randomUUID(), title: 'Branch at goal', throughOrdinal: '1' };
    const fork = await json(`agent/sessions/${session.id}/fork`, payload);
    expect((await json(`agent/sessions/${session.id}/fork`, payload)).id).toBe(fork.id);
    const branch = await json(`agent/sessions/${fork.id}`);
    expect(branch.messages).toHaveLength(1);
    expect(branch.workItems).toHaveLength(0);
  });
  it('discovers and invokes an actual authenticated MCP offering with schema pins', async () => {
    const bridge = await createHarness2Bridge(async (name) => ({ name, verified: true }));
    try {
      const conn = await json('control/connections', {
        name: 'Fixture MCP',
        provider: 'mcp',
        config: { endpoint: bridge.url },
        secret: bridge.token,
      });
      const discovered = await json('agent/mcp/discover', { connectionId: conn.id, revision: 1 });
      const tool = discovered.tools.find((t: any) => t.name === 'workspace_describe_v1');
      expect(tool.hash).toMatch(/^[a-f0-9]{64}$/);
      await configure({
        mcp: [{ connectionId: conn.id, revision: 1, tools: [{ name: tool.name, hash: tool.hash, effect: 'read' }] }],
      });
      const { work } = await begin('[HARNESS_MCP]');
      const done = await wait(work.workItemId);
      const receipts = (
        await pool.query("SELECT result FROM wa_calls WHERE work_item_id=$1 AND request->>'name' LIKE 'mcp_%'", [
          done.id,
        ])
      ).rows;
      expect(JSON.stringify(receipts)).toContain('verified');
      expect(JSON.stringify(receipts)).not.toContain(bridge.token);
      await configure({
        mcp: [
          { connectionId: conn.id, revision: 1, tools: [{ name: tool.name, hash: '0'.repeat(64), effect: 'read' }] },
        ],
      });
      const changed = await begin('[HARNESS_MCP]');
      let failed: any;
      for (let i = 0; i < 100; i++) {
        failed = await json(`agent/work-items/${changed.work.workItemId}`);
        if (['failed', 'suspended'].includes(failed.state)) break;
        await delay(100);
      }
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('pinned MCP offering changed');
    } finally {
      await bridge.close();
    }
  }, 30000);
  it('compacts long sessions in numeric order and stores encrypted rolling memory', async () => {
    await configure({ contextBytes: 8192, retainRounds: 2 });
    const session = await json('agent/sessions', { title: 'Long history', clientKey: crypto.randomUUID() });
    const workspace = (await pool.query('SELECT workspace_id FROM wa_sessions WHERE id=$1', [session.id])).rows[0]
      .workspace_id;
    for (let i = 1; i <= 40; i++)
      await pool.query(
        'INSERT INTO wa_messages(workspace_id,id,session_id,ordinal,role,content) VALUES($1,$2,$3,$4,$5,$6)',
        [
          workspace,
          crypto.randomUUID(),
          session.id,
          i,
          i % 2 ? 'user' : 'assistant',
          i === 1 ? 'OLD_FACT: original decision.' : `History ${i} ` + 'x'.repeat(300),
        ],
      );
    const queued = await json(`agent/sessions/${session.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      expectedSessionVersion: 1,
      text: '[HARNESS_STREAM]',
      attachments: [],
    });
    await wait(queued.workItemId);
    const context = (
      await pool.query('SELECT through_ordinal,summary FROM wa_session_context WHERE session_id=$1', [session.id])
    ).rows[0];
    expect(Number(context.through_ordinal)).toBe(21);
    expect(JSON.stringify(context.summary)).not.toContain('OLD_FACT');
    const receipts = (
      await pool.query("SELECT result FROM wa_calls WHERE work_item_id=$1 AND result->>'compaction'='true'", [
        queued.workItemId,
      ])
    ).rows;
    expect(receipts.length).toBeGreaterThan(0);
    const history = await json(`agent/sessions/${session.id}?before=12`);
    expect(history.messages.map((m: any) => Number(m.ordinal))).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  });
  it('persists schedules with application status and rejects invalid timezones', async () => {
    await configure();
    expect(
      (
        await api('agent/schedules', {
          expectedRevision: 0,
          name: 'Invalid',
          cron: '* * * * *',
          timezone: 'invalid/place',
          goal: 'Review',
          enabled: false,
        })
      ).status,
    ).toBe(400);
    const scheduled = await json('agent/schedules', {
      id: crypto.randomUUID(),
      expectedRevision: 0,
      name: 'Daily review',
      cron: '0 9 * * *',
      timezone: 'Asia/Kolkata',
      goal: 'Review domain consistency',
      enabled: false,
    });
    let saved: any;
    for (let i = 0; i < 100; i++) {
      saved = (await json('agent/schedules')).items.find((s: any) => s.id === scheduled.id);
      if (saved.appliedRevision === saved.revision) break;
      await delay(100);
    }
    expect(saved.appliedRevision).toBe(1);
    expect(saved.error).toBeNull();
  });
  it('keeps approvals single-use and honors denial without executing a write', async () => {
    await configure({ extensions: [{ id: 'fixture', version: '1' }] });
    const before = Number(
      (
        await pool.query(
          "SELECT count(*) FROM studio_test_effects WHERE effect_key='fixture:write:approved-effect:start'",
        )
      ).rows[0].count,
    );
    const first = await begin('[HARNESS_APPROVAL] replay');
    let w = await wait(first.work.workItemId, 'waiting_for_user');
    await answer(w, { approved: true });
    await wait(w.id);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM studio_test_effects WHERE effect_key='fixture:write:approved-effect:start'",
          )
        ).rows[0].count,
      ),
    ).toBe(before + 1);
    const replay = (
      await pool.query("SELECT result FROM wa_calls WHERE work_item_id=$1 AND result->>'error' LIKE '%already used%'", [
        w.id,
      ])
    ).rows;
    expect(replay).toHaveLength(1);
    const denied = await begin('[HARNESS_APPROVAL]');
    w = await wait(denied.work.workItemId, 'waiting_for_user');
    await answer(w, { approved: false });
    await wait(w.id);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM studio_test_effects WHERE effect_key='fixture:write:approved-effect:start'",
          )
        ).rows[0].count,
      ),
    ).toBe(before + 1);
  });
  it('blocks child writes and cancels descendants when the parent is stopped', async () => {
    await configure({ delegation: true, maxChildren: 2, maxDepth: 1, extensions: [{ id: 'fixture', version: '1' }] });
    const denied = await begin('[HARNESS_DELEGATE] denied');
    const done = await wait(denied.work.workItemId);
    expect(
      (await pool.query("SELECT count(*) FROM studio_test_effects WHERE effect_key LIKE '%child-must-not-write%' "))
        .rows[0].count,
    ).toBe('0');
    const errors = (
      await pool.query(
        "SELECT result FROM wa_calls WHERE work_item_id=ANY($1) AND result->>'error'='Delegated work is read-only.'",
        [done.tasks.map((t: any) => t.workId)],
      )
    ).rows;
    expect(errors).toHaveLength(2);
    const slow = await begin('[HARNESS_DELEGATE] slow');
    const parent = await wait(slow.work.workItemId, 'waiting_for_tasks');
    await json(`agent/work-items/${parent.id}/cancel`, { expectedVersion: parent.editVersion });
    for (const task of parent.tasks) expect((await json(`agent/work-items/${task.workId}`)).state).toBe('cancelled');
  });
  it('retains a skill revision across pause/resume even after its head changes', async () => {
    const skill = await json('agent/skills', {
      expectedRevision: 0,
      name: 'Pinned skill ' + crypto.randomUUID(),
      description: 'Pinned guidance',
      content: 'OLD_FACT: reviewed policy.',
    });
    await configure({ skills: [skill.id] });
    const { work } = await begin('[HARNESS_SKILL] pause');
    const paused = await wait(work.workItemId, 'waiting_for_user');
    await json('agent/skills', {
      id: skill.id,
      expectedRevision: 1,
      name: 'Pinned skill ' + skill.id,
      description: 'Updated guidance',
      content: 'NEW_HEAD: different policy.',
    });
    await answer(paused, { approved: true });
    await wait(paused.id);
    const receipts = (
      await pool.query(
        "SELECT result FROM wa_calls WHERE work_item_id=$1 AND request->>'name'='agent_skill_read_v1' ORDER BY created_at",
        [paused.id],
      )
    ).rows;
    expect(receipts).toHaveLength(2);
    for (const r of receipts) {
      expect(r.result.revision).toBe(1);
      expect(r.result.content).toContain('OLD_FACT');
    }
  });
  it('records a fully received length-limited response as a known budget failure without dispatch or retry', async () => {
    await configure();
    const { work } = await begin('[HARNESS_LENGTH]');
    const done = await wait(work.workItemId, 'budget_exhausted');
    expect(done.tools).toBe(0);
    expect(done.error).toContain('Response token limit');
    expect(done.usage.tokens).toBe(1074);
    const calls = (await pool.query('SELECT kind,state,result FROM wa_calls WHERE work_item_id=$1', [work.workItemId]))
      .rows;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'model',
      state: 'failed',
      result: { finishReason: 'length', noToolsDispatched: true, outputLimit: 1024 },
    });
    const history = await json(`agent/sessions/${done.sessionId}`);
    expect(history.messages.at(-1).content).toContain('Response token limit');
    expect(history.messages.at(-1).content).not.toContain('uncertain outcome');
  });
  it('identifies the token budget and preserves its measured usage in the stop reason', async () => {
    await configure({ totalTokens: 1024 });
    const { work } = await begin('[HARNESS_TOKEN_BUDGET]');
    const done = await wait(work.workItemId, 'budget_exhausted');
    expect(done.error).toContain('Token budget reached: 1,130');
    expect(done.error).toContain('limit 1,024');
    expect(done.error).not.toContain('active-time');
    expect(done.usage.tokens).toBe(1130);
    await configure();
  });
  describe('conversation lifecycle', () => {
    const fixture = async (state = 'completed') => {
      const session = await json('agent/sessions', { title: 'Lifecycle fixture', clientKey: crypto.randomUUID() });
      const row = (await pool.query('SELECT * FROM wa_sessions WHERE id=$1', [session.id])).rows[0];
      const workId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot) VALUES($1,$2,$3,$4,$5,'Lifecycle fixture',1,'{}')",
        [row.workspace_id, workId, row.id, row.created_by, state],
      );
      return { ...row, workId };
    };
    const listed = async (id: string, archived = false) =>
      (await json(`agent/sessions?archived=${archived}`)).items.find((item: any) => item.id === id);
    const change = async (id: string, action: string, version: number) =>
      api(`agent/sessions/${id}/${action}`, { expectedVersion: version });
    const call = async (item: any, effect: string | null, name = 'fixture__write', state = 'completed') => {
      await pool.query(
        "INSERT INTO wa_calls(workspace_id,id,work_item_id,turn_no,kind,call_key,state,request_hash,request,tool_effect) VALUES($1,$2,$3,1,'tool',$2,$4,'fixture',$5,$6)",
        [item.workspace_id, crypto.randomUUID(), item.workId, state, { name }, effect],
      );
    };
    it('archives, restores and deletes an unchanged conversation while retaining audit receipts', async () => {
      const item = await fixture();
      expect((await listed(item.id)).canDelete).toBe(true);
      expect((await change(item.id, 'archive', 1)).status).toBe(200);
      expect(await listed(item.id)).toBeUndefined();
      expect((await listed(item.id, true)).archivedAt).toBeTruthy();
      expect((await change(item.id, 'restore', 1)).status).toBe(409);
      expect((await change(item.id, 'restore', 2)).status).toBe(200);
      expect((await change(item.id, 'delete', 3)).status).toBe(200);
      expect((await api(`agent/sessions/${item.id}`)).status).toBe(404);
      expect(
        (
          await api(`agent/sessions/${item.id}/fork`, {
            clientKey: crypto.randomUUID(),
            title: 'Must not restore deleted history',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await api(`agent/sessions/${item.id}/messages`, {
            clientMessageId: crypto.randomUUID(),
            expectedSessionVersion: 4,
            text: 'do not run',
            attachments: [],
          })
        ).status,
      ).toBe(404);
      expect(
        (await pool.query('SELECT deleted_at FROM wa_sessions WHERE id=$1', [item.id])).rows[0].deleted_at,
      ).toBeTruthy();
      expect((await pool.query('SELECT id FROM wa_work_items WHERE id=$1', [item.workId])).rowCount).toBe(1);
    });
    it('blocks active, queued, unknown and possibly effective writes; allows known reads', async () => {
      const active = await fixture('reasoning');
      expect((await change(active.id, 'delete', 1)).status).toBe(409);
      await pool.query("UPDATE wa_work_items SET state='completed' WHERE id=$1", [active.workId]);
      await call(active, 'read', 'fixture__read');
      expect((await listed(active.id)).canDelete).toBe(true);
      const unknown = await fixture();
      await call(unknown, null);
      expect((await change(unknown.id, 'delete', 1)).status).toBe(409);
      const written = await fixture();
      await call(written, 'write', 'fixture__write', 'failed');
      expect((await listed(written.id)).deleteBlockedReason).toContain('modified');
      expect((await change(written.id, 'delete', 1)).status).toBe(409);
      expect((await change(written.id, 'archive', 1)).status).toBe(200);
      const queued = await fixture();
      await pool.query(
        "INSERT INTO wa_requests(workspace_id,id,actor_id,client_key,request_hash,origin,kind,payload,config_revision) VALUES($1,$2,$3,$2,'fixture','workbench','goal',$4,1)",
        [queued.workspace_id, crypto.randomUUID(), queued.created_by, { sessionId: queued.id }],
      );
      expect((await change(queued.id, 'delete', 1)).status).toBe(409);
      await pool.query("UPDATE wa_requests SET state='rejected' WHERE workspace_id=$1 AND payload->>'sessionId'=$2", [
        queued.workspace_id,
        queued.id,
      ]);
    });
    it('checks older runs and delegated descendants, not only the latest work item', async () => {
      const parent = await fixture(),
        child = await fixture();
      await call(child, 'write');
      await pool.query(
        "INSERT INTO wa_agent_tasks(workspace_id,id,parent_work_id,child_work_id,title,depth,request_hash,request_key) VALUES($1,$2,$3,$4,'Child',1,'fixture',$2)",
        [parent.workspace_id, crypto.randomUUID(), parent.workId, child.workId],
      );
      expect((await listed(parent.id)).canDelete).toBe(false);
      expect((await change(parent.id, 'delete', 1)).status).toBe(409);
      await pool.query(
        "INSERT INTO wa_work_items(workspace_id,id,session_id,sponsor_id,state,goal,config_revision,config_snapshot) VALUES($1,$2,$3,$4,'completed','New read-only run',1,'{}')",
        [parent.workspace_id, crypto.randomUUID(), parent.id, parent.created_by],
      );
      expect((await change(parent.id, 'delete', 1)).status).toBe(409);
    });
    it('retains conversations that applied an ontology proposal and blocks applying after deletion', async () => {
      await configure();
      const item = await fixture('ready_for_review');
      const artifact = await json('knowledge/artifacts', {
        name: 'Lifecycle ontology',
        kind: 'ontology',
        content: { schemaVersion: 1, description: '', entities: [], relationships: [] },
      });
      const proposalId = crypto.randomUUID(),
        hash = 'a'.repeat(64);
      await pool.query(
        "INSERT INTO wa_change_sets(workspace_id,id,work_item_id,artifact_id,expected_version,content,content_hash,summary) VALUES($1,$2,$3,$4,$5,$6,$7,'Fixture proposal')",
        [
          item.workspace_id,
          proposalId,
          item.workId,
          artifact.artifact.id,
          artifact.artifact.editVersion,
          artifact.revision.content,
          hash,
        ],
      );
      const config = await json('agent/state');
      await pool.query('UPDATE wa_work_items SET config_revision=$2,config_snapshot=$3 WHERE id=$1', [
        item.workId,
        config.configuration.editVersion,
        config.configuration,
      ]);
      expect((await api(`agent/change-sets/${proposalId}/apply`, { hash })).status).toBe(200);
      expect((await change(item.id, 'delete', 1)).status).toBe(409);
      const clean = await fixture('ready_for_review'),
        cleanProposal = crypto.randomUUID();
      await pool.query(
        "INSERT INTO wa_change_sets(workspace_id,id,work_item_id,artifact_id,expected_version,content,content_hash,summary) VALUES($1,$2,$3,$4,1,$5,$6,'Unapplied')",
        [clean.workspace_id, cleanProposal, clean.workId, artifact.artifact.id, artifact.revision.content, hash],
      );
      expect((await change(clean.id, 'delete', 1)).status).toBe(200);
      expect((await api(`agent/change-sets/${cleanProposal}/apply`, { hash })).status).toBe(404);
    });
    it('retains accepted workspace memory and serializes deletion against proposal application', async () => {
      const remembered = await fixture();
      await pool.query(
        "INSERT INTO wa_memory_proposals(workspace_id,id,work_item_id,content,evidence,state) VALUES($1,$2,$3,'Accepted guidance','[]','accepted')",
        [remembered.workspace_id, crypto.randomUUID(), remembered.workId],
      );
      expect((await change(remembered.id, 'delete', 1)).status).toBe(409);
      await configure();
      const item = await fixture('ready_for_review');
      const artifact = await json('knowledge/artifacts', {
        name: 'Concurrent lifecycle ontology',
        kind: 'ontology',
        content: { schemaVersion: 1, description: '', entities: [], relationships: [] },
      });
      const proposalId = crypto.randomUUID(),
        hash = 'b'.repeat(64),
        config = await json('agent/state');
      await pool.query('UPDATE wa_work_items SET config_revision=$2,config_snapshot=$3 WHERE id=$1', [
        item.workId,
        config.configuration.editVersion,
        config.configuration,
      ]);
      await pool.query(
        "INSERT INTO wa_change_sets(workspace_id,id,work_item_id,artifact_id,expected_version,content,content_hash,summary) VALUES($1,$2,$3,$4,$5,$6,$7,'Concurrent proposal')",
        [
          item.workspace_id,
          proposalId,
          item.workId,
          artifact.artifact.id,
          artifact.artifact.editVersion,
          artifact.revision.content,
          hash,
        ],
      );
      const [deleted, applied] = await Promise.all([
        change(item.id, 'delete', 1),
        api(`agent/change-sets/${proposalId}/apply`, { hash }),
      ]);
      const session = (await pool.query('SELECT deleted_at FROM wa_sessions WHERE id=$1', [item.id])).rows[0];
      const proposal = (await pool.query('SELECT state FROM wa_change_sets WHERE id=$1', [proposalId])).rows[0];
      expect(session.deleted_at !== null && proposal.state === 'applied').toBe(false);
      expect([deleted.status, applied.status].filter((status) => status === 200)).toHaveLength(1);
    });
    describe('context uploads', () => {
      const upload = (
        sessionId: string,
        filename = 'process.md',
        text = '# Process\nReview the customer request.',
        clientKey = crypto.randomUUID(),
      ) => api('agent/context-uploads', { sessionId, filename, clientKey, data: Buffer.from(text).toString('base64') });
      it('saves immutable context, restores pending attachments and audits metadata without document text', async () => {
        const item = await fixture(),
          clientKey = crypto.randomUUID(),
          text = '# Private fixture marker\nA process source used only by this test.';
        const response = await upload(item.id, 'context.md', text, clientKey);
        expect(response.status).toBe(201);
        const receipt = await response.json();
        expect(receipt).toMatchObject({ kind: 'source', name: 'context.md', mediaType: 'text/markdown' });
        const source = await json(`knowledge/artifacts/${receipt.id}`);
        expect(source.revision.content.text).toBe(text);
        expect((await json(`agent/sessions/${item.id}`)).contextUploads[0].revisionId).toBe(receipt.revisionId);
        expect((await (await upload(item.id, 'context.md', text, clientKey)).json()).id).toBe(receipt.id);
        expect((await upload(item.id, 'context.md', 'Changed content', clientKey)).status).toBe(409);
        const audit = (
          await pool.query(
            "SELECT details FROM cp_audit WHERE workspace_id=$1 AND action='agent.context_uploaded' AND entity_id=$2",
            [item.workspace_id, item.id],
          )
        ).rows;
        expect(audit).toHaveLength(1);
        expect(audit[0].details.filename).toBe('context.md');
        expect(JSON.stringify(audit)).not.toContain('Private fixture marker');
        expect((await change(item.id, 'delete', 1)).status).toBe(409);
        expect((await api(`agent/sessions/${item.id}/context/${receipt.uploadId}/detach`, {})).status).toBe(200);
        expect((await json(`agent/sessions/${item.id}`)).contextUploads).toHaveLength(0);
        expect((await api(`knowledge/artifacts/${receipt.id}`)).status).toBe(200);
      });
      it('passes the exact uploaded revision through durable intake to the model', async () => {
        await configure();
        const item = await fixture(),
          receipt = await (await upload(item.id, 'attached.md', 'UploadReceiptMarker')).json();
        const accepted = await json('agent/requests', {
          clientRequestId: crypto.randomUUID(),
          origin: 'workbench',
          kind: 'goal',
          sessionId: item.id,
          text: '[HARNESS_CONTEXT_UPLOAD]',
          context: { surface: 'intelligence' },
          attachments: [{ kind: 'source', id: receipt.id, revisionId: receipt.revisionId }],
          remember: false,
        });
        let request = accepted;
        for (let i = 0; i < 100 && !request.workItemId; i++) {
          await delay(100);
          request = await json(`agent/requests/${accepted.requestId}`);
        }
        expect(request.state).toBe('dispatched');
        const done = await wait(request.workItemId);
        const history = await json(`agent/sessions/${item.id}`);
        expect(history.contextUploads).toHaveLength(0);
        expect(history.messages.at(-1).content).toBe('Uploaded context reached the provider.');
        const manifest = (
          await pool.query('SELECT manifest FROM wa_context_manifests WHERE work_item_id=$1', [done.id])
        ).rows[0].manifest;
        expect(manifest.references).toEqual([{ kind: 'source', id: receipt.id, revisionId: receipt.revisionId }]);
      });
      it('enforces file validation and prevents uploads to archived or foreign conversations', async () => {
        const item = await fixture();
        expect((await upload(item.id, 'bad.pdf')).status).toBe(422);
        expect((await upload(item.id, '../source.md')).status).toBe(422);
        expect(
          (
            await api('agent/context-uploads', {
              sessionId: item.id,
              filename: 'bad.md',
              clientKey: crypto.randomUUID(),
              data: Buffer.from([255, 254, 253]).toString('base64'),
            })
          ).status,
        ).toBe(422);
        expect((await upload(item.id, 'large.md', 'a'.repeat(250001))).status).toBe(413);
        expect((await upload(item.id, 'long.md', 'a'.repeat(200001))).status).toBe(422);
        expect((await upload(crypto.randomUUID())).status).toBe(404);
        expect((await change(item.id, 'archive', 1)).status).toBe(200);
        expect((await upload(item.id)).status).toBe(409);
        expect((await pool.query('SELECT id FROM wa_context_uploads WHERE session_id=$1', [item.id])).rowCount).toBe(0);
      });
      it('allows owners/admins/editors, denies viewers, and audits permission changes and denied uploads', async () => {
        const item = await fixture();
        const role = async (value: string) =>
          pool.query('UPDATE cp_memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2', [
            item.workspace_id,
            item.created_by,
            value,
          ]);
        try {
          expect((await json('agent/context-permissions')).editorUpload).toBe(true);
          for (const value of ['owner', 'admin', 'editor']) {
            await role(value);
            expect((await upload(item.id, `${value}.md`)).status).toBe(201);
          }
          await role('viewer');
          expect((await json('agent/context-permissions')).canUpload).toBe(false);
          expect((await upload(item.id, 'viewer.md')).status).toBe(403);
          expect(
            (await api('agent/context-permissions', { expectedVersion: 0, editorUpload: false }, 'PUT')).status,
          ).toBe(403);
          await role('owner');
          const initial = await json('agent/context-permissions');
          const saved = await json(
            'agent/context-permissions',
            { expectedVersion: initial.editVersion, editorUpload: false },
            'PUT',
          );
          expect(
            (
              await api(
                'agent/context-permissions',
                { expectedVersion: initial.editVersion, editorUpload: true },
                'PUT',
              )
            ).status,
          ).toBe(409);
          await role('editor');
          expect((await json('agent/context-permissions')).canUpload).toBe(false);
          expect((await upload(item.id, 'blocked-editor.md')).status).toBe(403);
          expect(
            (
              await api('knowledge/artifacts', {
                name: 'Must not bypass',
                kind: 'source',
                content: { schemaVersion: 1, mediaType: 'text/plain', text: 'Bypass attempt' },
              })
            ).status,
          ).toBe(403);
          expect(
            (await api('agent/context-permissions', { expectedVersion: saved.editVersion, editorUpload: true }, 'PUT'))
              .status,
          ).toBe(403);
          await role('owner');
          await json('agent/context-permissions', { expectedVersion: saved.editVersion, editorUpload: true }, 'PUT');
          const denied = await pool.query(
            "SELECT details FROM cp_audit WHERE workspace_id=$1 AND action='agent.context_upload_denied'",
            [item.workspace_id],
          );
          expect(denied.rows.some((row) => row.details.role === 'viewer')).toBe(true);
          expect(denied.rows.some((row) => row.details.role === 'editor')).toBe(true);
          expect((await pool.query('SELECT id FROM wa_context_uploads WHERE session_id=$1', [item.id])).rowCount).toBe(
            3,
          );
          expect(
            (
              await pool.query(
                "SELECT id FROM cp_audit WHERE workspace_id=$1 AND action='agent.context_permissions_changed'",
                [item.workspace_id],
              )
            ).rowCount,
          ).toBe(2);
        } finally {
          await role('owner');
        }
      });
    });
    it('does not permit a different workspace to archive or delete a conversation', async () => {
      const original = await fixture(),
        savedCookies = new Map(cookies);
      try {
        cookies.clear();
        await json('control/session/development', {
          email: `lifecycle-${crypto.randomUUID()}@example.test`,
          displayName: 'Other workspace',
        });
        await json('control/onboarding', { customerName: 'Isolated lifecycle', workspaceName: 'Other workspace' });
        expect((await change(original.id, 'archive', 1)).status).toBe(404);
        expect((await change(original.id, 'delete', 1)).status).toBe(404);
      } finally {
        cookies.clear();
        for (const [key, value] of savedCookies) cookies.set(key, value);
      }
    });
  });
});
