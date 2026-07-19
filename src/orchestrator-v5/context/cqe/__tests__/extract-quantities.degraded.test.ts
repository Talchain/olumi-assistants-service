/**
 * P0 pin — a degraded extraction must never silently yield a value that
 * gets deterministically applied.
 *
 * THE DEFECT THIS PINS (reproduced on staging under CPU load):
 * when a pattern rule was skipped, the span it would have claimed was left
 * unmasked and got re-claimed by a LOWER-FIDELITY substitute, which emitted
 * a DIFFERENT NUMBER with full confidence and normal `source`. Measured:
 *
 *   "increase by about 10%"  0.1        -> 10          (100x)   P6  -> P6b
 *   "USD 1.2bn"              1200000000 -> 1.2         (1e-9x)  P8  -> compromise
 *
 * Note the two substitution paths differ: the first is a lower-priority CQE
 * RULE taking the span (source stays 'cqe'), the second is the compromise
 * backstop. Neither is visible to a guard keyed on quantity COUNT or on
 * `source` — for THESE TWO cases the count is unchanged and the first never
 * leaves 'cqe'.
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

/**
 * Install a fake monotonic clock and return rules in which exactly
 * `slowRuleId` burns `burnMs` of fake time inside its own apply(). Because
 * the orchestrator samples the clock immediately before and after apply(),
 * only that rule's measured duration moves — deterministically.
 */
/**
 * Freeze the clock so NO wall-clock budget can trip. Required for the
 * "undisturbed run" assertions: on a cold JIT or a loaded machine a real
 * `runExtraction` genuinely exceeds CQE_TOTAL_BUDGET_MS (observed at 86ms
 * for a single rule on first call, and >200ms total), so asserting
 * `degraded === false` against the real clock is a race, not a pin. This
 * is also direct evidence that the caps are tight enough to fire in
 * ordinary conditions, not only under pathological input.
 */
function withFrozenClock(): { restore: () => void } {
  const spy = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => 1000);
  return { restore: () => spy.mockRestore() };
}

function withFakeClock(slowRuleId: string, burnMs: number): {
  rules: PatternRule[];
  restore: () => void;
} {
  let t = 1000;
  const spy = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => t);
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
        const pct = __runExtractionForTesting('increase by about 10%', {
          forceTimeoutPatterns: new Set(['P6']),
        });
        expect(pct.results.map((r) => r.value)).toEqual([10]); // 100x wrong
        expect(pct.results[0]!.source).toBe('cqe'); // NOT compromise — a rule did this
        // Count UNCHANGED *in this mode* — which is why an arity guard is
        // blind here. (Other modes DO change it; see the file header.)
        expect(pct.results).toHaveLength(1);
        expect(pct.summary.degraded).toBe(true); // ...but provenance sees it

        const bn = __runExtractionForTesting('USD 1.2bn', {
          forceTimeoutPatterns: new Set(['P8']),
        });
        expect(bn.results.map((r) => r.value)).toEqual([1.2]); // 1e-9x wrong
        expect(bn.results[0]!.source).toBe('compromise');
        expect(bn.summary.degraded).toBe(true);
      } finally {
        restore();
      }
    });
  });

  // ---------------------------------------------------------------------
  // THE CRITICAL CLASS: the per-rule wall-clock fork (L140) is the one
  // measured firing under real load. A rule that ran to COMPLETION but
  // slowly must keep its result — the regex already finished, so its
  // output is exactly as correct as an in-budget run.
  // ---------------------------------------------------------------------
  describe('a SLOW but COMPLETED rule keeps its result (per-rule wall-clock fork)', () => {
    it('"increase by about 10%" stays 0.1 when P6 exceeds its wall-clock cap', () => {
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
            p.reason === 'wall_clock_exceeded'
          );
        });
        expect(slowCalls).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it('"USD 1.2bn" stays 1200000000 when P8 exceeds its wall-clock cap', () => {
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
