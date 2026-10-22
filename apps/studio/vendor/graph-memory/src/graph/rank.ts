/** Adapted from graph-memory by adoresever. MIT; see LICENSE.
 * Storage-free ranking: callers MUST authorize the graph before invoking this function.
 */
export interface RankConfig { pagerankIterations: number; pagerankDamping: number }
export interface GraphStructure {
  nodeIds: Set<string>;
  /** 无向邻接表 */
  adj: Map<string, string[]>;
  /** 节点数 */
  N: number;
}

export function personalizedRank(
  graph: GraphStructure,
  seedIds: string[],
  cfg: RankConfig,
  seedWeights?: ReadonlyMap<string, number>,
): Map<string, number> {
  const { nodeIds, adj, N } = graph;
  if (N === 0 || seedIds.length === 0) return new Map();

  const validSeeds = Array.from(new Set(seedIds.filter(id => nodeIds.has(id))));
  if (!validSeeds.length) return new Map();
  const rawWeights = validSeeds.map(id => Math.max(0, seedWeights?.get(id) ?? 1));
  const providedTotal = rawWeights.reduce((sum, value) => sum + value, 0);
  const teleport = new Map(validSeeds.map((id, index) => [
    id,
    providedTotal > 0 ? rawWeights[index]! / providedTotal : 1 / validSeeds.length,
  ]));

  let rank = new Map<string, number>();
  for (const id of nodeIds) rank.set(id, teleport.get(id) ?? 0);

  for (let iteration = 0; iteration < cfg.pagerankIterations; iteration += 1) {
    const next = new Map<string, number>();
    for (const id of nodeIds) {
      next.set(id, (1 - cfg.pagerankDamping) * (teleport.get(id) ?? 0));
    }

    let dangling = 0;
    for (const [nodeId, neighbors] of adj) {
      const score = rank.get(nodeId) ?? 0;
      if (!neighbors.length) {
        dangling += score;
        continue;
      }
      const contribution = cfg.pagerankDamping * score / neighbors.length;
      for (const neighbor of neighbors) {
        next.set(neighbor, (next.get(neighbor) ?? 0) + contribution);
      }
    }
    if (dangling > 0) {
      for (const seed of validSeeds) {
        next.set(
          seed,
          (next.get(seed) ?? 0) + cfg.pagerankDamping * dangling * (teleport.get(seed) ?? 0),
        );
      }
    }
    rank = next;
  }
  return rank;
}

