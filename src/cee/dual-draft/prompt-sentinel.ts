/**
 * Fail-closed sentinel for the M2 graph-review prompt slot (G17).
 *
 * The registered default prompt for `m2_graph_review` contains this marker
 * until Paul-authored production copy lands via the PMS lane. While the
 * resolved prompt contains the sentinel, the dual-draft stage refuses to call
 * the LLM (outcome `prompt_not_provisioned`) even with the feature flag ON —
 * placeholder copy can never reach a live model call.
 *
 * Single source of truth: src/prompts/defaults.ts registers this exact
 * constant; src/cee/dual-draft/m2-review.ts checks for it. This module has no
 * imports so both sides can depend on it without layering concerns.
 */
export const M2_PROMPT_NOT_PROVISIONED_SENTINEL = '__M2_PROMPT_NOT_PROVISIONED__';

export function isM2PromptProvisioned(content: string): boolean {
  return !content.includes(M2_PROMPT_NOT_PROVISIONED_SENTINEL);
}
