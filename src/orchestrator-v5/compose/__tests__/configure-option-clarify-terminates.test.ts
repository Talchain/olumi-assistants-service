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

import {
  composeConfigureOptionClarifyResponse,
  QUALITATIVE_VALUE_KNOWN_DROPPED,
} from '../configure-option-clarify-response.js';
import { FORBIDDEN_USER_FACING_PHRASES } from '../forbidden-user-facing-phrases.js';
import { CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE } from '../../configure-option-chip-text.js';
import { carriesConfigureOptionValuePayload } from '../../routing/configure-option-intent.js';
import { messageAnswersMissingValueAsk } from '../../routing/missing-value-answer.js';

const OPTION = 'Hire 3 Senior Engineers';
const FACTOR = 'Engineering Delivery Velocity';

/**
 * ⚠ THIS HELPER USED TO TAKE A BOOLEAN (`valueAlreadySupplied`) AND NOW TAKES
 * THE USER'S MESSAGE. The boolean was optional, and the sibling call site in
 * `route-v2.ts` never passed it — so at that site the terminating branch was
 * unreachable and the demand repeated however the user answered (ROADMAP 2.1267).
 * The composer derives the condition itself now, so these tests drive the REAL
 * predicate over a REAL message instead of asserting the flag the caller was
 * trusted to compute.
 */
const NOT_AN_ANSWER = `Configure ${OPTION}`;
/** Verbatim compliance with the product's own advised phrasing. */
const ANSWERED = `Set the ${OPTION} option's effect on ${FACTOR} to 0.6`;

/** Default arm: the run WOULD proceed, so the promise is licensed. */
const compose = (message: string) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message,
    analysisWillProceed: true,
  }).assistant_text;

describe('angle-bracket placeholder syntax never reaches user copy', () => {
  it.each([
    ['first ask', NOT_AN_ANSWER],
    ['after the user supplied a value', ANSWERED],
  ])('%s — no `<0-1>`, and no angle-bracket placeholder of any kind', (_name, supplied) => {
    const text = compose(supplied as boolean);
    expect(text).not.toContain('<0-1>');
    // Bound to the CLASS, not to the one literal that was filed: any
    // `<...>` slot in prose is the same defect wearing different characters.
    expect(text).not.toMatch(/<[^>]{1,20}>/);
  });

  it('the prompt-embedded advised format carries a real number, not a value placeholder', () => {
    // This constant is interpolated into `prompts/edit-graph-v6.ts` under an
    // instruction to advise "exactly this phrasing", so a placeholder here is
    // reproduced verbatim into user copy by the model — the SECOND, independent
    // emitter of the same defect.
    expect(CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE).not.toContain('<0-1>');
    expect(CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE).toMatch(/\bto\s+\d/);
  });
});

describe('the loop terminates', () => {
  it('does NOT repeat the demand once the user has supplied a value', () => {
    const firstAsk = compose(NOT_AN_ANSWER);
    const afterCompliance = compose(ANSWERED);

    // PRECONDITION PINNED IN-TEST: the first ask really is the demand, so the
    // inequality below is about the SECOND reply changing, not about the first
    // one being something else entirely.
    expect(firstAsk).toContain(`Set the ${OPTION} option's effect on ${FACTOR} to`);

    // The defect, stated exactly: the two replies were byte-identical.
    expect(afterCompliance).not.toBe(firstAsk);
    // And specifically, the demand sentence is gone — not merely reworded
    // around the edges.
    expect(afterCompliance).not.toContain(`Tell me what it changes`);
    expect(afterCompliance).not.toContain(`option's effect on`);
  });

  it('the terminating reply is ACTIONABLE — it names the option, the factor, and a route out', () => {
    const text = compose(ANSWERED);
    expect(text).toContain(OPTION);
    expect(text).toContain(FACTOR);
    // It must tell the user the thing that is now true: this does not block the
    // analysis any more. That is the whole value of terminating here rather
    // than looping.
    expect(text).toMatch(/analysis will run/i);
    expect(text).toMatch(/left out of the comparison/i);
  });

  it('C1 — it NEVER promises a run the server would refuse', () => {
    const PROMISE = /analysis will run/i;

    // Licensed: the caller derived that the run proceeds.
    expect(compose(ANSWERED)).toMatch(PROMISE);

    // NOT licensed — three ways the caller can fail to license it. Each must
    // drop the promise. This was unconditional in the first version of the fix,
    // which made it FALSE whenever a structural blocker co-existed: the very
    // defect this PR closes, one level down, in prose.
    for (const [name, extra] of [
      ['run refuses, with a next step', { analysisWillProceed: false, blockedNextStep: 'Connect the model to its goal, then run the analysis again.' }],
      ['run refuses, no next step', { analysisWillProceed: false }],
      ['caller could not determine it', {}],
    ] as const) {
      const text = composeConfigureOptionClarifyResponse({
        optionLabel: OPTION,
        factorLabels: [FACTOR],
        stage: 'analyse',
        message: ANSWERED,
        ...extra,
      }).assistant_text;
      expect(text, `promise leaked: ${name}`).not.toMatch(PROMISE);
      // …and it never silently becomes vague about the option either.
      expect(text, name).toContain(OPTION);
    }
  });

  it('C1 — when the run refuses it states the honest alternative, in the admission own words', () => {
    const NEXT = 'Connect the model to its goal, then run the analysis again.';
    const text = composeConfigureOptionClarifyResponse({
      optionLabel: OPTION,
      factorLabels: [FACTOR],
      stage: 'analyse',
      message: ANSWERED,
      analysisWillProceed: false,
      blockedNextStep: NEXT,
    }).assistant_text;
    expect(text).toContain('The analysis cannot run on this model yet.');
    expect(text).toContain(NEXT);
  });

  it('C2 — it never claims to possess the user number (the flag is a ROUTING regex)', () => {
    // The termination signal is a TEXT predicate and cannot tell WHOSE value it
    // saw. Measured below: a message aimed at an entirely different target
    // terminates the demand. That is the RIGHT call for termination (repeating
    // the demand at someone who just typed a value is the defect) and it is
    // exactly why no possession claim may appear in this copy — every sentence
    // must be true of the MODEL, whatever the message contained. Two different
    // questions under one signal is trap 21, and this is the guard against it.
    const offTarget = 'Update the timeline to 3 months';
    expect(messageAnswersMissingValueAsk(offTarget)).toBe(true);
    expect(compose(offTarget)).not.toMatch(/\byour (?:number|value)\b/i);

    const text = compose(ANSWERED);
    expect(text).not.toMatch(/\bI have your (?:number|value)\b/i);
    expect(text).not.toMatch(/\byour number\b/i);
    // What it says instead is a fact about the graph, true either way.
    expect(text).toContain(`"${OPTION}" still has no effect value on ${FACTOR}`);
  });

  it('C2 — KNOWN-DROPPED: the recorded set is EXACTLY these four phrasings', () => {
    // ⚠ THE FIRST VERSION OF THIS TEST WAS A GUARD AGREEING WITH ITSELF, and a
    // mutant caught it: it filtered the constant and compared the result to the
    // SAME constant, so deleting a member shrank both sides and it stayed
    // green. A derived check can prove the members still behave as recorded; it
    // can never prove the RECORD is complete. That needs a hand-written list —
    // the one place trap 12d says a mirror is the right instrument.
    expect([...QUALITATIVE_VALUE_KNOWN_DROPPED]).toEqual([
      "Set the X option's effect on Y to high",
      "Set the X option's effect on Y to about a third",
      "Set the X option's effect on Y to roughly half",
      "Set the X option's effect on Y to low",
    ]);
  });

  it('C2 — KNOWN-DROPPED: still UNBINDABLE, but no longer LOOPING', () => {
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
      const reply = compose(phrasing);
      expect(reply, phrasing).not.toBe(compose(NOT_AN_ANSWER));
      expect(reply, phrasing).toContain('has to be a number');
    }

    // POSITIVE CONTROL — the digit probe can see the other answer, so the loop
    // above is a measurement and not a predicate that always returns false.
    expect(
      carriesConfigureOptionValuePayload("Set the X option's effect on Y to 0.6"),
    ).toBe(true);
  });

  it('both branches survive the egress guard', () => {
    for (const text of [compose(NOT_AN_ANSWER), compose(ANSWERED)]) {
      // Derived from the live list, never a re-listed mirror (trap 12).
      const hit = FORBIDDEN_USER_FACING_PHRASES.find((p) => p.test(text));
      expect(hit, `forbidden phrase in: ${text}`).toBeUndefined();
      // No internal identifiers.
      expect(text).not.toMatch(/\b(?:opt|fac)_[a-z0-9]/i);
    }
  });
});
