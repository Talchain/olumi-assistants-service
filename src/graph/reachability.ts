/**
 * THE goal-reachability kernel.
 *
 * ONE definition of "can this node reach a goal", so that the passes which
 * *detect* a connectivity defect and the passes which *repair* it cannot
 * disagree about what an edge is.
 *
 * ## Why this module exists
 *
 * Before it, the deterministic repair sweep carried three independent
 * forward-BFS implementations of the same predicate — `status-quo-fix.ts`,
 * `unreachable-factors.ts` and `deterministic-sweep.ts` — and **none of them
 * filtered `edge_type`**, while both validators that judge their output do:
 *
 *   - `src/validators/graph-validator.ts:61`
 *       "Bidirected edges represent unmeasured confounders, not directed paths.
 *        Exclude them from adjacency so they don't affect reachability …"
 *   - `src/orchestrator/graph-structure-validator.ts:294,346` — same filter.
 *
 * The observable consequence was a dead end, not a cosmetic inconsistency: on a
 * graph whose only option→goal path ran through a bidirected edge, the
 * validator emitted `NO_PATH_TO_GOAL`, `fixStatusQuoConnectivity` woke up on
 * that very code, asked its own oracle which options were disconnected, was
 * told "none", and returned `{ fixed: false, repairs: 0 }`. The validator kept
 * failing; the repair kept declining to act.
 *
 * ## The semantics, and why they are not a new policy
 *
 * A bidirected edge is an unmeasured common cause, NOT a causal path. That is
 * the estate's existing, declared position — this module applies it, it does
 * not invent it:
 *
 *   - `src/schemas/graph.ts:333-335` — '"bidirected": A↔B — indicates an
 *     unmeasured common cause (Pearl's ADMG notation) … ISL never sees
 *     bidirected edges.'
 *   - `src/utils/graphGuards.ts:365` — "Bidirected edges are trust annotations
 *     and do not define layer ordering."
 *   - `src/cee/unified-pipeline/stages/repair/graph-enforcement.ts:147` —
 *     `if (edge.edge_type === "bidirected") return false;`
 *   - the draft prompt itself (`src/prompts/defaults-v19.ts:76`) — "Bidirected
 *     edges are trust annotations — they are ignored by ISL simulation."
 *
 * So the traversal policy is DIRECTED-ONLY, with no opt-out parameter. An
 * "allEdges" escape hatch would simply re-open the drift this module closes
 * (platform CLAUDE.md trap 12 — derive, don't mirror). A caller that genuinely
 * needs undirected connectivity is asking a different question and must say so
 * in its own name, not by flipping a flag on this one.
 *
 * ## What this module deliberately does NOT unify
 *
 * Several other predicates in the estate look like this one and are not:
 *   - `unreachable-factors.ts` / `analysis-ready.ts` "is this factor reachable
 *     FROM AN OPTION" — a different question; the goal plays no part.
 *   - `deterministic-sweep.ts` `canReachGoalViaAllowed` — deliberately narrowed
 *     by a node-kind-pair whitelist so a *forbidden* shortcut cannot vouch for
 *     another one. It keeps its whitelist; it only adopts the edge policy.
 *   - `transforms/structure-checks.ts` / `graph-readiness/factors.ts` — both
 *     UNDIRECTED by construction, answering "is the graph one component".
 * Collapsing those into this one would be a behaviour change wearing a
 * refactor's clothes.
 */

import { isDirectedEdge, type EdgeT } from "../schemas/graph.js";

/**
 * Forward adjacency over DIRECTED edges only.
 *
 * Exported so that traversals with their own additional filters (kind
 * whitelists, strength weighting) can share the edge policy rather than
 * re-deriving it — the whole point of this module.
 */
export function buildDirectedForwardAdjacency(
  edges: readonly EdgeT[],
): Map<string, string[]> {
  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    // The single place the estate's directed-edge policy is applied to a
    // reachability traversal.
    if (!isDirectedEdge(edge)) continue;
    const list = forward.get(edge.from);
    if (list) list.push(edge.to);
    else forward.set(edge.from, [edge.to]);
  }
  return forward;
}

/**
 * Does `startId` have a directed path to ANY node in `goalIds`?
 *
 * `startId` itself counts: a goal trivially reaches itself.
 * Absent `edge_type` is treated as `"directed"` (backward compatibility —
 * `isDirectedEdge`, `src/schemas/graph.ts:447`).
 */
export function canReachAnyGoal(
  startId: string,
  edges: readonly EdgeT[],
  goalIds: ReadonlySet<string>,
): boolean {
  const forward = buildDirectedForwardAdjacency(edges);

  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (goalIds.has(current)) return true;
    for (const next of forward.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
