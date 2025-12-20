/**
 * LLM Extraction Utility
 *
 * Provides a simple interface for calling LLMs for structured extraction tasks
 * (factor extraction, constraint extraction, etc.).
 *
 * Uses the existing LLM router infrastructure for provider selection and failover.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface ExtractionCallOptions {
  /** Request ID for telemetry */
  requestId?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum tokens to generate (default: 2000) */
  maxTokens?: number;
  /** Temperature (default: 0 for deterministic extraction) */
  temperature?: number;
}

export interface ExtractionResult {
  /** Parsed response (if successful) */
  response: unknown | null;
  /** Raw response text */
  rawText?: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Token usage */
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Model Selection
// ============================================================================

/**
 * Get the model to use for extraction tasks.
 * Priority: CEE_MODEL_EXTRACTION > CEE_MODEL_DRAFT > provider default
 */
function getExtractionModel(provider: "openai" | "anthropic"): string {
  // Prefer dedicated extraction model
  if (config.cee.models.extraction) {
    return config.cee.models.extraction;
  }
  // Fall back to draft model
  if (config.cee.models.draft) {
    return config.cee.models.draft;
  }
  // Provider defaults
  return provider === "openai" ? "gpt-4o-mini" : "claude-3-5-sonnet-20241022";
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON from LLM response text.
 * Handles various formats:
 * - Raw JSON
 * - JSON wrapped in ```json ... ```
 * - Multiple code blocks (takes first JSON block)
 * - Trailing explanatory text after JSON
 */
function extractJSON(text: string): unknown {
  // Try raw JSON first (most common for OpenAI with json_object mode)
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Find the matching closing bracket
    const openBracket = trimmed[0];
    const closeBracket = openBracket === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === openBracket) depth++;
      if (char === closeBracket) depth--;

      if (depth === 0) {
        // Found the complete JSON - parse just this portion
        const jsonStr = trimmed.slice(0, i + 1);
        return JSON.parse(jsonStr);
      }
    }
  }

  // Try markdown code blocks (Claude often uses these)
  // Match ```json or just ```
  const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches = [...text.matchAll(codeBlockPattern)];

  for (const match of matches) {
    const blockContent = match[1].trim();
    if (blockContent.startsWith("{") || blockContent.startsWith("[")) {
      try {
        return JSON.parse(blockContent);
      } catch {
        // Try next block
        continue;
      }
    }
  }

  // Last resort: try parsing the whole thing
  return JSON.parse(trimmed);
}

// ============================================================================
// Provider Detection
// ============================================================================

function getActiveProvider(): "openai" | "anthropic" | "fixtures" {
  // Check environment/config for provider
  const envProvider = config.llm.provider;
  if (envProvider === "anthropic" || envProvider === "openai" || envProvider === "fixtures") {
    return envProvider;
  }
  return "openai"; // Default to OpenAI
}

// ============================================================================
// Timeout Wrapper
// ============================================================================

/**
 * Wrap a promise with an AbortController timeout.
 * Throws TimeoutError if the operation exceeds the specified duration.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`LLM extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Listen for abort signal
    signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new Error("LLM extraction aborted"));
    });

    // Execute the promise
    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// ============================================================================
// OpenAI Extraction
// ============================================================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  const apiKey = config.llm.openaiApiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for LLM extraction");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  options: ExtractionCallOptions,
  abortSignal: AbortSignal
): Promise<ExtractionResult> {
  const { timeoutMs = 30000, maxTokens = 2000, temperature = 0 } = options;

  try {
    const client = getOpenAIClient();
    const model = getExtractionModel("openai");

    const responsePromise = client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
    });

    const response = await withTimeout(responsePromise, timeoutMs, abortSignal);

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) {
      return {
        response: null,
        success: false,
        error: "Empty response from OpenAI",
      };
    }

    // Parse JSON response using hardened extractor
    const parsed = extractJSON(rawText);

    return {
      response: parsed,
      rawText,
      success: true,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { event: "cee.extraction.openai_error", error: message },
      "OpenAI extraction call failed"
    );
    return {
      response: null,
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// Anthropic Extraction
// ============================================================================

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  const apiKey = config.llm.anthropicApiKey;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for LLM extraction");
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  options: ExtractionCallOptions,
  abortSignal: AbortSignal
): Promise<ExtractionResult> {
  const { timeoutMs = 30000, maxTokens = 2000, temperature = 0 } = options;

  try {
    const client = getAnthropicClient();
    const model = getExtractionModel("anthropic");

    const responsePromise = client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const response = await withTimeout(responsePromise, timeoutMs, abortSignal);

    const textBlock = response.content.find((b) => b.type === "text");
    const rawText = textBlock?.type === "text" ? textBlock.text : null;

    if (!rawText) {
      return {
        response: null,
        success: false,
        error: "Empty response from Anthropic",
      };
    }

    // Parse JSON response using hardened extractor
    const parsed = extractJSON(rawText);

    return {
      response: parsed,
      rawText,
      success: true,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { event: "cee.extraction.anthropic_error", error: message },
      "Anthropic extraction call failed"
    );
    return {
      response: null,
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// Fixtures (Testing)
// ============================================================================

async function callFixtures(
  _systemPrompt: string,
  _userPrompt: string,
  _options: ExtractionCallOptions
): Promise<ExtractionResult> {
  // Return null to trigger fallback to regex in tests
  return {
    response: null,
    success: false,
    error: "Fixtures provider returns null for extraction (regex fallback)",
  };
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Call LLM for structured extraction.
 *
 * Uses the configured provider (OpenAI, Anthropic, or Fixtures) to call the LLM
 * with the given system and user prompts. Expects JSON response.
 *
 * Features:
 * - Real timeout enforcement via AbortController
 * - Dedicated extraction model (CEE_MODEL_EXTRACTION)
 * - Hardened JSON parsing for Claude responses
 *
 * @param systemPrompt - System prompt with extraction instructions
 * @param userPrompt - User prompt with the brief/content to extract from
 * @param options - Call options (timeout, max tokens, etc.)
 * @returns Extraction result with parsed response or error
 */
export async function callLLMForExtraction(
  systemPrompt: string,
  userPrompt: string,
  options: ExtractionCallOptions = {}
): Promise<ExtractionResult> {
  const provider = getActiveProvider();
  const startTime = Date.now();
  const abortController = new AbortController();

  log.debug(
    {
      event: "cee.extraction.call_start",
      provider,
      requestId: options.requestId,
      timeoutMs: options.timeoutMs ?? 30000,
    },
    "Starting LLM extraction call"
  );

  let result: ExtractionResult;

  try {
    switch (provider) {
      case "openai":
        result = await callOpenAI(systemPrompt, userPrompt, options, abortController.signal);
        break;
      case "anthropic":
        result = await callAnthropic(systemPrompt, userPrompt, options, abortController.signal);
        break;
      case "fixtures":
        result = await callFixtures(systemPrompt, userPrompt, options);
        break;
      default:
        result = {
          response: null,
          success: false,
          error: `Unknown provider: ${provider}`,
        };
    }
  } catch (error) {
    // Handle timeout or abort errors
    const message = error instanceof Error ? error.message : String(error);
    result = {
      response: null,
      success: false,
      error: message,
    };
  }

  const durationMs = Date.now() - startTime;

  log.info(
    {
      event: "cee.extraction.call_complete",
      provider,
      success: result.success,
      durationMs,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
    },
    `LLM extraction call ${result.success ? "succeeded" : "failed"}`
  );

  return result;
}

/**
 * Reset clients for testing.
 */
export function resetExtractionClients(): void {
  openaiClient = null;
  anthropicClient = null;
}
