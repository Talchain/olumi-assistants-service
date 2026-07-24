/**
 * FINAL-SWEEP (pre-handover) — Codex F-4 (arithmetic contradiction) + quality F1
 * (near-twin retry-reserve predicate). The draft retry loop had two hand-copied
 * copies of the "room for another abortable attempt" arithmetic on two clock
 * reads microseconds apart (the loop-top skip-gate `willBeFinalAttempt` and the
 * in-closure `canRetryAgain`), and the reserve they used (HARD_CEILING + 35s)
 * DISAGREED with the skip-gate's own token floor (which in time is 45s):
 * `canRetryAgain` would AUTHORIZE an abort whose promised final window the
 * skip-gate would then REFUSE, turning one abort into a total request failure.
 *
 * The fix extracts one predicate (`hasRoomForAnotherAbortableAttempt`) used by
 * both callers, with `DRAFT_RUNAWAY_MIN_RETRY_MS` DERIVED from the same primitives
 * the skip-gate's floor uses — so authorization and the skip-gate agree by
 * construction.
 *
 * RED-first: the reconciliation invariant below FAILS on the pre-fix 35s constant
 * (an authorized abort can leave a final that affords < the viable floor), and
 * PASSES once the constant is derived to 45s. Mutation-checked by reverting the
 * derivation.
 */

import { describe, it, expect } from 'vitest';

import {
  hasRoomForAnotherAbortableAttempt,
  DRAFT_RUNAWAY_MIN_RETRY_MS,
  DRAFT_RUNAWAY_HARD_CEILING_MS,
  DRAFT_MAX_RUNAWAY_RETRIES,
} from '../draft-budget.js';
import {
  getAffordableDraftTokens,
  LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
  DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
  DRAFT_TTFB_SAFETY_OVERHEAD_S,
} from '../../../config/timeouts.js';

describe('hasRoomForAnotherAbortableAttempt — the shared retry-reserve predicate (F1)', () => {
  const reserve = DRAFT_RUNAWAY_HARD_CEILING_MS + DRAFT_RUNAWAY_MIN_RETRY_MS;

  it('is false at/below the reserve boundary and true just above it', () => {
    expect(hasRoomForAnotherAbortableAttempt(reserve, 0)).toBe(false);
    expect(hasRoomForAnotherAbortableAttempt(reserve + 1, 0)).toBe(true);
    expect(hasRoomForAnotherAbortableAttempt(reserve - 1, 0)).toBe(false);
  });

  it('is false once the runaway-retry backstop is hit, regardless of budget', () => {
    expect(hasRoomForAnotherAbortableAttempt(10_000_000, DRAFT_MAX_RUNAWAY_RETRIES)).toBe(false);
    expect(hasRoomForAnotherAbortableAttempt(10_000_000, DRAFT_MAX_RUNAWAY_RETRIES - 1)).toBe(true);
  });
});

describe('F-4 — abort authorization is reconciled to the skip-gate floor', () => {
  it('DRAFT_RUNAWAY_MIN_RETRY_MS is DERIVED from the skip-gate token floor (not a hand-typed mirror)', () => {
    const derived = Math.ceil(
      (LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S +
        DRAFT_TTFB_SAFETY_OVERHEAD_S) *
        1000,
    );
    expect(DRAFT_RUNAWAY_MIN_RETRY_MS).toBe(derived);
    // Sanity: with today's primitives that is 45s (the skip-gate's time floor).
    expect(DRAFT_RUNAWAY_MIN_RETRY_MS).toBe(45_000);
  });

  it('every AUTHORIZED abort leaves a worst-case final window the skip-gate ACCEPTS (RED on the pre-fix 35s reserve)', () => {
    // Sweep remaining windows across the reserve boundary and beyond.
    for (let remaining = DRAFT_RUNAWAY_HARD_CEILING_MS; remaining <= 200_000; remaining += 250) {
      if (!hasRoomForAnotherAbortableAttempt(remaining, 1)) continue;
      // Worst case: the abortable attempt consumes the FULL hard ceiling before
      // aborting. The final attempt then runs to what remains.
      const finalWindow = remaining - DRAFT_RUNAWAY_HARD_CEILING_MS;
      const affordable = getAffordableDraftTokens(finalWindow);
      // The skip-gate refuses a final that affords < the viable floor; a fix that
      // authorizes an abort but leaves a sub-viable final is the F-4 contradiction.
      expect(affordable).toBeGreaterThanOrEqual(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR);
    }
  });
});
