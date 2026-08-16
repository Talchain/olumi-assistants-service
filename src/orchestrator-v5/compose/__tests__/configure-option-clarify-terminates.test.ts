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

import { composeConfigureOptionClarifyResponse } from '../configure-option-clarify-response.js';
import { FORBIDDEN_USER_FACING_PHRASES } from '../forbidden-user-facing-phrases.js';
import { CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE } from '../../configure-option-chip-text.js';

const OPTION = 'Hire 3 Senior Engineers';
const FACTOR = 'Engineering Delivery Velocity';

const compose = (valueAlreadySupplied: boolean) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'ideate',
    valueAlreadySupplied,
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
