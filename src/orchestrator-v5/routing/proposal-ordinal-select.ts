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

export interface TryProposalOrdinalSelectInput {
  readonly message: string;
  readonly candidates: readonly PendingAction[];
  /**
   * Public chip labels parallel to `candidates` — the same labels the
   * user saw in the ambiguous-clarification message ("Which one would
   * you like? 1) <label> 2) <label>"). Required for exact-label
   * matching.
   */
  readonly candidateLabels: readonly string[];
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

function tryExactLabel(
  message: string,
  candidateLabels: readonly string[],
): number | null {
  const trimmed = message.trim().replace(/[.!?]+$/u, '').trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  for (let i = 0; i < candidateLabels.length; i += 1) {
    const labelTrimmed = candidateLabels[i]!.trim();
    if (labelTrimmed.length === 0) continue;
    if (labelTrimmed.toLowerCase() === lower) return i;
  }
  return null;
}

export function tryProposalOrdinalSelect(
  input: TryProposalOrdinalSelectInput,
): ProposalOrdinalSelectResult {
  if (input.candidates.length === 0) return { matched: false };
  if (input.candidates.length !== input.candidateLabels.length) {
    // Defensive: the caller should pin parallel arrays. If they
    // diverge, refuse to match rather than guess.
    return { matched: false };
  }
  // Exact-label match takes priority over ordinal (a label happens to
  // be `"First quarter"` should not silently resolve as ordinal "first").
  const labelIndex = tryExactLabel(input.message, input.candidateLabels);
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
