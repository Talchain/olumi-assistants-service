/**
 * Structural-restructure intent detector — the free-text
 * "split the shared factor into per-option links" class.
 *
 * Live-proven gap (LATENCY-RECAPTURE-7ef952c finding 3; probe 69a2f44f, build
 * e7f312d): the coach is instructed by the served orchestrator prompt to
 * "Propose structural changes and let the re-run settle the question" — the
 * highest-value coaching it can offer. But its routing tool
 * (`OLUMI_ACTION_TOOL`) has NO structural handler ("Graph structural changes
 * (draft_graph, edit_graph) are dispatched by the system before routing and
 * never reach this tool call"). So when a restructure request carries no
 * `EDIT_GRAPH_POSITIVE_REGEX` verb — "split the shared factor into per-option
 * links" contains none of change/update/edit/modify/remove/delete/add/adjust/
 * set/reduce/increase/decrease/tweak/raise/lower — `editIntentDetected` is
 * false, the message bypasses the edit lane (the sole structural-proposal
 * producer), reaches the coach, and the coach DESCRIBES the change without
 * seeding any apply action. A subsequent bare "Yes, apply it now" then has no
 * live pending to resume, so short-confirm falls through to the coach again,
 * which ignores the consent. The user bleeds four turns and nothing applies.
 *
 * This detector is the deterministic gate that routes the intent to the EDIT
 * LANE instead — the SAME `configureOptionIntent` precedent (ROADMAP 2.11 /
 * P0-2, `configure-option-intent.ts`): a narrow, edit-verb-free candidate that
 * joins `editIntentDetected` and shares the route's negative gates (meta-
 * question regex, analytical question, state query). Once in the edit lane,
 * the served edit prompt authors the restructure operations, the referee HOLDS
 * them (add_node/add_edge → STRUCTURAL_APPLY_HELD; remove → REMOVE_UNCONFIRMED)
 * into an `apply_proposed_change` pending with a confirm chip, and the bare
 * consent resumes it through the already-wired short-confirm →
 * `executeGmHeldResume` path (the exact machinery Lane C3's add-option
 * transaction reuses). ONE owner, one path — no new hold producer, no coach
 * tool-contract change, no LLM proposal-extraction (op authoring stays the
 * edit lane's existing job; only the deterministic routing is new).
 *
 * Triggers (any one):
 *   1. `per_option_term` — the per-option MODELLING term ("per-option",
 *      "per option", "option-specific") paired with a restructure/creation
 *      verb (split / separate / break / duplicate / clone / copy / fork /
 *      rewire / divide / convert / turn / make / give / add / create). The
 *      per-option term is unambiguous modelling jargon; requiring a verb
 *      alongside it keeps casual "per-option" mentions out.
 *   2. `each_option_own` — the "each/every/per option ... its/their own X"
 *      framing ("give each option its own cost factor"), the restructure
 *      request phrased without the per-option term. The "its/their own" clause
 *      is what discriminates a restructure from an analytical question about
 *      each option (which lacks it and is a question anyway — caught by the
 *      caller's analytical guard).
 *
 * Safe-biased like its sibling detectors (`configure-option-intent.ts`,
 * `option-intervention-guard.ts`): a false positive costs one edit-lane turn
 * (the edit LLM clarifies or no-ops — honest recovery), while a false negative
 * is the live four-turn-nothing loop. The caller (route-v2) applies the shared
 * negative gates before dispatching, and the edit lane owns graph presence.
 *
 * NOT a hand-maintained mirror (trap-12): this is a natural-language intent
 * heuristic, the same category as `EDIT_GRAPH_POSITIVE_REGEX` itself, not a
 * list that must stay in sync with a source of truth. The eventual replacement
 * is a typed structural-restructure `Intent` on the wire (S2 vocabulary —
 * absent from 0.22, which carries no structural-restructure member), at which
 * point this heuristic is deleted with a RED-first mutation check, exactly as
 * S2 Phase 4 deletes the other routing mirrors.
 */

export type StructuralRestructureTrigger = 'per_option_term' | 'each_option_own';

export type StructuralRestructureDetection =
  | { readonly matched: true; readonly trigger: StructuralRestructureTrigger }
  | { readonly matched: false };

const NO_MATCH: StructuralRestructureDetection = { matched: false };

/**
 * The per-option modelling term: "per-option", "per option", "option-specific",
 * "option specific". Whole-word / hyphen-or-space tolerant, case-insensitive.
 */
const PER_OPTION_TERM = /\bper[-\s]?option\b|\boption[-\s]?specific\b/i;

/**
 * Restructure / creation verbs. Broad on their own, but only ever consulted
 * ALONGSIDE the per-option term (trigger 1), so "make sense of each option"
 * and other casual uses never reach a match (they carry no per-option term).
 */
const RESTRUCTURE_VERB =
  /\b(?:split|separate|break|duplicat\w*|clon\w*|copy|copies|fork|rewire|divide|convert|turn|make|give|add|create)\b/i;

/**
 * The "each/every/per option ... its/their own …" restructure framing, in
 * either order (the "own" clause may precede or follow the option clause),
 * bounded so the two clauses are in the same sentence-ish span.
 */
const EACH_OPTION_OWN =
  /\b(?:each|every|per)\s+option\b[\s\S]{0,60}\b(?:its|their)\s+own\b|\b(?:its|their)\s+own\b[\s\S]{0,60}\b(?:each|every|per)\s+option\b/i;

/**
 * Detect a free-text structural-restructure intent. Pure and total — never
 * throws; returns a classified skip on any non-match. Text-only: the caller
 * owns graph presence (the edit lane reloads / recovers when no graph is
 * attached) and the shared negative gates.
 */
export function detectStructuralRestructureIntent(
  message: string,
): StructuralRestructureDetection {
  if (typeof message !== 'string' || message.length === 0) return NO_MATCH;
  if (EACH_OPTION_OWN.test(message)) {
    return { matched: true, trigger: 'each_option_own' };
  }
  if (PER_OPTION_TERM.test(message) && RESTRUCTURE_VERB.test(message)) {
    return { matched: true, trigger: 'per_option_term' };
  }
  return NO_MATCH;
}
