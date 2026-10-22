import { z } from 'zod';
import { contentHash } from '../../lib/knowledge/contracts';
import { memoryProposalSchema, memorySearchSchema, resultReadSchema } from '../../lib/agent/memory';
import type { Context } from '../../lib/control/contracts';
import type { AgentService } from './service';
import { ControlError } from '../control/service';
import type { AgentExecutionSnapshot } from '../../lib/agent/definitions';
export class ContextMemory {
  private embeddingProbe?: Promise<boolean>;
  constructor(readonly service: AgentService) {}
  async scope(ctx: Context, workId: string, db: any = this.service.pool, revalidate = true) {
    const work = (
      await db.query('SELECT * FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [ctx.workspace.id, workId])
    ).rows[0];
    if (!work) throw new ControlError(404, 'Activity not found.');
    if (
      !(
        await db.query('SELECT 1 FROM wa_sessions WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL', [
          ctx.workspace.id,
          work.session_id,
        ])
      ).rowCount
    )
      throw new ControlError(404, 'Activity session unavailable.');
    const snapshot = work.execution_snapshot as AgentExecutionSnapshot | undefined;
    if (snapshot && revalidate) await this.service.definitions.access(ctx.workspace.id, snapshot);
    const generation =
      (await db.query('SELECT generation::text FROM wa_memory_generation WHERE workspace_id=$1', [ctx.workspace.id]))
        .rows[0]?.generation ?? '0';
    const resources = snapshot
      ? (snapshot.contextResources ?? snapshot.definition.context.resources)
      : work.attachments;
    const heads = (
      await db.query(
        'SELECT id,revision_id,edit_version FROM wi_artifacts WHERE workspace_id=$1 AND ($2::text[] IS NULL OR id=ANY($2)) ORDER BY id',
        [ctx.workspace.id, snapshot?.definition.context.scope === 'selected' ? resources.map((r: any) => r.id) : null],
      )
    ).rows;
    const activeMemory = (
      await db.query(
        "SELECT e.id,e.version FROM wa_memory_entries e JOIN wa_memory_versions v ON v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version WHERE e.workspace_id=$1 AND e.state='approved' AND (v.expires_at IS NULL OR v.expires_at>now()) ORDER BY e.id",
        [ctx.workspace.id],
      )
    ).rows;
    const currentPolicy = (
      await db.query('SELECT edit_version,enabled,config FROM wa_agents WHERE workspace_id=$1', [ctx.workspace.id])
    ).rows[0];
    const membership = (
      await db.query('SELECT role FROM cp_memberships WHERE workspace_id=$1 AND user_id=$2', [
        ctx.workspace.id,
        work.sponsor_id,
      ])
    ).rows[0];
    const hash = await contentHash({
      currentPolicy,
      membership,
      activeMemory,
      heads,
      workspace: ctx.workspace.id,
      actor: work.sponsor_id,
      agent: snapshot?.ref ?? null,
      resources,
      policy: work.config_revision,
      generation,
    });
    return { work, snapshot, resources, hash, generation };
  }
  async eligible(
    ctx: Context,
    scope: Awaited<ReturnType<ContextMemory['scope']>>,
    evidence: any[],
    db: any = this.service.pool,
  ) {
    if (
      scope.snapshot?.definition.context.scope === 'selected' &&
      evidence.some(
        (ref) =>
          !scope.resources.some((r: any) => r.id === ref.id && r.revisionId === ref.revisionId && r.kind === ref.kind),
      )
    )
      return false;
    // Validate revision metadata without loading large RDF/source bodies during every recall.
    const valid = (
      await db.query(
        `SELECT count(*)::int n FROM jsonb_to_recordset($2::jsonb) AS e(id text,kind text,"revisionId" text) JOIN wi_artifacts a ON a.workspace_id=$1 AND a.id=e.id AND a.kind=e.kind AND a.revision_id=e."revisionId" JOIN wi_revisions r ON r.workspace_id=a.workspace_id AND r.artifact_id=a.id AND r.id=a.revision_id`,
        [ctx.workspace.id, JSON.stringify(evidence)],
      )
    ).rows[0].n;
    return valid === evidence.length;
  }
  async search(ctx: Context, workId: string, input: unknown) {
    const args = memorySearchSchema.parse(input),
      scope = await this.scope(ctx, workId),
      policy = scope.snapshot?.definition.memory;
    if (!policy || policy.approved === 'off') return { items: [], truncated: false };
    const rows = (
      await this.service.pool.query(
        `SELECT e.id,e.scope,e.agent_id,e.version,v.content,v.evidence,v.expires_at FROM wa_memory_entries e JOIN wa_memory_versions v ON v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version WHERE e.workspace_id=$1 AND e.state='approved' AND (v.expires_at IS NULL OR v.expires_at>now()) AND ((e.scope='agent' AND e.agent_id=$2) OR (e.scope='workspace' AND $3)) ORDER BY e.updated_at DESC,e.id LIMIT 201`,
        [ctx.workspace.id, scope.snapshot!.ref.agentId, policy.approved === 'workspace'],
      )
    ).rows;
    const words = args.query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
      matches = [];
    const graphRecords = [];
    for (const row of rows.slice(0, 200)) {
      if (!(await this.eligible(ctx, scope, row.evidence))) continue;
      const content = this.service.control.vault.open(
        row.content,
        `memory:${ctx.workspace.id}:${row.id}:${row.version}`,
      );
      graphRecords.push({ id: row.id, version: row.version, content, evidence: row.evidence });
      const score = words.reduce((n, w) => n + (content.toLowerCase().includes(w) ? 1 : 0), 0);
      if (!score) continue;
      matches.push({ id: row.id, version: row.version, scope: row.scope, content, evidence: row.evidence, score });
    }
    let indexPartial = false;
    if (policy.index === 'mem0_v1') {
      try {
        const eligible = [];
        for (const row of rows.slice(0, 200)) {
          if (!(await this.eligible(ctx, scope, row.evidence))) continue;
          eligible.push({
            id: row.id,
            version: row.version,
            content: this.service.control.vault.open(
              row.content,
              `memory:${ctx.workspace.id}:${row.id}:${row.version}`,
            ),
            row,
          });
        }
        const ranking = await this.service.memoryIndex.rank(
          ctx.workspace.id,
          workId,
          args.query,
          eligible,
          AbortSignal.timeout(15000),
        );
        const ranked = ranking?.scores;
        indexPartial = ranking?.partial ?? !ranking;
        if (ranked)
          for (const entry of eligible) {
            const score = ranked.get(entry.id);
            if (score === undefined) continue;
            const found = matches.find((m) => m.id === entry.id);
            if (found) found.score = score + 10;
            else
              matches.push({
                id: entry.id,
                version: entry.version,
                scope: entry.row.scope,
                content: entry.content,
                evidence: entry.row.evidence,
                score: score + 10,
              });
          }
        if (!ranked)
          await this.service.features.event(
            ctx.workspace.id,
            workId,
            `index-unavailable:${scope.hash}`,
            'memory_index_unavailable',
            {
              reason:
                'Configure local embeddings to enable semantic memory recall; authorized keyword search remains available.',
            },
          );
      } catch {
        indexPartial = true;
        await this.service.features.event(
          ctx.workspace.id,
          workId,
          `index-degraded:${scope.hash}`,
          'memory_index_unavailable',
          { reason: 'Semantic index unavailable; canonical approved-memory search used.' },
        );
      }
    }
    // Rank fusion over already-authorized graph snapshots; never traverse rejected, revoked or stale memories.
    let graphPartial = false;
    try {
      const ranked = await this.service.memoryGraph.rank(
        ctx,
        workId,
        scope.hash,
        graphRecords,
        matches.map((m) => m.id),
      );
      if (ranked.size) {
        const direct = [...matches].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        const graph = [...ranked].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const fused = new Map<string, number>();
        direct.forEach((m, i) => fused.set(m.id, 1 / (60 + i + 1)));
        graph.forEach(([id], i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + i + 1)));
        for (const record of graphRecords) {
          const score = fused.get(record.id);
          if (score === undefined) continue;
          const existing = matches.find((m) => m.id === record.id);
          if (existing) existing.score = score;
          else matches.push({ ...record, scope: rows.find((r) => r.id === record.id)!.scope, score });
        }
      }
    } catch (error) {
      if (error instanceof ControlError) throw error;
      graphPartial = true;
      await this.service.features.event(
        ctx.workspace.id,
        workId,
        `graph-recall:${scope.hash}`,
        'memory_graph_unavailable',
        { reason: 'Graph recall unavailable; authorized canonical memory recall retained.' },
      );
    }
    if ((await this.scope(ctx, workId)).hash !== scope.hash)
      throw new ControlError(409, 'Memory authority changed during recall.');
    matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    let remaining = policy.maxRetrievedTokens * 3;
    const items = [];
    for (const m of matches.slice(0, Math.min(args.limit, policy.maxRetrievedEntries))) {
      const bytes = Buffer.byteLength(JSON.stringify(m));
      if (bytes > remaining) continue;
      remaining -= bytes;
      items.push(m);
    }
    return { items, truncated: indexPartial || graphPartial || rows.length > 200 || matches.length > items.length };
  }
  async command(ctx: Context, key: string, payload: unknown, fn: (c: any) => Promise<any>) {
    const hash = await contentHash(payload);
    return this.service.control.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-memory:'||$1,0))", [ctx.workspace.id]);
      const prior = (
        await c.query(
          'SELECT request_hash,result FROM wa_memory_commands WHERE workspace_id=$1 AND actor_id=$2 AND client_key=$3',
          [ctx.workspace.id, ctx.user.id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ControlError(409, 'Idempotency key reused with different content.');
        return prior.result;
      }
      const result = await fn(c);
      await c.query(
        'INSERT INTO wa_memory_commands(workspace_id,actor_id,client_key,request_hash,result) VALUES($1,$2,$3,$4,$5)',
        [ctx.workspace.id, ctx.user.id, key, hash, result],
      );
      return result;
    });
  }
  async propose(ctx: Context, workId: string, input: unknown, key: string) {
    if (!['owner', 'admin', 'editor'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Editor access required.');
    const proposal = memoryProposalSchema.parse(input),
      scope = await this.scope(ctx, workId);
    if (!scope.snapshot?.definition.memory)
      throw new ControlError(403, 'Publish a memory policy before proposing memory.');
    if (proposal.scope === 'agent' && !scope.snapshot)
      throw new ControlError(422, 'Agent scope requires a published agent.');
    if (!(await this.eligible(ctx, scope, proposal.evidence)))
      throw new ControlError(403, 'Memory evidence is outside the current authorized revisions.');
    const observed = (
      await this.service.pool.query(
        "SELECT result->'artifact'->>'id' id,COALESCE(result->'artifact'->>'revisionId',result->'revision'->>'id') revision_id,result->'artifact'->>'kind' kind FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND kind='tool' AND state='completed' AND request->>'name'='artifact_read_v1'",
        [ctx.workspace.id, workId],
      )
    ).rows
      .filter((r) => r.id && r.revision_id && r.kind)
      .map((r) => ({ id: r.id, revisionId: r.revision_id, kind: r.kind }));
    const evidence = [
      ...new Map(
        [...scope.resources, ...observed, ...proposal.evidence].map((r: any) => [`${r.id}:${r.revisionId}`, r]),
      ).values(),
    ];
    if (!(await this.eligible(ctx, scope, evidence)))
      throw new ControlError(409, 'Observed evidence changed; inspect its current revision before proposing memory.');
    return this.command(ctx, key, { operation: 'propose', workId, proposal }, async (c) => {
      if ((await this.scope(ctx, workId, c, false)).hash !== scope.hash)
        throw new ControlError(409, 'Memory evidence or authorization changed before proposal.');
      const id = crypto.randomUUID();
      await c.query(
        "INSERT INTO wa_memory_entries(workspace_id,id,agent_id,scope,state,origin_work_id,created_by) VALUES($1,$2,$3,$4,'proposed',$5,$6)",
        [
          ctx.workspace.id,
          id,
          proposal.scope === 'agent' ? scope.snapshot!.ref.agentId : null,
          proposal.scope,
          workId,
          ctx.user.id,
        ],
      );
      await c.query(
        'INSERT INTO wa_memory_versions(workspace_id,memory_id,version,content,content_hash,evidence,expires_at) VALUES($1,$2,1,$3,$4,$5,$6)',
        [
          ctx.workspace.id,
          id,
          this.service.control.vault.seal(proposal.content, `memory:${ctx.workspace.id}:${id}:1`),
          await contentHash(proposal.content),
          JSON.stringify(evidence),
          proposal.expiresAt ?? null,
        ],
      );
      await this.service.control.audit(
        ctx,
        'agent.memory_proposed',
        'agent_memory',
        id,
        { workId, scope: proposal.scope },
        c,
      );
      return {
        id,
        version: 1,
        state: 'proposed',
        notice: 'Pending owner/admin review; this memory is not used by agents yet.',
      };
    });
  }
  async status(ctx: Context) {
    const embedder = this.service.memoryIndex.embedder;
    let available = false;
    if (embedder) {
      // Concurrent readiness panels share one local probe; the single-inference worker must not
      // report itself unavailable merely because another readiness check is in progress.
      this.embeddingProbe ??= (async () => {
        try {
          const vector = await embedder.embed('Memory readiness check', AbortSignal.timeout(3000), 'search');
          return vector.length === embedder.dimensions && vector.every(Number.isFinite);
        } catch {
          return false;
        }
      })().finally(() => {
        this.embeddingProbe = undefined;
      });
      available = await this.embeddingProbe;
    }
    const counts = (
      await this.service.pool.query(
        `SELECT count(*)::int approved,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wa_memory_vectors v WHERE v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version AND v.embedding_model=$2))::int indexed
       FROM wa_memory_entries e JOIN wa_memory_versions mv ON mv.workspace_id=e.workspace_id AND mv.memory_id=e.id AND mv.version=e.version
       WHERE e.workspace_id=$1 AND e.state='approved' AND (mv.expires_at IS NULL OR mv.expires_at>now())`,
        [ctx.workspace.id, embedder?.model ?? ''],
      )
    ).rows[0];
    return {
      configured: !!embedder,
      available,
      model: embedder?.model ?? null,
      dimensions: embedder?.dimensions ?? null,
      approved: counts.approved,
      indexed: counts.indexed,
      pending: Math.max(0, counts.approved - counts.indexed),
      graph: await this.service.memoryGraph.status(ctx),
      fallback: 'Authorized keyword recall remains available when semantic recall is unavailable or partial.',
    };
  }
  async list(ctx: Context, cursor?: string) {
    if (cursor) z.string().uuid().parse(cursor);
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Memory management requires owner/admin access.');
    const rows = (
      await this.service.pool.query(
        'SELECT e.*,v.content,v.evidence,v.expires_at FROM wa_memory_entries e JOIN wa_memory_versions v ON v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version WHERE e.workspace_id=$1 AND ($2::text IS NULL OR e.id>$2) ORDER BY e.id LIMIT 201',
        [ctx.workspace.id, cursor ?? null],
      )
    ).rows;
    return {
      nextCursor: rows.length > 200 ? rows[199].id : null,
      items: rows.slice(0, 200).map((r) => ({
        id: r.id,
        version: r.version,
        scope: r.scope,
        agentId: r.agent_id,
        state: r.state,
        workId: r.origin_work_id,
        content: this.service.control.vault.open(r.content, `memory:${ctx.workspace.id}:${r.id}:${r.version}`),
        evidence: r.evidence,
        expiresAt: r.expires_at,
      })),
    };
  }
  async review(ctx: Context, id: string, input: unknown) {
    if (!['owner', 'admin'].includes(ctx.workspace.role))
      throw new ControlError(403, 'Only owners/admins may approve or revoke memory.');
    const data = z
      .object({
        clientKey: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        decision: z.enum(['approve', 'reject', 'revoke']),
      })
      .strict()
      .parse(input);
    if (data.decision === 'approve') {
      const origin = (
        await this.service.pool.query('SELECT origin_work_id FROM wa_memory_entries WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          id,
        ])
      ).rows[0];
      if (origin) await this.scope(ctx, origin.origin_work_id);
    }
    return this.command(ctx, data.clientKey, { id, ...data }, async (c) => {
      const row = (
        await c.query(
          'SELECT e.*,v.content,v.evidence,v.content_hash,v.expires_at FROM wa_memory_entries e JOIN wa_memory_versions v ON v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version WHERE e.workspace_id=$1 AND e.id=$2 FOR UPDATE OF e',
          [ctx.workspace.id, id],
        )
      ).rows[0];
      if (!row) throw new ControlError(404, 'Memory not found.');
      if (row.version !== data.expectedVersion)
        throw new ControlError(409, 'Memory changed; refresh before reviewing.');
      if (
        (data.decision === 'revoke' && row.state !== 'approved') ||
        (data.decision !== 'revoke' && row.state !== 'proposed')
      )
        throw new ControlError(409, 'This memory cannot receive that decision.');
      if (data.decision === 'approve') {
        const scope = await this.scope(ctx, row.origin_work_id, c, false);
        if (
          (row.expires_at && new Date(row.expires_at) <= new Date()) ||
          !(await this.eligible(ctx, scope, row.evidence, c))
        )
          throw new ControlError(409, 'Memory evidence is stale or no longer authorized.');
      }
      const state = data.decision === 'approve' ? 'approved' : data.decision === 'reject' ? 'rejected' : 'revoked',
        version = row.version + 1;
      const text = this.service.control.vault.open(row.content, `memory:${ctx.workspace.id}:${id}:${row.version}`);
      await c.query(
        'INSERT INTO wa_memory_versions(workspace_id,memory_id,version,content,content_hash,evidence,expires_at,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          ctx.workspace.id,
          id,
          version,
          this.service.control.vault.seal(text, `memory:${ctx.workspace.id}:${id}:${version}`),
          row.content_hash,
          JSON.stringify(row.evidence),
          row.expires_at,
          ctx.user.id,
        ],
      );
      await c.query(
        'UPDATE wa_memory_entries SET state=$3,version=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [ctx.workspace.id, id, state, version],
      );
      await c.query(
        'INSERT INTO wa_memory_generation(workspace_id,generation) VALUES($1,1) ON CONFLICT(workspace_id) DO UPDATE SET generation=wa_memory_generation.generation+1',
        [ctx.workspace.id],
      );
      await c.query(
        'INSERT INTO wa_memory_index_outbox(workspace_id,memory_id,version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [ctx.workspace.id, id, version],
      );
      if (state !== 'approved') {
        await c.query('DELETE FROM wa_memory_vectors WHERE workspace_id=$1 AND memory_id=$2', [ctx.workspace.id, id]);
        await c.query('UPDATE wa_memory_index_outbox SET completed_at=now() WHERE workspace_id=$1 AND memory_id=$2', [
          ctx.workspace.id,
          id,
        ]);
      }
      await this.service.control.audit(ctx, `agent.memory_${state}`, 'agent_memory', id, { version }, c);
      return { id, state, version };
    });
  }
  async readResult(ctx: Context, workId: string, input: unknown) {
    const args = resultReadSchema.parse(input);
    const sourceWorkId = args.sourceWorkId ?? workId;
    const scope = await this.scope(ctx, workId),
      source = await this.scope(ctx, sourceWorkId);
    const priorScope = (
      await this.service.pool.query(
        "SELECT manifest->'context'->>'scopeHash' hash FROM wa_context_manifests WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY turn_no DESC LIMIT 1",
        [ctx.workspace.id, sourceWorkId],
      )
    ).rows[0]?.hash;
    if (scope.work.session_id !== source.work.session_id || scope.hash !== source.hash || priorScope !== scope.hash)
      throw new ControlError(404, 'Observation is outside the current context.');
    const row = (
      await this.service.pool.query(
        "SELECT result FROM wa_calls WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3 AND kind='tool' AND state='completed'",
        [ctx.workspace.id, sourceWorkId, args.receiptId],
      )
    ).rows[0];
    if (!row) throw new ControlError(404, 'Observation not found.');
    const text = JSON.stringify(row.result);
    return {
      id: args.receiptId,
      sourceWorkId: sourceWorkId,
      offset: args.offset,
      total: text.length,
      text: text.slice(args.offset, args.offset + args.limit),
    };
  }
  async readHistory(
    ctx: Context,
    workId: string,
    args: { stream: 'work' | 'session'; beforeGeneration?: number; limit: number },
  ) {
    const scope = await this.scope(ctx, workId);
    if (scope.snapshot?.definition.memory?.history !== 'observational_v1')
      throw new ControlError(403, 'This agent revision does not enable observational history.');
    const stream = `${args.stream}:${args.stream === 'work' ? workId : scope.work.session_id}:observational_v1`;
    const rows = (
      await this.service.pool.query(
        'SELECT generation,phase,summary,source_manifest FROM wa_history_segments WHERE workspace_id=$1 AND stream_key=$2 AND scope_hash=$3 AND ($4::integer IS NULL OR generation<$4) ORDER BY generation DESC LIMIT $5',
        [ctx.workspace.id, stream, scope.hash, args.beforeGeneration ?? null, args.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, args.limit).map((r) => ({
        generation: r.generation,
        phase: r.phase,
        summary: JSON.parse(
          this.service.control.vault.open(
            r.summary,
            `history:${ctx.workspace.id}:${stream}:${scope.hash}:${r.generation}`,
          ),
        ),
        sources: r.source_manifest,
      })),
      nextBeforeGeneration: rows.length > args.limit ? rows[args.limit - 1].generation : null,
    };
  }
  async inspect(ctx: Context, workId: string) {
    if (
      !(
        await this.service.pool.query('SELECT 1 FROM wa_work_items WHERE workspace_id=$1 AND id=$2', [
          ctx.workspace.id,
          workId,
        ])
      ).rowCount
    )
      throw new ControlError(404, 'Activity not found.');
    const snapshots = (
      await this.service.pool.query(
        'SELECT revision,scope_hash,source_hash,created_at FROM wa_work_context_snapshots WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY revision DESC LIMIT 20',
        [ctx.workspace.id, workId],
      )
    ).rows;
    const manifests = (
      await this.service.pool.query(
        'SELECT turn_no,manifest FROM wa_context_manifests WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY turn_no DESC LIMIT 20',
        [ctx.workspace.id, workId],
      )
    ).rows;
    let budget;
    try {
      const allowance = await this.service.budgets.allowance(ctx.workspace.id, workId);
      if (allowance.work.execution_snapshot?.definition.memory)
        budget = { tokens: allowance.tokens, ceiling: allowance.base.maxTotalTokens ?? allowance.base.totalTokens };
    } catch {}
    const history = (
      await this.service.pool.query(
        'SELECT stream_key,generation,phase,cursor::text,fragment_offset,source_hash,source_manifest,created_at FROM wa_history_segments WHERE workspace_id=$1 AND work_item_id=$2 ORDER BY created_at DESC,generation DESC LIMIT 20',
        [ctx.workspace.id, workId],
      )
    ).rows;
    return {
      snapshots,
      manifests,
      budget,
      history,
      memoryIndex: { configured: !!this.service.memoryIndex.embedder, model: this.service.memoryIndex.embedder?.model },
    };
  }
}
