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
 *   (e) SEEN-BEFORE CONTINUITY — prose that presupposes the user has ALREADY
 *       BEEN SHOWN a result: "the analysis you have already seen", "you saw
 *       the results", "I showed you the analysis", "as you saw in the
 *       analysis" (SCREENED). See "THE CLASS ARM (e) ADDS" below.
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
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CLASS ARM (e) ADDS — A RESULT CAN BE FABRICATED WITHOUT BEING STATED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ WITNESSED 2026-08-21 (fresh-guest journey). On a FIRST-EVER scenario — the
 * analyse affordance `disabled: true`, `results.report` NULL, the panel reading
 * "No analysis yet." — the product said "the analysis YOU HAVE ALREADY SEEN".
 * There was no prior analysis. Nothing here caught it.
 *
 * Arms (a)-(d) all require a RESULT to be ATTRIBUTED — a result-verb, a
 * prepositional attribution, a first-person run claim, or a result-claiming
 * figure. The witnessed sentence attributes no result at all. It attributes
 * DELIVERY: *you have seen this*. The harm is identical (the user believes an
 * analysis exists) and the domain did not reach it. A predicate-BREADTH failure
 * of exactly the shape CLAUDE.md trap 22 describes: the corpus that built arms
 * (a)-(d) came from result-claiming prose, so it could not see the class it did
 * not imagine.
 *
 * ── THE TWO QUESTIONS, NAMED APART (CLAUDE.md trap #21) ─────────────────────
 *   "Is this turn ENTITLED to reference an analysis result?"
 *       → owned by the CALL SITES and derived from state: `!analysisResultExists`
 *         (`coaching-output-postcheck.ts`) and `!hasAnalysisFact`
 *         (`validator-explanation.ts`). ⭐ THIS IS THE DURABLE PREDICATE and it
 *         was already correct at the witnessed tip — the gate was open and this
 *         module simply did not match. UNCHANGED by this change.
 *   "Does this prose reference one?"
 *       → owned HERE. Widened by arm (e), and by nothing else.
 *
 * The entitlement gate decides WHETHER to police; the phrase set decides only
 * WHAT to rewrite. That division is why GENUINE CONTINUITY SURVIVES: once a
 * completed analysis exists, neither consumer consults this module at all, so
 * "the analysis you ran" / "the analysis you have already seen" ship untouched
 * on a re-run, on a restored scenario, and on any turn after a completed run.
 * Both directions are pinned in `__tests__/fabricated-result-reference.test.ts`
 * (CLAUDE.md trap 22b — a fix that closes a gap and opens its inverse).
 *
 * ⚠ A PHRASE SET IS A HAND-MAINTAINED MIRROR (trap 12) and this one will never
 * be complete. ⚠ NOTHING HERE IS A GUARANTEE. Both consumers are CONJUNCTIONS
 * (`!analysisResultExists && hasFabricatedResultReference(...)`), so the
 * entitlement gate only decides WHETHER to consult this set — when the set
 * misses, the fabrication SHIPS. The gate bounds the false-POSITIVE cost; it
 * does not bound the false-NEGATIVE one.
 * Arm (e) is bounded to the PAST-TENSE VIEWING class ("already seen", "saw",
 * "viewed", "showed you") because past-tense delivery is the unambiguous marker;
 * future and conditional framings are legitimate pre-analysis coaching and are
 * screened or unmatched by construction.
 *
 * ── BOUNDARY WITH `cee/decision-review/contract-gate.ts` R-CONT ─────────────
 * That module's `FABRICATED_CONTINUITY_PATTERNS` answers a THIRD question —
 * "does this REVIEW reference a prior exchange?" — on a surface whose input
 * carries no conversation history at all, so it fires UNCONDITIONALLY and is an
 * ENFORCE-DROP rule biased to false-negative. Its vocabulary (conversational
 * callbacks: "as you mentioned", "we discussed", "previous analysis") is kept
 * DISJOINT from arm (e) rather than merged: merging would import this module's
 * screens into an enforce-drop rule and change what drops a legitimate review.
 * Named apart here and there; no phrase is duplicated between them.
 */
const FABRICATED_RESULT_NOUN =
  '(?:analysis(?!\\s+paralysis)|results?|simulation|monte\\s+carlo)';
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

/**
 * (e) SEEN-BEFORE continuity attribution — the class witnessed 2026-08-21.
 *
 * SCREENED, deliberately, by the SAME {@link isFabricationScreened} the
 * attribution arms use — no new screen policy. The user-own screen is what
 * makes this safe: a user who brought their OWN analysis really has seen one
 * ("your own analysis you have already seen"), and that sentence must ship.
 * The conditional and question screens carry the future/hypothetical framings
 * ("once you have seen the analysis…", "have you already seen one?").
 *
 * Nouns are the shared {@link FABRICATED_RESULT_NOUN} set, so the arm cannot
 * drift from what the rest of this module calls a result.
 */
const SEEN_BEFORE_VERB = '(?:seen|saw|viewed)';
/** "you" plus its perfect contractions — "you've", "you'd" (both apostrophes). */
const SEEN_BEFORE_SUBJECT = "you(?:'ve|\u2019ve|'d|\u2019d)?";
/** Optional un-contracted perfect auxiliary — "you have/had already seen". */
const SEEN_BEFORE_AUX = '(?:(?:have|had)\\s+)?';
/** Determiner opening the noun phrase, then ≤2 modifiers before the noun. */
const SEEN_BEFORE_DET = '(?:the|this|that|these|those|an?|our|your|its|my)';
const SEEN_BEFORE_MODS =
  "(?:(?!(?:the|this|that|these|those|an?|our|your|its|my|his|her|their)\\b)[\\w'\u2019-]+\\s+){0,2}?";

const FABRICATED_SEEN_BEFORE_PATTERNS: readonly RegExp[] = [
  /* e1 — post-modified: "the analysis (that) you have already seen". */
  new RegExp(
    `\\b${FABRICATED_RESULT_NOUN}\\s+(?:that\\s+|which\\s+)?` +
      `${SEEN_BEFORE_SUBJECT}\\s+${SEEN_BEFORE_AUX}(?:already\\s+)?${SEEN_BEFORE_VERB}\\b`,
    'i',
  ),
  /* e2 — pre-modified: "you have already seen the (headline) results". */
  new RegExp(
    `\\b${SEEN_BEFORE_SUBJECT}\\s+${SEEN_BEFORE_AUX}(?:already\\s+)?${SEEN_BEFORE_VERB}\\s+` +
      `${SEEN_BEFORE_DET}\\s+${SEEN_BEFORE_MODS}${FABRICATED_RESULT_NOUN}\\b`,
    'i',
  ),
  /* e3a — product delivery: "I showed you the analysis", "we shared the results". */
  new RegExp(
    `\\b(?:i|we)\\s+(?:showed|shared|sent|gave)\\s+(?:you\\s+)?` +
      `${SEEN_BEFORE_DET}\\s+${SEEN_BEFORE_MODS}${FABRICATED_RESULT_NOUN}\\b`,
    'i',
  ),
  /* e3b — its post-modified twin: "the analysis I showed you". */
  new RegExp(
    `\\b${FABRICATED_RESULT_NOUN}\\s+(?:that\\s+|which\\s+)?` +
      `(?:i|we)\\s+(?:showed|shared|sent|gave)\\s+you\\b`,
    'i',
  ),
  /* e4 — "as you saw in the analysis". Kept separate from e2 rather than
   *      folded in by making e2's determiner prepositional: an optional
   *      "(in|from|on)" inside e2 would match "you have already seen in the
   *      past that analysis paralysis is real", inventing a result claim out
   *      of an ordinary aside. Anchoring on the "as you saw" frame keeps the
   *      match bound to a back-reference. */
  new RegExp(
    `\\bas\\s+${SEEN_BEFORE_SUBJECT}\\s+${SEEN_BEFORE_AUX}${SEEN_BEFORE_VERB}\\s+` +
      `(?:in|from|on)\\s+${SEEN_BEFORE_DET}\\s+${SEEN_BEFORE_MODS}${FABRICATED_RESULT_NOUN}\\b`,
    'i',
  ),
  /* e5 — definite back-reference with NO pronoun: "the previous analysis".
   *      Same phrase R-CONT already bans at `cee/decision-review/contract-gate.ts`
   *      (v15 staleness). Screened, so "the previous analysis you did" ships. */
  new RegExp(`\\b(?:previous|prior|earlier)\\s+${FABRICATED_RESULT_NOUN}\\b`, 'i'),
];

/** r3 FIX 4 screens — hypothetical / offer / user-own-analysis contexts. */
const CONDITIONAL_BEFORE_MATCH_PATTERN = /\b(?:if|whether|once|when|after)\b/i;
const RUN_OFFER_PATTERN = /\b(?:want\s+me\s+to\s+run|shall\s+i\s+run|i\s+can\s+run)\b/i;
const USER_OWN_ANALYSIS_PATTERN =
  /\b(?:analysis\s+you\s+(?:shared|ran|did)|your\s+(?:own\s+)?(?:[\w'\u2019-]+\s+){0,2}?(?:analysis|spreadsheet|numbers))\b/i;

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

export function hasFabricatedResultReference(
  text: string,
  opts: { readonly allowSeenBefore?: boolean } = {},
): boolean {
  for (const sentence of splitIntoSentences(text)) {
    // Unscreened arms: first-person run claim / inherently result-claiming figure.
    if (FABRICATED_RUN_CLAIM_PATTERN.test(sentence)) return true;
    if (FABRICATED_WINS_WITH_PATTERN.test(sentence)) return true;
    // Screened arms (a) + (b) + (e). Arm (e) rides the SAME screens rather
    // than carrying its own — one screen policy, one owner (trap 12).
    for (const re of [
      FABRICATED_ATTRIBUTION_VERB_PATTERN,
      FABRICATED_ATTRIBUTION_PREP_PATTERN,
      ...(opts.allowSeenBefore === true ? [] : FABRICATED_SEEN_BEFORE_PATTERNS),
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
