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
import { MODEL_REGISTRY, getModelConfig, getModelProvider } from '../config/models.js';

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
  }).optional(),
});

type TestPromptLLMRequest = z.infer<typeof TestPromptLLMRequestSchema>;

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
    temperature: number;
    max_tokens: number;
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
      issues: Array<{ code: string; message: string }>;
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
// LLM Call helpers
// ============================================================================

const LLM_TIMEOUT_MS = 120_000; // 2 minutes
const REQUEST_TIMEOUT_MS = 150_000; // 2.5 minutes total

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
  temperature: number;
  max_tokens: number;
  model: string;
  provider: string;
}

async function callLLMWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
): Promise<LLMCallResult> {
  const startTime = Date.now();
  const modelConfig = getModelConfig(model);
  const provider = modelConfig?.provider ?? getModelProvider(model) ?? 'openai';
  const maxTokens = modelConfig?.maxTokens ?? 4096;
  const temperature = 0;

  if (provider === 'anthropic') {
    return callAnthropicWithPrompt(systemPrompt, userContent, model, maxTokens, temperature, startTime);
  } else {
    return callOpenAIWithPrompt(systemPrompt, userContent, model, maxTokens, temperature, startTime);
  }
}

async function callAnthropicWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  maxTokens: number,
  temperature: number,
  startTime: number,
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
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      },
      {
        signal: abortController.signal,
      }
    );

    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== 'text') {
      return {
        success: false,
        error: `Unexpected response type: ${content.type}`,
        duration_ms,
        temperature,
        max_tokens: maxTokens,
        model,
        provider: 'anthropic',
      };
    }

    const raw_output = content.text;
    const raw_output_hash = createHash('sha256').update(raw_output).digest('hex');

    return {
      success: true,
      raw_output,
      raw_output_hash,
      duration_ms,
      token_usage: {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      finish_reason: response.stop_reason ?? 'unknown',
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    return {
      success: false,
      error: isTimeout ? 'LLM request timed out after 2 minutes' : String(error),
      duration_ms,
      temperature,
      max_tokens: maxTokens,
      model,
      provider: 'anthropic',
    };
  }
}

async function callOpenAIWithPrompt(
  systemPrompt: string,
  userContent: string,
  model: string,
  maxTokens: number,
  temperature: number,
  startTime: number,
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
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
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
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    return {
      success: false,
      error: isTimeout ? 'LLM request timed out after 2 minutes' : String(error),
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

function parseGraphFromLLMOutput(raw_output: string): { success: boolean; graph?: ParsedGraph; error?: string } {
  try {
    // Handle markdown code blocks
    let jsonText = raw_output.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
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
    return {
      success: false,
      error: `Failed to parse graph: ${error instanceof Error ? error.message : String(error)}`,
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
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
    }

    const { prompt_id, version, brief, options } = parseResult.data;
    const skipRepairs = options?.skip_repairs ?? false;
    const modelOverride = options?.model;

    log.info({
      request_id: requestId,
      prompt_id,
      version,
      brief_length: brief.length,
      skip_repairs: skipRepairs,
      model_override: modelOverride,
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
      let model = modelOverride;
      if (!model) {
        // Default models based on task
        if (prompt.taskId === 'draft_graph') {
          model = 'claude-3-5-sonnet-20241022';
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

      // Build user content (similar to production flow)
      const userContent = `## Brief\n${brief}`;

      // Call LLM
      const llmResult = await callLLMWithPrompt(compiledContent, userContent, model);

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
        },
      };

      if (!llmResult.success) {
        response.error = llmResult.error;
      }

      // Parse graph from LLM output
      if (llmResult.success && llmResult.raw_output) {
        const graphParse = parseGraphFromLLMOutput(llmResult.raw_output);

        if (graphParse.success && graphParse.graph) {
          response.result = {
            graph: {
              nodes: graphParse.graph.nodes,
              edges: graphParse.graph.edges,
            },
            validation: {
              passed: graphParse.graph.nodes.length > 0,
              issues: graphParse.graph.nodes.length === 0 ? [{ code: 'EMPTY_GRAPH', message: 'Graph has no nodes' }] : [],
            },
          };

          response.pipeline = {
            stages: [
              { name: 'llm_draft', status: 'success', duration_ms: llmResult.duration_ms },
              { name: 'json_parse', status: 'success', duration_ms: 0 },
            ],
            repairs_applied: [],
            node_counts: {
              raw: graphParse.graph.node_counts,
              validated: graphParse.graph.node_counts, // Same if skip_repairs
            },
            total_duration_ms: Date.now() - startTime,
          };
        } else {
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error({
        request_id: requestId,
        prompt_id,
        version,
        error: errorMessage,
        event: 'admin.test_prompt.error',
      }, 'Admin prompt test failed');

      return reply.status(500).send({
        request_id: requestId,
        success: false,
        error: `Internal error: ${errorMessage}`,
      });
    }
  });

  /**
   * GET /admin/v1/test-prompt-llm/models
   *
   * List available models for testing.
   */
  app.get('/admin/v1/test-prompt-llm/models', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const models = Object.entries(MODEL_REGISTRY)
      .filter(([_, config]) => config.enabled)
      .map(([id, config]) => ({
        id,
        provider: config.provider,
        tier: config.tier,
        description: config.description,
        max_tokens: config.maxTokens,
      }));

    return reply.status(200).send({ models });
  });
}
