/**
 * SCI-DEEP v1 — noise verdicts for a structural challenge's claims (contract `RunDeltaNoiseVerdict`, reused).
 *
 * Every verdict is the INDEPENDENT-RUN form: removing a link changes the draw structure, so the two Runs are never
 * common-random-number pairs and their variances add (the reason `win-probability-noise-band.ts` gives, which this
 * module follows rather than restating a second rule).
 *
 *   proportions  — `noiseVerdictForProportions` (the ONE band: 2 SE of the difference of two binomial proportions).
 *                  Where that band refuses (`not_noise_qualified`) BECAUSE a side sits at an exact 0 or 1 — precisely
 *                  the certainty boundary this challenge must judge — the fallback is the more conservative Wilson
 *                  score test at the same z: `signal` only when the two Runs' Wilson intervals are disjoint. Wilson is
 *                  valid at 0 and 1, where the normal approximation is not. Any other refusal stands.
 *   lead         — the leader's win share against the runner-up's within ONE Run: `signal` only when their Wilson
 *                  intervals are disjoint (a near tie is `within_noise`, never a held leader).
 *   means        — 2 SE of the difference of two independent sample means (CLT). A side with zero variance has no Monte
 *                  Carlo noise: equal values (to 1e-9 relative) are `within_noise`, different values are `signal`.
 */
import type { RunDeltaNoiseVerdictLiteral } from '@talchain/schemas/boundary';

import { NOISE_BAND_SE_MULTIPLE, noiseVerdictForProportions } from './win-probability-noise-band.js';

const Z = NOISE_BAND_SE_MULTIPLE;
/** Relative tolerance below which two means are the same number (IEEE jitter of a deterministic outcome). */
const FLOAT_TOL = 1e-9;

/** Wilson score interval for a proportion `p` observed over `n` draws, at z = {@link NOISE_BAND_SE_MULTIPLE}. */
export function wilsonInterval(p: number, n: number): { readonly low: number; readonly high: number } {
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const disjoint = (a: { low: number; high: number }, b: { low: number; high: number }) => a.high < b.low || b.high < a.low;
const valid = (p: number, n: number) => Number.isFinite(p) && p >= 0 && p <= 1 && Number.isFinite(n) && n > 0;

export function proportionChangeNoise(prior: number, current: number, priorN: number, currentN: number): RunDeltaNoiseVerdictLiteral {
  if (!valid(prior, priorN) || !valid(current, currentN)) return 'not_noise_qualified';
  const banded = noiseVerdictForProportions(prior, current, priorN, currentN);
  if (banded !== 'not_noise_qualified') return banded;
  const atCertainty = [prior, current].some((p) => p === 0 || p === 1);
  if (!atCertainty) return banded;
  return disjoint(wilsonInterval(prior, priorN), wilsonInterval(current, currentN)) ? 'signal' : 'within_noise';
}

export function leadNoise(leaderShare: number, runnerUpShare: number, n: number): RunDeltaNoiseVerdictLiteral {
  if (!valid(leaderShare, n) || !valid(runnerUpShare, n)) return 'not_noise_qualified';
  if (leaderShare < runnerUpShare) return 'not_noise_qualified';
  // A disjoint interval in the wrong direction is evidence AGAINST the recorded leader.
  return wilsonInterval(leaderShare, n).low > wilsonInterval(runnerUpShare, n).high ? 'signal' : 'within_noise';
}

export function meanChangeNoise(
  prior: { readonly mean: number; readonly sd: number; readonly n: number },
  current: { readonly mean: number; readonly sd: number; readonly n: number },
): RunDeltaNoiseVerdictLiteral {
  const ok = (s: typeof prior) => Number.isFinite(s.mean) && Number.isFinite(s.sd) && s.sd >= 0 && Number.isFinite(s.n) && s.n > 0;
  if (!ok(prior) || !ok(current)) return 'not_noise_qualified';
  const variance = (prior.sd * prior.sd) / prior.n + (current.sd * current.sd) / current.n;
  const delta = Math.abs(current.mean - prior.mean);
  // Floating-point jitter on a deterministic outcome is not a difference.
  if (delta <= FLOAT_TOL * Math.max(1, Math.abs(prior.mean), Math.abs(current.mean))) return 'within_noise';
  if (!(variance > 0)) return 'signal';
  return delta > Z * Math.sqrt(variance) ? 'signal' : 'within_noise';
}
