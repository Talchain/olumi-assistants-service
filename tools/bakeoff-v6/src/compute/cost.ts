/**
 * True per-call USD cost attribution.
 *
 * RULE (lane requirement): when a response carries usage.iterations[] (the
 * advisor tool's per-attempt accounting), cost MUST be computed by summing
 * every iteration at that iteration's own model price. Top-level token counts
 * under-report advisor sub-inference and make arm D look artificially cheap.
 */
import { costUsd, type TokenUsageLike } from "../llm/pricing.ts";
import type { LlmCallResult } from "../llm/client.ts";
import type { CallRecord } from "../types.ts";

interface IterationLike {
  type?: string;
  model?: string;
  usage?: TokenUsageLike;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function iterationTokens(entry: IterationLike): TokenUsageLike {
  const src: TokenUsageLike =
    entry.usage && typeof entry.usage === "object" ? entry.usage : entry;
  return {
    input_tokens: src.input_tokens ?? 0,
    output_tokens: src.output_tokens ?? 0,
    cache_read_input_tokens: src.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: src.cache_creation_input_tokens ?? 0,
  };
}

function iterationModel(entry: IterationLike, requestedModel: string, advisorModel?: string): string {
  if (typeof entry.model === "string" && entry.model.length > 0) return normalizeModelId(entry.model);
  if (advisorModel && typeof entry.type === "string" && entry.type.toLowerCase().includes("advisor")) {
    return advisorModel;
  }
  return requestedModel;
}

/**
 * Served IDs can carry date suffixes (e.g. claude-sonnet-4-6-20251114) while
 * the pricing table pins aliases. Map onto the longest matching pinned alias;
 * unknown families still throw in costUsd (never priced silently).
 */
export function normalizeModelId(model: string): string {
  const known = ["claude-sonnet-5", "claude-sonnet-4-6", "claude-opus-4-8"];
  for (const alias of known.sort((a, b) => b.length - a.length)) {
    if (model === alias || model.startsWith(alias)) return alias;
  }
  return model;
}

export interface CostBreakdown {
  cost_usd: number;
  from_iterations: boolean;
}

export function computeCallCost(
  result: Pick<LlmCallResult, "usage" | "iterations">,
  requestedModel: string,
  advisorModel?: string
): CostBreakdown {
  if (result.iterations && result.iterations.length > 0) {
    let total = 0;
    for (const raw of result.iterations) {
      const entry = (raw ?? {}) as IterationLike;
      total += costUsd(iterationModel(entry, requestedModel, advisorModel), iterationTokens(entry));
    }
    return { cost_usd: total, from_iterations: true };
  }
  if (result.usage) {
    return {
      cost_usd: costUsd(normalizeModelId(requestedModel), result.usage as TokenUsageLike),
      from_iterations: false,
    };
  }
  return { cost_usd: 0, from_iterations: false };
}

export function buildCallRecord(
  purpose: string,
  requestedModel: string,
  result: LlmCallResult,
  advisorModel?: string
): CallRecord {
  const cost = computeCallCost(result, normalizeModelId(requestedModel), advisorModel);
  return {
    purpose,
    requested_model: requestedModel,
    served_model: result.servedModel,
    latency_ms: result.latencyMs,
    usage: result.usage,
    iterations: result.iterations,
    cost_usd: cost.cost_usd,
    cost_from_iterations: cost.from_iterations,
    stop_reason: result.stopReason,
  };
}
