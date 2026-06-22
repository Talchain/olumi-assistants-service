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
// Brief 4 — structural-success-claim honesty gate. PRECISION-FIRST (final
// contract). Delivers ONE trust guarantee: never tell the user the model changed
// when no durable mutation committed — without false-declining ordinary replies.
//
// SEPARATE from MUTATION_PATTERNS / containsMutationLanguage above (which feed
// validateExplanationAnswer and the STEP 6.5 monitor — left UNCHANGED).
//
// SWAP (decline) fires on ONE thing only: a TIGHTLY-BOUND, unambiguous first-
// person COMPLETION / near-future assertion whose OBJECT is a structural graph
// noun (option/factor/node/edge/driver/constraint) or the graph/model itself —
// see containsStructuralSuccessClaim. "Tightly bound" = the structural noun is
// the verb's direct object (TIGHT_TO_NOUN), not something reached across a
// preposition / relative / idiom ("connected the dots ON the churn factor").
//
// EVERYTHING ELSE IS MONITOR-ONLY telemetry, never a swap — and is owned by the
// durable follow-ups (#288 typed edits + composer contract; #289 graph-label
// context): broad first-person edit verbs without a bound object, passive /
// actorless claims ("the option has been added", "your model now includes …"),
// ambiguous edge nouns (link/connection/relationship/dependency), desire /
// intent / conditional forms ("I want to add", "I would add … if …"), and legacy
// mutation language. Structural-edit INTENT does NOT drive a swap: a false
// decline is a visible trust failure on every occurrence, whereas a missed
// broad/edge claim is observable here and cured upstream. Rationale: a text-only
// detector cannot be both complete and precise, so on the deterministic path we
// choose PRECISION (bias to never false-decline) and let the monitor + #288/#289
// carry recall.
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
/** Ambiguous edge nouns — never enforced (no text discriminator). Used only by
 *  the MONITOR-ONLY ambiguous-edge candidate path so passive edge claims still
 *  produce telemetry while enforcement is deferred to #289 (review round 8). */
const EDGE_NOUN =
  '(?:link|links|connection|connections|relationship|relationships|dependency|dependencies)';
/** Apostrophe class: straight + typographic (Sonnet emits either). */
const APOS = "['’]";

/** Non-graph artefacts a structural noun may belong to — "model documentation",
 *  "an option to the presentation", "the decision log". Used to EXCLUDE such
 *  prose CONSISTENTLY across the narrow, intent and graph/model patterns. */
const NON_GRAPH_CONTEXT =
  '(?:presentation|slides?|deck|decks|email|emails|e-mail|doc|docs|document|documents|documentation|report|reports|write-?up|notes?|notebook|agenda|meeting|minutes|spec|specs|readme|wiki|page|pages|chat|conversation|thread|ticket|backlog|roadmap|log|logs|file|files|approach|strateg(?:y|ies)|version|versions|name|names|template|templates|prompt|prompts|section|sections|portion|portions|column|columns|proposal|proposals|spreadsheet|spreadsheets|dashboard|dashboards|appendix|briefing|briefings|changelog|changelogs|methodology)';
/** "<graph|model>['s] <non-graph word>" compound — "the model documentation",
 *  "the model's documentation" (review round 8: possessive form). */
const NON_GRAPH_COMPOUND = `(?!(?:${APOS}s)?\\s+${NON_GRAPH_CONTEXT}\\b)`;
/** A GRAPH destination — "to/in/into/onto the model/graph/goal/factor/option/…".
 *  (Deliberately NOT "for"/"on": "for the model review" must not read as a graph
 *  anchor.) When present, the claim IS a graph edit even if a non-graph PURPOSE
 *  also appears ("add the Pricing option to your model for the presentation",
 *  where "for the presentation" would otherwise exclude it) — review round 9. */
const GRAPH_DEST =
  '(?:to|in|into|onto)\\s+(?:the\\s+|your\\s+|my\\s+|our\\s+|this\\s+|that\\s+|a\\s+|an\\s+)?(?:model|graph|diagram|map|decision\\s+(?:model|graph)|goal|goals|option|options|factor|factors|node|nodes|edge|edges|driver|drivers|constraint|constraints)\\b';
/** "<noun> … to/in/for [the] <non-graph word>" ANYWHERE in the clause — e.g.
 *  "an option to the presentation", "an option called \"Draft\" to the
 *  presentation". A GRAPH destination anywhere in the clause OVERRIDES the
 *  exclusion (graph edit with a presentation purpose still enforces). */
const NON_GRAPH_PP = `(?:(?=[^.?!]*\\b${GRAPH_DEST})|(?![^.?!]*\\b(?:to|in|for|on|of|into|onto|within|under|with|inside)\\s+(?:the\\s+|a\\s+|an\\s+|my\\s+|our\\s+|your\\s+|this\\s+|that\\s+)?${NON_GRAPH_CONTEXT}\\b))`;
/** Shared passive participle list — kept identical for structural and ambiguous-
 *  edge passives so they cannot drift (review round 9). */
const PASSIVE_DONE =
  '(?:added|created|connected|inserted|established|set\\s+up|wired|linked|removed|deleted|introduced|incorporated|included|changed|updated|modified|edited|rewired|revised|reworked|reconfigured|restructured|redrawn|reconnected|rearranged|reorganized|reorganised|adjusted|put\\s+in\\s+place|in\\s+place)';
/** Shared first-person edit-verb list (active, any inflection) for edge claims. */
const EDGE_EDIT_VERB =
  '(?:add(?:ed|ing)?|creat(?:e|ed|ing)|connect(?:ed|ing)?|link(?:ed|ing)?|wir(?:e|ed|ing)|rewir(?:e|ed|ing)|join(?:ed|ing)?|insert(?:ed|ing)?|introduc(?:e|ed|ing)|incorporat(?:e|ed|ing)|includ(?:e|ed|ing)|made|make|making|built|build|building|attach(?:ed|ing)?|establish(?:ed|ing)?|set up|updat(?:e|ed|ing)|chang(?:e|ed|ing)|edit(?:ed|ing)?|modif(?:y|ied|ying)|remov(?:e|ed|ing)|delet(?:e|ed|ing)|revis(?:e|ed|ing)|rework(?:s|ed|ing)?|adjust(?:s|ed|ing)?|drew|draw(?:ing)?)';

/** Shared base-form edit-verb list for the future ("I'll …") and "let me …"
 *  narrow patterns — kept IDENTICAL so they cannot drift (the round-9 leak was
 *  rewire/revise/rework reaching the "I'll" list but not the "let me" list). */
const STRUCT_EDIT_VERB_BASE =
  '(?:add|set|change|update|remove|connect|create|wire|rewire|adjust|modify|revise|rework|reconfigure|restructure|reorganize|reorganise|redraw|hook up|link|delete|insert)';
/** Optional adverb/lead phrase between the subject and the verb — "I'll JUST add",
 *  "let me NOW connect", "I have NOW added", "I WENT AHEAD AND added". Shared so a
 *  benign adverb can't slip a real first-person claim past the gate (adversarial
 *  sweep, round 9). Closed set — does not weaken the structural-noun anchor. */
const LEAD_ADVERB =
  '(?:(?:go ahead and|gone ahead and|went ahead and|just|now|quickly|also|then|already|finally|simply)\\s+)?';
/** First-person ASSERTIVE near-future commitment subjects — the action is
 *  asserted to be happening / about to happen ("I'll", "I will", "I'm going to",
 *  "I'm gonna", "I'm about to"). DESIRE / INTENT / CONDITIONAL forms ("I want to",
 *  "I plan to", "I'd like to", "I would add … if …") are DELIBERATELY EXCLUDED:
 *  they assert a wish, not a completed/committed change, so they must never swap
 *  unconditionally (they are monitor-only — see classifyStructuralClaim). */
const FUTURE_SUBJECT = `\\bI(?:${APOS}ll| will|${APOS}m going to| am going to|${APOS}m gonna| am gonna|${APOS}m about to| am about to)`;

/** Words that END a noun phrase / signal the structural noun is NOT the verb's
 *  direct object — prepositions, object pronouns and relative/connective markers.
 *  Used to keep the verb→noun binding TIGHT (precision-first contract): the
 *  structural noun must be the verb's object, not something reached across a
 *  prepositional / relative / idiomatic phrase. This is what stops
 *  "connected the dots ON the churn factor" and "connected you WITH the analyst
 *  who owns the Coach option" from false-declining — the object is "dots" / "you",
 *  not the trailing structural noun. */
const NP_BOUNDARY =
  '(?:to|in|on|of|for|with|from|at|by|between|into|onto|about|around|over|under|within|inside|across|through|against|toward|towards|you|me|us|him|her|them|it|together|back|why|how|what|when|where|who|whom|whose|which|that|so|after|before|while|because|although|though|if|unless|since|until)';
/** TIGHTLY-BOUND gap from an edit verb to its structural-noun OBJECT: an optional
 *  determiner, then a bounded run of modifier words (adjectives / a quoted option
 *  label) that are NOT noun-phrase boundaries. Replaces the old clause-spanning
 *  `[^.?!]*`, which bound verbs to distant nouns and caused the idiom/social
 *  false-decline class. A quoted label ("…") counts as one modifier so the E1
 *  capture `add the "Coach … into … Role" option` still binds. */
const TIGHT_TO_NOUN =
  `\\s+(?:(?:a|an|the|your|our|my|its|their|this|that|another|one|some|new|each|several|two|three|four|\\d+)\\s+)?` +
  `(?:"[^"]*"\\s+|“[^”]*”\\s+|(?!${NP_BOUNDARY}\\b)[A-Za-z][\\w’'-]+\\s+){0,6}?`;

/** Graph/model edit verbs, DONE forms (past / perfect / in-progress) → completion. */
const GRAPH_VERB_DONE =
  '(?:updated|updating|changed|changing|edited|editing|modified|modifying|revised|revising|rewired|rewiring|rebuilt|rebuilding|reworked|reworking|redrew|redrawn|redrawing|restructured|restructuring|reconfigured|reconfiguring|reorganized|reorganised|reorganizing|reorganising)';
/** Graph/model edit verbs, BASE forms → future commitment. */
const GRAPH_VERB_BASE =
  '(?:update|change|edit|modify|revise|rewire|rebuild|rework|redraw|restructure|reconfigure|reorganize|reorganise)';

/**
 * COMPLETION claims — a structural change is asserted as DONE or in progress
 * ("I added a factor", "I've changed the option", "I'm adding a node", "I updated
 * the model"). A completion is NEVER conditional (you cannot conditionally have
 * already done something), so these swap whenever asserted — evaluated on the
 * whole text. Tight binding (TIGHT_TO_NOUN / direct graph-model object) keeps a
 * match from spanning a clause, so a completion is detected even when a later
 * conditional offer shares the sentence ("I added a factor, I'll explain if you
 * want." / "I added a factor — I'll add another if you confirm.").
 */
const COMPLETION_CLAIM_PATTERNS: readonly RegExp[] = [
  // In-progress: "I'm adding … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}m| am)\\s+${LEAD_ADVERB}(?:adding|setting|changing|updating|removing|connecting|creating|wiring|rewiring|adjusting|revising|reworking|modifying|editing|establishing|linking|deleting|inserting)${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Present-perfect: "I've added … <structural noun>".
  new RegExp(
    `\\bI(?:${APOS}ve| have)\\s+${LEAD_ADVERB}(?:added|set|set up|created|connected|updated|removed|changed|wired|rewired|modified|revised|reworked|reconfigured|restructured|redrawn|reconnected|rearranged|reorganized|reorganised|adjusted|linked|deleted|inserted|edited|established)${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Simple-past: "I added … <structural noun>", "I went ahead and added a factor".
  new RegExp(
    `\\bI\\s+${LEAD_ADVERB}(?:added|created|connected|updated|removed|changed|wired|rewired|modified|revised|reworked|reconfigured|restructured|redrew|reconnected|rearranged|reorganized|reorganised|adjusted|linked|deleted|inserted|edited|set up|established)${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Direct-object graph/model completion: "I updated the graph", "I've changed the
  // model", "I'm reworking the model". DONE verb forms + a non-future subject. The
  // compound guard excludes "changed the model documentation" / "the decision log".
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}m| am)?\\s+${LEAD_ADVERB}${GRAPH_VERB_DONE}\\s+(?:the|your)\\s+(?:decision\\s+)?(?:graph|model)\\b${NON_GRAPH_COMPOUND}`,
    'i',
  ),
];

/**
 * COMMITMENT claims — a FUTURE / offer to make a structural change ("I'll add a
 * factor", "let me add the option", "I'll update the model"). Unlike completions,
 * a commitment CAN be a conditional offer, so the gate swaps it only when it is
 * NOT governed by a condition (see containsStructuralSuccessClaim, per proposition).
 */
const COMMITMENT_CLAIM_PATTERNS: readonly RegExp[] = [
  // Future commitment: "I'll add / I'm going to add … <structural noun>".
  new RegExp(
    `${FUTURE_SUBJECT}\\s+${LEAD_ADVERB}${STRUCT_EDIT_VERB_BASE}${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // "let me add … <structural noun>" (incl. "let me go ahead and / just / now …").
  new RegExp(
    `\\blet me\\s+${LEAD_ADVERB}${STRUCT_EDIT_VERB_BASE}${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // Future direct-object graph/model edit: "I'll update the graph", "let me rework
  // the model". BASE verb forms + a future subject.
  new RegExp(
    `(?:${FUTURE_SUBJECT}|\\blet me)\\s+${LEAD_ADVERB}${GRAPH_VERB_BASE}\\s+(?:the|your)\\s+(?:decision\\s+)?(?:graph|model)\\b${NON_GRAPH_COMPOUND}`,
    'i',
  ),
];


/** A conditional clause — a condition conjunction + its subject. The subject is
 *  GENERAL (a pronoun OR any noun phrase: "if you", "if the team approves", "when
 *  approval comes through", "once scoping is done"), not a finite allow-list. */
const CONDITION_CLAUSE =
  '\\b(?:once|after|when|if|unless|provided|assuming|pending|as soon as|should)\\s+' +
  '(?:the\\s+|a\\s+|an\\s+|your\\s+|our\\s+|their\\s+|this\\s+|that\\s+|my\\s+)?' +
  "(?:you|we|they|i|he|she|it|[A-Za-z][\\w'-]+)\\b";
/** A first-person FUTURE / offer commitment ("I'll", "I will", "I can/could",
 *  "I'm going to", "let me"). A future commitment GOVERNED by a condition — in
 *  EITHER order ("once you confirm, I'll add a factor" / "I'll add a factor once
 *  you confirm") — is an OFFER, not a completed change, and must be preserved.
 *  Past completions ("I added a factor"; "when you asked, I added …") are NOT
 *  future commitments, so they are unaffected. */
const FUTURE_COMMIT = `(?:\\bI(?:${APOS}ll| will| can| could| would|${APOS}m going to| am going to|${APOS}m gonna| am gonna|${APOS}m about to| am about to)|\\blet me)`;
const CONDITIONAL_OFFER = new RegExp(
  `${CONDITION_CLAUSE}[^.?!;]*${FUTURE_COMMIT}|${FUTURE_COMMIT}[^.?!;]*${CONDITION_CLAUSE}`,
  'i',
);

/** Proposition boundary for the COMMITMENT pass: sentence punctuation / `;` / `:`,
 *  an em/en dash or a spaced hyphen (clause dashes), OR a clause-level coordinator
 *  (and/but/or/…) that introduces a NEW clause — detected by a following
 *  clause-starter ("I", a condition conjunction, or a subject/article). This
 *  separates an unconditional commitment from a sibling conditional offer ("I'll
 *  add a factor, and I'll explain if you want" → two propositions), WITHOUT
 *  splitting verb/noun coordination ("add or remove an option", "risk and reward
 *  factor") or breaking a prefix condition from its claim ("once you confirm, I'll
 *  add a factor" — the comma there has no coordinator, so it is NOT a boundary). */
const PROPOSITION_SPLIT =
  /[.?!;:]+(?=\s|$)|\s*[—–]\s*|\s+-\s+|,?\s+(?:and|but|or|nor|yet|so|then|plus)\s+(?=(?:I['’]|I\s|if\b|once\b|when\b|after\b|unless\b|provided\b|assuming\b|should\b|you\b|we\b|they\b|it\b|the\b|this\b|that\b|your\b|our\b|let me\b))/i;

/**
 * Narrow detector for the enforcing honesty gate (Brief 4). Returns true only
 * when `text` makes a TIGHTLY-BOUND first-person structural claim on a graph
 * object. Conservative by contract: advisory, offer, conditional, idiom, social
 * and non-graph phrasing returns false (monitor-only).
 *
 * Two-pass, because the two claim types relate to conditions differently:
 *  1. COMPLETION ("I added/updated …"): a finished/in-progress change is NEVER
 *     conditional, so it swaps whenever asserted ANYWHERE — robust to any
 *     separator that might join it to a later conditional offer. Tight binding
 *     keeps the match within a clause, so this cannot over-reach.
 *  2. COMMITMENT ("I'll add …", "let me add …"): a future offer CAN be
 *     conditional, so it is checked PER PROPOSITION and suppressed only when that
 *     proposition is a conditional offer (prefix or suffix).
 */
export function containsStructuralSuccessClaim(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  // Pass 1 — completions are unconditional; a single match anywhere is enough.
  if (COMPLETION_CLAIM_PATTERNS.some((p) => p.test(text))) return true;
  // Pass 2 — commitments swap only when NOT a conditional offer in their proposition.
  for (const proposition of text.split(PROPOSITION_SPLIT)) {
    if (!proposition || !proposition.trim()) continue;
    if (CONDITIONAL_OFFER.test(proposition)) continue; // this proposition is an offer, not a commitment
    if (COMMITMENT_CLAIM_PATTERNS.some((p) => p.test(proposition))) return true;
  }
  return false;
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
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am| just| already)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+|went ahead and\\s+|now\\s+|quickly\\s+)?(?:add(?:ed|ing)?|creat(?:e|ed|ing)|connect(?:ed|ing)?|link(?:ed|ing)?|wir(?:e|ed|ing)|rewir(?:e|ed|ing)|join(?:ed|ing)?|insert(?:ed|ing)?|introduc(?:e|ed|ing)|incorporat(?:e|ed|ing)|includ(?:e|ed|ing)|made|make|making|built|build|building|attach(?:ed|ing)?|establish(?:ed|ing)?|set up|updat(?:e|ed|ing)|chang(?:e|ed|ing)|edit(?:ed|ing)?|modif(?:y|ied|ying)|revis(?:e|ed|ing)|rework(?:s|ed|ing)?|reconfigur(?:e|ed|ing)|restructur(?:e|ed|ing)|reorganiz(?:e|ed|ing)|reorganis(?:e|ed|ing)|redraw(?:s|n|ing)?|redrew|remov(?:e|ed|ing)|delet(?:e|ed|ing)|drew|draw(?:ing)?)\\b`,
    'i',
  ),
  // Actorless state-now success assertion ("your model now includes/has …" AND the
  // "now your model has/includes …" word order — adversarial sweep, round 9).
  new RegExp(
    `\\b(?:(?:your\\s+|the\\s+)?(?:model|graph|decision)\\s+now|now\\s+(?:your\\s+|the\\s+)?(?:model|graph|decision))\\s+(?:includes|contains|has|have|features|shows|reflects)\\b`,
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
    `\\b(?:the|a|an|your|this|that|another|two|three|four|five|both|several|multiple|\\d+)\\s+(?:new\\s+)?(?:[A-Za-z][\\w’'-]*\\s+){0,4}?${STRUCTURAL_NOUN}\\s+(?:(?:has|have)\\s+(?:(?:now|both|also|recently|since|just)\\s+)?been|was|were|is\\s+now|are\\s+now)\\s+${PASSIVE_DONE}\\b`,
    'i',
  ),
  // Passive graph/model edit ("the model has been restructured", "the decision
  // graph was redrawn"). Compound guard excludes "the model documentation has …".
  new RegExp(
    `\\b(?:the|your|this|that)\\s+(?:decision\\s+)?(?:graph|model)\\b${NON_GRAPH_COMPOUND}\\s+(?:(?:has|have)\\s+(?:(?:now|recently|since|just)\\s+)?been|was|were|is\\s+now|are\\s+now)\\s+${PASSIVE_DONE}\\b`,
    'i',
  ),
];

/** True when text uses BROAD structural-claim language (see above). */
export function containsBroadStructuralClaimLanguage(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return BROAD_STRUCTURAL_CLAIM_PATTERNS.some((p) => p.test(text));
}

/**
 * MONITOR-ONLY ambiguous-edge detector. Edge nouns (link/connection/
 * relationship/dependency) are not enforced (no text discriminator — "between
 * Alice and Bob"), but a success-shaped edge claim must still produce candidate
 * telemetry while enforcement is deferred to #289. Covers BOTH passive ("the
 * relationship has been changed/rewired/revised") and first-person active ("I
 * rewired the relationship", "I revised the connection") forms — using the same
 * shared verb/participle lists as the enforcing patterns so coverage cannot
 * drift (review round 9). NEVER feeds the swap path.
 */
const AMBIGUOUS_EDGE_CLAIM_PATTERNS: readonly RegExp[] = [
  // Passive: "the relationship has been changed", "a connection was revised",
  // "the dependency between Pricing and Demand has been removed" (qualifier
  // between the edge noun and the auxiliary). Monitor-only, so the loose
  // qualifier carries no swap risk.
  new RegExp(
    `\\b(?:the|a|an|your|this|that|another)\\s+(?:new\\s+)?${EDGE_NOUN}\\s+(?:[A-Za-z][\\w’'-]*\\s+){0,6}?(?:(?:has|have)\\s+(?:(?:now|both|also|recently|since|just)\\s+)?been|was|were|is\\s+now|are\\s+now)\\s+${PASSIVE_DONE}\\b`,
    'i',
  ),
  // First-person active: "I rewired the relationship", "I revised the connection".
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+)?${EDGE_EDIT_VERB}\\b[^.!?]*\\b${EDGE_NOUN}\\b`,
    'i',
  ),
];

/** Monitor-only: a success-shaped (passive or first-person) ambiguous-edge claim. */
export function looksLikeAmbiguousEdgeClaim(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return AMBIGUOUS_EDGE_CLAIM_PATTERNS.some((p) => p.test(text));
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
  // "connect the two nodes", "edit the constraint". Ambiguous edge nouns
  // (link/connection/relationship/dependency) are NOT enforced (deferred to
  // #289); the non-graph PP guard also excludes "an option to the presentation".
  new RegExp(
    `\\b(?:add(?:ing|ed)?|creat(?:e|es|ing|ed)|insert(?:s|ing|ed)?|introduc(?:e|es|ing|ed)|incorporat(?:e|es|ing|ed)|includ(?:e|es|ing|ed)|connect(?:s|ing|ed)?|link(?:s|ing|ed)?|wir(?:e|es|ing|ed)|join(?:s|ing|ed)?|attach(?:es|ing|ed)?|remov(?:e|es|ing|ed)|delet(?:e|es|ing|ed)|drop(?:s|ping|ped)?|renam(?:e|es|ing|ed)|rewir(?:e|es|ing|ed)|revis(?:e|es|ing|ed)|rework(?:s|ing|ed)?|hook(?:s|ing|ed)? up|edit(?:s|ing|ed)?|chang(?:e|es|ing|ed)|updat(?:e|es|ing|ed)|modif(?:y|ies|ying|ied)|set up|establish(?:es|ing|ed)?)${TIGHT_TO_NOUN}${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`,
    'i',
  ),
  // "a new <structural noun>" (with the non-graph guard so "a new option to the
  // presentation" does NOT create intent — review round 8).
  new RegExp(`\\b(?:a |an |another )?new\\s+${STRUCTURAL_NOUN}\\b${NON_GRAPH_PP}`, 'i'),
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
  | 'broad_no_intent'
  | 'mutation_language'
  | 'ambiguous_edge';
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
 * PRECISION-FIRST (Brief 4 final contract). The ONLY swap trigger is a tightly-
 * bound, unambiguous first-person COMPLETION / near-future assertion on a
 * structural graph object (containsStructuralSuccessClaim). Everything else is
 * MONITOR-ONLY telemetry — never a swap — and is owned by the durable follow-ups
 * (#288 typed edits + composer contract; #289 graph-label context). Structural-
 * edit INTENT no longer drives a swap (the intent-gated broad arm was removed):
 * a false decline is a visible trust failure on every occurrence, whereas a
 * missed broad/passive/edge claim is observable here and cured upstream.
 *
 *  - swap/high_confidence     : tightly-bound first-person structural completion.
 *  - monitor/broad_no_intent  : broad / passive structural language (no swap).
 *  - monitor/mutation_language: legacy broad mutation language only.
 *  - monitor/ambiguous_edge   : edge-noun claim (link/connection/relationship/
 *                               dependency), deferred to #289 — surfaced only.
 *  - pass                     : a mutation committed, or no claim / benign.
 *
 * `structuralEditIntent` is accepted for telemetry context but DELIBERATELY does
 * not affect the swap decision (precision-first).
 */
export function classifyStructuralClaim(input: ClassifyStructuralClaimInput): StructuralClaimDecision {
  const { assistantText, handlerEmittedMutatedGraph, proposedHandlerId } = input;
  if (typeof assistantText !== 'string' || assistantText.length === 0) return { verdict: 'pass', kind: 'none' };
  const isDraftOrEditGraph =
    proposedHandlerId === 'draft_graph' || proposedHandlerId === 'edit_graph';
  if (handlerEmittedMutatedGraph || isDraftOrEditGraph) return { verdict: 'pass', kind: 'none' };
  // Sole swap path: high-precision, tightly-bound structural completion claim.
  if (containsStructuralSuccessClaim(assistantText)) return { verdict: 'swap', kind: 'high_confidence' };
  // Everything below is MONITOR-ONLY (observed, never swapped; owned by #288/#289).
  if (containsBroadStructuralClaimLanguage(assistantText)) return { verdict: 'monitor', kind: 'broad_no_intent' };
  if (containsMutationLanguage(assistantText)) return { verdict: 'monitor', kind: 'mutation_language' };
  if (looksLikeAmbiguousEdgeClaim(assistantText)) return { verdict: 'monitor', kind: 'ambiguous_edge' };
  return { verdict: 'pass', kind: 'none' };
}
