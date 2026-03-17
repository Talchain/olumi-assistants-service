/**
 * Runner — iterates models × briefs, calls the appropriate LLM provider,
 * returns results.
 *
 * This module exports a clean async function with typed I/O. It does NOT read
 * CLI args, write to stdout, or perform file I/O directly. All of that is
 * handled by cli.ts and io.ts, enabling future API integration.
 */

import { extractJSON } from "./json-extractor.js";
import { getProvider } from "./providers/index.js";
import type {
  ModelConfig,
  Brief,
  LLMResponse,
  FailureCode,
} from "./types.js";

// Configure HTTP proxy for Node.js native fetch (undici).
// Node's native fetch does not read HTTPS_PROXY automatically; we must wire it
// up via undici's global dispatcher so the OpenAI SDK goes through the proxy.
const _proxyUrl =
  process.env["HTTPS_PROXY"] ??
  process.env["https_proxy"] ??
  process.env["HTTP_PROXY"] ??
  process.env["http_proxy"];
if (_proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(_proxyUrl));
}

// =============================================================================
// Retry configuration
// =============================================================================

/** Exponential backoff delays in ms (max 3 attempts after initial). */
const RETRY_DELAYS_MS = [2_000, 8_000, 32_000];

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
  /** Optional reminder text appended to every user message after two newlines. */
  reminderContent?: string;
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
  inputTokens: number,
  outputTokens: number,
  pricing: ModelConfig["pricing"]
): number {
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.input_per_1m +
    (outputTokens / 1_000_000) * pricing.output_per_1m
  );
}

// =============================================================================
// Single-model call via provider abstraction
// =============================================================================

async function callModel(
  model: ModelConfig,
  promptContent: string,
  userMessage: string
): Promise<LLMResponse> {
  const provider = getProvider(model);
  const result = await provider.chat(promptContent, userMessage, model);

  const cost = calculateCost(
    result.input_tokens ?? 0,
    result.output_tokens ?? 0,
    model.pricing
  );

  if (!result.ok) {
    // Map provider error string to FailureCode
    const failureCode = classifyErrorString(result.error ?? "server_error");
    return {
      model_id: model.id,
      brief_id: "",
      status: failureCode,
      failure_code: failureCode,
      error_message: result.error ?? undefined,
      latency_ms: result.latency_ms,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      reasoning_tokens: result.reasoning_tokens,
      est_cost_usd: cost,
      pricing_source: "api_usage",
    };
  }

  const rawText = result.text ?? "";

  // Extract JSON from raw response (draft_graph path — other adapters handle
  // parsing themselves, but runner needs to return something for scoring)
  const extraction = extractJSON(rawText);

  if (extraction.parsed === null) {
    return {
      model_id: model.id,
      brief_id: "",
      status: "parse_failed",
      failure_code: "parse_failed",
      raw_text: rawText,
      extraction_attempted: extraction.extraction_attempted,
      latency_ms: result.latency_ms,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      reasoning_tokens: result.reasoning_tokens,
      est_cost_usd: cost,
      pricing_source: "api_usage",
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
    latency_ms: result.latency_ms,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    reasoning_tokens: result.reasoning_tokens,
    est_cost_usd: cost,
    pricing_source: "api_usage",
  };
}

function classifyErrorString(err: string): FailureCode {
  const lower = err.toLowerCase();
  if (lower.includes("timeout")) return "timeout_failed";
  if (lower.includes("rate_limited")) return "rate_limited";
  if (lower.includes("auth_failed")) return "auth_failed";
  if (lower.includes("invalid_request")) return "invalid_request";
  return "server_error";
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
  const { models, briefs, promptContent, reminderContent, dryRun, onResult } = input;
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
        console.log(`  [dry-run] Would run: ${model.id} × ${brief.id} (${brief.meta?.complexity ?? "unknown"})`);
        continue;
      }

      // ── API call ──────────────────────────────────────────────────────────
      console.log(`  Running: ${model.id} × ${brief.id}...`);

      const userMessage = reminderContent
        ? `${brief.body}\n\n${reminderContent}`
        : brief.body;
      const callFn = () => callModel(model, promptContent, userMessage);

      let result = await withRetry(callFn);

      // One retry for timeouts
      if (result.failure_code === "timeout_failed") {
        console.log(`  [retry]  Timeout on ${model.id} × ${brief.id}, retrying...`);
        result = await withRetry(callFn, true);
      }

      // Stamp the brief_id (callModel doesn't have it in scope)
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
