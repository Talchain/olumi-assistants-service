/**
 * 7-Point Likert Frequency Scale
 *
 * Maps natural-language frequency labels to base rate probabilities.
 * Used for base rate elicitation coaching (probability-like factors only)
 * and user response parsing.
 *
 * Values from Neil's elicitation guidance: frequency framing
 * ("out of 100 times, how many would this be true?").
 */

export const LIKERT_FREQUENCY_SCALE = [
  { label: 'hardly ever',    frequency: '< 1 in 100',  value: 0.01 },
  { label: 'rarely',         frequency: '~10 in 100',  value: 0.10 },
  { label: 'occasionally',   frequency: '~25 in 100',  value: 0.25 },
  { label: 'sometimes',      frequency: '~40 in 100',  value: 0.40 },
  { label: 'often',          frequency: '~60 in 100',  value: 0.60 },
  { label: 'usually',        frequency: '~75 in 100',  value: 0.75 },
  { label: 'almost always',  frequency: '~90 in 100',  value: 0.90 },
] as const;

export type LikertFrequencyLabel = typeof LIKERT_FREQUENCY_SCALE[number]['label'];

/**
 * Parse a user response to a Likert label and return the corresponding value.
 * Case-insensitive, trims whitespace. Multi-word labels are matched first
 * to avoid partial hits (e.g. "hardly ever" before "ever").
 *
 * @returns Mapped probability value, or undefined if no match
 */
export function parseLikertResponse(input: string): number | undefined {
  const normalized = input.trim().toLowerCase();
  // Word-boundary match to avoid false positives (e.g. "often" inside "soften")
  for (const entry of LIKERT_FREQUENCY_SCALE) {
    const escaped = entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(normalized)) {
      return entry.value;
    }
  }
  return undefined;
}

/**
 * Factor types considered probability-like for Likert elicitation.
 * All other factor types (cost, price, revenue, demand, time, quality, other)
 * should be prompted with a numeric baseline instead.
 */
const PROBABILITY_FACTOR_TYPES = new Set<string>(['probability', 'rate']);

/**
 * Determine whether a factor should use the Likert frequency scale
 * (probability-like) or a numeric baseline prompt (cost/revenue/quantity).
 *
 * Defaults to probability-like when factor_type is absent, since most
 * factors without explicit type are qualitative/probability factors.
 */
export function isProbabilityLikeFactor(factorType: string | undefined): boolean {
  if (factorType == null) return true;
  return PROBABILITY_FACTOR_TYPES.has(factorType.toLowerCase());
}
