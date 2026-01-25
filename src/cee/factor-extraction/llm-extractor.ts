/**
 * LLM Factor Extractor
 *
 * Extracts quantitative factors from briefs using LLM with market context.
 * Implements fail-closed semantics and hallucination validation.
 */

import { log } from "../../utils/telemetry.js";
import {
  LLMFactorExtractionResponseSchema,
  type LLMFactor,
  flattenZodErrors,
} from "../../schemas/llmExtraction.js";
import {
  type ResolvedContext,
  formatGlossaryForPrompt,
  validateAgainstBrief,
  expandAbbreviation,
} from "../../context/index.js";
import type { ExtractedFactor, ExtractionType } from "./index.js";
import { callLLMForExtraction } from "../../adapters/llm/extraction.js";

// ============================================================================
// Types
// ============================================================================

export interface LLMExtractionOptions {
  /** Market context for prompt enrichment */
  context: ResolvedContext;
  /** Maximum factors to extract (default: 20) */
  maxFactors?: number;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
  /** Enable hallucination validation (default: true) */
  validateHallucinations?: boolean;
}

export interface LLMExtractionResult {
  /** Successfully extracted factors */
  factors: ExtractedFactor[];
  /** Whether extraction succeeded */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
  /** Hallucination warnings */
  warnings: string[];
  /** Raw LLM factors before conversion */
  rawFactors?: LLMFactor[];
}

// ============================================================================
// Prompt Templates
// ============================================================================

const FACTOR_EXTRACTION_SYSTEM_PROMPT = `You are a quantitative analyst specializing in extracting numerical factors from business documents.

Your task is to identify and extract all quantitative values from the provided brief that could be used in financial modeling or decision analysis.

RULES:
1. Extract ONLY values that appear explicitly in the text - never invent or calculate new values
2. Use expanded labels (e.g., "Annual Recurring Revenue" not "ARR")
3. Include the exact source quote where the value appears
4. Assign confidence based on how clearly the value is stated (0.9+ for explicit, 0.6-0.8 for contextual)
5. For percentage values, store as decimal in the value field (e.g., 5% = 0.05)
6. Identify baseline values for "from X to Y" patterns
7. Identify ranges where values are given as bounds (e.g., "$50-70")

OUTPUT FORMAT:
Return a JSON object with a single "factors" array. Each factor must have:
- label: Human-readable name (expanded form)
- value: Numeric value (percentages as decimals)
- unit: Unit of measurement (e.g., "$", "%", "months", "users")
- baseline: (optional) Starting value for from-to patterns
- range: (optional) { min, max } for range values
- confidence: 0-1 indicating extraction certainty
- source_quote: Exact text from brief (max 200 chars)

IMPORTANT: Output valid JSON only. No markdown, no explanations.`;

function buildFactorExtractionUserPrompt(
  brief: string,
  context: ResolvedContext,
  maxFactors: number
): string {
  const glossary = formatGlossaryForPrompt(context.glossary);

  return `${glossary ? `${glossary}\n\n` : ""}BRIEF:
${brief}

Extract up to ${maxFactors} quantitative factors from this brief.
Remember: Use expanded labels from the glossary where applicable.
Output JSON only:`;
}

// ============================================================================
// LLM Factor Extraction
// ============================================================================

/**
 * Call LLM for factor extraction.
 * Uses the configured LLM provider (OpenAI/Anthropic).
 * Returns null on failure to trigger regex fallback.
 */
async function callLLMForFactors(
  systemPrompt: string,
  userPrompt: string
): Promise<unknown | null> {
  const result = await callLLMForExtraction(systemPrompt, userPrompt, {
    maxTokens: 2000,
    temperature: 0,
  });

  if (!result.success || result.response === null) {
    log.debug(
      { event: "cee.llm_factor_extraction.call_failed", error: result.error },
      "LLM call failed, will fallback to regex"
    );
    return null;
  }

  return result.response;
}

/**
 * Extract factors from a brief using LLM.
 * Implements fail-closed semantics: returns empty result on any error.
 *
 * @param brief - The decision brief text
 * @param options - Extraction options including context
 * @returns Extraction result with factors or error
 */
export async function extractFactorsLLM(
  brief: string,
  options: LLMExtractionOptions
): Promise<LLMExtractionResult> {
  const {
    context,
    maxFactors = 20,
    minConfidence = 0.5,
    validateHallucinations = true,
  } = options;

  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    // Build prompts
    const systemPrompt = FACTOR_EXTRACTION_SYSTEM_PROMPT;
    const userPrompt = buildFactorExtractionUserPrompt(brief, context, maxFactors);

    // Call LLM
    const rawResponse = await callLLMForFactors(systemPrompt, userPrompt);

    if (rawResponse === null) {
      log.debug({ event: "cee.llm_factor_extraction.no_response" }, "LLM returned no response, falling back to regex");
      return {
        factors: [],
        success: false,
        error: "LLM returned no response",
        warnings: [],
      };
    }

    // Parse response with strict schema validation
    const parseResult = LLMFactorExtractionResponseSchema.safeParse(rawResponse);

    if (!parseResult.success) {
      const errors = flattenZodErrors(parseResult.error);
      log.warn(
        {
          event: "cee.llm_factor_extraction.parse_error",
          errors,
        },
        "LLM response failed schema validation"
      );
      return {
        factors: [],
        success: false,
        error: `Schema validation failed: ${errors.join(", ")}`,
        warnings: [],
      };
    }

    const llmFactors = parseResult.data.factors;

    // Filter by minimum confidence
    const confidentFactors = llmFactors.filter((f) => f.confidence >= minConfidence);

    // Hallucination validation
    if (validateHallucinations) {
      const values = confidentFactors.map((f) => f.value);
      const validation = validateAgainstBrief(values, brief);

      if (!validation.isValid) {
        warnings.push(...validation.warnings);
        log.warn(
          {
            event: "cee.llm_factor_extraction.hallucination_detected",
            warnings: validation.warnings,
          },
          "Potential hallucinations detected in LLM extraction"
        );
      }
    }

    // Convert LLM factors to ExtractedFactor format
    const factors = confidentFactors.map((llmFactor, index) =>
      convertLLMFactorToExtracted(llmFactor, context, index)
    );

    const durationMs = Date.now() - startTime;

    log.info(
      {
        event: "cee.llm_factor_extraction.complete",
        factorCount: factors.length,
        durationMs,
      },
      "LLM factor extraction complete"
    );

    return {
      factors,
      success: true,
      warnings,
      rawFactors: llmFactors,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error(
      {
        event: "cee.llm_factor_extraction.error",
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      },
      "LLM factor extraction failed"
    );

    return {
      factors: [],
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
 * Convert an LLM factor to the internal ExtractedFactor format.
 */
function convertLLMFactorToExtracted(
  llmFactor: LLMFactor,
  context: ResolvedContext,
  _index: number
): ExtractedFactor {
  // Expand any abbreviations in the label
  const expandedLabel = expandAbbreviation(context, llmFactor.label);

  // Determine extraction type based on presence of baseline/range
  let extractionType: ExtractionType = "explicit";
  if (llmFactor.range) {
    extractionType = "range";
  } else if (llmFactor.confidence < 0.8) {
    extractionType = "inferred";
  }

  return {
    label: expandedLabel !== llmFactor.label ? expandedLabel : llmFactor.label,
    value: llmFactor.value,
    baseline: llmFactor.baseline,
    unit: llmFactor.unit,
    confidence: llmFactor.confidence,
    matchedText: llmFactor.source_quote,
    extractionType,
    rangeMin: llmFactor.range?.min,
    rangeMax: llmFactor.range?.max,
  };
}

/**
 * Get the system prompt for factor extraction.
 * Exported for testing and customization.
 */
export function getFactorExtractionSystemPrompt(): string {
  return FACTOR_EXTRACTION_SYSTEM_PROMPT;
}

/**
 * Build the user prompt for factor extraction.
 * Exported for testing and customization.
 */
export function buildFactorExtractionPrompt(
  brief: string,
  context: ResolvedContext,
  maxFactors: number = 20
): string {
  return buildFactorExtractionUserPrompt(brief, context, maxFactors);
}
