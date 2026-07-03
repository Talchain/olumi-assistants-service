/**
 * Shared cycle-detection candidate (quarantined scaffold — not imported by
 * any live path, NOT swapped into merge.ts or graphGuards callers).
 *
 * The repo has two directed-cycle implementations today:
 *   - src/utils/graphGuards.ts detectCycles/isDAG (canonical, node-list
 *     aware: edges with endpoints missing from `nodes` are DROPPED);
 *   - src/cee/dual-draft/merge.ts wouldCreateCycle (module-private,
 *     edge-list only: no node list exists at its call site because endpoint
 *     existence is checked by an earlier guard).
 * Both skip bidirected (confounder) edges. This candidate reimplements the
 * would-adding-close-a-cycle predicate as a standalone utility with
 * equivalence proven against BOTH (see graph-cycles-equivalence.test.ts).
 * Swapping either live caller onto it is findings-and-handoff
 * (Docs/v6/handoff-shared-robustness-swaps.md), not this branch.
 */

export interface DirectedEdgeLike {
  readonly from: string;
  readonly to: string;
  /** 'bidirected' edges are skipped — they are not directed causal paths. */
  readonly edge_type?: string;
}

/**
 * True iff a directed path start→…→end exists. Iterative DFS; bidirected
 * edges never participate. A zero-length path does not count: hasDirectedPath
 * (edges, x, x) is true only when x sits on a directed cycle through x.
 */
export function hasDirectedPath(
  edges: ReadonlyArray<DirectedEdgeLike>,
  start: string,
  end: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edge_type === 'bidirected') continue;
    const list = adjacency.get(e.from);
    if (list) list.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }
  const stack = [...(adjacency.get(start) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === end) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

/**
 * True iff adding the directed edge from→to would close a directed cycle,
 * i.e. `to` can already reach `from`. Self-loops (from === to) return true —
 * callers that reject self-loops separately (as the merge does) never reach
 * this with from === to.
 */
export function wouldCreateCycle(
  edges: ReadonlyArray<DirectedEdgeLike>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  return hasDirectedPath(edges, to, from);
}
