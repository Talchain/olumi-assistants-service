/**
 * Validation Pipeline — Pass 2 Caller
 *
 * Calls o4-mini with the graph structure (no parameter values) and the brief,
 * asking it to independently estimate parameters for every causal edge.
 *
 * The result is a raw Pass2Response (array of edge estimates + model_notes).
 * Enforcement lints and bias correction are applied separately in index.ts.
 *
 * The user message is sent as JSON (not plain text) per the prompt spec in
 * validate_graph_v1_3.txt. The prompt guarantees the model returns JSON too.
 *
 * On any failure (parse error, timeout, API error) the caller is responsible
 * for catching the thrown error — this module does NOT swallow exceptions.
 *
 * Source of truth: validate_graph_v1_3.txt system prompt.
 */

import { getSystemPrompt } from '../../adapters/llm/prompt-loader.js';
import { getAdapter, getMaxTokensFromConfig } from '../../adapters/llm/router.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import { log } from '../../utils/telemetry.js';
import { VALIDATION_PIPELINE_TIMEOUT_MS } from '../../config/timeouts.js';
import type { Pass2EdgeEstimate, Pass2Response, Pass2UserMessage } from './types.js';
import type { Pass2NodeInput, Pass2EdgeInput } from './types.js';
import type { CallOpts } from '../../adapters/llm/types.js';

// ============================================================================
// Default token cap for Pass 2 (o4-mini reasoning with structured JSON output)
// ============================================================================

const DEFAULT_PASS2_MAX_TOKENS = 4096;

// ============================================================================
// Public API
// ============================================================================

/**
 * Calls o4-mini with the brief + graph structure and parses its response into
 * a Pass2Response.
 *
 * @throws {Error} on API failure, timeout, invalid JSON, or schema violations
 */
export async function callValidateGraph(
  brief: string,
  nodes: Pass2NodeInput[],
  edges: Pass2EdgeInput[],
  callOpts: CallOpts,
): Promise<Pass2Response> {
  // ── System prompt ──────────────────────────────────────────────────────────
  const systemPrompt = await getSystemPrompt('validate_graph');

  // ── Adapter (o4-mini via TASK_TO_CONFIG_KEY → 'validation') ───────────────
  const adapter = getAdapter('validate_graph');

  // ── Max tokens ─────────────────────────────────────────────────────────────
  const configuredMaxTokens = getMaxTokensFromConfig('validate_graph');
  const maxTokens = configuredMaxTokens ?? DEFAULT_PASS2_MAX_TOKENS;

  // ── User message (JSON format per prompt spec) ─────────────────────────────
  // Wrap the brief in untrusted-content markers to defend against prompt
  // injection — the brief is user-controlled input.
  const wrappedBrief =
    `[BEGIN_UNTRUSTED_USER_CONTENT]\n${brief}\n[END_UNTRUSTED_USER_CONTENT]`;
  const userMessagePayload: Pass2UserMessage = { brief: wrappedBrief, nodes, edges };
  const userMessage = JSON.stringify(userMessagePayload, null, 2);

  log.debug(
    {
      event: 'cee.validation_pipeline.pass2_call_start',
      request_id: callOpts.requestId,
      edge_count: edges.length,
      node_count: nodes.length,
      adapter: adapter.name,
      model: adapter.model,
      max_tokens: maxTokens,
    },
    'cee.validation_pipeline.pass2_call_start',
  );

  // ── LLM call (timeout via callOpts.timeoutMs = VALIDATION_PIPELINE_TIMEOUT_MS) ──
  const result = await adapter.chat(
    {
      system: systemPrompt,
      userMessage,
      maxTokens,
      responseFormat: 'json_object',
    },
    { ...callOpts, timeoutMs: callOpts.timeoutMs ?? VALIDATION_PIPELINE_TIMEOUT_MS },
  );

  log.debug(
    {
      event: 'cee.validation_pipeline.pass2_call_complete',
      request_id: callOpts.requestId,
      latency_ms: result.latencyMs,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
    },
    'cee.validation_pipeline.pass2_call_complete',
  );

  // ── Parse and validate response ────────────────────────────────────────────
  return parsePass2Response(result.content, callOpts.requestId);
}

// ============================================================================
// Response parsing
// ============================================================================

/**
 * Parses the raw LLM text into a validated Pass2Response.
 * Throws a descriptive error on any schema violation.
 */
function parsePass2Response(rawContent: string, requestId?: string): Pass2Response {
  const { json: parsed } = extractJsonFromResponse(rawContent);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `cee.validation_pipeline.parse_error: Pass 2 response is not an object (request_id=${requestId})`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  // edges must be an array
  if (!Array.isArray(obj['edges'])) {
    throw new Error(
      `cee.validation_pipeline.parse_error: Pass 2 response missing 'edges' array (request_id=${requestId})`,
    );
  }

  // model_notes should be an array of strings; default to empty if missing
  const modelNotes = Array.isArray(obj['model_notes'])
    ? (obj['model_notes'] as unknown[]).filter((n) => typeof n === 'string') as string[]
    : [];

  const edges = (obj['edges'] as unknown[]).map((raw, idx) =>
    parseEdgeEstimate(raw, idx, requestId),
  );

  return { edges, model_notes: modelNotes };
}

const VALID_BASES = new Set(['brief_explicit', 'structural_inference', 'domain_prior', 'weak_guess']);

function parseEdgeEstimate(
  raw: unknown,
  idx: number,
  requestId?: string,
): Pass2EdgeEstimate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `cee.validation_pipeline.parse_error: edges[${idx}] is not an object (request_id=${requestId})`,
    );
  }
  const e = raw as Record<string, unknown>;

  const from = stringField(e, 'from', idx, requestId);
  const to = stringField(e, 'to', idx, requestId);

  const strengthRaw = e['strength'];
  if (!strengthRaw || typeof strengthRaw !== 'object' || Array.isArray(strengthRaw)) {
    throw new Error(
      `cee.validation_pipeline.parse_error: edges[${idx}].strength must be an object (request_id=${requestId})`,
    );
  }
  const s = strengthRaw as Record<string, unknown>;
  const mean = numberField(s, 'mean', idx, requestId);
  const std = numberField(s, 'std', idx, requestId);

  const exists_probability = numberField(e, 'exists_probability', idx, requestId);
  const reasoning = stringField(e, 'reasoning', idx, requestId);

  const basisRaw = e['basis'];
  if (typeof basisRaw !== 'string' || !VALID_BASES.has(basisRaw)) {
    throw new Error(
      `cee.validation_pipeline.parse_error: edges[${idx}].basis is invalid ('${basisRaw}') (request_id=${requestId})`,
    );
  }

  const needs_user_input = typeof e['needs_user_input'] === 'boolean'
    ? e['needs_user_input']
    : false;

  return {
    from,
    to,
    strength: { mean, std },
    exists_probability,
    reasoning,
    basis: basisRaw as Pass2EdgeEstimate['basis'],
    needs_user_input,
  };
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  idx: number,
  requestId?: string,
): string {
  const val = obj[key];
  if (typeof val !== 'string') {
    throw new Error(
      `cee.validation_pipeline.parse_error: edges[${idx}].${key} must be a string (request_id=${requestId})`,
    );
  }
  return val;
}

function numberField(
  obj: Record<string, unknown>,
  key: string,
  idx: number,
  requestId?: string,
): number {
  const val = obj[key];
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(
      `cee.validation_pipeline.parse_error: edges[${idx}].${key} must be a finite number (request_id=${requestId})`,
    );
  }
  return val;
}
