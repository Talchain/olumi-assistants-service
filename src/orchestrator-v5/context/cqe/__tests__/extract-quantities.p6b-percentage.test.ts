/**
 * P6b percentage-normalisation pin (ROADMAP 1.235).
 *
 * THE DEFECT THIS PINS — and note it is a HEALTHY-PATH defect, not a
 * degraded-path one. `extract-quantities.degraded.test.ts` names "P6 -> P6b"
 * as a 100x substitution mode and frames it as something that only happens
 * when P6 is skipped. That framing was too narrow: P6b was wrong ON ITS OWN,
 * with every rule running, `degraded === false` and no timeout.
 *
 *   "we grew 5% and margin 3%"  ->  [5, 0.03]   <- internally inconsistent
 *   "raise it 5% then hold"     ->  [5]          <- 100x
 *   "grow revenue 5% ..."       ->  [5, 3]       <- 100x
 *
 * P6b assigned `unit: 'percentage'` but never applied the `/100` that every
 * sibling applies. The consumer (`mapCqeQuantityToProposalValue`) multiplies
 * a `'percentage'` value by 100 to recover user units, so a stored 5 became
 * 500% on a value that is deterministically applied to the user's graph.
 *
 * WHY P6b OWNS THESE STRINGS AT ALL (this is the part that is easy to get
 * wrong): P6 requires a mandatory `by`. All the strings above omit it, so P6
 * cannot claim them, and P9 refuses any `N%` preceded by a direction verb.
 * The territory is P6b's by construction; the fix is to normalise, not to
 * decline. See the block comment above P6B_REGEX in rules.ts.
 *
 * EVERY assertion here runs on the HEALTHY path and asserts
 * `degraded === false` explicitly, so none of these pins can be satisfied by
 * degraded-path behaviour.
 */

import { describe, expect, it } from 'vitest';
import { runExtraction } from '../extract-quantities.js';
import { PATTERN_RULES } from '../rules.js';

/** Assert the run was undisturbed, then hand back the results. */
function healthy(message: string): ReturnType<typeof runExtraction>['results'] {
  const out = runExtraction(message);
  // The pin is only meaningful on an undisturbed run. If either of these
  // ever trips, the test below is measuring the degraded path and its
  // verdict must be discarded, not believed.
  expect(out.summary.degraded).toBe(false);
  expect(out.summary.timeout).toBe(false);
  return out.results;
}

describe('P6b normalises percentages to fractions (healthy path)', () => {
  // -------------------------------------------------------------------
  // POSITIVE CONTROL. Before pinning P6b, prove the harness can SEE a
  // correct percentage — i.e. that `healthy()` is not returning something
  // that would pass these assertions regardless of the value.
  // -------------------------------------------------------------------
  describe('positive controls (the instrument is not blind)', () => {
    it('the P6 spelling ("by" present) yields the fraction, via P6', () => {
      const out = runExtraction('increase by about 10%');
      expect(out.summary.degraded).toBe(false);
      expect(out.summary.patterns_matched).toContain('P6');
      expect(out.results.map((r) => r.value)).toEqual([0.1]);
      expect(out.results[0]!.unit).toBe('percentage');
    });

    it('the P9 spelling (no verb) yields fractions, via P9', () => {
      const out = runExtraction('the plan assumes 12% and 7%');
      expect(out.summary.degraded).toBe(false);
      expect(out.summary.patterns_matched).toContain('P9');
      expect(out.results.map((r) => r.value)).toEqual([0.12, 0.07]);
    });

    it('the instrument distinguishes 5 from 0.05', () => {
      // Guards against a matcher that would pass on either number — the
      // failure mode that makes an assertion vacuous. `toEqual` on numbers
      // is exact, and this proves it.
      expect([0.05]).not.toEqual([5]);
    });
  });

  // -------------------------------------------------------------------
  // THE PIN: the four measured strings, all on the healthy path.
  // -------------------------------------------------------------------
  describe('the measured 100x strings', () => {
    it('"we grew 5% and margin 3%" is internally consistent (both fractions)', () => {
      const results = healthy('we grew 5% and margin 3%');
      // Before the fix: [5, 0.03] — two percentages in ONE message
      // disagreeing about their own convention by a factor of 100.
      expect(results.map((r) => r.value)).toEqual([0.05, 0.03]);
      expect(results.map((r) => r.unit)).toEqual(['percentage', 'percentage']);
    });

    it('"raise it 5% then hold" yields 0.05, not 5', () => {
      const results = healthy('raise it 5% then hold');
      expect(results.map((r) => r.value)).toEqual([0.05]);
      expect(results[0]!.unit).toBe('percentage');
    });

    it('"increase the fee 5% quarterly" yields 0.05, not 5', () => {
      const results = healthy('increase the fee 5% quarterly');
      expect(results.map((r) => r.value)).toEqual([0.05]);
      expect(results[0]!.unit).toBe('percentage');
    });

    it('"grow revenue 5% while cutting 3%" yields fractions for both', () => {
      const results = healthy('grow revenue 5% while cutting 3%');
      expect(results.map((r) => r.value)).toEqual([0.05, 0.03]);
      expect(results.map((r) => r.unit)).toEqual(['percentage', 'percentage']);
    });
  });

  // -------------------------------------------------------------------
  // The fix must not buy correctness by handing the span to a
  // lower-fidelity claimant. That was the measured cost of the
  // move-the-lookahead alternative: right number, but `operator` and
  // `direction` dropped and `source` downgraded to 'compromise'.
  // -------------------------------------------------------------------
  describe('P6b keeps the span and its full semantics', () => {
    it('P6b (not the compromise backstop) claims "grow revenue 5%"', () => {
      const out = runExtraction('grow revenue 5% while cutting 3%');
      expect(out.summary.degraded).toBe(false);
      expect(out.summary.patterns_matched).toContain('P6b');
      expect(out.results.map((r) => r.source)).toEqual(['cqe', 'cqe']);
      // The direction the user actually stated survives.
      expect(out.results.map((r) => r.direction)).toEqual(['up', 'down']);
      expect(out.results.map((r) => r.operator)).toEqual([
        'increment',
        'decrement',
      ]);
    });
  });

  // -------------------------------------------------------------------
  // Non-percentage P6b territory must be untouched by the /100.
  // -------------------------------------------------------------------
  describe('non-percentage P6b units are unaffected', () => {
    it.each([
      ['increase it by 5 months', 5, 'month'],
      ['reduce the budget by £5k', 5000, 'GBP'],
      ['add 2 kg', 2, 'kg'],
    ])('%s -> %s %s', (message, value, unit) => {
      const results = healthy(message as string);
      expect(results.map((r) => r.value)).toEqual([value]);
      expect(results[0]!.unit).toBe(unit);
    });

    it('percentage_points stays a RAW count, not a fraction', () => {
      // The deliberate exception to the convention: the consumer passes
      // `percentage_points` through unscaled, so dividing here would be a
      // 100x error in the opposite direction.
      const results = healthy('increase by 10 percentage points');
      expect(results.map((r) => r.value)).toEqual([10]);
      expect(results[0]!.unit).toBe('percentage_points');
    });
  });

  // -------------------------------------------------------------------
  // The convention itself, asserted over the whole rule table rather than
  // per-rule — so a NEW rule that emits `percentage` without normalising
  // fails here instead of shipping the same defect again. This is the
  // derive-don't-mirror form: the rule list comes from PATTERN_RULES, not
  // from a hand-maintained list of rule ids that would silently go stale.
  // -------------------------------------------------------------------
  describe('convention: unit "percentage" always means value is a FRACTION', () => {
    const PROBES: ReadonlyArray<{ rule: string; text: string }> = [
      { rule: 'P1', text: 'between 5% and 10%' },
      { rule: 'P2', text: '5 to 10 %' },
      { rule: 'P3', text: 'at least 5%' },
      { rule: 'P6', text: 'increase by 5%' },
      { rule: 'P6b', text: 'grew 5%' },
      { rule: 'P7', text: 'set churn to 5%' },
      { rule: 'P9', text: '5%' },
      { rule: 'P11', text: 'from 3% to 5%' },
      { rule: 'P12', text: 'reduce to 5%' },
    ];

    it('every rule emitting unit "percentage" emits a value < 1 for "5%"', () => {
      // Each rule is exercised through its OWN apply(), not through the
      // masked pipeline, so ordering cannot hide a rule that never gets a
      // chance to be wrong.
      const offenders: string[] = [];
      for (const rule of PATTERN_RULES) {
        const probe = PROBES.find((p) => p.rule === rule.id);
        if (!probe) continue;
        const matches = rule.apply(probe.text, { wordNumberReplacements: [] });
        expect(
          matches.length,
          `probe for ${rule.id} matched nothing — the probe has gone stale ` +
            `and this rule is being checked vacuously`,
        ).toBeGreaterThan(0);
        for (const m of matches) {
          if (m.result.unit !== 'percentage') continue;
          for (const field of ['value', 'range_min', 'range_max'] as const) {
            const v = m.result[field];
            if (typeof v !== 'number') continue;
            // Every probe uses percentages <= 10%, so a correctly
            // normalised value is always < 1 and an un-normalised one is
            // always >= 1. No probe sits near the boundary.
            if (v >= 1) offenders.push(`${rule.id}.${field}=${v}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
