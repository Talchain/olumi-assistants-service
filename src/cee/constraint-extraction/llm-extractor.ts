/**
 * LLM Constraint Extractor
 *
 * Extracts constraints from briefs using LLM with market context.
 * Constraints are converted to risk nodes for graph integration.
 * Implements fail-closed semantics and strict operator validation.
 */

import { log } from "../../utils/telemetry.js";
import {
  LLMConstraintExtractionResponseSchema,
  type LLMConstraint,
  type ConstraintOperatorType,
  flattenZodErrors,
} from "../../schemas/llmExtraction.js";
import {
  type ResolvedContext,
  formatConstraintsForPrompt,
  validateAgainstBrief,
} from "../../context/index.js";
import { callLLMForExtraction } from "../../adapters/llm/extraction.js";

// ============================================================================
// Types
// ============================================================================

export interface ExtractedConstraint {
  /** Descriptive label for the constraint */
  label: string;
  /** Operator type: max (upper bound) or min (lower bound) */
  operator: ConstraintOperatorType;
  /** Threshold value */
  threshold: number;
  /** Unit of measurement */
  unit: string;
  /** Source quote from brief */
  sourceQuote: string;
  /** Extraction confidence (0-1) */
  confidence: number;
}

export interface ConstraintExtractionOptions {
  /** Market context for prompt enrichment */
  context: ResolvedContext;
  /** Maximum constraints to extract (default: 10) */
  maxConstraints?: number;
  /** Enable hallucination validation (default: true) */
  validateHallucinations?: boolean;
}

export interface ConstraintExtractionResult {
  /** Successfully extracted constraints */
  constraints: ExtractedConstraint[];
  /** Whether extraction succeeded */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
  /** Hallucination warnings */
  warnings: string[];
  /** Raw LLM constraints before conversion */
  rawConstraints?: LLMConstraint[];
}

// ============================================================================
// Prompt Templates
// ============================================================================

const CONSTRAINT_EXTRACTION_SYSTEM_PROMPT = `You are a business analyst specializing in identifying constraints and limits in decision-making documents.

Your task is to identify constraints that define boundaries or limits on decisions. Constraints must have:
- A clear threshold value
- An operator (max = upper limit/ceiling, min = lower limit/floor)

VALID CONSTRAINT EXAMPLES:
- "Budget must not exceed $500K" → operator: "max", threshold: 500000, unit: "$"
- "Maintain at least 40% margin" → operator: "min", threshold: 0.40, unit: "%"
- "No more than 10 FTEs" → operator: "max", threshold: 10, unit: "people"
- "NPS cannot fall below 30" → operator: "min", threshold: 30, unit: "points"

INVALID (DO NOT EXTRACT):
- "increase revenue" (no threshold)
- "improve customer satisfaction" (no numeric limit)
- Targets or goals without hard limits
- Comparisons between options

OPERATOR RULES:
- "max" for: maximum, ceiling, cap, limit, no more than, cannot exceed, must not exceed, up to, at most
- "min" for: minimum, floor, at least, no less than, cannot fall below, must maintain

OUTPUT FORMAT:
Return a JSON object with a single "constraints" array. Each constraint must have:
- label: Descriptive name for the constraint
- operator: "max" or "min" ONLY (no other values allowed)
- threshold: Numeric value (percentages as decimals)
- unit: Unit of measurement
- source_quote: Exact text from brief (max 200 chars)

IMPORTANT:
- Output valid JSON only. No markdown, no explanations.
- Only extract constraints with CLEAR numeric thresholds
- operator MUST be exactly "max" or "min" - no other values`;

function buildConstraintExtractionUserPrompt(
  brief: string,
  context: ResolvedContext,
  maxConstraints: number
): string {
  const constraintPatterns = formatConstraintsForPrompt(context.constraintPatterns);

  return `${constraintPatterns ? `${constraintPatterns}\n\n` : ""}BRIEF:
${brief}

Extract up to ${maxConstraints} constraints from this brief.
Remember: operator MUST be "max" or "min" only. Include source_quote for each.
Output JSON only:`;
}

// ============================================================================
// LLM Constraint Extraction
// ============================================================================

/**
 * Call LLM for constraint extraction.
 * Uses the configured LLM provider (OpenAI/Anthropic).
 * Returns null on failure to trigger regex fallback.
 */
async function callLLMForConstraints(
  systemPrompt: string,
  userPrompt: string
): Promise<unknown | null> {
  const result = await callLLMForExtraction(systemPrompt, userPrompt, {
    maxTokens: 2000,
    temperature: 0,
  });

  if (!result.success || result.response === null) {
    log.debug(
      { event: "cee.llm_constraint_extraction.call_failed", error: result.error },
      "LLM call failed, will fallback to regex"
    );
    return null;
  }

  return result.response;
}

/**
 * Extract constraints from a brief using LLM.
 * Implements fail-closed semantics: returns empty result on any error.
 *
 * @param brief - The decision brief text
 * @param options - Extraction options including context
 * @returns Extraction result with constraints or error
 */
export async function extractConstraintsLLM(
  brief: string,
  options: ConstraintExtractionOptions
): Promise<ConstraintExtractionResult> {
  const {
    context,
    maxConstraints = 10,
    validateHallucinations = true,
  } = options;

  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    // Build prompts
    const systemPrompt = CONSTRAINT_EXTRACTION_SYSTEM_PROMPT;
    const userPrompt = buildConstraintExtractionUserPrompt(brief, context, maxConstraints);

    // Call LLM
    const rawResponse = await callLLMForConstraints(systemPrompt, userPrompt);

    if (rawResponse === null) {
      log.debug(
        { event: "cee.llm_constraint_extraction.no_response" },
        "LLM returned no response, falling back to regex"
      );
      return {
        constraints: [],
        success: false,
        error: "LLM returned no response",
        warnings: [],
      };
    }

    // Parse response with strict schema validation
    const parseResult = LLMConstraintExtractionResponseSchema.safeParse(rawResponse);

    if (!parseResult.success) {
      const errors = flattenZodErrors(parseResult.error);
      log.warn(
        {
          event: "cee.llm_constraint_extraction.parse_error",
          errors,
        },
        "LLM response failed schema validation"
      );
      return {
        constraints: [],
        success: false,
        error: `Schema validation failed: ${errors.join(", ")}`,
        warnings: [],
      };
    }

    const llmConstraints = parseResult.data.constraints;

    // Hallucination validation for threshold values
    if (validateHallucinations) {
      const values = llmConstraints.map((c) => c.threshold);
      const validation = validateAgainstBrief(values, brief);

      if (!validation.isValid) {
        warnings.push(...validation.warnings);
        log.warn(
          {
            event: "cee.llm_constraint_extraction.hallucination_detected",
            warnings: validation.warnings,
          },
          "Potential hallucinations detected in LLM constraint extraction"
        );
      }
    }

    // Convert LLM constraints to ExtractedConstraint format
    const constraints = llmConstraints.map((llmConstraint) =>
      convertLLMConstraintToExtracted(llmConstraint)
    );

    const durationMs = Date.now() - startTime;

    log.info(
      {
        event: "cee.llm_constraint_extraction.complete",
        constraintCount: constraints.length,
        durationMs,
      },
      "LLM constraint extraction complete"
    );

    return {
      constraints,
      success: true,
      warnings,
      rawConstraints: llmConstraints,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error(
      {
        event: "cee.llm_constraint_extraction.error",
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      },
      "LLM constraint extraction failed"
    );

    return {
      constraints: [],
      success: false,
      error: error instanceof Error ? error.message : String(error),
      warnings: [],
    };
  }
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert an LLM constraint to the internal ExtractedConstraint format.
 */
function convertLLMConstraintToExtracted(
  llmConstraint: LLMConstraint
): ExtractedConstraint {
  return {
    label: llmConstraint.label,
    operator: llmConstraint.operator,
    threshold: llmConstraint.threshold,
    unit: llmConstraint.unit,
    sourceQuote: llmConstraint.source_quote,
    confidence: 0.85, // LLM-extracted constraints have good confidence
  };
}

/**
 * Get the system prompt for constraint extraction.
 * Exported for testing and customization.
 */
export function getConstraintExtractionSystemPrompt(): string {
  return CONSTRAINT_EXTRACTION_SYSTEM_PROMPT;
}

/**
 * Build the user prompt for constraint extraction.
 * Exported for testing and customization.
 */
export function buildConstraintExtractionPrompt(
  brief: string,
  context: ResolvedContext,
  maxConstraints: number = 10
): string {
  return buildConstraintExtractionUserPrompt(brief, context, maxConstraints);
}
