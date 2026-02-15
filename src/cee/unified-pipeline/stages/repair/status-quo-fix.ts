/**
 * Status Quo Connectivity Fix
 *
 * Called from within the deterministic sweep (Task 2, step 8).
 *
 * Detects status quo options (zero outgoing option→factor edges) and wires
 * them to intervention targets from other options. Structural detection only —
 * does NOT use label matching.
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
// Main
// ---------------------------------------------------------------------------

/**
 * Fix status quo connectivity.
 *
 * Only triggers when violations include NO_PATH_TO_GOAL or NO_EFFECT_PATH.
 *
 * 1. Find status quo option(s) by structure (zero option→factor edges)
 * 2. Get intervention targets from other options (union of factor IDs)
 * 3. Add option→factor edges from status quo to those factors
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

  // Find option nodes
  const optionNodes = nodes.filter((n) => n.kind === "option");

  // Build option→factor adjacency
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

  // Find status quo options (zero outgoing option→factor edges)
  const statusQuoOptions = optionNodes.filter((opt) => {
    const targets = optionFactorTargets.get(opt.id);
    return !targets || targets.size === 0;
  });

  if (statusQuoOptions.length === 0) {
    return { fixed: false, markedDroppable: false, repairs };
  }

  // Get union of intervention targets from non-status-quo options
  const interventionTargets = new Set<string>();
  for (const [optId, targets] of optionFactorTargets) {
    if (statusQuoOptions.some((sq) => sq.id === optId)) continue;
    for (const factorId of targets) {
      interventionTargets.add(factorId);
    }
  }

  if (interventionTargets.size === 0) {
    // No other options have interventions — can't fix
    for (const sq of statusQuoOptions) {
      repairs.push({
        code: "STATUS_QUO_NO_TARGETS",
        path: `nodes[${sq.id}]`,
        action: `Status quo option "${sq.label ?? sq.id}" has no intervention targets to copy from other options`,
      });
    }
    return { fixed: false, markedDroppable: true, repairs };
  }

  // Wire status quo → factors
  let edgesAdded = 0;
  for (const sq of statusQuoOptions) {
    for (const factorId of interventionTargets) {
      const baseEdge: EdgeT = {
        from: sq.id,
        to: factorId,
        origin: "repair" as const,
      };
      const newEdge = canonicalStructuralEdge(baseEdge, format);
      (graph as any).edges.push(newEdge);
      edgesAdded++;
    }

    repairs.push({
      code: "STATUS_QUO_WIRED",
      path: `nodes[${sq.id}]`,
      action: `Wired status quo option "${sq.label ?? sq.id}" to ${interventionTargets.size} factor(s)`,
    });
  }

  // Check if wired factors have path to goal — if not, wire through outcome/risk
  const goalIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "goal") goalIds.add(node.id);
  }

  // Find most common outcome/risk target used by other edges
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
    // Check if this factor has any outgoing edge to outcome/risk
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
      edgesAdded++;
      repairs.push({
        code: "STATUS_QUO_FACTOR_WIRED",
        path: `edges[${factorId}→${mostCommonTarget}]`,
        action: `Wired factor "${factorId}" to ${nodeKindMap.get(mostCommonTarget)} "${mostCommonTarget}" for status quo path`,
      });
    }
  }

  // Validate: check if at least one status quo now has path to goal
  const updatedEdges = (graph as any).edges as EdgeT[];
  let anyFixed = false;
  let anyStillBroken = false;

  for (const sq of statusQuoOptions) {
    // BFS from status quo through edges to check goal reachability
    const visited = new Set<string>();
    const bfsQueue = [sq.id];
    visited.add(sq.id);
    let reachesGoal = false;

    while (bfsQueue.length > 0) {
      const current = bfsQueue.shift()!;
      if (goalIds.has(current)) {
        reachesGoal = true;
        break;
      }
      for (const edge of updatedEdges) {
        if (edge.from === current && !visited.has(edge.to)) {
          visited.add(edge.to);
          bfsQueue.push(edge.to);
        }
      }
    }

    if (reachesGoal) {
      anyFixed = true;
    } else {
      anyStillBroken = true;
      repairs.push({
        code: "STATUS_QUO_STILL_INVALID",
        path: `nodes[${sq.id}]`,
        action: `Status quo option "${sq.label ?? sq.id}" still has no path to goal after wiring — marked droppable`,
      });
    }
  }

  return {
    fixed: anyFixed,
    markedDroppable: anyStillBroken,
    repairs,
  };
}
