/**
 * Graph Data Integrity — Post-V3-Transform Corrections
 *
 * Runs in Stage 6 (Boundary), after transformResponseToV3(), before V3 schema validation.
 * Applies deterministic corrections to two known data quality issues:
 *
 * 1. Factor scale inconsistency:
 *    When a factor has both raw_value and cap in observed_state, value must equal
 *    raw_value / cap (within 5% tolerance). If inconsistent, recompute value and log.
 *    Special case: percentage factors (unit: "%") use raw_value / 100.
 *    Apply the same correction to analysis_ready.options interventions for the affected factor.
 *
 * 2. Missing edge fields:
 *    exists_probability and effect_direction must be present on every edge.
 *    Structural edges (decision→option, option→factor): default to 1.0 / "positive".
 *    Causal edges: default to 0.8 / derive from strength.mean sign.
 *    Log every default applied.
 *
 * Root cause commentary:
 *   Issue 1: The LLM emits raw_value:49 and cap:59 but encodes value:0.49
 *   (£49/£100 division) instead of value=49/59≈0.831. CEE has no consistency
 *   check, so the contradiction passes through to PLoT uncorrected.
 *
 *   Issue 2: V4 edges may not emit belief_exists/belief or effect_direction.
 *   transformEdgeToV3() defaults belief_exists to 0.5, which conflicts with
 *   PLoT's normaliser default of 0.8 for structural edges (should be 1.0).
 *   This fix surfaces the defaulting in CEE's repair_summary instead of
 *   silently happening in PLoT's normaliser.
 */

import { log } from "../../utils/telemetry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaleConsistencyRepair {
  node_id: string;
  field: string;
  before: number;
  after: number;
  raw_value: number;
  cap: number;
  reason: string;
}

export interface EdgeFieldRepair {
  from: string;
  to: string;
  field: "exists_probability" | "effect_direction";
  before: unknown;
  after: unknown;
  edge_class: "structural" | "causal";
  reason: string;
}

export interface IntegrityRepairSummary {
  scale_consistency_repairs: ScaleConsistencyRepair[];
  edge_field_repairs: EdgeFieldRepair[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tolerance for float comparison: ±5% relative error. */
const SCALE_TOLERANCE = 0.05;

/** Default exists_probability for structural edges (decision→option, option→factor). */
const STRUCTURAL_EXISTS_PROBABILITY = 1.0;

/** Default exists_probability for causal (factor→factor, factor→goal) edges. */
const CAUSAL_EXISTS_PROBABILITY = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNodeKindMap(nodes: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    if (node?.id && node?.kind) {
      map.set(node.id, node.kind);
    }
  }
  return map;
}

function isStructuralEdge(fromKind: string | undefined, toKind: string | undefined): boolean {
  // decision→option or option→factor are structural (hard structural constraints)
  if (fromKind === "decision" && toKind === "option") return true;
  if (fromKind === "option" && (toKind === "factor" || toKind === "outcome" || toKind === "risk")) return true;
  return false;
}

function isWithinTolerance(a: number, b: number): boolean {
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs(a - b) / Math.abs(b) <= SCALE_TOLERANCE;
}

/**
 * Should we skip the scale consistency check for a given factor?
 * Skip conditions (per brief):
 * - No raw_value or no cap → qualitative 0-1 factor
 * - Binary factor: cap=1 and raw_value is 0 or 1
 * - Small count factor: raw_value ≤ 10 and no cap → small counts
 */
function shouldSkipScaleCheck(observed_state: any): boolean {
  const { raw_value, cap, unit } = observed_state ?? {};

  if (raw_value === undefined || raw_value === null) return true;
  if (cap === undefined || cap === null) return true;

  // Skip binary factors (cap = 1, raw_value is 0 or 1)
  if (cap === 1 && (raw_value === 0 || raw_value === 1)) return true;

  // Percentage factor: cap should be 100 (raw_value in 0-100, value in 0-1)
  // We do NOT skip these — they are the test case we must validate.
  // Validation: value ≈ raw_value / 100.
  void unit; // unit is used in the caller to determine the divisor

  return false;
}

/**
 * Compute the expected normalised value from raw_value, cap, and unit.
 * For percentage factors (unit: "%"): divisor = 100.
 * For all others: divisor = cap.
 */
function computeExpectedValue(raw_value: number, cap: number, unit?: string): number {
  const divisor = unit === "%" ? 100 : cap;
  return raw_value / divisor;
}

// ---------------------------------------------------------------------------
// Task 1: Factor scale consistency
// ---------------------------------------------------------------------------

/**
 * Check and repair factor observed_state.value against raw_value and cap.
 * Also repairs the corresponding analysis_ready.options intervention values.
 *
 * Mutates v3Body.nodes and v3Body.analysis_ready.options in place.
 * Returns a list of corrections applied.
 */
function repairFactorScaleConsistency(v3Body: any, requestId?: string): ScaleConsistencyRepair[] {
  const repairs: ScaleConsistencyRepair[] = [];

  const nodes: any[] = Array.isArray(v3Body?.nodes) ? v3Body.nodes : [];
  const analysisOptions: any[] = Array.isArray(v3Body?.analysis_ready?.options)
    ? v3Body.analysis_ready.options
    : [];

  // Build a map of factorId → correction factor for updating interventions later
  const factorCorrectionMap = new Map<string, number>(); // factorId → corrected value

  for (const node of nodes) {
    if (node?.kind !== "factor") continue;

    const observed = node?.observed_state;
    if (!observed) continue;

    if (shouldSkipScaleCheck(observed)) continue;

    const { raw_value, cap, value, unit } = observed;

    // Validate types
    if (typeof raw_value !== "number" || typeof cap !== "number" || typeof value !== "number") continue;
    if (cap <= 0) continue;

    const expected = computeExpectedValue(raw_value, cap, unit);

    if (isWithinTolerance(value, expected)) continue;

    // Inconsistency detected — recompute
    const corrected = Number(expected.toFixed(6));
    const repair: ScaleConsistencyRepair = {
      node_id: node.id,
      field: "observed_state.value",
      before: value,
      after: corrected,
      raw_value,
      cap,
      reason: unit === "%"
        ? `value ${value} inconsistent with raw_value/100 = ${expected.toFixed(4)} (raw_value:${raw_value}, unit:"%")`
        : `value ${value} inconsistent with raw_value/cap = ${expected.toFixed(4)} (raw_value:${raw_value}, cap:${cap})`,
    };

    // Apply correction to node
    node.observed_state = { ...observed, value: corrected };
    factorCorrectionMap.set(node.id, corrected);
    repairs.push(repair);

    log.info({
      event: "cee.graph_integrity.scale_corrected",
      request_id: requestId,
      node_id: node.id,
      before: value,
      after: corrected,
      raw_value,
      cap,
      unit: unit ?? "none",
    }, `[graph-data-integrity] Factor scale corrected: ${node.id}`);
  }

  // Repair analysis_ready intervention values for corrected factors.
  // The intervention value for a factor represents the target value under each option.
  // If the factor's baseline value was wrong, option interventions that matched it
  // (e.g. status-quo option) may also be wrong.
  //
  // Conservative approach: only correct option interventions that are numerically
  // close to the WRONG baseline value (within 5% tolerance), meaning they were
  // likely copied directly from the uncorrected baseline.
  for (const option of analysisOptions) {
    const interventions: Record<string, number> = option?.interventions ?? {};
    for (const [factorId, interventionValue] of Object.entries(interventions)) {
      const correctedBaseline = factorCorrectionMap.get(factorId);
      if (correctedBaseline === undefined) continue;

      // Look up the original (wrong) value for this factor
      const factorNode = nodes.find((n: any) => n.id === factorId);
      const originalValue = repairs.find((r) => r.node_id === factorId)?.before;
      if (originalValue === undefined || factorNode === undefined) continue;

      // Only correct if the intervention value matches the wrong baseline closely
      if (!isWithinTolerance(interventionValue as number, originalValue)) continue;

      const correctedIntervention = correctedBaseline;
      interventions[factorId] = correctedIntervention;
      option.interventions = interventions;

      repairs.push({
        node_id: `option:${option.id}`,
        field: `interventions.${factorId}`,
        before: interventionValue as number,
        after: correctedIntervention,
        raw_value: repairs.find((r) => r.node_id === factorId)!.raw_value,
        cap: repairs.find((r) => r.node_id === factorId)!.cap,
        reason: `option intervention corrected to match factor scale correction`,
      });

      log.info({
        event: "cee.graph_integrity.intervention_corrected",
        request_id: requestId,
        option_id: option.id,
        factor_id: factorId,
        before: interventionValue,
        after: correctedIntervention,
      }, `[graph-data-integrity] Option intervention corrected: ${option.id}.${factorId}`);
    }
  }

  return repairs;
}

// ---------------------------------------------------------------------------
// Task 2: Missing edge fields
// ---------------------------------------------------------------------------

/**
 * Ensure all V3 edges have exists_probability and effect_direction.
 * Structural edges: default to 1.0 / "positive".
 * Causal edges: default to CAUSAL_EXISTS_PROBABILITY / derive from strength.mean.
 *
 * Mutates v3Body.edges in place.
 * Returns a list of field repairs applied.
 */
function repairEdgeFields(v3Body: any, requestId?: string): EdgeFieldRepair[] {
  const repairs: EdgeFieldRepair[] = [];

  const nodes: any[] = Array.isArray(v3Body?.nodes) ? v3Body.nodes : [];
  const edges: any[] = Array.isArray(v3Body?.edges) ? v3Body.edges : [];

  const nodeKindMap = buildNodeKindMap(nodes);

  for (const edge of edges) {
    if (!edge) continue;

    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    const structural = isStructuralEdge(fromKind, toKind);
    const edgeClass: "structural" | "causal" = structural ? "structural" : "causal";

    // --- exists_probability ---
    if (edge.exists_probability === undefined || edge.exists_probability === null) {
      const defaultProb = structural ? STRUCTURAL_EXISTS_PROBABILITY : CAUSAL_EXISTS_PROBABILITY;
      repairs.push({
        from: edge.from,
        to: edge.to,
        field: "exists_probability",
        before: edge.exists_probability,
        after: defaultProb,
        edge_class: edgeClass,
        reason: structural
          ? `structural edge (${fromKind}→${toKind}) requires exists_probability:1.0`
          : `causal edge missing exists_probability; defaulted to ${CAUSAL_EXISTS_PROBABILITY}`,
      });
      edge.exists_probability = defaultProb;

      log.info({
        event: "cee.graph_integrity.edge_exists_probability_defaulted",
        request_id: requestId,
        from: edge.from,
        to: edge.to,
        edge_class: edgeClass,
        value: defaultProb,
      }, `[graph-data-integrity] exists_probability defaulted for ${edge.from}→${edge.to}`);
    } else if (structural && edge.exists_probability < STRUCTURAL_EXISTS_PROBABILITY) {
      // Structural edges must be 1.0 — correct if below
      const before = edge.exists_probability;
      repairs.push({
        from: edge.from,
        to: edge.to,
        field: "exists_probability",
        before,
        after: STRUCTURAL_EXISTS_PROBABILITY,
        edge_class: edgeClass,
        reason: `structural edge (${fromKind}→${toKind}) corrected from ${before} to 1.0`,
      });
      edge.exists_probability = STRUCTURAL_EXISTS_PROBABILITY;

      log.info({
        event: "cee.graph_integrity.structural_edge_corrected",
        request_id: requestId,
        from: edge.from,
        to: edge.to,
        before,
        after: STRUCTURAL_EXISTS_PROBABILITY,
      }, `[graph-data-integrity] Structural edge exists_probability corrected: ${edge.from}→${edge.to}`);
    }

    // --- effect_direction ---
    if (edge.effect_direction === undefined || edge.effect_direction === null) {
      let defaultDirection: "positive" | "negative";

      if (structural) {
        defaultDirection = "positive";
      } else {
        // Infer from strength.mean sign
        const strengthMean = edge.strength?.mean;
        defaultDirection = typeof strengthMean === "number" && strengthMean < 0 ? "negative" : "positive";
      }

      repairs.push({
        from: edge.from,
        to: edge.to,
        field: "effect_direction",
        before: edge.effect_direction,
        after: defaultDirection,
        edge_class: edgeClass,
        reason: structural
          ? `structural edge (${fromKind}→${toKind}) requires effect_direction:"positive"`
          : `causal edge missing effect_direction; inferred "${defaultDirection}" from strength.mean`,
      });
      edge.effect_direction = defaultDirection;

      log.info({
        event: "cee.graph_integrity.edge_effect_direction_defaulted",
        request_id: requestId,
        from: edge.from,
        to: edge.to,
        edge_class: edgeClass,
        value: defaultDirection,
      }, `[graph-data-integrity] effect_direction defaulted for ${edge.from}→${edge.to}`);
    }
  }

  return repairs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all graph data integrity checks on a V3 response body.
 *
 * Mutates v3Body in place (nodes, edges, analysis_ready.options).
 * Returns a summary of all repairs applied.
 *
 * This function never throws — errors are caught and logged.
 * The caller should merge the returned summary into repair_summary.
 */
export function runGraphDataIntegrityChecks(
  v3Body: any,
  requestId?: string,
): IntegrityRepairSummary {
  const summary: IntegrityRepairSummary = {
    scale_consistency_repairs: [],
    edge_field_repairs: [],
  };

  try {
    summary.scale_consistency_repairs = repairFactorScaleConsistency(v3Body, requestId);
  } catch (err) {
    log.warn(
      { error: err, request_id: requestId },
      "[graph-data-integrity] Scale consistency check failed (non-blocking)",
    );
  }

  try {
    summary.edge_field_repairs = repairEdgeFields(v3Body, requestId);
  } catch (err) {
    log.warn(
      { error: err, request_id: requestId },
      "[graph-data-integrity] Edge field check failed (non-blocking)",
    );
  }

  const totalRepairs = summary.scale_consistency_repairs.length + summary.edge_field_repairs.length;
  if (totalRepairs > 0) {
    log.info({
      event: "cee.graph_integrity.summary",
      request_id: requestId,
      scale_consistency_repairs: summary.scale_consistency_repairs.length,
      edge_field_repairs: summary.edge_field_repairs.length,
      total_repairs: totalRepairs,
    }, `[graph-data-integrity] Applied ${totalRepairs} correction(s)`);
  }

  return summary;
}
