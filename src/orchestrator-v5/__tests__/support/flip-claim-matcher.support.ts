/**
 * ROADMAP 2.278 — the shared "does this text ASSERT that the result could
 * flip?" matcher, owned once.
 *
 * ⚠ WHY A PLAIN REGEX IS NOT ENOUGH, found when amendment A2 landed.
 * The first matcher was `/(could|would|…)\s+…\s+(change which option leads|
 * shift it|flip)/i`. The A2-corrected copy is
 *
 *     "…though no single factor we tested would change which option leads on its own."
 *
 * — a NEGATION of the claim, which contains the claim's own word sequence.
 * The matcher fired on it, so the honest sentence read as the defect. A
 * detector that cannot tell an assertion from its denial will either block the
 * correct copy (what happened) or, if loosened by hand, stop seeing the defect.
 *
 * The rule here: STRIP the sanctioned negated constructions, then look for any
 * assertive claim in what remains. That direction matters — an unrecognised
 * phrasing survives the strip and is REPORTED, so the failure mode is a false
 * alarm we investigate, never a false clear.
 *
 * ⚠ The stripper is a hand-maintained list and therefore carries its own
 * control: `flip-claim-matcher` tests assert it does NOT over-strip (the
 * shipped assertive copy must still match after stripping). Adding a negated
 * form here without that control re-opens the vacuity this file exists to close.
 */

/**
 * An ASSERTIVE flippability claim carried by a MODAL.
 *
 * ⚠ The first draft of this list missed three phrasings that ship TODAY —
 * `DOMINANT_DRIVER`'s "before the leading option changes", the driver beat's
 * "could shift with movement on X", and composeAdvice's "could change the
 * result". A matcher is exactly as good as its vocabulary, and this one was
 * caught only because its controls drive the REAL shipped strings rather than
 * hand-written samples. Keep it that way: add copy to the control list first,
 * watch it fail, then widen this.
 */
const FLIP_CLAIM_CORE =
  /\b(?:could|can|would|might|may)\s+(?:\w+\s+){0,3}?(?:change\s+which\s+option\s+leads|change\s+the\s+(?:order|result|ranking|outcome)|shift\s+which\s+option\s+leads|shift\s+it\b|shift\s+with\s+movement|tip\b|flip)/i;

/**
 * The same claim carried STRUCTURALLY, with no modal — "how far it can move
 * BEFORE the leading option changes" presupposes that it does.
 */
const FLIP_CLAIM_STRUCTURAL =
  /\bbefore\s+the\s+leading\s+option\s+changes\b|\btip\s+which\s+option\s+leads\b|\bflip\s+the\s+(?:outcome|result|decision)\b/i;

/**
 * Constructions that DENY flippability while containing the claim's words.
 * Each must be a negation — never merely a hedge.
 */
const NEGATED_CLAIM_FORMS: readonly RegExp[] = [
  // "no single factor we tested would change which option leads on its own"
  // "no single factor we tested would change the order on its own"
  /\bno\s+single\s+factor\s+we\s+tested\s+would\s+(?:change|shift)\b[^.]*?\bon\s+its\s+own\b/gi,
  // the pre-existing precedent in explanation-fallback.ts
  /\bno\s+single\s+factor\s+on\s+its\s+own\s+reached\s+a\s+tipping\s+point[^.]*/gi,
];

/** Text with every sanctioned denial removed — what the detector inspects. */
export function stripNegatedFlipClaims(text: string): string {
  return NEGATED_CLAIM_FORMS.reduce((acc, re) => acc.replace(re, ' '), text);
}

/**
 * Does this text ASSERT that the result could flip? Denials do not count;
 * anything else the matcher does not recognise DOES count (fail loud).
 */
export function assertsFlippability(text: string): boolean {
  const stripped = stripNegatedFlipClaims(text);
  return FLIP_CLAIM_CORE.test(stripped) || FLIP_CLAIM_STRUCTURAL.test(stripped);
}

/** Exported for the matcher's own controls. */
export const FLIP_CLAIM_CORE_REGEX = FLIP_CLAIM_CORE;
export const FLIP_CLAIM_STRUCTURAL_REGEX = FLIP_CLAIM_STRUCTURAL;
