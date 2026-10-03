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
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { LlmInvocationCaptureIdentity, LlmPhysicalAttemptCapture } from '../adapters/llm/types.js';

interface InvocationCapture {
  logical_call_id: string;
  identity: LlmInvocationCaptureIdentity;
  attempts: LlmPhysicalAttemptCapture[];
}

interface CapturedSdkUsage {
  input_tokens?: unknown;
  prompt_tokens?: unknown;
  output_tokens?: unknown;
  completion_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
}

// Only lives for the existing SDK invocation; no request-id lookup or stored ledger.
const invocationCapture = new AsyncLocalStorage<InvocationCapture>();
const textIdentity = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const numericUsage = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function sentIdentity(provider: 'openai' | 'anthropic', body: unknown): LlmPhysicalAttemptCapture['sent_identity'] {
  const empty = { provider, model: null, reasoning_effort: null, thinking_mode: null, body_sha256: null, prompt_payload_sha256: null, tools_sha256: null };
  if (typeof body !== 'string') return empty;
  try {
    const sent = JSON.parse(body);
    if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return empty;
    const prompt = Object.fromEntries(['system', 'messages', 'instructions', 'input'].filter(k => Object.hasOwn(sent, k)).map(k => [k, sent[k]]));
    return {
      provider,
      model: textIdentity(sent.model),
      reasoning_effort: textIdentity(sent.reasoning_effort ?? sent.reasoning?.effort),
      thinking_mode: textIdentity(sent.thinking?.type),
      body_sha256: digest(body),
      prompt_payload_sha256: Object.keys(prompt).length > 0 ? digest(JSON.stringify(prompt)) : null,
      tools_sha256: Object.hasOwn(sent, 'tools') ? digest(JSON.stringify(sent.tools)) : null,
    };
  } catch {
    return empty;
  }
}

/** Observe the actual SDK fetch, including native retries, without reading its response body. */
export async function captureLlmPhysicalAttempt(
  provider: 'openai' | 'anthropic',
  init: { body?: unknown } | undefined,
  fn: () => Promise<Response>,
  transportGuard?: { policy_index: number | undefined },
): Promise<Response> {
  const scope = invocationCapture.getStore();
  if (!scope) return fn(); // Unscoped/raw callers are not silently assigned an identity.
  const began = performance.now();
  let sent = sentIdentity(provider, undefined);
  try { sent = sentIdentity(provider, init?.body); }
  catch { /* Request metadata is optional; the original fetch still runs. */ }
  const attempt: LlmPhysicalAttemptCapture = {
    logical_call_id: scope.logical_call_id,
    physical_attempt_id: randomUUID(),
    attempt_index: scope.attempts.length + 1,
    provider_policy_index: transportGuard ? transportGuard.policy_index ?? null : scope.identity.provider_policy_index ?? null,
    policy_index_source: transportGuard ? 'transport_guard' : scope.identity.provider_policy_index !== undefined ? 'logical_guard' : null,
    provider_request_id: null,
    outcome: 'pending', http_status: null, error_name: null, fetch_elapsed_ms: 0,
    latency_boundary: 'response_headers',
    sent_identity: sent,
  };
  scope.attempts.push(attempt);
  try {
    const result = await fn();
    attempt.outcome = 'response';
    try {
      attempt.http_status = result.status;
      attempt.outcome = result.ok ? 'response' : 'http_error';
      attempt.provider_request_id = textIdentity(result.headers.get(provider === 'openai' ? 'x-request-id' : 'request-id'));
    } catch { /* Unavailable metadata must not replace the original response. */ }
    return result;
  } catch (error) {
    attempt.outcome = 'transport_error';
    attempt.error_name = error instanceof Error ? error.name : null;
    throw error;
  } finally {
    attempt.fetch_elapsed_ms = Math.max(0, performance.now() - began);
  }
}

/** One terminal event for an existing SDK/retry group; attempts never increment logical timing counters. */
export async function withLlmInvocationCapture<T>(identity: LlmInvocationCaptureIdentity, fn: () => Promise<T>): Promise<T> {
  const scope: InvocationCapture = { logical_call_id: randomUUID(), identity, attempts: [] };
  const began = performance.now();
  let result: T | undefined;
  let failure: unknown;
  let succeeded = false;
  return invocationCapture.run(scope, async () => {
    try {
      result = await fn();
      succeeded = true;
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // Observer failures must neither replace an SDK result/error nor cause retries.
      try {
        const value = result as {
          usage?: CapturedSdkUsage;
          response?: { usage?: CapturedSdkUsage };
          message?: { usage?: CapturedSdkUsage };
          kind?: unknown;
          error?: unknown;
        } | undefined;
        const raw = value?.usage ?? value?.response?.usage ?? value?.message?.usage;
        // Draft streaming may resolve with a recoverable rejection/early abort.
        // Preserve that result and its existing outer recovery, but name it honestly.
        const resultKind = textIdentity(value?.kind);
        const outcome = !succeeded ? 'failure'
          : resultKind === 'runaway' || resultKind === 'so_reject' ? resultKind : 'success';
        const terminalError = failure ?? value?.error;
        const usage = {
          input_tokens: numericUsage(raw?.input_tokens ?? raw?.prompt_tokens),
          output_tokens: numericUsage(raw?.output_tokens ?? raw?.completion_tokens),
          cached_input_tokens: numericUsage(raw?.cache_read_input_tokens ?? raw?.prompt_tokens_details?.cached_tokens),
          cache_creation_input_tokens: numericUsage(raw?.cache_creation_input_tokens),
          reasoning_tokens: numericUsage(raw?.completion_tokens_details?.reasoning_tokens),
        };
        const elapsed = Math.max(0, performance.now() - began);
        emit(TelemetryEvents.LlmCall, {
          request_id: textIdentity(identity.request_id), step: identity.step, model: identity.model, provider: identity.provider,
          elapsed_ms: elapsed,
          ...(usage.input_tokens !== null ? { tokens_prompt: usage.input_tokens } : {}),
          ...(usage.output_tokens !== null ? { tokens_completion: usage.output_tokens } : {}),
          provider_trace: {
            logical_call_id: scope.logical_call_id, request_id: textIdentity(identity.request_id),
            provider_policy_index: identity.provider_policy_index ?? null,
            outcome,
            result_kind: resultKind,
            terminal_boundary: 'sdk_invocation',
            error_name: terminalError instanceof Error ? terminalError.name : null,
            error_status: numericUsage((terminalError as { status?: unknown } | undefined)?.status),
            prompt_version: identity.prompt_meta?.prompt_version ?? identity.prompt_meta?.version ?? null,
            prompt_source: identity.prompt_meta?.source ?? null,
            registered_prompt_hash: identity.prompt_meta?.prompt_hash ?? null,
            elapsed_ms: elapsed, usage_scope: 'returned_sdk_result', usage, quality: null, cost: null, attempts: scope.attempts,
          },
        });
      } catch { /* Incidental telemetry cannot change provider behaviour. */ }
    }
  });
}

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
