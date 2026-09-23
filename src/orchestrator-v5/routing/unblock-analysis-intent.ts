/**
 * V5 deterministic pre-route — "what is stopping my analysis, and fix it".
 *
 * ── WHY THIS EXISTS, MEASURED ──────────────────────────────────────────────
 * Deployed staging, 23 Sep, scenario `399c2814`. Readiness held exactly ONE
 * issue for thirty-seven minutes — `OPTION_NEEDS_MAPPING`, "How does Two
 * Developers change Coordination Overhead Risk?" — while "Hire a Tech Lead" was
 * `status: ready` throughout. The user wrote:
 *
 *   "Check it and just help me fix what's stopping me from running the
 *    analysis. Just put good assumptions in and make those updates immediately."
 *
 * `tryNoAnalysisGuard` correctly declined (`no_analytical_signal`) — it answers
 * "asked an analytical question with no analysis present", and its remedy is
 * "run analysis first", which was not the user's problem. With no pre-route
 * claiming the turn, generic LLM routing chose `adjust_edge_strength` and moved
 * Coordination Overhead Risk 0.55 → 0.4. Both are the "moderate" band, so the
 * receipt read "from moderate to moderate"; the actual blocker was untouched
 * and no analysis fact was created.
 *
 * ⛔ A STRENGTH EDIT CAN NEVER SATISFY A MAPPING OBLIGATION. That is the class
 * this pre-route closes: the request is about ADMISSION, so it must be answered
 * from the readiness authority, not by whichever edit tool a routing model finds
 * plausible.
 *
 * ── THE CORPUS IS NOT MINE ─────────────────────────────────────────────────
 * Every phrase this is tuned against was harvested from `v5_conversation_turns`
 * on 23 Sep — real messages real users sent — together with two negative sets
 * (real edit-handler messages, real analytical questions). A predicate over
 * natural language tuned on its author's own inventions is a guard agreeing
 * with itself; the suite carries the harvested corpus verbatim.
 *
 * ── THE PREDICATE ──────────────────────────────────────────────────────────
 * Conjunction, deliberately: an ANALYSIS reference AND an IMPEDIMENT signal.
 * Either alone over-matches. "Walk me through what the analysis found" is an
 * analysis reference with no impediment; "Set Pro Plan Monthly Price to 64" is
 * neither. Both are real messages that must not be claimed.
 *
 * ⚠ THE NEGATION ALLOWS A SUBJECT BETWEEN THE VERBS, and the corpus is why. A
 * first draft required `can't run` adjacent and MISSED two harvested messages —
 * "Why can't the analysis run?" and "Why can't we run the analysis?" — because
 * real users put the subject in the middle. Tuned on invented phrasings that
 * gap would never have surfaced.
 */

/** Why a message was not claimed. Named apart so telemetry can tell them apart. */
export type UnblockAnalysisUnmatchedReason =
  | 'empty_message'
  | 'no_analysis_reference'
  | 'no_impediment_signal';

export type UnblockAnalysisIntentResult =
  | {
      readonly matched: true;
      /** The user asked to be TOLD what blocks it, and/or to have it FIXED. */
      readonly authorises_repair: boolean;
    }
  | { readonly matched: false; readonly reason: UnblockAnalysisUnmatchedReason };

/**
 * A reference to the analysis/admission itself.
 */
const ANALYSIS_REFERENCE =
  /\b(analys(?:is|e|es|ed|ing|able)|analyz(?:e|es|ed|ing|able)|run\s+the\s+model)\b/i;

/**
 * An impediment, as a STANDALONE term. Every alternative is either harvested
 * from real messages or a direct synonym of one.
 *
 * ⛔ THE BARE NOUNS `issue|problem|error` WERE REMOVED. An independent review
 * measured them claiming 12 of 15 adversarial edit/result phrasings, including
 * "Walk me through the analysis and the issue tree." — a pinned control plus
 * three words. A noun that names trouble somewhere is not evidence that the
 * trouble is admission.
 *
 * ⚠ `ready to analys…` SITS OUTSIDE THE ALTERNATION'S TRAILING `\b`, and that
 * is not cosmetic: a word boundary cannot follow `analys` when the next
 * character is `e`, so "get the model ready to analyse" — a harvested phrase,
 * and the one the header cites to justify the `analysable` alternative —
 * silently never matched. The suite caught it; reading the regex did not.
 */
const IMPEDIMENT_SIGNAL =
  /\b(stopping|blocking|blocked|unblock|preventing|holding\s+up|stuck|not\s+ready|needs?\s+configuration|no\s+effect\s+values|missing\s+effect|greyed\s+out|disabled|unavailable|failing)\b|\bready\s+to\s+analys\w*|\bbefore\s+(?:you|we|i)\s+can\s+run\b|\bwhat(?:'|\u2019)?s?\s+(?:is\s+)?(?:missing|wrong|blocking|stopping)\b|\b(?:can(?:'|\u2019)?t|cannot|can\s+not|won(?:'|\u2019)?t|unable\s+to|not\s+able\s+to)\b[^.!?]{0,24}\brun\b/i;

/**
 * `fix`/`resolve` only count when they are ABOUT the analysis. Proximity in
 * either direction, because both orders occur in the corpus ("fix this so the
 * analysis can run", "the analysis says it can't run … to fix it").
 */
const REPAIR_VERB_NEAR_ANALYSIS =
  /\b(?:fix|resolve|unblock)\b[^.!?]{0,60}\b(?:analys|analyz|run)/i;
const ANALYSIS_NEAR_REPAIR_VERB =
  /\b(?:analys|analyz|run)\w*\b[^.!?]{0,60}\b(?:fix|resolve|unblock)\b/i;

/**
 * The user has authorised the product to supply values it chose.
 *
 * ⛔ IT FAILS CLOSED ON ANY PROHIBITION. A review found the earlier version
 * firing on messages that explicitly REFUSE the licence — "don't make any
 * assumptions", "Never use estimates", "Ask me before you add any
 * assumptions". A flag that may later permit the product to invent numbers
 * must never be set by a sentence forbidding exactly that. No real message in
 * the harvested corpus prohibits assumptions, so this is a guard against a
 * measured-possible case rather than an observed one — which is the right
 * direction for this particular flag.
 */
const REPAIR_PROHIBITION =
  /\b(?:don(?:'|\u2019)?t|do\s+not|never|without|no)\b[^.!?]{0,30}\b(?:assum\w*|estimat\w*|guess\w*|invent\w*|made?\s+up)\b|\bask\s+me\s+(?:first|before)\b|\bbefore\s+you\s+(?:add|make|use)\b/i;

/**
 * Explicit permission to choose values. Harvested phrasings: "put good
 * assumptions in", "using sensible estimates from my brief", "using your best
 * judgement from the brief", "fill in the missing effect values", "You choose
 * … Go ahead".
 *
 * ⚠ `apply them` / `make the updates` were REMOVED. A review observed that
 * neither grants a numeric licence — they authorise applying something already
 * agreed, which is a different permission.
 */
const REPAIR_AUTHORISATION =
  /\b(?:put|use|using|add|fill\s+in|write\s+in|make|set|choose|pick)\b[^.!?]{0,40}\b(?:assumption|assumptions|estimate|estimates|best\s+judge?ment)\b|\b(?:sensible|reasonable|good|best)\s+(?:assumption|assumptions|estimate|estimates|judge?ment)\b|\bgo\s+ahead\b|\byou\s+choose\b|\byourself\b/i;

export function detectUnblockAnalysisIntent(
  message: unknown,
): UnblockAnalysisIntentResult {
  if (typeof message !== 'string') return { matched: false, reason: 'empty_message' };
  const text = message.trim();
  if (text.length === 0) return { matched: false, reason: 'empty_message' };

  if (!ANALYSIS_REFERENCE.test(text)) {
    return { matched: false, reason: 'no_analysis_reference' };
  }
  const impeded =
    IMPEDIMENT_SIGNAL.test(text)
    || REPAIR_VERB_NEAR_ANALYSIS.test(text)
    || ANALYSIS_NEAR_REPAIR_VERB.test(text);
  if (!impeded) {
    return { matched: false, reason: 'no_impediment_signal' };
  }
  const authorises =
    !REPAIR_PROHIBITION.test(text) && REPAIR_AUTHORISATION.test(text);
  return { matched: true, authorises_repair: authorises };
}
