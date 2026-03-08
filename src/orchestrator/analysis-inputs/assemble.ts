/**
 * Analysis Inputs Summary — reference assembler (testing only).
 *
 * The UI is the sole production assembler (it has V2RunResponse in its store).
 * This reference implementation exists for contract testing and fixture generation.
 *
 * Reads fields from V2RunResponseEnvelope using the same access patterns
 * as existing CEE consumers (turn-handler.ts, post-analysis.ts).
 */

import type { V2RunResponseEnvelope } from "../types.js";
import {
  AnalysisInputsSummaryPayload,
  ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION,
} from "../../schemas/analysis-inputs-summary.js";
import type { AnalysisInputsSummary } from "../../schemas/analysis-inputs-summary.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Internal types for defensive reading
// ============================================================================

interface OptionResult {
  option_id?: string;
  option_label?: string;
  win_probability?: number;
  [k: string]: unknown;
}

interface FactorSensitivity {
  factor_id?: string;
  label?: string;
  elasticity?: number;
  direction?: string;
  [k: string]: unknown;
}

interface ConstraintEntry {
  label?: string;
  satisfied?: boolean;
  probability?: number;
  constraint_probability?: number;
  [k: string]: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

function readOptions(v2: V2RunResponseEnvelope): OptionResult[] {
  if (!Array.isArray(v2.results)) return [];
  return v2.results
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      option_id: typeof r.option_id === 'string' ? r.option_id : String(r.option_id ?? ''),
      option_label: typeof r.option_label === 'string' ? r.option_label : undefined,
      win_probability: typeof r.win_probability === 'number' ? r.win_probability : undefined,
    }))
    .filter((o) => o.option_label && o.win_probability !== undefined) as OptionResult[];
}

function readDrivers(v2: V2RunResponseEnvelope): FactorSensitivity[] {
  // factor_sensitivity is TOP-LEVEL on V2RunResponseEnvelope
  const raw = v2.factor_sensitivity;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      factor_id: typeof r.factor_id === 'string' ? r.factor_id : undefined,
      label: typeof r.label === 'string' ? r.label : undefined,
      elasticity: typeof r.elasticity === 'number' ? r.elasticity : undefined,
    }))
    .filter((d) => d.label && d.elasticity !== undefined) as FactorSensitivity[];
}

function readConstraints(v2: V2RunResponseEnvelope): ConstraintEntry[] {
  const ca = v2.constraint_analysis;
  if (!ca || !Array.isArray(ca.per_constraint)) return [];
  return ca.per_constraint
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .map((c) => ({
      label: typeof c.label === 'string' ? c.label : typeof c.constraint_label === 'string' ? c.constraint_label : undefined,
      satisfied: typeof c.satisfied === 'boolean' ? c.satisfied : (typeof c.probability === 'number' ? c.probability >= 0.5 : true),
      probability: typeof c.probability === 'number' ? c.probability : typeof c.constraint_probability === 'number' ? c.constraint_probability : undefined,
    }))
    .filter((c) => c.label) as ConstraintEntry[];
}

function computeSensitivityConcentration(drivers: FactorSensitivity[]): number {
  if (drivers.length === 0) return 0;
  const allElasticities = drivers.map((d) => Math.abs(d.elasticity ?? 0));
  const total = allElasticities.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const top3 = allElasticities.slice(0, 3).reduce((a, b) => a + b, 0);
  return Math.min(1, top3 / total);
}

function mapRobustnessLevel(raw: string | undefined): 'robust' | 'moderate' | 'fragile' {
  if (raw === 'robust') return 'robust';
  if (raw === 'fragile') return 'fragile';
  return 'moderate';
}

function mapConfidenceBand(v2: V2RunResponseEnvelope): 'low' | 'medium' | 'high' | null {
  // Use robustness.overall_confidence from V2RunResponse if available (fix #6)
  const robustness = v2.robustness as Record<string, unknown> | undefined;
  if (robustness && typeof robustness.overall_confidence === 'number') {
    const oc = robustness.overall_confidence;
    if (oc >= 0.7) return 'high';
    if (oc >= 0.4) return 'medium';
    return 'low';
  }
  return null;
}

// ============================================================================
// Main assembler
// ============================================================================

/**
 * Assemble an AnalysisInputsSummary from a V2RunResponseEnvelope.
 *
 * Reference implementation for testing only — the UI assembles in production.
 * Returns null if the response lacks required data (results, meta).
 */
export function assembleAnalysisInputsSummary(
  v2Response: V2RunResponseEnvelope,
): AnalysisInputsSummary | null {
  try {
    const options = readOptions(v2Response);
    if (options.length === 0) {
      log.warn({ reason: 'no_valid_options' }, 'assembleAnalysisInputsSummary: no valid options in V2RunResponse');
      return null;
    }

    // Sort by win_probability descending — winner is first
    const sorted = [...options].sort(
      (a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0),
    );
    const winner = sorted[0];

    // Drivers: sorted by abs(elasticity) desc, capped at 3
    const allDrivers = readDrivers(v2Response);
    allDrivers.sort((a, b) => Math.abs(b.elasticity ?? 0) - Math.abs(a.elasticity ?? 0));
    let topDrivers = allDrivers.slice(0, 3);

    const sensitivityConcentration = computeSensitivityConcentration(allDrivers);

    const robustness = v2Response.robustness as Record<string, unknown> | undefined;
    // Read recommendation_stability directly from V2RunResponse (fix #6)
    const recommendationStability = robustness && typeof robustness.recommendation_stability === 'number'
      ? robustness.recommendation_stability
      : null;

    // Constraints: capped at 5
    let constraintEntries = readConstraints(v2Response).slice(0, 5);

    const meta = v2Response.meta;

    const payload = {
      contract_version: ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION as '1.0.0',
      recommendation: {
        option_id: winner.option_id ?? '',
        option_label: winner.option_label ?? '',
        win_probability: winner.win_probability ?? 0,
      },
      options: sorted.map((o) => ({
        id: o.option_id ?? '',
        label: o.option_label ?? '',
        win_probability: o.win_probability ?? 0,
      })),
      top_drivers: topDrivers.map((d) => ({
        factor_id: d.factor_id ?? '',
        factor_label: d.label ?? '',
        elasticity: d.elasticity ?? 0,
      })),
      sensitivity_concentration: sensitivityConcentration,
      confidence_band: mapConfidenceBand(v2Response),
      robustness: {
        level: mapRobustnessLevel(robustness?.level as string | undefined),
        recommendation_stability: recommendationStability,
      },
      constraints_status: constraintEntries.map((c) => ({
        label: c.label ?? '',
        satisfied: c.satisfied ?? true,
        ...(c.probability !== undefined ? { probability: c.probability } : {}),
      })),
      run_metadata: {
        seed: meta.seed_used,
        quality_mode: typeof meta.quality_mode === 'string' ? meta.quality_mode : 'default',
        timestamp: new Date().toISOString(),
      },
    };

    // 2KB cap enforcement (fix #7): trim constraints_status then top_drivers
    const encoder = new TextEncoder();
    let byteLen = encoder.encode(JSON.stringify(payload)).length;
    while (byteLen > 2048 && payload.constraints_status.length > 0) {
      payload.constraints_status.pop();
      byteLen = encoder.encode(JSON.stringify(payload)).length;
    }
    while (byteLen > 2048 && payload.top_drivers.length > 0) {
      payload.top_drivers.pop();
      byteLen = encoder.encode(JSON.stringify(payload)).length;
    }

    const result = AnalysisInputsSummaryPayload.safeParse(payload);
    if (!result.success) {
      log.warn(
        { errors: result.error.flatten() },
        'assembleAnalysisInputsSummary: safeParse failed',
      );
      return null;
    }

    return result.data;
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'assembleAnalysisInputsSummary: unexpected error',
    );
    return null;
  }
}
