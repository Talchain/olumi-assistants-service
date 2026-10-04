/**
 * Status Quo Connectivity Fix
 *
 * Called from within the deterministic sweep (Task 2, step 8).
 *
 * Detects disconnected options — those with no complete path to goal —
 * and wires them to intervention targets from other options. Includes both
 * options with zero option→factor edges AND options whose factors are
 * dead-ends (no path to goal).
 *
 * Structural detection only — does NOT use label matching.
 */

import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import { canReachAnyGoal } from "../../../../graph/reachability.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { canonicalStructuralEdge, neutralCausalEdge } from "../../utils/edge-format.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusQuoRepair {
  code: string;
  path: string;
  action: string;
}

/**
 * ⭐ THE REASON THIS REPAIR STAMPS ON EVERY EDGE IT MINTS — and it is stated
 * here, once, because the literal it replaces was a BOILERPLATE MISDESCRIPTION.
 *
 * THE DEFECT, measured live on `cee-staging` (`/proxy/v5/turn`, frame stage,
 * fresh scenario, 2026-09-14): the edge this pass mints carried
 * `"Status-quo option wired to factor"` — naming an option CLASS that nothing
 * in this module ever tests. Detection here is purely structural
 * (`!hasPathToGoal`, and the file header says so in its own first paragraph:
 * *"Structural detection only — does NOT use label matching"*), so the option
 * it selects is whichever one has no route to goal. On the measured draft that
 * was the user's OWN proposal, labelled with the user's own words
 * (*"increase the Pro plan price from £49 to £59 per month with the next Pro
 * feature release"*), while a genuine `is_baseline` status-quo option
 * (*"Hold Price at £49"*) sat in the same graph fully connected and untouched.
 * The product therefore filed the user's raise-price proposal under the one
 * option class it demonstrably is not.
 *
 * ⚠ THE SELECTION WAS NEVER WRONG — ONLY THE SENTENCE. This distinction is the
 * whole finding, and it decides the remedy: a repair that picked the wrong
 * node would need its predicate changed; a repair that picked the right node
 * and then misdescribed it needs its STRING changed, and changing the
 * predicate would have broken a correct connectivity fix. The sibling `action`
 * string below (`STATUS_QUO_WIRED`) was already honest — it is DERIVED, and
 * says *"Wired disconnected option …"*. One module, one act, two strings: the
 * derived one told the truth and the hardcoded one did not, which is trap 12's
 * hand-maintained mirror living inside a single function.
 *
 * The module name (`status-quo-fix.ts`) and the `STATUS_QUO_*` repair codes are
 * DELIBERATELY left alone. They are the estate's existing vocabulary for this
 * pass, the served prompt genuinely mandates a Status Quo option wired to every
 * indicator (see PR #1475's `THE BASELINE CONFOUND`), and renaming a repair
 * code is a wire-visible change to `repair_provenance[]` that is not this
 * lane's to make. What is fixed is the only string that makes a FALSE CLAIM
 * ABOUT A PARTICULAR OPTION.
 *
 * Exported so a test binds to the producer by IDENTITY rather than re-copying
 * the literal (trap 19). Four existing fixtures spell the old string by hand;
 * none of them ASSERTS that this module emits it (checked at the bytes: they
 * construct edges, and `cee.edge-provenance-ingress.test.ts:277` round-trips
 * its own local constant), so they keep working and are deliberately not
 * rewritten — two of them are DATED CAPTURE FIXTURES and are append-only
 * evidence, not text to keep current (trap 14b).
 */
export const CONNECTIVITY_REPAIR_WIRING_REASON =
  "Connectivity repair wired this option to a factor another option targets; no effect value is implied";

export interface StatusQuoResult {
  fixed: boolean;
  markedDroppable: boolean;
  repairs: StatusQuoRepair[];
}

// ---------------------------------------------------------------------------
// Reachability utilities (exported for testing + reuse in sweep)
// ---------------------------------------------------------------------------

/**
 * Check if a node has a directed path to any goal node.
 *
 * Delegates to the single reachability kernel (`src/graph/reachability.ts`).
 * It previously carried its own BFS which built adjacency from EVERY edge with
 * no `edge_type` test, so a bidirected edge — an unmeasured confounder, not a
 * causal path — counted as a route to the goal. Both validators that judge this
 * pass's output exclude bidirected edges (`graph-validator.ts:61`,
 * `graph-structure-validator.ts:294/346`), so the repair could be told
 * "nothing is disconnected" about the very graph the validator had just failed.
 *
 * Kept as a named export: it is part of this module's tested surface and its
 * signature is unchanged.
 */
export function hasPathToGoal(
  startId: string,
  edges: readonly EdgeT[],
  goalIds: ReadonlySet<string>,
): boolean {
  return canReachAnyGoal(startId, edges, goalIds);
}

/**
 * Find option nodes that have no directed path to any goal node.
 * Returns array of disconnected option IDs.
 */
export function findDisconnectedOptions(graph: GraphT): string[] {
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const goalIds = new Set<string>();
  const optionIds: string[] = [];
  for (const node of nodes) {
    if (node.kind === "goal") goalIds.add(node.id);
    if (node.kind === "option") optionIds.push(node.id);
  }

  if (goalIds.size === 0) return optionIds; // No goal → all disconnected

  const disconnected: string[] = [];
  for (const optId of optionIds) {
    if (!hasPathToGoal(optId, edges, goalIds)) {
      disconnected.push(optId);
    }
  }
  return disconnected;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Fix status quo connectivity.
 *
 * Detection is based on path reachability, NOT zero-edge-count:
 * - An option is "disconnected" when it has no directed path to goal
 * - This covers both: (a) zero option→factor edges, (b) edges to dead-end factors
 *
 * 1. Find disconnected options (no path option→...→goal)
 * 2. Get intervention targets from connected options (union of factor IDs)
 * 3. Add option→factor edges from disconnected options to those factors
 * 4. For factors now targeted: check path to goal. If missing, add factor→outcome/risk edge.
 * 5. If valid: fixed = true
 * 6. If still invalid: markedDroppable = true (never remove)
 */
export function fixStatusQuoConnectivity(
  graph: GraphT,
  violations: Array<{ code: string }>,
  format: EdgeFormat,
): StatusQuoResult {
  const repairs: StatusQuoRepair[] = [];

  // Only trigger when relevant violations exist
  const relevantCodes = new Set(["NO_PATH_TO_GOAL", "NO_EFFECT_PATH"]);
  const hasRelevantViolation = violations.some((v) => relevantCodes.has(v.code));
  if (!hasRelevantViolation) {
    return { fixed: false, markedDroppable: false, repairs };
  }

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Build node kind map
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  // Find goal IDs
  const goalIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "goal") goalIds.add(node.id);
  }

  // Find option nodes
  const optionNodes = nodes.filter((n) => n.kind === "option");

  // Find disconnected options by path reachability (not zero-edge-count)
  const disconnectedOptions = optionNodes.filter(
    (opt) => !hasPathToGoal(opt.id, edges, goalIds),
  );

  if (disconnectedOptions.length === 0) {
    return { fixed: false, markedDroppable: false, repairs };
  }

  // Build option→factor adjacency for all options
  const optionFactorTargets = new Map<string, Set<string>>();
  for (const opt of optionNodes) {
    optionFactorTargets.set(opt.id, new Set());
  }
  for (const edge of edges) {
    if (
      nodeKindMap.get(edge.from) === "option" &&
      nodeKindMap.get(edge.to) === "factor"
    ) {
      optionFactorTargets.get(edge.from)?.add(edge.to);
    }
  }

  const disconnectedIds = new Set(disconnectedOptions.map((o) => o.id));

  // Get union of intervention targets from connected (non-disconnected) options
  const interventionTargets = new Set<string>();
  for (const [optId, targets] of optionFactorTargets) {
    if (disconnectedIds.has(optId)) continue;
    for (const factorId of targets) {
      interventionTargets.add(factorId);
    }
  }

  if (interventionTargets.size === 0) {
    // No connected options have interventions — can't fix
    for (const sq of disconnectedOptions) {
      repairs.push({
        code: "STATUS_QUO_NO_TARGETS",
        path: `nodes[${sq.id}]`,
        action: `Disconnected option "${sq.label ?? sq.id}" has no intervention targets to copy from connected options`,
      });
    }
    return { fixed: false, markedDroppable: true, repairs };
  }

  // For each disconnected option, find which factors it ALREADY targets
  // Only wire to factors it doesn't already have edges to
  for (const sq of disconnectedOptions) {
    const existingTargets = optionFactorTargets.get(sq.id) ?? new Set();
    const newTargets = new Set<string>();
    for (const factorId of interventionTargets) {
      if (!existingTargets.has(factorId)) {
        newTargets.add(factorId);
      }
    }

    if (newTargets.size > 0) {
      for (const factorId of newTargets) {
        const baseEdge: EdgeT = {
          from: sq.id,
          to: factorId,
          effect_direction: "positive" as const,
          origin: "repair" as const,
          provenance: {
            source: "synthetic",
            quote: CONNECTIVITY_REPAIR_WIRING_REASON,
          },
          provenance_source: "synthetic" as const,
        };
        const newEdge = canonicalStructuralEdge(baseEdge, format);
        (graph as any).edges.push(newEdge);
      }

      repairs.push({
        code: "STATUS_QUO_WIRED",
        path: `nodes[${sq.id}]`,
        action: `Wired disconnected option "${sq.label ?? sq.id}" to ${newTargets.size} additional factor(s)`,
      });
    }
  }

  // Check if wired factors have path to goal — if not, wire through outcome/risk
  const outcomeRiskIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "outcome" || node.kind === "risk") {
      outcomeRiskIds.add(node.id);
    }
  }

  const targetCounts = new Map<string, number>();
  for (const edge of (graph as any).edges as EdgeT[]) {
    if (outcomeRiskIds.has(edge.to)) {
      targetCounts.set(edge.to, (targetCounts.get(edge.to) ?? 0) + 1);
    }
  }

  let mostCommonTarget: string | undefined;
  let bestCount = 0;
  for (const [id, count] of targetCounts) {
    if (count > bestCount) {
      bestCount = count;
      mostCommonTarget = id;
    }
  }

  for (const factorId of interventionTargets) {
    // Check if this factor has any outgoing edge to outcome/risk/goal
    const hasOutgoing = (graph as any).edges.some(
      (e: EdgeT) => e.from === factorId && (outcomeRiskIds.has(e.to) || goalIds.has(e.to)),
    );

    if (!hasOutgoing && mostCommonTarget) {
      const newEdge = neutralCausalEdge(format, {
        from: factorId,
        to: mostCommonTarget,
        sign: nodeKindMap.get(mostCommonTarget) === "risk" ? "negative" : "positive",
      });
      (graph as any).edges.push(newEdge);
      repairs.push({
        code: "STATUS_QUO_FACTOR_WIRED",
        path: `edges[${factorId}→${mostCommonTarget}]`,
        action: `Wired factor "${factorId}" to ${nodeKindMap.get(mostCommonTarget)} "${mostCommonTarget}" for goal path`,
      });
    }
  }

  // Validate: check if disconnected options are now connected
  const updatedEdges = (graph as any).edges as EdgeT[];
  let anyFixed = false;
  let anyStillBroken = false;

  for (const sq of disconnectedOptions) {
    if (hasPathToGoal(sq.id, updatedEdges, goalIds)) {
      anyFixed = true;
    } else {
      anyStillBroken = true;
      repairs.push({
        code: "STATUS_QUO_STILL_INVALID",
        path: `nodes[${sq.id}]`,
        action: `Option "${sq.label ?? sq.id}" still has no path to goal after wiring — marked droppable`,
      });
    }
  }

  return {
    fixed: anyFixed,
    markedDroppable: anyStillBroken,
    repairs,
  };
}
