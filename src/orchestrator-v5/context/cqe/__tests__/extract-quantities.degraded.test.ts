/**
 * P0 pin — a degraded extraction must never silently yield a value that
 * gets deterministically applied.
 *
 * THE DEFECT THIS PINS (reproduced on staging under CPU load):
 * when a pattern rule was skipped, the span it would have claimed was left
 * unmasked and got re-claimed by a LOWER-FIDELITY substitute, which emitted
 * a DIFFERENT NUMBER with full confidence and normal `source`. Measured:
 *
 *   "reduce to 5%"           set        -> decrement   (op flip) P12 -> P6b
 *   "from £50k to £70k"      [50k..70k] -> 50k, 70k    (collapse) P11 -> P8
 *   "USD 1.2bn"              1200000000 -> 1.2         (1e-9x)  P8  -> compromise
 *
 * Note the substitution paths differ: the first two are lower-priority CQE
 * RULES taking the span (source stays 'cqe'), the third is the compromise
 * backstop. Neither kind is reliably visible to a guard keyed on quantity
 * COUNT or on `source`: the operator-flip case changes neither (nor even the
 * value), and the collapse case never leaves 'cqe'.
 *
 * ⚠ HISTORY — the first row used to read
 *     "increase by about 10%"  0.1 -> 10  (100x)  P6 -> P6b
 * and that row was retired (ROADMAP 1.235), NOT because the degradation
 * class went away but because the 100x was never a property of degradation
 * at all. It was a defect in P6b, which assigned `unit: 'percentage'` and
 * never applied the `/100` every sibling applies — so P6b returned 5 for
 * "5%" on the HEALTHY path too, with every rule running and
 * `degraded === false`. This file framing it as degraded-only is what let it
 * survive: the number looked like evidence FOR the degradation pin, so
 * nobody asked whether P6b was simply wrong. Fixed at source; pinned on the
 * healthy path in extract-quantities.p6b-percentage.test.ts. The arm was
 * re-pointed at a substitution that still corrupts, never relaxed to match
 * the new value.
 *
 * The class is wider than the two cases pinned here. Adversarial review
 * found 6-9 rules affected across at least four corruption modes, and they
 * disagree about what they perturb: a RANGE COLLAPSE mode DOES change the
 * quantity count, and an OPERATOR FLIP mode (`set 42` -> `increment 42`)
 * leaves the number byte-identical. So arity guards, magnitude heuristics
 * and `source` checks each miss some mode; only PROVENANCE — did every
 * rule run? — covers all of them. Hence `summary.degraded`.
 *
 * DETERMINISM: these tests never depend on real CPU load. A fake clock is
 * advanced from inside a wrapped rule's own `apply()`, so exactly the
 * targeted rule appears slow. There is no race.
 *
 * CLOCK — UPDATED FOR ROADMAP 1.232. The guards under test used to read
 * `performance.now()` (wall time) and now read `process.cpuUsage()` (CPU time
 * consumed), because wall time made the extractor's OUTPUT depend on host
 * contention. The fakes below moved with the mechanism: they stub
 * `process.cpuUsage`, so each test still drives exactly the fork it names.
 * See `extract-quantities.load-determinism.test.ts` for the pin on the
 * load-independence property itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  __runExtractionForTesting,
  runExtraction,
  CQE_REGEX_TIMEOUT_MS,
  CQE_TOTAL_BUDGET_MS,
} from '../extract-quantities.js';
import { PATTERN_RULES, type PatternRule } from '../rules.js';
import { log } from '../../../../utils/telemetry.js';

/** Present `ms` of consumed CPU time to `cpuMs()` in extract-quantities.ts. */
function cpuUsageAt(ms: number): NodeJS.CpuUsage {
  return { user: Math.round(ms * 1000), system: 0 };
}

/**
 * Freeze the clock so NO budget can trip, keeping the "undisturbed run"
 * assertions hermetic rather than merely likely.
 *
 * HISTORY, because the reason changed and a stale reason is a false label.
 * This helper originally froze `performance.now()`, and its comment recorded
 * WHY: "on a cold JIT or a loaded machine a real `runExtraction` genuinely
 * exceeds CQE_TOTAL_BUDGET_MS (observed at 86ms for a single rule on first
 * call, and >200ms total), so asserting `degraded === false` against the real
 * clock is a race, not a pin."
 *
 * That observation was correct, and it was the defect — not a fact of life to
 * be worked around in test helpers. It was a wall clock counting time this
 * process spent DESCHEDULED, and it leaked out of the tests into production
 * and into `tests/integration/cqe-end-to-end.test.ts`, which flaked ~1 run in
 * 2 (ROADMAP 1.232). The guards now measure CPU time, so a real extraction
 * (~0.3ms of CPU, ~30ms cold) no longer approaches the 200ms budget however
 * loaded the host is. The freeze is kept for hermeticity, not to dodge a
 * race.
 */
function withFrozenClock(): { restore: () => void } {
  const spy = vi.spyOn(process, 'cpuUsage').mockImplementation(() => cpuUsageAt(1000));
  return { restore: () => spy.mockRestore() };
}

/**
 * Install a fake CPU clock and return rules in which exactly `slowRuleId`
 * burns `burnMs` of fake CPU time inside its own apply(). Because the
 * orchestrator samples the clock immediately before and after apply(), only
 * that rule's measured duration moves — deterministically.
 */
function withFakeClock(slowRuleId: string, burnMs: number): {
  rules: PatternRule[];
  restore: () => void;
} {
  let t = 1000;
  const spy = vi.spyOn(process, 'cpuUsage').mockImplementation(() => cpuUsageAt(t));
  const rules = PATTERN_RULES.map((rule) =>
    rule.id === slowRuleId
      ? ({
          ...rule,
          apply: (text: string, ctx: Parameters<PatternRule['apply']>[1]) => {
            t += burnMs;
            return rule.apply(text, ctx);
          },
        } satisfies PatternRule)
      : rule,
  );
  return { rules, restore: () => spy.mockRestore() };
}

describe('CQE degraded-extraction pin (P0: silent value substitution)', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    warnSpy = vi.fn();
    vi.spyOn(log, 'warn').mockImplementation(warnSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // POSITIVE CONTROL. Before asserting any absence, prove the harness can
  // SEE the presence: prove the correct values are what an undisturbed run
  // produces, and prove the substitution is real and reachable.
  // ---------------------------------------------------------------------
  describe('positive controls', () => {
    it('undisturbed extraction produces the CORRECT values (baseline presence)', () => {
      const { restore } = withFrozenClock();
      try {
        const pct = runExtraction('increase by about 10%');
        expect(pct.results.map((r) => r.value)).toEqual([0.1]);
        expect(pct.summary.patterns_matched).toContain('P6');
        expect(pct.summary.degraded).toBe(false);

        const bn = runExtraction('USD 1.2bn');
        expect(bn.results.map((r) => r.value)).toEqual([1_200_000_000]);
        expect(bn.summary.patterns_matched).toContain('P8');
        expect(bn.summary.degraded).toBe(false);
      } finally {
        restore();
      }
    });

    it('a genuinely-skipped rule DOES produce the wrong number (defect is real)', () => {
      // The `forceTimeoutPatterns` hook skips apply() entirely — the rule
      // truly never runs, which is the L119/total-budget shape. This test
      // documents that the corruption is real and that `degraded` is the
      // only signal distinguishing it.
      // Clock frozen so the ONLY skipped rule is the forced one — no real
      // budget can trip and confound the comparison.
      const { restore } = withFrozenClock();
      try {
        const bn = __runExtractionForTesting('USD 1.2bn', {
          forceTimeoutPatterns: new Set(['P8']),
        });
        expect(bn.results.map((r) => r.value)).toEqual([1.2]); // 1e-9x wrong
        expect(bn.results[0]!.source).toBe('compromise');
        expect(bn.summary.degraded).toBe(true);

        // RANGE COLLAPSE, and note `source` never leaves 'cqe' — one range
        // quantity becomes two point quantities, both claimed by a
        // lower-priority RULE. A `source` guard is blind to this.
        const range = __runExtractionForTesting('from £50k to £70k', {
          forceTimeoutPatterns: new Set(['P11']),
        });
        expect(range.results.map((r) => r.value)).toEqual([50_000, 70_000]);
        expect(range.results.map((r) => r.source)).toEqual(['cqe', 'cqe']);
        expect(range.summary.degraded).toBe(true);
      } finally {
        restore();
      }
    });

    it('OPERATOR FLIP: count, value and source ALL unchanged — only provenance sees it', () => {
      // ---------------------------------------------------------------
      // This arm replaces the "increase by about 10%" P6 -> P6b arm, which
      // used to assert `[10]` — a 100x substitute. That number was NOT a
      // property of degradation; it was a defect IN P6b, which assigned
      // `unit: 'percentage'` and never divided by 100. P6b was wrong on the
      // HEALTHY path too, with every rule running (ROADMAP 1.235, pinned in
      // extract-quantities.p6b-percentage.test.ts). Fixing it at source
      // makes P6b a faithful substitute for P6 on that string — measured
      // byte-identical — so keeping the arm and merely relaxing `[10]` to
      // `[0.1]` would have left a control that asserts the substitute
      // agrees with the original, i.e. a control that can no longer fail
      // for the reason it exists. It is re-pointed rather than relaxed.
      //
      // The replacement is strictly STRONGER than the arm it replaces. It
      // keeps every property that made the old arm worth having — count
      // unchanged, `source` still 'cqe' — and adds one: the VALUE is
      // byte-identical too, so a magnitude heuristic is blind as well.
      // Only `summary.degraded` distinguishes it.
      // ---------------------------------------------------------------
      const { restore } = withFrozenClock();
      try {
        const undisturbed = runExtraction('reduce to 5%');
        expect(undisturbed.results.map((r) => r.operator)).toEqual(['set']);
        expect(undisturbed.summary.degraded).toBe(false);

        const flipped = __runExtractionForTesting('reduce to 5%', {
          forceTimeoutPatterns: new Set(['P12']),
        });
        // Same count, same value, same source, same unit...
        expect(flipped.results).toHaveLength(undisturbed.results.length);
        expect(flipped.results.map((r) => r.value)).toEqual([0.05]);
        expect(flipped.results.map((r) => r.source)).toEqual(['cqe']);
        expect(flipped.results.map((r) => r.unit)).toEqual(['percentage']);
        // ...but "set it to 5%" has silently become "reduce it BY 5%".
        expect(flipped.results.map((r) => r.operator)).toEqual(['decrement']);
        // The one signal that catches it.
        expect(flipped.summary.degraded).toBe(true);
      } finally {
        restore();
      }
    });
  });

  // ---------------------------------------------------------------------
  // THE CRITICAL CLASS: the per-rule cap fork (L140) is the one measured
  // firing under real load. A rule that ran to COMPLETION but
  // slowly must keep its result — the regex already finished, so its
  // output is exactly as correct as an in-budget run.
  // ---------------------------------------------------------------------
  describe('a SLOW but COMPLETED rule keeps its result (per-rule cpu-time fork)', () => {
    it('"increase by about 10%" stays 0.1 when P6 exceeds its cpu-time cap', () => {
      const { rules, restore } = withFakeClock('P6', CQE_REGEX_TIMEOUT_MS + 10);
      try {
        const { results, summary } = __runExtractionForTesting(
          'increase by about 10%',
          { patternRules: rules },
        );

        // THE PIN: the value is the correct one, not the 100x substitute.
        expect(results.map((r) => r.value)).toEqual([0.1]);
        expect(summary.patterns_matched).toContain('P6');

        // Slow, and reported as slow — but NOT degraded, so routing may
        // still apply it.
        expect(summary.timeout).toBe(true);
        expect(summary.degraded).toBe(false);

        // The slow-rule signal the design doc asks for is still emitted.
        const slowCalls = warnSpy.mock.calls.filter((c) => {
          const p = c[0] as Record<string, unknown>;
          return (
            p.event === 'cqe.pattern_timeout' &&
            p.pattern_id === 'P6' &&
            p.reason === 'cpu_time_exceeded'
          );
        });
        expect(slowCalls).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it('"USD 1.2bn" stays 1200000000 when P8 exceeds its cpu-time cap', () => {
      const { rules, restore } = withFakeClock('P8', CQE_REGEX_TIMEOUT_MS + 10);
      try {
        const { results, summary } = __runExtractionForTesting('USD 1.2bn', {
          patternRules: rules,
        });
        expect(results.map((r) => r.value)).toEqual([1_200_000_000]);
        expect(results[0]!.source).toBe('cqe');
        expect(summary.timeout).toBe(true);
        expect(summary.degraded).toBe(false);
      } finally {
        restore();
      }
    });
  });

  // ---------------------------------------------------------------------
  // THE SILENT FORK: total-budget exhaustion used to `break` emitting NO
  // telemetry at all, on a path that writes values into the user's graph.
  // ---------------------------------------------------------------------
  describe('total-budget exhaustion is observable and marks the run degraded', () => {
    it('emits cqe.budget_exhausted naming the skipped rules, and sets degraded', () => {
      // Burn the whole budget inside the FIRST rule, so the budget check at
      // the top of the next iteration trips.
      const first = PATTERN_RULES[0]!;
      const { rules, restore } = withFakeClock(first.id, CQE_TOTAL_BUDGET_MS + 50);
      try {
        const { summary } = __runExtractionForTesting('USD 1.2bn', {
          patternRules: rules,
        });

        expect(summary.degraded).toBe(true);
        expect(summary.timeout).toBe(true);

        const budgetCalls = warnSpy.mock.calls.filter((c) => {
          const p = c[0] as Record<string, unknown>;
          return p.event === 'cqe.budget_exhausted';
        });
        // THE PIN: this fork used to be completely silent.
        expect(budgetCalls).toHaveLength(1);
        const payload = budgetCalls[0]![0] as Record<string, unknown>;
        expect(payload.degraded).toBe(true);
        expect(payload.total_budget_ms).toBe(CQE_TOTAL_BUDGET_MS);
        // It names WHICH fidelity was lost, not merely that some was.
        expect(Array.isArray(payload.skipped_pattern_ids)).toBe(true);
        expect(payload.skipped_pattern_ids).toContain('P8');
        expect(payload.skipped_count).toBe(PATTERN_RULES.length - 1);
      } finally {
        restore();
      }
    });
  });

  it('an undisturbed run emits no timeout/budget telemetry at all', () => {
    // Absence assertion, made non-vacuous by the presence assertions above.
    // Clock frozen: against the real clock this would be load-dependent.
    const { restore } = withFrozenClock();
    try {
      runExtraction('increase by about 10%');
    } finally {
      restore();
    }
    const noisy = warnSpy.mock.calls.filter((c) => {
      const p = c[0] as Record<string, unknown>;
      return p.event === 'cqe.pattern_timeout' || p.event === 'cqe.budget_exhausted';
    });
    expect(noisy).toHaveLength(0);
  });
});
