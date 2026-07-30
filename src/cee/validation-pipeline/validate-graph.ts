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
import { isDraftTruncated } from '../../adapters/llm/draft-budget.js';
import { UpstreamTimeoutError } from '../../adapters/llm/errors.js';
import { wrapUntrusted } from '../../adapters/llm/untrusted-envelope.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import { log } from '../../utils/telemetry.js';
import { VALIDATION_PIPELINE_TIMEOUT_MS } from '../../config/timeouts.js';
import type { Pass2EdgeEstimate, Pass2Response, Pass2UserMessage } from './types.js';
import type { Pass2NodeInput, Pass2EdgeInput } from './types.js';
import type { CallOpts } from '../../adapters/llm/types.js';

// ============================================================================
// Default token cap for Pass 2 (o4-mini reasoning with structured JSON output)
// ============================================================================

/**
 * Completion-token cap for Pass 2. On a reasoning model this bounds
 * reasoning + visible output, not just the JSON we read.
 *
 * ── 4096 COULD NEVER WORK. This is a defect fix, not a tuning preference. ────
 * Measured through the deployed service on 2026-07-30 (o4-mini, served prompt
 * validate_graph_default v4, reasoning_effort medium, 12 nodes / 16 causal
 * edges): the task consumed **4,560 completion tokens** — 464 ABOVE the old
 * cap. The same call replayed at exactly 4096 returned **empty content in
 * 30,092 ms** with the request otherwise successful. So at the shipped
 * configuration Pass 2 produced nothing on every draft: the cap was exhausted
 * during reasoning and the visible JSON was never emitted. Full evidence:
 * PHASE0-EVIDENCE-2026-07-28/contested-edge-probe.md.
 *
 * ── WHY 16,384 ──────────────────────────────────────────────────────────────
 * It is the value with a POSITIVE CONTROL: the same probe's second call ran at
 * max_tokens 16,384 and returned `finish_reason: "stop"` with well-formed
 * Pass-2 JSON. Every other candidate is arithmetic; this one has a witness at
 * the real seam.
 *
 * The arithmetic agrees. Fitting cost(E) = FIXED + PER_EDGE·E to that one point
 * with FIXED := 0 maximises the slope, so 4,560 / 16 = 285 tokens per causal
 * edge is an UPPER bound on the per-edge cost. 16,384 therefore covers ~57
 * causal edges — comfortably past the 10–30 a real draft carries
 * (contested-edge-slice.md C3; live drafts measure 33–35 TOTAL edges before
 * structural filtering, cee2-live-latency.md), and 3.6× the measured need.
 *
 * ── WHY NOT SIZED FOR THE 100-EDGE STRUCTURAL CAP ───────────────────────────
 * `GRAPH_MAX_EDGES` is 100, which at 285 tokens/edge is ~28,500 tokens and, at
 * the measured 163 tokens/s, ~175 s. `VALIDATION_PIPELINE_TIMEOUT_MS` stops
 * that long before the cap could, so a bigger number would buy nothing real.
 *
 * What DOES matter is the ORDER the two bounds bind in, and it is deliberate:
 * the timeout should run out first. A cap-bound completion comes back EMPTY,
 * the adapter throws `openai_empty_response`, and the pipeline files it as
 * `api_error` — nothing in that trail names the token budget, so it reads as a
 * provider fault. A timeout-bound one aborts into `UpstreamTimeoutError` and is
 * classified `timeout` by `classifyValidationFailure` below.
 *
 * ⚠ THAT SECOND HALF WAS FALSE WHEN THIS COMMENT WAS FIRST WRITTEN, and an
 * adversarial review caught it: the catch-site classifier tested
 * `err.message.includes('timeout')` against a message reading "OpenAI chat
 * timed out", so BOTH arms filed as `api_error` and the distinction this
 * rationale rests on did not exist in telemetry. The typed check that makes it
 * true ships in the same change. (The claim also said "with elapsed ms
 * attached" — it is not: `UpstreamTimeoutError` carries `elapsedMs`, but the
 * warn emits only `err.message`. Dropped rather than dressed up.)
 *
 * At the MEASURED serving speed of 163.1 tokens/s the 60 s timeout affords
 * ~9,800 tokens (~34 edges) while the cap does not bind until ~57 — so the
 * timeout binds first. This is a speed-conditional property, not a law: the
 * FIXED := 0 conservatism that makes the per-edge costs upper bounds does NOT
 * transfer to their ratio, and a provider serving faster than ~273 tokens/s
 * would flip the order. Pinned, with that conditionality stated, in
 * tests/unit/cee.validation-pipeline/pass2-budget.test.ts.
 *
 * Well inside o4-mini's registry ceiling (`maxTokens: 65536`, config/models.ts).
 *
 * Code default, not an env gate: `CEE_MAX_TOKENS_VALIDATION` remains an
 * optional override, but a cap that only works while an env var survives is
 * the hand-maintained mirror #758 closed for the model pin.
 */
const DEFAULT_PASS2_MAX_TOKENS = 16_384;

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
  const wrappedBrief = wrapUntrusted('', brief);
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

  // ── Truncation guard ───────────────────────────────────────────────────────
  // A completion that stopped because it ran out of budget is a BUDGET failure,
  // and it must say so. Without this it reaches parsePass2Response as malformed
  // JSON and surfaces as `parse_error` — which points the reader at the model's
  // JSON discipline instead of at the cap that actually ran out. That misreading
  // is not hypothetical: the 4096 defect above sat in a shipped pipeline
  // undiagnosed because every symptom pointed somewhere else.
  //
  // Only the PARTIAL-content case reaches here. When the cap is exhausted during
  // reasoning the provider returns no content at all and the adapter throws
  // `openai_empty_response` first (openai.ts chat(), the `if (!content)`
  // branch), so this guard cannot cover that arm from inside this module.
  //
  // PROVIDER-NEUTRAL BY CONSTRUCTION. `isDraftTruncated` is the repo's own
  // predicate for this signal (draft-budget.ts): OpenAI reports
  // `finish_reason: "length"`, Anthropic reports `stop_reason: "max_tokens"`.
  // Testing the OpenAI spelling alone would silently disarm this guard the
  // moment `CEE_MODEL_VALIDATION` re-routes Pass 2 to an Anthropic model — an
  // override this very file documents as supported. Reusing the shared
  // predicate means a third provider's spelling is added in one place, not
  // two (CLAUDE.md trap 12).
  if (isDraftTruncated(result.stopReason)) {
    throw new Error(
      `cee.validation_pipeline.truncated: Pass 2 completion was truncated at ` +
        `max_tokens=${maxTokens} (stop_reason=${result.stopReason}, ` +
        `edges=${edges.length}); raise DEFAULT_PASS2_MAX_TOKENS ` +
        `(request_id=${callOpts.requestId})`,
    );
  }

  // ── Parse and validate response ────────────────────────────────────────────
  return parsePass2Response(result.content, callOpts.requestId);
}

// ============================================================================
// Failure classification
// ============================================================================

/**
 * Classifies a validation-pipeline failure for telemetry
 * (`cee.validation_pipeline.failed` → `error_type`).
 *
 * EXTRACTED, not invented: this was an inline expression at the catch site in
 * unified-pipeline/index.ts, and it had **zero test coverage** — a repo-wide
 * sweep for `validation_pipeline.failed` / `error_type` over `tests/` found
 * nothing. That is why the bug below survived. It lives HERE, beside the errors
 * it names, so it can be pinned without standing up the whole pipeline.
 */
export function classifyValidationFailure(
  err: unknown,
): 'timeout' | 'parse_error' | 'api_error' {
  // ⚠ THE SUBSTRING TEST BELOW CANNOT SEE A REAL TIMEOUT, WHICH IS WHY THE
  // TYPED CHECK LEADS. `OpenAIAdapter.chat()` throws `UpstreamTimeoutError`
  // with the message "OpenAI chat timed out" — and `"timed out"` does not
  // contain the substring `"timeout"`, nor is its `name` `'AbortError'`
  // (`errors.ts:13` sets it to `'UpstreamTimeoutError'`). So before this line a
  // genuine Pass-2 timeout was filed as `api_error`, identical to the
  // empty-content arm: the two failure modes the budget design depends on
  // telling apart were indistinguishable in telemetry.
  if (err instanceof UpstreamTimeoutError) return 'timeout';
  if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'))) {
    return 'timeout';
  }
  if (err instanceof Error && err.message.includes('parse_error')) return 'parse_error';
  return 'api_error';
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
