/**
 * ROADMAP 1.232 — CQE extraction must be deterministic with respect to HOST
 * LOAD.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * `tests/integration/cqe-end-to-end.test.ts` failed roughly 1 full-suite run
 * in 2: for the message "set churn to 5% and cost to 50000" it intermittently
 * saw `parsed_quantities[0].value === 5` instead of `0.05`. It passed in
 * isolation, passed on `tests/integration` alone, and correlated with nothing
 * in the diff — only with how many other test files were competing for CPU.
 *
 * Cause: both CQE budget guards were driven by `performance.now()`, i.e. WALL
 * time. Wall time on a contended host counts the milliseconds this process
 * spent DESCHEDULED, in which no regex was running and no backtracking was
 * happening. When the 200ms total budget "expired" that way, the rule loop
 * broke early, P12 ("set X to N%") never ran, and the compromise backstop
 * re-claimed the span — yielding a DIFFERENT NUMBER, not merely fewer
 * numbers. A pure, side-effect-free function returned 0.05 on an idle laptop
 * and 5 on a busy one.
 *
 * Measured before the fix, under 8x CPU oversubscription: 126ms of wall time
 * accrued before rule #3 of 15, against a 200ms budget, for ~0.02ms of real
 * work. The repo had already measured the same thing and worked around it in
 * test helpers rather than in the source — see `withFrozenClock` in
 * `extract-quantities.degraded.test.ts`.
 *
 * Fix: the guards measure CPU TIME CONSUMED (`process.cpuUsage()`). Wall time
 * is still what `summary.duration_ms` reports, because how long the caller
 * waited really is a wall-clock fact — it just must not decide whether a rule
 * runs.
 *
 * DELIBERATELY NOT PINNED HERE: "call the scan twice and assert the second
 * call matches the first", the shape originally proposed for this defect on
 * the theory that a shared `g`-flagged regex was leaking `lastIndex` between
 * test files. That test would be VACUOUS. `scanAll`/`scanAllExec` already
 * clone every module-level regex, and independently, an exhaustive `exec`
 * loop terminates when `exec` returns null — which resets `lastIndex` to 0.
 * Verified both ways: with the clone REMOVED, three consecutive scans still
 * return identical results and leave `lastIndex === 0`. A test that passes
 * with the defect deliberately re-introduced pins nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  __runExtractionForTesting,
  runExtraction,
  CQE_REGEX_TIMEOUT_MS,
  CQE_TOTAL_BUDGET_MS,
} from '../extract-quantities.js';
import { compromiseBackstop } from '../compromise-backstop.js';
import { PATTERN_RULES, type PatternRule } from '../rules.js';
import { log } from '../../../../utils/telemetry.js';

/** The exact message from the flaking integration test. */
const FLAKY_MESSAGE = 'set churn to 5% and cost to 50000';

/**
 * Burn `ms` of REAL CPU time, measured with the same clock the guards use.
 *
 * Spinning on a wall clock would be load-dependent — the very bug this file
 * pins — so the loop spins until `process.cpuUsage()` itself reports the
 * required delta. That makes the burn exact no matter how contended the host
 * is, which is precisely the property the fix buys us.
 */
function burnCpuMs(ms: number): void {
  const start = process.cpuUsage();
  let sink = 0;
  for (;;) {
    const used = process.cpuUsage(start);
    if ((used.user + used.system) / 1000 >= ms) break;
    for (let i = 1; i <= 50_000; i++) sink += Math.sqrt(i);
  }
  // Keep `sink` observable so the optimiser cannot elide the loop.
  if (!Number.isFinite(sink)) throw new Error('unreachable');
}

/**
 * Replace the WALL clock with one that jumps forward by `stallMs` after the
 * first read — i.e. simulate this process being descheduled for `stallMs`
 * immediately after `runExtraction` starts, which is exactly what a loaded
 * full-suite run does to it.
 */
function withWallClockStall(stallMs: number): { restore: () => void } {
  const base = 1_000;
  let reads = 0;
  const spy = vi
    .spyOn(globalThis.performance, 'now')
    .mockImplementation(() => (reads++ === 0 ? base : base + stallMs));
  return { restore: () => spy.mockRestore() };
}

describe('CQE output is independent of host load (ROADMAP 1.232)', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    warnSpy = vi.fn();
    vi.spyOn(log, 'warn').mockImplementation(warnSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // POSITIVE CONTROL. Prove the harness can see the CORRECT answer before
  // asserting that a stall does not change it.
  // -----------------------------------------------------------------------
  it('positive control: an undisturbed run produces 0.05 / percentage / set', () => {
    const { results, summary } = runExtraction(FLAKY_MESSAGE);
    expect(results[0]!.value).toBeCloseTo(0.05);
    expect(results[0]!.unit).toBe('percentage');
    expect(results[0]!.operator).toBe('set');
    expect(results[0]!.source).toBe('cqe');
    expect(summary.patterns_matched).toContain('P12');
    expect(summary.degraded).toBe(false);
  });

  // -----------------------------------------------------------------------
  // THE PIN.
  // -----------------------------------------------------------------------
  it('a 5-second WALL-CLOCK stall does not change a single extracted value', () => {
    const stallMs = 5_000;
    const { restore } = withWallClockStall(stallMs);
    let out: ReturnType<typeof runExtraction>;
    try {
      out = runExtraction(FLAKY_MESSAGE);
    } finally {
      restore();
    }

    // Non-vacuity guard: prove the stall was REAL and OBSERVED. If the mock
    // silently failed to take effect this assertion fails and the pin below
    // is not credited. duration_ms is still wall time by design.
    expect(out.summary.duration_ms).toBeGreaterThanOrEqual(stallMs);

    // THE PIN: 25x the total budget of apparent wall time elapsed, and the
    // answer is byte-identical to the undisturbed one. Before the fix this
    // broke the rule loop at the first budget check: P12 never ran, and
    // `results[0]` became the compromise backstop's bare `5`.
    expect(out.results[0]!.value).toBeCloseTo(0.05);
    expect(out.results[0]!.unit).toBe('percentage');
    expect(out.results[0]!.operator).toBe('set');
    expect(out.results[0]!.source).toBe('cqe');
    expect(out.summary.patterns_matched).toContain('P12');
    expect(out.summary.degraded).toBe(false);
    expect(out.summary.timeout).toBe(false);

    // A stall is not a pathological input, so it must not raise the alarm.
    const noisy = warnSpy.mock.calls.filter((c) => {
      const p = c[0] as Record<string, unknown>;
      return p.event === 'cqe.pattern_timeout' || p.event === 'cqe.budget_exhausted';
    });
    expect(noisy).toHaveLength(0);
  });

  it('the full extraction is byte-identical with and without the stall', () => {
    const undisturbed = runExtraction(FLAKY_MESSAGE).results;
    const { restore } = withWallClockStall(30_000);
    let stalled: ReturnType<typeof runExtraction>['results'];
    try {
      stalled = runExtraction(FLAKY_MESSAGE).results;
    } finally {
      restore();
    }
    expect(JSON.stringify(stalled)).toBe(JSON.stringify(undisturbed));
  });

  // -----------------------------------------------------------------------
  // POSITIVE CONTROLS FOR THE GUARDS THEMSELVES. Moving a guard off the wall
  // clock must not quietly disable it: prove each one still fires on REAL
  // CPU burn, which is the only thing it ever existed to bound.
  // -----------------------------------------------------------------------
  it('the total budget still trips on real CPU burn, and marks the run degraded', () => {
    const rules: PatternRule[] = [
      {
        id: 'P_CPU_HOG_FOR_TEST',
        priority: 1,
        apply: () => {
          burnCpuMs(CQE_TOTAL_BUDGET_MS + 25);
          return [];
        },
      },
      ...PATTERN_RULES,
    ];

    const { summary } = __runExtractionForTesting('USD 1.2bn', { patternRules: rules });

    expect(summary.degraded).toBe(true);
    expect(summary.timeout).toBe(true);

    const budgetCalls = warnSpy.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).event === 'cqe.budget_exhausted',
    );
    expect(budgetCalls).toHaveLength(1);
    const payload = budgetCalls[0]![0] as Record<string, unknown>;
    expect(payload.total_budget_ms).toBe(CQE_TOTAL_BUDGET_MS);
    // elapsed_ms is now CPU time, so it must reflect the burn we actually did.
    expect(payload.elapsed_ms as number).toBeGreaterThanOrEqual(CQE_TOTAL_BUDGET_MS);
    // Every real rule was skipped, so none of them can have matched.
    expect(summary.patterns_matched).toHaveLength(0);
  });

  it('the per-rule cap still trips on real CPU burn — and the slow rule KEEPS its result', () => {
    const rules: PatternRule[] = PATTERN_RULES.map((rule) =>
      rule.id === 'P6'
        ? ({
            ...rule,
            apply: (text: string, ctx: Parameters<PatternRule['apply']>[1]) => {
              burnCpuMs(CQE_REGEX_TIMEOUT_MS + 15);
              return rule.apply(text, ctx);
            },
          } satisfies PatternRule)
        : rule,
    );

    const { results, summary } = __runExtractionForTesting('increase by about 10%', {
      patternRules: rules,
    });

    const slowCalls = warnSpy.mock.calls.filter((c) => {
      const p = c[0] as Record<string, unknown>;
      return (
        p.event === 'cqe.pattern_timeout' &&
        p.pattern_id === 'P6' &&
        p.reason === 'cpu_time_exceeded'
      );
    });
    expect(slowCalls).toHaveLength(1);
    expect((slowCalls[0]![0] as Record<string, unknown>).duration_ms as number).toBeGreaterThanOrEqual(
      CQE_REGEX_TIMEOUT_MS,
    );

    // SLOW but COMPLETE: the result is kept and is the correct one.
    expect(results.map((r) => r.value)).toEqual([0.1]);
    expect(summary.timeout).toBe(true);
    expect(summary.degraded).toBe(false);
  });
});

/**
 * Second defect, found while tracing where the literal `5` came from.
 *
 * `TRAILING_UNIT_RE` in compromise-backstop.ts terminated every alternative
 * with `\b`. `\b` asserts a word/non-word TRANSITION, and `%` is itself a
 * non-word character, so the `%` alternative could only match when followed
 * by a WORD character — which no real percentage ever is. The branch read as
 * percentage support and never executed once. Separately, compromise returns
 * "5%" as a SINGLE token (`text: "5%"`, `number: 5`), so for the commonest
 * spelling the symbol was not in the following text at all.
 *
 * Net effect: a 100x error, and NOT only on the degraded path — any
 * percentage the CQE rules decline lands here on a perfectly healthy run.
 */
describe('compromise backstop normalises percentages (dead `%` branch)', () => {
  it('emits 0.05 / percentage for a bare "5%", not 5 / null', () => {
    const got = compromiseBackstop('5%', []);
    expect(got).toHaveLength(1);
    expect(got[0]!.result.value).toBeCloseTo(0.05);
    expect(got[0]!.result.unit).toBe('percentage');
  });

  it('handles both token shapes: "5%" (one token) and "12 %" (spaced)', () => {
    const joined = compromiseBackstop('churn is 5% now', []);
    expect(joined[0]!.result.value).toBeCloseTo(0.05);
    expect(joined[0]!.result.unit).toBe('percentage');

    const spaced = compromiseBackstop('12 % of users', []);
    expect(spaced[0]!.result.value).toBeCloseTo(0.12);
    expect(spaced[0]!.result.unit).toBe('percentage');
  });

  it('handles trailing punctuation attached to the token ("5%,")', () => {
    const got = compromiseBackstop('boost, 5%, please', []);
    expect(got[0]!.result.value).toBeCloseTo(0.05);
    expect(got[0]!.result.unit).toBe('percentage');
  });

  it('is live on the HEALTHY path: "reduce spend, 5% target" is 0.05, not 5', () => {
    // No timeout, no forced skip — `degraded` is false. This was wrong in
    // production, not merely under load.
    const { results, summary } = runExtraction('reduce spend, 5% target');
    expect(summary.degraded).toBe(false);
    expect(results[0]!.source).toBe('compromise');
    expect(results[0]!.value).toBeCloseTo(0.05);
    expect(results[0]!.unit).toBe('percentage');
  });

  it('still refuses a unit that is only a prefix of a longer word', () => {
    // Guards the `\b` -> `(?![a-z0-9])` swap: "5 kgs" must not read as kg,
    // and "5 minutes" must resolve to minute, not to a truncated token.
    const kgs = compromiseBackstop('5 kgs', []);
    expect(kgs[0]!.result.unit).toBeNull();
    const minutes = compromiseBackstop('5 minutes', []);
    expect(minutes[0]!.result.unit).toBe('minute');
  });
});
