/**
 * Fabricated-RESULT-reference detector — pure regex helper, no dependencies.
 *
 * Returns true when `text` attributes a RESULT (a ranking, a probability, a
 * winner) to an analysis / simulation that has not run. Used by:
 *
 *  1. `checkCoachingOutput` (coaching-output-postcheck) — coach / converse
 *     prose, as an always-on pre-analysis rule. A match degrades the turn to
 *     the deterministic trust response.
 *
 *  2. `validateExplanationAnswer` (validator-explanation) — Sonnet's
 *     `answer_text` for an explanation handler with no non-noop `run_analysis`
 *     fact. A match marks the answer invalid; the handler falls through to its
 *     deterministic fallback, so the user still gets a useful response.
 *
 * Both consumers gate on the SAME precondition — no analysis result exists —
 * so the two call sites cannot drift on what "fabricated" means. This module
 * exists because consumer 2 was previously absent: explanation turns had no
 * fabricated-result policing of any kind, and a prompt worked-example was the
 * only thing between the model and a fabricated result reference.
 *
 * Extracted VERBATIM from coaching-output-postcheck.ts (which now imports it)
 * — the r2/r3 arms, the #450 narrowing and the r3 FIX 1 / FIX 4 screens are
 * unchanged, so coach / converse behaviour is byte-identical.
 *
 * Placement mirrors the existing `mutation-language.ts` precedent in this
 * directory: one shared leaf detector, two consumers (the explanation
 * validator and the coaching path).
 *
 * Bias, as with mutation-language: a false positive costs "use the
 * deterministic fallback" (the user still gets a useful answer); a false
 * negative costs the user believing a result exists when none was computed.
 */

/**
 * Pre-analysis fabricated-RESULT reference (review r2). Applied as an ALWAYS-ON
 * rule that fires ONLY when no analysis result exists (`!analysisResultExists`).
 *
 * The #450 narrowing (state-conditional rules gated on a result existing) is
 * correct for ordinary pre-analysis coaching, but it opened a real honesty hole:
 * a fabricated RESULT — a claim that attributes a ranking / probability to an
 * analysis or simulation that HAS NOT RUN — would ship. This MITIGATES that
 * class (best-effort, NOT a guarantee — see "Known limitations" in the module
 * doc). Arms, evaluated per SENTENCE (r3 precision round — final regex round;
 * further hardening is the phase-② semantic check):
 *   (a) result-noun → (≤2 intervening NON-MODAL words) → result-verb — "the
 *       analysis [clearly] shows/suggests/predicts/… X" (SCREENED, see below;
 *       modal/future bridges — "the analysis will/would show…" — are excluded,
 *       see MODAL_BRIDGE_WORD);
 *   (b) "according to / based on" + determiner + (≤2 modifiers) + result-noun
 *       — "according to our analysis", "based on the latest results"
 *       (SCREENED);
 *   (c) "(I|we) ran the <analysis|simulation|numbers>" — an invented run
 *       (unscreened: a first-person past-tense run claim is false by
 *       construction pre-analysis);
 *   (d) "wins with <n>%" (unscreened: inherently result-claiming), and
 *       "<n>% (probability|chance|likelihood)" ONLY with same-sentence
 *       attribution (analysis/results/simulation/model run). A bare
 *       "30% chance of churn" is the USER-ECHO class and ships (r3 FIX 1 —
 *       the r2 unanchored arm over-suppressed the user's own framing,
 *       recreating the exact dead-end #450 fixes).
 *
 * SCREENS (r3 FIX 4; same class as the #418 negation-screen precedent): the
 * screened arms do NOT fire when the sentence is a hypothetical / offer —
 * a conditional (if/whether/once/when/after) BEFORE the match, the sentence
 * ends with "?", or it contains an offer to run ("want me to run", "shall I
 * run", "I can run") — or when the analysis is attributed to the USER ("the
 * analysis you shared/ran/did", "your (own) analysis/spreadsheet/numbers").
 * Screens are applied to arms (a), (b) and the %-figure arm; arms (c) and
 * "wins with N%" stay unscreened (both are result-claims in any context).
 */
const FABRICATED_RESULT_NOUN = '(?:analysis|results?|simulation|monte\\s+carlo)';
const FABRICATED_RESULT_VERB =
  '(?:shows?|says?|found|indicates?|points?\\s+to|came\\s+out|reveals?' +
  '|suggests?|concludes?|predicts?|estimates?|recommends?|confirms?|favou?rs?' +
  '|tells\\s+(?:us|you))';

/**
 * Modal / future auxiliaries excluded from arm (a)'s bridge (live re-verify
 * 2026-07-14): a modal-bridged attribution — "the analysis will/would/should
 * show whether…" — describes a FUTURE or hypothetical run, exactly the honest
 * pre-analysis coaching #450 set out to protect, not a completed result. The
 * tense-blind bridge clobbered ~43% of genuine pre-analysis answers on staging
 * build 1489066 (the conditional screen only inspects text BEFORE the match,
 * so a trailing "whether" never screened it). `gonna` rides along as the
 * one-token colloquial "going to" ("going to show" itself already exceeds the
 * ≤2-word bound). Contracted "'ll" needs no entry: `analysis'll` attaches to
 * the noun token, and the noun→`\s+` shape means arm (a) never matched it —
 * consistent with the exclusion ("'ll" == "will"). Deliberately NOT excluded
 * (unobserved live; a separate sub-class for a future round if seen, not
 * pre-widened): negated modal contractions ("the analysis won't/wouldn't
 * show…" still fires arm (a)).
 */
const MODAL_BRIDGE_WORD =
  '(?:will|would|should|could|can|may|might|shall|going|gonna)';

/** (a) noun → ≤2 intervening NON-MODAL words → verb. Lazy gap so the shortest
 *  bridge wins; each bridge word is lookahead-screened against
 *  {@link MODAL_BRIDGE_WORD}, so completed-result attributions ("the analysis
 *  [clearly] shows X") still fire while future/hypothetical ones ship. The
 *  lookahead leaves the {0,2} word bound and the disjoint `[\w'’-]+`/`\s+`
 *  chunking (no backtracking ambiguity) unchanged. */
const FABRICATED_ATTRIBUTION_VERB_PATTERN = new RegExp(
  `\\b${FABRICATED_RESULT_NOUN}\\s+(?:(?!${MODAL_BRIDGE_WORD}\\b)[\\w'’-]+\\s+){0,2}?${FABRICATED_RESULT_VERB}\\b`,
  'i',
);

/** (b) according to / based on + determiner + ≤2 modifiers + result-noun. */
const FABRICATED_ATTRIBUTION_PREP_PATTERN = new RegExp(
  `\\b(?:according\\s+to|based\\s+on)\\s+(?:the|our|your|this|that|my)\\s+` +
    `(?:[\\w-]+\\s+){0,2}?(?:analysis|results?|simulation)\\b`,
  'i',
);

/** (c) invented first-person run — unscreened. */
const FABRICATED_RUN_CLAIM_PATTERN =
  /\b(?:i|we)\s+ran\s+the\s+(?:analysis|simulation|numbers)\b/i;

/** (d) standalone result-claiming figure — unscreened. */
const FABRICATED_WINS_WITH_PATTERN = /\bwins?\s+with\s+\d{1,3}\s?%/i;
/** (d) probability-figure term — fires only with same-sentence attribution. */
const RESULT_FIGURE_TERM_PATTERN = /\b\d{1,3}\s?%\s+(?:probability|chance|likelihood)\b/i;
const RESULT_ATTRIBUTION_NOUN_PATTERN = /\b(?:analysis|results?|simulation|model\s+run)\b/i;

/** r3 FIX 4 screens — hypothetical / offer / user-own-analysis contexts. */
const CONDITIONAL_BEFORE_MATCH_PATTERN = /\b(?:if|whether|once|when|after)\b/i;
const RUN_OFFER_PATTERN = /\b(?:want\s+me\s+to\s+run|shall\s+i\s+run|i\s+can\s+run)\b/i;
const USER_OWN_ANALYSIS_PATTERN =
  /\b(?:analysis\s+you\s+(?:shared|ran|did)|your\s+(?:own\s+)?(?:analysis|spreadsheet|numbers))\b/i;

/** Sentence split for the per-sentence arms/screens. Coarse on purpose. */
function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/);
}

/** Is a screened-arm match inside a hypothetical / offer / user-own context? */
function isFabricationScreened(sentence: string, matchIndex: number): boolean {
  if (sentence.trimEnd().endsWith('?')) return true;
  if (RUN_OFFER_PATTERN.test(sentence)) return true;
  if (USER_OWN_ANALYSIS_PATTERN.test(sentence)) return true;
  return CONDITIONAL_BEFORE_MATCH_PATTERN.test(sentence.slice(0, matchIndex));
}

export function hasFabricatedResultReference(text: string): boolean {
  for (const sentence of splitIntoSentences(text)) {
    // Unscreened arms: first-person run claim / inherently result-claiming figure.
    if (FABRICATED_RUN_CLAIM_PATTERN.test(sentence)) return true;
    if (FABRICATED_WINS_WITH_PATTERN.test(sentence)) return true;
    // Screened attribution arms (a) + (b).
    for (const re of [
      FABRICATED_ATTRIBUTION_VERB_PATTERN,
      FABRICATED_ATTRIBUTION_PREP_PATTERN,
    ]) {
      const m = re.exec(sentence);
      if (m !== null && !isFabricationScreened(sentence, m.index)) return true;
    }
    // Screened %-figure arm: requires same-sentence attribution (r3 FIX 1).
    const fig = RESULT_FIGURE_TERM_PATTERN.exec(sentence);
    if (
      fig !== null &&
      RESULT_ATTRIBUTION_NOUN_PATTERN.test(sentence) &&
      !isFabricationScreened(sentence, fig.index)
    ) {
      return true;
    }
  }
  return false;
}
