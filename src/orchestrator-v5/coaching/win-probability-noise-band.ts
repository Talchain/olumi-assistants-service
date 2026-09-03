/**
 * THE ONE NOISE BAND for an option's win-probability movement between two runs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL. The band and its two constants lived privately
 * inside `build-run-delta.ts` and had exactly one consumer: the WIRE
 * `run_delta` block. A second consumer now needs the same question answered —
 * the deterministic PROSE that quantifies a movement — and the wrong way to
 * give it one is a second inequality. So the band moves here and
 * `build-run-delta.ts` imports it: one implementation, two readers, no drift
 * (CLAUDE.md trap #12).
 *
 * ⚠ THE MOVE IS BEHAVIOUR-NEUTRAL BY CONSTRUCTION. The function body, both
 * constants and every comment below are the originals; nothing was re-derived
 * while relocating them. A reviewer should be able to diff the moved block
 * against `build-run-delta.ts`'s prior revision and find no semantic change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { RunDeltaNoiseVerdictLiteral } from '@talchain/schemas/boundary';

/**
 * How many standard errors a movement must exceed to be called `signal`.
 *
 * 2 SE is the ~95% two-sided normal approximation to the binomial. It is a
 * CHOICE and it is named here so a reviewer can argue with the number rather
 * than reverse-engineer it from an inequality.
 *
 * ⚠ INDEPENDENT-RUN FORM, deliberately. The contract states the reason:
 * *"the CRN limit means same-seed pairing gives NO variance reduction across
 * edits; the band never assumes it does"*. So the two runs are treated as
 * independent samples and the variances ADD. Assuming pairing would shrink the
 * band and manufacture `signal` verdicts out of noise — the fabrication this
 * whole block exists to refuse.
 */
export const NOISE_BAND_SE_MULTIPLE = 2;

/**
 * The normal approximation to the binomial is only defensible when both
 * successes and failures are reasonably numerous; the textbook floor is 5.
 * Below it the band would be wrong in a direction we cannot bound, so the
 * quantity is reported as `not_noise_qualified` — the contract's own state for
 * *"no honest band exists for this quantity on this pair"* — and rendered as
 * direction only.
 *
 * ⚠ THIS GUARD IS WRITTEN AGAINST THE SPEC (the approximation's validity
 * condition), NOT against a failure mode someone happened to hit. A guard
 * shaped like the bug that prompted it shares the bug's blind spot.
 */
export const NORMAL_APPROX_MIN_EVENTS = 5;

/**
 * Per-quantity noise entitlement for one option's win-probability movement.
 *
 * `signal` is claimed only when the movement exceeds
 * {@link NOISE_BAND_SE_MULTIPLE} standard errors of the DIFFERENCE of two
 * independent binomial proportions. Where the normal approximation does not
 * hold, the honest answer is `not_noise_qualified`, never a band we cannot
 * justify.
 */
export function noiseVerdictForProportions(
  prior: number,
  current: number,
  priorN: number,
  currentN: number,
): RunDeltaNoiseVerdictLiteral {
  const events = [
    prior * priorN,
    (1 - prior) * priorN,
    current * currentN,
    (1 - current) * currentN,
  ];
  if (events.some((count) => count < NORMAL_APPROX_MIN_EVENTS)) {
    return 'not_noise_qualified';
  }

  const variance =
    (prior * (1 - prior)) / priorN + (current * (1 - current)) / currentN;
  if (!(variance > 0)) return 'not_noise_qualified';

  const standardError = Math.sqrt(variance);
  return Math.abs(current - prior) > NOISE_BAND_SE_MULTIPLE * standardError
    ? 'signal'
    : 'within_noise';
}
