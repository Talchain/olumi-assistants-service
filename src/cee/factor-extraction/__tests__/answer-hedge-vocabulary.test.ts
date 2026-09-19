/**
 * ⭐ THE TWO VOCABULARIES, DERIVED FROM ONE LIST.
 *
 * `PRESENT_STATE_QUALIFIERS` (module-private) carries two kinds of word that
 * are useful in OPPOSITE directions: tense markers say WHEN, hedges say only
 * HOW PRECISELY. `ANSWER_HEDGE_WORDS` is that list minus `PRESENT_STATE_TENSE_WORDS`
 * (and minus `right`, whose dominant answer use is "right now").
 *
 * ⛔ WHAT THIS FILE REPLACES, and why the replacement is the point. Its
 * predecessor tested `reportsPresentState`, a NEGATIVE predicate used to refuse
 * a goal-target answer. That polarity was wrong: a finite marker list returning
 * FALSE is not affirmative evidence that a message IS a target answer, and the
 * independent review produced "Our baseline MRR is £12,000." — a baseline report
 * carrying no marker at all. The predicate is withdrawn; only the vocabulary
 * survives, and it is now consumed POSITIVELY (a hedge is answer furniture, so
 * a message that is an amount plus hedges is a bare answer).
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { ANSWER_HEDGE_WORDS, PRESENT_STATE_TENSE_WORDS } from '../stated-level.js';

describe('ANSWER_HEDGE_WORDS — derived, and disjoint from the tense words', () => {
  it('contains the hedges', () => {
    for (const hedge of ['at', 'around', 'about', 'roughly']) {
      expect(ANSWER_HEDGE_WORDS, hedge).toContain(hedge);
    }
  });

  it('⭐ contains NO tense word — the two sets cannot overlap by construction', () => {
    // This is the assertion that makes the derivation load-bearing: a word
    // added to the shared qualifier list lands in exactly one of the two sets,
    // so it can never be answer furniture here and a tense marker there.
    for (const tense of PRESENT_STATE_TENSE_WORDS) {
      expect(ANSWER_HEDGE_WORDS, tense).not.toContain(tense);
    }
    // `right` is subtracted on top of the tense set — see the constant's doc.
    expect(ANSWER_HEDGE_WORDS).not.toContain('right');
  });

  it('NON-VACUITY — both sets are non-empty, so the disjointness above says something', () => {
    expect(ANSWER_HEDGE_WORDS.length).toBeGreaterThan(0);
    expect(PRESENT_STATE_TENSE_WORDS.length).toBeGreaterThan(0);
  });
});
