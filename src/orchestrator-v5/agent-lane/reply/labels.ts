/**
 * ⭐ S-A: THE ONE LABEL RULE (lane COPY-SHAPE, DL 0fd71f, 7 Oct 2026; D-04: "‘Feature Delivery Capaci…’", "today's level
 * of ‘meet our next feature-l…’"). A label is never cut mid-word, and a label inside a QUESTION is never compacted: the
 * user must be able to answer it. Explanations yield first when a carrier is tight. No imports.
 *
 * Absorbed from Codex WORDING (7 Oct). Census §3c lists the other shorteners (render.ts `cut` now delegates here;
 * `compose/helpers.ts`, `repair-value-ask-response.ts`, chip `fitted`) — they move here in slice 2.
 */
const WORD_CHAR = /[\p{L}\p{N}_-]/u;

/** A whole-word prefix of at most `limit` code points plus an ellipsis; a single over-budget word is omitted, never sliced. */
export function compactWordLabel(value: string, limit: number): string {
  const chars = Array.from(value);
  if (chars.length <= limit) return value;
  let end = Math.max(0, limit - 1);
  while (end > 0 && WORD_CHAR.test(chars[end] ?? '') && WORD_CHAR.test(chars[end - 1] ?? '')) end--;
  return `${chars.slice(0, end).join('').trimEnd()}…`;
}
