/**
 * THE POST-DRAFT ANALYSIS MUST READ AS AI-ONLY AND UNCONFIRMED.
 *
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 * The founder's ruling (2026-09-01), after #1298 deleted the post-draft
 * auto-run and was corrected: *"We designed the system so that it now performs
 * an initial analysis so we have more rich data to help users. We know that the
 * first analysis should not be trusted, as it hasn't had any user input. We
 * need to make it very clear that any data we have at that stage is AI-only."*
 *
 * The behaviour is restored; THIS is the half that was actually wanted, so it
 * gets a guard of its own. Without one, the label is a bare string constant that
 * any later tidy-up can shorten back into dishonesty with nothing going red.
 *
 * ── ⚠ WHY THE EXISTING ASSERTION WAS NOT ENOUGH (trap 13b) ─────────────────
 * `chip-click-dispatch-auto-run.test.ts` asserts the answer
 * `startsWith(AUTO_RUN_PROVISIONAL_DISCLOSURE)`. That pins the WIRING — the
 * constant reaches the text — and is a TAUTOLOGY about the COPY: it passes
 * whatever the constant says, including the empty string. It is a guard
 * agreeing with itself. This spec pins the copy's PROPERTIES instead, and the
 * two are complementary rather than redundant — keep both.
 *
 * ── ⭐ THE DISCRIMINATING CONTROL, AND WHY IT IS PINNED TO A HISTORIC STRING ─
 * Every property below is ALSO run against {@link SUPERSEDED_R2_DISCLOSURE} —
 * the sentence this product actually shipped from 2026-08-16 until the restore
 * — which must FAIL the honesty properties and PASS the safety ones. Without
 * that arm an assertion like "mentions confirmation" could be satisfied by
 * almost any sentence and would never fail; with it, each property is shown to
 * DISCRIMINATE between the dishonest string and the honest one.
 *
 * ⚠ THE CONTROL IS A FROZEN HISTORIC ARTEFACT, NEVER "the previous value"
 * (trap 12b: a control pinned to whatever is current decays into a tautology
 * the first time current changes). It is a record of a sentence the product
 * really emitted, so it is APPEND-ONLY — if the live copy changes again, add a
 * new frozen literal; do NOT re-point this one (trap 14b).
 */

import { describe, expect, it } from 'vitest';

import { AUTO_RUN_PROVISIONAL_DISCLOSURE } from '../chip-click-dispatch.js';
// The REAL egress guard, imported rather than restated (trap 12: one
// definition, no copies). A hand-listed local copy of the banned vocabulary
// would drift from the guard the text actually passes through.
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';

/**
 * FROZEN. The disclosure shipped between 2026-08-16 (R2) and the 2026-09-01
 * restore. Honest about WHO ran the analysis and silent on the only thing the
 * founder asked for — that it carries no user input — which is exactly why it
 * makes a discriminating control.
 */
const SUPERSEDED_R2_DISCLOSURE =
  'I ran a provisional first analysis automatically after drafting this model.';

/** Guard against the control silently becoming the live value (trap 12b). */
it('the control is a DIFFERENT string from the live copy, so the arms can disagree', () => {
  expect(AUTO_RUN_PROVISIONAL_DISCLOSURE).not.toBe(SUPERSEDED_R2_DISCLOSURE);
});

/**
 * Each property is a closed, literal test over ONE fixed string — not a
 * predicate over open natural language (trap 22 does not apply: there is no
 * input space to under-sample, the object is a constant).
 */
const saysUserHasConfirmedNothing = (text: string): boolean =>
  /\byou have not confirmed\b/i.test(text) ||
  /\bnothing in it carries your judgement\b/i.test(text);

const saysGapsWereEstimated = (text: string): boolean =>
  /\bi estimated\b/i.test(text) || /\bmy (?:own )?estimates?\b/i.test(text);

const invitesCorrection = (text: string): boolean =>
  /\btell me\b/i.test(text) && /\bi will\b/i.test(text);

const refusesToReadAsSettled = (text: string): boolean =>
  /\bnot an answer\b/i.test(text);

/**
 * The blanket claim the copy must NOT make. `not-modelled-manifest.ts`:
 * "WRONGLY CLAIMING A USER'S VALUE AS OUR INVENTION IS FAR WORSE THAN WRONGLY
 * OMITTING ONE OF OUR OWN INVENTIONS". On a brief that stated figures, "the
 * values are my estimates, not yours" claims the user's own numbers as ours.
 */
const makesBlanketOwnershipClaim = (text: string): boolean =>
  /\b(?:the |all (?:of )?the )?(?:values?|figures?|numbers?)[^.]*\b(?:are|were)\s+(?:my|mine|olumi's)\b/i.test(
    text,
  );

describe('AUTO_RUN_PROVISIONAL_DISCLOSURE — the AI-only label', () => {
  it('states that the user has confirmed nothing in it', () => {
    expect(saysUserHasConfirmedNothing(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    // DISCRIMINATION: the superseded sentence never said this.
    expect(saysUserHasConfirmedNothing(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('states that the gaps in the brief were filled by estimate', () => {
    expect(saysGapsWereEstimated(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(saysGapsWereEstimated(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('invites the user to correct it — the whole point of the pass', () => {
    expect(invitesCorrection(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(invitesCorrection(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('refuses to read as a settled conclusion', () => {
    expect(refusesToReadAsSettled(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(refusesToReadAsSettled(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  /**
   * OPPOSITE-DIRECTION TWIN (trap 22b). The four properties above all push
   * towards "say more about how provisional this is". Unchecked, the cheapest
   * way to satisfy them is the blanket claim — which is a DIFFERENT lie in the
   * direction the estate's own asymmetry rules out. This is the door on the
   * other side.
   */
  it('TWIN: does NOT claim every value as Olumi’s own invention', () => {
    expect(makesBlanketOwnershipClaim(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(false);
    // The twin's own precondition, pinned in-test (trap 13b): the predicate
    // must be capable of firing, or its `false` above proves nothing.
    expect(
      makesBlanketOwnershipClaim(
        'The values it used are my own estimates, not yours.',
      ),
    ).toBe(true);
  });

  it('carries no banned leader / success vocabulary — the REAL egress guards', () => {
    expect(findForbiddenPhraseHit(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBeNull();
    expect(findSuccessClaimHit(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBeNull();
    // The superseded sentence was safe on this axis too — so a green result
    // here is NOT evidence the copy changed, and this case is deliberately
    // excluded from the discrimination pattern above.
    expect(findForbiddenPhraseHit(SUPERSEDED_R2_DISCLOSURE)).toBeNull();
  });
});
