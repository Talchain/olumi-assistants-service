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

export const STALENESS_PREFIX =
  'These results are from a prior run and may not reflect recent changes to the decision model. Treat any figures below as directional rather than definitive.';

/**
 * Approved openings that suppress prefixing. The text must literally
 * START with one of these phrases (after any leading whitespace, case-
 * insensitive). A caveat anywhere later in the prose is NOT enough — the
 * trust contract requires the user reads the caveat first, top-down.
 *
 * Pattern selection deliberately tight: only the canonical STALENESS_PREFIX
 * opening and the legacy deterministic-fallback phrasing match. A more
 * lenient pattern like "These results may not reflect…" would suppress
 * prefixing on legitimate non-staleness prose that happens to share that
 * opener (e.g. "These results may not reflect every nuance"), breaking
 * the trust contract.
 */
const APPROVED_OPENINGS: readonly RegExp[] = [
  // Canonical STALENESS_PREFIX opening — guarantees this helper is idempotent
  // when called twice on the same text.
  /^\s*these results are from a prior run and may not reflect\b/i,
  // Legacy deterministic-fallback opening from the previous build, kept so
  // any cached pre-prefixed prose does not get double-prefixed during the
  // transition.
  /^\s*treat (?:the |any )?figures below as directional rather than definitive\b/i,
  /^\s*the analysis (?:is |was )?loaded from a prior run\b/i,
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
