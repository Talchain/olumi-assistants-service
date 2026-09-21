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
 * ── ⭐⭐ AND WHY THE FIRST VERSION OF *THIS* SPEC WAS NOT ENOUGH EITHER ──────
 * ⚠⚠ TRAP 22b OCCURRED INSIDE THE GUARD WRITTEN TO PREVENT TRAP 22b, AND THE
 * RECORD IS KEPT BECAUSE THAT IS THE WHOLE LESSON.
 *
 * The first version carried a twin banning the BLANKET OWNERSHIP claim — "the
 * values it used are my own estimates, not yours" — an ASSERTION that the
 * user's numbers are ours. Correct, and it caught the draft it was written for.
 * The copy that then shipped at `f7dc0524` said *"Nothing in it carries your
 * judgement yet"*: **the same false claim reached by DENYING the user's
 * authorship instead of asserting ours**, and the twin matched nothing, because
 * its pattern required `values|figures|numbers … are … my|mine`.
 *
 * ⭐ ONE PREDICATE, TWO OPPOSITE HARMS, ONE DOOR WATCHED. Exactly the shape
 * CEE #888 paid four oscillating rounds for, occurring in the guard whose own
 * comment cited it. The author who wrote the twin was the author who then
 * walked through the other door — so "the reviewer of the fix knows the trap"
 * is not protection. **The predicate is now BI-DIRECTIONAL and each direction
 * pins its OWN positive control**, so neither can silently stop discriminating.
 *
 * ⚠ The first version also argued *"trap 22 does not apply: there is no input
 * space to under-sample, the object is a constant"*. **That is true of the
 * STRING and false of the CLAIM THE STRING MAKES**, whose truth depends on the
 * graph it is attached to. The domain twins below sample that space instead.
 *
 * ── ⭐ THE DISCRIMINATING CONTROLS, PINNED TO HISTORIC STRINGS ──────────────
 * Every property is run against the superseded sentences, which must FAIL the
 * honesty properties and PASS the safety ones. Without those arms an assertion
 * like "mentions confirmation" could be satisfied by almost any sentence and
 * would never fail.
 *
 * ⚠ THE CONTROLS ARE FROZEN HISTORIC ARTEFACTS, NEVER "the previous value"
 * (trap 12b: a control pinned to whatever is current decays into a tautology
 * the first time current changes). They are APPEND-ONLY (trap 14b) — if the
 * live copy changes again, ADD a new frozen literal; do NOT re-point these.
 */

import { describe, expect, it } from 'vitest';

import { AUTO_RUN_PROVISIONAL_DISCLOSURE } from '../chip-click-dispatch.js';
// The REAL egress guards, imported rather than restated (trap 12: one
// definition, no copies). A hand-listed local copy of the banned vocabulary
// would drift from the guard the text actually passes through.
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';

/**
 * FROZEN #1. The disclosure the product EMITTED between 2026-08-16 (R2) and the
 * 2026-09-01 restore. Honest about WHO ran the analysis and silent on the only
 * thing the founder asked for.
 */
const SUPERSEDED_R2_DISCLOSURE =
  'I ran a provisional first analysis automatically after drafting this model.';

/**
 * FROZEN #2. The copy proposed at `f7dc0524` and corrected before merge by
 * independent review. ⚠ Scope stated honestly: this sentence was PUBLISHED TO A
 * PR BRANCH, never deployed, so unlike FROZEN #1 no user ever read it — it is a
 * record of what this lane wrote, not of what the product said. It is kept
 * because it is the ONLY input that discriminates the denial-direction
 * property: it says the user has confirmed nothing (so it passes the
 * confirmation property) while ALSO denying their authorship outright.
 */
const SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE =
  'I ran a first analysis on the model I have just drafted. Nothing in it carries your judgement yet — you have not confirmed any of it, and where your brief gave me no figure I estimated one. Treat it as a starting point to argue with, not an answer: tell me what I have got wrong and I will change it.';

/** The controls must stay DISTINCT from the live copy, or the arms cannot disagree. */
it('the frozen controls are all different strings from the live copy', () => {
  expect(AUTO_RUN_PROVISIONAL_DISCLOSURE).not.toBe(SUPERSEDED_R2_DISCLOSURE);
  expect(AUTO_RUN_PROVISIONAL_DISCLOSURE).not.toBe(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE);
});

// ─── The properties. Closed, literal tests over fixed strings. ───────────────

/**
 * ⭐ CONFIRMATION, NOT AUTHORSHIP — the rule that replaces both bad drafts.
 * "The user has confirmed nothing" is invariant to how much of the model came
 * from the user; any authorship claim's truth depends on the graph. So the
 * property demands the CONFIRMATION form specifically.
 *
 * ⚠ The first version of this predicate also accepted "nothing in it carries
 * your judgement" as a satisfying alternative — i.e. it ACCEPTED the very
 * sentence the denial property now bans. Two properties disagreeing about one
 * string is how a guard blesses a defect; that alternative is removed.
 */
const claimsNothingConfirmed = (text: string): boolean =>
  /\byou have not confirmed\b/i.test(text);

/**
 * The estimate clause must be CONDITIONALLY scoped. "Where your brief gave me
 * no figure I estimated one" is true of a brief that stated every figure AND of
 * one that stated none; a bare "I estimated the figures" is false on the first.
 */
const scopesEstimatesToTheGapsInTheBrief = (text: string): boolean =>
  /\bwhere your brief gave me no figure\b/i.test(text);

const invitesCorrection = (text: string): boolean =>
  /\btell me\b/i.test(text) && /\bi will\b/i.test(text);

const refusesToReadAsSettled = (text: string): boolean =>
  /\bnot an answer\b/i.test(text);

/**
 * ⚠⚠ THE BI-DIRECTIONAL PREDICATE. Both forms are the SAME harm —
 * `not-modelled-manifest.ts`: "WRONGLY CLAIMING A USER'S VALUE AS OUR INVENTION
 * IS FAR WORSE THAN WRONGLY OMITTING ONE OF OUR OWN INVENTIONS" — and a guard
 * that watches one door is the trap this spec's header documents.
 *
 * The harm is real on a served path: a brief that states figures produces
 * `from_brief` nodes holding the user's own numbers
 * (`graph-readiness/obligation-provenance.ts:143-146,195` — "a value extracted
 * from it is user-stated, not inferred").
 */
const assertsOwnershipOfUserValues = (text: string): boolean =>
  /\b(?:the |all (?:of )?the )?(?:values?|figures?|numbers?)[^.]*\b(?:are|were)\s+(?:my|mine|olumi's)\b/i.test(
    text,
  );

const deniesUserAuthorship = (text: string): boolean =>
  /\bnothing (?:in it |here |of it )?(?:carries|reflects|contains|is)\b[^.]*\byours?\b/i.test(text) ||
  /\bnothing (?:in it|here|of it)\b[^.]*\byour (?:judgement|judgment|input|thinking|words|numbers|figures)\b/i.test(
    text,
  ) ||
  /\bnone of (?:it|this|these)\b[^.]*\byours?\b/i.test(text);

const misattributesAuthorship = (text: string): boolean =>
  assertsOwnershipOfUserValues(text) || deniesUserAuthorship(text);

describe('AUTO_RUN_PROVISIONAL_DISCLOSURE — the AI-only label', () => {
  it('claims that the user has CONFIRMED nothing', () => {
    expect(claimsNothingConfirmed(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(claimsNothingConfirmed(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('scopes the estimate claim to the GAPS in the brief, not to every value', () => {
    expect(scopesEstimatesToTheGapsInTheBrief(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(scopesEstimatesToTheGapsInTheBrief(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('invites the user to correct it — the whole point of the pass', () => {
    expect(invitesCorrection(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(invitesCorrection(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('refuses to read as a settled conclusion', () => {
    expect(refusesToReadAsSettled(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(refusesToReadAsSettled(SUPERSEDED_R2_DISCLOSURE)).toBe(false);
  });

  it('carries no banned leader / success vocabulary — the REAL egress guards', () => {
    expect(findForbiddenPhraseHit(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBeNull();
    expect(findSuccessClaimHit(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBeNull();
    // Both superseded sentences were safe on this axis too — so a green result
    // here is NOT evidence the copy changed, and this case is deliberately
    // excluded from the discrimination pattern above.
    expect(findForbiddenPhraseHit(SUPERSEDED_R2_DISCLOSURE)).toBeNull();
    expect(findForbiddenPhraseHit(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE)).toBeNull();
  });
});

/**
 * ── THE DOMAIN TWINS ────────────────────────────────────────────────────────
 * The copy is one string, but the CLAIM it makes is evaluated against a graph.
 * These sample the two ends of that space: a brief that stated every figure,
 * and a brief that stated none. The copy must be true at BOTH ends.
 */
describe('AUTO_RUN_PROVISIONAL_DISCLOSURE — true at both ends of the brief domain', () => {
  it('BRIEF STATED EVERY FIGURE: makes no authorship claim, in EITHER direction', () => {
    expect(misattributesAuthorship(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(false);
  });

  it('BRIEF STATED NO FIGURE: the estimate clause is still true, because it is hedged', () => {
    // The hedge is what makes one sentence true at both ends. Without it the
    // copy would have to vary by graph, which a constant cannot do.
    expect(scopesEstimatesToTheGapsInTheBrief(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    expect(claimsNothingConfirmed(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
  });

  /**
   * ⭐ EACH DIRECTION PINS ITS OWN POSITIVE CONTROL (trap 13b). A `false`
   * above proves nothing unless the predicate can be shown to fire. The
   * ASSERTION control is the draft rejected pre-merge; the DENIAL control is
   * the sentence that shipped at `f7dc0524` past the one-door twin.
   */
  it('PRECONDITION — the ASSERTION door is watched', () => {
    expect(
      assertsOwnershipOfUserValues('The values it used are my own estimates, not yours.'),
    ).toBe(true);
    expect(misattributesAuthorship('The values it used are my own estimates, not yours.')).toBe(
      true,
    );
  });

  it('PRECONDITION — the DENIAL door is watched, and would have caught f7dc0524', () => {
    expect(deniesUserAuthorship('Nothing in it carries your judgement yet.')).toBe(true);
    expect(deniesUserAuthorship(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE)).toBe(true);
    expect(misattributesAuthorship(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE)).toBe(true);
  });

  /**
   * ⚠ THE ONE THAT PROVES THE OLD GUARD WAS BLIND, not merely that the new one
   * is not. The superseded denial passes the ASSERTION predicate — which is
   * precisely why it shipped — so this case REDs if anyone ever "simplifies"
   * `misattributesAuthorship` back to a single direction.
   */
  it('the ASSERTION door alone could NOT have caught the denial — one door is not enough', () => {
    expect(assertsOwnershipOfUserValues(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE)).toBe(false);
    expect(misattributesAuthorship(SUPERSEDED_AUTHORSHIP_DENIAL_DISCLOSURE)).toBe(true);
  });
});
