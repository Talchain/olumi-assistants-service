/**
 * Market Context Resolver
 *
 * Resolves and merges market context for LLM-first extraction.
 * Handles domain detection, context loading, and prompt formatting.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

import {
  MarketContext,
  MarketContextSchema,
  ResolvedContext,
  GlossaryTerm,
  ConstraintPattern,
  SupportedDomain,
  STRONG_SAAS_KEYWORDS,
  WEAK_SAAS_KEYWORDS,
  SAAS_DETECTION_THRESHOLD,
  HallucinationValidationResult,
} from "./types.js";
import { log } from "../utils/telemetry.js";

// ============================================================================
// Module-level state
// ============================================================================

// Cache for loaded context files (cleared on process restart)
const contextCache = new Map<string, MarketContext>();

// Path to context files - use process.cwd() for reliable resolution
// Works in both development and production (Render, Docker, etc.)
function getContextDir(): string {
  // Allow override via environment variable for testing/custom deployments
  // eslint-disable-next-line no-restricted-syntax -- Directory path, not in config schema
  if (process.env.CEE_CONTEXT_DIR) {
    // eslint-disable-next-line no-restricted-syntax -- Directory path, not in config schema
    return process.env.CEE_CONTEXT_DIR;
  }
  return join(process.cwd(), "data/context");
}

// ============================================================================
// Context Loading
// ============================================================================

/**
 * Load a market context file by domain.
 * Validates against schema and caches result.
 */
export function loadContext(domain: string): MarketContext | null {
  // Check cache first
  if (contextCache.has(domain)) {
    return contextCache.get(domain)!;
  }

  const contextDir = getContextDir();
  const filePath = join(contextDir, `${domain}.json`);

  if (!existsSync(filePath)) {
    log.warn({ domain, filePath }, `Context file not found for domain: ${domain}`);
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const validated = MarketContextSchema.parse(parsed);

    // Cache and return
    contextCache.set(domain, validated);
    log.debug(
      {
        domain,
        glossaryCount: validated.glossary.length,
        constraintCount: validated.constraint_patterns.length,
      },
      `Loaded market context for domain: ${domain}`
    );

    return validated;
  } catch (err) {
    log.error({ domain, error: err }, `Failed to load context file for domain: ${domain}`);
    return null;
  }
}

/**
 * Clear the context cache. Useful for testing or hot-reloading.
 */
export function clearContextCache(): void {
  contextCache.clear();
}

// ============================================================================
// Domain Detection
// ============================================================================

/**
 * Keywords that are short enough to require word boundary matching.
 * For keywords <= 5 characters, we use regex word boundaries to avoid
 * false positives (e.g., "arr" matching within "warranty").
 */
const SHORT_KEYWORD_THRESHOLD = 5;

/**
 * Check if a keyword matches in the text.
 * For short keywords (≤5 chars), uses word boundary matching.
 * For longer keywords, uses substring matching.
 */
function keywordMatches(text: string, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();

  if (lowerKeyword.length <= SHORT_KEYWORD_THRESHOLD) {
    // Use word boundary matching for short keywords
    // Escapes special regex characters in keyword
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(text);
  }

  // Use substring matching for longer keywords
  return text.toLowerCase().includes(lowerKeyword);
}

/**
 * Auto-detect domain from brief text using weighted keyword matching.
 *
 * Uses a two-tier scoring system:
 * - Strong keywords (e.g., "SaaS", "MRR", "ARR") = 2 points each
 * - Weak keywords (e.g., "subscription", "churn") = 1 point each
 *
 * Short keywords (≤5 characters) use word boundary matching to avoid
 * false positives (e.g., "arr" matching within "warranty").
 *
 * Requires minimum threshold score to avoid false positives on generic briefs.
 * Returns null if no domain reaches the threshold.
 */
export function detectDomain(brief: string): SupportedDomain | null {
  let saasScore = 0;
  const matchedKeywords: string[] = [];

  // Check strong SaaS keywords (weight: 2)
  for (const keyword of STRONG_SAAS_KEYWORDS) {
    if (keywordMatches(brief, keyword)) {
      saasScore += 2;
      matchedKeywords.push(`${keyword} (strong)`);
    }
  }

  // Check weak SaaS keywords (weight: 1)
  for (const keyword of WEAK_SAAS_KEYWORDS) {
    if (keywordMatches(brief, keyword)) {
      saasScore += 1;
      matchedKeywords.push(`${keyword} (weak)`);
    }
  }

  // Only detect SaaS if we meet the threshold
  if (saasScore >= SAAS_DETECTION_THRESHOLD) {
    log.debug(
      { domain: "saas", score: saasScore, matchedKeywords },
      "Auto-detected SaaS domain from brief"
    );
    return "saas";
  }

  // No domain detected - will use core context only
  if (matchedKeywords.length > 0) {
    log.debug(
      { score: saasScore, threshold: SAAS_DETECTION_THRESHOLD, matchedKeywords },
      "SaaS keywords found but below threshold - using core only"
    );
  }

  return null;
}

// ============================================================================
// Context Resolution
// ============================================================================

/**
 * Resolve market context for a brief.
 *
 * @param brief - The decision brief text
 * @param domain - Optional domain override (auto-detected if not specified)
 * @returns Merged context ready for prompt injection
 */
export function resolveContext(
  brief: string,
  domain?: SupportedDomain
): ResolvedContext {
  const sources: string[] = [];
  const allGlossary: GlossaryTerm[] = [];
  const allConstraints: ConstraintPattern[] = [];

  // Always load core context
  const coreContext = loadContext("core");
  if (coreContext) {
    sources.push("core");
    allGlossary.push(...coreContext.glossary);
    allConstraints.push(...coreContext.constraint_patterns);
  }

  // Detect or use provided domain
  const resolvedDomain = domain || detectDomain(brief);

  // Load domain-specific context if different from core
  if (resolvedDomain && resolvedDomain !== "core") {
    const domainContext = loadContext(resolvedDomain);
    if (domainContext) {
      sources.push(resolvedDomain);
      allGlossary.push(...domainContext.glossary);
      allConstraints.push(...domainContext.constraint_patterns);
    }
  }

  // Deduplicate glossary by term (domain-specific takes precedence)
  const glossaryMap = new Map<string, GlossaryTerm>();
  for (const term of allGlossary) {
    const key = term.term.toLowerCase();
    glossaryMap.set(key, term); // Later entries (domain) override earlier (core)
  }

  // Deduplicate constraints by pattern
  const constraintMap = new Map<string, ConstraintPattern>();
  for (const constraint of allConstraints) {
    const key = constraint.pattern.toLowerCase();
    constraintMap.set(key, constraint);
  }

  const result: ResolvedContext = {
    domain: resolvedDomain || "core",
    glossary: Array.from(glossaryMap.values()),
    constraintPatterns: Array.from(constraintMap.values()),
    sources,
  };

  log.info(
    {
      domain: result.domain,
      glossaryCount: result.glossary.length,
      constraintCount: result.constraintPatterns.length,
      sources: result.sources,
    },
    "Resolved market context"
  );

  return result;
}

// ============================================================================
// Prompt Formatting
// ============================================================================

/**
 * Format glossary terms for prompt injection.
 * Returns a markdown-formatted glossary section.
 */
export function formatGlossaryForPrompt(glossary: GlossaryTerm[]): string {
  if (glossary.length === 0) {
    return "";
  }

  const lines = ["## Business Glossary", ""];
  for (const term of glossary) {
    const aliases =
      term.aliases.length > 0 ? ` (${term.aliases.join(", ")})` : "";
    const unit = term.typical_unit ? ` [${term.typical_unit}]` : "";
    lines.push(`- **${term.term}**${aliases}${unit}: ${term.definition}`);
  }

  return lines.join("\n");
}

/**
 * Format constraint patterns for prompt injection.
 * Returns a markdown-formatted constraint section.
 */
export function formatConstraintsForPrompt(
  constraints: ConstraintPattern[]
): string {
  if (constraints.length === 0) {
    return "";
  }

  const lines = ["## Constraint Patterns", ""];
  lines.push("Look for these types of constraints in the brief:");
  lines.push("");

  for (const constraint of constraints) {
    const examples =
      constraint.examples && constraint.examples.length > 0
        ? ` (e.g., "${constraint.examples[0]}")`
        : "";
    lines.push(
      `- **${constraint.pattern}** [${constraint.operator}]: ${constraint.description}${examples}`
    );
  }

  return lines.join("\n");
}

/**
 * Format full context for prompt injection.
 * Combines glossary and constraints into a single section.
 */
export function formatContextForPrompt(context: ResolvedContext): string {
  const sections: string[] = [];

  const glossary = formatGlossaryForPrompt(context.glossary);
  if (glossary) {
    sections.push(glossary);
  }

  const constraints = formatConstraintsForPrompt(context.constraintPatterns);
  if (constraints) {
    sections.push(constraints);
  }

  if (sections.length === 0) {
    return "";
  }

  return `# Market Context (${context.domain})\n\n${sections.join("\n\n")}`;
}

// ============================================================================
// Hallucination Validation
// ============================================================================

/**
 * Extract all numeric values from text.
 * Handles various formats: 1000, 1,000, $1M, 50%, 3.5x, etc.
 * For percentages, extracts BOTH the raw value (5) AND the decimal (0.05)
 * to support hallucination validation for LLM-extracted values.
 */
export function extractNumericValues(text: string): number[] {
  const values: number[] = [];

  const multipliers: Record<string, number> = {
    k: 1000,
    K: 1000,
    m: 1000000,
    M: 1000000,
    b: 1000000000,
    B: 1000000000,
  };

  // Extract currency with multipliers: $1M, $500K, $1.5B
  const currencyPattern = /\$?([\d,.]+)\s*([KMBkmb])\b/g;
  let match;
  while ((match = currencyPattern.exec(text)) !== null) {
    const base = parseFloat(match[1].replace(/,/g, ""));
    const multiplier = multipliers[match[2]] || 1;
    values.push(base * multiplier);
  }

  // Extract percentages - emit BOTH raw value AND decimal representation
  // This is critical for hallucination validation:
  // "5%" should match both 5 (original) and 0.05 (LLM decimal form)
  const percentPattern = /([\d,.]+)\s*%/g;
  while ((match = percentPattern.exec(text)) !== null) {
    const rawValue = parseFloat(match[1].replace(/,/g, ""));
    values.push(rawValue); // Original percentage value (5)
    values.push(rawValue / 100); // Decimal representation (0.05)
  }

  // Extract plain numbers: 1000, 1,000, 1.5
  const plainPattern = /\b([\d,]+(?:\.\d+)?)\b/g;
  while ((match = plainPattern.exec(text)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(value)) {
      values.push(value);
    }
  }

  // Deduplicate
  return [...new Set(values)];
}

/**
 * Validate extracted values against the original brief.
 * Checks if numeric values appear in the source text.
 */
export function validateAgainstBrief(
  extractedValues: number[],
  brief: string
): HallucinationValidationResult {
  const briefValues = extractNumericValues(brief);
  const warnings: string[] = [];
  const validated: HallucinationValidationResult["validatedValues"] = [];

  for (const value of extractedValues) {
    // Check if value or reasonable variants appear in brief
    const foundExact = briefValues.includes(value);

    // Also check for close matches (within 1% for floating point issues)
    const foundClose = briefValues.some(
      (bv) => Math.abs(bv - value) / Math.max(Math.abs(bv), 1) < 0.01
    );

    const foundInBrief = foundExact || foundClose;

    if (!foundInBrief) {
      warnings.push(
        `Value ${value} not found in brief - potential hallucination`
      );
    }

    validated.push({
      value,
      foundInBrief,
    });
  }

  return {
    isValid: warnings.length === 0,
    validatedValues: validated,
    warnings,
  };
}

// ============================================================================
// Alias Matching
// ============================================================================

/**
 * Find a glossary term by name or alias.
 * Case-insensitive matching.
 */
export function findTermByAlias(
  context: ResolvedContext,
  name: string
): GlossaryTerm | null {
  const lowerName = name.toLowerCase().trim();

  for (const term of context.glossary) {
    if (term.term.toLowerCase() === lowerName) {
      return term;
    }
    for (const alias of term.aliases) {
      if (alias.toLowerCase() === lowerName) {
        return term;
      }
    }
  }

  return null;
}

/**
 * Expand an abbreviation to its full term name.
 * Returns original if no match found.
 */
export function expandAbbreviation(
  context: ResolvedContext,
  abbrev: string
): string {
  const term = findTermByAlias(context, abbrev);
  return term ? term.term : abbrev;
}
