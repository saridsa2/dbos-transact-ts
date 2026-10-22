import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { PostgresGraphStore, postgresGraphSchema, rankSnapshot } from '../../../vendor/graph-memory/src/storage/index';
import { WorkspaceGraphMemory, memoryNodeKey } from './graph-memory';
import { SecretVault } from '../../control/secrets';

// Every write is in a rolled-back transaction and an isolated schema, including migration tests.
describe.skipIf(process.env.STUDIO_INTEGRATION !== '1')('PostgreSQL graph-memory and host lifecycle', () => {
  let pool: pg.Pool, c: pg.PoolClient, graph: WorkspaceGraphMemory, service: any, authority: string;
  const ctx = { workspace: { id: 'a', role: 'owner' }, user: { id: 'owner' } } as any;
  const vault = new SecretVault(Buffer.alloc(32, 7));
  const evidence = [{ id: 'ontology', revisionId: 'r1', kind: 'ontology' }];
  const seed = async (
    id: string,
    content = 'Corporate customer requires due diligence.',
    state = 'approved',
    version = 1,
  ) => {
    await c.query(
      'INSERT INTO wa_memory_entries VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT (workspace_id,id) DO UPDATE SET version=$5,state=$4',
      ['a', id, null, state, version],
    );
    await c.query('INSERT INTO wa_memory_versions VALUES($1,$2,$3,$4,$5,NULL)', [
      'a',
      id,
      version,
      vault.seal(content, `memory:a:${id}:${version}`),
      JSON.stringify(evidence),
    ]);
    return { id, version, content, evidence };
  };
  const receipt = async (id: string, key: string, text: string) => {
    await c.query(
      "INSERT INTO wa_calls(workspace_id,id,work_item_id,turn_no,kind,call_key,state,request_hash,request,result,private_result) VALUES('a',$1,'work',0,'model',$2,'completed','hash',$3,$4,$5)",
      [
        id,
        `graph-extract:${key}:v1`,
        { phase: 'graph_extract' },
        { compaction: true, graphMemory: true },
        vault.seal(text, `agent:a:${id}`),
      ],
    );
    await c.query(
      "UPDATE wa_graph_extractions SET state='issued',receipt_id=$3,work_item_id='work' WHERE workspace_id=$1 AND node_key=$2",
      ['a', key, id],
    );
  };
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: process.env.STUDIO_DATABASE_URL ?? 'postgresql://postgres:dbos@127.0.0.1:55432/studio',
    });
    c = await pool.connect();
  });
  afterAll(async () => {
    c?.release();
    await pool?.end();
  });
  beforeEach(async () => {
    await c.query('BEGIN');
    await c.query(`CREATE SCHEMA graph_test; SET LOCAL search_path=graph_test; SET LOCAL statement_timeout='5s';
      CREATE TABLE cp_workspaces(id text PRIMARY KEY);
      CREATE TABLE wi_artifacts(workspace_id text,id text,kind text,name text DEFAULT 'Saved ontology',revision_id text DEFAULT 'r1',PRIMARY KEY(workspace_id,id));
      CREATE TABLE wi_revisions(workspace_id text,id text,artifact_id text,content jsonb,PRIMARY KEY(workspace_id,id));
      CREATE TABLE wa_calls(workspace_id text,id text,work_item_id text,turn_no int,kind text,call_key text,state text,request_hash text,request jsonb,result jsonb,private_result jsonb,error text,completed_at timestamptz,PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,work_item_id,kind,call_key));
      CREATE TABLE wa_memory_entries(workspace_id text,id text,agent_id text,state text,version int,updated_at timestamptz,scope text DEFAULT 'workspace',PRIMARY KEY(workspace_id,id));
      CREATE TABLE wa_memory_versions(workspace_id text,memory_id text,version int,content jsonb,evidence jsonb,expires_at timestamptz);
      CREATE TABLE wa_history_segments(workspace_id text,stream_key text,scope_hash text,generation int,work_item_id text);
      CREATE TABLE wa_history_heads(workspace_id text,stream_key text,scope_hash text);
      CREATE TABLE wa_work_context_snapshots(workspace_id text,work_item_id text,revision int,scope_hash text);
      CREATE TABLE wa_workspace_understandings(workspace_id text,id text,setup_id text,source_refs jsonb);
      CREATE TABLE wa_memories(workspace_id text,id text,work_item_id text,decision_id text);`);
    await c.query(await readFile(new URL('../migrations/017-knowledge-graph.sql', import.meta.url), 'utf8'));
    await c.query(
      await readFile(new URL('../migrations/018-workspace-understanding-graph.sql', import.meta.url), 'utf8'),
    );
    await c.query(
      "INSERT INTO cp_workspaces VALUES('a'),('b'); INSERT INTO wi_artifacts VALUES('a','ontology','ontology')",
    );
    await c.query("INSERT INTO wi_revisions VALUES('a','r1','ontology',$1)", [
      JSON.stringify({
        entities: [
          { id: 'customer', properties: [{ id: 'identifier' }] },
          { id: 'account', properties: [] },
        ],
        relationships: [{ id: 'owns', sourceId: 'customer', targetId: 'account' }],
      }),
    ]);
    authority = 'scope-1';
    service = {
      pool: c,
      control: { vault, transaction: (fn: any) => fn(c), audit: async () => {} },
      authorize: async () => ({ ctx }),
      memory: {
        scope: async () => ({
          hash: authority,
          snapshot: { ref: { agentId: 'agent' }, definition: { memory: { approved: 'workspace' } } },
        }),
        eligible: async () => true,
      },
      budgets: { reserve: async () => ({ allowed: true, outputTokens: 1500 }), settle: async () => {} },
      features: { event: async () => {} },
    };
    graph = new WorkspaceGraphMemory(service);
  });
  afterEach(async () => {
    await c.query('ROLLBACK');
  });

  it('automatically initializes a new workspace and bootstraps canonical concepts/properties/relations', async () => {
    expect((await c.query("SELECT count(*)::int n FROM wa_graph_roots WHERE workspace_id='a'")).rows[0].n).toBe(1);
    expect((await graph.status(ctx)).nodes).toMatchObject({
      workspace: 1,
      ontology_concept: 2,
      ontology_property: 1,
      artifact_revision: 1,
    });
    expect(
      (await c.query("SELECT kind FROM wa_graph_edges WHERE workspace_id='a' AND kind='ontology_relation'")).rows,
    ).toHaveLength(1);
  });
  it('registers process elements, lanes and elbow-independent sequence semantics', async () => {
    await c.query("INSERT INTO wi_artifacts VALUES('a','process','process')");
    await c.query("INSERT INTO wi_revisions VALUES('a','p1','process',$1)", [
      JSON.stringify({
        lanes: [{ id: 'reviewers' }],
        graph: {
          elements: [{ id: 'start' }, { id: 'review', laneId: 'reviewers' }],
          flows: [{ id: 'next', source: 'start', target: 'review' }],
        },
      }),
    ]);
    const status = await graph.status(ctx);
    expect(status.nodes.process_element).toBe(2);
    expect(status.nodes.process_lane).toBe(1);
    expect(
      (await c.query("SELECT kind FROM wa_graph_edges WHERE kind IN ('sequence_flow','in_lane')")).rows,
    ).toHaveLength(2);
  });
  it('keeps all memory types in the graph atomically before extraction', async () => {
    await seed('m');
    await c.query("INSERT INTO wa_workspace_understandings VALUES('a','understanding','setup',$1)", [
      JSON.stringify(evidence),
    ]);
    await c.query(
      "INSERT INTO wa_history_segments VALUES('a','work:w','scope',1,'work'); INSERT INTO wa_history_heads VALUES('a','work:w','scope'); INSERT INTO wa_work_context_snapshots VALUES('a','work',1,'scope'); INSERT INTO wa_memories VALUES('a','answer','work','decision')",
    );
    const status = await graph.status(ctx);
    expect(status.nodes).toMatchObject({
      approved_memory_version: 1,
      workspace_understanding: 1,
      history_segment: 1,
      history_head: 1,
      working_context: 1,
      accepted_answer: 1,
    });
    expect(status.extraction.pending).toBe(1);
    expect(
      (await c.query("SELECT * FROM wa_graph_edges WHERE owner_key='memory/m/1' AND kind='supported_by'")).rows,
    ).toHaveLength(1);
    await c.query('SAVEPOINT memory_write');
    await seed('rolled-back');
    await c.query('ROLLBACK TO SAVEPOINT memory_write');
    expect((await c.query("SELECT * FROM wa_graph_nodes WHERE key='memory/rolled-back/1'")).rows).toHaveLength(0);
    const dump = JSON.stringify((await c.query('SELECT * FROM wa_graph_nodes')).rows);
    expect(dump).not.toContain('due diligence');
  });
  it('implements PostgreSQL backend parity, owner isolation, bounds and rollback', async () => {
    await c.query(postgresGraphSchema('portable'));
    const store = new PostgresGraphStore(c, 'portable');
    await store.initialize('a');
    await store.initialize('a');
    await store.initialize('b');
    for (const key of ['m1', 'm2', 'customer', 'kyc', 'private'])
      await store.putNode('a', { key, kind: 'memory', ref: {} });
    await store.putNode('b', { key: 'foreign', kind: 'memory', ref: {} });
    await store.replaceEdges('a', 'm1', 'semantic', [
      { key: '1', from: 'customer', to: 'kyc', owner: 'm1', kind: 'semantic' },
    ]);
    await store.replaceEdges('a', 'm2', 'semantic', [
      { key: '2', from: 'kyc', to: 'private', owner: 'm2', kind: 'semantic' },
    ]);
    const snapshot = await store.snapshot('a', ['m1', 'customer', 'kyc', 'private']);
    expect(snapshot.edges.map((e) => e.key)).toEqual(['1']);
    expect(rankSnapshot(snapshot, ['customer']).get('private')).toBe(0);
    await c.query('SAVEPOINT replace');
    await store.replaceEdges('a', 'm1', 'semantic', []);
    await c.query('ROLLBACK TO SAVEPOINT replace');
    expect((await store.snapshot('a', ['m1', 'customer', 'kyc'])).edges).toHaveLength(1);
    await c.query('SAVEPOINT foreign_edge');
    await expect(
      store.replaceEdges('a', 'm1', 'semantic', [
        { key: 'bad', from: 'customer', to: 'foreign', owner: 'm1', kind: 'semantic' },
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await c.query('ROLLBACK TO SAVEPOINT foreign_edge');
    expect((await store.snapshot('a', [])).nodes).toEqual([]);
    await expect(store.snapshot('a', ['customer', 'kyc'], { nodes: 1, edges: 10 })).rejects.toThrow('bounded');
  });
  it('exposes a bounded owner/admin graph projection and denies viewers', async () => {
    const data = await graph.inspect(ctx);
    expect(data.nodes.find((n: any) => n.kind === 'ontology_concept')?.label).toBeTruthy();
    expect(data.nodes.every((n: any) => n.kind !== 'navigation_term')).toBe(true);
    await expect(graph.inspect({ ...ctx, workspace: { ...ctx.workspace, role: 'viewer' } })).rejects.toThrow(
      'owner/admin',
    );
    await c.query("UPDATE wi_artifacts SET revision_id='r2' WHERE id='ontology'");
    expect((await graph.inspect(ctx)).nodes.some((n: any) => n.kind === 'ontology_concept')).toBe(false);
  });
  it('accepts zero triples and replays application without deleting the memory node', async () => {
    const record = await seed('empty'),
      output = { summary: 'No explicit relation.', outcome: 'informational', triples: [] };
    await receipt('r', memoryNodeKey(record.id, 1), JSON.stringify(output));
    await graph.apply(ctx, 'work', authority, record, 'r', output);
    await graph.apply(ctx, 'work', authority, record, 'r', output);
    expect((await graph.status(ctx)).extraction.ready).toBe(1);
    expect((await c.query("SELECT * FROM wa_graph_nodes WHERE key='memory/empty/1'")).rows).toHaveLength(1);
  });
  it('encrypts term/predicate content and excludes unauthorized owners before graph ranking', async () => {
    const records = [await seed('m1'), await seed('m2'), await seed('m3')];
    for (const [index, record] of records.entries()) {
      const output = {
        summary: 'Approved relation.',
        outcome: 'informational',
        triples: [
          {
            subject: 'Corporate customer',
            predicate: 'requires',
            object: index === 2 ? 'Secret internal policy' : 'Due diligence',
          },
        ],
      };
      await receipt(`r${index}`, memoryNodeKey(record.id, 1), JSON.stringify(output));
      await graph.apply(ctx, 'work', authority, record, `r${index}`, output);
    }
    const rank = await graph.rank(ctx, 'work', authority, records.slice(0, 2), ['m1']);
    expect(rank.has('m2')).toBe(true);
    expect(rank.has('m3')).toBe(false);
    const dump = JSON.stringify(
      (
        await c.query(
          "SELECT * FROM wa_graph_nodes UNION ALL SELECT workspace_id,key,kind,jsonb_build_object('owner',owner_key),payload,now() FROM wa_graph_edges",
        )
      ).rows,
    );
    expect(dump).not.toContain('Corporate customer');
    expect(dump).not.toContain('requires');
    await c.query("UPDATE wa_memory_entries SET state='revoked' WHERE id='m2'");
    authority = 'scope-2';
    await expect(graph.rank(ctx, 'work', 'scope-1', records, ['m1'])).rejects.toThrow('authority changed');
  });
  it('uses one durable extraction receipt and never repeats an unknown call', async () => {
    await seed('unknown');
    let calls = 0;
    const input = {
      service,
      workspace: 'a',
      workId: 'work',
      turn: 0,
      signal: AbortSignal.timeout(3000),
      modelName: 'fixture',
      secret: 'fixture',
      model: {
        complete: async () => {
          calls++;
          throw Error('connection lost after issue');
        },
      },
    } as any;
    await expect(graph.prepare(input)).rejects.toThrow('UNCERTAIN');
    await graph.prepare(input);
    expect(calls).toBe(1);
    expect((await graph.status(ctx)).extraction.uncertain).toBe(1);
  });
  it('quarantines a fully received malformed response without dropping its graph membership', async () => {
    await seed('invalid');
    let calls = 0;
    const input = {
      service,
      workspace: 'a',
      workId: 'work',
      turn: 0,
      signal: AbortSignal.timeout(3000),
      modelName: 'fixture',
      secret: 'fixture',
      model: {
        complete: async () => {
          calls++;
          return { text: '{}', calls: [], usage: { input: 10, output: 5 }, model: 'fixture' };
        },
      },
    } as any;
    await graph.prepare(input);
    await graph.prepare(input);
    expect(calls).toBe(1);
    expect((await graph.status(ctx)).extraction.quarantined).toBe(1);
  });
  it('replays a completed extraction receipt after a crash without another model call', async () => {
    await seed('replay');
    const key = memoryNodeKey('replay', 1);
    await receipt('persisted', key, JSON.stringify({ summary: 'Retained.', outcome: 'informational', triples: [] }));
    let calls = 0;
    await graph.prepare({
      service,
      workspace: 'a',
      workId: 'work',
      signal: AbortSignal.timeout(3000),
      model: {
        complete: async () => {
          calls++;
        },
      },
    } as any);
    expect(calls).toBe(0);
    expect((await graph.status(ctx)).extraction.ready).toBe(1);
  });
});
