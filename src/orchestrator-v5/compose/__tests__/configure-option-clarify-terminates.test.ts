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

const OPTION = 'Hire 3 Senior Engineers';
const FACTOR = 'Engineering Delivery Velocity';

/** Default arm: the run WOULD proceed, so the promise is licensed. */
const compose = (valueAlreadySupplied: boolean) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    valueAlreadySupplied,
    analysisWillProceed: true,
  }).assistant_text;

describe('angle-bracket placeholder syntax never reaches user copy', () => {
  it.each([
    ['first ask', false],
    ['after the user supplied a value', true],
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
    const firstAsk = compose(false);
    const afterCompliance = compose(true);

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
    const text = compose(true);
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
    expect(compose(true)).toMatch(PROMISE);

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
        valueAlreadySupplied: true,
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
      valueAlreadySupplied: true,
      analysisWillProceed: false,
      blockedNextStep: NEXT,
    }).assistant_text;
    expect(text).toContain('The analysis cannot run on this model yet.');
    expect(text).toContain(NEXT);
  });

  it('C2 — it never claims to possess the user number (the flag is a ROUTING regex)', () => {
    // `valueAlreadySupplied` is fed by a digit-anchored routing predicate that
    // cannot tell WHOSE value it saw. Measured below: a message aimed at an
    // entirely different target sets it true. So no possession claim may
    // appear in this copy at all — every sentence must be true of the MODEL.
    const offTarget = 'Update the timeline to 3 months';
    expect(carriesConfigureOptionValuePayload(offTarget)).toBe(true);

    const text = compose(true);
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

  it('C2 — KNOWN-DROPPED: every recorded phrasing genuinely still fails to terminate', () => {
    // Trap 22f's honest-gap protocol: a gap the suite can SEE. This half REDs
    // when a phrasing starts WORKING (the record went stale and the gap has
    // partly closed); the half above REDs when the record is edited. Closing
    // the gap needs a value parsed for THIS option×factor — real work, rowed,
    // not smuggled into a copy fix.
    for (const phrasing of QUALITATIVE_VALUE_KNOWN_DROPPED) {
      expect(carriesConfigureOptionValuePayload(phrasing), phrasing).toBe(false);
    }

    // POSITIVE CONTROL — the probe can see the other answer, so the loop above
    // is a measurement and not a predicate that always returns false.
    expect(
      carriesConfigureOptionValuePayload("Set the X option's effect on Y to 0.6"),
    ).toBe(true);
  });

  it('both branches survive the egress guard', () => {
    for (const text of [compose(false), compose(true)]) {
      // Derived from the live list, never a re-listed mirror (trap 12).
      const hit = FORBIDDEN_USER_FACING_PHRASES.find((p) => p.test(text));
      expect(hit, `forbidden phrase in: ${text}`).toBeUndefined();
      // No internal identifiers.
      expect(text).not.toMatch(/\b(?:opt|fac)_[a-z0-9]/i);
    }
  });
});
