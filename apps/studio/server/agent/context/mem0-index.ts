import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
async function loadMem0() {
  return (await import(
    pathToFileURL(join(dirname(require.resolve('mem0ai/oss')), 'stackproc.mjs')).href
  )) as typeof import('../../../vendor/mem0-oss/index.mjs');
}
import type { AgentService } from '../service';

/** Trusted deployment adapter. First release accepts local computation only; no default external provider. */
export interface MemoryEmbedder {
  local: true;
  model: string;
  dimensions: number;
  initialize?(signal: AbortSignal): Promise<void>;
  embed(text: string, signal: AbortSignal, action?: 'add' | 'search'): Promise<number[]>;
}
type Canonical = { id: string; version: number; content: string };
export function vectorIdentity(workspace: string, id: string, version: number, model: string) {
  return createHash('sha256')
    .update(JSON.stringify([workspace, id, version, model]))
    .digest('hex');
}
export function validateVector(vector: number[], dimensions: number) {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    !vector.every(Number.isFinite) ||
    !vector.some((v) => v !== 0)
  )
    throw Error('Invalid memory embedding dimensions or values.');
  return vector;
}
export function similarity(a: number[], b: number[]) {
  const dot = a.reduce((n, v, i) => n + v * b[i], 0),
    an = Math.hypot(...a),
    bn = Math.hypot(...b);
  return Math.max(0, Math.min(1, dot / (an * bn)));
}

/** Mem0's real add/search engine over an encrypted, canonical-version projection. */
export class Mem0Index {
  constructor(
    readonly service: AgentService,
    readonly embedder?: MemoryEmbedder,
  ) {
    if (
      embedder &&
      (embedder.local !== true ||
        !embedder.model ||
        !Number.isInteger(embedder.dimensions) ||
        embedder.dimensions < 1 ||
        embedder.dimensions > 4096)
    )
      throw Error('Memory requires an explicitly configured local embedding adapter (1–4096 dimensions).');
  }
  async rank(
    workspace: string,
    workId: string,
    query: string,
    records: Canonical[],
    signal: AbortSignal,
  ): Promise<{ scores: Map<string, number>; partial: boolean } | null> {
    if (!this.embedder) return null;
    if (!records.length) return { scores: new Map(), partial: false };
    const { service, embedder } = this;
    await embedder.initialize?.(signal);
    const allowed = new Map(records.map((r) => [vectorIdentity(workspace, r.id, r.version, embedder.model), r]));
    const aad = (id: string) => `memory-index:${workspace}:${embedder.model}:${id}`;
    let invocations = 0;
    const embed = async (text: string, action: 'add' | 'search' = 'search') => {
      signal.throwIfAborted();
      if (++invocations > 5) throw Error('Memory embedding allowance reached.');
      const vector = validateVector(await embedder.embed(text, signal, action), embedder.dimensions);
      // No query or content plaintext in usage metadata.
      await service.features.event(workspace, workId, `embedding:${crypto.randomUUID()}`, 'memory_embedding', {
        model: embedder.model,
        dimensions: embedder.dimensions,
        inputBytes: Buffer.byteLength(text),
        local: true,
      });
      return vector;
    };
    const store = {
      initialize: async () => {},
      getUserId: async () => workspace,
      setUserId: async () => {},
      insert: async (vectors: number[][], ids: string[], payloads: Record<string, unknown>[]) => {
        for (let i = 0; i < ids.length; i++) {
          const r = allowed.get(ids[i]);
          if (!r || payloads[i].user_id !== workspace || payloads[i].data !== r.content)
            throw Error('Memory index scope mismatch.');
          validateVector(vectors[i], embedder.dimensions);
          // Recheck approval inside the same transaction/lock as insertion and revocation.
          await service.control.transaction(async (c) => {
            await c.query("SELECT pg_advisory_xact_lock(hashtextextended('wa-memory:'||$1,0))", [workspace]);
            const current = (
              await c.query(
                "SELECT 1 FROM wa_memory_entries e JOIN wa_memory_versions v ON v.workspace_id=e.workspace_id AND v.memory_id=e.id AND v.version=e.version WHERE e.workspace_id=$1 AND e.id=$2 AND e.version=$3 AND e.state='approved' AND (v.expires_at IS NULL OR v.expires_at>now())",
                [workspace, r.id, r.version],
              )
            ).rowCount;
            if (!current) return;
            await c.query(
              'INSERT INTO wa_memory_vectors(workspace_id,memory_id,version,embedding_model,vector,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
              [
                workspace,
                r.id,
                r.version,
                embedder.model,
                service.control.vault.seal(JSON.stringify(vectors[i]), `${aad(ids[i])}:vector`),
                service.control.vault.seal(JSON.stringify(payloads[i]), aad(ids[i])),
              ],
            );
            await c.query(
              'UPDATE wa_memory_index_outbox SET completed_at=now() WHERE workspace_id=$1 AND memory_id=$2 AND version=$3',
              [workspace, r.id, r.version],
            );
          });
        }
      },
      search: async (vector: number[], topK: number, filters: Record<string, unknown>) => {
        if (filters.user_id !== workspace || Object.keys(filters).some((k) => k !== 'user_id'))
          throw Error('Memory index filter mismatch.');
        validateVector(vector, embedder.dimensions);
        const rows = (
          await service.pool.query(
            "SELECT v.* FROM wa_memory_vectors v JOIN wa_memory_entries e ON e.workspace_id=v.workspace_id AND e.id=v.memory_id AND e.version=v.version JOIN wa_memory_versions m ON m.workspace_id=e.workspace_id AND m.memory_id=e.id AND m.version=e.version WHERE v.workspace_id=$1 AND v.embedding_model=$2 AND e.id=ANY($3::text[]) AND e.state='approved' AND (m.expires_at IS NULL OR m.expires_at>now()) LIMIT 201",
            [workspace, embedder.model, records.map((r) => r.id)],
          )
        ).rows;
        return rows
          .flatMap((row) => {
            const id = vectorIdentity(workspace, row.memory_id, row.version, embedder.model);
            if (!allowed.has(id)) return [];
            const stored = validateVector(
              JSON.parse(service.control.vault.open(row.vector, `${aad(id)}:vector`)),
              embedder.dimensions,
            );
            return [
              {
                id,
                payload: JSON.parse(service.control.vault.open(row.payload, aad(id))),
                score: similarity(vector, stored),
              },
            ];
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.min(topK, 200));
      },
    };
    // Deliberately no factory defaults, graph store, reranker or LLM-driven mutation.
    const { Memory } = await loadMem0();
    const engine = new Memory(
      {
        disableHistory: true,
        vectorStore: {
          provider: 'memory',
          config: { collectionName: 'stackproc_approved', dimension: embedder.dimensions },
        },
      },
      {
        disableEntityBoost: true,
        embedder: { embed },
        llm: {
          generateResponse: () => {
            throw Error('Mem0 inference is disabled; memory requires approval.');
          },
        },
        vectorStore: store,
        idFor: (metadata) =>
          vectorIdentity(workspace, String(metadata.canonicalId), Number(metadata.version), embedder.model),
      },
    );
    const existing = (
      await service.pool.query(
        'SELECT memory_id,version FROM wa_memory_vectors WHERE workspace_id=$1 AND embedding_model=$2 AND memory_id=ANY($3::text[])',
        [workspace, embedder.model, records.map((r) => r.id)],
      )
    ).rows;
    const known = new Set(existing.map((r) => `${r.memory_id}:${r.version}`));
    // A bounded lazy outbox worker. Further requests reconcile the remaining approved versions.
    for (const r of records.filter((r) => !known.has(`${r.id}:${r.version}`)).slice(0, 4))
      await engine.add(r.content, {
        infer: false,
        userId: workspace,
        metadata: { canonicalId: r.id, version: r.version },
      });
    const result = await engine.search(query, {
      filters: { user_id: workspace },
      topK: Math.min(records.length, 200),
      threshold: 0.1,
      rerank: false,
    });
    return {
      partial: records.filter((r) => !known.has(`${r.id}:${r.version}`)).length > 4,
      scores: new Map(
        result.results.flatMap((hit) => {
          const r = allowed.get(hit.id);
          return r ? [[r.id, hit.score] as const] : [];
        }),
      ),
    };
  }
}
