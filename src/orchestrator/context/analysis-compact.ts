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
  probability_of_goal?: number;
}

export interface DriverSummary {
  factor_id: string;
  factor_label: string;
  sensitivity: number;
  direction: 'positive' | 'negative';
}

export interface AnalysisResponseSummary {
  winner: { option_id: string; option_label: string; win_probability: number };
  options: OptionSummary[];          // all options, sorted by win_probability descending
  top_drivers: DriverSummary[];      // top 5 by absolute sensitivity
  robustness_level: string;
  fragile_edge_count: number;
  constraint_tensions?: string[];    // constraint IDs where joint < individual × 0.7
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
  const results = (response.results ?? []) as unknown[];
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

  return 'unknown';
}

/**
 * Count unique fragile edges across all option results.
 * Deduplicates by edge_id.
 */
function deriveFragileEdgeCount(response: V2RunResponseEnvelope): number {
  const results = (response.results ?? []) as unknown[];
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
  const results = (response.results ?? []) as unknown[];
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
 * Derive top drivers across all option results.
 * Collects unique factors by node_id (or factor_id), takes max absolute sensitivity,
 * sorts descending, returns top 5.
 */
function deriveTopDrivers(
  response: V2RunResponseEnvelope,
  graphNodeLabels?: Map<string, string>,
): DriverSummary[] {
  const results = (response.results ?? []) as unknown[];
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

    // Extract options
    const results = (response.results ?? []) as unknown[];
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
        const outcomeMean = typeof r.outcome_mean === 'number' ? r.outcome_mean : 0;
        const probOfGoal = typeof r.probability_of_goal === 'number' ? r.probability_of_goal : undefined;

        const summary: OptionSummary = {
          option_id: optionId,
          option_label: optionLabel,
          win_probability: winProb,
          outcome_mean: outcomeMean,
        };
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

    const summary: AnalysisResponseSummary = {
      winner: winner ?? { option_id: '', option_label: '', win_probability: 0 },
      options,
      top_drivers: topDrivers,
      robustness_level: robustnessLevel,
      fragile_edge_count: fragileEdgeCount,
      analysis_status: status,
    };

    if (constraintTensions !== undefined) {
      summary.constraint_tensions = constraintTensions;
    }

    return summary;
  } catch (err) {
    log.error({ err }, 'compactAnalysis: unexpected error — returning null');
    return null;
  }
}
