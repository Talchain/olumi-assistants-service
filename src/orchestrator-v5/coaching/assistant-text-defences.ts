/**
 * Shared defence-in-depth content rules for run_analysis assistant_text.
 *
 * Single home (trap-12: derive, don't mirror). Two consumers:
 *   - the registry-side egress allowlist (`analysis-result-headline.ts`
 *     `isAllowedRunAnalysisAssistantText`) applies these AFTER a structural
 *     match (headline grammar or template+scaffold-disclosure);
 *   - the scaffold-disclosure builder (`scaffold-disclosure.ts`) validates
 *     its COMPOSED suffix against the SAME functions at build time, so a
 *     label that would trip the egress falls back to the generic form
 *     instead of getting the whole disclosure-bearing summary silently
 *     replaced by the locked template.
 *
 * P1-3 history: the builder used to carry local mirrors of the decimal and
 * vocabulary rules but NOT the internal-ID rule — a label like "Plan E_2"
 * passed the builder and the egress then swallowed the entire disclosure.
 * Any new defence added here bites at BOTH consumers by construction.
 */

/**
 * Forbidden vocabulary in any run_analysis assistant_text. Case-
 * insensitive word-boundary checks; mirrors the spirit of the broader
 * forbidden-user-facing-phrases list but narrowed to the headline-relevant
 * prescriptive terms.
 */
export const FORBIDDEN_HEADLINE_VOCABULARY_REGEX =
  /\b(?:recommend(?:s|ed|ation|ations)?|winners?|best|optimal|preferred)\b/i;

/**
 * Slug-shape ID prefixes, applied to the whole assistant_text — a handler
 * (or a label slot) that interpolates `opt_a` / `E_2` into prose is caught
 * even when an upstream label sanitiser was bypassed.
 */
export const ASSISTANT_TEXT_ID_REGEX = /\b(?:opt|goal|fac|node|edge|n|e)_[a-z0-9_]+/i;

/**
 * Raw decimals: `\d+\.\d+`. The headline only emits integer percentages
 * ("62%"); any decimal in the text suggests improvised prose.
 */
export const RAW_DECIMAL_REGEX = /\d+\.\d+/;

/**
 * Shared defence-in-depth content rules applied AFTER a structural match
 * (headline grammar or template+scaffold-disclosure): no forbidden
 * vocabulary, no internal-ID tokens, no raw decimals.
 */
export function passesAssistantTextContentDefences(text: string): boolean {
  if (FORBIDDEN_HEADLINE_VOCABULARY_REGEX.test(text)) return false;
  if (ASSISTANT_TEXT_ID_REGEX.test(text)) return false;
  if (RAW_DECIMAL_REGEX.test(text)) return false;
  return true;
}
