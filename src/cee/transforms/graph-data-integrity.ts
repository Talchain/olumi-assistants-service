/**
 * Graph Data Integrity — Post-V3-Transform Corrections
 *
 * Runs in Stage 6 (Boundary), after transformResponseToV3(), before V3 schema validation.
 * Applies deterministic corrections to three known data quality issues:
 *
 * 1. Factor scale inconsistency:
 *    When a factor has both raw_value and cap in observed_state, value must equal
 *    raw_value / cap (within 5% tolerance). If inconsistent, recompute value and log.
 *    Special case: percentage factors (unit: "%") use raw_value / 100.
 *    Apply the same correction to analysis_ready.options interventions for the affected factor.
 *
 * 2. Edge field safety net (post-V3-transform):
 *    The primary fix for edge field defaults is in transformEdgeToV3() which now
 *    applies class-aware defaults (1.0 structural, DEFAULT_EXISTS_PROBABILITY causal) when the LLM does
 *    not emit belief_exists or belief. This module is a safety net that catches:
 *    - Edges from the legacy pipeline or other sources that bypassed the transform.
 *    - Structural edges where the LLM explicitly emitted a value < 1.0 (wrong).
 *    - Any edge still missing effect_direction after the transform.
 *    Log every correction applied.
 *
 * 3. Observed-root intercept doctrine (Track S 0.12):
 *    `observed_state.value` is the sole baseline carrier for observed root
 *    nodes; `intercept` is a structural offset for derived (non-root)
 *    equations only. A root carrying `intercept = observed_state.value` is
 *    evaluated downstream at twice its baseline (ISL computes non-intervened
 *    roots as `observed_state.value + intercept`). This module removes that
 *    duplicate pattern and never assigns intercepts itself.
 *
 * Root cause commentary:
 *   Issue 1: The LLM emits raw_value:49 and cap:59 but encodes value:0.49
 *   (£49/£100 division) instead of value=49/59≈0.831. CEE had no consistency
 *   check, so the contradiction passed through to PLoT uncorrected.
 *   Intervention values used the same wrong convention and are corrected by the
 *   same ratio (100/cap).
 *
 *   Issue 2: transformEdgeToV3() previously defaulted belief_exists to 0.5 when
 *   the LLM omitted the field, resulting in causal edges arriving at PLoT with 0.5
 *   (PLoT overrides with its own default 0.8) and structural edges also arriving
 *   with 0.5 (should be 1.0). Fixed in transformEdgeToV3() — this module handles
 *   remaining structural corrections and legacy pipeline edges.
 */

import { log } from "../../utils/telemetry.js";
import { DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";
import { isLegalStructuralEdge } from "../utils/structural-edge-classifier.js";

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

export interface InterceptPopulationRepair {
  node_id: string;
  field: 'intercept';
  before: number | undefined;
  /** Undefined when the repair REMOVED a duplicate root intercept (0.13a). */
  after: number | undefined;
  source: 'observed_state.value';
  reason: string;
}

export interface IntegrityRepairSummary {
  scale_consistency_repairs: ScaleConsistencyRepair[];
  edge_field_repairs: EdgeFieldRepair[];
  intercept_population_repairs: InterceptPopulationRepair[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tolerance for float comparison: ±5% relative error. */
const SCALE_TOLERANCE = 0.05;

/** Default exists_probability for structural edges (decision→option, option→factor). */
const STRUCTURAL_EXISTS_PROBABILITY = 1.0;

/** Default exists_probability for causal (factor→factor, factor→goal) edges. */
const CAUSAL_EXISTS_PROBABILITY = DEFAULT_EXISTS_PROBABILITY;

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

/**
 * @deprecated Use isLegalStructuralEdge from cee/utils/structural-edge-classifier instead.
 * Retained as a local alias for minimal diff.
 */
const isStructuralEdge = isLegalStructuralEdge;

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

  // Build maps for updating interventions after factor repairs
  const factorCorrectionMap = new Map<string, number>(); // factorId → corrected value
  const factorCorrectionRatioMap = new Map<string, number>(); // factorId → corrected/original ratio

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
    // Correction ratio: how much was the original value off by?
    // ratio = corrected / original. Any option intervention on this factor
    // that used the same wrong encoding (÷100 instead of ÷cap) will be off
    // by the same ratio, so multiply by ratio to correct.
    // Example: raw_value:49, cap:59 → original:0.49, corrected:0.831
    //   ratio = 0.831/0.49 = 100/59 ≈ 1.695
    //   opt_increase_price: 0.59 → 0.59 × (100/59) = 1.0 ✓
    factorCorrectionRatioMap.set(node.id, corrected / value);
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
  //
  // When a factor's value was wrong by ratio R (corrected = original × R),
  // every option intervention targeting that factor was encoded with the same
  // wrong scale convention. Apply the same ratio to each intervention.
  //
  // Example from debug bundle c47e62a3:
  //   factor raw_value:49, cap:59 → original:0.49, corrected:0.831
  //   R = 0.831/0.49 = 100/59 ≈ 1.695
  //   opt_status_quo: 0.49 × 1.695 ≈ 0.831  (£49/£59)
  //   opt_increase_price: 0.59 × 1.695 ≈ 1.0  (£59/£59 = cap reached)
  //
  // Guard: clamp corrected interventions to [0, 1] since factor values are normalised.
  for (const option of analysisOptions) {
    // Interventions may be bare numbers or rich { value, display_value?, source? }
    // objects after the presentation-upgrade pass. Unwrap to read, then
    // write back in the same shape so display_value/source are preserved
    // through scale-repair.
    const interventions: Record<string, unknown> = option?.interventions ?? {};
    for (const [factorId, interventionEntry] of Object.entries(interventions)) {
      const correctionRatio = factorCorrectionRatioMap.get(factorId);
      if (correctionRatio === undefined) continue;

      const factorRepair = repairs.find((r) => r.node_id === factorId);
      if (!factorRepair) continue;

      const rawInterventionValue = typeof interventionEntry === 'number'
        ? interventionEntry
        : interventionEntry != null && typeof interventionEntry === 'object' && typeof (interventionEntry as { value?: unknown }).value === 'number'
          ? (interventionEntry as { value: number }).value
          : NaN;
      if (!Number.isFinite(rawInterventionValue)) continue;

      const correctedIntervention = Number(
        Math.max(0, Math.min(1, rawInterventionValue * correctionRatio)).toFixed(6)
      );

      // Skip if already correct (ratio effectively 1.0 — shouldn't happen but guard)
      if (isWithinTolerance(rawInterventionValue, correctedIntervention)) continue;

      // Preserve the wrapping shape (rich object keeps display_value/source).
      // display_value is a snapshot of the pre-repair value; it will no
      // longer match the new numeric after a scale correction, so drop it
      // to avoid misleading the UI. source (provenance) is preserved.
      if (typeof interventionEntry === 'number') {
        interventions[factorId] = correctedIntervention;
      } else {
        const prior = interventionEntry as { value: number; source?: string; display_value?: string };
        const replacement: Record<string, unknown> = {
          ...prior,
          value: correctedIntervention,
        };
        if (replacement.display_value !== undefined) delete replacement.display_value;
        interventions[factorId] = replacement;
      }
      option.interventions = interventions as typeof option.interventions;

      repairs.push({
        node_id: `option:${option.id}`,
        field: `interventions.${factorId}`,
        before: rawInterventionValue,
        after: correctedIntervention,
        raw_value: factorRepair.raw_value,
        cap: factorRepair.cap,
        reason: `option intervention rescaled by factor correction ratio ${correctionRatio.toFixed(4)} (same ÷100 encoding as factor)`,
      });

      log.info({
        event: "cee.graph_integrity.intervention_corrected",
        request_id: requestId,
        option_id: option.id,
        factor_id: factorId,
        before: rawInterventionValue,
        after: correctedIntervention,
        correction_ratio: correctionRatio,
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
// Task 3: Observed-root intercept doctrine (root nodes only)
// ---------------------------------------------------------------------------

/** Node kinds eligible for the observed-root intercept repair (participate in inference). */
const INTERCEPT_ELIGIBLE_KINDS = new Set(['factor', 'outcome', 'risk', 'goal']);

/**
 * Source kinds whose outgoing edges do NOT make the target a derived node.
 *
 * PINNED to PLoT's runtime filter contract: plot-lite-service
 * `NON_CAUSAL_NODE_KINDS = ['option', 'decision']` (src/types/engine-v3.ts,
 * consumed by src/normalisation/option-filter.ts), documented in
 * src/contracts/plot-to-isl.contract.ts. PLoT removes these nodes and ALL
 * incident edges before the graph reaches ISL, so a node whose only incoming
 * edges come from these kinds is a ROOT in the inference graph ISL evaluates.
 *
 * Deliberately NOT including 'constraint': option-filter.ts prose mentions
 * constraint, but the runtime constant is ['option', 'decision'] (the
 * contract file calls out this exact discrepancy). A constraint→X edge
 * survives to ISL, so X stays a derived node there and its intercept is a
 * legitimate structural offset. If PLoT ever adds constraint to its filter,
 * this set must change in the same release.
 */
const NON_CAUSAL_SOURCE_KINDS = new Set(['option', 'decision']);

/** Tolerance for detecting `intercept === observed_state.value` duplicates. */
const INTERCEPT_DUPLICATE_EPSILON = 1e-9;

/**
 * Enforce the intercept doctrine (Track S 0.12) on observed root V3 nodes:
 * - `observed_state.value` is the sole baseline carrier for observed roots.
 * - `intercept` is a structural offset for derived (non-root) equations.
 * - Producers must never set `intercept = observed_state.value` on observed roots.
 *
 * ISL evaluates a non-intervened root as `observed_state.value + intercept`,
 * so an observed root carrying `intercept = observed_state.value` is computed
 * at twice its baseline (Track S 0.11 audit). This repair:
 *
 * - REMOVES `intercept` from an observed root when it numerically equals
 *   `observed_state.value` (the duplicate-baseline pattern; the live
 *   draft_graph prompt still instructs the LLM to emit it — 0.13b).
 * - Never ASSIGNS an intercept. The pre-0.13a auto-population
 *   (`intercept = observed_state.value` on roots) was the audited defect
 *   and has been removed.
 * - Leaves explicit-zero intercepts in place (zero cannot double-count).
 * - Leaves root intercepts that DIFFER from `observed_state.value` in place
 *   (not the audited pattern; whether legitimate root offsets exist is the
 *   0.12 doctrine's open Neil question). Emits a redacted
 *   `observed_root_intercept_retained` diagnostic (IDs only) so the
 *   non-audited pattern stays measurable.
 * - Never touches non-root (derived) nodes — their intercepts are
 *   legitimate structural offsets.
 *
 * Rootness is judged on the inference graph, not the raw V3 graph: incoming
 * directed edges from option/decision sources do not count, because PLoT
 * removes those nodes and edges before ISL evaluation (see
 * NON_CAUSAL_SOURCE_KINDS pin; all 170 affected nodes in the 0.11 staging
 * audit were "roots" only in this post-filter sense). Bidirected edges are
 * excluded as in gap-detection.ts.
 *
 * Mutates v3Body.nodes in place.
 *
 * Exported (Track S 0.13c-1) so the `run_analysis` load-time guard can apply
 * the SAME repair to the in-memory graph it sends to PLoT — the analysis path
 * loads `scenarios.graph` raw and does not run the CEE unified pipeline, so a
 * legacy graph would otherwise still be evaluated at 2x baseline. Reusing this
 * function (rather than re-implementing the doctrine) keeps the draft-path and
 * analysis-path repairs byte-for-byte identical.
 */
export function repairObservedRootIntercepts(v3Body: any, requestId?: string): InterceptPopulationRepair[] {
  const repairs: InterceptPopulationRepair[] = [];

  const nodes: any[] = Array.isArray(v3Body?.nodes) ? v3Body.nodes : [];
  const edges: any[] = Array.isArray(v3Body?.edges) ? v3Body.edges : [];

  const kindById = buildNodeKindMap(nodes);

  // Build set of nodes with at least one incoming directed edge from a
  // causal source (a source PLoT will not strip before ISL evaluation).
  const hasCausalIncomingDirected = new Set<string>();
  for (const edge of edges) {
    if (!edge) continue;
    if (edge.edge_type === 'bidirected') continue;
    if (!edge.to || !edge.from) continue;
    const sourceKind = kindById.get(edge.from);
    if (sourceKind !== undefined && NON_CAUSAL_SOURCE_KINDS.has(sourceKind)) continue;
    hasCausalIncomingDirected.add(edge.to);
  }

  for (const node of nodes) {
    if (!node?.id || !node?.kind) continue;

    // 1. Kind filter — only inference-participating nodes
    if (!INTERCEPT_ELIGIBLE_KINDS.has(node.kind)) continue;

    // 2. Root-only (inference-graph rootness) — derived-node intercepts are
    //    legitimate structural offsets and must be preserved
    if (hasCausalIncomingDirected.has(node.id)) continue;

    // 3. Only observed roots — guard NaN (typeof NaN === 'number')
    const observedValue = node.observed_state?.value;
    if (typeof observedValue !== 'number' || Number.isNaN(observedValue)) continue;

    // 4. Only the duplicate-baseline pattern: non-zero intercept equal to
    //    observed_state.value. Explicit zero is kept; differing values are
    //    out of scope here (0.13b).
    const intercept = node.intercept;
    if (typeof intercept !== 'number' || Number.isNaN(intercept)) continue;
    if (intercept === 0) continue;
    if (Math.abs(intercept - observedValue) > INTERCEPT_DUPLICATE_EPSILON) {
      // Non-equal observed-root intercept: NOT the audited duplicate pattern,
      // so it is preserved — whether legitimate root offsets exist at all is
      // the 0.12 doctrine's open question (Neil), and the repair must not
      // destroy data beyond its evidence. Emit a redacted diagnostic (IDs
      // only, no values) so prevalence stays measurable after the prompt
      // fix (0.13b) lands. scenario_id does not exist at this stage (the
      // draft pipeline runs pre-persistence); request_id is the join key.
      log.info({
        event: "cee.graph_integrity.observed_root_intercept_retained",
        request_id: requestId,
        node_id: node.id,
      }, `[graph-data-integrity] Observed-root intercept retained (differs from observed_state.value): ${node.id}`);
      continue;
    }

    delete node.intercept;
    repairs.push({
      node_id: node.id,
      field: 'intercept',
      before: intercept,
      after: undefined,
      source: 'observed_state.value',
      reason: `observed root ${node.kind} carried duplicate intercept=${intercept} equal to observed_state.value — removed (baseline is carried by observed_state.value alone)`,
    });

    // Redacted log: IDs only, no numeric magnitudes. The contracted
    // before/after values live in the in-payload repair record above.
    log.info({
      event: "cee.graph_integrity.duplicate_root_intercept_removed",
      request_id: requestId,
      node_id: node.id,
    }, `[graph-data-integrity] Duplicate root intercept removed: ${node.id}`);
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
    intercept_population_repairs: [],
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

  try {
    summary.intercept_population_repairs = repairObservedRootIntercepts(v3Body, requestId);
  } catch (err) {
    log.warn(
      { error: err, request_id: requestId },
      "[graph-data-integrity] Observed-root intercept repair failed (non-blocking)",
    );
  }

  const totalRepairs = summary.scale_consistency_repairs.length + summary.edge_field_repairs.length + summary.intercept_population_repairs.length;
  if (totalRepairs > 0) {
    log.info({
      event: "cee.graph_integrity.summary",
      request_id: requestId,
      scale_consistency_repairs: summary.scale_consistency_repairs.length,
      edge_field_repairs: summary.edge_field_repairs.length,
      intercept_population_repairs: summary.intercept_population_repairs.length,
      total_repairs: totalRepairs,
    }, `[graph-data-integrity] Applied ${totalRepairs} correction(s)`);
  }

  return summary;
}
