/**
 * Market Context Types
 *
 * TypeScript types for market context JSON files and resolved context.
 * Used for LLM-first factor and constraint extraction.
 */

import { z } from "zod";

// ============================================================================
// Zod Schemas for JSON validation
// ============================================================================

export const GlossaryTermSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()),
  definition: z.string().min(1),
  typical_unit: z.string().optional(),
});

export const ConstraintPatternSchema = z.object({
  pattern: z.string().min(1),
  description: z.string().min(1),
  operator: z.enum(["max", "min"]),
  examples: z.array(z.string()).optional(),
});

export const MarketContextSchema = z.object({
  version: z.string(),
  domain: z.string(),
  description: z.string().optional(),
  glossary: z.array(GlossaryTermSchema),
  constraint_patterns: z.array(ConstraintPatternSchema),
});

// ============================================================================
// TypeScript types (inferred from Zod)
// ============================================================================

export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;
export type ConstraintPattern = z.infer<typeof ConstraintPatternSchema>;
export type MarketContext = z.infer<typeof MarketContextSchema>;

// ============================================================================
// Resolved Context (merged and ready for prompt injection)
// ============================================================================

/**
 * Resolved context after merging core + domain-specific contexts.
 * Ready for injection into LLM prompts.
 */
export interface ResolvedContext {
  /** Detected or specified domain */
  domain: string;

  /** Merged glossary terms from all applicable contexts */
  glossary: GlossaryTerm[];

  /** Merged constraint patterns from all applicable contexts */
  constraintPatterns: ConstraintPattern[];

  /** Source contexts that were merged */
  sources: string[];
}

// ============================================================================
// Supported domains
// ============================================================================

/**
 * Supported market context domains.
 * Each domain has a corresponding JSON file in data/context/
 */
export const SUPPORTED_DOMAINS = ["core", "saas"] as const;
export type SupportedDomain = (typeof SUPPORTED_DOMAINS)[number];

/**
 * Strong SaaS keywords that are specific signals.
 * These strongly indicate SaaS domain (weight: 2).
 */
export const STRONG_SAAS_KEYWORDS: readonly string[] = [
  "saas",
  "software as a service",
  "mrr",
  "arr",
  "nrr",
  "seat license",
  "per-seat",
  "freemium",
  "trial conversion",
  "usage-based pricing",
  "acv",
  "monthly recurring revenue",
  "annual recurring revenue",
  "churn rate",
];

/**
 * Weak SaaS keywords that need additional signals to confirm.
 * Common in SaaS but also appear in other contexts (weight: 1).
 */
export const WEAK_SAAS_KEYWORDS: readonly string[] = [
  "subscription",
  "seats",
  "churn",
  "expansion",
  "upsell",
  "customer success",
  "annual contract",
  "usage-based",
];

/**
 * Minimum score required to detect SaaS domain.
 * Strong keywords = 2 points, weak keywords = 1 point.
 * Requiring 2+ ensures we don't false-positive on generic briefs.
 */
export const SAAS_DETECTION_THRESHOLD = 2;

/**
 * Keywords used to auto-detect domain from brief text.
 * Maps keywords to their corresponding domain.
 * NOTE: Detection now uses weighted scoring with strong/weak signals.
 * Generic keywords (cloud, platform, tier, api, onboarding) removed.
 */
export const DOMAIN_KEYWORDS: Record<string, SupportedDomain> = {
  // Strong SaaS keywords (weight: 2)
  saas: "saas",
  "software as a service": "saas",
  mrr: "saas",
  arr: "saas",
  nrr: "saas",
  "seat license": "saas",
  "per-seat": "saas",
  freemium: "saas",
  "trial conversion": "saas",
  "usage-based pricing": "saas",
  acv: "saas",
  "monthly recurring revenue": "saas",
  "annual recurring revenue": "saas",
  "churn rate": "saas",
  // Weak SaaS keywords (weight: 1)
  subscription: "saas",
  seats: "saas",
  churn: "saas",
  expansion: "saas",
  upsell: "saas",
  "customer success": "saas",
  "annual contract": "saas",
  "usage-based": "saas",
};

// ============================================================================
// Validation result types
// ============================================================================

/**
 * Result from hallucination validation.
 * Checks if extracted values appear in original brief.
 */
export interface HallucinationValidationResult {
  isValid: boolean;
  validatedValues: Array<{
    value: number;
    foundInBrief: boolean;
    sourceQuote?: string;
  }>;
  warnings: string[];
}

/**
 * Extraction provenance tracking.
 */
export type ExtractionSource = "llm" | "regex" | "merged";

export interface ExtractionProvenance {
  source: ExtractionSource;
  confidence: number;
  sourceQuote?: string;
}
