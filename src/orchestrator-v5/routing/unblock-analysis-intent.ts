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
 * A reference to the analysis/admission itself. `analysable`/`analyzable` are
 * included because "get the model ready to analyse" is a real harvested phrase.
 */
const ANALYSIS_REFERENCE =
  /\b(analys(?:is|e|es|ed|ing|able)|analyz(?:e|es|ed|ing|able)|run\s+the\s+model)\b/i;

/**
 * An impediment: something is preventing admission, or the user asks for it to
 * be repaired. Every alternative below appears in the harvested corpus.
 */
const IMPEDIMENT_SIGNAL =
  /\b(stopping|blocking|blocked|unblock|not\s+ready|needs?\s+configuration|no\s+effect\s+values|what(?:'|’)?s?\s+(?:is\s+)?(?:missing|wrong)|what\s+exactly\s+is\s+(?:missing|blocking)|fix|resolve|issue|problem|error)\b|\b(?:can(?:'|’)?t|cannot|can\s+not|won(?:'|’)?t|unable\s+to|not\s+able\s+to)\b[^.!?]{0,24}\brun\b/i;

/**
 * The user has authorised the product to supply reasonable estimates.
 *
 * ⚠ NARROW ON PURPOSE. This does not license inventing numbers by itself — it
 * records that the user asked for it, which a later bounded-repair step may
 * consume. "Just put good assumptions in and make those updates immediately"
 * is the harvested phrase; "what is blocking the analysis?" is not.
 *
 * ⚠ IT DELIBERATELY REFUSES "How do I fix this so the analysis can run?" — a
 * real harvested message. That asks HOW; it does not hand the product
 * permission to choose numbers. An earlier draft matched it via a generic
 * `fix .. this` clause, which is precisely the over-reach this flag must not
 * make, since a later step may read it as licence to supply estimates.
 */
const REPAIR_AUTHORISATION =
  /\b(?:put|use|add|fill\s+in|write\s+in|make)\b[^.!?]{0,40}\b(?:assumption|assumptions|estimate|estimates)\b|\bmake\s+(?:those|these|the)\s+updates\b|\bapply\s+(?:it|them|whatever)\b|\brestructure\s+whatever\b/i;

export function detectUnblockAnalysisIntent(
  message: unknown,
): UnblockAnalysisIntentResult {
  if (typeof message !== 'string') return { matched: false, reason: 'empty_message' };
  const text = message.trim();
  if (text.length === 0) return { matched: false, reason: 'empty_message' };

  if (!ANALYSIS_REFERENCE.test(text)) {
    return { matched: false, reason: 'no_analysis_reference' };
  }
  if (!IMPEDIMENT_SIGNAL.test(text)) {
    return { matched: false, reason: 'no_impediment_signal' };
  }
  return { matched: true, authorises_repair: REPAIR_AUTHORISATION.test(text) };
}
