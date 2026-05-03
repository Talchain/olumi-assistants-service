/**
 * Stage 4 Substep 9b: Deterministic Graph Enforcement
 *
 * Two deterministic repairs applied AFTER the clarifier (which can replace
 * ctx.graph with a refined graph) and before structural-parse:
 *
 *   1. fixBridgeChaining  — removes forbidden outcome↔risk edges, adds goal bridges
 *                            with sign-correct semantics (outcome→goal +, risk→goal −)
 *   2. applyBudgetRescale — scales causal inbound edges (factor→outcome/risk
 *                            and option→outcome/risk) so Σ|mean| ≤ BUDGET_TARGET
 *
 * After both repairs, runs an authoritative post-enforcement re-validation
 * via graph-validator. The Zod safety net at substep 10 (structural-parse)
 * is downstream of this and validates final shape.
 *
 * Only outcome and risk nodes are budget-enforced. Goal/factor/option/etc
 * are excluded as targets. Only factor/option/action → outcome/risk causal
 * edges are rescaled — structural (option→factor), bridge (outcome/risk→goal),
 * bidirected, and scaffolding edges are excluded.
 *
 * Edge format support: V1_FLAT (strength_mean/strength_std) and LEGACY (weight)
 * are detected at Stage 4 entry and stored in ctx.detectedEdgeFormat. Canonical
 * nested `strength: { mean, std }` is the validation-pipeline shape and is not
 * observed at this stage; if it ever appears, detectEdgeFormat returns "NONE"
 * and edges fall through readEdgeMean as undefined (skipped with telemetry).
 *
 * Gated by CEE_DETERMINISTIC_ENFORCEMENT_ENABLED (default true).
 */

import type { StageContext } from "../../types.js";
import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import { Edge } from "../../../../schemas/graph.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { detectEdgeFormat, patchEdgeNumeric } from "../../utils/edge-format.js";
import { config } from "../../../../config/index.js";
import { log, TelemetryEvents } from "../../../../utils/telemetry.js";
import { validateGraph as validateGraphDeterministic } from "../../../../validators/graph-validator.js";

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
 * - "factor" — standard causal source.
 * - "option"/"action" — option/decision shortcuts. The deterministic sweep tries
 *   to remove these, but optionShortcutRepair is gated and Step 4d auto-fixes
 *   only the subset where the outcome already reaches the goal. Surviving
 *   option→outcome/risk edges are causal and must be budgeted (matches the
 *   brief: "factor→node, option→node").
 *
 * Excluded by design:
 * - "outcome"/"risk"    — bridge chains (fixBridgeChaining removes them)
 * - "goal"/"constraint" — never causal inbound
 * - "decision"          — scaffolding, not causal
 */
const RESCALABLE_SOURCE_KINDS = new Set(["factor", "option", "action"]);

/** Multiplier applied to strongest inbound |mean| when creating a bridge-to-goal edge. */
const BRIDGE_FALLBACK_FACTOR = 0.5;

/** Default mean for orphan bridge edges (no inbound to derive from). */
const ORPHAN_BRIDGE_MEAN = 0.3;
const ORPHAN_BRIDGE_STD = 0.2;
const ORPHAN_BRIDGE_EXISTENCE = 0.7;

/** Default std for derived bridge edges. */
const DERIVED_BRIDGE_STD = 0.15;
const DERIVED_BRIDGE_EXISTENCE = 0.9;

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
 * Read the edge std.
 * Returns `undefined` for LEGACY (no std equivalent), missing, or non-finite values.
 * Callers must only write std back when the return is a positive finite number —
 * writing `0` or `undefined` to `strength_std` violates `z.number().positive()`.
 */
export function readEdgeStd(edge: EdgeT, format: EdgeFormat): number | undefined {
  if (format === "LEGACY") return undefined;
  const raw = edge.strength_std;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
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
          event: TelemetryEvents.CeeEnforcementEdgeSkipped,
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
      const oldStd = readEdgeStd(edge, format); // undefined when missing or LEGACY
      const newMean = oldMean * scale;

      if (format === "LEGACY") {
        (edge as Record<string, unknown>).weight = newMean;
        // LEGACY has no std field — nothing to update
      } else {
        edge.strength_mean = newMean;
        // Only write std back if the original was positive-finite. Writing 0
        // or undefined to strength_std would violate z.number().positive().
        if (oldStd !== undefined) {
          edge.strength_std = oldStd * scale;
        }
      }
    }

    nodesRescaled++;
    repairs.push({
      code: "INBOUND_BUDGET_RESCALED",
      path: `edges[*→${targetId}]`,
      action: `Rescaled ${finiteEdges.length} causal inbound edges from sum=${totalAbsMean.toFixed(3)} to ${BUDGET_TARGET}`,
    });

    log.info({
      event: TelemetryEvents.CeeInboundSumRescaled,
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

// ---------------------------------------------------------------------------
// Bridge chain repair
// ---------------------------------------------------------------------------

interface BridgeAddition {
  nodeId: string;
  nodeKind: string;
}

/**
 * Compute the strength for a new bridge-to-goal edge.
 * Sign is determined ENTIRELY by the bridge node kind:
 *   - outcome → goal: positive
 *   - risk    → goal: negative
 * The magnitude is half the strongest |inbound| mean of the bridge node,
 * or `ORPHAN_BRIDGE_MEAN` if no usable inbound exists.
 */
function computeBridgeMean(
  nodeKind: string,
  inboundEdges: EdgeT[],
  format: EdgeFormat,
): { mean: number; std: number; existence: number } {
  let strongestAbs = 0;
  for (const e of inboundEdges) {
    const m = readEdgeMean(e, format);
    if (m === undefined) continue;
    const abs = Math.abs(m);
    if (abs > strongestAbs) strongestAbs = abs;
  }

  let magnitude: number;
  let std: number;
  let existence: number;

  if (strongestAbs > 0) {
    magnitude = strongestAbs * BRIDGE_FALLBACK_FACTOR;
    std = DERIVED_BRIDGE_STD;
    existence = DERIVED_BRIDGE_EXISTENCE;
  } else {
    magnitude = ORPHAN_BRIDGE_MEAN;
    std = ORPHAN_BRIDGE_STD;
    existence = ORPHAN_BRIDGE_EXISTENCE;
  }

  // Sign is fixed by bridge semantics.
  const mean = nodeKind === "risk" ? -magnitude : magnitude;
  return { mean, std, existence };
}

export function fixBridgeChaining(
  graph: GraphT,
  format: EdgeFormat,
  requestId?: string,
): { repairs: Repair[]; removedCount: number; goalEdgesAdded: number } {
  const repairs: Repair[] = [];
  const nodes = graph.nodes as NodeT[];
  const edges = graph.edges as EdgeT[];

  const goalNode = nodes.find((n) => n.kind === "goal");
  if (!goalNode) return { repairs, removedCount: 0, goalEdgesAdded: 0 };

  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) nodeKindMap.set(node.id, node.kind);

  const existingGoalEdges = new Set<string>();
  for (const edge of edges) {
    if (edge.to === goalNode.id) existingGoalEdges.add(edge.from);
  }

  // PASS 1: identify forbidden bridge-chain edges first so the inbound map
  // we build for fallback magnitude excludes them. Otherwise a node whose
  // only inbound is the forbidden edge being removed would seed its
  // replacement bridge from the very edge we just judged invalid.
  const toRemove = new Set<number>();
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    const isForbiddenChain =
      fromKind !== undefined &&
      toKind !== undefined &&
      ENFORCEABLE_KINDS.has(fromKind) &&
      ENFORCEABLE_KINDS.has(toKind) &&
      edge.to !== goalNode.id;

    if (isForbiddenChain) toRemove.add(i);
  }

  // PASS 2: build inboundByNode excluding forbidden bridge-chain edges.
  const inboundByNode = new Map<string, EdgeT[]>();
  for (let i = 0; i < edges.length; i++) {
    if (toRemove.has(i)) continue;
    const edge = edges[i];
    const group = inboundByNode.get(edge.to);
    if (group) group.push(edge);
    else inboundByNode.set(edge.to, [edge]);
  }

  // PASS 3: emit telemetry and queue goal-bridge additions in stable order.
  const additions: BridgeAddition[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (!toRemove.has(i)) continue;
    const edge = edges[i];
    const fromKind = nodeKindMap.get(edge.from)!;
    const toKind = nodeKindMap.get(edge.to)!;

    repairs.push({
      code: "BRIDGE_CHAIN_REPAIRED",
      path: `edges[${edge.from}→${edge.to}]`,
      action: `Removed forbidden ${fromKind}→${toKind} edge; ensured independent goal bridges`,
    });

    log.info({
      event: TelemetryEvents.CeeBridgeChainRepaired,
      request_id: requestId,
      edge_from: edge.from,
      edge_to: edge.to,
      repair_method: "remove_and_bridge",
    }, `Bridge chain repair: removed ${fromKind}→${toKind} (${edge.from}→${edge.to})`);

    // Queue goal-bridge additions for both endpoints if missing.
    for (const nodeId of [edge.from, edge.to]) {
      if (existingGoalEdges.has(nodeId)) continue;
      existingGoalEdges.add(nodeId); // dedupe across iterations
      additions.push({ nodeId, nodeKind: nodeKindMap.get(nodeId)! });
    }
  }

  // Build new goal-bridge edges deterministically (sorted by source id).
  additions.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const newEdges: EdgeT[] = [];
  for (const { nodeId, nodeKind } of additions) {
    const inbound = inboundByNode.get(nodeId) ?? [];
    const { mean, std, existence } = computeBridgeMean(nodeKind, inbound, format);

    // Build a schema-validated base edge first so any future shape drift
    // surfaces as a parse error rather than silent runtime breakage. Numeric
    // strength fields are then patched in the active edge format (V1_FLAT
    // or LEGACY) by patchEdgeNumeric.
    const baseEdge = Edge.parse({
      id: `${nodeId}__${goalNode.id}__enforcement`,
      from: nodeId,
      to: goalNode.id,
      effect_direction: mean < 0 ? "negative" : "positive",
      origin: "repair",
      provenance: {
        source: "synthetic",
        quote: "Bridge chain repair (deterministic enforcement)",
      },
      provenance_source: "synthetic",
    });

    const goalEdge = patchEdgeNumeric(baseEdge, format, { mean, std, existence });
    newEdges.push(goalEdge);
  }

  if (toRemove.size > 0 || newEdges.length > 0) {
    (graph as { edges: EdgeT[] }).edges = [
      ...edges.filter((_, i) => !toRemove.has(i)),
      ...newEdges,
    ];
  }

  return {
    repairs,
    removedCount: toRemove.size,
    goalEdgesAdded: newEdges.length,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator entry point
// ---------------------------------------------------------------------------

export function applyDeterministicEnforcement(ctx: StageContext): void {
  if (!ctx.graph) return;
  if (!config.cee.deterministicEnforcementEnabled) return;

  const graph = ctx.graph as unknown as GraphT;
  const requestId = ctx.requestId;

  // Re-detect the edge format from the FINAL graph. The clarifier (substep 9)
  // can replace ctx.graph with a refinedGraph whose shape differs from the
  // pre-clarifier graph; using ctx.detectedEdgeFormat (captured at Stage 4
  // entry) would cause readEdgeMean to read the wrong field and silently
  // skip every edge as non-finite. Detected value wins; fall back to the
  // captured format only when detection returns "NONE".
  const liveFormat = detectEdgeFormat(graph.edges as EdgeT[]);
  const capturedFormat: EdgeFormat = ctx.detectedEdgeFormat ?? "V1_FLAT";
  const format: EdgeFormat = liveFormat === "NONE" ? capturedFormat : liveFormat;
  if (liveFormat !== "NONE" && liveFormat !== capturedFormat) {
    log.info({
      request_id: requestId,
      captured_format: capturedFormat,
      live_format: liveFormat,
    }, "Enforcement: edge format changed since Stage 4 entry (likely clarifier refinement); using live format");
  }

  // Order: bridge chain repair first (may add goal edges that affect topology),
  // then budget rescale (rescales causal inbound — bridge edges to goal are
  // excluded by isRescalableInbound, so order is technically independent for
  // budget sums — but bridge-first is the contractual order from the brief).
  const bridgeResult = fixBridgeChaining(graph, format, requestId);
  const budgetResult = applyBudgetRescale(graph, format, requestId);

  // Append repairs deterministically: bridge before budget (matches call order).
  const allRepairs = [...bridgeResult.repairs, ...budgetResult.repairs];
  if (allRepairs.length > 0) {
    ctx.deterministicRepairs = [
      ...(ctx.deterministicRepairs ?? []),
      ...allRepairs,
    ];
  }

  // Authoritative post-enforcement re-validation. Errors here would mean
  // enforcement created an invalid graph — emit telemetry but do not throw
  // (Stage 10 structural-parse remains the final Zod safety net).
  let postValidationErrorCount = 0;
  try {
    const revalidation = validateGraphDeterministic({
      graph: graph as Parameters<typeof validateGraphDeterministic>[0]["graph"],
      requestId,
      phase: "post_enforcement" as Parameters<typeof validateGraphDeterministic>[0]["phase"],
    });
    postValidationErrorCount = revalidation.errors.length;
    if (postValidationErrorCount > 0) {
      log.warn({
        event: TelemetryEvents.CeeEnforcementPostValidationErrors,
        request_id: requestId,
        error_count: postValidationErrorCount,
        codes: revalidation.errors.map((e) => e.code),
      }, `Post-enforcement validation surfaced ${postValidationErrorCount} errors`);
    }
  } catch (err) {
    log.warn({
      event: TelemetryEvents.CeeEnforcementPostValidationFailed,
      request_id: requestId,
      err: (err as Error)?.message,
    }, "Post-enforcement validation threw — non-fatal");
  }

  ctx.repairTrace = {
    ...(ctx.repairTrace ?? {}),
    deterministic_enforcement: {
      ran: true,
      bridge_chains_removed: bridgeResult.removedCount,
      bridge_goal_edges_added: bridgeResult.goalEdgesAdded,
      nodes_rescaled: budgetResult.nodesRescaled,
      edges_skipped_non_finite: budgetResult.edgesSkipped,
      total_repairs: allRepairs.length,
      post_validation_error_count: postValidationErrorCount,
    },
  };

  // Brief specifies "Clean graph (no violations) → no-op, no telemetry".
  // We honour the spirit by suppressing per-repair events when nothing fires
  // (those have early `continue`s) and demoting the SUMMARY heartbeat to debug
  // when there were zero repairs. info-level summary only when work happened.
  const totalRepairs = allRepairs.length;
  const summaryPayload = {
    event: TelemetryEvents.CeeEnforcementCompleted,
    request_id: requestId,
    bridge_chains_removed: bridgeResult.removedCount,
    goal_edges_added: bridgeResult.goalEdgesAdded,
    nodes_rescaled: budgetResult.nodesRescaled,
    edges_skipped: budgetResult.edgesSkipped,
    post_validation_errors: postValidationErrorCount,
    edge_format: format,
    total_repairs: totalRepairs,
  };
  if (totalRepairs > 0 || postValidationErrorCount > 0) {
    log.info(summaryPayload, "Deterministic graph enforcement completed");
  } else {
    log.debug(summaryPayload, "Deterministic graph enforcement no-op");
  }
}
