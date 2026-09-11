/**
 * THE SAFETY PASS MUST NOT MANUFACTURE THE BANNED LANGUAGE.
 *
 * Olumi must never frame options as a race — not "the winner", "the leading
 * option", "ahead", "beats", "top choice" or "wins". Three DIFFERENT questions
 * exist (most likely outcome · best expected value · most robust to what we do
 * not know) and the product must say which one it is answering. Collapsing them
 * into one ranked leader is the defect.
 *
 * ⚠ WHY THIS FILE EXISTS. `applyTerminologyRewrite` used to rewrite
 *     "the winner"      → "the leading option"
 *     "recommendation"  → "leading option"
 *     "winning option"  → "leading option"
 * i.e. it substituted one banned phrase for another, and every downstream guard
 * then measured a residue THIS MODULE HAD CREATED. `leading-option-egress-guard.ts`
 * says so in its own header ("OUR OWN SAFETY PASS MANUFACTURES THE BANNED
 * LANGUAGE") and had to be positioned strictly downstream of the rewrite to see
 * it at all.
 *
 * TWO GUARDS, DELIBERATELY NOT REDUNDANT (CLAUDE.md trap 12d — a derived guard
 * proves AGREEMENT and can never prove COMPLETENESS; only a hand-written corpus
 * notices that the list is short). Ship both:
 *
 *   1. DERIVED INVARIANT — iterate the REAL exported `TERMINOLOGY_RULES` array
 *      and run each replacement through the REAL exported
 *      `textNamesLeadingOption`. Nothing is copied, so a rule added later is
 *      covered automatically and cannot drift.
 *   2. HAND-WRITTEN CORPUS — real sentences, asserting the OUTPUT is clean. This
 *      is what would notice a race-framing phrase the shared vocabulary does not
 *      yet carry.
 *
 * ⚠ MEASURED LIMIT OF GUARD 1, so nobody over-reads it. Run against the FIVE
 * replacements this change deleted, `textNamesLeadingOption` flags only FOUR of
 * them ("leading option(s)", "the leading option(s)"). It does NOT flag
 * `win probability` (not in the shared vocabulary) nor the raw `leading $1$2`
 * template (the capture is substituted at match time, so the literal never
 * reads as "leading option"). Guard 1 alone would therefore have missed
 * "winning probability" → "win probability" and "winning <X>" → "leading <X>".
 * That is what the corpus test and the `winner|winning` pattern-source test
 * below are for — they are not decoration.
 *
 * BINDING IS BY IDENTITY (CLAUDE.md trap 19): both guards import the actual
 * module objects — `TERMINOLOGY_RULES` from `../terminology-rewrite.js` and
 * `textNamesLeadingOption` from `../leading-option-egress-guard.js` — never a
 * local copy of the patterns or of the replacement strings. A test that
 * re-declared either list would pass while the shipped list rotted.
 */

import { describe, expect, it } from 'vitest';
import {
  TERMINOLOGY_RULES,
  applyTerminologyRewrite,
} from '../terminology-rewrite.js';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';

describe('terminology rewrite — the safety pass must not manufacture race framing', () => {
  /**
   * GUARD 1 — DERIVED. Every replacement the map can emit, checked against the
   * estate's own leader-claim reader.
   *
   * This is the assertion that REDs at the pristine tip: the map carried
   * `replacement: 'the leading option'`, and `textNamesLeadingOption` returns
   * true for it via the `leading_option` pattern.
   */
  it('emits no replacement that names or presumes a leading option', () => {
    expect(TERMINOLOGY_RULES.length).toBeGreaterThan(0); // precondition: the map is not empty

    const offenders = TERMINOLOGY_RULES.filter((rule) =>
      textNamesLeadingOption(rule.replacement),
    ).map((rule) => `${String(rule.pattern)} -> ${rule.replacement}`);

    expect(offenders).toEqual([]);
  });

  /**
   * PRECONDITION PIN (CLAUDE.md trap 13b — a discriminator must pin its own
   * precondition, or it can pass because the instrument stopped discriminating
   * rather than because the property holds).
   *
   * If `textNamesLeadingOption` ever stopped recognising "the leading option",
   * GUARD 1 above would go green for the wrong reason. This asserts the reader
   * is still discriminating, on the exact string the old map produced.
   */
  it('the shared leader-claim reader still flags the phrase the old map produced', () => {
    expect(textNamesLeadingOption('the leading option')).toBe(true);
    expect(textNamesLeadingOption('The leading options may shift.')).toBe(true);
    // ...and is not simply returning true for everything (contrast control).
    expect(textNamesLeadingOption('the suggestion')).toBe(false);
  });

  /**
   * GUARD 2 — HAND-WRITTEN CORPUS. Real sentences in, clean prose out.
   */
  it('rewrites the recommendation class without introducing race framing', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['The recommendation is robust across scenarios.', 'The suggestion is robust across scenarios.'],
      ['Our recommendation is to launch immediately.', 'Our suggestion is to launch immediately.'],
      ['These recommendations may shift.', 'These suggestions may shift.'],
      ['The recommended path is to wait.', 'The suggested path is to wait.'],
    ];

    for (const [input, expected] of cases) {
      const result = applyTerminologyRewrite(input);
      expect(result.text).toBe(expected);
      expect(textNamesLeadingOption(result.text)).toBe(false);
    }
  });

  /**
   * A RANK CLAIM HAS NO CONTENT-PRESERVING REWRITE — SO IT IS WITHHELD, NOT
   * LAUNDERED.
   *
   * Preserve the sentence and you preserve the ranking, and the ranking is the
   * defect. These phrases are therefore fatal-class: the rewriter must leave
   * them BYTE-IDENTICAL so the consumer's re-scan still sees the offence and
   * applies the fatal remedy (block drop / response replacement).
   *
   * Both halves matter. "Unchanged" alone would be satisfied by a rewriter that
   * silently permits the phrase, so each case also asserts
   * `findForbiddenPhraseHit` — the real downstream scanner — still fires on it.
   */
  it('leaves rank claims unchanged AND still forbidden, rather than rewriting them', () => {
    const rankClaims: readonly string[] = [
      'The winner is Option A.',
      'These are the winners after re-analysis.',
      'Option A has the winning probability.',
      'The winning option leads at 72%.',
      'Robust analysis points to the winning side.',
      'Standardise on Dell XPS is the winning choice.',
      'That is the winning outcome.',
    ];

    for (const claim of rankClaims) {
      const result = applyTerminologyRewrite(claim);
      // Not laundered into a different banned phrase...
      expect(result.text).toBe(claim);
      expect(result.applied).toEqual([]);
      // ...and not silently permitted either: the fatal remedy still applies.
      expect(findForbiddenPhraseHit(result.text)).not.toBeNull();
      // ...and whatever the rewriter returned is not race framing it invented.
      expect(applyTerminologyRewrite(result.text).text).toBe(claim);
    }
  });

  /**
   * The map must not regrow the deleted rules. Bound by identity to the real
   * array's own pattern sources, so this fails the moment anyone re-adds one.
   */
  it('carries no rule keyed on the winner / winning class', () => {
    const sources = TERMINOLOGY_RULES.map((rule) => rule.pattern.source);
    expect(sources.filter((src) => /winner|winning/i.test(src))).toEqual([]);
  });
});
