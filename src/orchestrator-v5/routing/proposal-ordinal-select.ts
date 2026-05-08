/**
 * V5 G7/G8 — proposal ordinal / label select pre-route.
 *
 * Fires only when `tryShortConfirmResume` returns `recovery_ambiguous`
 * (multiple live `apply_proposed_change` candidates and the user said
 * something like "yes" or "do it"). When the user's message is an
 * ordinal pointer ("the first one", "option 2", "#3") or an exact label
 * match against one of the candidate chips, this module resolves the
 * ambiguity deterministically without an LLM round-trip.
 *
 * Pre-route order (locked in plan): state-query → short-confirm →
 * **proposal-ordinal-select (here, gated on ambiguous)** → proposal
 * dismissal → LLM. This module short-circuits cleanly: if the message
 * is not an ordinal / label match, returns `{ matched: false }` and the
 * existing ambiguous-clarification flow runs.
 *
 * Scope:
 *   - ordinals: "first" / "second" / "third" / "fourth" / "fifth"
 *   - phrasal forms: "the first one", "first one", "option 1", "#1"
 *   - exact label match (case-insensitive, full-string)
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
  | { readonly matched: false };

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

function tryExactLabelOrMessageUnambiguous(
  message: string,
  copy: readonly CandidateRenderCopy[],
): number | null {
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
  if (hits.length === 1) return hits[0]!;
  return null;
}

export function tryProposalOrdinalSelect(
  input: TryProposalOrdinalSelectInput,
): ProposalOrdinalSelectResult {
  if (input.candidates.length === 0) return { matched: false };
  if (input.candidates.length !== input.candidateRenderCopy.length) {
    // Defensive: the caller should pin parallel arrays. If they
    // diverge, refuse to match rather than guess.
    return { matched: false };
  }
  // Exact-label-or-message match takes priority over ordinal (a label
  // happens to be "First quarter" should not silently resolve as
  // ordinal "first"). Resolution is gated on uniqueness — two
  // candidates that render to the same string fall through to
  // clarification (P1-2).
  const labelIndex = tryExactLabelOrMessageUnambiguous(input.message, input.candidateRenderCopy);
  if (labelIndex !== null) {
    return { matched: true, pending: input.candidates[labelIndex]!, index: labelIndex };
  }
  // Negative gate: an edit verb in the message means this is not a
  // pure ordinal pick.
  if (EDIT_VERB_PATTERN.test(input.message)) return { matched: false };

  const ordinalIndex = tryOrdinalIndex(input.message);
  if (ordinalIndex === null) return { matched: false };
  if (ordinalIndex < 0 || ordinalIndex >= input.candidates.length) {
    return { matched: false };
  }
  return { matched: true, pending: input.candidates[ordinalIndex]!, index: ordinalIndex };
}
