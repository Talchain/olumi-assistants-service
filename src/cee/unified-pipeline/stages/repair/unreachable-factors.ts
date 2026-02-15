/**
 * Unreachable Factor Handling
 *
 * Called from within the deterministic sweep (Task 2, step 7).
 *
 * Identifies factor nodes with zero inbound option→factor edges,
 * reclassifies them as "external", and checks goal reachability.
 * Factors without a path to goal are marked droppable (never removed).
 */

import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { neutralCausalEdge } from "../../utils/edge-format.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnreachableFactorRepair {
  code: string;
  path: string;
  action: string;
}

export interface UnreachableFactorResult {
  reclassified: string[];
  markedDroppable: string[];
  repairs: UnreachableFactorRepair[];
  edgesAdded: EdgeT[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a set of factor IDs that have at least one inbound option→factor edge.
 */
function buildReachableFactorSet(
  nodes: readonly NodeT[],
  edges: readonly EdgeT[],
): Set<string> {
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  const reachable = new Set<string>();
  for (const edge of edges) {
    if (
      nodeKindMap.get(edge.from) === "option" &&
      nodeKindMap.get(edge.to) === "factor"
    ) {
      reachable.add(edge.to);
    }
  }
  return reachable;
}

/**
 * Check if a factor has a path to any goal node via BFS through edges.
 */
function hasPathToGoal(
  factorId: string,
  edges: readonly EdgeT[],
  goalIds: Set<string>,
): boolean {
  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const list = forward.get(edge.from) ?? [];
    list.push(edge.to);
    forward.set(edge.from, list);
  }

  const visited = new Set<string>();
  const queue = [factorId];
  visited.add(factorId);

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
 * Find the most commonly targeted outcome/risk node by other factors.
 */
function findMostCommonOutcomeRiskTarget(
  nodes: readonly NodeT[],
  edges: readonly EdgeT[],
): string | undefined {
  const outcomeRiskIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "outcome" || node.kind === "risk") {
      outcomeRiskIds.add(node.id);
    }
  }

  const targetCounts = new Map<string, number>();
  for (const edge of edges) {
    if (outcomeRiskIds.has(edge.to)) {
      targetCounts.set(edge.to, (targetCounts.get(edge.to) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [id, count] of targetCounts) {
    if (count > bestCount) {
      bestCount = count;
      best = id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Handle unreachable factors in the graph.
 *
 * 1. Identify factors with zero inbound option→factor edges
 * 2. Reclassify as category: "external"
 * 3. Check if reclassified factor has path to goal
 * 4. If no path: try to wire through existing outcome/risk
 * 5. If still no path: mark as droppable (never remove)
 */
export function handleUnreachableFactors(
  graph: GraphT,
  format: EdgeFormat,
): UnreachableFactorResult {
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const reachableFactors = buildReachableFactorSet(nodes, edges);
  const goalIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "goal") goalIds.add(node.id);
  }

  const reclassified: string[] = [];
  const markedDroppable: string[] = [];
  const repairs: UnreachableFactorRepair[] = [];
  const edgesAdded: EdgeT[] = [];

  // Also consider factors reachable via factor→factor chains from option-connected factors
  const transitivelyReachable = new Set<string>(reachableFactors);
  const factorForward = new Map<string, string[]>();
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }
  for (const edge of edges) {
    if (
      nodeKindMap.get(edge.from) === "factor" &&
      nodeKindMap.get(edge.to) === "factor"
    ) {
      const list = factorForward.get(edge.from) ?? [];
      list.push(edge.to);
      factorForward.set(edge.from, list);
    }
  }
  // BFS from reachable factors through factor→factor edges
  const queue = [...reachableFactors];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of factorForward.get(current) ?? []) {
      if (!transitivelyReachable.has(next)) {
        transitivelyReachable.add(next);
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if (transitivelyReachable.has(node.id)) continue;

    // This factor is unreachable from options — reclassify as external
    (node as any).category = "external";
    reclassified.push(node.id);
    repairs.push({
      code: "UNREACHABLE_FACTOR_RECLASSIFIED",
      path: `nodes[${node.id}].category`,
      action: `Reclassified unreachable factor "${node.label ?? node.id}" to external`,
    });

    // Strip controllable-only fields when reclassifying to external.
    // After stripping, if `data` can't satisfy any NodeData union branch
    // (OptionData needs `interventions`, ConstraintNodeData needs `operator`,
    // FactorData needs `value`), remove `data` entirely — Node.data is optional.
    const data = (node as any).data;
    if (data) {
      delete data.value;
      delete data.factor_type;
      delete data.uncertainty_drivers;
      // If remaining data has no union-required key, remove the property
      // so DraftGraphOutput.parse() doesn't fail on a partial object.
      if (!("interventions" in data) && !("operator" in data) && !("value" in data)) {
        delete (node as any).data;
      }
    }

    // Check if factor has path to goal
    if (hasPathToGoal(node.id, edges, goalIds)) {
      // Factor is valid as external — has path to goal
      continue;
    }

    // Check if any existing outcome/risk is reachable from this factor
    let wiredToGoal = false;
    for (const edge of edges) {
      if (edge.from === node.id && (nodeKindMap.get(edge.to) === "outcome" || nodeKindMap.get(edge.to) === "risk")) {
        // Factor→outcome/risk edge exists. Check if that outcome/risk reaches goal.
        if (!hasPathToGoal(edge.to, edges, goalIds)) {
          // Wire outcome/risk→goal
          const goalId = [...goalIds][0];
          if (goalId) {
            const newEdge = neutralCausalEdge(format, {
              from: edge.to,
              to: goalId,
              sign: nodeKindMap.get(edge.to) === "risk" ? "negative" : "positive",
            });
            (graph as any).edges.push(newEdge);
            edgesAdded.push(newEdge);
            wiredToGoal = true;
            repairs.push({
              code: "UNREACHABLE_FACTOR_WIRED_TO_GOAL",
              path: `edges[${edge.to}→${goalId}]`,
              action: `Wired ${nodeKindMap.get(edge.to)} "${edge.to}" to goal to connect unreachable factor "${node.id}"`,
            });
          }
        } else {
          wiredToGoal = true;
        }
        break;
      }
    }

    if (wiredToGoal) {
      // Re-check after wiring
      if (hasPathToGoal(node.id, (graph as any).edges, goalIds)) {
        continue;
      }
    }

    // Still no path to goal — mark as droppable but do NOT remove
    markedDroppable.push(node.id);
    repairs.push({
      code: "UNREACHABLE_FACTOR_RETAINED",
      path: `nodes[${node.id}]`,
      action: `External factor "${node.label ?? node.id}" has no path to goal — user should connect or remove`,
    });
  }

  return { reclassified, markedDroppable, repairs, edgesAdded };
}
