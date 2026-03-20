/**
 * Validation Pipeline — Edge Comparison
 *
 * Applies five semantic threshold rules to determine whether a Pass 1 edge and
 * its bias-adjusted Pass 2 counterpart disagree enough to be flagged as
 * 'contested'. Also computes a max_divergence score (0–1) that drives
 * calibration tray ordering (higher = more disagreement).
 *
 * Rules (applied in priority order — first matching reason is added):
 *   1. Sign flip:             sign(pass1.mean) ≠ sign(pass2adj.mean)   → always contested
 *   2. Strength band change:  BOTH values in core of DIFFERENT bands    → contested
 *   3. Confidence band change: same rule for std (uncertainty band)     → contested
 *   4. EP boundary crossing:  pass1 and pass2adj on opposite sides of
 *                             any of [0.5, 0.70, 0.93]                 → contested
 *   5. Raw magnitude catch-all: |Δmean| > 0.20, none of 1–4 triggered  → contested
 *
 * Buffer zones between core bands are intentional: values in a buffer are
 * excluded from band-change detection to suppress noise around boundaries.
 *
 * Source of truth: validation_comparison_spec_v1_4.md §Comparison Rules.
 */

import { VALIDATION_CONSTANTS } from './constants.js';
import type {
  ContestedReason,
  EstimateBasis,
  LintEntry,
  ValidationMetadata,
} from './types.js';
import type { EdgeV3T } from '../../schemas/cee-v3.js';
import type { LintedPass2Estimate } from './types.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Compares a Pass 1 edge with its bias-corrected Pass 2 estimate and returns
 * fully-populated ValidationMetadata for that edge.
 *
 * @param pass1Edge        The edge as it exists in the current (Pass 1) graph.
 * @param pass2Linted      Raw Pass 2 estimate (after enforcement lints).
 * @param pass2Adjusted    Bias-corrected Pass 2 estimate (values to compare against).
 * @param lintLog          Lint entries for this edge (subset of the full lint log).
 * @param distanceToGoal   Topological hop distance from pass1Edge.to to goal.
 */
export function compareEdge(
  pass1Edge: EdgeV3T,
  pass2Linted: LintedPass2Estimate,
  pass2Adjusted: LintedPass2Estimate,
  lintLog: LintEntry[],
  distanceToGoal: number,
): ValidationMetadata {
  const p1Mean = pass1Edge.strength?.mean ?? 0;
  const p1Std = pass1Edge.strength?.std ?? 0;
  const p1Ep = pass1Edge.exists_probability ?? 0;

  const p2Mean = pass2Adjusted.strength.mean;
  const p2Std = pass2Adjusted.strength.std;
  const p2Ep = pass2Adjusted.exists_probability;

  const contestedReasons: ContestedReason[] = [];

  // ── Rule 1: Sign flip ────────────────────────────────────────────────────
  const signFlip = p1Mean !== 0 && p2Mean !== 0 && Math.sign(p1Mean) !== Math.sign(p2Mean);
  if (signFlip) {
    contestedReasons.push('sign_flip');
  }

  // ── Rule 2: Strength band change ─────────────────────────────────────────
  const p1StrengthBand = strengthBand(Math.abs(p1Mean));
  const p2StrengthBand = strengthBand(Math.abs(p2Mean));
  if (
    p1StrengthBand !== null &&
    p2StrengthBand !== null &&
    p1StrengthBand !== p2StrengthBand
  ) {
    contestedReasons.push('strength_band_change');
  }

  // ── Rule 3: Confidence band change ───────────────────────────────────────
  const p1ConfBand = confidenceBand(p1Std);
  const p2ConfBand = confidenceBand(p2Std);
  if (
    p1ConfBand !== null &&
    p2ConfBand !== null &&
    p1ConfBand !== p2ConfBand
  ) {
    contestedReasons.push('confidence_band_change');
  }

  // ── Rule 4: EP boundary crossing ─────────────────────────────────────────
  if (crossesEpBoundary(p1Ep, p2Ep)) {
    contestedReasons.push('existence_boundary_crossing');
  }

  // ── Rule 5: Raw magnitude catch-all ──────────────────────────────────────
  if (
    contestedReasons.length === 0 &&
    Math.abs(p1Mean - p2Mean) > VALIDATION_CONSTANTS.RAW_DELTA_THRESHOLD
  ) {
    contestedReasons.push('raw_magnitude');
  }

  const status: 'agreed' | 'contested' = contestedReasons.length > 0 ? 'contested' : 'agreed';
  const signUnstable = contestedReasons.includes('sign_flip');

  // ── Max divergence score ──────────────────────────────────────────────────
  const maxDivergence = computeMaxDivergence(
    p1Mean,
    p2Mean,
    p1StrengthBand,
    p2StrengthBand,
    p1Ep,
    p2Ep,
    signFlip,
  );

  // ── Bias offsets (zeroed — caller fills from GraphValidationSummary) ──────
  // The edge-level ValidationMetadata stores bias offsets for auditability;
  // the caller (index.ts) fills them from the computed BiasOffsets.
  // We use identity offsets here; the pipeline orchestrator overwrites them.
  const biasCorrectionZero = {
    strength_mean_offset: 0,
    strength_std_offset: 0,
    exists_probability_offset: 0,
  };

  return {
    status,
    contested_reasons: contestedReasons,

    pass1: {
      strength_mean: p1Mean,
      strength_std: p1Std,
      exists_probability: p1Ep,
    },

    pass2: {
      strength_mean: pass2Linted.strength.mean,
      strength_std: pass2Linted.strength.std,
      exists_probability: pass2Linted.exists_probability,
      reasoning: pass2Linted.reasoning,
      basis: pass2Linted.basis as EstimateBasis,
      needs_user_input: pass2Linted.needs_user_input,
      lint_corrected: pass2Linted.lint_corrected,
    },

    pass2_adjusted: {
      strength_mean: p2Mean,
      strength_std: p2Std,
      exists_probability: p2Ep,
    },

    bias_correction: biasCorrectionZero,

    max_divergence: maxDivergence,
    distance_to_goal: distanceToGoal,

    sign_unstable: signUnstable,
    pass2_missing: false,

    evoi_rank: null,
    evoi_impact: null,

    was_shown: false,
    user_action: 'pending',
    resolved_value: null,
    resolved_by: 'default',

    validation_lint_log: lintLog,
  };
}

/**
 * Builds a ValidationMetadata stub for edges that Pass 2 did not return an
 * estimate for. Status is forced to 'agreed', pass2 fields use Pass 1 values
 * as defaults, and pass2_missing is set to true.
 */
export function buildMissingPass2Metadata(
  pass1Edge: EdgeV3T,
  distanceToGoal: number,
): ValidationMetadata {
  const p1Mean = pass1Edge.strength?.mean ?? 0;
  const p1Std = pass1Edge.strength?.std ?? 0;
  const p1Ep = pass1Edge.exists_probability ?? 0;

  return {
    status: 'agreed',
    contested_reasons: [],

    pass1: {
      strength_mean: p1Mean,
      strength_std: p1Std,
      exists_probability: p1Ep,
    },

    pass2: {
      strength_mean: 0,
      strength_std: 0,
      exists_probability: 0,
      reasoning: '',
      basis: 'weak_guess',
      needs_user_input: false,
      lint_corrected: false,
    },

    pass2_adjusted: {
      strength_mean: 0,
      strength_std: 0,
      exists_probability: 0,
    },

    bias_correction: {
      strength_mean_offset: 0,
      strength_std_offset: 0,
      exists_probability_offset: 0,
    },

    max_divergence: 0,
    distance_to_goal: distanceToGoal,

    sign_unstable: false,
    pass2_missing: true,

    evoi_rank: null,
    evoi_impact: null,

    was_shown: false,
    user_action: 'pending',
    resolved_value: null,
    resolved_by: 'default',

    validation_lint_log: [],
  };
}

// ============================================================================
// Strength band classification
// ============================================================================

type StrengthBand = 'negligible' | 'weak' | 'moderate' | 'strong';

/**
 * Returns the core strength band for an absolute mean value.
 * Returns null if the value falls in a buffer zone (no band applies).
 */
function strengthBand(absMean: number): StrengthBand | null {
  const C = VALIDATION_CONSTANTS;
  if (absMean < C.STRENGTH_NEGLIGIBLE_MAX) return 'negligible';
  // Buffer: 0.05 – 0.10
  if (absMean >= C.STRENGTH_WEAK_CORE_MIN && absMean <= C.STRENGTH_WEAK_CORE_MAX) return 'weak';
  // Buffer: 0.25 – 0.30
  if (absMean >= C.STRENGTH_MODERATE_CORE_MIN && absMean <= C.STRENGTH_MODERATE_CORE_MAX) return 'moderate';
  // Buffer: 0.55 – 0.65
  if (absMean >= C.STRENGTH_STRONG_CORE_MIN) return 'strong';
  return null; // buffer zone
}

// ============================================================================
// Confidence band classification
// ============================================================================

type ConfidenceBand = 'high' | 'moderate' | 'low';

/**
 * Returns the core confidence band for a std value.
 * Returns null if the value falls in a buffer zone.
 */
function confidenceBand(std: number): ConfidenceBand | null {
  const C = VALIDATION_CONSTANTS;
  if (std < C.CONFIDENCE_HIGH_MAX) return 'high';
  // Buffer: 0.08 – 0.12
  if (std >= C.CONFIDENCE_MODERATE_MIN && std <= C.CONFIDENCE_MODERATE_MAX) return 'moderate';
  // Buffer: 0.18 – 0.22
  if (std >= C.CONFIDENCE_LOW_MIN) return 'low';
  return null; // buffer zone
}

// ============================================================================
// EP boundary crossing
// ============================================================================

/**
 * Returns true if p1Ep and p2Ep sit on opposite sides of any EP boundary.
 */
function crossesEpBoundary(p1Ep: number, p2Ep: number): boolean {
  for (const boundary of VALIDATION_CONSTANTS.EP_BOUNDARIES) {
    const p1Above = p1Ep >= boundary;
    const p2Above = p2Ep >= boundary;
    if (p1Above !== p2Above) return true;
  }
  return false;
}

// ============================================================================
// Max divergence score
// ============================================================================

function computeMaxDivergence(
  p1Mean: number,
  p2Mean: number,
  p1Band: StrengthBand | null,
  p2Band: StrengthBand | null,
  p1Ep: number,
  p2Ep: number,
  signFlip: boolean,
): number {
  const C = VALIDATION_CONSTANTS;

  // Sign score: 1.0 if sign differs.
  const signScore = signFlip ? 1.0 : 0.0;

  // Band score: core_band_distance / STRENGTH_BAND_STEPS.
  const bandOrder: Record<StrengthBand, number> = {
    negligible: 0,
    weak: 1,
    moderate: 2,
    strong: 3,
  };
  let bandScore = 0;
  if (p1Band !== null && p2Band !== null) {
    const dist = Math.abs(bandOrder[p1Band] - bandOrder[p2Band]);
    bandScore = dist / C.STRENGTH_BAND_STEPS;
  }

  // EP score: boundaries_crossed / EP_BOUNDARY_COUNT.
  let boundariesCrossed = 0;
  for (const boundary of C.EP_BOUNDARIES) {
    if ((p1Ep >= boundary) !== (p2Ep >= boundary)) boundariesCrossed++;
  }
  const epScore = boundariesCrossed / C.EP_BOUNDARY_COUNT;

  // Raw score: min(1, |Δmean| / MAX_DIVERGENCE_MEAN_DIVISOR).
  const rawScore = Math.min(1.0, Math.abs(p1Mean - p2Mean) / C.MAX_DIVERGENCE_MEAN_DIVISOR);

  return Math.max(signScore, bandScore, epScore, rawScore);
}

