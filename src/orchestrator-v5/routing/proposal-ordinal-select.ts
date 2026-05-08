/**
 * V5 G7/G8 — proposal ordinal / label / message select pre-route.
 *
 * Used by TurnExecutor in TWO places:
 *   1. Inside the `recovery_ambiguous` branch of `tryShortConfirmResume`
 *      — when "yes"-style input meets multiple live proposals, this
 *      helper picks ordinal / label / message matches against the
 *      ambiguous chips before the numbered clarification commits.
 *   2. Pass-7 P1-1 live-proposal label/ordinal pre-route — when
 *      short-confirm returned no-match, this helper runs against ALL
 *      live `apply_proposed_change` candidates so an exact-label or
 *      ordinal reply ("Add the cost cap", "the first one") resolves
 *      deterministically without going through the LLM.
 *
 * Both call sites consume `resolveProposalRenderCopy` from
 * `compose/proposed-change.ts` so the strings the matcher tests
 * against are exactly the strings the user saw rendered.
 *
 * Result discriminates three outcomes (pass-10 P1):
 *   - `matched: true` → exactly one candidate matched
 *   - `matched: false, reason: 'no_match'` → caller continues to
 *     dismissal / LLM as appropriate
 *   - `matched: false, reason: 'ambiguous', ambiguousIndexes` → two
 *     or more candidates matched. Caller MUST commit a deterministic
 *     clarification rather than fall through to the LLM.
 *
 * Scope:
 *   - ordinals: "first" / "second" / "third" / "fourth" / "fifth"
 *   - phrasal forms: "the first one", "first one", "option 1", "#1"
 *   - exact label match (case-insensitive, full-string)
 *   - exact message match (chip-click parity)
 *
 * Out of scope (deliberate):
 *   - Fuzzy label matching, partial-prefix label matching, synonyms.
 *     A future stream may extend; this branch is intentionally narrow
 *     to avoid silently misrouting.
 */

import type { PendingAction } from '../session/pending-action.js';

/**
 * Negative gate: messages containing edit verbs or numeric quantities
 * that aren't pure ordinals (e.g. "set 2", "add 3 of") are NOT ordinal
 * picks. Stay out of the way and let the LLM see the full message.
 *
 * Locally re-stated rather than imported from
 * `deterministic-short-confirm.ts` to keep this module leaf-level.
 */
const EDIT_VERB_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b/i;

/**
 * Word-form ordinals up to 5. Beyond that we rely on the digit forms
 * (`#6`, `option 7`). Match-first-only — the regex is anchored start
 * to end of message after stripping leading "the " and trailing
 * politeness suffixes.
 */
const ORDINAL_WORD_TO_INDEX: ReadonlyMap<string, number> = new Map([
  ['first', 0],
  ['second', 1],
  ['third', 2],
  ['fourth', 3],
  ['fifth', 4],
]);

/**
 * Phrasal patterns that must reduce to an ordinal index. Each captures
 * the ordinal word or digit. Anchored start-to-end with optional
 * leading "the " and trailing politeness/punctuation tolerated.
 */
const PHRASAL_ORDINAL_WORD =
  /^\s*(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|option|choice))?\s*[.!?]*\s*(?:please|now|thanks|thank\s+you)?\s*[.!?]*\s*$/i;
const PHRASAL_ORDINAL_DIGIT =
  /^\s*(?:#|option\s+|number\s+|the\s+)?(\d{1,2})(?:\s+(?:one|option|choice))?\s*[.!?]*\s*(?:please|now|thanks|thank\s+you)?\s*[.!?]*\s*$/i;

/**
 * The render-time copy bundle that drove a chip's label and message
 * for one candidate. Both fields are sanitised by
 * `compose/proposed-change.ts::resolveProposalRenderCopy` so the
 * matcher tests against EXACTLY what the user saw.
 */
export interface CandidateRenderCopy {
  readonly label: string;
  readonly message: string;
}

export interface TryProposalOrdinalSelectInput {
  readonly message: string;
  readonly candidates: readonly PendingAction[];
  /**
   * Render-time copy parallel to `candidates`. Pass-8 P1-1 tightening:
   * exact-label matching now runs against BOTH the rendered label AND
   * the rendered message for each candidate, so a chip-click replay
   * carrying the message text resolves the same way as a typed label
   * reply, AND the user can never see one string but be matched
   * against another.
   */
  readonly candidateRenderCopy: readonly CandidateRenderCopy[];
}

export type ProposalOrdinalSelectResult =
  | { readonly matched: true; readonly pending: PendingAction; readonly index: number }
  | { readonly matched: false; readonly reason: 'no_match' }
  /**
   * The user's input matched two or more candidates' rendered label
   * or rendered message. The caller MUST NOT execute any candidate
   * (executing the first would silently misroute) and SHOULD commit
   * a deterministic clarification rather than fall through to the
   * LLM. `ambiguousIndexes` carries the indexes of every candidate
   * that matched, in the original `candidates` order.
   */
  | { readonly matched: false; readonly reason: 'ambiguous'; readonly ambiguousIndexes: readonly number[] };

function tryOrdinalIndex(message: string): number | null {
  // Word ordinal: "first" / "the first one" / "first one" / "first option"
  const word = PHRASAL_ORDINAL_WORD.exec(message);
  if (word !== null) {
    const idx = ORDINAL_WORD_TO_INDEX.get(word[1]!.toLowerCase());
    return idx ?? null;
  }
  // Digit ordinal: "1" / "#1" / "option 1" / "the 1"
  const digit = PHRASAL_ORDINAL_DIGIT.exec(message);
  if (digit !== null) {
    const n = Number.parseInt(digit[1]!, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n - 1;
  }
  return null;
}

/**
 * Pass-8 P1-2 tightening: exact-label matching is unambiguous.
 *
 * Iterates every candidate; collects the indexes whose rendered
 * `label` OR rendered `message` exactly equals the user's input
 * (case-insensitive, trimmed). Returns the index ONLY when EXACTLY
 * ONE candidate matches. Two candidates with the same rendered
 * label (e.g. both falling back to "Apply this change") therefore
 * fall through to the clarification path rather than silently
 * executing the first one.
 */
/**
 * Normalise a string for exact-match comparison: trim surrounding
 * whitespace, strip trailing `.!?` punctuation, lowercase. Both the
 * user input and each candidate field are normalised the same way so
 * `"Add the cost cap"` matches `"Add the cost cap."` (a chip whose
 * rendered message ends with a full stop).
 */
function normaliseForExactMatch(value: string): string {
  return value.trim().replace(/[.!?]+$/u, '').trim().toLowerCase();
}

/**
 * Pass-10 P1: classify exact label/message matching into three
 * outcomes:
 *   - `null`: no candidate matches
 *   - `{ kind: 'unique', index }`: exactly one candidate matches
 *   - `{ kind: 'ambiguous', indexes }`: two or more candidates
 *     match (e.g. both falling back to "Apply this change"). The
 *     caller must NOT silently execute the first one; it should
 *     commit a deterministic clarification.
 */
type ExactMatchOutcome =
  | null
  | { readonly kind: 'unique'; readonly index: number }
  | { readonly kind: 'ambiguous'; readonly indexes: readonly number[] };

function classifyExactLabelOrMessageMatch(
  message: string,
  copy: readonly CandidateRenderCopy[],
): ExactMatchOutcome {
  const needle = normaliseForExactMatch(message);
  if (needle.length === 0) return null;
  const hits: number[] = [];
  for (let i = 0; i < copy.length; i += 1) {
    const candidate = copy[i]!;
    const labelNorm = normaliseForExactMatch(candidate.label);
    const messageNorm = normaliseForExactMatch(candidate.message);
    const labelMatches = labelNorm.length > 0 && labelNorm === needle;
    const messageMatches = messageNorm.length > 0 && messageNorm === needle;
    if (labelMatches || messageMatches) hits.push(i);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return { kind: 'unique', index: hits[0]! };
  return { kind: 'ambiguous', indexes: hits };
}

export function tryProposalOrdinalSelect(
  input: TryProposalOrdinalSelectInput,
): ProposalOrdinalSelectResult {
  if (input.candidates.length === 0) return { matched: false, reason: 'no_match' };
  if (input.candidates.length !== input.candidateRenderCopy.length) {
    // Defensive: the caller should pin parallel arrays. If they
    // diverge, refuse to match rather than guess.
    return { matched: false, reason: 'no_match' };
  }
  // Exact-label-or-message match takes priority over ordinal. A label
  // happening to be "First quarter" must not silently resolve as
  // ordinal "first"; an ambiguous label/message must yield the
  // matching indexes so the caller can commit a deterministic
  // clarification (pass-10 P1) rather than fall through to the LLM.
  const exact = classifyExactLabelOrMessageMatch(input.message, input.candidateRenderCopy);
  if (exact !== null) {
    if (exact.kind === 'unique') {
      return { matched: true, pending: input.candidates[exact.index]!, index: exact.index };
    }
    return { matched: false, reason: 'ambiguous', ambiguousIndexes: exact.indexes };
  }
  // Negative gate: an edit verb in the message means this is not a
  // pure ordinal pick.
  if (EDIT_VERB_PATTERN.test(input.message)) return { matched: false, reason: 'no_match' };

  const ordinalIndex = tryOrdinalIndex(input.message);
  if (ordinalIndex === null) return { matched: false, reason: 'no_match' };
  if (ordinalIndex < 0 || ordinalIndex >= input.candidates.length) {
    return { matched: false, reason: 'no_match' };
  }
  return { matched: true, pending: input.candidates[ordinalIndex]!, index: ordinalIndex };
}
