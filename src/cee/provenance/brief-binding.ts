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
 * ── ⚠⚠ THE SAFETY ARGUMENT THAT WAS HERE WAS FALSE. READ THIS FIRST. ────────
 *
 * The first version of this file closed with: *"The predicate therefore cannot
 * manufacture provenance, only decline to certify it."* **An adversarial review
 * refuted that by execution, end to end, at the wire:**
 *
 *     brief : "Licences cost £74,000 a year. The rebuild quote was £250,000."
 *     item  : quote "Licences cost £74,000 a year", value 250000, unit GBP
 *     ⇒ verified ⇒ nodes[].provenance = "from_brief"
 *
 * A node **labelled with the user's own sentence about £74,000, carrying the
 * value 250,000**, badged as the user's own words. That is audit finding 2 —
 * an exact quote with a contradicted value — alive PAST ITS OWN FIX.
 *
 * The cause was structural, and it is worth naming precisely because the
 * invariant was true as stated: the two halves were asked **against two
 * different scopes**. The quote half asked "is this quote in the BRIEF?"; the
 * value half asked "is this value in the BRIEF?". Neither ever asked *is this
 * value in THE QUOTE IT IS ATTACHED TO* — so any number occurring anywhere else
 * in the brief certified a sentence it had nothing to do with. A
 * number-transposition across two figures is the most ordinary LLM slip there
 * is on a brief that mentions two sums.
 *
 * ⭐ THE FIX IS ONE SCOPE, NOT A WIDER WINDOW. The value is now verified inside
 * the QUOTE, which is itself already proven brief-borne. That is strictly
 * stronger than the brief-scoped test and structurally cannot make a
 * cross-sentence match. Two questions under one predicate, answered against two
 * scopes, is trap 22b's shape; the repair is to collapse the scopes, not to tune
 * a window between them.
 *
 * ── THE ASYMMETRY, RESTATED HONESTLY ───────────────────────────────────────
 *
 * Containment is conservative and errs toward DECLINING:
 *
 *  - A real quote the user wrote in different words (brief: "churn is 10%",
 *    quote: "Churn is 10 percent") reads UNVERIFIED. The node keeps its content
 *    and its label; it loses only the badge. That understates — the safe way.
 *  - A fabricated SENTENCE must appear literally in the brief to verify, and a
 *    fabricated NUMBER must now appear inside that sentence.
 *
 * ⚠ WHAT IS STILL NOT CLAIMED, so this note cannot rot into the last one: a
 * quote short enough to be contained by coincidence is weak evidence, and the
 * floor below is a guard against degenerate emissions rather than a model of
 * specificity. Containment is a MATCHING predicate; the class of defect it
 * belongs to ends only when binding becomes VERIFIABLE — a character span into
 * the brief, where the quote is `brief.slice(start, end)` by construction and no
 * format-matching happens at all.
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
  if (needle.length < MIN_QUOTE_CHARS) return false;
  return normaliseForContainment(briefText).includes(needle);
}

/**
 * ⭐ THE SPECIFICITY FLOOR — measured, not theoretical.
 *
 * The empty-quote guard was here from the start, and a review showed there was
 * **nothing between "empty" and "trivially contained"**: a `source_quote` of
 * `"a"` read `verified`, because a one-character string is contained in
 * essentially any brief. The grammar puts no floor on `source_quote`, so a
 * degenerate model emission reaches this.
 *
 * ⚠ THIS IS A FLOOR AGAINST DEGENERACY, NOT A SPECIFICITY MODEL, and the
 * distinction is the honest part. A single common word ("the") clears three
 * characters and would still be contained by coincidence — containment simply
 * cannot tell evidence from coincidence at the short end, and no constant here
 * will make it. What this stops is the degenerate case; what actually ends the
 * class is span-based binding (see the header). Naming a constant's real reach
 * is the alternative to discovering it in the next review.
 *
 * Chosen at 3 because the shortest legitimate stated quotes in this estate's own
 * fixtures are four characters (`hire`, `Hold`), so the floor clears real
 * content with a margin and the error direction is to DECLINE.
 *
 * ── ⭐⭐ D4: IT HAS A SECOND CONSUMER, AND THAT WAS NOT NAMED WHEN IT LANDED ──
 * `bindOptionLabelToBrief` shares this floor, so a genuine two-character OPTION
 * label the user wrote (`"Go"`) now reads `cee_hypothesis` rather than
 * `brief_extraction`. That was an undocumented side effect of a change aimed at
 * stated items, and it is decided here rather than left to be discovered:
 *
 * **KEEP ONE FLOOR, FOR BOTH.** Two reasons, and the second is the stronger:
 *   1. the coincidence argument is identical — a two-character label proves
 *      nothing by being contained in a brief, whichever caller asks;
 *   2. two different floors behind one shared authority is two predicates under
 *      one name (trap 21), and this file exists because that shape produced the
 *      B1 defect. A second constant would be the beginning of the same story.
 *
 * ⚠ AND THE COST, NAMED RATHER THAN WAVED AWAY: for an option the badge decides
 * `brief_extraction` vs `cee_hypothesis`, so under-claiming tells the user WE
 * invented an alternative they wrote. That is a misattribution of authorship in
 * the opposite direction, and it is only tolerable because a two-character option
 * label is vanishingly rare in a real brief. If one is ever observed in a live
 * capture, this constant is the thing to revisit — not by nudging it, but by
 * moving to span binding, which removes the need for a floor at all.
 */
const MIN_QUOTE_CHARS = 3;

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
    // ⭐⭐ AGAINST THE QUOTE, NOT THE BRIEF — THIS IS THE B1 FIX.
    //
    // The quote has just been proven brief-borne, so scoping the magnitude test
    // to it is strictly stronger than scoping it to the brief: everything the
    // quote contains, the brief contains, and the converse is exactly the hole.
    // Verifying against the brief let a number from ANOTHER SENTENCE certify
    // this one (£250,000 certifying the user's £74,000 sentence).
    //
    // ⚠ AND DELIBERATELY NO FALL-BACK TO THE BRIEF for a quote that carries no
    // digits, which was offered and is declined: a quote with no number in it is
    // no evidence for a number, and re-admitting the brief as a second scope
    // rebuilds the defect in a narrower shape. ONE predicate, ONE scope. The cost
    // is that a figure whose number sits in a neighbouring sentence now
    // under-claims — the safe direction, and visible as such.
    // ⚠⚠ C3 — THE NEGATIVE CLASS IS UN-VERIFIABLE, AND THERE IS DELIBERATELY NO
    // GUARD HERE FOR IT. THIS ABSENCE IS THE DECISION; DO NOT "RESTORE" ONE.
    //
    // `stated-amounts.ts` carries no sign in its scan pattern and compares
    // absolute magnitudes, so `magnitudesMatch(500000, -500000)` is false and
    // EVERY negative value declines. Under ROADMAP 2.972 that predicate only
    // downgraded and the gap was cheap; it now decides a user-facing badge, and
    // the grammar admits negatives (`value: { type: "number" }`, unbounded), so
    // "we are running a -£500k deficit" can never be attributed to the user.
    //
    // I first wrote an explicit `isVerifiableMagnitude(value)` branch here to make
    // that decline a DECISION rather than a side effect. **A mutant proved it
    // equivalent** — flipping it to `return true` left all 31 tests green, because
    // the decline is produced downstream regardless. Two reasons to remove it
    // rather than keep a branch no test can kill:
    //   1. an unkillable branch is what a later tidy-up deletes without noticing,
    //      and this file already argues that case elsewhere;
    //   2. worse, it is a LANDMINE — the day `stated-amounts.ts` gains signed
    //      support, this guard would silently keep blocking the class the fix just
    //      enabled, and the fix would look broken.
    //
    // What pins the class instead is the OUTCOME: a KNOWN-DROPPED test asserting
    // exactly this behaviour, with a positive twin proving the decline is about
    // the SIGN. It REDs if the class grows AND if it is closed — and on the day it
    // is closed, that RED is the instruction to delete the test.
    if (!isAmountStatedInBrief(value, unit ?? undefined, quote as string)) return "unverified";
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
