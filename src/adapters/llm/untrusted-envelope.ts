/**
 * Shared untrusted-user-content envelope + delimiter escaping.
 *
 * FINAL-SWEEP (pre-handover, 2026-07-24; Codex quality F3 + boundary Finding 2).
 * The `[BEGIN_UNTRUSTED_USER_CONTENT]\n${text}\n[END_UNTRUSTED_USER_CONTENT]`
 * bracketing was hand-authored at ~10 LLM call sites (draft, repair, clarify,
 * decision-review, rationale — Anthropic + OpenAI adapters + validate-graph), and
 * #667 F11's delimiter-forging defense (`escapeUntrustedDelimiters`) existed at
 * exactly ONE of them (coaching-pass). Every other site interpolated user content
 * RAW, so a brief bearing `...[END_UNTRUSTED_USER_CONTENT]\n\nSYSTEM: <injected>`
 * could forge the boundary and present natural language as trusted instructions.
 *
 * `wrapUntrusted(label, text)` is the single source: it brackets AND escapes, so
 * F11's hardening now lands EVERYWHERE and a new wrapping site cannot forget it
 * (change-the-mechanism, not another hand-copy). Escaping is a no-op on text that
 * contains no marker token, so a marker-free brief is byte-identical to the prior
 * inline envelope — only an actual boundary-forgery attempt is neutralised.
 */

/**
 * Reserved untrusted-content delimiters. Any occurrence INSIDE user/model content
 * (a brief, a node label, a doc preview) is neutralised so it cannot forge an
 * envelope boundary. Matches both the USER_CONTENT and GRAPH_DATA marker families.
 */
export const UNTRUSTED_MARKER_RE = /\[(?:BEGIN|END)_UNTRUSTED_[A-Z_]*\]/gi;

/**
 * Swap the square brackets of any marker-shaped token so it is no longer a valid
 * delimiter, while keeping the text human-/model-readable as data.
 */
export function escapeUntrustedDelimiters(text: string): string {
  return text.replace(UNTRUSTED_MARKER_RE, (m) => m.replace(/\[/g, '(').replace(/\]/g, ')'));
}

/**
 * Wrap `text` in the untrusted-user-content envelope, delimiter-escaped, under an
 * optional header `label` line (e.g. "## Brief", "Docs:", or "" for a bare
 * envelope). The returned block is: `${label}\n[BEGIN…]\n${escaped}\n[END…]`.
 */
export function wrapUntrusted(label: string, text: string): string {
  const prefix = label ? `${label}\n` : '';
  return `${prefix}[BEGIN_UNTRUSTED_USER_CONTENT]\n${escapeUntrustedDelimiters(text)}\n[END_UNTRUSTED_USER_CONTENT]`;
}
