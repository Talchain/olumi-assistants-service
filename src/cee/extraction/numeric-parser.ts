/**
 * Numeric Value Parser
 *
 * Extracts and parses numeric values from text for intervention mapping.
 * Supports currencies, percentages, multipliers, and plain numbers.
 */

/**
 * Relative value kind for precise classification.
 */
export type RelativeKind = "percent" | "multiplier" | "delta";

/**
 * Parsed numeric value with metadata.
 */
export interface ParsedValue {
  /** The numeric value */
  value: number;
  /** Unit of measurement (e.g., "GBP", "USD", "percent", "months") */
  unit?: string;
  /** Whether this is a relative change (e.g., "increase by 20%") */
  isRelative: boolean;
  /** Type of relative change (legacy, use relativeKind instead) */
  relativeType?: "percent" | "absolute";
  /** Precise relative value classification */
  relativeKind?: RelativeKind;
  /** The relative value before resolution (e.g., 20 for "+20%", 2 for "2x") */
  relativeValue?: number;
  /** Direction of change for relative values */
  relativeDirection?: "increase" | "decrease";
  /** Confidence in the extraction */
  confidence: "high" | "medium" | "low";
  /** Original text that was parsed */
  originalText: string;
}

/**
 * Currency symbol to unit mapping.
 */
const CURRENCY_MAP: Record<string, string> = {
  "£": "GBP",
  "$": "USD",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "A$": "AUD",
  "C$": "CAD",
  "NZ$": "NZD",
  "CHF": "CHF",
  "kr": "SEK",
};

/**
 * Multiplier suffixes.
 */
const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  b: 1_000_000_000,
  B: 1_000_000_000,
  bn: 1_000_000_000,
  mn: 1_000_000,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Time unit patterns.
 */
const TIME_UNITS = ["day", "days", "week", "weeks", "month", "months", "year", "years", "hour", "hours"];

/**
 * Count unit patterns.
 */
const COUNT_UNITS = [
  "people",
  "person",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "employee",
  "employees",
  "user",
  "users",
  "customer",
  "customers",
  "unit",
  "units",
  "item",
  "items",
];

/**
 * Parse a numeric value from text.
 *
 * @param text - Text containing a numeric value
 * @returns Parsed value or null if no value found
 *
 * @example
 * parseNumericValue("£59") // { value: 59, unit: "GBP", ... }
 * parseNumericValue("$100k") // { value: 100000, unit: "USD", ... }
 * parseNumericValue("25%") // { value: 25, unit: "percent", ... }
 * parseNumericValue("increase by 20%") // { value: 20, isRelative: true, ... }
 */
export function parseNumericValue(text: string): ParsedValue | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();

  // Try each parser in order of specificity
  return (
    parseRelativeValue(trimmed) ||
    parseMultiplierValue(trimmed) ||
    parseCurrencyValue(trimmed) ||
    parsePercentageValue(trimmed) ||
    parseCountValue(trimmed) ||
    parsePlainNumber(trimmed)
  );
}

/**
 * Parse relative value expressions like "increase by 20%" or "increase price by 20%".
 */
function parseRelativeValue(text: string): ParsedValue | null {
  // Pattern: (increase|decrease|reduce|raise|lower|cut|boost|grow) [target] by X%
  // The target noun is optional and can be 1-3 words
  const relativePercentPattern =
    /\b(increase|decrease|reduce|raise|lower|cut|boost|grow|up|down)\s+(?:(?:the\s+)?(?:\w+(?:\s+\w+){0,2})\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i;
  const percentMatch = text.match(relativePercentPattern);

  if (percentMatch) {
    const direction = getRelativeDirection(percentMatch[1]);
    const percentValue = parseFloat(percentMatch[2]);
    // For decrease, store as negative relative value
    const signedRelativeValue = direction === "decrease" ? -percentValue : percentValue;
    return {
      value: percentValue,
      unit: "percent",
      isRelative: true,
      relativeType: "percent",
      relativeKind: "percent",
      relativeValue: signedRelativeValue,
      relativeDirection: direction,
      confidence: "high",
      originalText: percentMatch[0],
    };
  }

  // Pattern: (increase|decrease) [target] by £50
  // The target noun is optional and can be 1-3 words
  const relativeAbsolutePattern =
    /\b(increase|decrease|reduce|raise|lower|cut|boost|grow)\s+(?:(?:the\s+)?(?:\w+(?:\s+\w+){0,2})\s+)?(?:by\s+)?([£$€¥₹])\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmMbB]|thousand|million|billion)?/i;
  const absoluteMatch = text.match(relativeAbsolutePattern);

  if (absoluteMatch) {
    const direction = getRelativeDirection(absoluteMatch[1]);
    const currencySymbol = absoluteMatch[2];
    const numericPart = absoluteMatch[3].replace(/,/g, "");
    const multiplier = absoluteMatch[4] ? MULTIPLIERS[absoluteMatch[4]] || 1 : 1;
    const value = parseFloat(numericPart) * multiplier;
    // For decrease, store as negative delta
    const signedDelta = direction === "decrease" ? -value : value;

    return {
      value,
      unit: CURRENCY_MAP[currencySymbol] || currencySymbol,
      isRelative: true,
      relativeType: "absolute",
      relativeKind: "delta",
      relativeValue: signedDelta,
      relativeDirection: direction,
      confidence: "high",
      originalText: absoluteMatch[0],
    };
  }

  return null;
}

/**
 * Parse multiplier expressions like "double", "2x", "triple".
 */
function parseMultiplierValue(text: string): ParsedValue | null {
  // Named multipliers
  const namedMultipliers: Record<string, number> = {
    "double": 2,
    "triple": 3,
    "quadruple": 4,
    "halve": 0.5,
    "half": 0.5,
  };

  // Pattern: double/triple/halve the X
  const namedPattern = /\b(double|triple|quadruple|halve|half)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/i;
  const namedMatch = text.match(namedPattern);

  if (namedMatch) {
    const multiplierWord = namedMatch[1].toLowerCase();
    const multiplierValue = namedMultipliers[multiplierWord] || 2;
    return {
      value: multiplierValue,
      isRelative: true,
      relativeType: "percent",
      relativeKind: "multiplier",
      relativeValue: multiplierValue,
      relativeDirection: multiplierValue >= 1 ? "increase" : "decrease",
      confidence: "high",
      originalText: namedMatch[0],
    };
  }

  // Pattern: Nx, N times, N-fold
  const numericMultiplierPattern = /\b(\d+(?:\.\d+)?)\s*(?:x|times|fold)\b/i;
  const numericMatch = text.match(numericMultiplierPattern);

  if (numericMatch) {
    const multiplierValue = parseFloat(numericMatch[1]);
    return {
      value: multiplierValue,
      isRelative: true,
      relativeType: "percent",
      relativeKind: "multiplier",
      relativeValue: multiplierValue,
      relativeDirection: multiplierValue >= 1 ? "increase" : "decrease",
      confidence: "high",
      originalText: numericMatch[0],
    };
  }

  return null;
}

/**
 * Determine direction from relative keyword.
 */
function getRelativeDirection(keyword: string): "increase" | "decrease" {
  const decreaseWords = ["decrease", "reduce", "lower", "cut", "down"];
  return decreaseWords.includes(keyword.toLowerCase()) ? "decrease" : "increase";
}

/**
 * Parse currency values like £59, $100k, €2.5m.
 */
function parseCurrencyValue(text: string): ParsedValue | null {
  // Pattern: £59, $100, €45, £10k, $2.5m
  const currencyPattern =
    /([£$€¥₹]|A\$|C\$|NZ\$|CHF|kr)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmMbB]|thousand|million|billion)?(?:\s*(GBP|USD|EUR|JPY|INR|AUD|CAD|NZD|CHF|SEK))?/i;
  const match = text.match(currencyPattern);

  if (match) {
    const currencySymbol = match[1];
    const numericPart = match[2].replace(/,/g, "");
    const multiplierKey = match[3];
    const explicitUnit = match[4];
    const multiplier = multiplierKey ? MULTIPLIERS[multiplierKey] || 1 : 1;
    const value = parseFloat(numericPart) * multiplier;

    return {
      value,
      unit: explicitUnit || CURRENCY_MAP[currencySymbol] || currencySymbol,
      isRelative: false,
      confidence: "high",
      originalText: match[0],
    };
  }

  // Also try: 100 GBP, 50 USD format
  const postfixPattern = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmMbB])?\s*(GBP|USD|EUR|JPY|INR|AUD|CAD|NZD|CHF|SEK)/i;
  const postfixMatch = text.match(postfixPattern);

  if (postfixMatch) {
    const numericPart = postfixMatch[1].replace(/,/g, "");
    const multiplierKey = postfixMatch[2];
    const unit = postfixMatch[3].toUpperCase();
    const multiplier = multiplierKey ? MULTIPLIERS[multiplierKey] || 1 : 1;
    const value = parseFloat(numericPart) * multiplier;

    return {
      value,
      unit,
      isRelative: false,
      confidence: "high",
      originalText: postfixMatch[0],
    };
  }

  return null;
}

/**
 * Parse percentage values like 25%, 3.5%.
 */
function parsePercentageValue(text: string): ParsedValue | null {
  // Pattern: 25%, 3.5%, -10%
  const percentPattern = /(-?\d+(?:\.\d+)?)\s*%/;
  const match = text.match(percentPattern);

  if (match) {
    return {
      value: parseFloat(match[1]),
      unit: "percent",
      isRelative: false,
      confidence: "high",
      originalText: match[0],
    };
  }

  // Pattern: 25 percent, twenty percent
  const percentWordPattern = /(\d+(?:\.\d+)?)\s+percent/i;
  const wordMatch = text.match(percentWordPattern);

  if (wordMatch) {
    return {
      value: parseFloat(wordMatch[1]),
      unit: "percent",
      isRelative: false,
      confidence: "medium",
      originalText: wordMatch[0],
    };
  }

  return null;
}

/**
 * Parse count values like "2 engineers", "3 months".
 */
function parseCountValue(text: string): ParsedValue | null {
  // Time units
  for (const unit of TIME_UNITS) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "i");
    const match = text.match(pattern);
    if (match) {
      // Normalize to singular form
      const normalizedUnit = unit.replace(/s$/, "");
      return {
        value: parseFloat(match[1]),
        unit: normalizedUnit,
        isRelative: false,
        confidence: "high",
        originalText: match[0],
      };
    }
  }

  // Count units
  for (const unit of COUNT_UNITS) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "i");
    const match = text.match(pattern);
    if (match) {
      // Normalize to singular form
      const normalizedUnit = unit.replace(/s$/, "").replace(/ies$/, "y");
      return {
        value: parseFloat(match[1]),
        unit: normalizedUnit,
        isRelative: false,
        confidence: "high",
        originalText: match[0],
      };
    }
  }

  return null;
}

/**
 * Parse plain numbers like 50,000 or 100000.
 */
function parsePlainNumber(text: string): ParsedValue | null {
  // Pattern: plain number, possibly with commas
  const numberPattern = /^(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmMbB]|thousand|million|billion)?$/;
  const match = text.match(numberPattern);

  if (match) {
    const numericPart = match[1].replace(/,/g, "");
    const multiplierKey = match[2];
    const multiplier = multiplierKey ? MULTIPLIERS[multiplierKey] || 1 : 1;
    const value = parseFloat(numericPart) * multiplier;

    return {
      value,
      isRelative: false,
      confidence: "medium",
      originalText: match[0],
    };
  }

  return null;
}

/**
 * Resolve a relative value to an absolute value given a baseline.
 *
 * @param parsed - Parsed relative value
 * @param baseline - Baseline value to apply change to
 * @returns Resolved absolute value
 *
 * @example
 * // Increase by 20%
 * resolveRelativeValue({ value: 20, relativeKind: "percent", relativeValue: 20 }, 100)
 * // Returns 120
 *
 * // Decrease by £5
 * resolveRelativeValue({ value: 5, relativeKind: "delta", relativeValue: -5 }, 50)
 * // Returns 45
 *
 * // Double the value
 * resolveRelativeValue({ value: 2, relativeKind: "multiplier", relativeValue: 2 }, 50)
 * // Returns 100
 */
export function resolveRelativeValue(parsed: ParsedValue, baseline: number): number {
  if (!parsed.isRelative) {
    return parsed.value;
  }

  // Use relativeKind if available (new format), fall back to relativeType (legacy)
  const kind = parsed.relativeKind || (parsed.relativeType === "percent" ? "percent" : "delta");

  switch (kind) {
    case "percent": {
      // relativeValue is signed: +20 means +20%, -20 means -20%
      const _percentChange = parsed.relativeValue ?? parsed.value;
      // Handle direction from legacy format
      const signedPercent = parsed.relativeValue !== undefined
        ? parsed.relativeValue
        : (parsed.relativeDirection === "decrease" ? -parsed.value : parsed.value);
      return baseline * (1 + signedPercent / 100);
    }
    case "multiplier": {
      // relativeValue is the multiplier (e.g., 2 for "double")
      const multiplier = parsed.relativeValue ?? parsed.value;
      return baseline * multiplier;
    }
    case "delta": {
      // relativeValue is signed: +50000 for "add $50k", -50000 for "reduce by $50k"
      const delta = parsed.relativeValue !== undefined
        ? parsed.relativeValue
        : (parsed.relativeDirection === "decrease" ? -parsed.value : parsed.value);
      return baseline + delta;
    }
    default: {
      // Legacy fallback
      const direction = parsed.relativeDirection === "decrease" ? -1 : 1;
      if (parsed.relativeType === "percent") {
        return baseline * (1 + (parsed.value / 100) * direction);
      } else {
        return baseline + parsed.value * direction;
      }
    }
  }
}

/**
 * Resolve a relative value to an absolute value using the relativeKind classification.
 *
 * @param relativeKind - Type of relative value
 * @param relativeValue - Signed relative value
 * @param baseline - Baseline value to apply change to
 * @returns Resolved absolute value
 */
export function resolveToAbsolute(
  relativeKind: RelativeKind,
  relativeValue: number,
  baseline: number
): number {
  switch (relativeKind) {
    case "percent":
      // "+20%" means baseline * 1.2, "-20%" means baseline * 0.8
      return baseline * (1 + relativeValue / 100);
    case "multiplier":
      // "2x" means baseline * 2
      return baseline * relativeValue;
    case "delta":
      // "+$50k" means baseline + 50000, "-$50k" means baseline - 50000
      return baseline + relativeValue;
  }
}

/**
 * Extract all numeric values from a text string.
 *
 * @param text - Text to extract values from
 * @returns Array of parsed values
 */
export function extractAllNumericValues(text: string): ParsedValue[] {
  const results: ParsedValue[] = [];

  // Split on common delimiters and try to parse each segment
  const segments = text.split(/[,;]|\band\b|\bor\b/i);

  for (const segment of segments) {
    const parsed = parseNumericValue(segment.trim());
    if (parsed) {
      results.push(parsed);
    }
  }

  // Also look for inline values that might not be split
  const inlinePatterns = [
    // Currency values
    /[£$€¥₹]\s*\d+(?:,\d{3})*(?:\.\d+)?\s*[kKmMbB]?/g,
    // Percentages
    /\d+(?:\.\d+)?\s*%/g,
  ];

  for (const pattern of inlinePatterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const parsed = parseNumericValue(match);
      if (parsed && !results.some((r) => r.originalText === parsed.originalText)) {
        results.push(parsed);
      }
    }
  }

  return results;
}

/**
 * Format a parsed value back to a human-readable string.
 *
 * @param parsed - Parsed value to format
 * @returns Formatted string
 */
export function formatParsedValue(parsed: ParsedValue): string {
  const { value, unit, isRelative, relativeType, relativeDirection } = parsed;

  if (isRelative) {
    const direction = relativeDirection === "decrease" ? "decrease" : "increase";
    if (relativeType === "percent") {
      return `${direction} by ${value}%`;
    } else {
      const prefix = unit && CURRENCY_MAP[unit] ? getCurrencySymbol(unit) : "";
      return `${direction} by ${prefix}${value.toLocaleString()}${unit && !prefix ? ` ${unit}` : ""}`;
    }
  }

  // Absolute value
  if (unit === "percent") {
    return `${value}%`;
  }

  const currencySymbol = unit ? getCurrencySymbol(unit) : "";
  if (currencySymbol) {
    return `${currencySymbol}${value.toLocaleString()}`;
  }

  if (unit) {
    return `${value.toLocaleString()} ${unit}`;
  }

  return value.toLocaleString();
}

/**
 * Get currency symbol from unit code.
 */
function getCurrencySymbol(unit: string): string {
  const reverseMap: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    JPY: "¥",
    INR: "₹",
  };
  return reverseMap[unit] || "";
}
