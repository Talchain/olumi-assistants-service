/**
 * "UNDER 4%" AND "AT MOST 4%" BECOME THE SAME THING — AND THE EVIDENCE TO TELL
 * THEM APART IS STILL IN THE ROW.
 *
 * ⛔ THE DEFECT, measured end to end across CEE → PLoT → ISL on served SHAs:
 *    a user's strict bound is mapped to the inclusive operator at extraction,
 *    with no loss record anywhere on the conventional path. At exactly the
 *    threshold the product then tells them, verbatim:
 *
 *        "this option met every limit you set, in all the scenarios we tested."
 *
 *    (`plot/src/routes/v2/crown-eligibility.ts:292` on `prob_satisfied === 1`;
 *     ISL's terminal test is `value <= constraint.threshold`,
 *     `robustness_analyzer_v2.py:8939-8940`.) A 2% baseline plus a 2pp effect
 *    resolves to exactly 4% and is reported COMPLIANT with "under 4%".
 *    `2/100 + 2/100 === 4/100` is exactly true, so this is deterministic, not
 *    a floating-point edge.
 *
 * ⭐ WHY THIS TEST EXISTS RATHER THAN A FIX. The shared wire vocabulary is
 *    inclusive-only in all three repos (`graph.ts:208`, PLoT `translator-v3.ts`,
 *    ISL `robustness_v2.py:661`), so no strict OPERATOR can be sent. But the
 *    fix does not need one — it needs a MARKER, and the second assertion here
 *    proves the marker is derivable from data this layer already carries.
 *    Pinning that is what makes the eventual fix provable instead of arguable.
 *
 * ⚠ WHAT TO DO WHEN THE FIX LANDS — AND THE ANSWER DEPENDS ON WHICH FIX.
 *
 *    An earlier version of this header said flatly "THE FIRST TEST MUST BE
 *    INVERTED". That was imprecise for the very fix this file proposes, and an
 *    independent review caught it by mutating rather than reading:
 *
 *    - A fix that adds a strictness MARKER and leaves `comparator` alone — the
 *      shape recommended above — leaves all three tests GREEN. Inverting the
 *      first one under that fix would turn it red on CORRECT code. Instead, add
 *      an assertion that the marker distinguishes the two rows; the equality
 *      below stays true and stays worth pinning, because the shared wire
 *      vocabulary remains inclusive-only.
 *    - A fix that changes `comparator` itself (a strict member in the enum)
 *      turns tests 1 and 3 red. THAT is the case where they must be inverted,
 *      and it is a contract change across three repos, not a local one.
 *
 *    So: a green run here is not evidence the defect is fixed. It is evidence
 *    the loss is still faithfully characterised. Read which fix landed before
 *    touching these assertions.
 */
import { describe, it, expect } from 'vitest';

import { extractQuantities } from '../extract-quantities.js';

const comparatorOf = (text: string) => {
  const rows = extractQuantities(text);
  const withComparator = rows.filter((r) => r.comparator !== null);
  return { rows, withComparator };
};

describe('the strict/inclusive distinction is destroyed at extraction', () => {
  it('DEFECT: a strict bound and an inclusive bound are indistinguishable in the typed field', () => {
    const strict = comparatorOf('keep monthly churn under 4%');
    const inclusive = comparatorOf('keep monthly churn at most 4%');

    expect(strict.withComparator.length, 'the strict phrasing must extract at all').toBeGreaterThan(0);
    expect(inclusive.withComparator.length, 'the inclusive phrasing must extract at all').toBeGreaterThan(0);

    // Both collapse to the SAME comparator. `under` (strict) and `at most`
    // (inclusive) are members of one alternation, COMPARATOR_ATMOST_SOURCE
    // (`rules.ts:446`), and the type has no strict member at all
    // (`schema-types.ts:36`, z.enum(['at_least','at_most','between'])).
    expect(strict.withComparator[0]?.comparator).toBe('at_most');
    expect(inclusive.withComparator[0]?.comparator).toBe('at_most');
    expect(
      strict.withComparator[0]?.comparator,
      'THIS EQUALITY IS THE DEFECT: nothing downstream can tell a strict bound from an inclusive one',
    ).toBe(inclusive.withComparator[0]?.comparator);

    // And the values agree, so the threshold alone cannot disambiguate either.
    expect(strict.withComparator[0]?.value).toBe(inclusive.withComparator[0]?.value);
  });

  it('⭐ THE FIX IS FEASIBLE HERE: `raw_text` still carries the word the user used', () => {
    const strict = comparatorOf('keep monthly churn under 4%');
    const inclusive = comparatorOf('keep monthly churn at most 4%');

    // The information destroyed in `comparator` is still present one field over.
    expect(strict.withComparator[0]?.raw_text.toLowerCase()).toContain('under');
    expect(inclusive.withComparator[0]?.raw_text.toLowerCase()).toContain('at most');
    expect(
      strict.withComparator[0]?.raw_text,
      'the rows differ in raw_text even though they are identical in comparator — ' +
        'so a strictness marker is derivable WITHOUT a new shared operator',
    ).not.toBe(inclusive.withComparator[0]?.raw_text);
  });

  it('CONTROL: the opposite direction collapses the same way, so this is not a one-word quirk', () => {
    const strict = comparatorOf('keep monthly revenue over £4m');
    const inclusive = comparatorOf('keep monthly revenue at least £4m');
    expect(strict.withComparator[0]?.comparator).toBe('at_least');
    expect(inclusive.withComparator[0]?.comparator).toBe('at_least');
    expect(strict.withComparator[0]?.raw_text.toLowerCase()).toContain('over');
  });
});
