/** PostgreSQL port of graph-memory. Original project: adoresever, MIT (see LICENSE).
 * This entry point has no provider, plugin-host, embedding or SQLite dependencies.
 */
export { personalizedRank, type GraphStructure, type RankConfig } from '../graph/rank';
export type GraphNode = { key: string; kind: string; ref: Record<string, unknown>; payload?: unknown };
export type GraphEdge = { key: string; from: string; to: string; owner: string; kind: string; payload?: unknown };
export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] };
export interface AsyncGraphStore {
  initialize(workspace: string): Promise<void>;
  putNode(workspace: string, node: GraphNode): Promise<void>;
  replaceEdges(workspace: string, owner: string, kind: string, edges: GraphEdge[]): Promise<void>;
  snapshot(
    workspace: string,
    authorizedKeys: readonly string[],
    limits?: { nodes?: number; edges?: number },
  ): Promise<GraphSnapshot>;
}
/** A single checked-out pg client when writing. Caller owns BEGIN/COMMIT/ROLLBACK.
 * Never pass a Pool to a multi-statement write transaction.
 */
export interface SqlExecutor {
  query(sql: string, values?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export class GraphLimitError extends Error {
  constructor() {
    super('Authorized graph exceeds its bounded snapshot limit.');
  }
}
const prefixName = (value: string) => {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(value)) throw new TypeError('Invalid graph table prefix.');
  return value;
};
export function postgresGraphSchema(prefix = 'gm_graph'): string {
  const p = prefixName(prefix);
  return `CREATE TABLE ${p}_roots (
    workspace_id text PRIMARY KEY, generation bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE ${p}_nodes (
    workspace_id text NOT NULL REFERENCES ${p}_roots(workspace_id) ON DELETE CASCADE,
    key text NOT NULL, kind text NOT NULL, ref jsonb NOT NULL, payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,key)
  );
  CREATE TABLE ${p}_edges (
    workspace_id text NOT NULL, key text NOT NULL, from_key text NOT NULL, to_key text NOT NULL,
    owner_key text NOT NULL, kind text NOT NULL, payload jsonb, PRIMARY KEY(workspace_id,key),
    FOREIGN KEY(workspace_id,from_key) REFERENCES ${p}_nodes(workspace_id,key) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,to_key) REFERENCES ${p}_nodes(workspace_id,key) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,owner_key) REFERENCES ${p}_nodes(workspace_id,key) ON DELETE CASCADE
  );
  CREATE INDEX ${p}_from ON ${p}_edges(workspace_id,from_key);
  CREATE INDEX ${p}_to ON ${p}_edges(workspace_id,to_key);
  CREATE INDEX ${p}_owner ON ${p}_edges(workspace_id,owner_key,kind);`;
}
/** Host must enforce approval, expiry, evidence revisions and scope BEFORE snapshot.
 * All three edge endpoints (including evidence owner) are checked, not just output nodes.
 * Empty authority returns nothing; limits fail closed rather than distort graph ranking.
 * putNode is insert-only: an immutable source/version key cannot acquire new semantics.
 */
export class PostgresGraphStore implements AsyncGraphStore {
  readonly prefix: string;
  constructor(
    readonly db: SqlExecutor,
    prefix = 'gm_graph',
  ) {
    this.prefix = prefixName(prefix);
  }
  async initialize(workspace: string) {
    await this.db.query(`INSERT INTO ${this.prefix}_roots(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, [
      workspace,
    ]);
  }
  async putNode(workspace: string, node: GraphNode) {
    await this.db.query(
      `INSERT INTO ${this.prefix}_nodes(workspace_id,key,kind,ref,payload)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [workspace, node.key, node.kind, JSON.stringify(node.ref), JSON.stringify(node.payload ?? null)],
    );
  }
  async replaceEdges(workspace: string, owner: string, kind: string, edges: GraphEdge[]) {
    if (edges.length > 1000 || edges.some((e) => e.owner !== owner || e.kind !== kind))
      throw new TypeError('Invalid graph edge ownership or batch size.');
    // Serialize replacement with other writers on this owner. Transaction-scoped client required.
    const exists = await this.db.query(
      `SELECT key FROM ${this.prefix}_nodes WHERE workspace_id=$1 AND key=$2 FOR UPDATE`,
      [workspace, owner],
    );
    if (!exists.rows.length) throw new TypeError('Graph owner does not exist.');
    await this.db.query(`DELETE FROM ${this.prefix}_edges WHERE workspace_id=$1 AND owner_key=$2 AND kind=$3`, [
      workspace,
      owner,
      kind,
    ]);
    for (const e of edges) {
      await this.db.query(
        `INSERT INTO ${this.prefix}_edges(workspace_id,key,from_key,to_key,owner_key,kind,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [workspace, e.key, e.from, e.to, owner, kind, JSON.stringify(e.payload ?? null)],
      );
    }
    await this.db.query(`UPDATE ${this.prefix}_roots SET generation=generation+1 WHERE workspace_id=$1`, [workspace]);
  }
  async snapshot(
    workspace: string,
    authorizedKeys: readonly string[],
    limits = { nodes: 2000, edges: 10000 },
  ): Promise<GraphSnapshot> {
    const keys = [...new Set(authorizedKeys)],
      maxNodes = limits.nodes ?? 2000,
      maxEdges = limits.edges ?? 10000;
    if (
      ![maxNodes, maxEdges].every((n) => Number.isInteger(n) && n >= 1) ||
      maxNodes > 10000 ||
      maxEdges > 50000 ||
      keys.length > maxNodes
    )
      throw new GraphLimitError();
    if (!keys.length) return { nodes: [], edges: [] };
    const nodes = (
      await this.db.query(
        `SELECT key,kind,ref,payload FROM ${this.prefix}_nodes
      WHERE workspace_id=$1 AND key=ANY($2::text[]) ORDER BY key LIMIT $3`,
        [workspace, keys, maxNodes + 1],
      )
    ).rows;
    const edges = (
      await this.db.query(
        `SELECT key,from_key AS "from",to_key AS "to",owner_key AS owner,kind,payload
      FROM ${this.prefix}_edges WHERE workspace_id=$1 AND from_key=ANY($2::text[])
      AND to_key=ANY($2::text[]) AND owner_key=ANY($2::text[]) ORDER BY key LIMIT $3`,
        [workspace, keys, maxEdges + 1],
      )
    ).rows;
    if (nodes.length > maxNodes || edges.length > maxEdges) throw new GraphLimitError();
    return { nodes, edges };
  }
}
export function rankSnapshot(snapshot: GraphSnapshot, seedKeys: string[], iterations = 20): Map<string, number> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new GraphLimitError();
  const nodeIds = new Set(snapshot.nodes.map((n) => n.key));
  const adj = new Map([...nodeIds].map((key) => [key, [] as string[]]));
  for (const e of snapshot.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || !nodeIds.has(e.owner)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  return personalizedRank({ nodeIds, adj, N: nodeIds.size }, seedKeys, {
    pagerankIterations: iterations,
    pagerankDamping: 0.85,
  });
}
import { personalizedRank } from '../graph/rank';
