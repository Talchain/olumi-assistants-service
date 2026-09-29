/**
 * ⭐⭐ T6 / ROADMAP 2.722 — THE POINT-COLLAPSE GUARD.
 *
 * THE DEFECT, reproduced at pristine before the guard existed:
 *
 *   elicitBelief({ user_expression: "3 out of 7 similar projects succeeded" })
 *     -> { suggested_value: 0.42857…, confidence: 'high',
 *          needs_clarification: false }
 *
 * `parseFraction` (`src/cee/belief-elicitation/index.ts`) matches
 * `/(\d+)\s*(?:in|out of)\s*(\d+)/i` and divides. Two fabrications in one
 * return value: THE SAMPLE SIZE IS DESTROYED (the 7 is gone, and it was the
 * only thing from which uncertainty could be derived), and SURENESS IS
 * INVENTED ('high' on a 7-case sample whose honest middle-half band spans
 * roughly 33%-56%).
 *
 * ⭐ THE ASSERTIONS ARE PAIRED IN BOTH DIRECTIONS, because this guard could
 * fail two opposite ways and only one of them is obvious:
 *   - TOO WEAK: a K-of-N reference-class statement still collapses. Caught by
 *     the "the defect is dead" block.
 *   - TOO STRONG: the guard eats legitimate probability expressions, and
 *     `elicitBelief("3 in 4") -> 0.75` — the module's OWN documented example,
 *     and live behaviour for the `/assist/v1/elicit-belief` route's UI
 *     callers — regresses. Caught by the "existing behaviour is untouched"
 *     block, which pins the module docstring's three examples verbatim.
 * A guard that only had the first half would be shipped by a lane that
 * measured half the surface (CLAUDE.md trap 13b).
 */
import { describe, it, expect } from 'vitest';

import { elicitBelief } from '../../../cee/belief-elicitation/index.js';
import { recogniseReferenceClass } from '../reference-class-grammar.js';

function elicit(expression: string) {
  return elicitBelief({
    node_id: 'f-launch',
    node_label: 'Launch succeeds',
    user_expression: expression,
    target_type: 'prior',
  });
}

/** The exact sentence the hazard note names. */
const HAZARD = '3 out of 7 similar projects succeeded';

describe('T6 — the collapse is dead', () => {
  it('⭐ "3 out of 7 similar projects succeeded" is NEVER returned as 0.43-with-high-confidence', () => {
    const result = elicit(HAZARD);
    // The two fabrications, asserted separately.
    expect(result.suggested_value).not.toBeCloseTo(3 / 7, 3);
    expect(result.confidence).not.toBe('high');
    // And the honest behaviour: it asks.
    expect(result.needs_clarification).toBe(true);
    expect(result.clarifying_question).toBeDefined();
    expect(result.clarifying_question!.toLowerCase()).toContain('how many');
  });

  it('the reasoning NAMES the sample size as the thing that would be lost', () => {
    const result = elicit(HAZARD);
    expect(result.reasoning.toLowerCase()).toContain('sample size');
  });

  it('no count-bearing reference-class statement collapses to its raw ratio', () => {
    const corpus: readonly (readonly [string, number, number])[] = [
      ['3 out of 7 similar projects succeeded', 3, 7],
      ["Of the 7 product launches like this I've seen, 3 hit their first-year target", 3, 7],
      ["we've run 12 campaigns; 9 landed", 9, 12],
      ['0 out of 7 comparable migrations delivered on time', 0, 7],
      ['5 out of 5 pilots we ran converted', 5, 5],
    ];
    for (const [message, k, n] of corpus) {
      const result = elicit(message);
      expect(result.suggested_value, message).not.toBeCloseTo(k / n, 3);
      expect(result.confidence, message).not.toBe('high');
      expect(result.needs_clarification, message).toBe(true);
    }
  });

  it('⭐ POSITIVE CONTROL (trap 13) — the harness CAN see a high-confidence point when one is legitimate', () => {
    // If this ever stops being 0.75/high, every negative assertion above is
    // passing because the harness is blind, not because the guard works.
    const control = elicit('3 in 4');
    expect(control.suggested_value).toBeCloseTo(0.75, 10);
    expect(control.confidence).toBe('high');
    expect(control.needs_clarification).toBe(false);
  });

  it('the guard fires exactly when the grammar owns the utterance — one definition, no mirror', () => {
    for (const message of [
      HAZARD,
      '3 in 4',
      '3/4',
      'about 40% of launches like this succeed',
      "we've run 12 campaigns; 9 landed",
      'pretty likely',
    ]) {
      const owned = recogniseReferenceClass(message).kind;
      const asked = elicit(message).needs_clarification;
      if (owned === 'statement' || owned === 'confirm') {
        expect(asked, `${message} should have been guarded`).toBe(true);
      }
    }
  });
});

describe('T6 — existing behaviour is UNTOUCHED (the too-strong direction)', () => {
  it('⭐ the module docstring\'s own three examples still hold, byte for byte', () => {
    // From `src/cee/belief-elicitation/index.ts`'s header:
    //   elicitBelief("pretty likely") -> 0.70 high
    //   elicitBelief("about 70%")     -> 0.70 high
    //   elicitBelief("3 in 4")        -> 0.75 high
    const prettyLikely = elicit('pretty likely');
    expect(prettyLikely.suggested_value).toBeCloseTo(0.7, 10);
    expect(prettyLikely.confidence).toBe('high');

    const aboutSeventy = elicit('about 70%');
    expect(aboutSeventy.suggested_value).toBeCloseTo(0.7, 10);
    expect(aboutSeventy.confidence).toBe('high');

    const threeInFour = elicit('3 in 4');
    expect(threeInFour.suggested_value).toBeCloseTo(0.75, 10);
    expect(threeInFour.confidence).toBe('high');
  });

  it('every bare fraction keeps its documented value and confidence', () => {
    const fractions: readonly (readonly [string, number])[] = [
      ['3 in 4', 0.75],
      ['3 out of 4', 0.75],
      ['1 in 10', 0.1],
      ['3/4', 0.75],
      ['1/2', 0.5],
      ['one half', 0.5],
      ['three quarters', 0.75],
    ];
    for (const [expression, expected] of fractions) {
      const result = elicit(expression);
      expect(result.suggested_value, expression).toBeCloseTo(expected, 10);
      expect(result.confidence, expression).toBe('high');
      expect(result.needs_clarification, expression).toBe(false);
    }
  });

  it('percentages, decimals and qualitative terms are unaffected', () => {
    expect(elicit('70%').suggested_value).toBeCloseTo(0.7, 10);
    expect(elicit('0.7').suggested_value).toBeCloseTo(0.7, 10);
    expect(elicit('very likely').suggested_value).toBeCloseTo(0.85, 10);
    expect(elicit('almost never').suggested_value).toBeCloseTo(0.05, 10);
    for (const expression of ['70%', '0.7', 'very likely', 'almost never']) {
      expect(elicit(expression).needs_clarification, expression).toBe(false);
    }
  });

  it('the ambiguous and unrecognised paths still behave as before', () => {
    const ambiguous = elicit('good');
    expect(ambiguous.needs_clarification).toBe(true);
    expect(ambiguous.suggested_value).toBe(0.5);
    expect(ambiguous.options).toBeDefined();

    const empty = elicit('');
    expect(empty.needs_clarification).toBe(true);
    expect(empty.suggested_value).toBe(0.5);
  });

  it('a stated RATE without counts is NOT guarded — it keeps the existing path (I5)', () => {
    // No N means this feature has nothing to add, so it must not intercept.
    const result = elicit('40%');
    expect(result.suggested_value).toBeCloseTo(0.4, 10);
    expect(result.confidence).toBe('high');
    expect(result.needs_clarification).toBe(false);
  });
});
