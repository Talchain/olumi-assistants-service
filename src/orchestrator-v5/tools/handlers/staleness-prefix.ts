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
//
// ⚠⚠ THIS DOCSTRING USED TO CLAIM SOMETHING FALSE, AND THE FALSE HALF IS WHY
// THE SENTENCE DRIFTED INTO TWO COPIES. It read "Single source of truth for the
// stale assistant_text caveat. Used by: buildAnalysisStaleTemplate
// (no-op-helpers.ts) as the leading sentence…". `buildAnalysisStaleTemplate`
// did NOT import this constant — it RE-TYPED the sentence, character for
// character, in another file. One user-facing sentence, two hand-maintained
// copies, and a docstring at one of them asserting the other was derived from
// it (CLAUDE.md trap 12 wearing trap 14's clothes: the label that gets
// remembered is the one that was wrong). Derived at `5f2e3fd0`: an import grep
// over `no-op-helpers.ts` returned zero hits for this symbol.
//
// It is TRUE NOW — `no-op-helpers.ts` composes both templates from these two
// constants. Do not re-inline the sentence.
//
// ⚠ AND THE GUARD THAT ENFORCES IT WAS ITSELF MIS-LABELLED ONCE, so state its
// power precisely rather than inheriting a slogan. TWO tests in
// `__tests__/staleness-prefix.test.ts` cover this, and they are NOT
// interchangeable:
//   • SINGLE_COPY (the derived one) counts occurrences of this constant in the
//     SOURCE BYTES of `src/`, excluding tests, and REDs on a second occurrence
//     — DRIFTED OR CHARACTER-IDENTICAL. This is the one that enforces "one
//     copy". Proven by mutation: a character-identical re-inline REDs it.
//   • BYTES compares RUNTIME VALUES, so it pins the assembled sentence but is
//     STRUCTURALLY INCAPABLE of seeing a character-identical re-typed copy —
//     both spellings produce the same string. It caught a 1-char drift and
//     passed the identical copy in the same measured pair.
// The earlier label here said the test suite "fails loud if a copy reappears",
// which was true only of a copy that ALSO DRIFTED. A false label about a guard
// is what teaches the next lane to stop looking (trap 14), which is exactly how
// the "single source of truth" claim above survived being false.
//
// Aligns with the brief's required wording verbatim. Contains no
// FORBIDDEN_USER_FACING_PHRASES entry (no "previous analysis",
// "prior analysis", "loaded from a prior run", etc.).
export const STALENESS_PREFIX =
  'These results may be out of date because the model has changed since the last analysis.';

/**
 * The `unconfirmed` twin — for freshness `unknown`, where currency CANNOT be
 * confirmed (a legacy fact missing its run-time hash, or an unhashable current
 * graph).
 *
 * ⭐ IT IS A DIFFERENT CLAIM, NOT A DIFFERENT SPELLING, and that is the whole
 * reason it is a second constant rather than a reworded first. `STALENESS_PREFIX`
 * ASSERTS the model changed, which is honest only when the hashes are known to
 * differ. Here we do not know that, and §1 authority parity of the merged
 * freshness policy (`Docs/t4/t4-spine-policy-v1.md`) forbids claiming which
 * state is current. Collapsing the two would ship a confident false claim on
 * every legacy fact.
 *
 * Byte-identical to the lead clause of the shipped `buildAnalysisUnconfirmedTemplate`,
 * which now composes from it.
 */
export const UNCONFIRMED_PREFIX =
  "The last analysis may be out of date because I can't confirm it still matches the current model.";

/**
 * THE WAY OUT — the recovery offer a caveated turn owes the user.
 *
 * ⚠⚠ THESE ARE HERE BECAUSE A NARROWING SILENTLY DELETED THE RECOVERY PATH, AND
 * ONLY A CONTRACT TEST NOTICED. The stale/unconfirmed TEMPLATES always carried
 * both halves — the caveat AND the offer — as one hard-coded string. When the
 * precondition was narrowed so a stale turn ANSWERS instead of returning the
 * template, the caveat survived (it is prepended in code) and the offer
 * VANISHED, because nothing owned it. `requiresRerun` is true on exactly these
 * states, so the offer is owed. Caught by
 * `tests/contract/v5-golden-path-acceptance.test.ts` asserting
 * `/re-run analysis/i`; the six specs the lane had chosen were all green
 * (CLAUDE.md trap 23 — the symptom's metric said success while a DIFFERENT
 * user-facing guarantee died, and the rerun CHIP still fired, so every
 * component-level witness agreed).
 *
 * ⭐ EXTRACTED RATHER THAN RE-TYPED. The answered path needs the same sentence
 * the template uses. Appending a hand-copied duplicate is precisely the
 * two-copies defect this module was rebuilt to abolish — and the existing
 * SINGLE_COPY guard would NOT have caught it, because it only pinned the two
 * PREFIX sentences. The guard is extended to cover these too, and an
 * M3IDENT-style character-identical re-inline of either one REDs it.
 *
 * Composed, never inlined: `buildAnalysisStaleTemplate` /
 * `buildAnalysisUnconfirmedTemplate` build from `<PREFIX> <OFFER>` and are
 * byte-identical to the shipped strings.
 */
export const STALE_RECOVERY_OFFER =
  'Would you like to re-run analysis to see how your changes affect the results?';

/**
 * The `unconfirmed` twin of {@link STALE_RECOVERY_OFFER}. Deliberately a
 * DIFFERENT sentence, for the same reason the prefixes differ: the stale copy
 * offers to show how YOUR CHANGES affected the result, which presumes we know
 * the model changed. Here we do not, so it offers only to show the CURRENT
 * result. Collapsing the two would smuggle the stronger claim back in.
 */
export const UNCONFIRMED_RECOVERY_OFFER = 'Re-run analysis to see the current result.';

/**
 * The two currency verdicts that carry a caveat.
 *
 * Deliberately NARROW — not the full `ExplanationPreconditionVerdict` union.
 * `missing` and `degraded` mean there is no result to caveat at all, and
 * `execute` means the result is current; none of the three has a caveat to
 * attach, and admitting them here would invite a call site to pass a verdict
 * this helper would then have to silently ignore. The mapping from the full
 * verdict lives with the verdict, in `no-op-helpers.ts`
 * (`caveatForPreconditionVerdict`), behind an exhaustive switch.
 *
 * ⚠ This module deliberately imports NOTHING. Keeping it dependency-free is
 * what lets `no-op-helpers.ts` import it without a cycle, and keeps the
 * canonical user-facing sentences out of reach of any other module's churn.
 */
export type StalenessCaveat = 'stale' | 'unconfirmed';

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
const APPROVED_OPENINGS: Readonly<Record<StalenessCaveat, readonly RegExp[]>> = {
  stale: [
    // Canonical STALENESS_PREFIX opening — guarantees this helper is idempotent
    // when called twice on the same text.
    /^\s*these results may be out of date because the model has changed\b/i,
    // Legacy directional-figures opening retained for back-compat: prose
    // produced by the previous build's deterministic fallback opens with
    // this clause. Keeping it suppresses double-prefixing during the
    // transition window. The phrase contains no forbidden token.
    /^\s*treat (?:the |any )?figures below as directional rather than definitive\b/i,
  ],
  unconfirmed: [
    // Canonical UNCONFIRMED_PREFIX opening.
    /^\s*the last analysis may be out of date because i can['’]?t confirm\b/i,
    /^\s*treat (?:the |any )?figures below as directional rather than definitive\b/i,
  ],
};

/**
 * ⚠⚠ THE TABLE IS PER-CAVEAT, AND THE ASYMMETRY IS THE POINT — DO NOT MERGE IT
 * BACK INTO ONE LIST.
 *
 * The `stale` opener is ABSENT from the `unconfirmed` row, and vice versa,
 * because the two are different CLAIMS. A reply already opening with the weaker
 * "I can't confirm…" must STILL receive the stronger, evidenced "the model has
 * changed…" when the verdict is `stale`: suppressing it there would trade a
 * redundant sentence for a false one, which is the wrong direction for a trust
 * caveat and the direction this whole module exists to refuse. Pinned by
 * `'a STALE caveat is still prepended to text opening with the weaker
 * UNCONFIRMED opener'`.
 *
 * The legacy directional opener sits in BOTH rows deliberately — it makes no
 * claim about WHICH state is current, so it is a safe suppressor for either.
 */

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

/**
 * @param caveat the LIVE currency verdict for this turn, or null/undefined when
 *   there is no currency claim to make.
 *
 * ⚠⚠ THE PARAMETER CHANGED, AND THE OLD ONE WAS DEAD. This took
 * `stalenessReason: string | null` — a field read off
 * `analysisProjection.staleness_reason`, which was REMOVED from the projection
 * ("the only consumer was applyStalenessPrefix" —
 * `context/projection-summaries.ts:62`). Measured at `5f2e3fd0`: this function
 * had ZERO live callers anywhere in `src/`, against a contrast control of
 * `buildAnalysisStaleTemplate` in the same sweep reading 4 non-comment
 * references (1 import, 1 definition and 2 CALL SITES) — so the zero is a
 * measurement, not a blind probe. The estate therefore had NO working mechanism
 * to caveat an executed explanation; the only staleness enforcement left was to
 * REFUSE to answer.
 *
 * It now takes the verdict the precondition already computes, which is live on
 * every explanation turn.
 *
 * ⚠⚠ RUNG UPDATED — THIS IS NOW WIRED, AND THE PREVIOUS NOTE HERE IS SUPERSEDED.
 * It read "RUNG: CODE EXISTS. THE CHANNEL IS TYPE-CONNECTED, NOT YET WIRED …
 * this function still has ZERO LIVE CALLERS", which was true and correctly
 * scoped when written. It is now false: `finaliseExplanationText`
 * (`no-op-helpers.ts`) calls this on every answered explanation turn, for both
 * `explain_results` and `what_would_flip`. A rung claim is a dated measurement,
 * not a standing fact — leaving the old one here would be the false-label defect
 * one door down from the one this module already carries a scar from.
 *
 * ⚠⚠ AND THE SAFETY ARGUMENT HAS NOW EXPIRED, EXACTLY AS PREDICTED. "No
 * user-visible bytes move" was underwritten by this function being UNREACHABLE.
 * It is reachable. The doubling gap pinned in the tests IS user-visible from
 * here on and has been re-priced rather than inherited: a model-authored caveat
 * in its own words is not detected, so the user can read a caveat twice, and the
 * same is true of the recovery offer. Accepted under the ratified asymmetry — a
 * missing caveat or a missing way out is a trust defect; a doubled one is
 * clumsy — and the exit is a structural badge, not a wider regex.
 */
export function applyStalenessPrefix(
  text: string,
  caveat: StalenessCaveat | null | undefined,
): StalenessPrefixResult {
  if (caveat === null || caveat === undefined) {
    return { text, prefixed: false };
  }
  for (const opening of APPROVED_OPENINGS[caveat]) {
    if (opening.test(text)) {
      return { text, prefixed: false };
    }
  }
  const prefix = caveat === 'stale' ? STALENESS_PREFIX : UNCONFIRMED_PREFIX;
  return { text: `${prefix} ${text}`, prefixed: true };
}

/**
 * The recovery offer for a caveat — "the way out" that closes a caveated turn.
 *
 * ⭐ SELECTED HERE FOR THE SAME REASON THE PREFIX IS. `applyStalenessPrefix`
 * already picks `stale` vs `unconfirmed` wording one line above; putting the
 * offer's selection anywhere else would split one question — "which words does
 * this caveat use?" — across two modules, which is how the sentence this file
 * owns ended up with two copies in the first place. This module owns the WORDS;
 * `no-op-helpers.ts` owns WHICH CLAIM IS LICENSED.
 *
 * ⚠⚠ EXHAUSTIVE WITH A `never` GUARD, MATCHING ITS SIBLING. This was a ternary,
 * and the old note here read *"total over `StalenessCaveat` by construction: the
 * type has exactly two members and both are named, so there is no default to
 * fall through."* True today, and it FAILS SILENT tomorrow: a ternary's `else`
 * absorbs any third member, so a new caveat would return the UNCONFIRMED copy —
 * the WEAKER claim in a state that may license a stronger one, which is the
 * fail-OPEN direction and the wrong one for a trust surface. The switch makes a
 * new member a TYPE ERROR here instead of a quiet mis-wording in front of a
 * user.
 *
 * `caveatForPreconditionVerdict` (`no-op-helpers.ts`) already states this
 * reasoning for the same union's producer side and is written this way; the two
 * halves of one question should not disagree about how they fail.
 */
export function recoveryOfferForCaveat(caveat: StalenessCaveat): string {
  switch (caveat) {
    case 'stale':
      return STALE_RECOVERY_OFFER;
    case 'unconfirmed':
      return UNCONFIRMED_RECOVERY_OFFER;
    default: {
      const _exhaustive: never = caveat;
      return _exhaustive;
    }
  }
}
