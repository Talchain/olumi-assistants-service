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
  direction: 'positive' | 'negative';
}

export interface FlipThreshold {
  factor_label: string;
  current_value: number;
  flip_value: number;
  unit: string | null;
}

export interface FragileEdge {
  from_label: string;
  to_label: string;
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
 * Derive top 3 flip thresholds from sensitivity analysis.
 * Looks for flip_threshold field on factor_sensitivity entries.
 * Returns up to 3 entries sorted by closest distance (flip_value - current_value ascending).
 */
function deriveFlipThresholds(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
): FlipThreshold[] | undefined {
  const results = getResultsArray(response);
  const seen = new Map<string, FlipThreshold>();

  for (const result of results) {
    if (!isOptionResult(result)) continue;
    const factorSensitivity = result.factor_sensitivity;
    if (!Array.isArray(factorSensitivity)) continue;

    for (const factor of factorSensitivity as FactorEntry[]) {
      const factorId = (typeof factor.node_id === 'string' ? factor.node_id : null)
        ?? (typeof factor.factor_id === 'string' ? factor.factor_id : null);
      if (!factorId) continue;

      const flipValue = typeof factor.flip_threshold === 'number' ? factor.flip_threshold
        : typeof factor.flip_value === 'number' ? factor.flip_value
        : null;
      const currentValue = typeof factor.current_value === 'number' ? factor.current_value
        : typeof factor.value === 'number' ? factor.value
        : null;
      if (flipValue === null || currentValue === null) continue;

      const label = graphNodeLabels?.get(factorId)
        ?? (typeof factor.label === 'string' ? factor.label : null)
        ?? (typeof factor.factor_label === 'string' ? factor.factor_label : null)
        ?? factorId;

      const unit = typeof factor.unit === 'string' ? factor.unit : null;

      // Deduplicate by factorId — keep first occurrence
      if (!seen.has(factorId)) {
        seen.set(factorId, {
          factor_label: label as string,
          current_value: currentValue,
          flip_value: flipValue,
          unit,
        });
      }
    }
  }

  if (seen.size === 0) return undefined;

  // Sort by absolute distance (closest to flip first — most actionable)
  const sorted = Array.from(seen.values())
    .sort((a, b) => Math.abs(a.flip_value - a.current_value) - Math.abs(b.flip_value - b.current_value))
    .slice(0, 3);

  return sorted;
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
        seen.set(edgeKey, { from_label: fromLabel as string, to_label: toLabel as string });
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
  const factorMap = new Map<string, { label: string; maxSensitivity: number; direction: 'positive' | 'negative' }>();

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
      if (sensitivityRaw === null) continue;

      const absSensitivity = Math.abs(sensitivityRaw);
      const direction: 'positive' | 'negative' = sensitivityRaw >= 0 ? 'positive' : 'negative';

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

    const robustnessLevel = deriveRobustnessLevel(response);
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

    const summary: AnalysisResponseSummary = {
      winner: winner ?? { option_id: '', option_label: '', win_probability: 0 },
      options,
      top_drivers: topDrivers,
      robustness_level: robustnessLevel,
      fragile_edge_count: fragileEdgeCount,
      margin,
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
