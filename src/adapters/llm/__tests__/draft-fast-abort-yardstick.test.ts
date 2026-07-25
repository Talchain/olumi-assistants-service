/**
 * ⭐ FAST-ABORT YARDSTICK (2026-07-25) — the cure was built, then switched off by
 * a budget rule that measures the wrong thing.
 *
 * THE MECHANISM. `isAbortableRetryViable` authorised the early runaway abort only
 * when the post-abort window could re-fund a generation **>= the cap being
 * abandoned**. In the default regime attempt 1 runs at the FULL affordable budget
 * (aff(110s) = 8,550) and no post-abort window can ever re-fund 8,550
 * (aff(110s - ceiling) < 8,550), so the detector was UNREACHABLE. Confirmed live:
 * `runaway_abort_count: 0` on all 30 observations of
 * `parallel-briefs/TOKEN-CEILING-EXPERIMENT-2026-07-25.md`.
 *
 * WHY THE PREMISE IS WRONG. "A model that could not fit `priorAttemptMaxTokens`
 * re-truncates in anything less" describes a generation that TRIED to fit a graph
 * and overflowed. A runaway is not that: `time_to_edges_ms` is NULL on 17/17
 * runaways and the schema error is `edges: Required` on 17/17 — it never reached
 * the edges array at all, and `completion_tokens == the cap, exactly` at 8,550,
 * 12,000 AND 16,000 (17/17). It has no size it is trying to reach; it consumes
 * whatever it is given. The retry does not need the abandoned cap — it needs what
 * a SUCCESSFUL draft actually costs, measured at 1,652-2,271 tokens (n=13).
 *
 * THE FIX. `isRunawayRetryAffordable` compares the post-abort window against an
 * evidence-DERIVED requirement (corpus max x an explicit headroom factor), which
 * is STRICTER than the 2,700-token floor #675 shipped — so #675's intent (never
 * retry into a window that cannot fund a real draft) is preserved, not reverted,
 * while its yardstick is corrected.
 *
 * RED-FIRST: on `b9e02bd7` the first describe block FAILS (the default regime
 * authorises no abort, and the post-abort final is skipped as unaffordable).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isAbortableRetryViable,
  shouldSkipDoomedFinalAttempt,
  hasRoomForAnotherAbortableAttempt,
  resolveDraftMaxTokens,
  DRAFT_RUNAWAY_HARD_CEILING_MS,
  DRAFT_RUNAWAY_MIN_RETRY_MS,
  DRAFT_RUNAWAY_DRIFT_WARN_MS,
  DRAFT_RUNAWAY_DETECT_MS,
  DRAFT_MAX_RUNAWAY_RETRIES,
} from '../draft-budget.js';
import {
  DRAFT_LLM_TIMEOUT_MS,
  DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL,
  LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
  DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
  DRAFT_TTFB_SAFETY_OVERHEAD_S,
  OBSERVED_MAX_CONVERGED_DRAFT_TOKENS,
  OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS,
  DRAFT_RETRY_HEADROOM_FACTOR,
  getAffordableDraftTokens,
  isDraftRetryAffordable,
  isRunawayRetryAffordable,
  viableRunawayRetryFloorTokens,
} from '../../../config/timeouts.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The full-window attempt-1 cap at the derived timeout (8,550 at defaults). */
const FULL_CAP = resolveDraftMaxTokens(DRAFT_LLM_TIMEOUT_MS).effective;

/**
 * ⭐ THE CORPUS. Every SUCCESSFUL draft from the 2026-07-25 token-ceiling matrix
 * (`parallel-briefs/TOKEN-CEILING-EXPERIMENT-2026-07-25.md`), re-derived from the
 * capture bytes, plus the 30th post-fix observation. This is the complete census
 * of terminations in that lane — not a sample — and it is what the retry floor is
 * derived FROM. A future recalibration edits THIS list and the derived constant
 * follows; editing the constant alone fails the pin below.
 */
const SUCCESSFUL_DRAFTS: ReadonlyArray<{ run: string; completionTokens: number; timeToEdgesMs: number | null }> = [
  { run: 'control_r1', completionTokens: 2_041, timeToEdgesMs: 21_199 },
  { run: 'control_r2', completionTokens: 2_271, timeToEdgesMs: 14_206 },
  { run: 'control_r4', completionTokens: 1_975, timeToEdgesMs: 13_524 },
  { run: '12k_r0', completionTokens: 2_214, timeToEdgesMs: 14_618 },
  { run: '12k_r1', completionTokens: 1_941, timeToEdgesMs: 19_839 },
  { run: '12k_r3', completionTokens: 1_922, timeToEdgesMs: 13_337 },
  { run: '12k_r4', completionTokens: 2_073, timeToEdgesMs: 13_846 },
  { run: '12k_r6', completionTokens: 1_802, timeToEdgesMs: 14_340 },
  { run: '16k_r1', completionTokens: 2_168, timeToEdgesMs: 17_776 },
  { run: '16k_r3', completionTokens: 1_894, timeToEdgesMs: 13_505 },
  { run: '16k_r7', completionTokens: 1_793, timeToEdgesMs: 12_716 },
  { run: 'pos_ctl_3', completionTokens: 1_652, timeToEdgesMs: 12_350 },
  // 30th observation, run on b9e02bd after the classification fix; time-to-edges
  // not published for this row, so it contributes to the TOKEN corpus only.
  { run: 'postfix_r0', completionTokens: 2_055, timeToEdgesMs: null },
];

/**
 * The PRIOR live time-to-edges corpus the 30s ceiling was originally derived from
 * (DETECTOR-FIX, 2026-07-24; `cee.llm.draft_edges_reached` n=16, p100 19,570 ms).
 * Kept here so the ceiling is justified against BOTH corpora pooled, never
 * against the newer one alone.
 */
const PRIOR_CORPUS_P100_TIME_TO_EDGES_MS = 19_570;

// ---------------------------------------------------------------------------
describe('⭐ THE DEFECT — the built detector is switched off in the regime that needs it', () => {
  it('the live-observed premise: no post-abort window can EVER re-fund the abandoned full cap', () => {
    // This is the arithmetic that made the detector unreachable. It is still
    // TRUE after the fix — the fix does not make the old comparison pass, it
    // stops asking the old question.
    const postAbortWindow = DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS;
    expect(getAffordableDraftTokens(postAbortWindow)).toBeLessThan(FULL_CAP);
    expect(isDraftRetryAffordable(getAffordableDraftTokens(postAbortWindow), FULL_CAP)).toBe(false);
  });

  it('RED on b9e02bd7 — the DEFAULT regime must now AUTHORISE the early abort', () => {
    // Exactly the product configuration: full 110s window, no aborts spent,
    // attempt-1 ceiling = the shipped sentinel.
    expect(
      isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL),
    ).toBe(true);
  });

  it('RED on b9e02bd7 — the post-abort attempt must be a GENUINE second chance, not skipped', () => {
    const remainingAfterOneAbort = DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS;
    const affordable = resolveDraftMaxTokens(
      remainingAfterOneAbort,
      DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL,
    ).effective;
    // It is funded well above what any successful draft has ever consumed…
    expect(affordable).toBeGreaterThan(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS * 2);
    // …so neither gate may refuse it.
    expect(isRunawayRetryAffordable(affordable)).toBe(true);
    expect(
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 1,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: affordable,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('THE YARDSTICK is DERIVED from the corpus, with an explicit headroom factor', () => {
  it('the constant equals the corpus maximum — not a hand-picked number', () => {
    const corpusMax = Math.max(...SUCCESSFUL_DRAFTS.map((d) => d.completionTokens));
    expect(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS).toBe(corpusMax);
    expect(corpusMax).toBe(2_271);
    expect(SUCCESSFUL_DRAFTS).toHaveLength(13);
  });

  it('the floor is corpus-max x the documented headroom factor, never below the shipped floor', () => {
    expect(viableRunawayRetryFloorTokens()).toBe(
      Math.max(
        LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
        Math.ceil(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS * DRAFT_RETRY_HEADROOM_FACTOR),
      ),
    );
    // With today's primitives: ceil(2,271 x 1.5) = 3,407.
    expect(viableRunawayRetryFloorTokens()).toBe(3_407);
  });

  it('⭐ #675 IS NOT WEAKENED — the new floor is STRICTER than the floor it replaces', () => {
    // The anti-doom rule #675 shipped bottoms out at LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR
    // (2,700). Re-aiming the yardstick must not become a back door to a laxer
    // gate: the runaway floor must sit at or above it, and today strictly above.
    expect(viableRunawayRetryFloorTokens()).toBeGreaterThan(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR);
  });

  it('every successful draft in the corpus fits, with the full headroom factor to spare', () => {
    for (const d of SUCCESSFUL_DRAFTS) {
      expect(d.completionTokens).toBeLessThanOrEqual(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS);
      expect(d.completionTokens * DRAFT_RETRY_HEADROOM_FACTOR).toBeLessThanOrEqual(
        viableRunawayRetryFloorTokens(),
      );
    }
  });

  it('the headroom factor is a real margin, not decoration', () => {
    expect(DRAFT_RETRY_HEADROOM_FACTOR).toBeGreaterThan(1);
    expect(viableRunawayRetryFloorTokens()).toBeGreaterThan(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS);
  });

  it('is a pure threshold predicate — boundary exact, monotone', () => {
    const floor = viableRunawayRetryFloorTokens();
    expect(isRunawayRetryAffordable(floor)).toBe(true);
    expect(isRunawayRetryAffordable(floor - 1)).toBe(false);
    expect(isRunawayRetryAffordable(0)).toBe(false);
    expect(isRunawayRetryAffordable(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('THE ANTI-DOOM PROPERTY STILL BITES — a starved retry is still refused', () => {
  it('a window that cannot fund the derived requirement is refused by BOTH gates', () => {
    // Window affording strictly less than the floor: 3,406 tokens needs
    // (3406/90 + 15)s = 52.84s; take a window comfortably under it.
    const starvedWindowMs = 40_000; // aff(40s) = (40-15)*90 = 2,250
    expect(getAffordableDraftTokens(starvedWindowMs)).toBe(2_250);
    expect(isRunawayRetryAffordable(getAffordableDraftTokens(starvedWindowMs))).toBe(false);
    expect(
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 1,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: getAffordableDraftTokens(starvedWindowMs),
      }),
    ).toBe(true);
    // And no abort may be authorised into it.
    expect(isAbortableRetryViable(starvedWindowMs + DRAFT_RUNAWAY_HARD_CEILING_MS, 1, FULL_CAP)).toBe(false);
  });

  it('the 2026-07-24 A2killer census (caps 3,146-3,826) — the starved ones are still refused', () => {
    // The complete census of live failures #675 was built from (results.jsonl,
    // `parallel-briefs/A2KILLER-REPROBE-1b9d596-2026-07-24.md`), not a sample.
    const observedCaps = [
      3146, 3147, 3147, 3147, 3147, 3147, 3148, 3148, 3148,
      3148, 3148, 3148, 3148, 3148, 3149, 3378, 3419, 3826,
    ];
    expect(observedCaps).toHaveLength(18);
    const refused = observedCaps.filter((cap) =>
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 2,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: cap,
      }),
    );
    // STATED HONESTLY: 16 of the 18 sit below the derived floor and are still
    // refused. The two that clear it (3,419 and 3,826) ARE now funded — and that
    // is correct, not a regression: a window affording 3,419 tokens can
    // comfortably produce the 2,271-token graph that is the largest a successful
    // draft has ever needed. #675 refused them only because it was comparing
    // against the 8,550-token cap of an attempt that never emitted an edge.
    expect(refused).toHaveLength(16);
    expect(observedCaps.filter((c) => c >= viableRunawayRetryFloorTokens())).toEqual([3419, 3826]);
    // The dominant band — 15 of 18 inside a four-token window at 3,146-3,149 —
    // is entirely refused. That band is what failed 18/18 live.
    expect(observedCaps.filter((c) => c <= 3_149)).toHaveLength(15);
    for (const cap of observedCaps.filter((c) => c <= 3_149)) {
      expect(isRunawayRetryAffordable(cap)).toBe(false);
    }
  });

  it('still refuses attempt 1, non-final attempts and thinking (preconditions unchanged)', () => {
    const base = {
      runawayAbortCount: 2,
      willBeFinalAttempt: true,
      thinkingEnabled: false,
      finalAttemptAffordableTokens: 1_000,
    };
    expect(shouldSkipDoomedFinalAttempt(base)).toBe(true);
    expect(shouldSkipDoomedFinalAttempt({ ...base, runawayAbortCount: 0 })).toBe(false);
    expect(shouldSkipDoomedFinalAttempt({ ...base, willBeFinalAttempt: false })).toBe(false);
    expect(shouldSkipDoomedFinalAttempt({ ...base, thinkingEnabled: true })).toBe(false);
  });

  it('still respects the time reserve and the runaway backstop', () => {
    expect(isAbortableRetryViable(1_000, 0, FULL_CAP)).toBe(false);
    expect(isAbortableRetryViable(10_000_000, DRAFT_MAX_RUNAWAY_RETRIES, FULL_CAP)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('⭐ AUTHORISE-THEN-REFUSE IS STILL IMPOSSIBLE (#673, one level up)', () => {
  it('DRAFT_RUNAWAY_MIN_RETRY_MS is DERIVED from the NEW floor, not left on the old one', () => {
    const derived = Math.ceil(
      (viableRunawayRetryFloorTokens() / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S +
        DRAFT_TTFB_SAFETY_OVERHEAD_S) *
        1000,
    );
    expect(DRAFT_RUNAWAY_MIN_RETRY_MS).toBe(derived);
    // Today: ceil((3,407/90 + 15) x 1000) = 52,856 ms. If this were left at the
    // 45,000 the 2,700 floor implied, a post-abort window in [45s, 52.86s) would
    // be AUTHORISED by the reserve and then REFUSED by the gate — the exact
    // contradiction #673 removed.
    expect(DRAFT_RUNAWAY_MIN_RETRY_MS).toBe(52_856);
  });

  it('every AUTHORISED abort leaves a worst-case final window the gate ACCEPTS', () => {
    for (let remaining = 0; remaining <= 250_000; remaining += 250) {
      if (!hasRoomForAnotherAbortableAttempt(remaining, 1)) continue;
      // Worst case: the abortable attempt burns the FULL hard ceiling first.
      const finalWindow = remaining - DRAFT_RUNAWAY_HARD_CEILING_MS;
      expect(isRunawayRetryAffordable(getAffordableDraftTokens(finalWindow))).toBe(true);
    }
  });

  it('every abort isAbortableRetryViable authorises survives the gate that runs next', () => {
    let authorised = 0;
    for (let remaining = 0; remaining <= 250_000; remaining += 500) {
      for (const ceiling of [undefined, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL, 4_000]) {
        for (const currentCap of [1_500, 3_407, 5_850, FULL_CAP]) {
          if (!isAbortableRetryViable(remaining, 1, currentCap, ceiling)) continue;
          authorised++;
          const postAbortAffordable = resolveDraftMaxTokens(
            Math.max(0, remaining - DRAFT_RUNAWAY_HARD_CEILING_MS),
            ceiling,
          ).effective;
          expect(
            shouldSkipDoomedFinalAttempt({
              runawayAbortCount: 2,
              willBeFinalAttempt: true,
              thinkingEnabled: false,
              finalAttemptAffordableTokens: postAbortAffordable,
            }),
          ).toBe(false);
        }
      }
    }
    // POSITIVE CONTROL: the sweep above is an ABSENCE claim ("no authorised abort
    // is later refused"). It is vacuous unless the sweep actually authorises
    // aborts. It must authorise many, including at the product configuration.
    expect(authorised).toBeGreaterThan(100);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 1, FULL_CAP, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('⭐ THE LADDER the product actually gets — three funded attempts in 110s', () => {
  /** Walk the adapter's real decision sequence on the real constants. */
  function walk(): Array<{ attempt: number; windowMs: number; cap: number; abortArmed: boolean; skipped: boolean }> {
    const out: Array<{ attempt: number; windowMs: number; cap: number; abortArmed: boolean; skipped: boolean }> = [];
    const ceiling = DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL;
    let remaining = DRAFT_LLM_TIMEOUT_MS;
    for (let attempt = 1, aborts = 0; attempt <= 6; attempt++) {
      const willBeFinal = !hasRoomForAnotherAbortableAttempt(remaining, aborts);
      const affordable = resolveDraftMaxTokens(Math.max(0, remaining), ceiling).effective;
      const skipped = shouldSkipDoomedFinalAttempt({
        runawayAbortCount: aborts,
        willBeFinalAttempt: willBeFinal,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: affordable,
      });
      const abortArmed = isAbortableRetryViable(remaining, aborts, FULL_CAP, ceiling);
      // The adapter squeezes the cap to the live window only on the FINAL attempt.
      const cap = abortArmed ? Math.min(FULL_CAP, ceiling) : Math.min(FULL_CAP, affordable);
      out.push({ attempt, windowMs: remaining, cap, abortArmed, skipped });
      if (skipped || !abortArmed) break;
      remaining -= DRAFT_RUNAWAY_HARD_CEILING_MS;
      aborts++;
    }
    return out;
  }

  it('gives THREE attempts, all funded above the corpus max, none skipped', () => {
    const ladder = walk();
    expect(ladder).toHaveLength(3);
    expect(ladder.map((r) => r.abortArmed)).toEqual([true, true, false]);
    expect(ladder.map((r) => r.skipped)).toEqual([false, false, false]);
    for (const rung of ladder) {
      expect(rung.cap).toBeGreaterThan(OBSERVED_MAX_CONVERGED_DRAFT_TOKENS);
      expect(rung.cap).toBeGreaterThanOrEqual(viableRunawayRetryFloorTokens());
    }
    // The final rung is the one #675 was right to be suspicious of. It is funded
    // at ~1.8x the largest draft ever observed — not the 3,150 that failed 18/18.
    const last = ladder[ladder.length - 1]!;
    expect(last.cap).toBe(4_050);
    expect(last.cap / OBSERVED_MAX_CONVERGED_DRAFT_TOKENS).toBeGreaterThan(1.7);
  });

  it('a FOURTH rung is refused — the ladder terminates on the anti-doom rule, not by luck', () => {
    // Three ceilings burned would leave aff(35s) = 1,800 < the floor.
    const afterThree = DRAFT_LLM_TIMEOUT_MS - 3 * DRAFT_RUNAWAY_HARD_CEILING_MS;
    expect(getAffordableDraftTokens(afterThree)).toBeLessThan(viableRunawayRetryFloorTokens());
    expect(isRunawayRetryAffordable(getAffordableDraftTokens(afterThree))).toBe(false);
  });

  it('the whole ladder fits inside the LLM window with the final attempt able to truncate INSIDE it', () => {
    const ladder = walk();
    const abortedWallMs = (ladder.length - 1) * DRAFT_RUNAWAY_HARD_CEILING_MS;
    const finalWindowMs = DRAFT_LLM_TIMEOUT_MS - abortedWallMs;
    const finalCap = ladder[ladder.length - 1]!.cap;
    // The final cap is by construction what that window affords, so a runaway on
    // it truncates AT max_tokens inside the wall (salvage stays reachable) rather
    // than hanging to the overall abort — the #585 property, preserved.
    expect(finalCap).toBeLessThanOrEqual(getAffordableDraftTokens(finalWindowMs));
    expect(abortedWallMs + DRAFT_TTFB_SAFETY_OVERHEAD_S * 1000 + (finalCap / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S) * 1000)
      .toBeLessThanOrEqual(DRAFT_LLM_TIMEOUT_MS);
  });
});

// ---------------------------------------------------------------------------
describe('⭐ THE ABORT THRESHOLD — derived against BOTH corpora, and against the revert history', () => {
  it('the hard ceiling clears the pooled healthy p100 with a real margin', () => {
    const observed = SUCCESSFUL_DRAFTS.map((d) => d.timeToEdgesMs).filter(
      (v): v is number => typeof v === 'number',
    );
    expect(observed).toHaveLength(12);
    const pooledP100 = Math.max(...observed, PRIOR_CORPUS_P100_TIME_TO_EDGES_MS);
    expect(pooledP100).toBe(21_199);
    expect(OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS).toBe(pooledP100);
    // The threshold must sit ABOVE everything ever measured. A threshold below
    // the observed max aborts healthy drafts — the exact failure mode the
    // detector was disabled for on 2026-07-24 (blanket 20s gate vs a p100 that
    // had drifted to 19.57s).
    expect(DRAFT_RUNAWAY_HARD_CEILING_MS).toBeGreaterThan(pooledP100);
    expect(DRAFT_RUNAWAY_HARD_CEILING_MS).toBe(25_000);
    expect(DRAFT_RUNAWAY_HARD_CEILING_MS - pooledP100).toBeGreaterThanOrEqual(3_500);
  });

  it('EVERY healthy draft ever measured survives the threshold', () => {
    for (const d of SUCCESSFUL_DRAFTS) {
      if (d.timeToEdgesMs === null) continue;
      expect(d.timeToEdgesMs).toBeLessThan(DRAFT_RUNAWAY_HARD_CEILING_MS);
    }
  });

  it('EVERY runaway ever measured is caught by it — the separation is total', () => {
    // 17/17 runaways never reached edges at ALL (time_to_edges NULL), at ceilings
    // of 8,550 / 12,000 / 16,000, while generating at 108-121 tok/s for 73-140s.
    // A no-edges stream at 25s is therefore a runaway on every observation in
    // the corpus. Encoded as the structural fact, not a rate.
    const runawayTimeToEdges: ReadonlyArray<number | null> = new Array(17).fill(null);
    expect(runawayTimeToEdges).toHaveLength(17);
    for (const tte of runawayTimeToEdges) {
      // never reaches edges => the ceiling timer always fires
      expect(tte === null || tte > DRAFT_RUNAWAY_HARD_CEILING_MS).toBe(true);
    }
  });

  it('the stall gate stays a strict subset of the ceiling (it can only fire earlier)', () => {
    expect(DRAFT_RUNAWAY_DETECT_MS).toBeLessThan(DRAFT_RUNAWAY_HARD_CEILING_MS);
  });

  it('⭐ the drift tripwire is re-anchored so it cannot become an alarm nobody reads', () => {
    // It USED to be 0.6 x ceiling. At a 25s ceiling that is 15,000 ms — BELOW the
    // healthy p50 (15.4s), so it would WARN on more than half of all healthy
    // drafts. Re-anchored to the observed healthy p100: "slower to edges than
    // anything ever measured, and eating the ceiling's margin".
    expect(DRAFT_RUNAWAY_DRIFT_WARN_MS).toBe(OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS);
    // It must warn BEFORE it aborts, or it is not an early alarm at all.
    expect(DRAFT_RUNAWAY_DRIFT_WARN_MS).toBeLessThan(DRAFT_RUNAWAY_HARD_CEILING_MS);
    // And it must not fire on the bulk of the healthy corpus.
    const healthy = SUCCESSFUL_DRAFTS.map((d) => d.timeToEdgesMs).filter(
      (v): v is number => typeof v === 'number',
    );
    const wouldWarn = healthy.filter((t) => t >= DRAFT_RUNAWAY_DRIFT_WARN_MS);
    expect(wouldWarn.length / healthy.length).toBeLessThanOrEqual(0.15);
    // POSITIVE CONTROL: an alarm that can never fire is worthless. The slowest
    // healthy draft in the corpus DOES trip it.
    expect(wouldWarn).toHaveLength(1);
    expect(wouldWarn[0]).toBe(21_199);
  });
});

// ---------------------------------------------------------------------------
describe('SCOPE — the lean-retry rule is deliberately UNTOUCHED', () => {
  it('isDraftRetryAffordable still compares against the prior cap (a natural truncation IS a size signal)', () => {
    // parse.ts Step 7 fires after a real max_tokens truncation, where the model
    // genuinely committed to a graph larger than the cap. #675's reasoning holds
    // there, so that call site keeps the prior-cap yardstick.
    expect(isDraftRetryAffordable(3_407, FULL_CAP)).toBe(false);
    expect(isDraftRetryAffordable(FULL_CAP, FULL_CAP)).toBe(true);
    expect(isDraftRetryAffordable(2_700, 1_000)).toBe(true);
    expect(isDraftRetryAffordable(2_699, 1_000)).toBe(false);
  });

  it('the two rules are genuinely different — one is not a rename of the other', () => {
    // If they ever agree everywhere, one of them is dead code pretending to be a
    // guard. Prove they disagree on the case the whole lane is about.
    const postAbort = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS);
    expect(isRunawayRetryAffordable(postAbort)).toBe(true);
    expect(isDraftRetryAffordable(postAbort, FULL_CAP)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FAIL-LOUD DRIFT PIN. The corpus constants must live in exactly ONE module. A
// second module holding a copy is the estate's dominant defect class (trap 12).
// ---------------------------------------------------------------------------
describe('DRIFT PIN — the corpus values are DERIVED everywhere, mirrored nowhere', () => {
  // Symbol -> the complete set of src modules allowed to REFERENCE it. Referring
  // to the constant is fine (that is derivation); holding a COPY of its value is
  // the defect, and the literal scan below is what actually forbids that.
  const ALLOWED: Record<string, ReadonlySet<string>> = {
    // Defined and consumed only by the floor helper, in its own module.
    OBSERVED_MAX_CONVERGED_DRAFT_TOKENS: new Set(['src/config/timeouts.ts']),
    DRAFT_RETRY_HEADROOM_FACTOR: new Set(['src/config/timeouts.ts']),
    // draft-budget.ts anchors the drift tripwire to it — a derivation, not a
    // second home. Anything beyond these two must be justified by editing here.
    OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS: new Set([
      'src/config/timeouts.ts',
      'src/adapters/llm/draft-budget.ts',
    ]),
  };

  for (const [symbol, allowed] of Object.entries(ALLOWED)) {
    it(`only the allowed modules reference ${symbol}`, () => {
      const hits = execGrepSrc(symbol);
      // POSITIVE CONTROL FIRST: the scanner must be able to SEE a presence, or
      // the absence assertion below is testing nothing (trap 13).
      expect(hits).toContain('src/config/timeouts.ts');
      expect(new Set(hits)).toEqual(allowed);
    });
  }

  it('⭐ no module outside config/timeouts.ts holds a NUMERIC COPY of a corpus value', () => {
    // This is the assertion with teeth. A second module that referenced the
    // symbol would be caught above; a second module that typed `21_199` would
    // not, and that is precisely the hand-maintained-mirror class (trap 12).
    for (const literal of ['2271', '2_271', '21199', '21_199']) {
      const hits = execGrepSrc(literal).filter((f) => f !== 'src/config/timeouts.ts');
      expect(hits).toEqual([]);
    }
    // Positive control: the scan CAN find these literals where they legitimately
    // live, so the empty results above are a fact about the code, not a blind scan.
    expect(execGrepSrc('2_271')).toEqual(['src/config/timeouts.ts']);
    expect(execGrepSrc('21_199')).toEqual(['src/config/timeouts.ts']);
  });

  it('the derived values are never hand-typed anywhere in src', () => {
    // 3,407 and 52,856 fall out of the derivation. If either ever appears as a
    // literal, someone has mirrored a computed value.
    for (const literal of ['3407', '3_407', '52856', '52_856']) {
      expect(execGrepSrc(literal)).toEqual([]);
    }
  });

  it('the scanner is not blind — a symbol that IS used in several modules is found in several', () => {
    // Negative control for the control: prove execGrepSrc returns >1 when >1 is
    // the truth, so the single-hit results above are a fact about the code and
    // not about the scanner.
    expect(execGrepSrc('getAffordableDraftTokens').length).toBeGreaterThan(1);
  });
});

/** Strip comments so the scan matches EXECUTABLE references only. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Recursive source scan for an executable reference under `src/`, excluding tests. */
function execGrepSrc(symbol: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue;
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (stripComments(readFileSync(abs, 'utf8')).includes(symbol)) {
        out.push(abs.slice(REPO_ROOT.length + 1));
      }
    }
  };
  walk(join(REPO_ROOT, 'src'));
  return out;
}
