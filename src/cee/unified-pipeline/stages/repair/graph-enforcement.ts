/**
 * Stage 4 Substep 8b: Deterministic Graph Enforcement (Commit 1)
 *
 * `applyBudgetRescale` — scales causal inbound edges (factor→outcome/risk)
 * proportionally so Σ|mean| ≤ BUDGET_TARGET (0.95) per node. Goal nodes,
 * factor nodes, structural edges, and bidirected edges are excluded.
 *
 * Subsequent commits add `fixBridgeChaining` and the orchestrator that
 * wires both into the repair pipeline.
 */

import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { log } from "../../../../utils/telemetry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target sum for inbound |mean| after rescale. Headroom for floating-point. */
const BUDGET_TARGET = 0.95;

/** Tolerance for the budget threshold — avoids noisy repairs at sums like 1.00000001
 *  caused by floating-point arithmetic. Set conservatively at 1e-6 (one part per
 *  million); real budget violations exceed 1.0 by 0.05–0.5, so this never masks them. */
const EPSILON = 1e-6;

/** Bridge node kinds that are budget-enforced. */
const ENFORCEABLE_KINDS = new Set(["outcome", "risk"]);

/**
 * Source kinds whose edges to outcome/risk are considered causal and rescalable.
 * - "factor" is the standard causal source.
 * - "action" is treated as an option upstream (sweep maps action→option) so it
 *   would not normally appear as inbound to outcome/risk; included defensively.
 *
 * Excluded by design:
 * - "option"/"decision" — these would be forbidden shortcuts (sweep removes them)
 * - "outcome"/"risk"    — bridge chains (handled by fixBridgeChaining in Commit 2)
 * - "goal"/"constraint" — never causal inbound
 */
const RESCALABLE_SOURCE_KINDS = new Set(["factor", "action"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Repair {
  code: string;
  path: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Edge value readers (format-aware)
// ---------------------------------------------------------------------------

/**
 * Read the edge mean strength.
 * Returns `undefined` for missing/non-finite values — callers must skip
 * those edges and emit telemetry rather than treating as zero.
 */
export function readEdgeMean(edge: EdgeT, format: EdgeFormat): number | undefined {
  const raw = format === "LEGACY"
    ? (edge as Record<string, unknown>).weight
    : edge.strength_mean;

  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

/**
 * Read the edge std. Returns 0 for LEGACY (no std equivalent) or missing values.
 */
export function readEdgeStd(edge: EdgeT, format: EdgeFormat): number {
  if (format === "LEGACY") return 0;
  const raw = edge.strength_std;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return raw;
}

// ---------------------------------------------------------------------------
// Causal-edge predicate
// ---------------------------------------------------------------------------

/**
 * True iff the edge is a causal inbound edge to a budget-enforced node
 * (factor→outcome, factor→risk, action→outcome, action→risk).
 *
 * Bidirected edges are excluded — they are not directed causal edges.
 */
function isRescalableInbound(
  edge: EdgeT,
  fromKind: string | undefined,
  toKind: string | undefined,
): boolean {
  if (!fromKind || !toKind) return false;
  if (!ENFORCEABLE_KINDS.has(toKind)) return false;
  if (!RESCALABLE_SOURCE_KINDS.has(fromKind)) return false;
  if (edge.edge_type === "bidirected") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Budget rescale
// ---------------------------------------------------------------------------

export function applyBudgetRescale(
  graph: GraphT,
  format: EdgeFormat,
  requestId?: string,
): { repairs: Repair[]; nodesRescaled: number; edgesSkipped: number } {
  const repairs: Repair[] = [];
  let nodesRescaled = 0;
  let edgesSkipped = 0;

  const nodes = graph.nodes as NodeT[];
  const edges = graph.edges as EdgeT[];

  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) nodeKindMap.set(node.id, node.kind);

  // Group rescalable inbound edges by target node.
  const byTarget = new Map<string, EdgeT[]>();
  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    if (!isRescalableInbound(edge, fromKind, toKind)) continue;

    const group = byTarget.get(edge.to);
    if (group) group.push(edge);
    else byTarget.set(edge.to, [edge]);
  }

  // Iterate target nodes in deterministic (sorted) order.
  const targetIds = [...byTarget.keys()].sort();

  for (const targetId of targetIds) {
    const group = byTarget.get(targetId)!;
    const kind = nodeKindMap.get(targetId)!;

    // Compute sum of finite |mean|; skip non-finite edges with telemetry.
    let totalAbsMean = 0;
    const finiteEdges: EdgeT[] = [];
    for (const edge of group) {
      const mean = readEdgeMean(edge, format);
      if (mean === undefined) {
        edgesSkipped++;
        log.info({
          event: "cee.draft_graph.enforcement_edge_skipped",
          request_id: requestId,
          edge_from: edge.from,
          edge_to: edge.to,
          reason: "non_finite_strength",
        }, `Enforcement: skipped edge ${edge.from}→${edge.to} (non-finite strength)`);
        continue;
      }
      totalAbsMean += Math.abs(mean);
      finiteEdges.push(edge);
    }

    // Skip if zero sum (would divide by zero) or within budget (with EPSILON tolerance).
    if (totalAbsMean === 0) continue;
    if (totalAbsMean <= 1.0 + EPSILON) continue;

    const scale = BUDGET_TARGET / totalAbsMean;

    for (const edge of finiteEdges) {
      const oldMean = readEdgeMean(edge, format)!;
      const oldStd = readEdgeStd(edge, format);
      const newMean = oldMean * scale;
      const newStd = oldStd * scale;

      if (format === "LEGACY") {
        (edge as Record<string, unknown>).weight = newMean;
      } else {
        edge.strength_mean = newMean;
        edge.strength_std = newStd;
      }
    }

    nodesRescaled++;
    repairs.push({
      code: "INBOUND_BUDGET_RESCALED",
      path: `edges[*→${targetId}]`,
      action: `Rescaled ${finiteEdges.length} causal inbound edges from sum=${totalAbsMean.toFixed(3)} to ${BUDGET_TARGET}`,
    });

    log.info({
      event: "cee.draft_graph.inbound_sum_rescaled",
      request_id: requestId,
      node_id: targetId,
      node_kind: kind,
      original_sum: totalAbsMean,
      scaled_sum: BUDGET_TARGET,
      edge_count: finiteEdges.length,
      edges_affected: finiteEdges.length,
    }, `Rescaled inbound budget for ${kind} "${targetId}": ${totalAbsMean.toFixed(3)} → ${BUDGET_TARGET}`);
  }

  return { repairs, nodesRescaled, edgesSkipped };
}
