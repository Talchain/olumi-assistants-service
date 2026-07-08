/**
 * Analysis Compact Summarisation
 *
 * Extracts a rich but compact summary from a V2RunResponseEnvelope for LLM context.
 * Full analysis response is forwarded to the UI; this compact form fits the budget.
 *
 * Token budget target: ~300–500 tokens regardless of option count
 * (vs 2000–8000 for full V2RunResponse).
 */

import type { V2RunResponseEnvelope } from "../types.js";
import { log } from "../../utils/telemetry.js";
import { resolveInfluenceDirection, type InfluenceDirection } from "./influence-direction.js";

// ============================================================================
// Output Types
// ============================================================================

export interface OptionSummary {
  option_id: string;
  option_label: string;
  win_probability: number;
  outcome_mean: number;
  outcome_p10?: number;
  outcome_p90?: number;
  probability_of_goal?: number;
}

/** Purpose-specific comparison entry for LLM context (Brief B contract). */
export interface OptionComparisonEntry {
  label: string;
  win_probability: number;
  mean: number;
  p10: number;
  p90: number;
}

export interface DriverSummary {
  factor_id: string;
  factor_label: string;
  sensitivity: number;
  direction: InfluenceDirection;
}

export interface FlipThreshold {
  /**
   * Structural factor id (Lane 30, #369 audit P1). INTERNAL ONLY — never
   * serialised onto the wire or the strict-validated ContextPack output
   * (which keeps the `{factor_label, current_value, flip_value, unit,
   * no_flip_within_bounds}` shape). Carried so the V5 context-pack
   * assembler can suppress option-controlled-lever tipping points by
   * structural `factor_id` (never by label — labels collide). Populated
   * fresh from the raw `factor_sensitivity` entry at derivation time; may
   * be absent only for legacy hand-built values, which the consumer fails
   * closed on when a controlled-lever set exists. Mirrors
   * {@link FragileEdge.from_id}.
   */
  factor_id?: string;
  factor_label: string;
  current_value: number;
  flip_value: number;
  unit: string | null;
}

export interface FragileEdge {
  from_label: string;
  to_label: string;
  /**
   * Source node id of the edge (P0b-1). INTERNAL ONLY — never serialised onto
   * the wire or the strict-validated ContextPack output (which keeps just the
   * `{from_label, to_label}` shape). Carried so the V5 context-pack assembler
   * can suppress option-controlled-lever-SOURCED fragile edges by structural
   * `factor_id` (never by label — labels collide). Always populated fresh from
   * the raw `robustness.fragile_edges` source at derivation time; may be absent
   * only for a malformed/label-only raw edge, which the consumer fails closed on.
   */
  from_id?: string;
}

export interface AnalysisResponseSummary {
  winner: { option_id: string; option_label: string; win_probability: number };
  options: OptionSummary[];          // all options, sorted by win_probability descending
  /** Dedicated comparison array for prompt serialisation (Brief B contract).
   *  Sorted by win_probability descending. Only populated when p10/p90 are available
   *  for at least one option; undefined otherwise. */
  option_results?: OptionComparisonEntry[];
  top_drivers: DriverSummary[];      // top 5 by absolute sensitivity
  robustness_level: string;
  fragile_edge_count: number;
  constraint_tensions?: string[];    // constraint IDs where joint < individual × 0.7
  /** Top 3 flip thresholds when available in analysis response. */
  flip_thresholds?: FlipThreshold[];
  /** Top 3 fragile edges with labels when available in robustness data. */
  top_fragile_edges?: FragileEdge[];
  /** Winner win_probability minus runner-up win_probability. Null when fewer than 2 options. */
  margin: number | null;
  /** `margin × 100` rounded to 1 decimal place. Null when `margin` is null.
   *  Pre-computed here so the V5 ContextPack assembler can stay free of
   *  semantic transforms (F.6 passthrough). */
  margin_pp: number | null;
  analysis_status: string;
}

// ============================================================================
// Constraint Tension Threshold
// ============================================================================

/**
 * Provisional threshold: if joint probability < min(individual) × TENSION_THRESHOLD,
 * we flag the constraint as "in tension".
 */
const TENSION_THRESHOLD = 0.7;

// ============================================================================
// Internal Helpers
// ============================================================================

type OptionResult = Record<string, unknown>;
type FactorEntry = Record<string, unknown>;

function isOptionResult(r: unknown): r is OptionResult {
  if (!r || typeof r !== 'object') return false;
  return true;
}

/**
 * Extract the option results array from a V2RunResponseEnvelope.
 * PLoT returns option data in `option_comparison[]`; the UI normalizer copies it to `results[]`.
 * Mirrors getOptionResultCandidates() in analysis-state.ts — both must stay in sync.
 */
function getResultsArray(response: V2RunResponseEnvelope): unknown[] {
  if (Array.isArray(response.results) && response.results.length > 0) return response.results;
  const r = response as Record<string, unknown>;
  const oc = r.option_comparison;
  if (Array.isArray(oc) && oc.length > 0) return oc;
  // UI may nest V2 fields inside results as an object
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    const nested = r.results as Record<string, unknown>;
    if (Array.isArray(nested.option_comparison) && nested.option_comparison.length > 0) return nested.option_comparison;
  }
  return [];
}

/**
 * Derive a winner from sorted option summaries.
 * Tiebreak: first by option_id lexicographic (deterministic).
 */
function deriveWinner(options: OptionSummary[]): AnalysisResponseSummary['winner'] | null {
  if (options.length === 0) return null;
  // options is already sorted by win_probability descending; tiebreak by option_id
  const sorted = [...options].sort((a, b) => {
    const probDiff = b.win_probability - a.win_probability;
    if (probDiff !== 0) return probDiff;
    return a.option_id.localeCompare(b.option_id);
  });
  const first = sorted[0];
  return {
    option_id: first.option_id,
    option_label: first.option_label,
    win_probability: first.win_probability,
  };
}

/**
 * Derive robustness level from response.
 * Priority: robustness_synthesis.overall_assessment → robustness.overall_robustness
 * on first option → 'unknown'.
 */
const ROBUSTNESS_MAP: Record<string, string> = {
  very_low: 'fragile', low: 'fragile', medium: 'moderate', high: 'stable', very_high: 'highly_stable',
  fragile: 'fragile', moderate: 'moderate', stable: 'stable', highly_stable: 'highly_stable',
  // Explicit 'unknown' passthrough — silences the unknown-band warning on
  // the deliberate "no robustness signal at all" path (deriveRobustnessLevel
  // returns the literal 'unknown' when nothing is reachable). projectAnalysis
  // collapses 'unknown' to null so composers omit the band sentence.
  unknown: 'unknown',
};

/**
 * Coarse length bucket for the unrecognised-robustness warning. Three
 * buckets keep aggregate cardinality strictly bounded regardless of how
 * many distinct vendor strings reach this branch. Boundaries are
 * deliberately wide; we never want this telemetry to grow as the
 * upstream vocabulary expands. Aligned to "category, not exact length".
 */
function lengthBucket(n: number): 'short' | 'medium' | 'long' {
  if (n <= 8) return 'short';
  if (n <= 32) return 'medium';
  return 'long';
}

function mapRobustnessToCanonical(raw: string): string {
  const normalised = raw.toLowerCase().trim();
  const mapped = ROBUSTNESS_MAP[normalised];
  if (mapped) return mapped;
  // Unrecognised band — return 'unknown' (NOT the previous silent 'moderate'
  // fallback) so the projection layer collapses to null and downstream
  // composers omit the band sentence rather than asserting a false one.
  // Warn here so genuinely novel vendor values surface in telemetry; the
  // deliberate 'unknown' passthrough above never reaches this branch.
  //
  // Cardinality discipline: emit a stable `reason` enum and a coarse
  // length bucket — NEVER the raw value (or any prefix of it) and NEVER
  // an exact length. If upstream vocab grows or a vendor emits free-text,
  // dashboards group by `reason` × `length_bucket` and the unique-value
  // count stays small. To investigate which vendor string is triggering
  // the warn, reach for raw upstream logs, not CEE telemetry.
  log.warn(
    {
      reason: 'unrecognised_robustness_band',
      length_bucket: lengthBucket(normalised.length),
    },
    'compactAnalysis: unrecognised robustness band — mapped to unknown',
  );
  return 'unknown';
}

function deriveRobustnessLevel(response: V2RunResponseEnvelope): string {
  // Check robustness_synthesis at top level
  const synthLevel = (response as Record<string, unknown>).robustness_synthesis;
  if (synthLevel && typeof synthLevel === 'object') {
    const assessment = (synthLevel as Record<string, unknown>).overall_assessment;
    if (typeof assessment === 'string' && assessment.length > 0) {
      return assessment;
    }
  }

  // Fallback: robustness.overall_robustness on first option's result
  const results = getResultsArray(response);
  const firstResult = results[0];
  if (firstResult && typeof firstResult === 'object') {
    const robustness = (firstResult as Record<string, unknown>).robustness;
    if (robustness && typeof robustness === 'object') {
      const overall = (robustness as Record<string, unknown>).overall_robustness;
      if (typeof overall === 'string' && overall.length > 0) {
        return overall;
      }
    }
  }

  // Fallback: top-level robustness.level
  if (response.robustness?.level) {
    return response.robustness.level;
  }

  // Fallback: UI may nest robustness inside results as an object
  const r = response as Record<string, unknown>;
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    const nested = r.results as Record<string, unknown>;
    const nestedRobustness = nested.robustness as Record<string, unknown> | undefined;
    if (typeof nestedRobustness?.level === 'string' && (nestedRobustness.level as string).length > 0) {
      return nestedRobustness.level as string;
    }
  }

  return 'unknown';
}

/**
 * Count unique fragile edges across all option results.
 * Deduplicates by edge_id.
 */
function deriveFragileEdgeCount(response: V2RunResponseEnvelope): number {
  const results = getResultsArray(response);
  const seen = new Set<string>();
  let count = 0;

  for (const result of results) {
    if (!isOptionResult(result)) continue;
    const robustness = result.robustness as Record<string, unknown> | undefined;
    if (!robustness) continue;
    const fragileEdges = robustness.fragile_edges;
    if (!Array.isArray(fragileEdges)) continue;
    for (const edge of fragileEdges) {
      const edgeObj = edge as Record<string, unknown>;
      const edgeId = typeof edgeObj.edge_id === 'string' ? edgeObj.edge_id : JSON.stringify(edgeObj);
      if (!seen.has(edgeId)) {
        seen.add(edgeId);
        count++;
      }
    }
  }

  return count;
}

/**
 * Derive constraint tension IDs.
 * Heuristic: for each option, if probability_of_joint_goal < min(individual constraint_probabilities) × 0.7
 * flag those constraint_ids.
 *
 * Threshold 0.7 is provisional — see TENSION_THRESHOLD constant.
 */
function deriveConstraintTensions(response: V2RunResponseEnvelope): string[] | undefined {
  const results = getResultsArray(response);
  const tensionSet = new Set<string>();

  for (const result of results) {
    if (!isOptionResult(result)) continue;

    const jointProb = typeof result.probability_of_joint_goal === 'number'
      ? result.probability_of_joint_goal
      : null;
    if (jointProb === null) continue;

    const constraintProbs = result.constraint_probabilities;
    if (!Array.isArray(constraintProbs) || constraintProbs.length === 0) continue;

    // Collect individual probabilities
    const individualProbs: Array<{ id: string; probability: number }> = [];
    for (const cp of constraintProbs) {
      const cpObj = cp as Record<string, unknown>;
      if (typeof cpObj.probability === 'number' && typeof cpObj.constraint_id === 'string') {
        individualProbs.push({ id: cpObj.constraint_id, probability: cpObj.probability });
      }
    }

    if (individualProbs.length === 0) continue;

    const minIndividual = Math.min(...individualProbs.map(p => p.probability));
    if (jointProb < minIndividual * TENSION_THRESHOLD) {
      // Flag all constraint IDs in this option
      for (const p of individualProbs) {
        tensionSet.add(p.id);
      }
    }
  }

  return tensionSet.size > 0 ? Array.from(tensionSet).sort() : undefined;
}

/**
 * Full per-factor flip entry with `factor_id`, `direction`, and `elasticity` —
 * the shape the decision_review enricher needs. {@link deriveFlipThresholds}
 * projects this down to the narrower {@link FlipThreshold} shape.
 *
 * `direction` describes the input change required to flip the result:
 *   `flip_value > current_value` → `'increase'`
 *   `flip_value < current_value` → `'decrease'`
 * Elasticity sign is *not* used for direction — it describes model response
 * direction, not the input change needed (a negatively-elastic factor at
 * current=40 with flip=30 still requires `'decrease'` to flip the outcome).
 */
export interface FactorFlipEntry {
  factor_id: string;
  factor_label: string;
  current_value: number;
  flip_value: number;
  direction: 'increase' | 'decrease';
  unit: string | null;
  elasticity: number | null;
}

/**
 * Walk every option's factor_sensitivity[] entries, filter to factors with a
 * non-null flip_value AND a non-null current_value, and project each into a
 * {@link FactorFlipEntry}. Deduplicates by factor_id, keeping the first
 * occurrence (matches the historical {@link deriveFlipThresholds} behaviour).
 *
 * Optional lookups:
 *   `graphNodeLabels`: factor_id → display label. Used when the
 *     factor_sensitivity entry lacks `label` / `factor_label`.
 *   `graphNodeUnits`: factor_id → unit string. Used when the
 *     factor_sensitivity entry lacks `unit`.
 *
 * Sort order is undefined here — callers decide whether to dedupe / sort /
 * cap. The historical {@link deriveFlipThresholds} sorts by absolute distance
 * and slices to 3.
 */
export function collectFactorFlipEntries(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
  graphNodeUnits?: Map<string, string>,
): FactorFlipEntry[] {
  const results = getResultsArray(response);
  const seen = new Map<string, FactorFlipEntry>();

  for (const result of results) {
    if (!isOptionResult(result)) continue;
    const factorSensitivity = result.factor_sensitivity;
    if (!Array.isArray(factorSensitivity)) continue;

    for (const factor of factorSensitivity as FactorEntry[]) {
      const factorId = (typeof factor.node_id === 'string' ? factor.node_id : null)
        ?? (typeof factor.factor_id === 'string' ? factor.factor_id : null);
      if (!factorId) continue;
      // Skip duplicates here so we never need to re-resolve labels/units.
      if (seen.has(factorId)) continue;

      const flipValue = typeof factor.flip_threshold === 'number' ? factor.flip_threshold
        : typeof factor.flip_value === 'number' ? factor.flip_value
        : null;
      const currentValue = typeof factor.current_value === 'number' ? factor.current_value
        : typeof factor.value === 'number' ? factor.value
        : null;
      if (flipValue === null || currentValue === null) continue;

      const label = (typeof factor.factor_label === 'string' && factor.factor_label)
        ? factor.factor_label
        : (typeof factor.label === 'string' && factor.label)
          ? factor.label
          : graphNodeLabels?.get(factorId) ?? factorId;

      const unit = typeof factor.unit === 'string' ? factor.unit
        : graphNodeUnits?.get(factorId) ?? null;

      const elasticity = typeof factor.elasticity === 'number' && Number.isFinite(factor.elasticity)
        ? factor.elasticity
        : null;

      // Direction = input change required to flip; not elasticity sign.
      // flip_value === current_value is degenerate (no actionable flip);
      // upstream filters should drop these, but if one slips through
      // default to 'increase' so the prompt has a consistent value.
      const direction: 'increase' | 'decrease' = flipValue >= currentValue ? 'increase' : 'decrease';

      seen.set(factorId, {
        factor_id: factorId,
        factor_label: label,
        current_value: currentValue,
        flip_value: flipValue,
        direction,
        unit,
        elasticity,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * Derive top 3 flip thresholds from sensitivity analysis.
 * Returns up to 3 entries sorted by closest distance (|flip_value - current_value| ascending).
 *
 * Implementation: thin adapter over {@link collectFactorFlipEntries} that
 * trims to the legacy {@link FlipThreshold} shape (no factor_id / direction /
 * elasticity). The {@link AnalysisResponseSummary} contract is unchanged.
 */
function deriveFlipThresholds(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
): FlipThreshold[] | undefined {
  const entries = collectFactorFlipEntries(response, graphNodeLabels);
  if (entries.length === 0) return undefined;

  return entries
    .sort((a, b) => Math.abs(a.flip_value - a.current_value) - Math.abs(b.flip_value - b.current_value))
    .slice(0, 3)
    .map((entry) => ({
      // Internal structural id for lever suppression (Lane 30) — see the
      // FlipThreshold.factor_id doc; never serialised downstream.
      factor_id: entry.factor_id,
      factor_label: entry.factor_label,
      current_value: entry.current_value,
      flip_value: entry.flip_value,
      unit: entry.unit,
    }));
}

/**
 * Derive top 3 fragile edges with node labels.
 * Collects fragile edges from robustness data, deduplicates, returns top 3.
 */
function deriveTopFragileEdges(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
): FragileEdge[] | undefined {
  const results = getResultsArray(response);
  const seen = new Map<string, FragileEdge>();

  for (const result of results) {
    if (!isOptionResult(result)) continue;
    const robustness = result.robustness as Record<string, unknown> | undefined;
    if (!robustness) continue;
    const fragileEdges = robustness.fragile_edges;
    if (!Array.isArray(fragileEdges)) continue;

    for (const edge of fragileEdges) {
      const edgeObj = edge as Record<string, unknown>;
      const fromId = typeof edgeObj.from_node_id === 'string' ? edgeObj.from_node_id
        : typeof edgeObj.from === 'string' ? edgeObj.from
        : null;
      const toId = typeof edgeObj.to_node_id === 'string' ? edgeObj.to_node_id
        : typeof edgeObj.to === 'string' ? edgeObj.to
        : null;
      if (!fromId || !toId) continue;

      const edgeKey = `${fromId}→${toId}`;
      if (!seen.has(edgeKey)) {
        const fromLabel = graphNodeLabels?.get(fromId)
          ?? (typeof edgeObj.from_label === 'string' ? edgeObj.from_label : fromId);
        const toLabel = graphNodeLabels?.get(toId)
          ?? (typeof edgeObj.to_label === 'string' ? edgeObj.to_label : toId);
        // P0b-1: carry the structural source id (already proven non-null by the
        // `!fromId` guard above) so the assembler can suppress lever-sourced edges.
        seen.set(edgeKey, { from_label: fromLabel as string, to_label: toLabel as string, from_id: fromId });
      }
    }
  }

  if (seen.size === 0) return undefined;

  return Array.from(seen.values()).slice(0, 3);
}

/**
 * Derive top drivers across all option results.
 * Collects unique factors by node_id (or factor_id), takes max absolute sensitivity,
 * sorts descending, returns top 5.
 */
function deriveTopDrivers(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
): DriverSummary[] {
  const results = getResultsArray(response);
  // Map from factor_id → { max_abs_sensitivity, direction }
  const factorMap = new Map<string, { label: string; maxSensitivity: number; direction: InfluenceDirection }>();

  for (const result of results) {
    if (!isOptionResult(result)) continue;
    const factorSensitivity = result.factor_sensitivity;
    if (!Array.isArray(factorSensitivity)) continue;

    for (const factor of factorSensitivity as FactorEntry[]) {
      const factorId = (typeof factor.node_id === 'string' ? factor.node_id : null)
        ?? (typeof factor.factor_id === 'string' ? factor.factor_id : null);
      if (!factorId) continue;

      const sensitivityRaw = typeof factor.sensitivity === 'number'
        ? factor.sensitivity
        : (typeof factor.elasticity === 'number' ? factor.elasticity : null);
      // Drop non-finite magnitudes (NaN / Infinity) so they never reach
      // DriverSummary — matches deriveTopDriversFromTopLevel's guard, protecting
      // shared summary consumers that do not re-filter at projection time.
      if (sensitivityRaw === null || !Number.isFinite(sensitivityRaw)) continue;

      const absSensitivity = Math.abs(sensitivityRaw);
      // Honour the authoritative PLoT `direction` enum; only sign-derive when
      // it is absent (elasticity is unsigned per the sensitivity contract).
      const direction: InfluenceDirection = resolveInfluenceDirection(factor.direction, sensitivityRaw);

      // Derive label: graph lookup → factor.label → factor.factor_label → factor_id
      const label = graphNodeLabels?.get(factorId)
        ?? (typeof factor.label === 'string' ? factor.label : null)
        ?? (typeof factor.factor_label === 'string' ? factor.factor_label : null)
        ?? factorId;

      const existing = factorMap.get(factorId);
      if (!existing || absSensitivity > existing.maxSensitivity) {
        factorMap.set(factorId, {
          label: label as string,
          maxSensitivity: absSensitivity,
          direction,
        });
      }
    }
  }

  // Sort by abs sensitivity descending, tiebreak by factor_id lexicographic (deterministic)
  return Array.from(factorMap.entries())
    .sort((a, b) => {
      const diff = b[1].maxSensitivity - a[1].maxSensitivity;
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 5)
    .map(([factorId, { label, maxSensitivity, direction }]) => ({
      factor_id: factorId,
      factor_label: label,
      sensitivity: maxSensitivity,
      direction,
    }));
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Compact a V2RunResponseEnvelope for LLM context.
 *
 * Returns null if:
 * - input is null/undefined
 * - analysis_status is 'blocked' or 'failed' (error states)
 *
 * @param response - The full PLoT response envelope
 * @param graphNodeLabels - Optional map of node_id → label from the compact graph,
 *   used to resolve driver labels. If omitted, falls back to labels in the response.
 */
export function compactAnalysis(
  response: V2RunResponseEnvelope | null | undefined,
  graphNodeLabels?: Map<string, string>,
): AnalysisResponseSummary | null {
  if (!response) return null;

  try {
    // Check analysis_status — treat errors as null
    const status = typeof response.analysis_status === 'string'
      ? response.analysis_status
      : 'ok';
    if (status === 'blocked' || status === 'failed') return null;

    // Extract options — PLoT returns option_comparison[], not results[].
    const results = getResultsArray(response);
    const options: OptionSummary[] = results
      .filter(isOptionResult)
      .filter((r) => {
        const hasId = typeof r.option_id === 'string';
        const hasLabel = typeof r.option_label === 'string';
        const hasProb = typeof r.win_probability === 'number';
        return hasId || (hasLabel && hasProb);
      })
      .map((r) => {
        const optionId = typeof r.option_id === 'string'
          ? r.option_id
          : (typeof r.option_label === 'string' ? r.option_label : 'unknown');
        const optionLabel = typeof r.option_label === 'string'
          ? r.option_label
          : optionId;
        const winProb = typeof r.win_probability === 'number' ? r.win_probability : 0;
        // Support both flat (outcome_mean) and nested (outcome.mean) shapes
        const outcomeObj = (r.outcome && typeof r.outcome === 'object') ? r.outcome as Record<string, unknown> : null;
        const outcomeMean = typeof r.outcome_mean === 'number' ? r.outcome_mean
          : (outcomeObj && typeof outcomeObj.mean === 'number' ? outcomeObj.mean : 0);
        const outcomeP10 = typeof r.outcome_p10 === 'number' ? r.outcome_p10
          : (outcomeObj && typeof outcomeObj.p10 === 'number' ? outcomeObj.p10 : undefined);
        const outcomeP90 = typeof r.outcome_p90 === 'number' ? r.outcome_p90
          : (outcomeObj && typeof outcomeObj.p90 === 'number' ? outcomeObj.p90 : undefined);
        const probOfGoal = typeof r.probability_of_goal === 'number' ? r.probability_of_goal : undefined;

        const summary: OptionSummary = {
          option_id: optionId,
          option_label: optionLabel,
          win_probability: winProb,
          outcome_mean: outcomeMean,
        };
        if (outcomeP10 !== undefined) summary.outcome_p10 = outcomeP10;
        if (outcomeP90 !== undefined) summary.outcome_p90 = outcomeP90;
        if (probOfGoal !== undefined) {
          summary.probability_of_goal = probOfGoal;
        }
        return summary;
      })
      // Sort by win_probability descending, tiebreak by option_id lexicographic
      .sort((a, b) => {
        const probDiff = b.win_probability - a.win_probability;
        if (probDiff !== 0) return probDiff;
        return a.option_id.localeCompare(b.option_id);
      });

    const winner = deriveWinner(options);
    if (!winner) {
      // No valid options — can still return summary with empty winner
      log.warn({ result_count: results.length }, 'compactAnalysis: no valid options found');
    }

    const rawRobustnessLevel = deriveRobustnessLevel(response);
    const robustnessLevel = mapRobustnessToCanonical(rawRobustnessLevel);
    const fragileEdgeCount = deriveFragileEdgeCount(response);
    const topDrivers = deriveTopDrivers(response, graphNodeLabels);
    const constraintTensions = deriveConstraintTensions(response);
    const flipThresholds = deriveFlipThresholds(response, graphNodeLabels);
    const topFragileEdges = deriveTopFragileEdges(response, graphNodeLabels);

    // Build dedicated option_results comparison array (Brief B contract)
    // All-or-nothing: only populated when EVERY option has p10/p90 data,
    // so the comparison block never silently drops options.
    const allHaveRange = options.length > 0
      && options.every((o) => o.outcome_p10 !== undefined && o.outcome_p90 !== undefined);
    const optionResults: OptionComparisonEntry[] = allHaveRange
      ? options.map((o) => ({
          label: o.option_label,
          win_probability: o.win_probability,
          mean: o.outcome_mean,
          p10: o.outcome_p10!,
          p90: o.outcome_p90!,
        }))
      : [];

    // Margin: winner.win_probability - runner_up.win_probability
    const margin = options.length >= 2
      ? options[0].win_probability - options[1].win_probability
      : null;
    // margin_pp: margin in percentage points, rounded to 1 dp. Pre-computed
    // upstream so the V5 assembler stays passthrough-only (F.6).
    const marginPp = margin === null
      ? null
      : Math.round(margin * 1000) / 10;

    const summary: AnalysisResponseSummary = {
      winner: winner ?? { option_id: '', option_label: '', win_probability: 0 },
      options,
      top_drivers: topDrivers,
      robustness_level: robustnessLevel,
      fragile_edge_count: fragileEdgeCount,
      margin,
      margin_pp: marginPp,
      analysis_status: status,
    };

    if (optionResults.length > 0) {
      summary.option_results = optionResults;
    }
    if (constraintTensions !== undefined) {
      summary.constraint_tensions = constraintTensions;
    }
    if (flipThresholds !== undefined) {
      summary.flip_thresholds = flipThresholds;
    }
    if (topFragileEdges !== undefined) {
      summary.top_fragile_edges = topFragileEdges;
    }

    return summary;
  } catch (err) {
    log.error({ err }, 'compactAnalysis: unexpected error — returning null');
    return null;
  }
}
