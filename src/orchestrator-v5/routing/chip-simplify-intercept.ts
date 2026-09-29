/**
 * V5 edit lifecycle recovery v1 — legacy chip-text intercept.
 *
 * The V4 `edit_graph` rejection branches emit a facilitator chip with
 * label "Simplify the change" whose submit prompt is the literal
 * string `"Try a simpler version of this change."`
 * (see src/orchestrator/tools/edit-graph.ts:2096 and :2198). When the
 * user clicks that chip, the UI sends that prompt back as a free-text
 * user message — there is no `action_type` on the chip today, so the
 * message re-enters `route-v2.ts` and hits `EDIT_GRAPH_POSITIVE_REGEX`
 * via the bare verb "change", bypasses every V5 deterministic guard,
 * and dispatches into the V4 `handleEditGraph` LLM call a second time.
 * The LLM has no further context, returns empty operations, and the
 * user ends up at the no-op fallback ("I couldn't see a concrete
 * change…"). This is the closed-loop diagnosed in the V5 edit
 * interaction lifecycle investigation (2026-05-22).
 *
 * Closing the loop in the chip's boundary shape requires a new
 * `action_type` or a chip-source metadata field on `Action` — schema
 * work tracked separately. This module ships the narrower, deferral-
 * safe fix: an exact-text intercept that recognises the legacy chip's
 * submit prompt and short-circuits to deterministic clarification
 * before any LLM call.
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no log spam.
 *  - The intercept matches ONLY the literal chip prompt. No verb
 *    families, no fuzzy matches — the broader vague-edit cohort is
 *    handled by `vague-edit-guard.ts`.
 *  - Normalisation: case-insensitive, leading/trailing whitespace
 *    trimmed, internal whitespace collapsed. This catches the
 *    common "user retypes the prompt" failure (e.g. a stray double
 *    space) without widening the match into anything resembling
 *    fuzzy intent classification.
 *
 * Future work (intentionally NOT in this PR):
 *  - When the boundary `Action` schema gains a chip-source metadata
 *    field (e.g. `Action.source_chip_id` or `Action.metadata.intent`),
 *    `tryChipSimplifyIntercept` can be extended to match the metadata
 *    leg without depending on prompt-text equality. The exact-text
 *    leg should remain for backward compatibility with already-rendered
 *    chips on user surfaces. See the skipped test in
 *    tests/unit/orchestrator-v5/routing/chip-simplify-intercept.test.ts
 *    for the breadcrumb.
 */

/**
 * The exact prompt text rendered by the V4 "Simplify the change"
 * facilitator chip (edit-graph.ts:2096 and :2198). Pinned here as a
 * module-level constant so a chip-text rename in the V4 source forces
 * a deliberate update on this side too.
 */
export const SIMPLIFY_CHANGE_CHIP_PROMPT =
  'Try a simpler version of this change.';

/**
 * `null` when the message is NOT the legacy chip prompt. When it IS,
 * returns a `matched: true` discriminator with the source tag so the
 * caller (route-v2.ts) can emit distinct telemetry. The discriminator
 * leaves room to add a `source: 'metadata'` variant later without
 * changing the call site's destructure.
 */
export type ChipSimplifyInterceptResult =
  | { readonly matched: true; readonly source: 'exact_text' }
  | { readonly matched: false };

/**
 * Returns `{ matched: true, source: 'exact_text' }` when `message` is
 * the literal "Simplify the change" chip's submit prompt
 * (whitespace-insensitive, case-insensitive). Returns
 * `{ matched: false }` otherwise.
 */
export function tryChipSimplifyIntercept(
  message: string,
): ChipSimplifyInterceptResult {
  if (typeof message !== 'string' || message.length === 0) {
    return { matched: false };
  }
  if (normalise(message) === normalise(SIMPLIFY_CHANGE_CHIP_PROMPT)) {
    return { matched: true, source: 'exact_text' };
  }
  return { matched: false };
}

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}
