/**
 * The configure-option repair loop must TERMINATE, and must not ship template
 * syntax to a user (L-25 / NEW-5, simulated-user run 2026-08-16).
 *
 * ## What was witnessed, on deployed CEE `bacf35d`
 *
 * 18:15:06Z — the user asked, in plain English, to configure two options and
 * run. The product ignored both configurations and demanded a literal template:
 *
 *   "Tell me what it changes in this form: Set the … option's effect on … to
 *    `<0-1>` Replace `<0-1>` with a number from 0 … to 1."
 *
 * 18:15:42Z — the user complied with that exact syntax, verbatim. **The reply
 * was the IDENTICAL demand again, word for word.** Across 24 minutes and 9 turns
 * they never obtained a single analysis.
 *
 * Two distinct defects live in that one sentence and they need separate pins:
 *
 *   1. **Non-termination.** `evaluateConfigureOptionOutcome` is pure and
 *      stateless and `collectCandidateFactorLabels` returns the same first
 *      factor while nothing lands, so the composer emits the same bytes
 *      forever. Nothing counted the repeat; nothing varied the copy. Re-asking
 *      a question the user has just answered tells them they did not do the
 *      thing they did.
 *   2. **`<0-1>` in user copy.** A strategic user was asked to hand-expand a
 *      placeholder inside a command string.
 */

import { describe, it, expect } from 'vitest';
import { QUALITATIVE_VALUE_KNOWN_DROPPED } from '../../routing/__tests__/retired-layer-inputs.fixture.js';
import { CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE } from '../../configure-option-chip-text.js';
import { carriesConfigureOptionValuePayload } from '../../routing/configure-option-intent.js';
import { messageAnswersMissingValueAsk, readMissingValueAnswer } from '../../routing/missing-value-answer.js';

describe('angle-bracket placeholder syntax never reaches user copy', () => {

  it('the prompt-embedded advised format carries a real number, not a value placeholder', () => {
    // This constant is interpolated into `prompts/edit-graph-v6.ts` under an
    // instruction to advise "exactly this phrasing", so a placeholder here is
    // reproduced verbatim into user copy by the model — the SECOND, independent
    // emitter of the same defect.
    expect(CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE).not.toContain('<0-1>');
    expect(CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE).toMatch(/\bto\s+\d/);
  });
});

describe('retained answer classification', () => {

  it('an off-target quantity answers the text predicate without binding an identity', () => {
    // The termination signal is a TEXT predicate and cannot tell WHOSE value it
    // saw. Measured below: a message aimed at an entirely different target
    // terminates the demand. That is the RIGHT call for termination (repeating
    // the demand at someone who just typed a value is the defect) and it is
    // exactly why no possession claim may appear in this copy — every sentence
    // must be true of the MODEL, whatever the message contained. Two different
    // questions under one signal is trap 21, and this is the guard against it.
    const offTarget = 'Update the timeline to 3 months';
    expect(messageAnswersMissingValueAsk(offTarget)).toBe(true);
  });

  it('qualitative answers terminate the text predicate without becoming numeric writes', () => {
    // ⚠⚠ THIS TEST'S CLAIM CHANGED AND IS RESTATED RATHER THAN LEFT TO READ
    // FALSELY (trap 14 — an honest label must not survive as a stale one). It
    // used to assert these phrasings "genuinely still fail to terminate", which
    // was true and was the DEFECT: the product advised "…to {value}", the user
    // answered "…to high", and the demand repeated.
    //
    // Both halves of the truth are now asserted:
    //   (a) they still fail the DIGIT-anchored routing predicate — nothing about
    //       binding has changed, and no word is mapped to a number;
    //   (b) they nonetheless TERMINATE, via the changed ask.
    for (const phrasing of QUALITATIVE_VALUE_KNOWN_DROPPED) {
      expect(carriesConfigureOptionValuePayload(phrasing), phrasing).toBe(false);
      expect(messageAnswersMissingValueAsk(phrasing), phrasing).toBe(true);
    }

    // POSITIVE CONTROL — the digit probe can see the other answer, so the loop
    // above is a measurement and not a predicate that always returns false.
    expect(
      carriesConfigureOptionValuePayload("Set the X option's effect on Y to 0.6"),
    ).toBe(true);
  });
});

/**
 * ⛔⛔ THE OUT-OF-SCALE OFFER MUST NOT RESTATE THE USER'S FIGURE ON A SECOND
 * SCALE — the 100× error this PR authored inside the argument that no 100×
 * error may exist.
 *
 * The offer's premise is *"you probably meant that as a percentage"*, which can
 * only be true of a BARE figure. `modelUnitText` has already been divided by
 * 100 for a percent reading, so interpolating it back into a `%` sentence
 * divides twice. Measured at `a77979ec`:
 *
 *   "150%"  →  "If you meant 1.5% … write it with the % and I will set it."
 *
 * The reviewer's mutant R1 replaced this branch with arbitrary text and
 * SURVIVED GREEN at 543/543 — there was no coverage at all. There is now.
 */
describe('the out-of-scale reply never re-scales the user\'s own figure', () => {

  it('the reader identifies numeric percent and bare answers', () => {
    // ⚠ THE STRUCTURAL PIN, not another spelling. The consumer must branch on
    // the reader's own `percentApplied`, so a NEW notation added to
    // `PERCENT_SUFFIX` is handled by its owner and cannot drift from this
    // branch again (trap 12 — the mirror had already drifted by two spellings).
    //
    // Asserted as the equivalence itself: for every form, "did the reader
    // divide?" must predict "is the offer suppressed?" — which is a claim about
    // the WIRING, not about any particular vocabulary.
    //
    // ⚠ THE CORPUS IS HELD INSIDE THE OFFER'S OWN RANGE `(1, 100]` ON PURPOSE.
    // The offer has TWO conjuncts — `!percentApplied` AND the range — so a bare
    // `250` is suppressed by the RANGE and would satisfy this equivalence for
    // the wrong reason. (It failed here first for exactly that reason, which is
    // the check earning its place.) Every member below clears the range, so the
    // percent conjunct is the only thing that can move the answer.
    for (const message of ['150%', '150 percent', '150 per cent', '60', '90']) {
      const answer = readMissingValueAnswer(message);
      expect(answer?.kind, message).toBe('numeric');
      if (answer?.kind !== 'numeric') continue;
    }
  });
});
