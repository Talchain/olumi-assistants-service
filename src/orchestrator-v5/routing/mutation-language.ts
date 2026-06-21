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

/** UNAMBIGUOUS structural graph nouns — the ONLY nouns that enforce a swap.
 *  Excludes model/graph/diagram/decision (non-graph prose: "model
 *  documentation", "decision log") AND the ambiguous edge nouns
 *  link/connection/relationship/dependency ("I created a link to the
 *  documentation", "I established a connection with the team", "between Alice
 *  and Bob"). Those edge nouns can't be told from ordinary language without
 *  graph labels, so they are monitor-only and deferred to #289 (review round 7);
 *  the rail no longer references them. */
const STRUCTURAL_NOUN =
  '(?:option|options|factor|factors|node|nodes|edge|edges|driver|drivers|constraint|constraints)';
/** Apostrophe class: straight + typographic (Sonnet emits either). */
const APOS = "['’]";

/** Non-graph artefacts a structural noun may belong to — "model documentation",
 *  "an option to the presentation", "the decision log". Used to EXCLUDE such
 *  prose CONSISTENTLY across the narrow, intent and graph/model patterns (review
 *  round 7). */
const NON_GRAPH_CONTEXT =
  '(?:presentation|slides?|deck|decks|email|emails|e-mail|doc|docs|document|documents|documentation|report|reports|write-?up|notes?|notebook|agenda|meeting|minutes|spec|specs|readme|wiki|page|pages|chat|conversation|thread|ticket|backlog|roadmap|log|logs|file|files|approach|strateg(?:y|ies)|version|versions|name|names|template|templates|prompt|prompts)';
/** "<graph|model> <non-graph word>" compound — e.g. "the model documentation". */
const NON_GRAPH_COMPOUND = `(?!\\s+${NON_GRAPH_CONTEXT}\\b)`;
/** "<noun> to/in/for [the] <non-graph word>" — e.g. "an option to the presentation". */
const NON_GRAPH_PP = `(?!\\s+(?:to|in|for|on|of|into|onto)\\s+(?:the\\s+|a\\s+|an\\s+|my\\s+|our\\s+|your\\s+|this\\s+|that\\s+)?${NON_GRAPH_CONTEXT}\\b)`;

const STRUCTURAL_SUCCESS_CLAIM_PATTERNS: readonly RegExp[] = [
  // Future commitment: "I'll add … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}ll| will|${APOS}m going to| am going to|${APOS}m about to| am about to)\\s+(?:go ahead and\\s+)?(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // "let me add … <structural noun>".
  new RegExp(
    `\\blet me\\s+(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // In-progress: "I'm adding … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}m| am)\\s+(?:adding|setting|changing|updating|removing|connecting|creating|wiring|adjusting|linking|deleting|inserting)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Present-perfect completion: "I've added … <structural noun>", "I've set up a connection".
  new RegExp(
    `\\bI(?:${APOS}ve| have)\\s+(?:added|set|set up|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited|established)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Simple-past completion: "I added … <structural noun>", "I set up a connection".
  new RegExp(
    `\\bI\\s+(?:added|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited|set up|established)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Direct-object graph/model edit: "I updated the graph", "I changed the model".
  // The edit verb sits directly on the graph/model, and a negative lookahead
  // excludes compound nouns so "changed the model documentation" / "updated the
  // decision log" / "created a diagram for the presentation" do NOT match.
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am)?\\s+(?:just\\s+|already\\s+)?(?:updated|update|changed|change|edited|edit|modified|modify|revised|revise|rebuilt|rebuild|reworked|rework|redrew|redraw)\\s+(?:the|your)\\s+(?:decision\\s+)?(?:graph|model)\\b${NON_GRAPH_COMPOUND}`,
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
  // NB: "I'd / I would" is deliberately EXCLUDED — conditional advice ("I would
  // add a factor if …", "I'd add another option if you wanted") is not a success
  // claim; it falls to monitor via containsMutationLanguage, never a swap.
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am| just| already)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+|now\\s+)?(?:add(?:ed|ing)?|creat(?:e|ed|ing)|connect(?:ed|ing)?|link(?:ed|ing)?|wir(?:e|ed|ing)|join(?:ed|ing)?|insert(?:ed|ing)?|introduc(?:e|ed|ing)|incorporat(?:e|ed|ing)|includ(?:e|ed|ing)|made|make|making|built|build|building|attach(?:ed|ing)?|establish(?:ed|ing)?|set up|updat(?:e|ed|ing)|chang(?:e|ed|ing)|edit(?:ed|ing)?|modif(?:y|ied|ying)|remov(?:e|ed|ing)|delet(?:e|ed|ing)|drew|draw(?:ing)?)\\b`,
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
  // Passive structural success (review rounds 6/7): "the option has been added",
  // "the factor has been changed", "the option was updated". Scoped to the
  // UNAMBIGUOUS structural noun set (edge nouns are deferred to #289); the
  // participle list covers add/create AND change/update/modify/edit. Broad →
  // only swaps under structural-edit intent, so non-graph passives ("the note
  // has been added") never match.
  new RegExp(
    `\\b(?:the|a|an|your|this|that|another)\\s+(?:new\\s+)?${STRUCTURAL_NOUN}\\s+(?:(?:has|have)\\s+(?:now\\s+)?been|was|were|is\\s+now|are\\s+now)\\s+(?:added|created|connected|inserted|established|set\\s+up|wired|linked|removed|deleted|introduced|incorporated|included|changed|updated|modified|edited|rewired|revised|reworked|adjusted|put\\s+in\\s+place|in\\s+place)\\b`,
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
  // edit verb (any inflection, incl. edit/change/update/modify/set up/establish)
  // + UNAMBIGUOUS structural noun: "add an option", "remove the churn factor",
  // "connect the two nodes", "edit the constraint". (Edge nouns need relational
  // framing — see pattern 4.)
  new RegExp(
    `\\b(?:add(?:ing|ed)?|creat(?:e|es|ing|ed)|insert(?:s|ing|ed)?|introduc(?:e|es|ing|ed)|incorporat(?:e|es|ing|ed)|includ(?:e|es|ing|ed)|connect(?:s|ing|ed)?|link(?:s|ing|ed)?|wir(?:e|es|ing|ed)|join(?:s|ing|ed)?|attach(?:es|ing|ed)?|remov(?:e|es|ing|ed)|delet(?:e|es|ing|ed)|drop(?:s|ping|ped)?|renam(?:e|es|ing|ed)|rewir(?:e|es|ing|ed)|hook(?:s|ing|ed)? up|edit(?:s|ing|ed)?|chang(?:e|es|ing|ed)|updat(?:e|es|ing|ed)|modif(?:y|ies|ying|ied)|set up|establish(?:es|ing|ed)?)\\b[^.?!]*\\b${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // "a new <structural noun>".
  new RegExp(`\\b(?:a |an |another )?new\\s+${STRUCTURAL_NOUN}\\b`, 'i'),
  // edit verb directly on the graph/model: "update the model", "edit the graph",
  // "change the decision model". The non-graph compound guard excludes
  // "the model documentation" / "the model presentation" (review round 7).
  new RegExp(
    `\\b(?:edit(?:s|ing|ed)?|chang(?:e|es|ing|ed)|updat(?:e|es|ing|ed)|modif(?:y|ies|ying|ied)|revis(?:e|es|ing|ed)|rebuild|rebuilt|rework(?:s|ing|ed)?|redraw|redrew|adjust(?:s|ing|ed)?)\\b[^.?!]*\\b(?:the|your|this|my|our)\\s+(?:decision\\s+)?(?:graph|model)\\b${NON_GRAPH_COMPOUND}`,
    'i',
  ),
  // NB (review round 7): the edge-noun "…between X and Y" intent pattern was
  // REMOVED. "between Alice and Bob" / "between the release notes and the
  // documentation" are not graph edges, and "between … and" (or "from … to")
  // can't tell graph labels from ordinary language at this seam. Ambiguous edge
  // nouns (link/connection/relationship/dependency) are therefore monitor-only
  // until #289 supplies graph-label context. The noun-less "connect X to Y"
  // pattern stays removed for the same reason.
];

/**
 * STATE / READ-OUT questions that ASK whether an edit already happened — these
 * must NOT count as a request to perform an edit ("Did you add an option?",
 * "Have you added a factor?", "Did you update the model?", "Is the option now
 * included?"). Request-shaped questions ("Can you add an option?", "Could you
 * change …", "Please update the model") do not match these.
 */
const STRUCTURAL_STATE_QUERY_PATTERNS: readonly RegExp[] = [
  /\b(?:did|do|does)\s+(?:you|we|it|i|the|that|this|your|my|our|its|their|his|her)\b/i,
  /\b(?:have|has)\s+(?:you|we|i|it|the|that|this|your|my|our|its|their|his|her)\b/i,
  /\b(?:is|are|was|were)\b[^.?!]*\b(?:now|already)\b/i,
  /\b(?:was|were)\b[^.?!]*\b(?:added|created|connected|updated|changed|included|removed|made|linked|wired|modified|inserted|attached|established)\b/i,
];

/** True when the user's message requests a STRUCTURAL graph edit this turn. */
export function mentionsStructuralEditRequest(userMessage: string | null | undefined): boolean {
  if (typeof userMessage !== 'string' || userMessage.length === 0) return false;
  // A read-out/state question ("did you add …?") is not a request to edit.
  if (STRUCTURAL_STATE_QUERY_PATTERNS.some((p) => p.test(userMessage))) return false;
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
