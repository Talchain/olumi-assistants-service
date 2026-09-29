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
 * a call site that USES IT cannot forget the hardening (change-the-mechanism, not
 * another hand-copy). Escaping is a no-op on text that contains no marker token,
 * so a marker-free brief is byte-identical to the prior inline envelope — only an
 * actual boundary-forgery attempt is neutralised.
 *
 * ⚠ CORRECTED 2026-07-25 — THIS DOCSTRING OVERSTATED ITS OWN COVERAGE. It claimed
 * the hardening "lands EVERYWHERE and a new wrapping site cannot forget it".
 * **Two sites still hand-build the envelope**, and both are known and deliberate:
 *
 *   1. `draft-attachment.ts:93` — a NATIVE DOCUMENT block. The payload is a
 *      structured content block, not one string, so it cannot pass through a
 *      `(label, text) => string` signature at all. **Genuinely outside this
 *      function's reach; the claim must simply be softer.**
 *   2. `coaching-pass.ts:183-190` — needs the `GRAPH_DATA` marker family, and
 *      `wrapUntrusted` hardcodes `USER_CONTENT`. **Absorbable**: a `family`
 *      parameter would fold it in. Rowed, not done here (out of lane scope).
 *
 * `UNTRUSTED_MARKER_RE` below already matches BOTH families, so the escaping
 * primitive is complete even where the wrapper is not — which is why this is a
 * false-coverage-claim defect and not a security hole. But a guarantee that
 * overstates its coverage is the thing this estate is trying to stop shipping:
 * the next reader audits the call sites, finds two, and mistrusts the rest.
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
