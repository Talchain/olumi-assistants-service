/**
 * Canonical denylist of internal repair / A5 enforcement vocabulary that
 * MUST NOT appear in user-facing assistant_text on any edit_graph (or
 * downstream) surface.
 *
 * Sources of operator-language leakage that historically reached
 * assistant_text or were at risk:
 *   - graph-enforcement.ts:237 ("Rescaled N causal inbound edges from
 *     sum=X.XXX to 1.0")
 *   - applyBudgetRescale / fixBridgeChaining repair codes
 *   - PLoT validator rejection reasons containing `|mean|`, `Σ|mean|`,
 *     `BUDGET_TARGET`, `[INBOUND_BUDGET_RESCALED]`, etc.
 *   - LLM coaching.summary or warnings — Sonnet may occasionally echo
 *     the input prompt's internal vocabulary.
 *
 * The legacy "PLoT applied N repair(s) to ensure semantic consistency"
 * prefix at edit-graph.ts:2337 was removed in 2026-05; this denylist is
 * a defence-in-depth catch for any other path that produces operator
 * vocabulary, including LLM-generated text.
 *
 * Append-only: removing a pattern requires co-review of every
 * `enforceRepairVocabularyDenylist` callsite + every
 * `assertNoBannedInternalTokens` test.
 */
export const REPAIR_VOCABULARY_DENYLIST: ReadonlyArray<RegExp> = Object.freeze([
  /\|mean\|/i,
  /\binbound\b/i,
  /\bsum=/i,
  /\bbridge\b/i,
  /\brescale/i,
  /BUDGET_TARGET/,
  /\[INBOUND_/,
  /\[BRIDGE_/,
  /\[STRENGTH_CLAMPED\]/,
  /\bceiling\b/i,
  /Σ/,
  /PLoT applied/i,
]);

/**
 * Replace any banned-vocabulary substring in `text` with `[REDACTED]`.
 * Returns `{ text, replacements }` so callers can emit telemetry on
 * non-zero replacement counts (a non-zero count is a signal that
 * upstream prompt or LLM behaviour leaked operator vocabulary into
 * user-facing prose — worth observing).
 *
 * Pure function; no I/O. Safe to call from any layer.
 */
export function enforceRepairVocabularyDenylist(
  text: string,
): { text: string; replacements: number } {
  let replacements = 0;
  let out = text;
  for (const re of REPAIR_VOCABULARY_DENYLIST) {
    out = out.replace(re, () => {
      replacements += 1;
      return '[REDACTED]';
    });
  }
  return { text: out, replacements };
}
