/**
 * CEE Factor Extraction Module
 *
 * Extracts quantitative factors from natural language briefs.
 * Enables ISL sensitivity, VoI, and tipping point analysis.
 *
 * Supports two extraction modes:
 * - LLM-first (when CEE_LLM_FIRST_EXTRACTION_ENABLED=true): Uses LLM with market context,
 *   with regex as validation/fallback
 * - Regex-only (default): Uses pattern matching for explicit/inferred/range extractions
 *
 * Patterns detected (regex mode):
 * - Currency values: £49, $100, €50
 * - Currency with multipliers: $1 million, £2.5m, €500k, $1B
 * - Percentages: 5%, 3.5%
 * - From-to transitions: "from £49 to £59", "from 3% to 5%"
 * - Increase/decrease language: "increase from 10 to 20"
 */

import { log } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import type { ExtractionType } from "../transforms/value-uncertainty-derivation.js";
import type { ResolvedContext, SupportedDomain } from "../../context/index.js";
import { resolveContext } from "../../context/index.js";
import { extractFactorsLLM } from "./llm-extractor.js";
import { mergeFactors, type MergeResult } from "./merge.js";

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
  /** How the value was extracted */
  extractionType: ExtractionType;
  /** For range extractions: minimum bound */
  rangeMin?: number;
  /** For range extractions: maximum bound */
  rangeMax?: number;
}

// Re-export ExtractionType for convenience
export type { ExtractionType } from "../transforms/value-uncertainty-derivation.js";

// Currency symbols and their names
const _CURRENCY_MAP: Record<string, string> = {
  "£": "GBP",
  "$": "USD",
  "€": "EUR",
};

// Multiplier values for k, m, b, million, billion, etc.
const MULTIPLIER_MAP: Record<string, number> = {
  "k": 1_000,
  "K": 1_000,
  "m": 1_000_000,
  "M": 1_000_000,
  "million": 1_000_000,
  "Million": 1_000_000,
  "b": 1_000_000_000,
  "B": 1_000_000_000,
  "billion": 1_000_000_000,
  "Billion": 1_000_000_000,
  "t": 1_000_000_000_000,
  "T": 1_000_000_000_000,
  "trillion": 1_000_000_000_000,
  "Trillion": 1_000_000_000_000,
};

/**
 * Parse a multiplier string (k, m, million, etc.) to its numeric value
 */
function parseMultiplier(multiplier: string | undefined): number {
  if (!multiplier) return 1;
  return MULTIPLIER_MAP[multiplier.trim()] ?? 1;
}

// Regex patterns for quantitative language
const PATTERNS = {
  // Currency with multiplier: $1 million, £2.5m, €500k, $1B, $1.5 billion
  currencyWithMultiplier:
    /(?<currency>[£$€])(?<amount>\d+(?:\.\d+)?)\s*(?<multiplier>k|m|b|t|million|billion|trillion)\b/gi,

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

  // Approximate values: "around £60", "roughly 50", "approximately $100"
  approximateValue:
    /(?:around|roughly|approximately|about|circa|~)\s*(?<currency>[£$€])?(?<amount>\d+(?:\.\d+)?)\s*(?<unit>%)?/gi,

  // Range with currency: "between £50-70", "£50-£70", "50-70 dollars"
  currencyRange:
    /(?:between\s+)?(?<currency>[£$€])(?<min>\d+(?:\.\d+)?)\s*[-–—to]+\s*(?:[£$€])?(?<max>\d+(?:\.\d+)?)/gi,

  // Range with percentage: "between 5-10%", "5%-10%"
  percentRange:
    /(?:between\s+)?(?<min>\d+(?:\.\d+)?)\s*%?\s*[-–—to]+\s*(?<max>\d+(?:\.\d+)?)\s*%/gi,

  // Generic range: "between 50 and 70", "50 to 70"
  genericRange:
    /between\s+(?<min>\d+(?:\.\d+)?)\s+(?:and|to)\s+(?<max>\d+(?:\.\d+)?)/gi,
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
 * Generate deduplication key from label, value, and unit.
 * Uses normalized label (lowercase, trimmed) for consistent matching.
 */
function dedupKey(label: string, value: number, unit?: string): string {
  const normalizedLabel = label.toLowerCase().trim();
  const normalizedUnit = unit ?? "num";
  return `${normalizedLabel}:${value}:${normalizedUnit}`;
}

/**
 * Extract quantitative factors from a brief
 */
export function extractFactors(brief: string): ExtractedFactor[] {
  const factors: ExtractedFactor[] = [];
  const seenFactors = new Set<string>(); // Dedup by label+value+unit

  let match: RegExpExecArray | null;

  // ============================================================================
  // RANGE EXTRACTIONS (highest priority for uncertainty derivation)
  // ============================================================================

  // Extract currency ranges: "between £50-70", "£50-£70"
  const currencyRangeRegex = new RegExp(PATTERNS.currencyRange.source, "gi");
  while ((match = currencyRangeRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const min = parseFloat(match.groups?.min || "0");
    const max = parseFloat(match.groups?.max || "0");
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        unit: currency,
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract percentage ranges: "between 5-10%", "5%-10%"
  const percentRangeRegex = new RegExp(PATTERNS.percentRange.source, "gi");
  while ((match = percentRangeRegex.exec(brief)) !== null) {
    const min = parseFloat(match.groups?.min || "0") / 100;
    const max = parseFloat(match.groups?.max || "0") / 100;
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        unit: "%",
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract generic ranges: "between 50 and 70"
  const genericRangeRegex = new RegExp(PATTERNS.genericRange.source, "gi");
  while ((match = genericRangeRegex.exec(brief)) !== null) {
    const min = parseFloat(match.groups?.min || "0");
    const max = parseFloat(match.groups?.max || "0");
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, undefined);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // APPROXIMATE EXTRACTIONS (inferred type)
  // ============================================================================

  // Extract approximate values: "around £60", "roughly 50"
  const approximateRegex = new RegExp(PATTERNS.approximateValue.source, "gi");
  while ((match = approximateRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency;
    const amount = parseFloat(match.groups?.amount || "0");
    const unitMatch = match.groups?.unit;
    const unit = unitMatch === "%" ? "%" : currency;
    const normalizedValue = unitMatch === "%" ? amount / 100 : amount;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        unit,
        confidence: 0.70,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // EXPLICIT EXTRACTIONS (highest confidence)
  // ============================================================================

  // Extract currency from-to patterns (highest priority for explicit)
  const currencyFromToRegex = new RegExp(PATTERNS.currencyFromTo.source, "gi");
  while ((match = currencyFromToRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency1 || "";
    const from = parseFloat(match.groups?.from || "0");
    const to = parseFloat(match.groups?.to || "0");
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, to, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: to,
        baseline: from,
        unit: currency,
        confidence: 0.95,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: to, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract percentage from-to patterns
  const percentFromToRegex = new RegExp(PATTERNS.percentFromTo.source, "gi");
  while ((match = percentFromToRegex.exec(brief)) !== null) {
    const from = parseFloat(match.groups?.from || "0") / 100;
    const to = parseFloat(match.groups?.to || "0") / 100;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, to, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: to,
        baseline: from,
        unit: "%",
        confidence: 0.90,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: to, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
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
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        baseline: normalizedBaseline,
        unit,
        confidence: 0.85,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract contextual numbers: "price is £59"
  const contextualRegex = new RegExp(PATTERNS.contextualNumber.source, "gi");
  while ((match = contextualRegex.exec(brief)) !== null) {
    const context = match.groups?.context || "";
    const amount = parseFloat(match.groups?.amount || "0");
    const isPercent = match[0].includes("%");
    const hasCurrency = /[£$€]/.test(match[0]);
    const unit = isPercent ? "%" : hasCurrency ? match[0].match(/[£$€]/)?.[0] : undefined;

    const normalizedValue = isPercent ? amount / 100 : amount;
    const label = context.charAt(0).toUpperCase() + context.slice(1);
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        unit,
        confidence: 0.90,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract currency with multipliers: $1 million, £2.5m
  const currencyMultiplierRegex = new RegExp(PATTERNS.currencyWithMultiplier.source, "gi");
  while ((match = currencyMultiplierRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const baseAmount = parseFloat(match.groups?.amount || "0");
    const multiplier = parseMultiplier(match.groups?.multiplier);
    const amount = baseAmount * multiplier;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: currency,
        confidence: 0.85,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: amount, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // INFERRED EXTRACTIONS (lower confidence, gap fillers)
  // ============================================================================

  // Extract standalone currency values (inferred from context)
  const currencyRegex = new RegExp(PATTERNS.currency.source, "gi");
  while ((match = currencyRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const amount = parseFloat(match.groups?.amount || "0");
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: currency,
        confidence: 0.60,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: amount, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract standalone percentages (inferred from context)
  const percentRegex = new RegExp(PATTERNS.percentage.source, "gi");
  while ((match = percentRegex.exec(brief)) !== null) {
    const amount = parseFloat(match.groups?.amount || "0") / 100;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: "%",
        confidence: 0.60,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: amount, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Count extraction types for telemetry
  const explicitCount = factors.filter((f) => f.extractionType === "explicit").length;
  const inferredCount = factors.filter((f) => f.extractionType === "inferred").length;
  const rangeCount = factors.filter((f) => f.extractionType === "range").length;

  log.debug({
    event: "cee.factor_extraction.complete",
    factorCount: factors.length,
    explicitCount,
    inferredCount,
    rangeCount,
    deduplicatedCount: seenFactors.size,
  }, "Factor extraction complete");

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

// ============================================================================
// LLM-First Orchestration
// ============================================================================

/**
 * Alias for regex-based extraction (for clarity when using with LLM orchestration)
 */
export const extractFactorsRegex = extractFactors;

/**
 * Options for orchestrated factor extraction
 */
export interface OrchestratedExtractionOptions {
  /** Market context domain override (auto-detected if not specified) */
  domain?: SupportedDomain;
  /** Pre-resolved context (if already available) */
  context?: ResolvedContext;
  /** Force regex-only extraction even if LLM is enabled */
  forceRegex?: boolean;
  /** Force LLM extraction even if disabled (for testing) */
  forceLLM?: boolean;
  /** Optional model override (e.g., "claude-sonnet-4-20250514") */
  modelOverride?: string;
}

/**
 * Result from orchestrated extraction
 */
export interface OrchestratedExtractionResult {
  /** Extracted factors */
  factors: ExtractedFactor[];
  /** Extraction mode used */
  mode: "llm-first" | "regex-only";
  /** Whether LLM extraction succeeded */
  llmSuccess?: boolean;
  /** Merge statistics (if LLM was used) */
  mergeStats?: MergeResult["stats"];
  /** Any warnings from extraction */
  warnings: string[];
}

/**
 * Orchestrated factor extraction with LLM-first support.
 *
 * When CEE_LLM_FIRST_EXTRACTION_ENABLED=true:
 * 1. Resolves market context for the brief
 * 2. Calls LLM for factor extraction
 * 3. Runs regex extraction as fallback/validation
 * 4. Merges results with LLM taking precedence
 *
 * When disabled (default):
 * - Uses regex-only extraction (original behavior)
 *
 * @param brief - The decision brief text
 * @param options - Extraction options
 * @returns Extraction result with factors and metadata
 */
export async function extractFactorsOrchestrated(
  brief: string,
  options: OrchestratedExtractionOptions = {}
): Promise<OrchestratedExtractionResult> {
  const { domain, context: providedContext, forceRegex = false, forceLLM = false, modelOverride } = options;
  const warnings: string[] = [];

  // Check feature flag
  const llmEnabled = config.cee.llmFirstExtractionEnabled;
  const useLLM = (llmEnabled || forceLLM) && !forceRegex;

  if (!useLLM) {
    // Regex-only mode (default)
    log.debug({ event: "cee.factor_extraction.mode", mode: "regex-only" }, "Using regex-only extraction");
    const factors = extractFactors(brief);
    return {
      factors,
      mode: "regex-only",
      warnings: [],
    };
  }

  // LLM-first mode
  log.debug({ event: "cee.factor_extraction.mode", mode: "llm-first" }, "Using LLM-first extraction");

  // Resolve context
  const context = providedContext ?? resolveContext(brief, domain);

  // Run LLM extraction
  const llmResult = await extractFactorsLLM(brief, {
    context,
    maxFactors: 20,
    minConfidence: 0.5,
    validateHallucinations: true,
    modelOverride,
  });

  if (llmResult.warnings.length > 0) {
    warnings.push(...llmResult.warnings);
  }

  // Always run regex as fallback/validation
  const regexFactors = extractFactors(brief);

  if (!llmResult.success || llmResult.factors.length === 0) {
    // LLM failed, use regex only
    log.info(
      {
        event: "cee.factor_extraction.llm_fallback",
        llmError: llmResult.error,
        regexFactorCount: regexFactors.length,
      },
      "LLM extraction failed, using regex fallback"
    );
    return {
      factors: regexFactors,
      mode: "llm-first",
      llmSuccess: false,
      warnings,
    };
  }

  // Merge LLM and regex results
  const mergeResult = mergeFactors(llmResult.factors, regexFactors, {
    llmConfidenceThreshold: 0.7,
    context,
  });

  log.info(
    {
      event: "cee.factor_extraction.orchestrated_complete",
      llmFactorCount: llmResult.factors.length,
      regexFactorCount: regexFactors.length,
      mergedFactorCount: mergeResult.factors.length,
      ...mergeResult.stats,
    },
    "Orchestrated extraction complete"
  );

  return {
    factors: mergeResult.factors,
    mode: "llm-first",
    llmSuccess: true,
    mergeStats: mergeResult.stats,
    warnings,
  };
}

// Re-export types and functions from sub-modules
export type { MergedFactor, MergeResult } from "./merge.js";
export { mergeFactors, normalizeLabel, labelSimilarity, deduplicateFactors } from "./merge.js";
export { extractFactorsLLM, type LLMExtractionOptions, type LLMExtractionResult } from "./llm-extractor.js";
