/**
 * V5 robustness honesty — shared single source of truth for deterministic
 * post-analysis copy guards. Originally introduced by PR #193 inside
 * `routing/post-analysis-advice-gate.ts` for the free-text advice gate; the
 * helpers now live here so the chip-click `what_would_flip` fallback (and
 * any future deterministic composer) can reuse the same near-tie /
 * raw-fragile decisions without duplicating the truth table.
 *
 * Inputs are deliberately structural (`marginPp: number | null | undefined`,
 * `rawRobustness: RawRobustnessSignals | null | undefined`) so consumers do
 * not need to assemble an `AdviceGateAnalysis` to use the helpers. The
 * advice gate keeps `AdviceGateAnalysis`-typed thin wrappers around these
 * for ergonomics inside that file.
 *
 * Thresholds, labels, and override semantics are owned here. Do NOT
 * duplicate or redefine them elsewhere.
 */

import type { RawRobustnessSignals } from './pick-raw-robustness.js';

// Re-export so a single import site (`robustness-honesty.js`) is enough for
// callers that want both helpers and the input type.
export type { RawRobustnessSignals };

/**
 * Near-tie threshold (percentage points, inclusive). When the projected
 * margin between the leading option and the runner-up is at or under this
 * value, user-facing post-analysis copy MUST avoid strength claims
 * ("meaningful rather than marginal", "strongly favours", stability
 * assertions) and describe the result as effectively tied. Chosen at
 * 1.0pp deliberately: tight enough to avoid false confidence, wide enough
 * to read as honest user-facing wording. NOT reused from the deterministic
 * `CLOSE_CALL_THRESHOLD = 0.05` (5pp) constant in `turn-context.ts` —
 * that signal is internal and far too wide for user-facing copy.
 */
export const NEAR_TIE_PP_THRESHOLD = 1.0;

/**
 * Raw robustness levels that MUST suppress moderate/stable user-facing
 * copy. Read defensively from the run_analysis fact's
 * `enrichment.robustness.level` (when available) so the composer can
 * prefer the raw signal over a canonicalised projection band that may
 * have already been coerced by a lossy mapping.
 */
export const RAW_FRAGILE_LEVELS: ReadonlySet<string> = new Set([
  'very_low',
  'low',
  'fragile',
]);

/**
 * True when the projected margin is at or below the near-tie threshold
 * OR the raw `near_tie.is_tie` override flag is set. The raw flag wins
 * even when the margin is wider — upstream knows things the projection
 * does not.
 */
export function isNearTieByMargin(
  marginPp: number | null | undefined,
  rawRobustness: RawRobustnessSignals | null | undefined,
): boolean {
  if (rawRobustness?.near_tie_is_tie === true) return true;
  if (typeof marginPp !== 'number' || !Number.isFinite(marginPp)) return false;
  return Math.abs(marginPp) <= NEAR_TIE_PP_THRESHOLD;
}

/**
 * Discriminate why a near-tie verdict was reached so composers can pick
 * copy that is numerically true on every branch.
 *
 * - `'margin'` => the projected `marginPp` triggered the verdict (and is
 *   finite + ≤ threshold).
 * - `'override'` => the raw `near_tie.is_tie` flag drove the decision
 *   (the margin may be wider, null, or absent).
 * - `null` => not a near-tie.
 */
export function nearTieReasonByMargin(
  marginPp: number | null | undefined,
  rawRobustness: RawRobustnessSignals | null | undefined,
): 'margin' | 'override' | null {
  if (!isNearTieByMargin(marginPp, rawRobustness)) return null;
  if (
    typeof marginPp === 'number'
    && Number.isFinite(marginPp)
    && Math.abs(marginPp) <= NEAR_TIE_PP_THRESHOLD
  ) {
    return 'margin';
  }
  return 'override';
}

/**
 * True when the raw `enrichment.robustness.level` is one of the fragile
 * synonyms (`very_low`, `low`, `fragile`). Lower-casing of `level` is the
 * picker's responsibility (`pickLatestRawRobustness` normalises).
 */
export function isRawFragile(
  rawRobustness: RawRobustnessSignals | null | undefined,
): boolean {
  const level = rawRobustness?.level;
  return typeof level === 'string' && RAW_FRAGILE_LEVELS.has(level);
}

/**
 * Map a canonical robustness band (`fragile` | `moderate` | `stable` |
 * `highly_stable`) to a calm, plain-language phrase for USER-FACING copy.
 * The raw enum value — especially the snake_case `highly_stable` — must
 * never reach a user; callers interpolate the returned phrase instead of the
 * band token, and never the words "robustness band". Returns `null` for an
 * unknown / absent band so callers omit the sentence rather than leak a token.
 *
 * Single source of truth — do NOT duplicate this mapping elsewhere.
 */
export function describeRobustnessBand(
  band: string | null | undefined,
): string | null {
  switch (band) {
    case 'highly_stable':
      return 'very stable';
    case 'stable':
      return 'stable';
    case 'moderate':
      return 'fairly stable';
    case 'fragile':
      return 'fragile';
    default:
      return null;
  }
}
