/**
 * CEE Factor Extraction Module
 *
 * Extracts quantitative factors from natural language briefs.
 * Enables ISL sensitivity, VoI, and tipping point analysis.
 *
 * Patterns detected:
 * - Currency values: £49, $100, €50
 * - Percentages: 5%, 3.5%
 * - From-to transitions: "from £49 to £59", "from 3% to 5%"
 * - Increase/decrease language: "increase from 10 to 20"
 */

import { log } from "../../utils/telemetry.js";

export interface ExtractedFactor {
  /** Human-readable label for the factor */
  label: string;
  /** Current or proposed value */
  value: number;
  /** Baseline value (from "from X to Y" patterns) */
  baseline?: number;
  /** Unit of measurement */
  unit?: string;
  /** Extraction confidence (0-1) */
  confidence: number;
  /** Original text that was matched */
  matchedText: string;
}

// Currency symbols and their names
const CURRENCY_MAP: Record<string, string> = {
  "£": "GBP",
  "$": "USD",
  "€": "EUR",
};

// Regex patterns for quantitative language
const PATTERNS = {
  // Currency with optional decimals: £49, $100.50, €50
  currency: /(?<currency>[£$€])(?<amount>\d+(?:\.\d+)?)/g,

  // Percentage: 5%, 3.5%, 10 percent
  percentage: /(?<amount>\d+(?:\.\d+)?)\s*(?:%|percent)/gi,

  // From-to with currency: "from £49 to £59"
  currencyFromTo:
    /from\s+(?<currency1>[£$€])(?<from>\d+(?:\.\d+)?)\s+to\s+(?:[£$€])?(?<to>\d+(?:\.\d+)?)/gi,

  // From-to with percentage: "from 3% to 5%"
  percentFromTo:
    /from\s+(?<from>\d+(?:\.\d+)?)\s*%?\s+to\s+(?:maybe\s+)?(?<to>\d+(?:\.\d+)?)\s*%/gi,

  // Increase/decrease patterns: "increase from 10 to 20", "increasing by 5%"
  changePattern:
    /(?<direction>increas|decreas|rais|lower|grow|drop|fall|rise)(?:e|ing|ed)?\s+(?:from\s+)?(?<from>\d+(?:\.\d+)?)\s*(?:%|[£$€])?\s+(?:to\s+)?(?:maybe\s+)?(?<to>\d+(?:\.\d+)?)/gi,

  // Plain numbers with context: "price of 49", "rate of 3.5"
  contextualNumber:
    /(?<context>price|cost|rate|revenue|budget|margin|churn|conversion|growth|target|threshold|limit)\s+(?:of|is|at|was|be)?\s*(?:[£$€])?(?<amount>\d+(?:\.\d+)?)\s*(?:%)?/gi,
};

/**
 * Infer a label from the surrounding context of a match
 */
function inferLabel(brief: string, matchIndex: number, matchText: string): string {
  // Look for context words before the match
  const beforeText = brief.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();

  // Common context patterns
  const contextPatterns = [
    { pattern: /price/i, label: "Price" },
    { pattern: /cost/i, label: "Cost" },
    { pattern: /revenue/i, label: "Revenue" },
    { pattern: /budget/i, label: "Budget" },
    { pattern: /churn/i, label: "Churn Rate" },
    { pattern: /conversion/i, label: "Conversion Rate" },
    { pattern: /growth/i, label: "Growth Rate" },
    { pattern: /margin/i, label: "Margin" },
    { pattern: /subscription/i, label: "Subscription Price" },
    { pattern: /plan/i, label: "Plan Price" },
    { pattern: /trial/i, label: "Trial Period" },
    { pattern: /user/i, label: "User Count" },
    { pattern: /customer/i, label: "Customer Count" },
    { pattern: /retention/i, label: "Retention Rate" },
    { pattern: /attrition/i, label: "Attrition Rate" },
    { pattern: /discount/i, label: "Discount" },
    { pattern: /fee/i, label: "Fee" },
    { pattern: /salary|wage/i, label: "Salary" },
    { pattern: /headcount|staff/i, label: "Headcount" },
  ];

  for (const { pattern, label } of contextPatterns) {
    if (pattern.test(beforeText)) {
      return label;
    }
  }

  // Default: use the matched text as a hint
  if (matchText.includes("%")) {
    return "Rate";
  }
  if (/[£$€]/.test(matchText)) {
    return "Value";
  }

  return "Factor";
}

/**
 * Extract quantitative factors from a brief
 */
export function extractFactors(brief: string): ExtractedFactor[] {
  const factors: ExtractedFactor[] = [];
  const seenValues = new Set<string>(); // Dedup by value+unit

  // Extract currency from-to patterns (highest priority)
  let match: RegExpExecArray | null;
  const currencyFromToRegex = new RegExp(PATTERNS.currencyFromTo.source, "gi");
  while ((match = currencyFromToRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency1 || "";
    const from = parseFloat(match.groups?.from || "0");
    const to = parseFloat(match.groups?.to || "0");
    const key = `${to}-${currency}`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: inferLabel(brief, match.index, match[0]),
        value: to,
        baseline: from,
        unit: currency,
        confidence: 0.9,
        matchedText: match[0],
      });
    }
  }

  // Extract percentage from-to patterns
  const percentFromToRegex = new RegExp(PATTERNS.percentFromTo.source, "gi");
  while ((match = percentFromToRegex.exec(brief)) !== null) {
    const from = parseFloat(match.groups?.from || "0") / 100;
    const to = parseFloat(match.groups?.to || "0") / 100;
    const key = `${to}-%`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: inferLabel(brief, match.index, match[0]),
        value: to,
        baseline: from,
        unit: "%",
        confidence: 0.85,
        matchedText: match[0],
      });
    }
  }

  // Extract change patterns (increase/decrease)
  const changeRegex = new RegExp(PATTERNS.changePattern.source, "gi");
  while ((match = changeRegex.exec(brief)) !== null) {
    const from = parseFloat(match.groups?.from || "0");
    const to = parseFloat(match.groups?.to || "0");
    const isPercent = match[0].includes("%");
    const hasCurrency = /[£$€]/.test(match[0]);
    const unit = isPercent ? "%" : hasCurrency ? match[0].match(/[£$€]/)?.[0] : undefined;

    const normalizedValue = isPercent ? to / 100 : to;
    const normalizedBaseline = isPercent ? from / 100 : from;
    const key = `${normalizedValue}-${unit || "num"}`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: inferLabel(brief, match.index, match[0]),
        value: normalizedValue,
        baseline: normalizedBaseline,
        unit,
        confidence: 0.8,
        matchedText: match[0],
      });
    }
  }

  // Extract contextual numbers (lower priority, may overlap)
  const contextualRegex = new RegExp(PATTERNS.contextualNumber.source, "gi");
  while ((match = contextualRegex.exec(brief)) !== null) {
    const context = match.groups?.context || "";
    const amount = parseFloat(match.groups?.amount || "0");
    const isPercent = match[0].includes("%");
    const hasCurrency = /[£$€]/.test(match[0]);
    const unit = isPercent ? "%" : hasCurrency ? match[0].match(/[£$€]/)?.[0] : undefined;

    const normalizedValue = isPercent ? amount / 100 : amount;
    const key = `${normalizedValue}-${unit || "num"}`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: context.charAt(0).toUpperCase() + context.slice(1),
        value: normalizedValue,
        unit,
        confidence: 0.7,
        matchedText: match[0],
      });
    }
  }

  // Extract standalone currency values (lowest priority, gap filler)
  const currencyRegex = new RegExp(PATTERNS.currency.source, "gi");
  while ((match = currencyRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const amount = parseFloat(match.groups?.amount || "0");
    const key = `${amount}-${currency}`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: inferLabel(brief, match.index, match[0]),
        value: amount,
        unit: currency,
        confidence: 0.6,
        matchedText: match[0],
      });
    }
  }

  // Extract standalone percentages (lowest priority, gap filler)
  const percentRegex = new RegExp(PATTERNS.percentage.source, "gi");
  while ((match = percentRegex.exec(brief)) !== null) {
    const amount = parseFloat(match.groups?.amount || "0") / 100;
    const key = `${amount}-%`;

    if (!seenValues.has(key)) {
      seenValues.add(key);
      factors.push({
        label: inferLabel(brief, match.index, match[0]),
        value: amount,
        unit: "%",
        confidence: 0.6,
        matchedText: match[0],
      });
    }
  }

  log.debug({ factorCount: factors.length }, "Extracted factors from brief");

  return factors;
}

/**
 * Generate a unique factor node ID
 */
export function generateFactorId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 20);
  return `factor_${slug}_${index}`;
}
