/**
 * The A2 display-scale predicate for a top-level `enrichment.flip_thresholds[]`
 * row, read by the Agent's tipping point (`../agent-lane/decision-sensitivity.ts`
 * `tippingPointOf`).
 *
 * ⚠ DELETION 10 (track2, 22 Oct 2026): this module used to hold the
 * analysis→LLM signal derivers (tipping points, evidence gaps, goal fit,
 * per-option goal fits and outcomes, confidence tier) and the flip display
 * licence. Their only caller was the prior-facts summary builder, whose result
 * nobody read, so they were deleted with it. The original is kept in
 * `evidence/track2-deletion10-20261022/deleted/`.
 */

import { readRowValueScale, MODEL_SCALE_SUSPECT_ABS } from './flip-threshold-rows.js';

/**
 * A2 — is this row's pair safe to describe with a user-scale display string?
 * Fail-closed in every branch that is not a positive attestation.
 *
 * FAIL-CLOSED, matching `classifyValueScale`'s shape:
 *   - `value_scale` resolving to `'display'` → permitted;
 *   - `'model'` or ANY other non-empty token → REFUSED (we hold no `cap`, so we
 *     cannot invert, and guessing is how the two-numbers case ships);
 *   - ABSENT → permitted only when both raw values sit OUTSIDE the normalised
 *     `[-1, 1]` band, i.e. they cannot be an uninverted model value.
 */
export function flipRowScaleIsDisplaySafe(
  row: Record<string, unknown>,
  currentValue: number,
  flipValue: number,
): boolean {
  const raw = readRowValueScale(row);
  const scale = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (scale === 'display') return true;
  if (scale.length > 0) return false; // 'model' or unrecognised → closed
  // Absent: only safe when neither value could be an uninverted model value.
  return Math.abs(currentValue) > MODEL_SCALE_SUSPECT_ABS &&
    Math.abs(flipValue) > MODEL_SCALE_SUSPECT_ABS;
}
