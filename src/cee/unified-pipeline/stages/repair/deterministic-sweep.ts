/**
 * Deterministic Pre-Repair Sweep
 *
 * Runs after orchestrator validation (substep 1) and before PLoT validation
 * (substep 2). Resolves mechanical violations deterministically, handles
 * unreachable factors, and fixes status quo connectivity.
 *
 * Violation routing:
 * - Bucket A: Always auto-fix (NAN_VALUE, SIGN_MISMATCH, STRUCTURAL_EDGE_NOT_CANONICAL_ERROR, etc.)
 * - Bucket B: Fix only when specific violation is cited (CATEGORY_MISMATCH, data completeness)
 * - Bucket C: Semantic, LLM-only (NO_PATH_TO_GOAL, CYCLE_DETECTED, etc.)
 */

import type { StageContext } from "../../types.js";
import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import type { ValidationIssue } from "../../../../validators/graph-validator.types.js";
import { validateGraph as validateGraphDeterministic } from "../../../../validators/graph-validator.js";
import { detectEdgeFormat, canonicalStructuralEdge } from "../../utils/edge-format.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { handleUnreachableFactors } from "./unreachable-factors.js";
import { fixStatusQuoConnectivity, findDisconnectedOptions } from "./status-quo-fix.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../../constants/versions.js";
import { log } from "../../../../utils/telemetry.js";

// ---------------------------------------------------------------------------
// Bucket classification (SSOT)
// ---------------------------------------------------------------------------

/** Bucket A: always auto-fix before LLM */
const BUCKET_A_CODES = new Set([
  "NAN_VALUE",
  "SIGN_MISMATCH",
  "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
  "INVALID_EDGE_REF",
  "GOAL_HAS_OUTGOING",
  "DECISION_HAS_INCOMING",
  "NODE_LIMIT_EXCEEDED",   // Unfixable here; passes through for upstream handling
  "EDGE_LIMIT_EXCEEDED",   // Unfixable here; passes through for upstream handling
]);

/** Bucket B: deterministic, only when specific violation is cited */
const BUCKET_B_CODES = new Set([
  "CATEGORY_MISMATCH",
  "CONTROLLABLE_MISSING_DATA",
  "OBSERVABLE_MISSING_DATA",
  "OBSERVABLE_EXTRA_DATA",
  "EXTERNAL_HAS_DATA",
]);

/** Bucket C: semantic, LLM only — we identify these to decide llmRepairNeeded */
const BUCKET_C_CODES = new Set([
  "NO_PATH_TO_GOAL",
  "NO_EFFECT_PATH",
  "UNREACHABLE_FROM_DECISION",
  "MISSING_BRIDGE",
  "MISSING_GOAL",
  "MISSING_DECISION",
  "INVALID_EDGE_TYPE",
  "CYCLE_DETECTED",
  "OPTIONS_IDENTICAL",
  "GOAL_NUMBER_AS_FACTOR",
  "INSUFFICIENT_OPTIONS",
  "INVALID_INTERVENTION_REF",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Repair {
  code: string;
  path: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Bucket A fixes
// ---------------------------------------------------------------------------

function fixNanValues(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const nanViolations = violations.filter((v) => v.code === "NAN_VALUE");
  if (nanViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Fix NaN in edges
  for (const edge of edges) {
    if (edge.strength_mean !== undefined && (Number.isNaN(edge.strength_mean) || !Number.isFinite(edge.strength_mean))) {
      const old = edge.strength_mean;
      edge.strength_mean = 0.5;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].strength_mean`, action: `Replaced ${old} with 0.5` });
    }
    if (edge.strength_std !== undefined && (Number.isNaN(edge.strength_std) || !Number.isFinite(edge.strength_std))) {
      const old = edge.strength_std;
      edge.strength_std = 0.1;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].strength_std`, action: `Replaced ${old} with 0.1` });
    }
    if (edge.belief_exists !== undefined && (Number.isNaN(edge.belief_exists) || !Number.isFinite(edge.belief_exists))) {
      const old = edge.belief_exists;
      edge.belief_exists = 0.8;
      repairs.push({ code: "NAN_VALUE", path: `edges[${edge.from}→${edge.to}].belief_exists`, action: `Replaced ${old} with 0.8` });
    }
  }

  // Fix NaN in factor node data
  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const data = (node as any).data;
    if (data && typeof data.value === "number" && (Number.isNaN(data.value) || !Number.isFinite(data.value))) {
      const old = data.value;
      data.value = 0.5;
      repairs.push({ code: "NAN_VALUE", path: `nodes[${node.id}].data.value`, action: `Replaced ${old} with 0.5` });
    }
  }

  return repairs;
}

function fixSignMismatch(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const signViolations = violations.filter((v) => v.code === "SIGN_MISMATCH");
  if (signViolations.length === 0) return repairs;

  const edges = (graph as any).edges as EdgeT[];

  // Fix all edges that have actual sign mismatches (direction contradicts mean sign)
  for (const edge of edges) {
    if (!edge.effect_direction || edge.strength_mean === undefined) continue;

    const isNegativeDirection = edge.effect_direction === "negative";
    const isMeanPositive = edge.strength_mean > 0;
    const isMeanNegative = edge.strength_mean < 0;

    if ((isNegativeDirection && isMeanPositive) || (!isNegativeDirection && isMeanNegative)) {
      const old = edge.strength_mean;
      edge.strength_mean = -edge.strength_mean;
      repairs.push({
        code: "SIGN_MISMATCH",
        path: `edges[${edge.from}→${edge.to}].strength_mean`,
        action: `Flipped mean from ${old} to ${edge.strength_mean} to match effect_direction="${edge.effect_direction}"`,
      });
    }
  }

  return repairs;
}

function fixStructuralEdgesNotCanonical(
  graph: GraphT,
  violations: ValidationIssue[],
  format: EdgeFormat,
): Repair[] {
  const repairs: Repair[] = [];
  const canonViolations = violations.filter((v) => v.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
  if (canonViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (nodeKindMap.get(edge.from) !== "option" || nodeKindMap.get(edge.to) !== "factor") continue;

    // Only canonicalise if not already canonical (format-aware check)
    const isCanonical = format === "LEGACY"
      ? (edge as Record<string, unknown>).weight === 1 && (edge as Record<string, unknown>).belief === 1
      : edge.strength_mean === 1 && edge.strength_std === 0.01 && edge.belief_exists === 1;

    if (!isCanonical) {
      // Check if this specific edge was cited by a violation
      const isCited = canonViolations.some((v) =>
        v.path && (
          v.path.includes(edge.from) ||
          v.path.includes(edge.to) ||
          (edge.id && v.path.includes(edge.id)) ||
          v.path.includes(`edges[${i}]`)
        ),
      );

      if (isCited) {
        edges[i] = canonicalStructuralEdge(edge, format);
        repairs.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
          path: `edges[${edge.from}→${edge.to}]`,
          action: `Canonicalised structural edge to mean=1, std=0.01, existence=1.0`,
        });
      }
    }
  }

  return repairs;
}

function fixInvalidEdgeRefs(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const refViolations = violations.filter((v) => v.code === "INVALID_EDGE_REF");
  if (refViolations.length === 0) return repairs;

  const nodeIds = new Set<string>(((graph as any).nodes as NodeT[]).map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      repairs.push({
        code: "INVALID_EDGE_REF",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed edge referencing non-existent node(s)`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

function fixGoalHasOutgoing(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const goalViolations = violations.filter((v) => v.code === "GOAL_HAS_OUTGOING");
  if (goalViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const goalIds = new Set(nodes.filter((n) => n.kind === "goal").map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (goalIds.has(edge.from)) {
      repairs.push({
        code: "GOAL_HAS_OUTGOING",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed outgoing edge from goal node`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

function fixDecisionHasIncoming(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const decViolations = violations.filter((v) => v.code === "DECISION_HAS_INCOMING");
  if (decViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const decisionIds = new Set(nodes.filter((n) => n.kind === "decision").map((n) => n.id));
  const edges = (graph as any).edges as EdgeT[];

  const validEdges: EdgeT[] = [];
  for (const edge of edges) {
    if (decisionIds.has(edge.to)) {
      repairs.push({
        code: "DECISION_HAS_INCOMING",
        path: `edges[${edge.from}→${edge.to}]`,
        action: `Removed incoming edge to decision node`,
      });
    } else {
      validEdges.push(edge);
    }
  }

  (graph as any).edges = validEdges;
  return repairs;
}

// ---------------------------------------------------------------------------
// Bucket B fixes
// ---------------------------------------------------------------------------

function fixCategoryMismatch(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const catViolations = violations.filter((v) => v.code === "CATEGORY_MISMATCH");
  if (catViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Build option→factor adjacency
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  const hasOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
      hasOptionEdge.add(edge.to);
    }
  }

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const inferred = hasOptionEdge.has(node.id) ? "controllable" : "external";
    if ((node as any).category !== inferred) {
      const old = (node as any).category;
      (node as any).category = inferred;
      repairs.push({
        code: "CATEGORY_MISMATCH",
        path: `nodes[${node.id}].category`,
        action: `Structure-inferred category from "${old}" to "${inferred}"`,
      });
    }
  }

  return repairs;
}

function fixControllableMissingData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "CONTROLLABLE_MISSING_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "controllable") continue;

    const data = (node as any).data ?? {};
    let changed = false;

    if (data.value === undefined) {
      data.value = 0.5;
      changed = true;
    }
    if (data.extractionType === undefined) {
      data.extractionType = "inferred";
      changed = true;
    }
    if (data.factor_type === undefined) {
      data.factor_type = "other";
      changed = true;
    }
    if (data.uncertainty_drivers === undefined) {
      data.uncertainty_drivers = ["Not provided"];
      changed = true;
    }

    if (changed) {
      (node as any).data = data;
      repairs.push({
        code: "CONTROLLABLE_MISSING_DATA",
        path: `nodes[${node.id}].data`,
        action: `Populated missing required fields with defaults`,
      });
    }
  }

  return repairs;
}

function fixObservableMissingData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "OBSERVABLE_MISSING_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "observable") continue;

    let changed = false;

    if (!(node as any).observed_state || (node as any).observed_state.value === undefined) {
      (node as any).observed_state = {
        ...((node as any).observed_state ?? {}),
        value: 0.5,
      };
      changed = true;
    }

    // Only add extractionType to data if data already has a union-satisfying key
    // (FactorData requires `value`). Creating data={extractionType:"observed"} alone
    // would fail the NodeData union validation in DraftGraphOutput.parse().
    const data = (node as any).data;
    if (data && data.value !== undefined && data.extractionType === undefined) {
      data.extractionType = "observed";
      changed = true;
    }

    if (changed) {
      repairs.push({
        code: "OBSERVABLE_MISSING_DATA",
        path: `nodes[${node.id}]`,
        action: `Added observed_state.value=0.5 and extractionType="observed"`,
      });
    }
  }

  return repairs;
}

function fixObservableExtraData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "OBSERVABLE_EXTRA_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "observable") continue;

    const data = (node as any).data;
    if (!data) continue;

    let changed = false;
    if (data.factor_type !== undefined) {
      delete data.factor_type;
      changed = true;
    }
    if (data.uncertainty_drivers !== undefined) {
      delete data.uncertainty_drivers;
      changed = true;
    }

    if (changed) {
      repairs.push({
        code: "OBSERVABLE_EXTRA_DATA",
        path: `nodes[${node.id}].data`,
        action: `Removed factor_type and uncertainty_drivers (extra for observable)`,
      });
    }
  }

  return repairs;
}

function fixExternalHasData(
  graph: GraphT,
  violations: ValidationIssue[],
): Repair[] {
  const repairs: Repair[] = [];
  const dataViolations = violations.filter((v) => v.code === "EXTERNAL_HAS_DATA");
  if (dataViolations.length === 0) return repairs;

  const nodes = (graph as any).nodes as NodeT[];

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if ((node as any).category !== "external") continue;

    const data = (node as any).data;
    if (!data) continue;

    let changed = false;
    if (data.value !== undefined) {
      delete data.value;
      changed = true;
    }
    if (data.factor_type !== undefined) {
      delete data.factor_type;
      changed = true;
    }
    if (data.uncertainty_drivers !== undefined) {
      delete data.uncertainty_drivers;
      changed = true;
    }
    // After stripping, if `data` can't satisfy any NodeData union branch,
    // remove it entirely — Node.data is optional in the schema.
    if (changed && !("interventions" in data) && !("operator" in data) && !("value" in data)) {
      delete (node as any).data;
    }

    if (changed) {
      repairs.push({
        code: "EXTERNAL_HAS_DATA",
        path: `nodes[${node.id}].data`,
        action: `Removed value, factor_type, uncertainty_drivers (prohibited for external). Preserved extractionType.`,
      });
    }
  }

  return repairs;
}

// ---------------------------------------------------------------------------
// Main sweep
// ---------------------------------------------------------------------------

/**
 * Run the deterministic pre-repair sweep.
 *
 * 1. Capture before-counts for observability
 * 2. Collect validation errors from graph-validator
 * 3. Detect edge format
 * 4. Partition into Bucket A, B, C
 * 5. Apply Bucket A fixes
 * 6. Apply Bucket B fixes (only for cited codes)
 * 7. Unreachable factor handling
 * 8. Status quo fix
 * 9. Re-validate
 * 10. Oscillation guard
 * 11. Write results to ctx
 */
export async function runDeterministicSweep(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  const graph = ctx.graph as GraphT;
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  // Step 1: Capture before-counts
  const nodesBefore = nodes.length;
  const edgesBefore = edges.length;

  // Step 2: Detect edge format once (needed by all downstream steps)
  const format = detectEdgeFormat(edges);
  ctx.detectedEdgeFormat = format;

  // Step 3: Collect validation errors using the graph-validator
  const validationResult = validateGraphDeterministic({ graph, requestId: ctx.requestId });
  const allViolations = validationResult.errors;

  const allRepairs: Repair[] = [];

  // Hoist bucket counts so they are available for repairTrace regardless of violations
  let bucketACount = 0;
  let bucketBCount = 0;
  let bucketCCount = 0;

  // Step 4: Apply Bucket A/B fixes when violations exist
  if (allViolations.length > 0) {
    // Partition into buckets
    const bucketA = allViolations.filter((v) => BUCKET_A_CODES.has(v.code));
    const bucketB = allViolations.filter((v) => BUCKET_B_CODES.has(v.code));
    const bucketC = allViolations.filter((v) => BUCKET_C_CODES.has(v.code));
    bucketACount = bucketA.length;
    bucketBCount = bucketB.length;
    bucketCCount = bucketC.length;
    const citedBCodes = new Set(bucketB.map((v) => v.code));

    log.info({
      requestId: ctx.requestId,
      stage: "deterministic_sweep",
      violations_total: allViolations.length,
      bucket_a: bucketACount,
      bucket_b: bucketBCount,
      bucket_c: bucketCCount,
      bucket_a_codes: [...new Set(bucketA.map((v) => v.code))],
      bucket_b_codes: [...citedBCodes],
      bucket_c_codes: [...new Set(bucketC.map((v) => v.code))],
    }, "Deterministic sweep: violation routing");

    // Apply Bucket A in single pass
    allRepairs.push(...fixNanValues(graph, bucketA));
    allRepairs.push(...fixSignMismatch(graph, bucketA));
    allRepairs.push(...fixStructuralEdgesNotCanonical(graph, bucketA, format));
    allRepairs.push(...fixInvalidEdgeRefs(graph, bucketA));
    allRepairs.push(...fixGoalHasOutgoing(graph, bucketA));
    allRepairs.push(...fixDecisionHasIncoming(graph, bucketA));

    // Apply Bucket B only for codes present in violations
    if (citedBCodes.has("CATEGORY_MISMATCH")) {
      allRepairs.push(...fixCategoryMismatch(graph, bucketB));
    }
    if (citedBCodes.has("CONTROLLABLE_MISSING_DATA")) {
      allRepairs.push(...fixControllableMissingData(graph, bucketB));
    }
    if (citedBCodes.has("OBSERVABLE_MISSING_DATA")) {
      allRepairs.push(...fixObservableMissingData(graph, bucketB));
    }
    if (citedBCodes.has("OBSERVABLE_EXTRA_DATA")) {
      allRepairs.push(...fixObservableExtraData(graph, bucketB));
    }
    if (citedBCodes.has("EXTERNAL_HAS_DATA")) {
      allRepairs.push(...fixExternalHasData(graph, bucketB));
    }
  }

  // Step 5: Proactive unreachable factor handling — ALWAYS run regardless of violations.
  // simpleRepair (Stage 3) preserves unreachable factors but doesn't reclassify them.
  // The sweep must detect and reclassify them so model_adjustments gets populated.
  const unreachableResult = handleUnreachableFactors(graph, format);
  allRepairs.push(...unreachableResult.repairs);

  // Step 6: Status quo / disconnected option fix — ALWAYS run.
  // Uses proactive reachability check (BFS from each option to goal).
  // This catches cases where the graph validator doesn't flag NO_PATH_TO_GOAL
  // but the orchestrator validation loop would later (causing 422s).
  const disconnectedBefore = findDisconnectedOptions(graph);
  const violationCodes = allViolations.map((v) => ({ code: v.code }));

  // If we proactively found disconnected options, synthesize violations to trigger the fix
  if (disconnectedBefore.length > 0 && !violationCodes.some((v) => v.code === "NO_PATH_TO_GOAL")) {
    violationCodes.push({ code: "NO_PATH_TO_GOAL" });
  }

  const statusQuoResult = fixStatusQuoConnectivity(graph, violationCodes, format);
  allRepairs.push(...statusQuoResult.repairs);

  // Step 7: Re-validate using same validator
  const revalidation = validateGraphDeterministic({ graph, requestId: ctx.requestId });
  const remainingErrors = revalidation.errors;

  // Step 8: Proactive disconnected-option check after all fixes.
  // If options are still disconnected after the status quo fix, flag for LLM repair.
  const disconnectedAfter = findDisconnectedOptions(graph);
  let proactiveDisconnected = false;
  if (disconnectedAfter.length > 0) {
    proactiveDisconnected = true;
    // Add synthetic remaining violations for disconnected options not already flagged
    const existingPaths = new Set(remainingErrors.filter((v) => v.code === "NO_PATH_TO_GOAL").map((v) => v.path));
    for (const optId of disconnectedAfter) {
      const path = `nodes[${optId}]`;
      if (!existingPaths.has(path)) {
        remainingErrors.push({
          code: "NO_PATH_TO_GOAL" as any,
          severity: "error" as any,
          message: `Option "${optId}" has no directed path to goal (proactive check)`,
          path,
        });
      }
    }
  }

  // Determine if LLM repair is needed
  const remainingBucketC = remainingErrors.filter((v) => BUCKET_C_CODES.has(v.code));
  const externalValidationNeeded = !revalidation.valid || proactiveDisconnected;
  const llmRepairNeeded = remainingBucketC.length > 0 && externalValidationNeeded;

  // Step 9: Write to ctx
  ctx.deterministicRepairs = allRepairs;
  ctx.remainingViolations = remainingErrors.map((v) => ({
    code: v.code,
    path: v.path,
    message: v.message,
  }));
  ctx.llmRepairNeeded = llmRepairNeeded;

  // Store unreachable factor and status quo results on repairTrace for observability.
  // Always emitted — proves the sweep executed regardless of whether it had work to do.
  ctx.repairTrace = {
    ...(ctx.repairTrace ?? {}),
    deterministic_sweep: {
      sweep_ran: true,
      sweep_version: DETERMINISTIC_SWEEP_VERSION,
      bucket_summary: { a: bucketACount, b: bucketBCount, c: bucketCCount },
      repairs_count: allRepairs.length,
      unreachable_factors: {
        reclassified: unreachableResult.reclassified,
        marked_droppable: unreachableResult.markedDroppable,
      },
      status_quo: {
        fixed: statusQuoResult.fixed,
        marked_droppable: statusQuoResult.markedDroppable,
      },
      disconnected_options_before: disconnectedBefore,
      disconnected_options_after: disconnectedAfter,
      violations_before: allViolations.length,
      violations_after: remainingErrors.length,
      llm_repair_needed: llmRepairNeeded,
      edge_format: format,
      graph_delta: {
        nodes_before: nodesBefore,
        nodes_after: ((graph as any).nodes as NodeT[]).length,
        edges_before: edgesBefore,
        edges_after: ((graph as any).edges as EdgeT[]).length,
      },
    },
  };

  log.info({
    requestId: ctx.requestId,
    stage: "deterministic_sweep",
    repairs_count: allRepairs.length,
    violations_before: allViolations.length,
    violations_after: remainingErrors.length,
    llm_repair_needed: llmRepairNeeded,
    unreachable_reclassified: unreachableResult.reclassified.length,
    unreachable_droppable: unreachableResult.markedDroppable.length,
    status_quo_fixed: statusQuoResult.fixed,
    disconnected_before: disconnectedBefore.length,
    disconnected_after: disconnectedAfter.length,
    edge_format: format,
  }, "Deterministic sweep complete");
}
