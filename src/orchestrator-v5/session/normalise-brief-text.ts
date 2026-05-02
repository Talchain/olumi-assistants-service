/**
 * Normalise the user-supplied free-text brief BEFORE it reaches the
 * append_turn_atomic RPC.
 *
 * Defence-in-depth alongside the DB CHECK constraint
 * `char_length(btrim(brief_text)) BETWEEN 1 AND 8000` (see
 * supabase/migrations/20260502120000_v5_brief_text_persistence.sql).
 * The DB layer is the last line; this app-side helper avoids the round
 * trip and returns a sanitised value the RPC will accept.
 *
 * Rules:
 *   - null / undefined        → undefined (RPC param defaults to NULL).
 *   - whitespace-only string  → undefined (the trimmed-empty case).
 *   - length ≤ 8000           → trimmed string.
 *   - length > 8000           → truncate at 8000 chars on a word
 *                               boundary if the last space falls in
 *                               (7000, 8000); otherwise hard-cut at
 *                               8000. Never throws on length.
 *
 * Truncation telemetry fires at the call site (draft-graph-dispatch),
 * not here — pure helper.
 */
export interface NormaliseBriefTextResult {
  /** The normalised value to pass to the RPC, or undefined for "do not write". */
  readonly value: string | undefined;
  /** True iff the input was over 8000 chars and got truncated. */
  readonly truncated: boolean;
  /** Length of the original (post-trim) input — used by truncation telemetry. */
  readonly originalLength: number;
}

const MAX_BRIEF_TEXT_LENGTH = 8000;
const WORD_BOUNDARY_FLOOR = 7000;

export function normaliseBriefText(
  raw: string | undefined | null,
): NormaliseBriefTextResult {
  if (raw == null) {
    return { value: undefined, truncated: false, originalLength: 0 };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: undefined, truncated: false, originalLength: 0 };
  }
  if (trimmed.length <= MAX_BRIEF_TEXT_LENGTH) {
    return { value: trimmed, truncated: false, originalLength: trimmed.length };
  }
  const head = trimmed.slice(0, MAX_BRIEF_TEXT_LENGTH);
  const lastSpace = head.lastIndexOf(' ');
  const truncated = lastSpace > WORD_BOUNDARY_FLOOR ? head.slice(0, lastSpace) : head;
  return { value: truncated, truncated: true, originalLength: trimmed.length };
}
