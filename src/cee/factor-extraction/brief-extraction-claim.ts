/**
 * ⭐ THE ONE PLACE THE "EXTRACTED FROM BRIEF" CLAIM IS SPELLED.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * This sentence is a PROVENANCE CLAIM in user-facing English: it tells a user
 * that a number on their canvas came from words they wrote. It had **four
 * producer sites and one consumer**, every one of them spelling the literal by
 * hand:
 *
 *   enricher.ts:1015, :1115   `uncertainty_drivers: ["Extracted from brief — confirm value"]`
 *   enricher.ts:453,  :1141   edge `provenance.quote`  `Extracted from brief: "<matched>"`
 *   schema-v3.ts:526          the WITHDRAWAL, matching on the prefix
 *
 * The withdrawal recognises the claim with a **case-sensitive** `startsWith`
 * against its own copy of the prefix. Two hand-maintained spellings of one
 * string, where one of them is a guard that must recognise the other, is trap 12
 * with a user-facing lie as the failure mode: change the producer's wording — an
 * em-dash to a hyphen, a capital to a lower case — and the withdrawal silently
 * stops matching while every test that spells the old literal still passes.
 *
 * ── WHAT IS AND IS NOT CLAIMED ─────────────────────────────────────────────
 * Exporting one constant makes the producers and the guard **agree by
 * construction**. It does NOT make the claim TRUE — that is the withdrawal's job
 * (`schema-v3.ts`: the claim survives only where `provenance === "from_brief"`).
 * Derivation stops the copies drifting; it cannot notice the list is short
 * (trap 12d), which is why the withdrawal is pinned by its own corpus.
 *
 * ⚠ AND A CARRIER THIS CONSTANT DOES NOT YET CLOSE. The two EDGE sites below
 * put the claim on `edge.provenance.quote`, which reaches the wire via
 * `schema-v3.ts:811-814` and is **not** covered by the node-level withdrawal.
 * That is a separately-rowed defect, deliberately NOT fixed here; it is
 * mitigated by those edges carrying an honest `source: "hypothesis"` beside the
 * claim. Naming it at the shared constant is the point — the next lane to touch
 * this string will read this note rather than rediscover the carrier.
 */

/**
 * The prefix every form of the claim starts with, and the exact string the
 * withdrawal matches on. Both producer forms are built from it below, so the
 * guard cannot fall out of step with them.
 */
export const BRIEF_EXTRACTION_CLAIM_PREFIX = "Extracted from brief";

/** The `uncertainty_drivers` form: a claim plus a request to confirm. */
export const BRIEF_EXTRACTION_CONFIRM_DRIVER =
  `${BRIEF_EXTRACTION_CLAIM_PREFIX} — confirm value`;

/** The edge-`provenance.quote` form, naming the matched brief text. */
export function briefExtractionQuote(matchedText: string): string {
  return `${BRIEF_EXTRACTION_CLAIM_PREFIX}: "${matchedText}"`;
}

/**
 * Does this string assert brief extraction?
 *
 * Case-INSENSITIVE deliberately: the producers all build from the constant
 * above, so an exact match would suffice for them — but this predicate is a
 * SAFETY guard, and the direction of its error matters. Failing to recognise a
 * claim leaves a lie on the wire; recognising one case-variant too many only
 * withdraws a driver line. Recognise generously, withdraw safely.
 */
export function assertsBriefExtraction(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase().startsWith(BRIEF_EXTRACTION_CLAIM_PREFIX.toLowerCase())
  );
}
