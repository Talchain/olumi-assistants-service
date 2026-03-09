/**
 * Canonical status quo / baseline option label patterns.
 *
 * Single source of truth for matching option node labels AND brief text
 * against status quo language. Used by:
 *   - detectMissingBaseline() in structure/index.ts
 *   - detectMissingCounterfactual() in structure/index.ts
 *   - Status quo coaching injection in unified-pipeline/stages/package.ts
 *   - BIL missing_elements check in orchestrator/brief-intelligence/extract.ts
 *
 * Intentional deviations from the original BIL regex list:
 *   - "baseline" alone is excluded — false positives on "Improve baseline forecast"
 *   - Extra phrases added vs original BIL list: "no action", "current state",
 *     "maintain current", "carry on", "stay the course", "existing approach",
 *     "keep things as they are", "continue as now", "continue as is",
 *     "leave things as they are"
 *     These are natural-language synonyms observed in production briefs.
 * Revisit post-pilot if false-positive rate is high.
 */

/**
 * Canonical phrases for status quo option detection.
 * Case-insensitive partial match against option node labels or brief text.
 */
export const STATUS_QUO_LABEL_PATTERNS: readonly string[] = [
  "status quo",
  "do nothing",
  "no action",
  "no change",
  "keep current",
  "maintain current",
  "current state",
  "current approach",
  "existing approach",
  "as-is",
  "as is",
  "leave things as they are",
  "carry on",
  "stay the course",
  "stay the same",
  "keep things as they are",
  "continue as now",
  "continue as is",
] as const;

/**
 * Test whether a label matches any canonical status quo pattern.
 * Case-insensitive partial match.
 *
 * @param label Option node label to test
 * @returns true if the label contains any status quo phrase
 */
export function matchesStatusQuoLabel(label: string): boolean {
  if (typeof label !== "string" || label.length === 0) return false;
  const lower = label.toLowerCase();
  return STATUS_QUO_LABEL_PATTERNS.some((pattern) => lower.includes(pattern));
}
