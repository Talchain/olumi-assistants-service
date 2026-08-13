/**
 * ⭐⭐ THE SINGLE AUTHORITY FOR "IS THIS CONTENT TIED TO THE BRIEF?"
 *
 * ── WHY THIS FILE EXISTS (R1 remediation, roots 1 and 4) ────────────────────
 *
 * R1 makes it structurally impossible for the MODEL to *claim* provenance: the
 * grammar gives it no provenance channel, and the projector stamps the badge
 * from its own loop position. That is a real property and it held.
 *
 * It is NOT the property we shipped the badge for. It does not stop unsupported
 * content from *acquiring* true-looking provenance by entering the stated
 * channel. Anything the model places in `stated_items` was badged `stated` by
 * position alone, and a `figure` with a number rode `extractionType:"explicit"`
 * out to the wire as `from_brief` — whether or not the brief ever said it. An
 * external audit demonstrated both halves: a fabricated
 * "Revenue is 10 million pounds" against a brief about commute time, and an
 * exact-but-contradicted quote ("Churn is 10 percent" carrying the value 90).
 *
 * So the question this file answers is the one the badge is read as answering:
 * **can this content be tied, deterministically, to bytes the user actually
 * wrote?** Nothing here consults the model's opinion, because the model's
 * opinion is exactly what the badge is supposed to be independent of.
 *
 * ── THE ASYMMETRY IS DELIBERATE, AND IT IS THE WHOLE SAFETY ARGUMENT ────────
 *
 * Containment is a conservative predicate and it errs in ONE direction:
 *
 *  - A real quote the user wrote in different words (brief: "churn is 10%",
 *    quote: "Churn is 10 percent") reads UNVERIFIED. The node keeps its content
 *    and its label; it simply loses the `from_brief` badge and is shown as
 *    `ai_inferred`. That is a badge that understates — the honest direction.
 *  - For a FABRICATION to read VERIFIED, the fabricated text would have to
 *    appear literally in the brief — at which point it is not a fabrication.
 *
 * The predicate therefore cannot manufacture provenance, only decline to
 * certify it. Written against the SPEC ("the quote occurs in the brief"), never
 * against the failure mode in hand (trap 13d).
 *
 * ── WHY `unchecked` IS A THIRD STATE AND NOT A BOOLEAN ──────────────────────
 *
 * "We looked and it is not there" and "we had nothing to look in" are different
 * facts, and collapsing them is how a fail-OPEN default gets written by
 * accident. Both decline the badge — but only one of them is a finding about the
 * content. Callers that want to disclose ("this could not be checked") need the
 * distinction; callers that want to gate treat both as "not earned". Two
 * questions, two names (trap 21).
 */

import { isAmountStatedInBrief } from "./stated-amounts.js";

/**
 * The verdict on one piece of content.
 *
 * - `verified`   — tied to brief bytes; may claim brief provenance.
 * - `unverified` — the brief was available and does NOT support it.
 * - `unchecked`  — no brief was supplied; nothing was established either way.
 *
 * **Only `verified` earns a brief-provenance badge.** The other two decline it.
 */
export type BriefBinding = "verified" | "unverified" | "unchecked";

/** `verified` is the ONLY verdict that earns a brief-provenance claim. */
export function bindingEarnsBriefClaim(binding: BriefBinding): boolean {
  return binding === "verified";
}

/**
 * Normalise for containment: case-folded, whitespace-collapsed, trimmed.
 *
 * ⚠ DELIBERATELY SHALLOW. Every additional normalisation step (stripping
 * punctuation, stemming, unit folding) widens the predicate, and widening it
 * moves error toward the direction that CERTIFIES content the user did not
 * write. The safe direction is already the default one here, so there is no
 * pressure to widen — resist it (trap 22b: one predicate, two opposite harms).
 */
function normaliseForContainment(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does this quote occur in the brief?
 *
 * Containment on the normalised forms. An empty quote NEVER verifies — an empty
 * string is contained in every text, which would make the predicate vacuously
 * true exactly where there is least evidence (trap 13: an assertion that cannot
 * fail is not evidence).
 */
export function isQuoteStatedInBrief(
  quote: string | null | undefined,
  briefText: string | null | undefined,
): boolean {
  if (typeof quote !== "string" || typeof briefText !== "string") return false;
  const needle = normaliseForContainment(quote);
  if (needle.length === 0) return false;
  return normaliseForContainment(briefText).includes(needle);
}

/**
 * ⭐ THE STATED-ITEM VERDICT — quote AND value, never one of the two.
 *
 * A numeric stated item makes TWO assertions about the brief: that the user
 * wrote these words, and that the number attached to them is the number they
 * wrote. The audit's second finding is precisely the case where the first holds
 * and the second does not — an exact quote, "Churn is 10 percent", carrying the
 * value 90. Verifying the quote alone would certify it.
 *
 * So a value, when present, must ALSO be found in the brief. The magnitude
 * comparison is not reimplemented here: it delegates to `isAmountStatedInBrief`,
 * the shipped authority that already handles currency codes, percent forms and
 * scale words. A second implementation of that question would be a
 * hand-maintained mirror of it (trap 12).
 */
export function bindStatedItemToBrief(args: {
  readonly quote: string | null | undefined;
  readonly value?: number | null;
  readonly unit?: string | null;
  readonly brief: string | null | undefined;
}): BriefBinding {
  const { quote, value, unit, brief } = args;
  if (typeof brief !== "string" || brief.trim().length === 0) return "unchecked";
  if (!isQuoteStatedInBrief(quote, brief)) return "unverified";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!isAmountStatedInBrief(value, unit ?? undefined, brief)) return "unverified";
  }
  return "verified";
}

/**
 * The OPTION-label verdict, used at the response transform.
 *
 * An option carries no `value`, so this is the quote half alone — but it is the
 * same authority and the same normalisation as the node path above, which is
 * the entire point of it living here. `options[].provenance.source` and
 * `nodes[].provenance` were two independent hardcodings of one fact, and they
 * contradicted each other on the wire (a stated option read `ai_inferred` as a
 * node and `brief_extraction` as an option). One derivation, two readers.
 */
export function bindOptionLabelToBrief(
  label: string | null | undefined,
  brief: string | null | undefined,
): BriefBinding {
  if (typeof brief !== "string" || brief.trim().length === 0) return "unchecked";
  return isQuoteStatedInBrief(label, brief) ? "verified" : "unverified";
}
