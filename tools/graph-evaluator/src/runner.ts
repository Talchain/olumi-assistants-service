/**
 * Runner — iterates models × briefs, calls OpenAI Responses API, returns results.
 *
 * This module exports a clean async function with typed I/O. It does NOT read
 * CLI args, write to stdout, or perform file I/O directly. All of that is
 * handled by cli.ts and io.ts, enabling future API integration.
 */

import OpenAI from "openai";
import { extractJSON } from "./json-extractor.js";
import type {
  ModelConfig,
  Brief,
  LLMResponse,
  FailureCode,
  TokenUsage,
} from "./types.js";

// =============================================================================
// Retry configuration
// =============================================================================

/** Exponential backoff delays in ms (max 3 attempts after initial). */
const RETRY_DELAYS_MS = [2_000, 8_000, 32_000];

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Failure codes that are eligible for retry. */
const RETRYABLE_CODES: FailureCode[] = ["rate_limited", "server_error"];

/** Failure codes eligible for --resume re-run. */
export const RESUMABLE_CODES: FailureCode[] = [
  "parse_failed",
  "timeout_failed",
  "rate_limited",
];

// =============================================================================
// Runner input / output types
// =============================================================================

export interface RunInput {
  models: ModelConfig[];
  briefs: Brief[];
  promptContent: string;
  promptFile: string;
  runId: string;
  resultsDir: string;
  force: boolean;
  resume: boolean;
  dryRun: boolean;
  /** Called after each response is received (for progress reporting). */
  onResult?: (result: LLMResponse) => void;
  /** Called to check if a cached response should be skipped. */
  loadCached?: (modelId: string, briefId: string) => Promise<LLMResponse | null>;
  /** Called to save a response to the cache. */
  saveResult?: (modelId: string, briefId: string, result: LLMResponse) => Promise<void>;
}

// =============================================================================
// Cost calculation
// =============================================================================

function calculateCost(
  usage: TokenUsage,
  pricing: ModelConfig["pricing"]
): { cost: number; source: "api_usage" | "model_config" } {
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input_per_1m;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output_per_1m;
  return {
    cost: inputCost + outputCost,
    source: "api_usage",
  };
}

// =============================================================================
// OpenAI Responses API call
// =============================================================================

/**
 * Call the OpenAI Responses API for a single model × brief combination.
 *
 * Uses `client.responses.create()` (not chat.completions).
 * - `instructions` = system prompt equivalent
 * - `input` = user message
 * - `reasoning` parameter only sent for models with `reasoning_effort` in params
 */
async function callOpenAI(
  model: ModelConfig,
  promptContent: string,
  briefBody: string
): Promise<LLMResponse> {
  const apiKey = process.env[model.api_key_env];
  if (!apiKey) {
    throw new Error(
      `API key not set. Expected environment variable: ${model.api_key_env}`
    );
  }

  const client = new OpenAI({ apiKey });

  // Build request params
  const params: Record<string, unknown> = {
    model: model.model,
    instructions: promptContent,
    input: briefBody,
  };

  // Only add reasoning parameter for models that support it
  if (model.params.reasoning_effort !== undefined) {
    params["reasoning"] = { effort: model.params.reasoning_effort };
  }

  // Temperature — only for non-reasoning models
  if (
    model.params.temperature !== undefined &&
    model.params.reasoning_effort === undefined
  ) {
    params["temperature"] = model.params.temperature;
  }

  const startTime = Date.now();

  // Make the API call with a timeout signal
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort("timeout"),
    REQUEST_TIMEOUT_MS
  );

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.responses as any).create(params, {
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);

    const latencyMs = Date.now() - startTime;

    // Extract output text from response
    const rawText: string =
      response.output_text ??
      response.output
        ?.filter((o: { type: string }) => o.type === "message")
        ?.flatMap((o: { content: Array<{ type: string; text: string }> }) =>
          o.content
            ?.filter((c) => c.type === "output_text" || c.type === "text")
            ?.map((c) => c.text) ?? []
        )
        ?.join("") ??
      "";

    // Extract token usage
    const usageData = response.usage ?? {};
    const usage: TokenUsage = {
      input_tokens: usageData.input_tokens ?? usageData.prompt_tokens ?? 0,
      output_tokens: usageData.output_tokens ?? usageData.completion_tokens ?? 0,
      reasoning_tokens:
        usageData.output_tokens_details?.reasoning_tokens ??
        usageData.completion_tokens_details?.reasoning_tokens,
    };

    // Calculate cost from usage
    const { cost, source } = calculateCost(usage, model.pricing);

    // Extract JSON from raw response
    const extraction = extractJSON(rawText);

    if (extraction.parsed === null) {
      return {
        model_id: model.id,
        brief_id: "", // Set by caller
        status: "parse_failed",
        failure_code: "parse_failed",
        raw_text: rawText,
        extraction_attempted: extraction.extraction_attempted,
        latency_ms: latencyMs,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        reasoning_tokens: usage.reasoning_tokens,
        est_cost_usd: cost,
        pricing_source: source,
        error_message: "No extractable JSON found in response",
      };
    }

    return {
      model_id: model.id,
      brief_id: "",
      status: "success",
      raw_text: rawText,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed_graph: extraction.parsed as any,
      extraction_attempted: extraction.extraction_attempted,
      latency_ms: latencyMs,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      reasoning_tokens: usage.reasoning_tokens,
      est_cost_usd: cost,
      pricing_source: source,
    };
  } catch (err) {
    clearTimeout(timeoutHandle);
    const latencyMs = Date.now() - startTime;
    return classifyError(err, model.id, latencyMs, model.pricing);
  }
}

// =============================================================================
// Error classification
// =============================================================================

function classifyError(
  err: unknown,
  modelId: string,
  latencyMs: number,
  pricing: ModelConfig["pricing"]
): LLMResponse {
  const base = {
    model_id: modelId,
    brief_id: "",
    latency_ms: latencyMs,
    est_cost_usd: 0,
    pricing_source: "model_config" as const,
  };

  // AbortError = timeout
  if (
    err instanceof Error &&
    (err.name === "AbortError" || String(err.message).includes("timeout"))
  ) {
    return {
      ...base,
      status: "timeout_failed",
      failure_code: "timeout_failed",
      error_message: "Request timed out after 30s",
    };
  }

  // OpenAI API errors
  if (err instanceof OpenAI.APIError) {
    let failureCode: FailureCode;
    if (err.status === 429) failureCode = "rate_limited";
    else if (err.status === 401 || err.status === 403) failureCode = "auth_failed";
    else if (err.status === 400) failureCode = "invalid_request";
    else if (err.status != null && err.status >= 500) failureCode = "server_error";
    else failureCode = "server_error";

    return {
      ...base,
      status: failureCode,
      failure_code: failureCode,
      error_message: err.message,
    };
  }

  // Generic error
  return {
    ...base,
    status: "server_error",
    failure_code: "server_error",
    error_message: err instanceof Error ? err.message : String(err),
  };
}

// =============================================================================
// Retry wrapper
// =============================================================================

async function withRetry(
  fn: () => Promise<LLMResponse>,
  isTimeout: boolean = false
): Promise<LLMResponse> {
  let result = await fn();

  const maxRetries = isTimeout ? 1 : RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (!result.failure_code || !RETRYABLE_CODES.includes(result.failure_code)) {
      break;
    }

    const delay = isTimeout ? 2_000 : RETRY_DELAYS_MS[attempt];
    await sleep(delay);
    result = await fn();
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Main runner
// =============================================================================

/**
 * Run all model × brief combinations and return results.
 *
 * Does NOT write to disk directly — use the io.saveResult callback for that.
 */
export async function run(input: RunInput): Promise<LLMResponse[]> {
  const { models, briefs, promptContent, dryRun, onResult } = input;
  const results: LLMResponse[] = [];

  for (const model of models) {
    for (const brief of briefs) {
      // ── Cache check ───────────────────────────────────────────────────────
      if (input.loadCached && !dryRun && !input.force) {
        const cached = await input.loadCached(model.id, brief.id);

        if (cached !== null) {
          if (
            input.resume &&
            cached.failure_code &&
            RESUMABLE_CODES.includes(cached.failure_code)
          ) {
            // Resume mode: re-run failed entries
            console.log(`  [resume] Re-running ${model.id} × ${brief.id} (${cached.failure_code})`);
          } else if (!input.resume) {
            // Normal mode: skip cached
            console.log(`  [cache]  Skipping ${model.id} × ${brief.id}`);
            results.push(cached);
            continue;
          } else {
            // Resume mode, but this entry succeeded — skip
            console.log(`  [cache]  Skipping ${model.id} × ${brief.id} (already succeeded)`);
            results.push(cached);
            continue;
          }
        }
      }

      // ── Dry run ───────────────────────────────────────────────────────────
      if (dryRun) {
        console.log(`  [dry-run] Would run: ${model.id} × ${brief.id} (${brief.meta.complexity})`);
        continue;
      }

      // ── API call ──────────────────────────────────────────────────────────
      console.log(`  Running: ${model.id} × ${brief.id}...`);

      const callFn = () => callOpenAI(model, promptContent, brief.body);

      let result = await withRetry(callFn);

      // One retry for timeouts
      if (result.failure_code === "timeout_failed") {
        console.log(`  [retry]  Timeout on ${model.id} × ${brief.id}, retrying...`);
        result = await withRetry(callFn, true);
      }

      // Stamp the brief_id (callOpenAI doesn't have it in scope)
      result.brief_id = brief.id;

      // ── Save to disk ──────────────────────────────────────────────────────
      if (input.saveResult) {
        await input.saveResult(model.id, brief.id, result);
      }

      // ── Report progress ───────────────────────────────────────────────────
      const statusStr =
        result.status === "success"
          ? `✓ ${result.latency_ms}ms, cost $${(result.est_cost_usd ?? 0).toFixed(4)}`
          : `✗ ${result.failure_code}`;
      console.log(`  Done:    ${model.id} × ${brief.id} — ${statusStr}`);

      results.push(result);
      if (onResult) onResult(result);
    }
  }

  return results;
}
