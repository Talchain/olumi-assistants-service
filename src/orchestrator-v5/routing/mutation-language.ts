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
// Brief 4 — narrow structural-success-claim detector + enforcing-gate helpers.
//
// SEPARATE from MUTATION_PATTERNS / containsMutationLanguage above (which feed
// validateExplanationAnswer and the broad STEP 6.5 monitor — left UNCHANGED).
// This detector is conservative by design: it fires only on FIRST-PERSON
// success / commitment / completion claims anchored to a graph object
// (incl. edge nouns link/connection/relationship/dependency), first-person
// edge claims that name two entities ("I connected Marketing to Revenue"),
// and the narrow "model now includes/contains <graph object>" change
// assertion. Advisory ("you could add…", "I'd suggest adding…"), offers
// ("would you like me to add…"), benign pronoun phrasing ("I'll add that to
// my notes", "I'll update you on the results") and legitimate current-state
// read-outs ("your model now has four options") are deliberately NOT matched
// — they are not claims that THIS turn changed the model.
// ---------------------------------------------------------------------------

/** Graph-object nouns that anchor a first-person mutation verb to a STRUCTURAL claim. */
const GRAPH_OBJECT =
  '(?:option|options|factor|factors|node|nodes|edge|edges|link|links|connection|connections|relationship|relationships|dependency|dependencies|driver|drivers|constraint|constraints|model|graph|diagram|decision)';
/** Apostrophe class: straight + typographic (Sonnet emits either). */
const APOS = "['’]";

const STRUCTURAL_SUCCESS_CLAIM_PATTERNS: readonly RegExp[] = [
  // Future commitment: "I'll add … <graph object>", "I will connect … the edge".
  new RegExp(
    `\\bI(?:${APOS}ll| will|${APOS}m going to| am going to|${APOS}m about to| am about to)\\s+(?:go ahead and\\s+)?(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${GRAPH_OBJECT}\\b`,
    'i',
  ),
  // "let me add … <graph object>".
  new RegExp(
    `\\blet me\\s+(?:add|set|change|update|remove|connect|create|wire|adjust|modify|link|delete|insert)\\b[^.?!]*\\b${GRAPH_OBJECT}\\b`,
    'i',
  ),
  // In-progress: "I'm adding … <graph object>".
  new RegExp(
    `\\bI(?:${APOS}m| am)\\s+(?:adding|setting|changing|updating|removing|connecting|creating|wiring|adjusting|linking|deleting|inserting)\\b[^.?!]*\\b${GRAPH_OBJECT}\\b`,
    'i',
  ),
  // Present-perfect completion: "I've added … <graph object>".
  new RegExp(
    `\\bI(?:${APOS}ve| have)\\s+(?:added|set|set up|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited)\\b[^.?!]*\\b${GRAPH_OBJECT}\\b`,
    'i',
  ),
  // Simple-past completion: "I added … <graph object>", "I updated the graph".
  new RegExp(
    `\\bI\\s+(?:added|created|connected|updated|removed|changed|wired|modified|adjusted|linked|deleted|inserted|edited)\\b[^.?!]*\\b${GRAPH_OBJECT}\\b`,
    'i',
  ),
  // Edge / relationship claims that name two ENTITIES rather than a graph-object
  // noun ("I connected Marketing to Revenue", "I linked X to the goal"). The
  // "between … and …" form is case-insensitive; the bare "X to/with/and Y" form
  // requires Capitalised entities so conversational "I'll connect you with the
  // team" (lowercase object) is NOT matched. First-person anchored throughout.
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+)?(?:connected|connecting|linked|linking|wired|wiring|joined|joining|drew|drawing)\\b[^.!?]*\\bbetween\\b[^.!?]*\\band\\b`,
    'i',
  ),
  new RegExp(
    `\\bI(?:${APOS}ve| have|${APOS}ll| will|${APOS}m| am)?\\s+(?:just\\s+|already\\s+|gone ahead and\\s+)?(?:connect|connected|connecting|link|linked|linking|wire|wired|wiring|join|joined|joining)\\s+[A-Z]\\w*(?:\\s+[A-Z]\\w*)*\\s+(?:to|with|and)\\s+(?:the\\s+)?[A-Z]\\w*`,
    // NB: no 'i' flag — entity tokens must be Capitalised to avoid matching
    // conversational "connect you with the team".
  ),
  // State-now CHANGE assertion — narrowed (Brief 4 review). Only "model now
  // includes/contains <graph object>" reads as a structural-change claim.
  // Plain current-state read-outs ("your model now has four options", "your
  // model now supports a comparison") use other verbs and are deliberately NOT
  // matched, so legitimate state descriptions are preserved.
  new RegExp(
    `\\b(?:your\\s+|the\\s+)?(?:model|graph|decision)\\s+now\\s+(?:includes|contains)\\b[^.!?]*\\b${GRAPH_OBJECT}\\b`,
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
  'I have not changed the model. I cannot make that kind of structural change to the model in this version.';

/** Gate verdict for `classifyStructuralClaim`. */
export type StructuralClaimVerdict = 'swap' | 'monitor' | 'pass';

export interface ClassifyStructuralClaimInput {
  readonly assistantText: string | null | undefined;
  /** True when a handler emitted a post-mutation graph this turn. */
  readonly handlerEmittedMutatedGraph: boolean;
  /** The proposed/dispatched handler id (turn-executor `proposedHandlerIdForOutcome`). */
  readonly proposedHandlerId: string | null;
}

/**
 * Decide whether the composed assistant text needs the honesty swap.
 *
 * The "no mutation occurred" predicate MIRRORS the canonical `buildTurnOutcome`
 * definition — `graph_mutated = handlerEmittedMutatedGraph || isDraftOrEditGraph`
 * — evaluated from the raw signals available at the swap site (NOT from a later
 * `turn_outcome` read, which is undefined before freshness derivation). There
 * is deliberately NO handler_id skip: the canonical E1 failure committed with
 * handler_id === null, so a handler_id filter would miss the bug it exists to
 * fix.
 *
 *  - 'swap'    : no mutation committed AND a structural success CLAIM is present
 *                → caller replaces text with V5_STRUCTURAL_DECLINE_TEXT.
 *  - 'monitor' : no mutation committed AND broad mutation language is present
 *                but the narrow detector did NOT fire → candidate false-negative
 *                (observability only, no swap).
 *  - 'pass'    : a mutation committed (the claim is true), or no claim / benign.
 */
export function classifyStructuralClaim(input: ClassifyStructuralClaimInput): StructuralClaimVerdict {
  const { assistantText, handlerEmittedMutatedGraph, proposedHandlerId } = input;
  if (typeof assistantText !== 'string' || assistantText.length === 0) return 'pass';
  const isDraftOrEditGraph =
    proposedHandlerId === 'draft_graph' || proposedHandlerId === 'edit_graph';
  if (handlerEmittedMutatedGraph || isDraftOrEditGraph) return 'pass';
  if (containsStructuralSuccessClaim(assistantText)) return 'swap';
  if (containsMutationLanguage(assistantText)) return 'monitor';
  return 'pass';
}
