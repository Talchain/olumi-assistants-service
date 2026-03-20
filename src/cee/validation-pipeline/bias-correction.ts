/**
 * Validation Pipeline — Bias Correction
 *
 * Computes systematic per-parameter offsets between Pass 1 (Sonnet 4.6) and
 * Pass 2 (o4-mini) across all edges in a single graph, then applies those
 * offsets to raw Pass 2 values before the comparison step.
 *
 * Rationale: models can have consistent directional biases (e.g. o4-mini
 * consistently estimating means ~0.1 lower than Sonnet). Correcting for this
 * median offset prevents systematic disagreements from flooding the calibration
 * tray with false positives.
 *
 * Algorithm:
 *   offset[param] = median(pass1[param] - pass2[param])  for each matched edge
 *
 * Extreme offsets (|offset| > EXTREME_BIAS_OFFSET_LIMIT = 0.3) are discarded:
 * an offset that large suggests that the models are looking at the problem very
 * differently, not just a systematic bias — applying it would over-correct.
 *
 * Source of truth: validation_comparison_spec_v1_4.md §Bias Correction.
 */

import { VALIDATION_CONSTANTS } from './constants.js';
import type { BiasOffsets, LintedPass2Estimate } from './types.js';
import type { EdgeV3T } from '../../schemas/cee-v3.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Computes per-parameter median offsets (pass1 − pass2) across all edge pairs
 * that appear in both Pass 1 and Pass 2 outputs.
 *
 * If an offset exceeds EXTREME_BIAS_OFFSET_LIMIT (0.3), it is set to 0 and a
 * warning is emitted via the returned `warnings` array.
 */
export function computeBiasOffsets(
  pass1Edges: EdgeV3T[],
  pass2Edges: LintedPass2Estimate[],
): { offsets: BiasOffsets; warnings: string[] } {
  const warnings: string[] = [];

  // Build a lookup of Pass 2 edges by key for fast matching.
  const pass2ByKey = new Map<string, LintedPass2Estimate>();
  for (const e of pass2Edges) {
    pass2ByKey.set(edgeKey(e.from, e.to), e);
  }

  // Collect per-parameter deltas from matched edges only.
  const meanDeltas: number[] = [];
  const stdDeltas: number[] = [];
  const epDeltas: number[] = [];

  for (const p1 of pass1Edges) {
    const p2 = pass2ByKey.get(edgeKey(p1.from, p1.to));
    if (!p2) continue;

    meanDeltas.push((p1.strength?.mean ?? 0) - p2.strength.mean);
    stdDeltas.push((p1.strength?.std ?? 0) - p2.strength.std);
    epDeltas.push((p1.exists_probability ?? 0) - p2.exists_probability);
  }

  const rawMeanOffset = meanDeltas.length > 0 ? median(meanDeltas) : 0;
  const rawStdOffset = stdDeltas.length > 0 ? median(stdDeltas) : 0;
  const rawEpOffset = epDeltas.length > 0 ? median(epDeltas) : 0;

  const { meanOffset, stdOffset, epOffset } = guardExtremeOffsets(
    rawMeanOffset,
    rawStdOffset,
    rawEpOffset,
    warnings,
  );

  return {
    offsets: {
      strength_mean: meanOffset,
      strength_std: stdOffset,
      exists_probability: epOffset,
    },
    warnings,
  };
}

/**
 * Applies bias offsets to each Pass 2 estimate, returning new objects with
 * adjusted values clamped to valid ranges.
 *
 * - strength_mean: no clamping (negative means are valid)
 * - strength_std: clamped to [0, ∞)
 * - exists_probability: clamped to [0, 1]
 */
export function applyBiasCorrection(
  pass2Edges: LintedPass2Estimate[],
  offsets: BiasOffsets,
): LintedPass2Estimate[] {
  return pass2Edges.map((e) => ({
    ...e,
    strength: {
      mean: e.strength.mean + offsets.strength_mean,
      std: Math.max(0, e.strength.std + offsets.strength_std),
    },
    exists_probability: clamp(e.exists_probability + offsets.exists_probability, 0, 1),
  }));
}

// ============================================================================
// Private helpers
// ============================================================================

/** Compute the median of a non-empty number array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Guard against extreme offsets: if |offset| > EXTREME_BIAS_OFFSET_LIMIT,
 * replace with 0 and record a warning.
 */
function guardExtremeOffsets(
  rawMean: number,
  rawStd: number,
  rawEp: number,
  warnings: string[],
): { meanOffset: number; stdOffset: number; epOffset: number } {
  const limit = VALIDATION_CONSTANTS.EXTREME_BIAS_OFFSET_LIMIT;

  let meanOffset = rawMean;
  let stdOffset = rawStd;
  let epOffset = rawEp;

  if (Math.abs(rawMean) > limit) {
    warnings.push(
      `WARN_EXTREME_BIAS_OFFSET: strength_mean offset ${rawMean.toFixed(3)} exceeds limit ${limit}; set to 0`,
    );
    meanOffset = 0;
  }
  if (Math.abs(rawStd) > limit) {
    warnings.push(
      `WARN_EXTREME_BIAS_OFFSET: strength_std offset ${rawStd.toFixed(3)} exceeds limit ${limit}; set to 0`,
    );
    stdOffset = 0;
  }
  if (Math.abs(rawEp) > limit) {
    warnings.push(
      `WARN_EXTREME_BIAS_OFFSET: exists_probability offset ${rawEp.toFixed(3)} exceeds limit ${limit}; set to 0`,
    );
    epOffset = 0;
  }

  return { meanOffset, stdOffset, epOffset };
}

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
