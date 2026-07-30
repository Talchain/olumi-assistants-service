/**
 * ROADMAP 2.180-B — the decision_review budget, pinned to the MEASUREMENT.
 *
 * The defect: `DECISION_REVIEW_TIMEOUT_MS` sat at 22,000 ms, INSIDE the call's
 * own working latency distribution, so it cut healthy calls rather than
 * trimming a pathological tail. 12 of 363 run_analysis facts over 14 days
 * shipped no model review; every one of the 6 attributable cases was this
 * timeout. Full diagnosis:
 * PHASE0-EVIDENCE-2026-07-28/reset-suppression-probe-2180.md
 * Derivation of the replacement:
 * PHASE0-EVIDENCE-2026-07-28/fix-decision-review-budget-2180b.md
 *
 * ── DESIGN NOTES — why these pins are not vacuous ──────────────────────────
 *
 * • NO PIN SAYS `expect(DECISION_REVIEW_TIMEOUT_MS).toBe(30_000)`. That is a
 *   mirror of the line it guards: it would pass for any reason, including the
 *   wrong one, and would have to be hand-edited (and therefore silently
 *   rubber-stamped) on every future change. Every pin below states a
 *   REQUIREMENT — derived from the measured distribution on one side and from
 *   the live budget constants on the other — and lets the constant satisfy it
 *   or not. The old 22,000 fails the floor; 40,000 would fail the ceiling.
 *
 * • THE MEASUREMENT IS FROZEN TO THE HISTORICAL ARTEFACT, NOT TO "CURRENT"
 *   (trap 12b). `PROBE_2026_07_27_TO_30` is the 27-30 Jul sample as taken,
 *   permanently. Re-measuring later ADDS a record; it must never edit this one,
 *   or the control decays into a tautology the first time "current" moves.
 *
 * • IT DOES **NOT** `vi.mock` `../../../config/timeouts.js`. A `vi.mock` factory
 *   REPLACES the module (trap 12), so a budget assertion made under one
 *   measures the mock and passes forever. The sibling
 *   `decision-review-enricher.contract.test.ts` does not mock it either; this
 *   file must never start.
 *
 * • THE CEILING IS DERIVED, NOT RESTATED. It reads
 *   `getTurnExecutorBudgets().turn_ms` and `PLOT_RUN_TIMEOUT_MS` at run time
 *   rather than restating 115,000 / 40,000, so an operator lowering
 *   BROWSER_PROXY_TIMEOUT_MS or raising PLOT_RUN_TIMEOUT_MS tightens these pins
 *   automatically instead of leaving them describing a ladder that has moved.
 *
 * • LOAD-INDEPENDENT. Pure arithmetic over constants: no sleeps, no wall clock,
 *   no timers. Nothing here can flake under a starved CI worker.
 */

import { describe, it, expect } from 'vitest';

import {
  DECISION_REVIEW_TIMEOUT_MS,
  PLOT_RUN_TIMEOUT_MS,
  PROMPT_STORE_FETCH_TIMEOUT_MS,
  validateTimeoutRelationships,
} from '../../../config/timeouts.js';
import { getTurnExecutorBudgets, getHandlerBudgetMs } from '../../budgets.js';
import { config } from '../../../config/index.js';
import { DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS } from '../../../cee/decision-review/decompose.js';
import { resolveDecisionReviewHardBudgetMs } from '../decision-review-enricher.js';

/**
 * The 27-30 Jul staging sample, FROZEN. Source of record:
 * PHASE0-EVIDENCE-2026-07-28/reset-suppression-probe-2180-raw/
 * decision-review-durations-27to30jul.txt (130 lines), re-derived by the
 * 2.180-B lane rather than copied from prose.
 *
 * ⚠ THIS SAMPLE IS RIGHT-CENSORED AT 22,000 — the budget it was taken under.
 * `maxCompletedMs` is the largest duration BELOW the censoring point, not the
 * largest the call can take; the two `failed` rows are observations of unknown
 * true duration >= 22,000. Any pin phrased as "budget > observed max" would
 * therefore be re-fitting the budget to a sample the old budget shaped. The
 * floor below is built on the SPREAD instead, which censoring can only
 * under-state.
 */
const PROBE_2026_07_27_TO_30 = {
  completedCount: 128,
  minMs: 4_825,
  p50Ms: 7_178,
  p95Ms: 15_766,
  /** Largest COMPLETED call — i.e. the largest below the 22,000 censoring point. */
  maxCompletedMs: 19_802,
  /** The two censored observations, both aborts at the old wall. */
  censoredAtMs: 22_000,
  /**
   * Live captures probe4-A / probe4-B: 9,807 in / 972 out in 7,992 ms and
   * 9,601 in / 901 out in 10,169 ms. Recorded because they are what proves the
   * tail is provider THROUGHPUT variance rather than more work — B produced 7%
   * FEWER output tokens and took 27% LONGER — and therefore why cutting
   * CEE_MAX_TOKENS_DECISION_REVIEW (6,000, never approached) cannot help.
   */
  maxObservedOutputTokens: 972,
  configuredOutputCapTokens: 6_000,
} as const;

/**
 * The slowdown factor already DIRECTLY OBSERVED between the fastest and the
 * slowest completion of what is structurally the same call. Censoring makes
 * this a LOWER bound on the true spread.
 */
const OBSERVED_SPREAD =
  PROBE_2026_07_27_TO_30.maxCompletedMs / PROBE_2026_07_27_TO_30.minMs; // 4.10x

/**
 * FLOOR. A budget must cover the TYPICAL call slowed by at least the factor we
 * have already watched happen — p50 x observed spread. Deliberately p50 and not
 * min: sizing off the luckiest call is exactly how a budget ends up inside its
 * own working distribution, which is the defect being fixed.
 */
const REQUIRED_FLOOR_MS = Math.ceil(PROBE_2026_07_27_TO_30.p50Ms * OBSERVED_SPREAD); // 29,459

describe('2.180-B FLOOR — the budget must sit OUTSIDE the working distribution', () => {
  it('covers the typical call slowed by the spread we have already observed', () => {
    // Guard first: an exported env override would make every pin below measure
    // the environment instead of the code default. Fail loud, do not pin the
    // wrong thing quietly.
    expect(process.env.DECISION_REVIEW_TIMEOUT_MS).toBeUndefined();

    expect(REQUIRED_FLOOR_MS).toBe(29_459); // arithmetic guard on the frozen sample
    expect(DECISION_REVIEW_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUIRED_FLOOR_MS);
  });

  it('clears the largest COMPLETED call by more than the p95-to-max gap', () => {
    // Necessary but NOT sufficient (the sample is censored) — it is the weakest
    // of the floor conditions and is pinned so a future lowering that satisfies
    // nothing else still cannot pass.
    const p95ToMaxGap =
      PROBE_2026_07_27_TO_30.maxCompletedMs - PROBE_2026_07_27_TO_30.p95Ms; // 4,036
    expect(DECISION_REVIEW_TIMEOUT_MS).toBeGreaterThan(
      PROBE_2026_07_27_TO_30.maxCompletedMs + p95ToMaxGap,
    );
  });

  it('is strictly above the value the sample was censored at', () => {
    // The old budget IS the censoring point. A "fix" that did not clear it
    // would leave the distribution truncated at the same place.
    expect(DECISION_REVIEW_TIMEOUT_MS).toBeGreaterThan(
      PROBE_2026_07_27_TO_30.censoredAtMs,
    );
  });

  it('records WHY the output-token cap is not the lever (measured, not asserted)', () => {
    // The cap can only bind if the model approaches it. It does not: peak
    // observed output is ~16% of the cap. Cutting it cannot shorten the call;
    // it can only truncate the review. Pinned so the "just lower max_tokens"
    // suggestion cannot be re-made without confronting the measurement.
    expect(PROBE_2026_07_27_TO_30.maxObservedOutputTokens).toBeLessThan(
      PROBE_2026_07_27_TO_30.configuredOutputCapTokens / 4,
    );
  });
});

describe('2.180-B CEILING — the budget must fit what the turn can still hold', () => {
  /**
   * decision_review only exists on a turn whose run_analysis SUCCEEDED, and a
   * successful PLoT /v2/run cannot exceed PLOT_RUN_TIMEOUT_MS. What remains of
   * the turn after that is all the review can ever be granted.
   */
  const ceilingMs = () => getTurnExecutorBudgets().turn_ms - PLOT_RUN_TIMEOUT_MS;

  /**
   * What the review actually costs the turn: the armed hard budget PLUS the
   * prompt fetch the hard timer does not bound (`invoke.ts` calls
   * `getSystemPrompt('decision_review')` inside the enricher's try but passes
   * it neither the signal nor the timeout, so a cold cache adds up to
   * PROMPT_STORE_FETCH_TIMEOUT_MS on top).
   */
  const chargeMs = (decomposeEnabled: boolean) =>
    resolveDecisionReviewHardBudgetMs(decomposeEnabled) + PROMPT_STORE_FETCH_TIMEOUT_MS;

  it('fits under the turn ceiling on the DEPLOYED (monolith) posture', () => {
    expect(chargeMs(false)).toBeLessThanOrEqual(ceilingMs());
  });

  it('keeps real margin, not a hairline pass', () => {
    // #764's discipline: choose inside the interval, do not sit on its edge.
    expect(ceilingMs() - chargeMs(false)).toBeGreaterThanOrEqual(5_000);
  });

  it('the ceiling is DERIVED from the live ladder, not restated', () => {
    // If this ever stops matching, the ladder moved and the pins above moved
    // with it — which is the property being asserted.
    expect(ceilingMs()).toBe(getTurnExecutorBudgets().turn_ms - PLOT_RUN_TIMEOUT_MS);
    expect(getTurnExecutorBudgets().turn_ms).toBeLessThan(
      config.proxy.browserProxyTimeoutMs,
    );
  });

  it('the admissible interval is NON-EMPTY and the chosen value sits inside it', () => {
    const maxAdmissible = ceilingMs() - PROMPT_STORE_FETCH_TIMEOUT_MS;
    expect(REQUIRED_FLOOR_MS).toBeLessThanOrEqual(maxAdmissible);
    expect(DECISION_REVIEW_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUIRED_FLOOR_MS);
    expect(DECISION_REVIEW_TIMEOUT_MS).toBeLessThanOrEqual(maxAdmissible);
  });

  it('the decompose posture BREACHES the ceiling — enabling it is a re-budget, not a flag flip', () => {
    // Not a defect to fix here: it is the fact that makes the boot rung below
    // necessary. Pinned so that if someone later "fixes" the arithmetic to make
    // decompose fit, the rung's positive control cannot silently go vacuous.
    expect(DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(chargeMs(true)).toBeGreaterThan(ceilingMs());
  });

  it('resolveDecisionReviewHardBudgetMs is unchanged by this lane', () => {
    expect(resolveDecisionReviewHardBudgetMs(false)).toBe(DECISION_REVIEW_TIMEOUT_MS);
    expect(resolveDecisionReviewHardBudgetMs(true)).toBe(
      DECISION_REVIEW_TIMEOUT_MS + DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS,
    );
  });
});

describe('2.180-B BOOT RUNG — the ceiling is enforced against the DEPLOYED env, not repo defaults', () => {
  // Both ends of this relationship are env-overridable, which is why the rung
  // lives at boot and not only here. These are its CI-side positive controls:
  // without them the rung is an assertion nobody has ever watched fire.
  const healthyLadder = () => ({
    handlerBudgetMs: getHandlerBudgetMs(),
    turnBudgetMs: getTurnExecutorBudgets().turn_ms,
    browserProxyTimeoutMs: config.proxy.browserProxyTimeoutMs,
    decisionReviewHardBudgetMs: resolveDecisionReviewHardBudgetMs(
      config.cee.decisionReviewDecompose,
    ),
  });

  const decisionReviewWarnings = (ladder: ReturnType<typeof healthyLadder>) =>
    validateTimeoutRelationships(ladder).filter((w) =>
      w.includes('decision_review hard budget'),
    );

  it('is SILENT at the resolved default ladder', () => {
    expect(decisionReviewWarnings(healthyLadder())).toEqual([]);
  });

  it('FIRES when the decompose flag adds its fallback floor on top', () => {
    // The positive control for the silence above: the rung CAN see a breach.
    const warnings = decisionReviewWarnings({
      ...healthyLadder(),
      decisionReviewHardBudgetMs: resolveDecisionReviewHardBudgetMs(true),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TURN_BUDGET_EXCEEDED');
    expect(warnings[0]).toContain('CEE_DECISION_REVIEW_DECOMPOSE');
  });

  it('FIRES when an operator raises the budget past what the turn can hold', () => {
    const overLarge =
      getTurnExecutorBudgets().turn_ms - PLOT_RUN_TIMEOUT_MS - PROMPT_STORE_FETCH_TIMEOUT_MS + 1;
    expect(
      decisionReviewWarnings({ ...healthyLadder(), decisionReviewHardBudgetMs: overLarge }),
    ).toHaveLength(1);
    // ...and is silent one millisecond below it — the rung is an inequality,
    // not a blanket alarm.
    expect(
      decisionReviewWarnings({ ...healthyLadder(), decisionReviewHardBudgetMs: overLarge - 1 }),
    ).toEqual([]);
  });

  it('FIRES when PLoT is granted a longer run without the turn budget rising', () => {
    // Derivation, not mirroring: the rung reads PLOT_RUN_TIMEOUT_MS, so raising
    // it on Render tightens the ceiling automatically. Simulated from the turn
    // side (the constant is import-time-resolved) — same inequality either way.
    const warnings = decisionReviewWarnings({
      ...healthyLadder(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS + DECISION_REVIEW_TIMEOUT_MS,
    });
    expect(warnings).toHaveLength(1);
  });
});
