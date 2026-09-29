/**
 * Request Timing Context
 *
 * Accumulates timing spans within a single HTTP request for:
 * - LLM call timings and token usage
 * - Downstream service call timings
 * - Summary aggregation for boundary.response
 *
 * Usage:
 * 1. Create context at request start: getOrCreateTiming(request)
 * 2. Record LLM calls: recordLlmCall(request, step, model, elapsed, tokens)
 * 3. Record downstream calls: recordDownstreamCall(request, target, elapsed)
 * 4. Get summary at request end: getTimingSummary(request)
 */

import type { FastifyRequest } from "fastify";
import { emit, TelemetryEvents } from "./telemetry.js";
import { getRequestId } from "./request-id.js";

/**
 * LLM call timing record
 */
export interface LlmCallTiming {
  step: string;
  model: string;
  provider: string;
  elapsed_ms: number;
  tokens_prompt?: number;
  tokens_completion?: number;
}

/**
 * Downstream service call timing record
 */
export interface DownstreamCallTiming {
  target: string;
  operation?: string;
  elapsed_ms: number;
  status?: number;
  /** Payload hash sent to downstream service */
  payload_hash?: string;
  /** Response hash received from downstream service */
  response_hash?: string;
}

/**
 * Request timing context
 */
export interface RequestTimingContext {
  llm_calls: LlmCallTiming[];
  downstream_calls: DownstreamCallTiming[];
}

/**
 * Timing summary for boundary.response
 */
export interface TimingSummary {
  llm: {
    total_ms: number;
    call_count: number;
    calls: Array<{ step: string; elapsed_ms: number }>;
  };
  downstream: {
    total_ms: number;
    call_count: number;
    calls: Array<{ target: string; elapsed_ms: number }>;
  };
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// Symbol to store timing context on request object
const TIMING_CONTEXT_KEY = Symbol("requestTimingContext");

/**
 * Get or create timing context for a request
 */
export function getOrCreateTiming(request: FastifyRequest): RequestTimingContext {
  if (!(request as any)[TIMING_CONTEXT_KEY]) {
    (request as any)[TIMING_CONTEXT_KEY] = {
      llm_calls: [],
      downstream_calls: [],
    };
  }
  return (request as any)[TIMING_CONTEXT_KEY];
}

/**
 * Get timing context if it exists (returns undefined if not created)
 */
export function getTiming(request: FastifyRequest): RequestTimingContext | undefined {
  return (request as any)[TIMING_CONTEXT_KEY];
}

/**
 * Record an LLM call timing
 *
 * @param request - Fastify request
 * @param step - Step/operation name (e.g., "extract_entities", "generate_response")
 * @param model - Model used (e.g., "gpt-4o-mini")
 * @param provider - Provider name (e.g., "openai", "anthropic")
 * @param elapsed_ms - Time taken in milliseconds
 * @param tokens - Optional token usage
 */
export function recordLlmCall(
  request: FastifyRequest,
  step: string,
  model: string,
  provider: string,
  elapsed_ms: number,
  tokens?: { prompt?: number; completion?: number }
): void {
  const context = getOrCreateTiming(request);
  const requestId = getRequestId(request);

  const timing: LlmCallTiming = {
    step,
    model,
    provider,
    elapsed_ms,
    tokens_prompt: tokens?.prompt,
    tokens_completion: tokens?.completion,
  };

  context.llm_calls.push(timing);

  // Emit llm.call event
  emit(TelemetryEvents.LlmCall, {
    request_id: requestId,
    step,
    model,
    provider,
    elapsed_ms,
    tokens_prompt: tokens?.prompt,
    tokens_completion: tokens?.completion,
  });
}

/**
 * Downstream call metadata for cross-service tracing
 */
export interface DownstreamCallMetadata {
  operation?: string;
  status?: number;
  payload_hash?: string;
  response_hash?: string;
}

/**
 * Record a downstream service call timing
 *
 * @param request - Fastify request
 * @param target - Target service (e.g., "isl", "vector-db")
 * @param elapsed_ms - Time taken in milliseconds
 * @param metadata - Optional metadata (operation, status, payload_hash, response_hash)
 */
export function recordDownstreamCall(
  request: FastifyRequest,
  target: string,
  elapsed_ms: number,
  metadata?: DownstreamCallMetadata | string,
  status?: number
): void {
  const context = getOrCreateTiming(request);
  const requestId = getRequestId(request);

  // Handle backward compatibility: metadata can be a string (operation) or object
  let meta: DownstreamCallMetadata = {};
  if (typeof metadata === "string") {
    meta.operation = metadata;
    meta.status = status;
  } else if (metadata) {
    meta = metadata;
  }

  const timing: DownstreamCallTiming = {
    target,
    operation: meta.operation,
    elapsed_ms,
    status: meta.status,
    payload_hash: meta.payload_hash,
    response_hash: meta.response_hash,
  };

  context.downstream_calls.push(timing);

  // Emit downstream.call event
  emit(TelemetryEvents.DownstreamCall, {
    request_id: requestId,
    target,
    operation: meta.operation,
    elapsed_ms,
    status: meta.status,
    payload_hash: meta.payload_hash,
    response_hash: meta.response_hash,
  });
}

/**
 * Get timing summary for boundary.response
 *
 * Aggregates all recorded timings into a summary object
 */
export function getTimingSummary(request: FastifyRequest): TimingSummary | undefined {
  const context = getTiming(request);

  if (!context || (context.llm_calls.length === 0 && context.downstream_calls.length === 0)) {
    return undefined;
  }

  // Aggregate LLM timings
  const llmTotalMs = context.llm_calls.reduce((sum, call) => sum + call.elapsed_ms, 0);
  const llmCalls = context.llm_calls.map((call) => ({
    step: call.step,
    elapsed_ms: call.elapsed_ms,
  }));

  // Aggregate downstream timings
  const downstreamTotalMs = context.downstream_calls.reduce((sum, call) => sum + call.elapsed_ms, 0);
  const downstreamCalls = context.downstream_calls.map((call) => ({
    target: call.target,
    elapsed_ms: call.elapsed_ms,
  }));

  // Aggregate token usage
  const tokensPrompt = context.llm_calls.reduce(
    (sum, call) => sum + (call.tokens_prompt || 0),
    0
  );
  const tokensCompletion = context.llm_calls.reduce(
    (sum, call) => sum + (call.tokens_completion || 0),
    0
  );

  return {
    llm: {
      total_ms: llmTotalMs,
      call_count: context.llm_calls.length,
      calls: llmCalls,
    },
    downstream: {
      total_ms: downstreamTotalMs,
      call_count: context.downstream_calls.length,
      calls: downstreamCalls,
    },
    tokens: {
      prompt: tokensPrompt,
      completion: tokensCompletion,
      total: tokensPrompt + tokensCompletion,
    },
  };
}

/**
 * Create a timing span for an async operation
 *
 * Automatically records start/end time and emits the appropriate event.
 * Use this for wrapping LLM and downstream calls.
 *
 * @example
 * const result = await withLlmTiming(request, "draft_graph", adapter.model, adapter.name, async () => {
 *   return await adapter.draftGraph(args, opts);
 * });
 */
export async function withLlmTiming<T>(
  request: FastifyRequest,
  step: string,
  model: string,
  provider: string,
  fn: () => Promise<T & { usage?: { input_tokens?: number; output_tokens?: number } }>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;

    recordLlmCall(request, step, model, provider, elapsed, {
      prompt: result.usage?.input_tokens,
      completion: result.usage?.output_tokens,
    });

    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    // Record the call even on failure (without token usage)
    recordLlmCall(request, step, model, provider, elapsed);
    throw error;
  }
}

/**
 * Create a timing span for a downstream service call
 *
 * @example
 * const result = await withDownstreamTiming(request, "isl", "synthesize", async () => {
 *   return await islClient.synthesize(payload);
 * });
 */
export async function withDownstreamTiming<T>(
  request: FastifyRequest,
  target: string,
  operation: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    recordDownstreamCall(request, target, elapsed, operation);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    recordDownstreamCall(request, target, elapsed, operation);
    throw error;
  }
}
