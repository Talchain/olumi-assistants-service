/**
 * ⭐⭐ THE REVIEWER'S CORPUS — THE LOAD-BEARING EVIDENCE FOR THIS SURFACE.
 *
 * CLAUDE.md trap 22c is explicit, and it is the reason this file exists as a
 * SEPARATE spec rather than as extra cases folded into the author's own:
 *
 *   *"for any predicate over natural language, the author's corpus is a
 *   development aid and the REVIEWER's corpus is the evidence."*
 *
 * The author's corpus (`objective-contradiction.corpus.test.ts`) was harvested
 * from 73 real goal labels and carried a confusion matrix, opposite-direction
 * twins and a pinned KNOWN-UNDETERMINED set — and it still could not see two
 * whole defect classes, because **it contained zero negation cases and zero
 * substring-collision cases**. That is trap 22 recurring exactly as written: a
 * corpus that shares the code's blind spot cannot see the code's defect, and a
 * 10/10 mutant kit certified it anyway.
 *
 * Every case below is the reviewer's, verbatim, measured against the real
 * detector through the full wired path. Each is paired with its
 * OPPOSITE-DIRECTION TWIN (trap 22b) — a case that must still FIRE — so the fix
 * cannot close the lie by silencing the surface altogether.
 *
 * ⚠ APPEND-ONLY, and never "tidied". These are recorded misses on a dated
 * build (`2186fa3c`, 14 Aug 2026). You may add; you may not edit an entry to
 * keep it current (trap 14b).
 */

import { describe, it, expect } from 'vitest';

import {
  deriveGoalIntent,
  detectDirectionalContradiction,
  detectGoalAttainmentContradiction,
  type InterventionView,
  type ObjectiveOptionView,
} from '../objective-contradiction.js';

// ============================================================================
// F1 — NEGATION INVERSION (P1). The CEE #888 class.
// ============================================================================

describe('F1 — negation is REFUSED, never inverted (reviewer corpus)', () => {
  /**
   * ⚠ THE WORST OF THE FOUR, in the reviewer's words: *"emitted copy endorsed
   * the options that CUT the budget the user said never to cut."* That is not a
   * gap — it is the product actively recommending the thing the user forbade.
   *
   * The fix is a REFUSAL, not an inversion (trap 22f). Reading "do not
   * increase" as `decrease` would be a second guess layered on the first: "do
   * not increase headcount" does not mean "decrease headcount", it means the
   * user has ruled a direction OUT, and what they want instead is unstated.
   */
  it('RED-first: the four measured misses all return UNDETERMINED', () => {
    expect(deriveGoalIntent('Do not increase headcount').direction).toBe('undetermined');
    expect(deriveGoalIntent('Never cut the marketing budget').direction).toBe('undetermined');
    expect(deriveGoalIntent('Avoid cutting the support team').direction).toBe('undetermined');
    expect(deriveGoalIntent('Avoid raising prices').direction).toBe('undetermined');
  });

  it('the whole negation vocabulary, both directions', () => {
    for (const label of [
      "Don't increase prices",
      'Do not raise the seat price',
      'Never grow headcount beyond 50',
      'Stop increasing marketing spend',
      'Prevent churn from rising',
      'Refuse to cut the support team',
      'Without increasing headcount',
      'Without cutting quality',
      'Avoid lowering the price',
      'Never reduce the support team',
    ]) {
      expect(deriveGoalIntent(label).direction, label).toBe('undetermined');
    }
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWINS (trap 22b). A fix that refuses everything
   * closes the lie and opens a total gap. These must STILL fire — they are the
   * same sentences with the negation removed.
   */
  it('TWIN — the same aims WITHOUT negation still resolve', () => {
    expect(deriveGoalIntent('Increase headcount').direction).toBe('increase');
    expect(deriveGoalIntent('Cut the marketing budget').direction).toBe('decrease');
    expect(deriveGoalIntent('Raise prices').direction).toBe('increase');
    expect(deriveGoalIntent('Lower the price').direction).toBe('decrease');
    expect(deriveGoalIntent('Grow headcount beyond 50').direction).toBe('increase');
  });

  /**
   * ⚠ A negation word that does NOT govern the direction verb must not silence
   * a legitimate aim. "Grow revenue without discounting" states a real
   * direction on revenue; the `without` governs a different verb.
   *
   * This is the precision half of the two-parameter rule (trap 22b): the
   * refusal must be wide enough to catch the four misses and narrow enough not
   * to eat ordinary business English. Where the two cannot be separated the
   * answer is still UNDETERMINED — silence is the safe direction — so these
   * cases are pinned wherever the refusal DOES swallow them, in the
   * KNOWN-UNDETERMINED set at the bottom of this file, rather than left
   * unstated.
   */
  it('negation of a DIFFERENT verb does not silence the aim', () => {
    expect(deriveGoalIntent('Grow revenue without discounting').direction).toBe('increase');
    expect(deriveGoalIntent('Increase price, no exceptions').direction).toBe('increase');
  });
});

// ============================================================================
// F2 — SUBJECT RESOLUTION (P1/P2). Substring collision + first-match binding.
// ============================================================================

/**
 * Two intervened factors; the FIRST is a decoy the old matcher bound to.
 *
 * ⚠ THE DECOY'S VALUES MUST DIFFER ACROSS OPTIONS. With both at 0.2 the
 * "pursuing" set is empty for any aim, so the detector returns `null` whatever
 * the subject resolved to — and the collision assertions would pass without
 * testing the collision at all. That vacuity was caught by this corpus's own
 * RED run: the `"our" ⊄ "Hourly Support Rate"` case went GREEN at the unfixed
 * tip, which is impossible if the substring bug is real. Distinct values make
 * a wrong resolution FIRE, so a silent result is evidence about the matcher.
 */
function decoyFirstInterventions(): InterventionView[] {
  return [
    {
      factor_id: 'fac_hourly_rate',
      factor_label: 'Hourly Support Rate',
      by_option: new Map([
        ['opt_hold', 0.2],
        ['opt_raise', 0.35],
      ]),
    },
    {
      factor_id: 'fac_price_level',
      factor_label: 'Seat Price Level',
      by_option: new Map([
        ['opt_hold', 0.49],
        ['opt_raise', 0.59],
      ]),
    },
  ];
}

const TWO_OPTIONS: readonly ObjectiveOptionView[] = Object.freeze([
  { option_id: 'opt_hold', option_label: 'Hold at £49 Per Seat', win_probability: 0.71 },
  { option_id: 'opt_raise', option_label: 'Raise to £59 Per Seat', win_probability: 0.29 },
]);

describe('F2 — the subject resolves by WORD, not by substring (reviewer corpus)', () => {
  /**
   * ⚠ MEASURED: "our" ⊂ "hourly". A stopword token was admitted (`length > 2`)
   * and matched INSIDE another word, so an aim about the subscription price
   * resolved to the hourly support rate — a factor it does not name.
   */
  it('RED-first: "our" must not match "Hourly Support Rate"', () => {
    const onlyDecoy: InterventionView[] = [decoyFirstInterventions()[0]!];
    expect(
      detectDirectionalContradiction('Increase our subscription price', TWO_OPTIONS, onlyDecoy),
    ).toBeNull();
  });

  it('RED-first: "total" must not match "Total Headcount" for a revenue aim', () => {
    const headcount: InterventionView[] = [
      {
        factor_id: 'fac_headcount',
        factor_label: 'Total Headcount',
        by_option: new Map([
          ['opt_hold', 10],
          ['opt_raise', 20],
        ]),
      },
    ];
    expect(detectDirectionalContradiction('Grow total revenue', TWO_OPTIONS, headcount)).toBeNull();
  });

  it('RED-first: "rate" must not match mid-word inside "Pricing Strategy"', () => {
    // "st-RATE-gy" — the collision the reviewer found.
    const strategy: InterventionView[] = [
      {
        factor_id: 'fac_strategy',
        factor_label: 'Pricing Strategy',
        by_option: new Map([
          ['opt_hold', 0.1],
          ['opt_raise', 0.9],
        ]),
      },
    ];
    expect(detectDirectionalContradiction('Increase win rate', TWO_OPTIONS, strategy)).toBeNull();
  });

  /**
   * ⭐ THE SILENT-ON-A-TRUE-CONTRADICTION CASE, and the most valuable of the
   * four: `.find` bound the FIRST intervened factor whose label collided, so
   * with the decoy ordered first the genuinely-defied price lever was never
   * examined and the surface went silent on a real contradiction. A gap, not a
   * lie — but it is the exact defect the whole surface exists to catch.
   */
  it('RED-first: best-match, not first-match — the decoy must not shadow the real lever', () => {
    const verdict = detectDirectionalContradiction(
      'Increase our subscription price',
      TWO_OPTIONS,
      decoyFirstInterventions(),
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.factor_label).toBe('Seat Price Level');
    expect(verdict!.pursuing_leader_label).toBe('Raise to £59 Per Seat');
  });

  /** TWIN — a genuine word match must still resolve. */
  it('TWIN — an honest subject still resolves to its factor', () => {
    const price: InterventionView[] = [decoyFirstInterventions()[1]!];
    const verdict = detectDirectionalContradiction(
      'Increase our subscription price',
      TWO_OPTIONS,
      price,
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.factor_label).toBe('Seat Price Level');
  });
});

// ============================================================================
// F4 / F5 — the rendered numbers must be honest
// ============================================================================

describe('F4 — a contradiction that ROUNDS to equal is not a contradiction', () => {
  /**
   * ⚠ MEASURED: the surface could render "more likely to reach your stated
   * target (48% against 48%)" — a sentence that asserts a difference the
   * numbers it prints do not show. The gate must be on the RENDERED integers,
   * not the raw floats.
   */
  it('RED-first: 0.484 vs 0.478 both render 48% ⇒ SILENT', () => {
    expect(
      detectGoalAttainmentContradiction([
        { option_id: 'a', option_label: 'A', win_probability: 0.7, probability_of_goal: 0.478 },
        { option_id: 'b', option_label: 'B', win_probability: 0.3, probability_of_goal: 0.484 },
      ]),
    ).toBeNull();
  });

  it('TWIN — a difference that SURVIVES rounding still fires', () => {
    const verdict = detectGoalAttainmentContradiction([
      { option_id: 'a', option_label: 'A', win_probability: 0.7, probability_of_goal: 0.474 },
      { option_id: 'b', option_label: 'B', win_probability: 0.3, probability_of_goal: 0.485 },
    ]);
    expect(verdict).not.toBeNull(); // 47% vs 49%
  });
});

describe('F5 — a probability outside the unit interval is not a probability', () => {
  /**
   * ⚠ MEASURED: `probability_of_goal: 1.5` rendered "(150% against 20%)" and
   * PASSED egress, because the grammar's `\d{1,3}` admits up to 999.
   *
   * Trap 13d: write the invariant against the SPEC, not against the failure
   * mode in hand. The spec for a probability is the closed unit interval, so
   * that is what the guard asserts — not "less than 1000", which is what the
   * grammar happens to allow.
   */
  it('RED-first: out-of-range probabilities are refused, both ends', () => {
    for (const bad of [1.5, -0.2, 42, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        detectGoalAttainmentContradiction([
          { option_id: 'a', option_label: 'A', win_probability: 0.7, probability_of_goal: 0.2 },
          { option_id: 'b', option_label: 'B', win_probability: 0.3, probability_of_goal: bad },
        ]),
        `probability_of_goal=${bad}`,
      ).toBeNull();
    }
  });

  it('TWIN — the closed interval BOUNDS are legitimate values', () => {
    const verdict = detectGoalAttainmentContradiction([
      { option_id: 'a', option_label: 'A', win_probability: 0.7, probability_of_goal: 0 },
      { option_id: 'b', option_label: 'B', win_probability: 0.3, probability_of_goal: 1 },
    ]);
    expect(verdict).not.toBeNull();
    expect(verdict!.better_probability_of_goal).toBe(1);
  });

  it('a leader whose OWN probability is out of range is refused too', () => {
    expect(
      detectGoalAttainmentContradiction([
        { option_id: 'a', option_label: 'A', win_probability: 0.7, probability_of_goal: 1.5 },
        { option_id: 'b', option_label: 'B', win_probability: 0.3, probability_of_goal: 0.9 },
      ]),
    ).toBeNull();
  });
});

// ============================================================================
// F6 — the KNOWN-UNDETERMINED set, pinned EXACTLY
// ============================================================================

/**
 * ⭐ TRAP 22f — THE HONEST WAY TO SHIP A KNOWN GAP.
 *
 * There is no stemming, so a plural or possessive subject does not resolve
 * against a singular factor label: "Raise our prices" fails against "Price
 * Level". That is FAIL-CLOSED (the surface stays silent on a real
 * contradiction) and therefore acceptable — but it means the 68%-Hold defect
 * stays dark on ordinary plural phrasing, which is exactly the phrasing a user
 * writes. It must not be discovered again by accident.
 *
 * Pinned as an EXACT set: this test REDs if the set GROWS (a new phrasing
 * silently went dark) or SHRINKS (something started resolving, which is good
 * news that must be recorded rather than absorbed).
 */
const KNOWN_UNDETERMINED_SUBJECTS: readonly string[] = Object.freeze([
  'Raise our prices', // plural subject vs singular factor label
  'Increase subscription prices',
  'Reduce our costs', // plural vs "Cost to Serve"
  'Grow revenues',
]);

describe('F6 — the no-stemming gap is pinned, not hidden', () => {
  const priceAndCost: InterventionView[] = [
    {
      factor_id: 'fac_price_level',
      factor_label: 'Price Level',
      by_option: new Map([
        ['opt_hold', 0.49],
        ['opt_raise', 0.59],
      ]),
    },
    {
      factor_id: 'fac_cost',
      factor_label: 'Cost to Serve',
      by_option: new Map([
        ['opt_hold', 0.5],
        ['opt_raise', 0.4],
      ]),
    },
    {
      factor_id: 'fac_revenue',
      factor_label: 'Revenue Run Rate',
      by_option: new Map([
        ['opt_hold', 0.3],
        ['opt_raise', 0.6],
      ]),
    },
  ];

  it('KNOWN-UNDETERMINED is exactly this set — REDs if it grows OR shrinks', () => {
    const stillDark = KNOWN_UNDETERMINED_SUBJECTS.filter(
      (aim) => detectDirectionalContradiction(aim, TWO_OPTIONS, priceAndCost) === null,
    );
    expect(stillDark.slice().sort()).toEqual(KNOWN_UNDETERMINED_SUBJECTS.slice().sort());
  });

  it('POSITIVE CONTROL — the SINGULAR forms of the same aims DO resolve', () => {
    // Without this the set above could be "everything is dark", which would
    // pass while proving nothing (trap 13: an absence claim needs a presence).
    expect(
      detectDirectionalContradiction('Raise our price', TWO_OPTIONS, priceAndCost),
    ).not.toBeNull();
    expect(
      detectDirectionalContradiction('Reduce our cost', TWO_OPTIONS, priceAndCost),
    ).not.toBeNull();
  });
});
