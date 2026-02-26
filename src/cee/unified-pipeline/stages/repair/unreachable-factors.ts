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
import { log } from "../../../../utils/telemetry.js";
import { fieldDeletion, type FieldDeletionEvent } from "../../utils/field-deletion-audit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnreachableFactorRepair {
  code: string;
  path: string;
  action: string;
  /** Set when a prior was synthesised from the original data.value during reclassification */
  prior_synthesised?: boolean;
  /** The synthesised prior range (only present when prior_synthesised is true) */
  synthesised_range?: { range_min: number; range_max: number };
}

export interface UnreachableFactorResult {
  reclassified: string[];
  markedDroppable: string[];
  repairs: UnreachableFactorRepair[];
  edgesAdded: EdgeT[];
  fieldDeletions: FieldDeletionEvent[];
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
// Prior synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesise a uniform prior from a known baseline value when reclassifying
 * a factor from observable/controllable to external.
 *
 * Margin calculation:
 *   margin = max(0.1, value * 0.5)
 *   — gives at least ±0.1 spread, or ±50% of the baseline for larger values.
 *
 * Special cases:
 *   - Binary values (exactly 0 or 1): full uncertainty [0.0, 1.0]
 *   - Out-of-domain values (negative or > 1): full uncertainty [0.0, 1.0]
 *     (upstream normalisation should ensure [0,1], but we guard defensively
 *     to avoid inverted range_min > range_max from clamping arithmetic)
 *   - All ranges clamped to [0, 1] since priors are on a normalised scale.
 */
function synthesisePriorFromBaseline(value: number): { range_min: number; range_max: number } {
  // Binary or out-of-domain: full uncertainty
  if (value <= 0 || value >= 1) {
    return { range_min: 0.0, range_max: 1.0 };
  }
  const margin = Math.max(0.1, value * 0.5);
  return {
    range_min: Math.max(0, value - margin),
    range_max: Math.min(1, value + margin),
  };
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
  const deletions: FieldDeletionEvent[] = [];

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

    // Capture original data.value before stripping — needed for prior synthesis.
    const data = (node as any).data;
    const originalValue: number | undefined =
      data && typeof data.value === "number" ? data.value : undefined;

    // Strip controllable-only fields when reclassifying to external.
    // After stripping, if `data` can't satisfy any NodeData union branch
    // (OptionData needs `interventions`, ConstraintNodeData needs `operator`,
    // FactorData needs `value`), remove `data` entirely — Node.data is optional.
    if (data) {
      if (data.value !== undefined) deletions.push(fieldDeletion('unreachable-factors', node.id, 'data.value', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
      delete data.value;
      if (data.factor_type !== undefined) deletions.push(fieldDeletion('unreachable-factors', node.id, 'data.factor_type', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
      delete data.factor_type;
      if (data.uncertainty_drivers !== undefined) deletions.push(fieldDeletion('unreachable-factors', node.id, 'data.uncertainty_drivers', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
      delete data.uncertainty_drivers;
      // If remaining data has no union-required key, remove the property
      // so DraftGraphOutput.parse() doesn't fail on a partial object.
      if (!("interventions" in data) && !("operator" in data) && !("value" in data)) {
        deletions.push(fieldDeletion('unreachable-factors', node.id, 'data', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
        delete (node as any).data;
      }
    }

    // Synthesise a prior from the original baseline value so the reclassified
    // external factor arrives at ISL with a meaningful distribution instead of
    // intercept=0. Without this, any constraint targeting the node evaluates
    // trivially (P=1.0 or P=0.0 depending on operator).
    const repair: UnreachableFactorRepair = {
      code: "UNREACHABLE_FACTOR_RECLASSIFIED",
      path: `nodes[${node.id}].category`,
      action: `Reclassified unreachable factor "${node.label ?? node.id}" to external`,
    };

    if (originalValue !== undefined) {
      const { range_min, range_max } = synthesisePriorFromBaseline(originalValue);
      (node as any).prior = {
        distribution: "uniform",
        range_min,
        range_max,
      };
      repair.prior_synthesised = true;
      repair.synthesised_range = { range_min, range_max };
      repair.action += ` with synthesised prior [${range_min}, ${range_max}]`;

      log.info({
        event: "cee.repair.prior_synthesised_from_baseline",
        node_id: node.id,
        original_value: originalValue,
        range_min,
        range_max,
      }, `Synthesised prior for reclassified factor "${node.id}" from baseline ${originalValue}`);
    }

    repairs.push(repair);

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

  return { reclassified, markedDroppable, repairs, edgesAdded, fieldDeletions: deletions };
}
