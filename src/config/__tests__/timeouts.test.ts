/**
 * `DECISION_REVIEW_TIMEOUT_MS` — the code default carries the mitigation.
 *
 * HISTORY. ROADMAP 2.73 Fix B raised it 15s -> 22s after the 15-Jul RCA
 * observed the call aborting at 15,002 ms. ROADMAP 2.180-B raised it 22s -> 30s
 * after measuring that 22,000 sat INSIDE the call's own working latency
 * distribution and was silently losing the model review on up to 24% of
 * analyses in a day.
 *
 * ⚠ THIS FILE USED TO SAY `expect(DECISION_REVIEW_TIMEOUT_MS).toBe(22_000)`,
 * justified as "value-pinned deliberately: a drift back toward 15s must be a
 * conscious, reviewed decision". The intent was right and the mechanism was
 * wrong: a `toBe(N)` pin is a MIRROR of the line it guards. It cannot tell a
 * correct value from an incorrect one — only whether someone edited both places
 * — so the "conscious, reviewed decision" it demanded was reduced to editing a
 * number in two files. It also could not have caught the defect 2.180-B fixed,
 * because 22,000 satisfied it perfectly while losing reviews in production.
 *
 * The real guard is in
 * `src/orchestrator-v5/coaching/__tests__/decision-review-budget-2180b.test.ts`,
 * which pins the value against the MEASURED latency distribution (floor) and
 * the live turn budget (ceiling) — requirements a wrong value fails and a right
 * value passes, whoever edits what.
 *
 * What remains here is the part that is genuinely this file's job: the code
 * default must carry the mitigation on its own, so an environment WITHOUT the
 * staging env override (e.g. prod) does not silently inherit a smaller budget.
 */

import { describe, it, expect } from 'vitest';

import { DECISION_REVIEW_TIMEOUT_MS } from '../timeouts.js';

/**
 * The two budgets this constant has already been raised away from. Frozen as
 * history — never edited to "current". A regression to either is the failure
 * mode this file exists to catch.
 */
const HISTORICAL_BUDGETS_THAT_LOST_REVIEWS = {
  /** ROADMAP 2.73: aborted a live call at 15,002 ms. */
  rc5_2026_07_15: 15_000,
  /** ROADMAP 2.180-B: 12 of 363 analyses over 14 days shipped no review. */
  probe_2026_07_30: 22_000,
} as const;

describe('DECISION_REVIEW_TIMEOUT_MS', () => {
  it('the CODE default carries the mitigation — an env without the override does not inherit a smaller budget', () => {
    // Guard: if CI ever exports DECISION_REVIEW_TIMEOUT_MS this file would
    // measure the env, not the default. Fail loud on that instead of silently
    // pinning the wrong thing.
    expect(process.env.DECISION_REVIEW_TIMEOUT_MS).toBeUndefined();

    for (const [label, budget] of Object.entries(HISTORICAL_BUDGETS_THAT_LOST_REVIEWS)) {
      expect(
        DECISION_REVIEW_TIMEOUT_MS,
        `code default regressed to or below the ${label} budget, which is measured to lose reviews`,
      ).toBeGreaterThan(budget);
    }
  });
});
