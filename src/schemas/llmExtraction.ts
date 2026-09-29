/**
 * LLM Extraction Schemas
 *
 * Zod schemas for validating LLM-extracted factors and constraints.
 * Uses strict validation with fail-closed semantics.
 */

import { z } from "zod";

// ============================================================================
// Factor Extraction Schema
// ============================================================================

/**
 * Schema for a single factor extracted by LLM.
 * Strict mode rejects unknown properties.
 */
export const LLMFactorSchema = z
  .object({
    /** Expanded label (e.g., "Annual Recurring Revenue" not "ARR") */
    label: z.string().min(1).max(100),

    /** Numeric value extracted from brief */
    value: z.number(),

    /** Unit of measurement (e.g., "$", "%", "months") */
    unit: z.string().min(1).max(20),

    /** Baseline value if present (for "from X to Y" patterns) */
    baseline: z.number().optional(),

    /** Value range for sensitivity analysis */
    range: z
      .object({
        min: z.number(),
        max: z.number(),
      })
      .optional(),

    /** Extraction confidence (0-1) */
    confidence: z.number().min(0).max(1),

    /** Source quote from brief for provenance */
    source_quote: z.string().max(200),
  })
  .strict();

/**
 * Schema for LLM factor extraction response.
 */
export const LLMFactorExtractionResponseSchema = z
  .object({
    factors: z.array(LLMFactorSchema),
  })
  .strict();

// ============================================================================
// Constraint Extraction Schema
// ============================================================================

/**
 * Valid constraint operators (max/min only).
 */
export const ConstraintOperator = z.enum(["max", "min"]);

/**
 * Schema for a single constraint extracted by LLM.
 * Strict mode rejects unknown properties.
 */
export const LLMConstraintSchema = z
  .object({
    /** Descriptive label for the constraint */
    label: z.string().min(1).max(100),

    /** Operator type (max = upper bound, min = lower bound) */
    operator: ConstraintOperator,

    /** Threshold value */
    threshold: z.number(),

    /** Unit of measurement */
    unit: z.string().min(1).max(20),

    /** Source quote from brief for provenance */
    source_quote: z.string().max(200),
  })
  .strict();

/**
 * Schema for LLM constraint extraction response.
 */
export const LLMConstraintExtractionResponseSchema = z
  .object({
    constraints: z.array(LLMConstraintSchema),
  })
  .strict();

// ============================================================================
// TypeScript Types
// ============================================================================

export type LLMFactor = z.infer<typeof LLMFactorSchema>;
export type LLMFactorExtractionResponse = z.infer<
  typeof LLMFactorExtractionResponseSchema
>;
export type LLMConstraint = z.infer<typeof LLMConstraintSchema>;
export type LLMConstraintExtractionResponse = z.infer<
  typeof LLMConstraintExtractionResponseSchema
>;
export type ConstraintOperatorType = z.infer<typeof ConstraintOperator>;

// ============================================================================
// Parsing Utilities (Fail-Closed)
// ============================================================================

/**
 * Parse factor extraction response with fail-closed semantics.
 * Returns empty array on any parsing error.
 */
export function parseFactorExtractionResponse(
  raw: unknown
): LLMFactorExtractionResponse | null {
  const result = LLMFactorExtractionResponseSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Parse constraint extraction response with fail-closed semantics.
 * Returns empty array on any parsing error.
 */
export function parseConstraintExtractionResponse(
  raw: unknown
): LLMConstraintExtractionResponse | null {
  const result = LLMConstraintExtractionResponseSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Get flattened error messages from a Zod error.
 * Useful for logging and debugging.
 */
export function flattenZodErrors(error: z.ZodError): string[] {
  return error.errors.map((e) => {
    const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
    return `${path}${e.message}`;
  });
}

/**
 * Extract the first N Zod issues as structured objects for diagnostic logging.
 * Returns an array of {path, message, code, expected?, received?} objects.
 */
export function extractZodIssues(error: z.ZodError, count = 3): Array<{
  path: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}> {
  const issues = error?.issues ?? [];
  return issues.slice(0, count).map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : "",
    message: i.message ?? "",
    code: i.code ?? "",
    expected: (i as any).expected != null ? String((i as any).expected) : undefined,
    received: (i as any).received != null ? String((i as any).received) : undefined,
  }));
}
