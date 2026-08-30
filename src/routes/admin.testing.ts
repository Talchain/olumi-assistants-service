/**
 * Admin Prompt Testing Endpoint
 *
 * POST /admin/v1/test-prompt-llm
 *
 * Allows admins to test specific prompt versions with LLM calls.
 * Separate from production traffic with independent rate limiting.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { RateLimitedError, retryAfterSecondsFromRateLimitContext } from '../utils/errors.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import { getPromptStore, isPromptStoreHealthy } from '../prompts/store.js';
import { interpolatePrompt } from '../prompts/schema.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { getRequestId } from '../utils/request-id.js';
import { MODEL_REGISTRY, isReasoningModel, anthropicTemperatureFor } from '../config/models.js';
import { THINKING_CAPABLE_MODELS } from '../adapters/llm/anthropic-model-capabilities.js';
import {
  ModelAssignmentError,
  resolveModelAssignment,
  type ResolvedModelAssignment,
} from '../config/model-assignment.js';
import { requiresMaxCompletionTokens } from '../adapters/llm/openai.js';
import { getDefaultModelForTask, isValidCeeTask } from '../config/model-routing.js';
import { checkModelAvailability, getModelErrorSummary, recordModelError, fetchOpenAIModels, getAnthropicModels } from '../services/model-availability.js';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { ADMIN_LLM_TIMEOUT_MS, ADMIN_REASONING_TIMEOUT_MS, ADMIN_REASONING_HIGH_TIMEOUT_MS } from '../config/timeouts.js';

/**
 * Check if a model requires max_completion_tokens instead of max_tokens.
 * This applies to reasoning models and all GPT-5.x models.
 */
function needsMaxCompletionTokens(model: string): boolean {
  const assignment = resolveModelAssignment(model);
  return assignment.provider === 'openai'
    ? requiresMaxCompletionTokens(assignment.model)
    : false;
}

/**
 * Whether this model's API accepts `thinking: { type: 'enabled', budget_tokens }`.
 *
 * THE SAME AUTHORITY THE LIVE PATH CONSULTS. Every live Anthropic call site gates
 * thinking on `isThinkingSupported` (adapters/llm/anthropic.ts:619-620), which
 * reads `THINKING_CAPABLE_MODELS` — the set DERIVED from the live-probed
 * capability map. This harness previously used `MODEL_REGISTRY.extendedThinking`
 * instead, which `anthropic-model-capabilities.ts:47-52` records as measured WRONG
 * IN BOTH DIRECTIONS on 2026-08-08 and explicitly says not to infer this verdict
 * from: it claims `true` for claude-sonnet-5 (which returns HTTP 400 for
 * `thinking.type:'enabled'`) and `false` for claude-sonnet-4-6 (which returns
 * HTTP 200 and emits thinking blocks).
 *
 * The consequence was that the operator harness could not measure a prompt
 * candidate against the model staging actually serves: `budget_tokens` passed
 * local validation on sonnet-5 and was then 400'd by the API, and sonnet-4-6 was
 * refused a thinking budget its API accepts. Two authorities answering one
 * question under similar names is CLAUDE.md trap 21; there is now one.
 */
function acceptsThinkingBudget(model: string): boolean {
  return THINKING_CAPABLE_MODELS.has(model);
}

/**
 * THE HARNESS'S MOST CONSEQUENTIAL LIMIT, DISCLOSED AT THE POINT OF USE.
 *
 * This harness is an operator convenience, not a replica of any live path: it
 * sends the prompt as a SINGLE system block with no structured-outputs grammar
 * and parses the reply as `{nodes, edges}`. A limit stated only in a merged
 * pull-request description is a trap for the next lane — the next lane reads the
 * RESPONSE, not the PR — so this notice rides every response and the admin UI
 * renders it from there. It has already cost us once: a measurement lane read
 * 6 of 9 draws as "clean" through a grammar value that does not exist, because
 * nothing on the wire said no grammar had been sent.
 *
 * Unconditional by design. It makes no claim that any OTHER task's composition
 * matches its live path — "no established divergence" is not a fidelity finding,
 * and phrasing it as one would be the overclaim this notice exists to stop.
 */
export const HARNESS_FIDELITY_NOTICE =
  'This harness is NOT a replica of any live path. It sends the prompt as a single system ' +
  'block with no structured-outputs grammar, and parses the reply as {nodes, edges}. Read a ' +
  'result here as evidence about the prompt TEXT only, never as a prediction of live behaviour.';

/**
 * The established divergence for a `draft_graph` candidate on Anthropic.
 *
 * Derived at the bytes, and CITED so the next lane can check it rather than
 * trust it. Note what is deliberately NOT asserted: the grammar half is stated
 * with its condition (`CEE_ANTHROPIC_STRUCTURED_OUTPUTS`, a capable model,
 * thinking off) rather than as a flat fact, because the deployed value of that
 * flag lives in the Render dashboard and cannot be read from this tree
 * (CLAUDE.md trap 18). The SECOND SYSTEM BLOCK carries no such caveat: it is
 * pushed unconditionally, with no flag and no gate.
 */
const DRAFT_GRAPH_DIVERGENCE =
  'draft_graph on Anthropic: this harness sends ONE system block and no structured-outputs ' +
  'grammar. The live draft path sends TWO system blocks — it unconditionally appends ' +
  'DRAFT_RECORDS_INSTRUCTION ("Do not emit a graph. Emit two lists instead.", ' +
  'src/adapters/llm/anthropic.ts:517, no flag and no gate) — and, when ' +
  'CEE_ANTHROPIC_STRUCTURED_OUTPUTS is on for a capable model with thinking off, a records ' +
  'grammar in the output_config slot; a deterministic projector then turns those records back ' +
  'into a graph after the call. So a draft_graph result HERE DOES NOT PREDICT LIVE BEHAVIOUR: ' +
  'it measures the prompt against a composition production never runs, and a records-shaped ' +
  'reply will fail this harness’s graph parse and read as a bad prompt.';

/**
 * The composition of a request body, READ OFF THE BODY that is about to be sent.
 *
 * Never a restated literal. The disclosure's whole value is that it cannot drift
 * from the wire: the day a lane closes the two-block gap, these numbers move with
 * it, and a hand-maintained "1" would have kept saying one — a stale disclosure
 * reads as current and is worse than none (CLAUDE.md trap 12).
 */
interface RequestComposition {
  system_blocks: number;
  structured_outputs_grammar: boolean;
}

function deriveRequestComposition(body: Record<string, unknown>): RequestComposition {
  const system = body.system;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemBlocks = Array.isArray(system)
    ? system.length
    : typeof system === 'string'
      ? 1
      : messages.filter((m) => (m as { role?: string } | null)?.role === 'system').length;

  return {
    system_blocks: systemBlocks,
    // Anthropic's GA structured-outputs slot, and OpenAI's equivalent. Presence
    // on the body, never an assumption about what the harness "should" send.
    structured_outputs_grammar: 'output_config' in body || 'response_format' in body,
  };
}

/**
 * Check if a model doesn't support custom temperature values.
 * GPT-5.x models only support temperature=1 (default).
 */
function doesNotSupportCustomTemperature(model: string): boolean {
  const assignment = resolveModelAssignment(model);
  return Boolean(
    assignment.config?.reasoning ||
      assignment.config?.rejectsSamplingParams,
  );
}

// ============================================================================
// Types
// ============================================================================

const TestPromptLLMRequestSchema = z.object({
  prompt_id: z.string().min(1, 'prompt_id is required'),
  version: z.number().int().positive('version must be a positive integer'),
  brief: z.string().min(30, 'brief must be at least 30 characters').max(5000, 'brief must be at most 5000 characters'),
  options: z.object({
    model: z.string().optional(),
    skip_repairs: z.boolean().optional(),
    // LLM parameter overrides
    reasoning_effort: z.enum(['low', 'medium', 'high']).optional(), // OpenAI reasoning models only
    budget_tokens: z.number().int().positive().max(128000).optional(), // Anthropic extended thinking (thinking budget)
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().max(128000).optional(),
    seed: z.number().int().optional(), // For reproducibility (OpenAI deterministic seed)
    top_p: z.number().min(0).max(1).optional(), // Nucleus sampling (default 1.0)
  }).optional(),
});

type _TestPromptLLMRequest = z.infer<typeof TestPromptLLMRequestSchema>;

/**
 * Extended validation issue with rich metadata for debugging.
 */
interface ExtendedValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  affected_node_id?: string;
  affected_edge_id?: string;
  stage?: string;
}

interface TestPromptLLMResponse {
  request_id: string;
  success: boolean;
  error?: string;

  prompt?: {
    id: string;
    version: number;
    content_hash: string;
    content_preview: string;
    content_length: number;
  };

  llm?: {
    model: string;
    provider: string;
    raw_output: string;
    raw_output_hash: string;
    duration_ms: number;
    token_usage: {
      prompt: number;
      completion: number;
      total: number;
    };
    finish_reason: string;
    temperature: number | null;
    max_tokens: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
    budget_tokens?: number; // Anthropic extended thinking
    seed?: number;
    top_p?: number;
  };

  pipeline?: {
    stages: Array<{
      name: string;
      status: 'success' | 'skipped' | 'repaired' | 'failed';
      duration_ms: number;
    }>;
    repairs_applied: string[];
    node_counts?: {
      raw: Record<string, number>;
      validated: Record<string, number>;
    };
    total_duration_ms: number;
  };

  result?: {
    graph: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    validation: {
      passed: boolean;
      issues: ExtendedValidationIssue[];
      error_count: number;
      warning_count: number;
      info_count: number;
    };
  };

  /**
   * WHAT THIS RESULT IS AND IS NOT EVIDENCE OF.
   *
   * Present on EVERY completed run, success or failure. It rides the payload —
   * not just the admin UI — because the consumer that gets burned by the gap is
   * as often a script as a person, and a UI-only banner would not have reached
   * the measurement lane that read 6 of 9 draws as "clean" through a grammar
   * value that does not exist.
   */
  harness_fidelity?: {
    /** Read off the body sent to the provider SDK. Absent if no call was made. */
    system_blocks_sent?: number;
    /** Whether that body carried a structured-outputs grammar slot. */
    structured_outputs_grammar_sent?: boolean;
    /** How this harness interprets the reply, regardless of task. */
    output_parsed_as: 'graph_nodes_edges';
    /**
     * ESTABLISHED divergences that apply to THIS run. An empty list is not a
     * fidelity claim about the other paths — see `notice`.
     */
    divergences: string[];
    /** Unconditional. True of every run this harness performs. */
    notice: string;
  };
}

// ============================================================================
// Authentication helpers
// ============================================================================

function ensureStoreHealthy(reply: FastifyReply): boolean {
  if (!isPromptStoreHealthy()) {
    reply.status(503).send({
      error: 'store_unavailable',
      message: 'Prompt store is not available. The store may have failed to initialize.',
    });
    return false;
  }
  return true;
}

// ============================================================================
// Error Sanitization
// ============================================================================

/**
 * Sanitize error messages for external responses.
 * Removes stack traces and internal file paths while preserving useful error info.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Extract just the message, removing any stack trace
    let message = error.message;

    // Remove file paths that might leak internal structure
    message = message.replace(/\/[^\s:]+\.(ts|js|mjs)/g, '<path>');

    // Remove line/column numbers
    message = message.replace(/:\d+:\d+/g, '');

    // Truncate very long messages
    if (message.length > 500) {
      message = message.substring(0, 497) + '...';
    }

    return message;
  }

  // For non-Error objects, convert to string but limit length
  const str = String(error);
  return str.length > 500 ? str.substring(0, 497) + '...' : str;
}

// ============================================================================
// LLM Call helpers
// ============================================================================

/**
 * Get appropriate timeout based on model type and reasoning effort.
 */
function getLLMTimeout(model: string, reasoningEffort?: 'low' | 'medium' | 'high'): number {
  if (!isReasoningModel(model)) {
    return ADMIN_LLM_TIMEOUT_MS;
  }
  // Reasoning models need more time, especially with HIGH effort
  if (reasoningEffort === 'high') {
    return ADMIN_REASONING_HIGH_TIMEOUT_MS;
  }
  return ADMIN_REASONING_TIMEOUT_MS;
}

interface LLMCallOptions {
  temperature?: number | null;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high'; // OpenAI reasoning models
  budgetTokens?: number; // Anthropic extended thinking (thinking budget)
  seed?: number;
  topP?: number;
}

interface LLMCallResult {
  success: boolean;
  error?: string;
  raw_output?: string;
  raw_output_hash?: string;
  duration_ms: number;
  token_usage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  finish_reason?: string;
  temperature: number | null;
  max_tokens: number;
  model: string;
  provider: string;
  reasoning_effort?: 'low' | 'medium' | 'high'; // OpenAI reasoning models
  budget_tokens?: number; // Anthropic extended thinking
  seed?: number;
  top_p?: number;
  /**
   * DERIVED from the body actually handed to the provider SDK — see
   * `deriveRequestComposition`. Absent when no call was attempted (e.g. no API
   * key), which is honest: "unknown" is not "one".
   */
  request_composition?: RequestComposition;
}

async function callLLMWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  options?: LLMCallOptions,
): Promise<LLMCallResult> {
  const startTime = Date.now();
  const assignment = resolveModelAssignment(model);
  const modelConfig = assignment.config;
  const provider = assignment.provider;

  // Use provided maxTokens or fall back to model config
  const maxTokens = options?.maxTokens ?? modelConfig?.maxTokens ?? 4096;

  // Temperature: null means "not set" (use model default), 0 is valid for deterministic output
  // Default to 0 for admin testing if not explicitly set
  const temperature = options?.temperature ?? 0;

  // Reasoning effort only applies to reasoning models
  const reasoningEffort = options?.reasoningEffort;

  // Extract seed and top_p for reproducibility and sampling control
  const seed = options?.seed;
  const topP = options?.topP;

  // Extract budgetTokens for Anthropic extended thinking
  const budgetTokens = options?.budgetTokens;

  if (provider === 'anthropic') {
    return callAnthropicWithPrompt(systemPrompt, userContent, model, maxTokens, temperature, startTime, budgetTokens);
  } else {
    return callOpenAIWithPrompt(systemPrompt, userContent, model, maxTokens, temperature, startTime, reasoningEffort, seed, topP);
  }
}

async function callAnthropicWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  maxTokens: number,
  temperature: number | null,
  startTime: number,
  budgetTokens?: number,
): Promise<LLMCallResult> {
  const apiKey = config.llm?.anthropicApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'Anthropic API key not configured',
      duration_ms: Date.now() - startTime,
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
    };
  }

  const client = new Anthropic({ apiKey });
  const abortController = new AbortController();

  // Extended thinking models need longer timeout AND streaming
  // Anthropic requires streaming for operations that may take >10 minutes
  const hasExtendedThinking = acceptsThinkingBudget(model) && budgetTokens !== undefined;
  const effectiveTimeout = hasExtendedThinking ? ADMIN_REASONING_HIGH_TIMEOUT_MS : ADMIN_LLM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

  // Effective temperature: default to 0 if null (deterministic for testing)
  // Note: Extended thinking mode requires temperature=1.
  //
  // RIDER-A / D-60 (2026-07-24): models that REJECT explicit sampling params
  // (Sonnet 5, Opus 4.7+, Fable 5) 400 on ANY temperature — this admin harness
  // was the 5th #651-family call site missing the gate, so a decision_review A/B
  // arm on claude-sonnet-5 could not even be measured. The temperature policy is
  // now single-sourced in anthropicTemperatureFor (FINAL-SWEEP F2) so a call site
  // physically cannot omit the gate again.
  const effectiveTemperature: number | undefined = anthropicTemperatureFor(model, {
    requested: temperature,
    thinking: hasExtendedThinking,
  });
  // Reported value on the result envelope (number | null contract).
  const reportedTemperature: number | null = effectiveTemperature ?? null;

  // The composition ACTUALLY sent, read off the body built below. Hoisted so the
  // error paths disclose it too: a failed run is precisely when a composition gap
  // gets misread as a bad prompt.
  let requestComposition: RequestComposition | undefined;

  try {
    // Build request params — send an EXPLICIT thinking posture, NEVER omit the
    // field. This mirrors the LIVE draft path (adapters/llm/anthropic.ts:974-976)
    // and exists for the reason its comment gives: a thinking-class model routed
    // here — claude-sonnet-5 is the live `draft_graph` default and its own
    // registry description says "adaptive thinking on by default" — runs ADAPTIVE
    // thinking when `thinking` is absent, which burns the token budget invisibly.
    // Omitting the field is therefore not "no thinking", it is "unmeasured
    // thinking", and it made a sonnet-5 prompt candidate unmeasurable through this
    // harness. Live-probed on the draft path: the API accepts
    // `thinking:{type:'disabled'}` with and without output_config.
    const thinkingParam = hasExtendedThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: budgetTokens } }
      : { thinking: { type: 'disabled' as const } };

    // Use streaming for extended thinking (required by Anthropic for long operations)
    // and also recommended for Opus models which can have long response times
    const useStreaming = hasExtendedThinking || model.includes('opus');

    // ONE body, shared by both transports — named rather than inlined twice so
    // the fidelity disclosure can be DERIVED from it. `system` is a STRING here:
    // that single block is the limit this harness discloses, and reading the
    // count off the body means a lane that later appends the records block moves
    // the disclosure with it, for free.
    const requestBody = {
      model,
      max_tokens: maxTokens,
      temperature: effectiveTemperature,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: userContent }],
      ...thinkingParam,
    };
    requestComposition = deriveRequestComposition(requestBody);

    let raw_output = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'unknown';

    if (useStreaming) {
      // Use streaming API for extended thinking and Opus models
      const stream = client.messages.stream(requestBody, {
        signal: abortController.signal,
      });

      // Collect the streamed response
      const response = await stream.finalMessage();

      // Handle response - find the text content block
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        clearTimeout(timeoutId);
        return {
          success: false,
          error: `No text content in response. Content types: ${response.content.map(c => c.type).join(', ')}`,
          duration_ms: Date.now() - startTime,
          temperature: reportedTemperature,
          max_tokens: maxTokens,
          model,
          provider: 'anthropic',
          budget_tokens: budgetTokens,
          request_composition: requestComposition,
        };
      }

      raw_output = textContent.text;
      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      stopReason = response.stop_reason ?? 'unknown';
    } else {
      // Use non-streaming for standard models
      const response = await client.messages.create(requestBody, {
        signal: abortController.signal,
      });

      // Handle response - find the text content block
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        clearTimeout(timeoutId);
        return {
          success: false,
          error: `No text content in response. Content types: ${response.content.map(c => c.type).join(', ')}`,
          duration_ms: Date.now() - startTime,
          temperature: reportedTemperature,
          max_tokens: maxTokens,
          model,
          provider: 'anthropic',
          budget_tokens: budgetTokens,
          request_composition: requestComposition,
        };
      }

      raw_output = textContent.text;
      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      stopReason = response.stop_reason ?? 'unknown';
    }

    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;
    const raw_output_hash = createHash('sha256').update(raw_output).digest('hex');

    return {
      success: true,
      raw_output,
      raw_output_hash,
      duration_ms,
      token_usage: {
        prompt: inputTokens,
        completion: outputTokens,
        total: inputTokens + outputTokens,
      },
      finish_reason: stopReason,
      temperature: reportedTemperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
      budget_tokens: budgetTokens,
      request_composition: requestComposition,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const timeoutMinutes = Math.round(effectiveTimeout / 60000);

    // Track model errors for deprecation detection
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorType: 'not_found' | 'invalid_model' | 'deprecated' | 'rate_limit' | 'other' = 'other';

    if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      errorType = 'not_found';
    } else if (errorMessage.includes('invalid model') || errorMessage.includes('invalid_model')) {
      errorType = 'invalid_model';
    } else if (errorMessage.includes('deprecated')) {
      errorType = 'deprecated';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('rate_limit')) {
      errorType = 'rate_limit';
    }

    if (!isTimeout) {
      recordModelError({
        model_id: model,
        provider: 'anthropic',
        error_type: errorType,
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: false,
      error: isTimeout ? `LLM request timed out after ${timeoutMinutes} minutes` : sanitizeErrorMessage(error),
      duration_ms,
      temperature: reportedTemperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
      budget_tokens: budgetTokens,
      request_composition: requestComposition,
    };
  }
}

async function callOpenAIWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  maxTokens: number,
  temperature: number | null,
  startTime: number,
  reasoningEffort?: 'low' | 'medium' | 'high',
  seed?: number,
  topP?: number,
): Promise<LLMCallResult> {
  const apiKey = config.llm?.openaiApiKey;
  if (!apiKey) {
    return {
      success: false,
      error: 'OpenAI API key not configured',
      duration_ms: Date.now() - startTime,
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'openai',
    };
  }

  const client = new OpenAI({ apiKey });
  const abortController = new AbortController();
  const effectiveTimeout = getLLMTimeout(model, reasoningEffort);
  const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

  // Determine if this is a reasoning model
  const isReasoning = isReasoningModel(model);

  // The composition ACTUALLY sent, read off the body built below (see the
  // Anthropic arm for why this is derived rather than restated).
  let requestComposition: RequestComposition | undefined;

  try {
    // Build request params - GPT-5.x and reasoning models need max_completion_tokens
    const useMaxCompletionTokens = needsMaxCompletionTokens(model);
    const tokenParam = useMaxCompletionTokens
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    // GPT-5.x and reasoning models don't support custom temperature
    // temperature=null means don't send temperature at all (use model default)
    const tempParam = doesNotSupportCustomTemperature(model)
      ? {}
      : temperature !== null
        ? { temperature }
        : {};

    // Add reasoning_effort for reasoning models
    const reasoningParam = isReasoning
      ? { reasoning_effort: reasoningEffort ?? 'medium' }
      : {};

    // Add seed for reproducibility (OpenAI deterministic seed)
    const seedParam = seed !== undefined ? { seed } : {};

    // Add top_p for nucleus sampling (default is 1.0 when not specified)
    const topPParam = topP !== undefined ? { top_p: topP } : {};

    // Named rather than inlined so the fidelity disclosure is DERIVED from the
    // body that goes to the SDK. Exactly one `system`-role message, and no
    // `response_format` grammar — the same single-block limit the Anthropic arm
    // discloses, counted rather than assumed.
    const requestBody = {
      model,
      ...tokenParam,
      ...tempParam,
      ...reasoningParam,
      ...seedParam,
      ...topPParam,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userContent },
      ],
    };
    requestComposition = deriveRequestComposition(requestBody);

    const response = await client.chat.completions.create(requestBody, {
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;

    const choice = response.choices[0];
    if (!choice || !choice.message.content) {
      return {
        success: false,
        error: 'No response content from OpenAI',
        duration_ms,
        temperature,
        max_tokens: maxTokens,
        model,
        provider: 'openai',
        request_composition: requestComposition,
      };
    }

    const raw_output = choice.message.content;
    const raw_output_hash = createHash('sha256').update(raw_output).digest('hex');

    return {
      success: true,
      raw_output,
      raw_output_hash,
      duration_ms,
      token_usage: {
        prompt: response.usage?.prompt_tokens ?? 0,
        completion: response.usage?.completion_tokens ?? 0,
        total: response.usage?.total_tokens ?? 0,
      },
      finish_reason: choice.finish_reason ?? 'unknown',
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'openai',
      reasoning_effort: isReasoning ? (reasoningEffort ?? 'medium') : undefined,
      seed,
      top_p: topP,
      request_composition: requestComposition,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const timeoutMinutes = Math.round(effectiveTimeout / 60000);

    // Track model errors for deprecation detection
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorType: 'not_found' | 'invalid_model' | 'deprecated' | 'rate_limit' | 'other' = 'other';

    if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      errorType = 'not_found';
    } else if (errorMessage.includes('invalid model') || errorMessage.includes('invalid_model') || errorMessage.includes('model_not_found')) {
      errorType = 'invalid_model';
    } else if (errorMessage.includes('deprecated')) {
      errorType = 'deprecated';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('rate_limit')) {
      errorType = 'rate_limit';
    }

    if (!isTimeout) {
      recordModelError({
        model_id: model,
        provider: 'openai',
        error_type: errorType,
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: false,
      error: isTimeout ? `LLM request timed out after ${timeoutMinutes} minutes` : sanitizeErrorMessage(error),
      duration_ms,
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'openai',
      request_composition: requestComposition,
    };
  }
}

// ============================================================================
// Graph Parsing helpers
// ============================================================================

interface ParsedGraph {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  node_counts: Record<string, number>;
}

/**
 * Run basic structural validation on parsed graph.
 * Returns extended validation issues with severity, suggestions, etc.
 */
function runBasicValidation(graph: ParsedGraph): ExtendedValidationIssue[] {
  const issues: ExtendedValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const nodeKindMap = new Map<string, string>();

  // Validate nodes
  for (const node of graph.nodes) {
    const nodeRecord = node as Record<string, unknown>;
    const id = nodeRecord.id as string;
    const kind = (nodeRecord.kind ?? nodeRecord.type ?? 'unknown') as string;

    if (!id) {
      issues.push({
        code: 'MISSING_NODE_ID',
        severity: 'error',
        message: 'Node is missing an id field',
        stage: 'node_validation',
      });
      continue;
    }

    // Check for duplicate IDs
    if (nodeIds.has(id)) {
      issues.push({
        code: 'DUPLICATE_NODE_ID',
        severity: 'error',
        message: `Duplicate node ID: "${id}"`,
        affected_node_id: id,
        suggestion: 'Ensure all node IDs are unique',
        stage: 'node_validation',
      });
    }
    nodeIds.add(id);
    nodeKindMap.set(id, kind);
  }

  // Validate edges
  const edgeSet = new Set<string>();
  for (const edge of graph.edges) {
    const edgeRecord = edge as Record<string, unknown>;
    const from = edgeRecord.from as string;
    const to = edgeRecord.to as string;

    if (!from || !to) {
      issues.push({
        code: 'MALFORMED_EDGE',
        severity: 'error',
        message: 'Edge is missing from or to field',
        stage: 'edge_validation',
      });
      continue;
    }

    const edgeId = `${from}→${to}`;

    // Check self-loops
    if (from === to) {
      issues.push({
        code: 'SELF_LOOP_DETECTED',
        severity: 'error',
        message: `Self-loop detected: ${from} → ${to}`,
        affected_node_id: from,
        affected_edge_id: edgeId,
        suggestion: 'Remove self-referential edge',
        stage: 'connectivity_check',
      });
    }

    // Check edge endpoints exist
    if (!nodeIds.has(from)) {
      issues.push({
        code: 'EDGE_FROM_NOT_FOUND',
        severity: 'error',
        message: `Edge 'from' node "${from}" not found in graph`,
        affected_node_id: from,
        affected_edge_id: edgeId,
        stage: 'edge_validation',
      });
    }

    if (!nodeIds.has(to)) {
      issues.push({
        code: 'EDGE_TO_NOT_FOUND',
        severity: 'error',
        message: `Edge 'to' node "${to}" not found in graph`,
        affected_node_id: to,
        affected_edge_id: edgeId,
        stage: 'edge_validation',
      });
    }

    // Check for bidirectional edges
    const reverseKey = `${to}::${from}`;
    const forwardKey = `${from}::${to}`;
    if (edgeSet.has(reverseKey) && from !== to) {
      issues.push({
        code: 'BIDIRECTIONAL_EDGE',
        severity: 'error',
        message: `Bidirectional edges detected: ${from} ↔ ${to}`,
        affected_node_id: from,
        affected_edge_id: `${from}↔${to}`,
        suggestion: 'Remove one direction to maintain DAG structure',
        stage: 'connectivity_check',
      });
    }
    edgeSet.add(forwardKey);

    // Validate strength if present
    const strengthMean = edgeRecord.strength_mean as number | undefined;
    if (strengthMean !== undefined && (strengthMean < -1 || strengthMean > 1)) {
      issues.push({
        code: 'STRENGTH_OUT_OF_RANGE',
        severity: 'error',
        message: `Edge ${edgeId}: strength_mean ${strengthMean.toFixed(2)} outside canonical range [-1, +1]`,
        affected_edge_id: edgeId,
        suggestion: 'Clamp value to [-1, +1] range',
        stage: 'coefficient_normalisation',
      });
    }
  }

  // Check for goal node
  const goalNodes = graph.nodes.filter(
    (n) => (n as Record<string, unknown>).kind === 'goal'
  );
  if (goalNodes.length === 0) {
    issues.push({
      code: 'NO_GOAL_NODE',
      severity: 'error',
      message: 'Graph has no goal node',
      suggestion: 'Add a node with kind="goal"',
      stage: 'goal_validation',
    });
  } else if (goalNodes.length > 1) {
    issues.push({
      code: 'MULTIPLE_GOALS',
      severity: 'error',
      message: `Graph has ${goalNodes.length} goal nodes, expected exactly 1`,
      suggestion: 'Keep only one goal node',
      stage: 'goal_validation',
    });
  }

  return issues;
}

function parseGraphFromLLMOutput(raw_output: string): { success: boolean; graph?: ParsedGraph; error?: string } {
  try {
    // Handle markdown code blocks
    let jsonText = raw_output.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    // Strip JavaScript-style comments that some models include in JSON output
    // Remove single-line comments (// ...) but preserve URLs (http://, https://)
    jsonText = jsonText.replace(/(?<![:"'])\/\/(?!\/)[^\n]*/g, '');
    // Remove multi-line comments (/* ... */)
    jsonText = jsonText.replace(/\/\*[\s\S]*?\*\//g, '');
    // Clean up any trailing commas before closing brackets (common after comment removal)
    jsonText = jsonText.replace(/,\s*([\]}])/g, '$1');

    // Try to find JSON object if the text doesn't start with {
    // Models sometimes add preamble text before the JSON
    if (!jsonText.startsWith('{') && !jsonText.startsWith('[')) {
      // Look for the first { that might be the start of JSON
      const jsonStartIndex = jsonText.indexOf('{');
      if (jsonStartIndex !== -1) {
        // Find the matching closing brace by counting braces
        let braceCount = 0;
        let jsonEndIndex = -1;
        for (let i = jsonStartIndex; i < jsonText.length; i++) {
          if (jsonText[i] === '{') braceCount++;
          else if (jsonText[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEndIndex = i;
              break;
            }
          }
        }
        if (jsonEndIndex !== -1) {
          jsonText = jsonText.slice(jsonStartIndex, jsonEndIndex + 1);
        }
      } else {
        // No JSON object found - model returned plain text
        const preview = raw_output.slice(0, 100).replace(/\n/g, ' ');
        return {
          success: false,
          error: `Model did not return JSON. Response starts with: "${preview}..."`,
        };
      }
    }

    const parsed = JSON.parse(jsonText);

    // Extract nodes and edges
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const edges = Array.isArray(parsed.edges) ? parsed.edges : [];

    // Count node kinds
    const node_counts: Record<string, number> = {};
    for (const node of nodes) {
      const kind = (node as Record<string, unknown>).kind ?? (node as Record<string, unknown>).type ?? 'unknown';
      node_counts[String(kind)] = (node_counts[String(kind)] ?? 0) + 1;
    }

    return {
      success: true,
      graph: { nodes, edges, node_counts },
    };
  } catch (error) {
    // Provide more helpful error message
    const preview = raw_output.slice(0, 100).replace(/\n/g, ' ');
    return {
      success: false,
      error: `Failed to parse graph: ${error instanceof Error ? error.message : String(error)}. Response preview: "${preview}..."`,
    };
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function adminTestRoutes(app: FastifyInstance): Promise<void> {
  // Register rate limiter - 10 requests per minute per admin key
  await app.register(rateLimit, {
    max: 10,
    timeWindow: 60 * 1000, // 1 minute
    keyGenerator: (request) => {
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `admin_test:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    // ROADMAP 2.181 — @fastify/rate-limit THROWS this return value, so it MUST
    // be an Error; a plain object is answered 500 INTERNAL. See RateLimitedError.
    errorResponseBuilder: (_request, context) =>
      new RateLimitedError(
        retryAfterSecondsFromRateLimitContext(context),
        'Too many test requests. Please wait before running more tests.',
      ),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  /**
   * POST /admin/v1/test-prompt-llm
   *
   * Test a specific prompt version with an actual LLM call.
   * Separate from production traffic with dedicated rate limiting.
   */
  app.post('/admin/v1/test-prompt-llm', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = getRequestId(request);
    const startTime = Date.now();

    // Authentication
    if (!verifyAdminKey(request, reply, 'read')) return;
    if (!ensureStoreHealthy(reply)) return;

    // Validate request body
    const parseResult = TestPromptLLMRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      // Extract human-readable error messages from Zod
      const flattened = parseResult.error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors)
        .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
        .join('; ');
      const formErrors = flattened.formErrors.join('; ');
      const errorMessage = fieldErrors || formErrors || 'Invalid request body';

      return reply.status(400).send({
        error: 'validation_error',
        message: errorMessage,
        details: flattened,
      });
    }

    const { prompt_id, version, brief, options } = parseResult.data;
    const skipRepairs = options?.skip_repairs ?? false;
    const modelOverride = options?.model;
    const reasoningEffort = options?.reasoning_effort;
    const budgetTokensOverride = options?.budget_tokens;
    const temperatureOverride = options?.temperature;
    const maxTokensOverride = options?.max_tokens;
    const seedOverride = options?.seed;
    const topPOverride = options?.top_p;

    log.info({
      request_id: requestId,
      prompt_id,
      version,
      brief_length: brief.length,
      skip_repairs: skipRepairs,
      model_override: modelOverride,
      reasoning_effort: reasoningEffort,
      budget_tokens: budgetTokensOverride,
      temperature_override: temperatureOverride,
      max_tokens_override: maxTokensOverride,
      seed_override: seedOverride,
      top_p_override: topPOverride,
      event: 'admin.test_prompt.started',
    }, 'Admin prompt test started');

    try {
      const store = getPromptStore();

      // Load prompt definition
      const prompt = await store.get(prompt_id);
      if (!prompt) {
        return reply.status(404).send({
          error: 'not_found',
          message: `Prompt '${prompt_id}' not found`,
        });
      }

      // Find specific version
      const versionData = prompt.versions.find((v) => v.version === version);
      if (!versionData) {
        return reply.status(404).send({
          error: 'not_found',
          message: `Version ${version} not found for prompt '${prompt_id}'`,
        });
      }

      // Compile prompt content (interpolate variables if any)
      const compiledContent = interpolatePrompt(versionData.content, {});
      const contentHash = createHash('sha256').update(compiledContent).digest('hex');

      // Determine model to use
      // Priority: explicit override > prompt modelConfig > task default >
      // configured provider default. Provider follows the winning model inside
      // callLLMWithPrompt(), matching the live router contract.
      let model = modelOverride;
      // Check prompt's per-prompt model configuration
      if (!model && prompt.modelConfig) {
        // Use environment-specific model based on prompt status
        const env = prompt.status === 'production' ? 'production' : 'staging';
        const promptModel = prompt.modelConfig[env];
        if (promptModel) {
          model = promptModel;
        }
      }

      // Fall back to task defaults if no prompt-specific model
      if (!model && prompt.taskId && isValidCeeTask(prompt.taskId)) {
        model = getDefaultModelForTask(prompt.taskId);
      }

      if (!model) {
        // Operator harness fallback is explicit. It must not infer a model from
        // the process-wide provider when the prompt task has no live route.
        model = 'gpt-4o-mini';
      }

      let assignment: ResolvedModelAssignment;
      try {
        assignment = resolveModelAssignment(model);
      } catch (error) {
        if (!(error instanceof ModelAssignmentError)) throw error;
        return reply.status(400).send({
          error: error.code.toLowerCase(),
          message: error.message,
          model: error.model,
          action:
            'Choose an enabled registry model or an explicitly declared alias.',
        });
      }
      model = assignment.model;

      // Validate parameter combinations
      const isReasoning = Boolean(assignment.config?.reasoning);
      const supportsTemp = !doesNotSupportCustomTemperature(model);
      const modelConfig = assignment.config;

      // reasoning_effort is only valid for OpenAI reasoning models
      if (reasoningEffort !== undefined && !isReasoning) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `reasoning_effort is only valid for reasoning models. ${model} is not a reasoning model.`,
        });
      }

      // budget_tokens is only valid for models whose API accepts the
      // `thinking:{type:'enabled',budget_tokens}` mechanism — the live-probed
      // verdict, not MODEL_REGISTRY.extendedThinking (see acceptsThinkingBudget).
      const hasExtThinking = acceptsThinkingBudget(model);
      if (budgetTokensOverride !== undefined && !hasExtThinking) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `budget_tokens is only valid for Anthropic models that accept thinking.type='enabled'. ${model} does not — the request would be rejected by the API. Re-run without budget_tokens; the harness sends thinking:{type:'disabled'}, matching the live draft path.`,
        });
      }

      // temperature is only valid for models that support it
      if (temperatureOverride !== undefined && !supportsTemp) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `Temperature is not supported for model ${model}. This model uses fixed temperature.`,
        });
      }

      // max_tokens must not exceed model limit
      if (maxTokensOverride !== undefined && modelConfig) {
        if (maxTokensOverride > modelConfig.maxTokens) {
          return reply.status(400).send({
            error: 'validation_error',
            message: `max_tokens (${maxTokensOverride}) exceeds model limit (${modelConfig.maxTokens}) for ${model}`,
          });
        }
      }

      // Build user content (similar to production flow)
      const userContent = `## Brief\n${brief}`;

      // Build LLM call options
      const llmOptions: LLMCallOptions = {};
      if (temperatureOverride !== undefined) {
        llmOptions.temperature = temperatureOverride;
      }
      if (maxTokensOverride !== undefined) {
        llmOptions.maxTokens = maxTokensOverride;
      }
      if (reasoningEffort !== undefined) {
        llmOptions.reasoningEffort = reasoningEffort;
      }
      if (budgetTokensOverride !== undefined) {
        llmOptions.budgetTokens = budgetTokensOverride;
      }
      if (seedOverride !== undefined) {
        llmOptions.seed = seedOverride;
      }
      if (topPOverride !== undefined) {
        llmOptions.topP = topPOverride;
      }

      // Call LLM with options
      const llmResult = await callLLMWithPrompt(compiledContent, userContent, model, llmOptions);

      // ── HARNESS FIDELITY: what this result is, and is not, evidence of ──────
      //
      // The divergence list is bound to the run (task + provider), NOT emitted
      // as a constant banner: a banner would be a claim about a path this run
      // never touched, and an always-on warning is an ignored warning. The
      // `notice` is the unconditional half and is true of every run.
      //
      // Scope, stated precisely (CLAUDE.md trap 20): the ONLY divergence
      // established at the bytes is `draft_graph` on Anthropic. An empty
      // `divergences` therefore means "none established for this composition",
      // never "this run is faithful" — which is exactly what `notice` says.
      const harnessDivergences: string[] = [];
      if (prompt.taskId === 'draft_graph' && llmResult.provider === 'anthropic') {
        harnessDivergences.push(DRAFT_GRAPH_DIVERGENCE);
      }

      const harnessFidelity: NonNullable<TestPromptLLMResponse['harness_fidelity']> = {
        output_parsed_as: 'graph_nodes_edges',
        divergences: harnessDivergences,
        notice: HARNESS_FIDELITY_NOTICE,
      };
      if (llmResult.request_composition) {
        harnessFidelity.system_blocks_sent = llmResult.request_composition.system_blocks;
        harnessFidelity.structured_outputs_grammar_sent =
          llmResult.request_composition.structured_outputs_grammar;
      }

      // Build response
      const response: TestPromptLLMResponse = {
        request_id: requestId,
        harness_fidelity: harnessFidelity,
        success: llmResult.success,
        prompt: {
          id: prompt_id,
          version,
          content_hash: contentHash,
          content_preview: compiledContent.substring(0, 500) + (compiledContent.length > 500 ? '...' : ''),
          content_length: compiledContent.length,
        },
        llm: {
          model: llmResult.model,
          provider: llmResult.provider,
          raw_output: llmResult.raw_output ?? '',
          raw_output_hash: llmResult.raw_output_hash ?? '',
          duration_ms: llmResult.duration_ms,
          token_usage: llmResult.token_usage ?? { prompt: 0, completion: 0, total: 0 },
          finish_reason: llmResult.finish_reason ?? 'unknown',
          temperature: llmResult.temperature,
          max_tokens: llmResult.max_tokens,
          reasoning_effort: llmResult.reasoning_effort,
          budget_tokens: llmResult.budget_tokens,
          seed: llmResult.seed,
          top_p: llmResult.top_p,
        },
      };

      if (!llmResult.success) {
        response.error = llmResult.error;
      }

      // Parse graph from LLM output
      if (llmResult.success && llmResult.raw_output) {
        const graphParse = parseGraphFromLLMOutput(llmResult.raw_output);

        if (graphParse.success && graphParse.graph) {
          // Build validation issues with extended schema
          const validationIssues: ExtendedValidationIssue[] = [];

          if (graphParse.graph.nodes.length === 0) {
            validationIssues.push({
              code: 'EMPTY_GRAPH',
              severity: 'error',
              message: 'Graph has no nodes',
              suggestion: 'Ensure the LLM output includes a nodes array with at least one node',
              stage: 'json_parse',
            });
          }

          // Run basic structural validation
          const basicValidation = runBasicValidation(graphParse.graph);
          validationIssues.push(...basicValidation);

          // Count issues by severity
          const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
          const warningCount = validationIssues.filter((i) => i.severity === 'warning').length;
          const infoCount = validationIssues.filter((i) => i.severity === 'info').length;

          response.result = {
            graph: {
              nodes: graphParse.graph.nodes,
              edges: graphParse.graph.edges,
            },
            validation: {
              passed: errorCount === 0,
              issues: validationIssues,
              error_count: errorCount,
              warning_count: warningCount,
              info_count: infoCount,
            },
          };

          // Mark test as failed if there are validation errors
          if (errorCount > 0) {
            response.success = false;
            response.error = `Validation failed with ${errorCount} error(s)`;
          }

          response.pipeline = {
            stages: [
              { name: 'llm_draft', status: 'success', duration_ms: llmResult.duration_ms },
              { name: 'json_parse', status: 'success', duration_ms: 0 },
              { name: 'validation', status: errorCount === 0 ? 'success' : 'failed', duration_ms: 0 },
            ],
            repairs_applied: [],
            node_counts: {
              raw: graphParse.graph.node_counts,
              validated: graphParse.graph.node_counts, // Same if skip_repairs
            },
            total_duration_ms: Date.now() - startTime,
          };
        } else {
          // JSON parse failed - mark overall test as failed
          response.success = false;
          response.error = graphParse.error;
          response.pipeline = {
            stages: [
              { name: 'llm_draft', status: 'success', duration_ms: llmResult.duration_ms },
              { name: 'json_parse', status: 'failed', duration_ms: 0 },
            ],
            repairs_applied: [],
            total_duration_ms: Date.now() - startTime,
          };
        }
      }

      // Emit telemetry
      emit(TelemetryEvents.PromptTestExecuted, {
        request_id: requestId,
        prompt_id,
        version,
        model,
        success: response.success,
        duration_ms: Date.now() - startTime,
        token_usage: response.llm?.token_usage,
      });

      log.info({
        request_id: requestId,
        prompt_id,
        version,
        success: response.success,
        duration_ms: Date.now() - startTime,
        node_count: response.result?.graph?.nodes?.length ?? 0,
        event: 'admin.test_prompt.completed',
      }, 'Admin prompt test completed');

      reply.header('X-Request-ID', requestId);
      return reply.status(200).send(response);

    } catch (error) {
      // Keep full error for logging, sanitize for external response
      const fullErrorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedMessage = sanitizeErrorMessage(error);

      log.error({
        request_id: requestId,
        prompt_id,
        version,
        error: fullErrorMessage,
        event: 'admin.test_prompt.error',
      }, 'Admin prompt test failed');

      return reply.status(500).send({
        request_id: requestId,
        success: false,
        error: `Internal error: ${sanitizedMessage}`,
      });
    }
  });

  /**
   * GET /admin/v1/test-prompt-llm/models
   *
   * List available models for testing with capability flags.
   *
   * Query parameters:
   * - include_provider_models: boolean - When true, fetches all available models from
   *   provider APIs and includes models not in our registry (marked as source: 'provider')
   *
   * Response model fields:
   * - source: 'registry' | 'provider' - Where the model comes from
   * - in_registry: boolean - Whether the model is in our registry (for provider models)
   */
  app.get('/admin/v1/test-prompt-llm/models', async (
    request: FastifyRequest<{ Querystring: { include_provider_models?: string } }>,
    reply: FastifyReply
  ) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const includeProviderModels = request.query.include_provider_models === 'true';

    // Type for model entries (supports both registry and provider-only models)
    type ModelEntry = {
      id: string;
      provider: string;
      tier: string;
      description: string;
      max_tokens: number;
      is_reasoning: boolean;
      supports_extended_thinking: boolean;
      supports_temperature: boolean;
      source: 'registry' | 'provider';
      in_registry: boolean;
    };

    // Always include enabled registry models
    const registryModels: ModelEntry[] = Object.entries(MODEL_REGISTRY)
      .filter(([_, config]) => config.enabled)
      .map(([id, config]) => ({
        id,
        provider: config.provider,
        tier: config.tier,
        description: config.description,
        max_tokens: config.maxTokens,
        // Capability flags for UI to show/hide appropriate controls
        is_reasoning: isReasoningModel(id),
        supports_extended_thinking: acceptsThinkingBudget(id),
        supports_temperature: !doesNotSupportCustomTemperature(id),
        // Source tracking
        source: 'registry' as const,
        in_registry: true,
      }));

    if (!includeProviderModels) {
      return reply.status(200).send({ models: registryModels });
    }

    // Fetch all models from provider APIs
    try {
      const [openaiModels, anthropicModels] = await Promise.all([
        fetchOpenAIModels(),
        Promise.resolve(getAnthropicModels()),
      ]);

      // Create a set of registry model IDs for quick lookup
      const registryModelIds = new Set(Object.keys(MODEL_REGISTRY));

      // Add provider models that aren't in the registry
      const providerOnlyModels: ModelEntry[] = [];

      for (const model of openaiModels) {
        if (!registryModelIds.has(model.id)) {
          providerOnlyModels.push({
            id: model.id,
            provider: 'openai',
            tier: 'unknown', // Provider models don't have tier classification
            description: `OpenAI model (not in registry)`,
            max_tokens: 4096, // Default, unknown for provider-only models
            is_reasoning: false,
            supports_extended_thinking: false,
            supports_temperature: true,
            source: 'provider',
            in_registry: false,
          });
        }
      }

      for (const model of anthropicModels) {
        if (!registryModelIds.has(model.id)) {
          providerOnlyModels.push({
            id: model.id,
            provider: 'anthropic',
            tier: 'unknown',
            description: `Anthropic model (not in registry)`,
            max_tokens: 4096,
            is_reasoning: false,
            supports_extended_thinking: false,
            supports_temperature: true,
            source: 'provider',
            in_registry: false,
          });
        }
      }

      // Combine registry and provider-only models
      const allModels = [...registryModels, ...providerOnlyModels];

      // Sort: registry models first (by provider, then id), then provider-only models
      allModels.sort((a, b) => {
        if (a.source !== b.source) {
          return a.source === 'registry' ? -1 : 1;
        }
        if (a.provider !== b.provider) {
          return a.provider.localeCompare(b.provider);
        }
        return a.id.localeCompare(b.id);
      });

      return reply.status(200).send({
        models: allModels,
        provider_fetch: {
          success: true,
          openai_count: openaiModels.length,
          anthropic_count: anthropicModels.length,
          provider_only_count: providerOnlyModels.length,
        },
      });
    } catch (error) {
      // If provider fetch fails, still return registry models with an error note
      log.warn({
        event: 'admin.models.provider_fetch_failed',
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to fetch provider models, returning registry only');

      return reply.status(200).send({
        models: registryModels,
        provider_fetch: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  /**
   * GET /admin/v1/available-models/:provider
   *
   * Check model availability from provider API.
   * Compares registry models against what's actually available from the provider.
   *
   * For OpenAI: Fetches from the models API
   * For Anthropic: Uses curated list (no public API)
   */
  app.get('/admin/v1/available-models/:provider', async (
    request: FastifyRequest<{ Params: { provider: string } }>,
    reply: FastifyReply
  ) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const { provider } = request.params;

    if (provider !== 'openai' && provider !== 'anthropic') {
      return reply.status(400).send({
        error: 'invalid_provider',
        message: 'Provider must be "openai" or "anthropic"',
      });
    }

    try {
      const result = await checkModelAvailability(provider);
      return reply.status(200).send(result);
    } catch (error) {
      log.error({
        event: 'admin.available_models.error',
        provider,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to check model availability');

      return reply.status(500).send({
        error: 'fetch_failed',
        message: `Failed to fetch available models: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  /**
   * GET /admin/v1/model-errors
   *
   * Get summary of model errors for deprecation detection.
   */
  app.get('/admin/v1/model-errors', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const summary = getModelErrorSummary();
    return reply.status(200).send(summary);
  });
}
