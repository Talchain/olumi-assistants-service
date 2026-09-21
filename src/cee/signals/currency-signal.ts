/**
 * Currency detection from decision briefs.
 *
 * Deterministic string scan — no external calls, no NLP.
 * Returns the detected currency or null if ambiguous/absent.
 *
 * Priority: explicit symbols/codes > contextual inference.
 * If multiple distinct currencies are detected, returns null (ambiguous).
 *
 * **Performance contract:** <5ms for briefs up to 1000 words (pure regex).
 */

// ============================================================================
// Types
// ============================================================================

export interface CurrencySignal {
  /** Detected currency symbol (£, $, €) */
  symbol: string;
  /** ISO 4217 code */
  code: string;
}

/** Full mapping from code to signal */
const CURRENCY_MAP: Record<string, CurrencySignal> = {
  GBP: { symbol: "£", code: "GBP" },
  USD: { symbol: "$", code: "USD" },
  EUR: { symbol: "€", code: "EUR" },
  AUD: { symbol: "A$", code: "AUD" },
  CAD: { symbol: "C$", code: "CAD" },
};

// ============================================================================
// Detection patterns
// ============================================================================

/**
 * Explicit symbol patterns.
 * £ → GBP unambiguously. $ alone → USD. € → EUR.
 * A$ and C$ detected via code patterns below.
 */
const SYMBOL_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /£/, code: "GBP" },
  { re: /€/, code: "EUR" },
  // $ but not preceded by A/a or C/c (those are AUD/CAD, handled by code patterns)
  { re: /(?<![AaCc])\$/, code: "USD" },
];

/**
 * Explicit ISO codes (word-boundary matched, case-insensitive).
 */
const CODE_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /\bGBP\b/i, code: "GBP" },
  { re: /\bUSD\b/i, code: "USD" },
  { re: /\bEUR\b/i, code: "EUR" },
  { re: /\bAUD\b/i, code: "AUD" },
  { re: /\bCAD\b/i, code: "CAD" },
  // Prefixed dollar notations — case-insensitive for a$/A$ and c$/C$
  { re: /\b[Aa]\$/, code: "AUD" },
  { re: /\b[Cc]\$/, code: "CAD" },
];

/**
 * Contextual locale patterns (weaker signal — only used if no explicit match).
 */
const CONTEXTUAL_PATTERNS: Array<{ re: RegExp; code: string }> = [
  // UK / British
  { re: /\b(UK|United\s+Kingdom|British)\b/i, code: "GBP" },
  { re: /\.co\.uk\b/i, code: "GBP" },
  // US / American — US must be uppercase to avoid matching the pronoun "us"
  // Also handles U.S. (with periods)
  { re: /\bUS\b/, code: "USD" },
  { re: /\bU\.S\./, code: "USD" },
  { re: /\b(United\s+States|American)\b/i, code: "USD" },
  // European
  { re: /\b(Europe|EU|European)\b/i, code: "EUR" },
  // Australian
  { re: /\b(Australia|Australian)\b/i, code: "AUD" },
  // Canadian
  { re: /\b(Canada|Canadian)\b/i, code: "CAD" },
];

// ============================================================================
// Detection engine
// ============================================================================

/**
 * Detect currency/locale from a decision brief.
 *
 * @param brief - Raw brief text
 * @returns Detected currency signal, or null if ambiguous or absent
 */
export function detectCurrency(brief: string): CurrencySignal | null {
  const detected = new Set<string>();

  // Pass 1: Explicit symbols (highest priority)
  for (const { re, code } of SYMBOL_PATTERNS) {
    if (re.test(brief)) detected.add(code);
  }

  // Pass 2: Explicit ISO codes
  for (const { re, code } of CODE_PATTERNS) {
    if (re.test(brief)) detected.add(code);
  }

  // If we have explicit matches, use them
  if (detected.size === 1) {
    const code = [...detected][0];
    return CURRENCY_MAP[code] ?? null;
  }
  if (detected.size > 1) {
    return null; // Ambiguous — multiple explicit currencies
  }

  // Pass 3: Contextual inference (only when no explicit match)
  const contextual = new Set<string>();
  for (const { re, code } of CONTEXTUAL_PATTERNS) {
    if (re.test(brief)) contextual.add(code);
  }

  if (contextual.size === 1) {
    const code = [...contextual][0];
    return CURRENCY_MAP[code] ?? null;
  }

  // No match or ambiguous contextual — return null
  return null;
}

// ============================================================================
// Prompt injection
// ============================================================================

/**
 * Build the currency context instruction to inject into LLM prompts.
 *
 * When currency is detected:
 *   "The user's context indicates £ (GBP) currency. Use £ for all cost, revenue,
 *    price, and budget factors. Do not use other currency symbols unless the brief
 *    explicitly references them."
 *
 * When no currency detected (default to £ per platform policy):
 *   "No specific currency was detected in the brief. Infer the most appropriate
 *    currency from context. If uncertain, use £ (GBP)."
 */
export function buildCurrencyInstruction(signal: CurrencySignal | null): string {
  if (signal) {
    return `\n\n[CURRENCY_CONTEXT] The user's context indicates ${signal.symbol} (${signal.code}) currency. Use ${signal.symbol} for all cost, revenue, price, and budget factors. Do not use other currency symbols unless the brief explicitly references them.`;
  }
  return `\n\n[CURRENCY_CONTEXT] No specific currency was detected in the brief. Infer the most appropriate currency from context. If uncertain, use £ (GBP).`;
}
