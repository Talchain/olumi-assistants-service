/**
 * Deterministic staleness-caveat prefix for V5 explanation handlers.
 *
 * Trust contract: when the analysis projection is loaded from a prior run
 * (`analysisProjection.staleness_reason != null`), the user's response MUST
 * open with a caveat before any figure. Earlier builds enforced this with a
 * regex ordering check on Sonnet's freeform prose; that approach was
 * brittle. This helper enforces the rule by prepending the caveat in code.
 *
 * Idempotency strategy: skip prefixing only when the text LITERALLY OPENS
 * with the canonical staleness prefix or one of a small set of approved
 * caveat openings. We deliberately do NOT try to prove caveat-precedes-
 * figure via regex over the whole text — that approach drifts as Sonnet
 * varies phrasings and number formats (£300k, 1,000,000, bare integers,
 * "percentage point" singular all slip past brittle numeric patterns).
 * Prepending a redundant prefix is cheap and harmless; missing the prefix
 * because of incomplete numeric detection breaks the trust contract.
 *
 * `explain_from_structure` is exempt — structural answers cite graph link
 * strengths, not analysis figures, and the structure projection has no
 * `staleness_reason` field.
 */

// V5 stale-aware explain recovery — brief-mandated stale-copy opener.
// Single source of truth for the stale assistant_text caveat. Used by:
//   - buildAnalysisStaleTemplate (no-op-helpers.ts) as the leading
//     sentence of the precondition-stale template
//   - applyStalenessPrefix below as the idempotent prefix for any
//     legacy call path that still relies on the prefix helper
// Aligns with the brief's required wording verbatim. Contains no
// FORBIDDEN_USER_FACING_PHRASES entry (no "previous analysis",
// "prior analysis", "loaded from a prior run", etc.).
export const STALENESS_PREFIX =
  'These results may be out of date because the model has changed since the last analysis.';

/**
 * Approved openings that suppress prefixing. The text must literally
 * START with one of these phrases (after any leading whitespace, case-
 * insensitive). A caveat anywhere later in the prose is NOT enough — the
 * trust contract requires the user reads the caveat first, top-down.
 *
 * Pattern selection deliberately tight: only the canonical STALENESS_PREFIX
 * opening matches. The legacy "loaded from a prior run" opener has been
 * pruned (V5 stale-aware explain recovery brief forbids that phrase in
 * user-facing prose); any cached pre-prefixed prose using it will be
 * re-prefixed, but the finaliser-level egress guard then strips/replaces
 * the forbidden phrase, so the user never sees both.
 */
const APPROVED_OPENINGS: readonly RegExp[] = [
  // Canonical STALENESS_PREFIX opening — guarantees this helper is idempotent
  // when called twice on the same text.
  /^\s*these results may be out of date because the model has changed\b/i,
  // Legacy directional-figures opening retained for back-compat: prose
  // produced by the previous build's deterministic fallback opens with
  // this clause. Keeping it suppresses double-prefixing during the
  // transition window. The phrase contains no forbidden token.
  /^\s*treat (?:the |any )?figures below as directional rather than definitive\b/i,
];

export interface StalenessPrefixResult {
  readonly text: string;
  /**
   * `true` when this call prepended the caveat. `false` when no staleness
   * was provided OR when the text already opens with an approved caveat.
   * The chip-generator keys the rerun chip on the projection's
   * `staleness_reason`, not on this flag, so users still see the rerun
   * affordance even when the prose came pre-prefixed.
   */
  readonly prefixed: boolean;
}

export function applyStalenessPrefix(
  text: string,
  stalenessReason: string | null | undefined,
): StalenessPrefixResult {
  if (stalenessReason === null || stalenessReason === undefined) {
    return { text, prefixed: false };
  }
  for (const opening of APPROVED_OPENINGS) {
    if (opening.test(text)) {
      return { text, prefixed: false };
    }
  }
  return { text: `${STALENESS_PREFIX} ${text}`, prefixed: true };
}
