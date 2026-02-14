/**
 * Performs a topological sort on a directed acyclic graph (DAG) represented by nodes and edges.
 * If the graph contains a cycle, an error is thrown.
 *
 * @param nodes - An array of strings representing the nodes in the graph.
 * @param edges - An array of tuples where each tuple `[u, v]` represents a directed edge
 *                from node `u` (parent) to node `v` (child).
 * @returns An array of strings representing the nodes in topologically sorted order.
 * @throws {Error} If a circular dependency is detected, an error is thrown with the
 *                 list of nodes involved in the cycle.
 */
export function topoSortOrThrow(nodes: string[], edges: Array<[string, string]>): string[] {
  // edges are parent -> child
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n, 0);
    adj.set(n, []);
  }

  for (const [u, v] of edges) {
    if (!adj.has(u) || !adj.has(v)) continue;
    adj.get(u)!.push(v);
    inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
  }

  const q: string[] = [];
  for (const [n, d] of inDeg.entries()) if (d === 0) q.push(n);

  const out: string[] = [];
  while (q.length > 0) {
    const n = q.shift()!;
    out.push(n);
    for (const m of adj.get(n) ?? []) {
      inDeg.set(m, (inDeg.get(m) ?? 0) - 1);
      if (inDeg.get(m) === 0) q.push(m);
    }
  }

  if (out.length !== nodes.length) {
    const cycleCandidates = nodes.filter((n) => (inDeg.get(n) ?? 0) > 0);
    throw new Error(`Circular dependency detected among: ${cycleCandidates.join(', ')}`);
  }

  return out;
}
