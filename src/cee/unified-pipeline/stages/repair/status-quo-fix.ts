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

export interface StatusQuoResult {
  fixed: boolean;
  markedDroppable: boolean;
  repairs: StatusQuoRepair[];
}

// ---------------------------------------------------------------------------
// Reachability utilities (exported for testing + reuse in sweep)
// ---------------------------------------------------------------------------

/**
 * Check if a node has a directed path to any goal node via BFS.
 */
export function hasPathToGoal(
  startId: string,
  edges: readonly EdgeT[],
  goalIds: ReadonlySet<string>,
): boolean {
  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const list = forward.get(edge.from) ?? [];
    list.push(edge.to);
    forward.set(edge.from, list);
  }

  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

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
          origin: "repair" as const,
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
