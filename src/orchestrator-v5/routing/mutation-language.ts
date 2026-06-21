/**
 * Mutation-language detector — pure regex helper.
 *
 * Returns true when `text` reads as if the speaker is performing a graph
 * mutation ("Proposing to add X", "I'll set Y to 5", "updating the budget").
 * Used by:
 *
 *  1. `validateExplanationAnswer` — Sonnet's `answer_text` for an explanation
 *     handler must NOT sound like an edit. A match marks the answer invalid;
 *     the handler falls through to deterministic fallback.
 *
 *  2. The turn-executor STEP 6 log-only safety check — if a non-edit handler's
 *     final composed `assistant_text` slipped through with mutation language,
 *     emit `v5_mutation_language_guard` telemetry. Detection-only at STEP 6
 *     (no re-compose, no swap).
 *
 * Bias is toward false positives over false negatives. The cost of a false
 * positive on an explanation handler is "use the deterministic fallback" —
 * the user always sees a useful response. The cost of a false negative is
 * the user believing a graph mutation occurred when it did not (the
 * "Proposing to add a competitive response risk factor..." failure observed
 * during manual testing on staging).
 */

const MUTATION_PATTERNS: readonly RegExp[] = [
  // First-person commitments to mutate ("I'll add", "I will update",
  // "I'm going to remove", "I'd like to add", "I would set").
  /\bI(?:'ll|'d like to| would like to|'m going to| am going to| will| would|'d)\s+(add|set|change|update|remove|increase|decrease|adjust)\b/i,
  // "Proposing to ..." constructions.
  /\bproposing to\s+(add|update|change|set|remove|adjust|increase|decrease)\b/i,
  /\bproposed\s+(addition|update|change|removal|adjustment)\b/i,
  // "Adding/updating/removing the X" — actions in progress.
  /\b(adding|updating|removing|setting|changing|adjusting)\s+(the|a|an|this|that|your)\b/i,
  // Suggestions framed as mutations.
  /\bI(?:'d| would) suggest\s+(adding|setting|changing|updating|removing|adjusting)\b/i,
  /\blet me\s+(add|set|change|update|remove|adjust)\b/i,
];

export function containsMutationLanguage(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return MUTATION_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Brief 4 — structural-success-claim detectors + intent-gated honesty gate.
//
// SEPARATE from MUTATION_PATTERNS / containsMutationLanguage above (which feed
// validateExplanationAnswer and the STEP 6.5 monitor — left UNCHANGED).
//
// Two layers (see classifyStructuralClaim):
//   1. NARROW (containsStructuralSuccessClaim): high-precision — a first-person
//      mutation verb anchored to a STRUCTURAL graph noun (option/factor/node/
//      edge/link/connection/relationship/dependency/constraint/driver), plus a
//      direct-object "I updated/changed the graph|model". Swaps UNCONDITIONALLY.
//   2. BROAD (containsBroadStructuralClaimLanguage): any first-person edit verb,
//      actorless "model now includes/has …", or "…between X and Y". Swaps ONLY
//      when the user's turn requested a structural edit (mentionsStructuralEdit-
//      Request); otherwise it is MONITORED, not swapped.
//
// Intent-gating is what lets the broad layer catch noun-less edges ("I connected
// Marketing to Revenue"), verb synonyms ("I introduced an option", "I made a
// connection") and actorless state-now ("your model now includes the Coach
// option") WITHOUT false-declining idioms/people ("connected the dots", "Alice
// with Bob"), grounded read-outs ("model now has four options") or non-graph
// prose ("add a note to the model documentation") — those occur with no edit
// intent, so they pass (or are monitored), never swapped. (#289 would add graph-
// label matching for the rare no-intent residuals.)
// ---------------------------------------------------------------------------

/** Truly-structural graph nouns. Deliberately EXCLUDES the ambiguous
 *  model/graph/diagram/decision, which appear in non-graph prose ("model
 *  documentation", "decision log", "diagram for the presentation"); the
 *  direct-object graph/model edit is handled by its own pattern below. */
const STRUCTURAL_NOUN =
  '(?:option|options|factor|factors|node|nodes|edge|edges|link|links|connection|connections|relationship|relationships|dependency|dependencies|driver|drivers|constraint|constraints)';
/** Apostrophe class: straight + typographic (Sonnet emits either). */
const APOS = "['’]";

const STRUCTURAL_SUCCESS_CLAIM_PATTERNS: readonly RegExp[] = [
  // Future commitment: "I'll add … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}ll| will|${APOS}m going to| am going to|${APOS}m about to| am about to)\\s+(?:go ahead and\\s+)?(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // "let me add … <structural noun>".
  new RegExp(
    `\\blet me\\s+(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // In-progress: "I'm adding … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}m| am)\\s+(?:adding|setting|changing|updating|removing|connecting|creating|wiring|adjusting|linking|deleting|inserting)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // Present-perfect completion: "I've added … <structural noun>", "I've set up a connection".
  new RegExp(
    `\\bI(?:${APOS}ve| have)\\s+(?:added|set|set up|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited|established)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // Simple-past completion: "I added … <structural noun>", "I set up a connection".
  new RegExp(
    `\\bI\\s+(?:added|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited|set up|established)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // Direct-object graph/model edit: "I updated the graph", "I changed the model".
  // The edit verb sits directly on the graph/model, and a negative lookahead
  // excludes compound nouns so "changed the model documentation" / "updated the
  // decision log" / "created a diagram for the presentation" do NOT match.
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am)?\\s+(?:just\\s+|already\\s+)?(?:updated|update|changed|change|edited|edit|modified|modify|revised|revise|rebuilt|rebuild|reworked|rework|redrew|redraw)\\s+(?:the|your)\\s+(?:decision\\s+)?(?:graph|model)\\b(?!\\s+(?:documentation|docs?|log|logs|file|files|approach|strateg(?:y|ies)|version|name|spec|notes?|presentation|template|prompt))`,
    'i',
  ),
];

/**
 * Narrow detector for the enforcing honesty gate (Brief 4). Returns true only
 * when `text` makes a first-person structural success / commitment / completion
 * claim, or asserts the model now reflects a structural change. Conservative:
 * advisory / offer / benign-pronoun phrasing returns false.
 */
export function containsStructuralSuccessClaim(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return STRUCTURAL_SUCCESS_CLAIM_PATTERNS.some((p) => p.test(text));
}

/**
 * Approved honest-decline copy (Brief 4). No em dash, no canvas-capability
 * claim; makes clear the limitation is unsupported STRUCTURAL edits — not the
 * scalar value updates that DO work. Contains none of the E1 success-claim
 * tokens and does not itself trigger `containsStructuralSuccessClaim`
 * (idempotent under re-evaluation).
 */
export const V5_STRUCTURAL_DECLINE_TEXT =
  "I haven't changed the model. This version can't make that kind of model edit yet.";

/**
 * BROAD structural-claim language: any first-person edit verb (incl. synonyms
 * introduce/incorporate/include/make/build/attach/draw), an actorless
 * "model now includes/has …" assertion, or "…between X and Y" edge phrasing.
 * Intentionally broad — NO graph-noun anchor — so it is only safe to SWAP on
 * when GATED by structural-edit intent (see classifyStructuralClaim). Without
 * intent it drives monitor-only telemetry, never a swap. Kept SEPARATE from
 * `containsMutationLanguage` so the explanation-answer validator is unaffected.
 */
const BROAD_STRUCTURAL_CLAIM_PATTERNS: readonly RegExp[] = [
  // First-person edit/structural verb (no noun anchor) — incl. verb synonyms.
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am|${APOS}d| would| just| already)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+|now\\s+)?(?:add(?:ed|ing)?|creat(?:e|ed|ing)|connect(?:ed|ing)?|link(?:ed|ing)?|wir(?:e|ed|ing)|join(?:ed|ing)?|insert(?:ed|ing)?|introduc(?:e|ed|ing)|incorporat(?:e|ed|ing)|includ(?:e|ed|ing)|made|make|making|built|build|building|attach(?:ed|ing)?|establish(?:ed|ing)?|set up|updat(?:e|ed|ing)|chang(?:e|ed|ing)|edit(?:ed|ing)?|modif(?:y|ied|ying)|remov(?:e|ed|ing)|delet(?:e|ed|ing)|drew|draw(?:ing)?)\\b`,
    'i',
  ),
  // Actorless state-now success assertion ("your model now includes/has …").
  new RegExp(
    `\\b(?:your\\s+|the\\s+)?(?:model|graph|decision)\\s+now\\s+(?:includes|contains|has|features|shows|reflects)\\b`,
    'i',
  ),
  // Edge relation phrasing with an edit verb: "connected … between X and Y".
  new RegExp(
    `\\b(?:connect|connected|connecting|link|linked|linking|wir(?:e|ed|ing)|join(?:ed|ing)?|draw|drew)\\b[^.!?]*\\bbetween\\b[^.!?]*\\band\\b`,
    'i',
  ),
];

/** True when text uses BROAD structural-claim language (see above). */
export function containsBroadStructuralClaimLanguage(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return BROAD_STRUCTURAL_CLAIM_PATTERNS.some((p) => p.test(text));
}

/**
 * STRUCTURAL-EDIT INTENT in the USER's message — did the user ask to add /
 * connect / remove a graph element this turn? This gate is what makes the BROAD
 * detector safe to swap on. Scoped to STRUCTURAL edits (add/remove/connect
 * nodes/options/factors/edges); scalar value edits ("set the budget to 5") are
 * deliberately excluded — they have working handlers and mutate the graph.
 */
const STRUCTURAL_EDIT_REQUEST_PATTERNS: readonly RegExp[] = [
  // edit verb (any inflection) + structural noun: "add an option", "adding a
  // factor", "remove the churn factor", "can you connect the two nodes".
  new RegExp(
    `\\b(?:add(?:ing|ed)?|creat(?:e|es|ing|ed)|insert(?:s|ing|ed)?|introduc(?:e|es|ing|ed)|incorporat(?:e|es|ing|ed)|includ(?:e|es|ing|ed)|connect(?:s|ing|ed)?|link(?:s|ing|ed)?|wir(?:e|es|ing|ed)|join(?:s|ing|ed)?|attach(?:es|ing|ed)?|remov(?:e|es|ing|ed)|delet(?:e|es|ing|ed)|drop(?:s|ping|ped)?|renam(?:e|es|ing|ed)|rewir(?:e|es|ing|ed)|hook(?:s|ing|ed)? up)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b`,
    'i',
  ),
  // "a new <structural noun>".
  new RegExp(`\\b(?:a |an |another )?new\\s+${STRUCTURAL_NOUN}\\b`, 'i'),
  // edge request without a noun: "connect X to Y", "link A and B".
  /\b(?:connect(?:s|ing|ed)?|link(?:s|ing|ed)?|wir(?:e|es|ing|ed)|join(?:s|ing|ed)?)\b[^.?!]*\b(?:to|with|between)\b/i,
];

/** True when the user's message requests a STRUCTURAL graph edit this turn. */
export function mentionsStructuralEditRequest(userMessage: string | null | undefined): boolean {
  if (typeof userMessage !== 'string' || userMessage.length === 0) return false;
  return STRUCTURAL_EDIT_REQUEST_PATTERNS.some((p) => p.test(userMessage));
}

/** Gate verdict + a bounded telemetry kind (no raw text). */
export type StructuralClaimVerdict = 'swap' | 'monitor' | 'pass';
export type StructuralClaimKind =
  | 'none'
  | 'high_confidence'
  | 'intent_gated'
  | 'broad_no_intent'
  | 'mutation_language';
export interface StructuralClaimDecision {
  readonly verdict: StructuralClaimVerdict;
  readonly kind: StructuralClaimKind;
}

export interface ClassifyStructuralClaimInput {
  readonly assistantText: string | null | undefined;
  /** True when a handler emitted a post-mutation graph this turn. */
  readonly handlerEmittedMutatedGraph: boolean;
  /** The proposed/dispatched handler id (turn-executor `proposedHandlerIdForOutcome`). */
  readonly proposedHandlerId: string | null;
  /** True when the user's message this turn requested a structural graph edit. */
  readonly structuralEditIntent?: boolean;
}

/**
 * Decide whether the composed assistant text needs the honesty swap.
 *
 * "No mutation occurred" MIRRORS buildTurnOutcome's canonical
 * `handlerEmittedMutatedGraph || isDraftOrEditGraph`, from raw signals at the
 * swap site. NO handler_id skip (the E1 failure committed handler_id === null).
 *
 *  - swap/high_confidence : narrow first-person + structural-noun claim.
 *  - swap/intent_gated    : user requested a structural edit AND broad
 *                           structural-success language is present.
 *  - monitor/broad_no_intent  : broad structural language, no edit intent →
 *                               candidate false-negative (no swap).
 *  - monitor/mutation_language: legacy broad mutation language only.
 *  - pass                 : a mutation committed, or no claim / benign.
 */
export function classifyStructuralClaim(input: ClassifyStructuralClaimInput): StructuralClaimDecision {
  const { assistantText, handlerEmittedMutatedGraph, proposedHandlerId, structuralEditIntent } = input;
  if (typeof assistantText !== 'string' || assistantText.length === 0) return { verdict: 'pass', kind: 'none' };
  const isDraftOrEditGraph =
    proposedHandlerId === 'draft_graph' || proposedHandlerId === 'edit_graph';
  if (handlerEmittedMutatedGraph || isDraftOrEditGraph) return { verdict: 'pass', kind: 'none' };
  if (containsStructuralSuccessClaim(assistantText)) return { verdict: 'swap', kind: 'high_confidence' };
  const broad = containsBroadStructuralClaimLanguage(assistantText);
  if (broad && structuralEditIntent === true) return { verdict: 'swap', kind: 'intent_gated' };
  if (broad) return { verdict: 'monitor', kind: 'broad_no_intent' };
  if (containsMutationLanguage(assistantText)) return { verdict: 'monitor', kind: 'mutation_language' };
  return { verdict: 'pass', kind: 'none' };
}
