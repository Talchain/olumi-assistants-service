/**
 * Factor Merge Logic
 *
 * Merges factors from LLM extraction and regex extraction.
 * LLM factors take precedence when confidence is high enough.
 * Regex factors fill gaps and validate LLM extractions.
 */

import { log } from "../../utils/telemetry.js";
import type { ExtractedFactor } from "./index.js";
import type { ResolvedContext, ExtractionSource } from "../../context/index.js";

// ============================================================================
// Types
// ============================================================================

export interface MergedFactor extends ExtractedFactor {
  /** Source of the final value */
  mergeSource: ExtractionSource;
  /** Original LLM factor if merged */
  llmOriginal?: ExtractedFactor;
  /** Original regex factor if merged */
  regexOriginal?: ExtractedFactor;
}

export interface MergeOptions {
  /** Minimum LLM confidence to take precedence over regex (default: 0.7) */
  llmConfidenceThreshold?: number;
  /** Context for alias matching */
  context?: ResolvedContext;
  /** Maximum label similarity distance for matching (default: 0.3) */
  maxLabelDistance?: number;
}

export interface MergeResult {
  /** Merged factors */
  factors: MergedFactor[];
  /** Statistics about the merge */
  stats: MergeStats;
}

export interface MergeStats {
  /** Total factors in result */
  total: number;
  /** Factors from LLM only */
  llmOnly: number;
  /** Factors from regex only */
  regexOnly: number;
  /** Factors merged (both sources agreed) */
  merged: number;
  /** Factors where LLM took precedence */
  llmPrecedence: number;
  /** Factors where regex took precedence */
  regexPrecedence: number;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a label for matching.
 * Lowercase, trim, remove common suffixes, handle aliases.
 */
export function normalizeLabel(label: string, context?: ResolvedContext): string {
  let normalized = label.toLowerCase().trim();

  // Remove common suffixes
  normalized = normalized
    .replace(/\s*(rate|value|price|cost|amount)$/i, "")
    .trim();

  // Check for alias expansion in context
  if (context) {
    for (const term of context.glossary) {
      // Check if label matches term or any alias
      const termLower = term.term.toLowerCase();
      if (normalized === termLower) {
        return termLower;
      }
      for (const alias of term.aliases) {
        if (normalized === alias.toLowerCase()) {
          return termLower; // Normalize to canonical term
        }
      }
    }
  }

  return normalized;
}

/**
 * Calculate similarity between two labels.
 * Returns a score from 0 (no match) to 1 (exact match).
 */
export function labelSimilarity(
  label1: string,
  label2: string,
  context?: ResolvedContext
): number {
  const norm1 = normalizeLabel(label1, context);
  const norm2 = normalizeLabel(label2, context);

  // Exact match after normalization
  if (norm1 === norm2) {
    return 1.0;
  }

  // One contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const shorter = Math.min(norm1.length, norm2.length);
    const longer = Math.max(norm1.length, norm2.length);
    return shorter / longer;
  }

  // Word overlap
  const words1 = new Set(norm1.split(/\s+/).filter((w) => w.length > 2));
  const words2 = new Set(norm2.split(/\s+/).filter((w) => w.length > 2));

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      overlap++;
    }
  }

  return overlap / Math.max(words1.size, words2.size);
}

// ============================================================================
// Unit Compatibility
// ============================================================================

/**
 * Unit compatibility groups.
 * Units in the same group can be matched against each other.
 * Both singular and plural forms should be included.
 */
const UNIT_COMPATIBILITY_GROUPS: Record<string, string[]> = {
  currency: ["$", "£", "€", "USD", "GBP", "EUR", "dollar", "dollars", "pound", "pounds", "euro", "euros"],
  percentage: ["%", "percent", "percentage"],
  count: ["", "user", "users", "customer", "customers", "person", "people", "fte", "ftes", "seat", "seats", "unit", "units", "subscriber", "subscribers", "license", "licenses"],
  time: ["month", "months", "year", "years", "day", "days", "week", "weeks", "quarter", "quarters"],
  ratio: ["x", ":1", "ratio"],
};

/**
 * Normalize a unit by converting to singular/canonical form.
 * Handles common plural patterns and synonyms.
 */
function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase().trim();

  // Handle common suffix patterns
  const suffixMappings: Array<[RegExp, string]> = [
    // Regular plurals ending in 's'
    [/^users$/i, "user"],
    [/^customers$/i, "customer"],
    [/^subscribers$/i, "subscriber"],
    [/^licenses$/i, "license"],
    [/^seats$/i, "seat"],
    [/^units$/i, "unit"],
    [/^dollars$/i, "dollar"],
    [/^pounds$/i, "pound"],
    [/^euros$/i, "euro"],
    [/^months$/i, "month"],
    [/^years$/i, "year"],
    [/^days$/i, "day"],
    [/^weeks$/i, "week"],
    [/^quarters$/i, "quarter"],
    [/^ftes$/i, "fte"],
    // Special cases
    [/^people$/i, "person"],
    [/^percentage$/i, "percent"],
  ];

  for (const [pattern, replacement] of suffixMappings) {
    if (pattern.test(lower)) {
      return replacement;
    }
  }

  // Generic: strip trailing 's' if length > 3 (avoid "gas" -> "ga")
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }

  return lower;
}

/**
 * Check if two units are compatible for matching.
 * Units are compatible if:
 * 1. They are exactly the same (including undefined)
 * 2. They normalize to the same form (singular/plural handling)
 * 3. They belong to the same compatibility group
 * 4. Both are undefined/empty (no unit specified)
 */
export function unitsAreCompatible(unit1: string | undefined, unit2: string | undefined): boolean {
  // Normalize undefined to empty string for comparison
  const u1 = (unit1 || "").toLowerCase().trim();
  const u2 = (unit2 || "").toLowerCase().trim();

  // Exact match (including both empty)
  if (u1 === u2) {
    return true;
  }

  // Normalize and compare (handles singular/plural)
  const n1 = normalizeUnit(u1);
  const n2 = normalizeUnit(u2);
  if (n1 === n2) {
    return true;
  }

  // Check compatibility groups
  for (const group of Object.values(UNIT_COMPATIBILITY_GROUPS)) {
    const u1InGroup = group.some((u) => u.toLowerCase() === u1 || normalizeUnit(u) === n1);
    const u2InGroup = group.some((u) => u.toLowerCase() === u2 || normalizeUnit(u) === n2);
    if (u1InGroup && u2InGroup) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Find the best matching regex factor for an LLM factor.
 * Requires unit compatibility for a match to be considered.
 */
function findMatchingRegexFactor(
  llmFactor: ExtractedFactor,
  regexFactors: ExtractedFactor[],
  options: MergeOptions,
  usedIndices: Set<number>
): { factor: ExtractedFactor; index: number } | null {
  const { context, maxLabelDistance = 0.3 } = options;
  let bestMatch: { factor: ExtractedFactor; index: number; score: number } | null = null;

  for (let i = 0; i < regexFactors.length; i++) {
    if (usedIndices.has(i)) continue;

    const regexFactor = regexFactors[i];

    // Check unit compatibility first - if units are incompatible, skip
    if (!unitsAreCompatible(llmFactor.unit, regexFactor.unit)) {
      continue;
    }

    const similarity = labelSimilarity(llmFactor.label, regexFactor.label, context);

    // Also check if values are similar (within 5%)
    const valueSimilar =
      Math.abs(llmFactor.value - regexFactor.value) /
        Math.max(Math.abs(llmFactor.value), 1) <
      0.05;

    // Combined score: label similarity + value match bonus
    const score = similarity + (valueSimilar ? 0.3 : 0);

    if (score > 1 - maxLabelDistance && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { factor: regexFactor, index: i, score };
    }
  }

  return bestMatch ? { factor: bestMatch.factor, index: bestMatch.index } : null;
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Merge factors from LLM and regex extraction.
 *
 * Rules:
 * 1. Match factors by normalized label (case-insensitive, alias-aware)
 * 2. LLM factor wins if confidence > threshold
 * 3. Regex factor wins if LLM confidence <= threshold
 * 4. Unmatched factors included with source provenance
 *
 * @param llmFactors - Factors extracted by LLM
 * @param regexFactors - Factors extracted by regex
 * @param options - Merge options
 * @returns Merged factors with provenance
 */
export function mergeFactors(
  llmFactors: ExtractedFactor[],
  regexFactors: ExtractedFactor[],
  options: MergeOptions = {}
): MergeResult {
  const { llmConfidenceThreshold = 0.7 } = options;

  const merged: MergedFactor[] = [];
  const usedRegexIndices = new Set<number>();
  const stats: MergeStats = {
    total: 0,
    llmOnly: 0,
    regexOnly: 0,
    merged: 0,
    llmPrecedence: 0,
    regexPrecedence: 0,
  };

  // Process LLM factors first
  for (const llmFactor of llmFactors) {
    const match = findMatchingRegexFactor(llmFactor, regexFactors, options, usedRegexIndices);

    if (match) {
      usedRegexIndices.add(match.index);

      // Decide which value to use
      if (llmFactor.confidence >= llmConfidenceThreshold) {
        // LLM takes precedence
        merged.push({
          ...llmFactor,
          mergeSource: "merged",
          llmOriginal: llmFactor,
          regexOriginal: match.factor,
        });
        stats.llmPrecedence++;
      } else {
        // Regex takes precedence but use LLM label (expanded)
        merged.push({
          ...match.factor,
          label: llmFactor.label, // Prefer expanded LLM label
          mergeSource: "merged",
          llmOriginal: llmFactor,
          regexOriginal: match.factor,
        });
        stats.regexPrecedence++;
      }
      stats.merged++;
    } else {
      // LLM-only factor
      merged.push({
        ...llmFactor,
        mergeSource: "llm",
        llmOriginal: llmFactor,
      });
      stats.llmOnly++;
    }
  }

  // Add unmatched regex factors
  for (let i = 0; i < regexFactors.length; i++) {
    if (!usedRegexIndices.has(i)) {
      merged.push({
        ...regexFactors[i],
        mergeSource: "regex",
        regexOriginal: regexFactors[i],
      });
      stats.regexOnly++;
    }
  }

  stats.total = merged.length;

  log.info(
    {
      event: "cee.factor_merge.complete",
      ...stats,
    },
    `Merged ${stats.total} factors: ${stats.llmOnly} LLM-only, ${stats.regexOnly} regex-only, ${stats.merged} merged`
  );

  return { factors: merged, stats };
}

/**
 * Deduplicate factors by normalized label.
 * Keeps the factor with highest confidence.
 */
export function deduplicateFactors(
  factors: ExtractedFactor[],
  context?: ResolvedContext
): ExtractedFactor[] {
  const seen = new Map<string, ExtractedFactor>();

  for (const factor of factors) {
    const key = normalizeLabel(factor.label, context);

    const existing = seen.get(key);
    if (!existing || factor.confidence > existing.confidence) {
      seen.set(key, factor);
    }
  }

  return Array.from(seen.values());
}
