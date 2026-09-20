import type { GraphT } from "../schemas/graph.js";
import { log } from "../utils/telemetry.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";

/**
 * Allowed edge patterns (closed-world).
 * These match the v4 prompt EDGE_TABLE.
 */
export const ALLOWED_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },
  { from: "option", to: "factor" },
  { from: "factor", to: "outcome" },
  { from: "factor", to: "risk" },
  { from: "factor", to: "factor" },
  { from: "outcome", to: "goal" },
  { from: "risk", to: "goal" },
  { from: "risk", to: "outcome" },
];

/**
 * Check if an edge pattern is allowed.
 */
function isEdgeAllowed(fromKind: string, toKind: string): boolean {
  return ALLOWED_EDGE_PATTERNS.some(
    (p) => p.from === fromKind && p.to === toKind
  );
}

/**
 * Edge patterns that are INVALID under the closed-world topology above, and that
 * `simpleRepair` DELIBERATELY DOES NOT DELETE, because a downstream authority owns
 * them and REPAIRS them into legal topology.
 *
 * ── WHY THIS LIST EXISTS (the two-authority adjudication) ────────────────────────
 *
 * `factor→goal` had TWO authorities with OPPOSITE policies, and the deleting one ran
 * first:
 *
 *   simpleRepair's filter below  DELETE  (Stage 3, enrich.ts)
 *   fixFactorGoalEdges           SPLIT into factor→outcome→goal via a synthetic
 *                                outcome node (Stage 4 substep 1 step 4c,
 *                                deterministic-sweep.ts, "ALWAYS run regardless of
 *                                violations")
 *
 * So the splitter was UNREACHABLE for the only pattern it exists to fix. Its own
 * header says it is there because "the LLM may short-circuit the causal chain under
 * cost-reduction / minimisation framing" — precisely the case Stage 3 had already
 * erased. Measured over 7 spike runs: factor→goal deleted ×15 here, while the sweep's
 * `factor_goal_splits` counter read 0 on every single run. The deletion is not
 * neutral: it strands the goal, roughly DOUBLING NO_PATH_TO_GOAL at the gate
 * (counterfactual with the real functions over the real record sets —
 * olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/spike/
 * P5-REPAIR-ORDER-COUNTERFACTUAL.txt).
 *
 * SINGLE OWNERSHIP, restored rather than duplicated: `fixFactorGoalEdges` remains the
 * ONE implementation of the split. This filter defers to it. Two consequences worth
 * keeping in mind:
 *   - the sweep's `factor_goal_splits` trace stays the honest, meaningful counter for
 *     this pattern (it is the diagnostic that exposed the defect);
 *   - the deferral is itself counted, at both readers, so a pattern that is deferred
 *     but never repaired is VISIBLE rather than silent.
 *
 * ── WHY THE LIST IS EXACTLY ONE ENTRY ────────────────────────────────────────────
 *
 * The sibling reversed patterns the same model output carried are NOT the same case:
 *   - `factor→option`   — no downstream authority. The sweep's own
 *   - `factor→decision`   `SIMPLE_REMOVE_PATTERNS` (deterministic-sweep.ts) does not
 *                         list them, and no shortcut handler keys on them. Deletion
 *                         here IS their single owner, and the V4 topology decision is
 *                         explicit upstream (cee/verification/validators/
 *                         edge-direction-validator.ts: "options intervene on factors,
 *                         not reverse"). Deferring them would leave an unrepairable
 *                         invalid edge to fail at the gate. They stay deleted.
 *   - `option→outcome`, `option→risk`, `option→goal` have conditional downstream
 *     handlers, and `outcome→outcome` / `risk→risk` / `decision→*` are owned by the
 *     sweep's own remover — all of which also DELETE, so there is no disagreement to
 *     resolve. (The conditional handlers' skip-paths are a narrower, separate
 *     question; see the PR body. Not changed here.)
 *
 * ADDING TO THIS LIST IS A POLICY CHANGE: an entry asserts that some downstream
 * authority WILL repair the pattern on every path that reaches it. Derive that at the
 * bytes before adding one.
 */
export const SWEEP_OWNED_EDGE_PATTERNS: ReadonlyArray<{ from: string; to: string }> = [
  // Owned by fixFactorGoalEdges (deterministic-sweep.ts), which splits it into
  // factor→outcome→goal.
  { from: "factor", to: "goal" },
];

/**
 * True when an invalid edge pattern is owned by a downstream repair authority and must
 * therefore survive `simpleRepair` rather than be deleted by it.
 *
 * Single source of truth for both readers — this filter, and the post-repair assertion
 * in Stage 3 (enrich.ts) which would otherwise raise a false "invalid edge survived"
 * alarm about an edge that is deliberately in flight. A hand-copied second list is the
 * defect this estate keeps paying for; there is exactly one list, above.
 */
export function isEdgeOwnedByDownstreamRepair(fromKind: string, toKind: string): boolean {
  return SWEEP_OWNED_EDGE_PATTERNS.some(
    (p) => p.from === fromKind && p.to === toKind
  );
}

/**
 * Count edge patterns that violate the closed-world topology, split by fate:
 *   `invalid`  — nothing downstream owns these; if any survive `simpleRepair` a later
 *                stage has re-added them, which is the condition Stage 3's assertion
 *                exists to catch.
 *   `deferred` — deliberately left for a downstream authority (see
 *                SWEEP_OWNED_EDGE_PATTERNS). Expected, and reported so that "deferred
 *                but never repaired" is observable instead of silent.
 *
 * Edges referencing unknown node ids are not counted — they are a dangling-reference
 * problem, handled separately, and counting them here would blur two distinct faults.
 */
export function countEdgePatternViolations(
  graph: Pick<GraphT, "nodes" | "edges">
): { invalid: number; deferred: number } {
  const kindMap = new Map<string, string>();
  for (const node of graph.nodes) kindMap.set(node.id, node.kind);

  let invalid = 0;
  let deferred = 0;
  for (const e of graph.edges) {
    const fromKind = kindMap.get(e.from);
    const toKind = kindMap.get(e.to);
    if (!fromKind || !toKind) continue;
    if (isEdgeAllowed(fromKind, toKind)) continue;
    if (isEdgeOwnedByDownstreamRepair(fromKind, toKind)) deferred++;
    else invalid++;
  }
  return { invalid, deferred };
}

// =============================================================================
// Connectivity Repair Helpers
// =============================================================================

/** Retain unsupported option effects without choosing a substitute cause or value. */
export function retainOptionRiskRelations(graph: GraphT): { graph: GraphT; retainedCount: number } {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const retained = graph.edges.filter((edge) =>
    (kinds.get(edge.from) === "option" || kinds.get(edge.from) === "action")
    && kinds.get(edge.to) === "risk",
  );
  if (retained.length === 0) return { graph, retainedCount: 0 };
  const retainedSet = new Set(retained);
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const incoming = retained.filter((edge) => edge.from === node.id);
        if (incoming.length === 0) return node;
        const unresolved = [...(node.unresolved_causal_edges ?? [])];
        for (const edge of incoming) {
          // Repeated repair must not duplicate the retained original relation.
          if (!unresolved.some((prior) => JSON.stringify(prior) === JSON.stringify(edge))) {
            unresolved.push({ ...edge });
          }
        }
        return { ...node, unresolved_causal_edges: unresolved };
      }),
      edges: graph.edges.filter((edge) => !retainedSet.has(edge)),
    },
    retainedCount: retained.length,
  };
}

/**
 * Get nodes reachable from decision nodes via BFS
 */
function getReachableFromDecision(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"]
): Set<string> {
  // Build adjacency list (forward edges)
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    const list = adj.get(edge.from);
    if (list) list.push(edge.to);
  }

  // BFS from all decision nodes
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (node.kind === "decision") {
      queue.push(node.id);
      reachable.add(node.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj.get(current) || []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return reachable;
}

/**
 * Node kinds that must be preserved during repair, even if unreachable.
 * Defined here so pruneUnreachable can reference it.
 *
 * Factors are included because external/observable factors may have no inbound
 * edges from the decision chain but carry prior distributions needed for
 * Monte Carlo environmental uncertainty sampling. Their outbound causal edges
 * (factor→outcome, factor→risk) are structurally important.
 */
const PROTECTED_KINDS_FOR_PRUNING = new Set([
  "goal",
  "decision",
  "option",
  "outcome",
  "risk",
  "factor",
]);

/**
 * Prune nodes unreachable from decision.
 * IMPORTANT: Protected kinds (goal, decision, option, outcome, risk, factor)
 * are NEVER pruned to maintain structural integrity of the graph.
 *
 * Factors are protected because external/observable factors have outbound-only
 * causal edges (no inbound from decision chain) and carry priors for Monte Carlo.
 *
 * If no decision nodes exist, pruning is skipped entirely to avoid
 * over-deletion in malformed graphs.
 */
function pruneUnreachable(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"],
  requestId?: string
): { nodes: GraphT["nodes"]; edges: GraphT["edges"]; prunedIds: string[] } {
  // Skip pruning if no decision nodes - can't determine reachability
  const hasDecision = nodes.some((n) => n.kind === "decision");
  if (!hasDecision) {
    return { nodes, edges, prunedIds: [] };
  }

  const reachable = getReachableFromDecision(nodes, edges);

  // Log unreachable factors that are preserved (for observability)
  const unreachableFactors = nodes.filter(
    (n) => n.kind === "factor" && !reachable.has(n.id)
  );
  if (unreachableFactors.length > 0) {
    log.info(
      {
        event: "SIMPLE_REPAIR_UNREACHABLE_FACTORS_PRESERVED",
        request_id: requestId,
        unreachable_factor_ids: unreachableFactors.map((n) => n.id),
        count: unreachableFactors.length,
      },
      `Preserved ${unreachableFactors.length} unreachable factor(s) (protected kind)`
    );
  }

  const prunedIds: string[] = [];
  const keptNodes = nodes.filter((n) => {
    // Always keep protected kinds (structural nodes)
    if (PROTECTED_KINDS_FOR_PRUNING.has(n.kind)) return true;
    // Keep reachable nodes
    if (reachable.has(n.id)) return true;
    // Prune unreachable non-protected nodes
    prunedIds.push(n.id);
    return false;
  });

  if (prunedIds.length > 0) {
    const keptNodeIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = edges.filter(
      (e) => keptNodeIds.has(e.from) && keptNodeIds.has(e.to)
    );

    log.info(
      {
        event: "SIMPLE_REPAIR_PRUNED_UNREACHABLE",
        request_id: requestId,
        pruned_node_ids: prunedIds,
        reason: "unreachable_from_decision",
      },
      `simpleRepair pruned ${prunedIds.length} unreachable nodes`
    );

    return { nodes: keptNodes, edges: keptEdges, prunedIds };
  }

  return { nodes, edges, prunedIds: [] };
}

/**
 * Node kinds that must be preserved during repair, even if it means exceeding the soft cap.
 * These are structurally required for a valid decision graph:
 * - goal: Required target node
 * - decision: Required root node
 * - option: Required alternatives (at least 2)
 * - outcome: Required positive consequences
 * - risk: Required negative consequences
 * - factor: Carry prior distributions for Monte Carlo sampling (external/observable)
 */
const PROTECTED_KINDS = new Set(["goal", "decision", "option", "outcome", "risk", "factor"]);

/**
 * Simple repair that trims counts to caps, wires orphaned nodes, prunes unreachable
 * nodes, and removes invalid edge patterns (closed-world ALLOWED_EDGE_PATTERNS).
 *
 * Invalid edge patterns are REMOVED, not preserved. If removal disconnects a node,
 * a warning is logged but the invalid edge is still removed. The connectivity substep
 * (Stage 4.8) will attempt rewiring afterwards.
 *
 * Protected node kinds (goal, decision, option, outcome, risk, factor) are ALWAYS
 * preserved regardless of their position in the array, to prevent structural failures.
 *
 * Node/edge caps use GRAPH_MAX_NODES (50) and GRAPH_MAX_EDGES (200) from graphCaps.ts.
 */
export interface SimpleRepairOptions {
  /**
   * Opt in to leaving SWEEP_OWNED_EDGE_PATTERNS for their downstream repair authority
   * instead of deleting them. **Defaults to FALSE**, i.e. delete everything invalid.
   *
   * ⚠ THIS BELONGS TO THE CALL SITE, NOT TO THE FUNCTION, and that distinction is the
   * whole point. The deferral is justified by what runs AFTER the caller — Stage 3
   * (`enrich.ts`) is followed by the sweep, which repairs the pattern; substep 2
   * (`plot-validation.ts`) is NOT, because the sweep has already run by then.
   *
   * Shipping this at function scope was a real defect, caught in review by execution
   * rather than by argument: `fixFactorGoalEdges` reuses an existing
   * `out_<factorId>_impact` node WITHOUT checking its kind
   * (`deterministic-sweep.ts:981`), so a non-outcome node on that id makes the splitter
   * EMIT a fresh `factor→goal` edge *after* the sweep. A function-scoped exemption then
   * deferred it at substep 2 to an authority that had already run: previously deleted,
   * now shipped to a 422 at the post-enforcement gate. Trap 21 one level up from the
   * defect the deferral itself fixes.
   *
   * With the opt-in, substep-2 deferral is impossible BY CONSTRUCTION rather than by an
   * argument that a constructed case defeats. **Pass `true` only where a downstream
   * authority provably still runs, and say which one.**
   */
  deferSweepOwnedPatterns?: boolean;
}

export function simpleRepair(
  g: GraphT,
  requestId?: string,
  opts?: SimpleRepairOptions
): GraphT {
  const deferSweepOwnedPatterns = opts?.deferSweepOwnedPatterns === true;
  g = retainOptionRiskRelations(g).graph;
  // Separate protected and unprotected nodes
  const protectedNodes = g.nodes.filter((n) => PROTECTED_KINDS.has(n.kind));
  const unprotectedNodes = g.nodes.filter((n) => !PROTECTED_KINDS.has(n.kind));

  // Always keep protected nodes, then fill with unprotected up to cap
  const maxUnprotected = Math.max(0, GRAPH_MAX_NODES - protectedNodes.length);
  const nodes = [...protectedNodes, ...unprotectedNodes.slice(0, maxUnprotected)];

  if (protectedNodes.length > 0 || unprotectedNodes.length > GRAPH_MAX_NODES) {
    log.info({
      event: "cee.simple_repair.protected_nodes_preserved",
      request_id: requestId,
      protected_count: protectedNodes.length,
      protected_kinds: protectedNodes.map((n) => n.kind),
      unprotected_kept: Math.min(unprotectedNodes.length, maxUnprotected),
      unprotected_dropped: Math.max(0, unprotectedNodes.length - maxUnprotected),
      total_nodes: nodes.length,
      max_nodes: GRAPH_MAX_NODES,
    }, "simpleRepair preserved protected node kinds");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));

  // Filter only dangling edges (references to nodes outside the trimmed set)
  let validEdges = g.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  // Connectivity alone cannot justify new causal endpoints, signs or magnitudes.
  // Preserve disconnected meaning; the existing validator owns reachability.

  // Step B: Prune nodes unreachable from decision
  const pruneResult = pruneUnreachable(nodes, validEdges, requestId);
  const finalNodes = pruneResult.nodes;
  validEdges = pruneResult.edges;

  // Update nodeKindMap for pruned nodes
  const finalNodeKindMap = new Map(finalNodes.map((node) => [node.id, node.kind]));

  // === End Connectivity Repair ===

  // Remove invalid edge patterns that violate the closed-world topology.
  // Previously these were preserved for connectivity, but invalid patterns like
  // outcome→outcome and outcome→risk cause downstream ISL analysis failures.
  //
  // EXCEPT, WHEN THE CALLER OPTS IN, the patterns a downstream authority OWNS AND
  // REPAIRS (SWEEP_OWNED_EDGE_PATTERNS — see the adjudication on that constant).
  // Deleting those made the repair built for them unreachable and left the goal
  // stranded; they are handed on instead. The opt-in is per call site because the
  // justification is "a repairer still runs after me", which is false at substep 2.
  const invalidEdges: Array<{ from: string; to: string; fromKind: string; toKind: string }> = [];
  const deferredEdges: Array<{ from: string; to: string; fromKind: string; toKind: string }> = [];
  validEdges = validEdges.filter((edge) => {
    const fromKind = finalNodeKindMap.get(edge.from);
    const toKind = finalNodeKindMap.get(edge.to);
    if (fromKind && toKind && !isEdgeAllowed(fromKind, toKind)) {
      if (deferSweepOwnedPatterns && isEdgeOwnedByDownstreamRepair(fromKind, toKind)) {
        deferredEdges.push({ from: edge.from, to: edge.to, fromKind, toKind });
        return true; // Keep — the downstream authority repairs this pattern
      }
      invalidEdges.push({ from: edge.from, to: edge.to, fromKind, toKind });
      return false; // Remove the invalid edge
    }
    return true;
  });

  if (invalidEdges.length > 0) {
    log.warn({
      event: "cee.simple_repair.invalid_edges_removed",
      request_id: requestId,
      removed_count: invalidEdges.length,
      remaining_edge_count: validEdges.length,
      removed_patterns: invalidEdges.map((e) => `${e.fromKind}→${e.toKind}`),
      removed_edges: invalidEdges,
    }, `simpleRepair removed ${invalidEdges.length} invalid edge pattern(s)`);
  }

  if (deferredEdges.length > 0) {
    log.info({
      event: "cee.simple_repair.invalid_edges_deferred",
      request_id: requestId,
      deferred_count: deferredEdges.length,
      deferred_patterns: deferredEdges.map((e) => `${e.fromKind}→${e.toKind}`),
      deferred_edges: deferredEdges,
    }, `simpleRepair deferred ${deferredEdges.length} edge pattern(s) to their downstream repair authority`);
  }

  const edges = validEdges
    .slice(0, GRAPH_MAX_EDGES)
    .map((edge, idx) => ({ ...edge, id: edge.id || `${edge.from}::${edge.to}::${idx}` }))
    .sort((a, b) => a.id!.localeCompare(b.id!));

  return { ...g, nodes: finalNodes, edges };
}
