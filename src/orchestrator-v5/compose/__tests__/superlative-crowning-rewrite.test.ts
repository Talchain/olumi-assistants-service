/**
 * THE SUPERLATIVE CROWNING IS A VOCABULARY OFFENCE, AND ITS REMEDY WAS DELETION.
 *
 * MEASURED on a fresh-session journey against staging `a81f741`, 16 Sep 2026, scenario
 * c13fd3b5-1905-4940-940f-a5cfbdd6b277. The journey ran brief → estimate → pre-mortem → run analysis →
 * what-could-change, all answering well. Then the user asked the question the whole journey exists for:
 *
 *   "So what would you actually recommend I do?"
 *
 * The turn was ENTITLED to answer it — `may_name_leading_option: true`, options separated, leader at 92%,
 * `withheld_projection_reason: null`. The routing model produced **648 output tokens in 24.5 seconds**.
 * The user received **71 characters**: `EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT`.
 *
 * Telemetry, joined on the request id:
 *   v5.egress.forbidden_phrase_detected
 *     phrase: "is the strongest option"   dispatch_path: turn_executor_finalise
 *
 * THE BAN IS CORRECT AND STAYS. The served prompt bans this vocabulary too, and the estate's terminology
 * ruling replaces prescriptive crowning with "leading option". What was wrong was the REMEDY.
 * `forbidden-user-facing-phrases.ts` states its own design — rewrite the prescriptive-lexicon class, re-scan,
 * and reserve whole-answer deletion for residual fatal-class phrases — and pattern 1 of
 * `DOCTRINE_FATAL_PATTERNS`, the broadest prescriptive pattern it has, had no rewrite. So
 * `applyTerminologyRewrite` returned `applied: []` and the guard fell straight through to
 * `fallback_replacement`.
 *
 * ⚠⚠ THE STRONGER REASON THIS BELONGS IN THE REWRITE AND NOT IN A PERMITTED-TURN EXEMPTION.
 * Measured: the crowning wording is INVISIBLE to `textAssertsLeadingOption`; the rewritten wording is
 * VISIBLE. So on a WITHHELD turn the crowning previously reached the permission guard unrecognised and could
 * only be stopped by deleting the whole answer. After the rewrite the permission guard sees a leader claim
 * and removes it AS a leader claim. The two guards compose — vocabulary here, permission there — instead of
 * one masking the other. Both directions are asserted below.
 */

import { describe, expect, it } from 'vitest';

import {
  applyEgressForbiddenPhraseGuard,
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  findForbiddenPhraseHit,
} from '../forbidden-user-facing-phrases.js';
import { applyTerminologyRewrite } from '../terminology-rewrite.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
import { projectExplanationAnswerForWithheldClaim } from '../withheld-explanation-answer.js';

/** The witnessed sentence class, in the user's own scenario vocabulary. */
const CROWNING =
  'Hiring an assistant and equipping them with an AI tool is the strongest option on this model.';

describe('the crowning is corrected, not deleted', () => {
  it('the witnessed answer survives with sanctioned vocabulary', () => {
    const result = applyEgressForbiddenPhraseGuard(CROWNING);
    expect(result.remedy).toBe('terminology_rewrite');
    expect(result.text).toBe(
      'Hiring an assistant and equipping them with an AI tool is the leading option on this model.',
    );
    // The substance the user asked for is still there. This is the whole point: 648 tokens of answer are
    // not worth destroying over one adjective.
    expect(result.text).not.toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    expect(result.text).toContain('Hiring an assistant and equipping them with an AI tool');
  });

  it('the rewritten wording re-scans clean, which is what the guard requires before keeping it', () => {
    expect(findForbiddenPhraseHit(applyTerminologyRewrite(CROWNING).text)).toBeNull();
  });

  it('the permission guard can SEE the rewritten claim, and could not see the original', () => {
    // The detection hole, asserted in both directions. Without this the rewrite would merely be cosmetic.
    expect(textAssertsLeadingOption(CROWNING)).toBe(false);
    expect(textAssertsLeadingOption(applyTerminologyRewrite(CROWNING).text)).toBe(true);
  });
});

describe('BOTH arms canonicalise, and BOTH permission states are checked at the wire', () => {
  // ⚠ REVIEW CX198 DEMONSTRATED THE ESCAPE THAT THIS BLOCK NOW PINS, and it reproduced exactly:
  //   "… is the strongest choice" -> "… is the leading choice"  ->  textAssertsLeadingOption FALSE
  // The wire guard's vocabulary knows "leading option" and does NOT know "leading choice", so preserving the
  // source noun produced a rewrite that slipped a leader claim past the permission guard on a WITHHELD turn —
  // the exact opposite of this rule's purpose. Both arms now emit the one recognised result term.
  it.each([
    ['choice arm', 'Hire a tech lead is the strongest choice.'],
    ['option arm', 'Hire a tech lead is the strongest option.'],
    ['modifier arm', 'Hire a tech lead is the clear best choice.'],
  ])('%s rewrites to the recognised result term', (_name, text) => {
    const guarded = applyEgressForbiddenPhraseGuard(text);
    expect(guarded.remedy).toBe('terminology_rewrite');
    expect(guarded.text).toContain('leading option');
    expect(guarded.text).not.toContain('leading choice');
  });

  it.each([
    ['choice arm', 'Hire a tech lead is the strongest choice.'],
    ['option arm', 'Hire a tech lead is the strongest option.'],
    ['modifier arm', 'Hire a tech lead is the clear best choice.'],
  ])('%s: on a WITHHELD turn the permission guard still removes the claim', (_name, text) => {
    // The composition property, asserted at the seam that actually ships. A rewrite that the permission
    // guard cannot see is worse than no rewrite: it launders a claim into a shippable form.
    const rewritten = applyEgressForbiddenPhraseGuard(text).text;
    expect(textAssertsLeadingOption(rewritten)).toBe(true);
    const projected = projectExplanationAnswerForWithheldClaim(rewritten, 'unevaluated', [], true, true);
    expect(projected.reason).toBe('leader_claim_replaced');
    expect(projected.text).not.toContain('leading option');
  });
});

describe('what must NOT change — the ban is still a ban', () => {
  it.each([
    ['an explicit directive', 'You should choose the personal assistant.'],
    ['the ruling’s prohibited verb', 'Hiring a personal assistant is advisable.'],
    ['a no-copula crowning', 'Your best bet: hire a personal assistant.'],
  ])('%s is still replaced wholesale', (_name, text) => {
    // Genuine prescription has no safe rewrite. Deletion remains correct for it.
    expect(applyEgressForbiddenPhraseGuard(text).remedy).toBe('fallback_replacement');
  });

  it.each([
    ['a de-recommendation', 'The status quo is not always the safest choice.'],
    ['coaching with no copula', 'What would make Option B the better choice?'],
    ['the permitted result phrasing', 'Hiring an assistant leads in 92% of simulations, 84 points ahead of the runner-up.'],
  ])('%s is untouched', (_name, text) => {
    // The negation lookahead and the copula anchor are load-bearing: this file would be a regression if it
    // started rewriting sentences the product is entitled to say exactly as written.
    const result = applyEgressForbiddenPhraseGuard(text);
    expect(result.remedy).toBe('none');
    expect(result.text).toBe(text);
  });
});
