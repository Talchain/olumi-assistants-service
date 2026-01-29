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
import { z } from 'zod';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import { getPromptStore, isPromptStoreHealthy } from '../prompts/store.js';
import { interpolatePrompt } from '../prompts/schema.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { getRequestId } from '../utils/request-id.js';
import { MODEL_REGISTRY, getModelConfig, getModelProvider, isReasoningModel, supportsExtendedThinking } from '../config/models.js';
import { getDefaultModelForTask, isValidCeeTask } from '../config/model-routing.js';
import { checkModelAvailability, getModelErrorSummary, recordModelError, fetchOpenAIModels, getAnthropicModels } from '../services/model-availability.js';

/**
 * Check if a model requires max_completion_tokens instead of max_tokens.
 * This applies to reasoning models and all GPT-5.x models.
 */
function needsMaxCompletionTokens(model: string): boolean {
  // Reasoning models always need max_completion_tokens
  if (isReasoningModel(model)) return true;
  // GPT-5.x models (including gpt-5-mini, gpt-5.2, etc.) require max_completion_tokens
  if (model.startsWith('gpt-5')) return true;
  // o1 models also need it
  if (model.startsWith('o1')) return true;
  return false;
}

/**
 * Check if a model doesn't support custom temperature values.
 * GPT-5.x models only support temperature=1 (default).
 */
function doesNotSupportCustomTemperature(model: string): boolean {
  // Reasoning models don't support temperature at all
  if (isReasoningModel(model)) return true;
  // GPT-5.x models only support default temperature (1)
  if (model.startsWith('gpt-5')) return true;
  // o1 models don't support temperature
  if (model.startsWith('o1')) return true;
  return false;
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
}

// ============================================================================
// Authentication helpers
// ============================================================================

type AdminPermission = 'read' | 'write';

function getAllowedIPs(): Set<string> | null {
  const allowedIPsConfig = config.prompts?.adminAllowedIPs;
  if (!allowedIPsConfig || allowedIPsConfig.trim() === '') {
    return null;
  }

  return new Set(
    allowedIPsConfig
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0)
  );
}

function verifyIPAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowedIPs = getAllowedIPs();
  if (!allowedIPs) return true;

  const requestIP = request.ip;
  const isAllowed =
    allowedIPs.has(requestIP) ||
    (requestIP === '::1' && allowedIPs.has('127.0.0.1')) ||
    (requestIP === '127.0.0.1' && allowedIPs.has('::1'));

  if (!isAllowed) {
    reply.status(403).send({
      error: 'ip_not_allowed',
      message: 'Your IP address is not authorized for admin access',
    });
    return false;
  }
  return true;
}

function verifyAdminKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermission: AdminPermission = 'write'
): boolean {
  if (!verifyIPAllowed(request, reply)) return false;

  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;

  if (!adminKey && !adminKeyRead) {
    reply.status(503).send({
      error: 'admin_not_configured',
      message: 'Admin API is not configured',
    });
    return false;
  }

  const providedKey = request.headers['x-admin-key'] as string;
  if (!providedKey) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Missing admin API key',
    });
    return false;
  }

  if (adminKey && providedKey === adminKey) return true;

  if (adminKeyRead && providedKey === adminKeyRead) {
    if (requiredPermission === 'write') {
      reply.status(403).send({
        error: 'forbidden',
        message: 'Read-only key cannot perform write operations',
      });
      return false;
    }
    return true;
  }

  reply.status(401).send({
    error: 'unauthorized',
    message: 'Invalid admin API key',
  });
  return false;
}

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

const LLM_TIMEOUT_MS = 120_000; // 2 minutes for standard models
const REASONING_TIMEOUT_MS = 180_000; // 3 minutes for reasoning models (medium effort)
const REASONING_HIGH_TIMEOUT_MS = 300_000; // 5 minutes for reasoning models with HIGH effort
const _REQUEST_TIMEOUT_MS = 350_000; // 5.5 minutes total (to exceed max LLM timeout)

/**
 * Get appropriate timeout based on model type and reasoning effort.
 */
function getLLMTimeout(model: string, reasoningEffort?: 'low' | 'medium' | 'high'): number {
  if (!isReasoningModel(model)) {
    return LLM_TIMEOUT_MS;
  }
  // Reasoning models need more time, especially with HIGH effort
  if (reasoningEffort === 'high') {
    return REASONING_HIGH_TIMEOUT_MS;
  }
  return REASONING_TIMEOUT_MS;
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
}

async function callLLMWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  options?: LLMCallOptions,
): Promise<LLMCallResult> {
  const startTime = Date.now();
  const modelConfig = getModelConfig(model);
  const provider = modelConfig?.provider ?? getModelProvider(model) ?? 'openai';

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
  const hasExtendedThinking = supportsExtendedThinking(model) && budgetTokens !== undefined;
  const effectiveTimeout = hasExtendedThinking ? REASONING_HIGH_TIMEOUT_MS : LLM_TIMEOUT_MS;
  const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

  // Effective temperature: default to 0 if null (deterministic for testing)
  // Note: Extended thinking mode requires temperature=1
  const effectiveTemperature = hasExtendedThinking ? 1 : (temperature ?? 0);

  try {
    // Build request params - add thinking block for extended thinking models
    const thinkingParam = hasExtendedThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: budgetTokens } }
      : {};

    // Use streaming for extended thinking (required by Anthropic for long operations)
    // and also recommended for Opus models which can have long response times
    const useStreaming = hasExtendedThinking || model.includes('opus');

    let raw_output = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'unknown';

    if (useStreaming) {
      // Use streaming API for extended thinking and Opus models
      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          temperature: effectiveTemperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          ...thinkingParam,
        },
        {
          signal: abortController.signal,
        }
      );

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
          temperature: effectiveTemperature,
          max_tokens: maxTokens,
          model,
          provider: 'anthropic',
          budget_tokens: budgetTokens,
        };
      }

      raw_output = textContent.text;
      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      stopReason = response.stop_reason ?? 'unknown';
    } else {
      // Use non-streaming for standard models
      const response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          temperature: effectiveTemperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          ...thinkingParam,
        },
        {
          signal: abortController.signal,
        }
      );

      // Handle response - find the text content block
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        clearTimeout(timeoutId);
        return {
          success: false,
          error: `No text content in response. Content types: ${response.content.map(c => c.type).join(', ')}`,
          duration_ms: Date.now() - startTime,
          temperature: effectiveTemperature,
          max_tokens: maxTokens,
          model,
          provider: 'anthropic',
          budget_tokens: budgetTokens,
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
      temperature: effectiveTemperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
      budget_tokens: budgetTokens,
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
      temperature: effectiveTemperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
      budget_tokens: budgetTokens,
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

    const response = await client.chat.completions.create(
      {
        model,
        ...tokenParam,
        ...tempParam,
        ...reasoningParam,
        ...seedParam,
        ...topPParam,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      },
      {
        signal: abortController.signal,
      }
    );

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
    errorResponseBuilder: (_request, context) => {
      const retryAfter = Math.ceil(context.ttl / 1000);
      return {
        error: 'rate_limit_exceeded',
        message: 'Too many test requests. Please wait before running more tests.',
        retry_after_seconds: retryAfter,
      };
    },
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
      // Priority: explicit override > task default > configured provider default
      let model = modelOverride;
      if (!model && prompt.taskId && isValidCeeTask(prompt.taskId)) {
        // Use task-specific default from TASK_MODEL_DEFAULTS
        model = getDefaultModelForTask(prompt.taskId);
      }
      if (!model) {
        // Fall back to configured provider's default model
        // This respects LLM_PROVIDER env var so Claude-only deployments use Claude
        const configuredProvider = config.llm?.provider;
        if (configuredProvider === 'anthropic') {
          model = 'claude-sonnet-4-20250514';
        } else {
          model = 'gpt-4o-mini';
        }
      }

      // Validate model if specified
      if (modelOverride && !MODEL_REGISTRY[modelOverride]) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `Unknown model: ${modelOverride}. Available models: ${Object.keys(MODEL_REGISTRY).join(', ')}`,
        });
      }

      // Validate parameter combinations
      const isReasoning = isReasoningModel(model);
      const supportsTemp = !doesNotSupportCustomTemperature(model);
      const modelConfig = getModelConfig(model);

      // reasoning_effort is only valid for OpenAI reasoning models
      if (reasoningEffort !== undefined && !isReasoning) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `reasoning_effort is only valid for reasoning models. ${model} is not a reasoning model.`,
        });
      }

      // budget_tokens is only valid for Anthropic extended thinking models
      const hasExtThinking = supportsExtendedThinking(model);
      if (budgetTokensOverride !== undefined && !hasExtThinking) {
        return reply.status(400).send({
          error: 'validation_error',
          message: `budget_tokens is only valid for Anthropic models with extended thinking. ${model} does not support extended thinking.`,
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

      // Build response
      const response: TestPromptLLMResponse = {
        request_id: requestId,
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
        supports_extended_thinking: supportsExtendedThinking(id),
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
