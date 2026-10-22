/** Existing workflow rank layout, shared with process canvas. Geometry does not define execution order. */
export function layoutPositions(ids: string[], edges: { source: string; target: string }[]) {
  const ranks = rankNodes(ids, edges),
    buckets = new Map<number, string[]>();
  for (const id of ids) {
    const rank = ranks.get(id) ?? 0;
    buckets.set(rank, [...(buckets.get(rank) ?? []), id]);
  }
  const ordered = [...buckets.keys()].sort((a, b) => a - b),
    left = -Math.max(1, ordered.length - 1) * 390 * 0.5;
  return Object.fromEntries(
    ids.map((id) => {
      const rank = ranks.get(id) ?? 0,
        bucket = buckets.get(rank) ?? [];
      return [
        id,
        {
          x: Math.round(left + ordered.indexOf(rank) * 390),
          y: Math.round((bucket.indexOf(id) - (bucket.length - 1) / 2) * 340),
        },
      ];
    }),
  );
}
function rankNodes(ids: string[], edges: { source: string; target: string }[]) {
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceRank = rank.get(edge.source) ?? 0;
      const targetRank = rank.get(edge.target) ?? 0;
      if (targetRank <= sourceRank) {
        rank.set(edge.target, sourceRank + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}
