/**
 * Shared decision_review LLM invocation helper.
 *
 * Extracted from src/routes/assist.v1.decision-review.ts for reuse by the
 * V5 Group 1 Task B auto-fire path. The HTTP endpoint keeps its full retry /
 * shape-correction logic layered on top; V5 uses single-shot semantics with
 * a hard 15s timeout, degrading to thin content on failure.
 *
 * Design:
 *  - `buildDecisionReviewUserMessage` exposes the exact user-message shape
 *    the prompt expects. Unchanged from the route handler.
 *  - `invokeDecisionReview` loads the prompt, calls the adapter, extracts
 *    JSON, and returns a parsed object plus call metadata. No retry; caller
 *    decides whether to retry. No rate limiting; that is a route concern.
 *  - Never throws on shape-check failure; returns null in `output` so the
 *    caller decides how to degrade.
 *  - Throws only on adapter errors / timeouts / aborts (caller catches and
 *    translates to graceful degradation).
 */

import { getSystemPrompt, getSystemPromptMeta } from '../../adapters/llm/prompt-loader.js';
import {
  getAdapterWithResolution,
  getMaxTokensFromConfig,
  type ModelResolution,
} from '../../adapters/llm/router.js';
import type { CallOpts } from '../../adapters/llm/types.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import {
  buildScienceClaimsSection,
  injectScienceClaimsSection,
} from './science-claims.js';

// ============================================================================
// Shared input shape (subset the V5 enricher needs; route schema is richer)
// ============================================================================

/**
 * Adapter-side diagnostics for the decision_review LLM call. Lives on the
 * input object, never injected into the user message — see
 * `buildDecisionReviewUserMessage` for the strict separation. v12 (the next
 * decision_review prompt revision) will read these signals through a future
 * adapter-side hook that overrides deterministic_coaching defaults; today
 * v11 is unaware of `_meta` and that is intentional.
 */
export interface DecisionReviewMeta {
  readonly input_shape_version: 'v5-normalised';
  /** Number of populated entries on flip_threshold_data after derivation. */
  readonly flip_threshold_count: number;
  /** Number of populated entries on isl_results.factor_sensitivity. */
  readonly factor_sensitivity_count: number;
  /** Number of populated entries on isl_results.fragile_edges. */
  readonly fragile_edge_count: number;
  /** Number of model_critiques carried by deterministic_coaching. 0 until the
   *  M1 deterministic-coaching pipeline ships. */
  readonly model_critique_count: number;
  /** Number of upstream m1_coaching.evidence_gaps entries that were object-
   *  shaped but missing one of the four required fields (factor_id,
   *  factor_label, voi_score, confidence). Internal observability only —
   *  the contract test at decision-review-enricher.contract.test.ts §"_meta
   *  is adapter-only" asserts this key never reaches the user message. */
  readonly evidence_gaps_dropped_count: number;
  /** Whether the deterministic_coaching block is the M1 fully-derived shape.
   *  False until M1 ships — v12 uses this to decide whether to fall back to
   *  raw signals (margin, robustness_level) instead of trusting headline_type
   *  / readiness. */
  readonly has_deterministic_coaching: boolean;
  /** winner.win_probability minus runner_up.win_probability. Null when no
   *  runner-up exists. */
  readonly margin: number | null;
  /** robustness.level pulled defensively from the V2 envelope. Null when
   *  absent. */
  readonly robustness_level: string | null;
}

export interface DecisionReviewInvokeInput {
  readonly brief: string;
  readonly brief_hash: string;
  readonly graph: Record<string, unknown>;
  readonly isl_results: Record<string, unknown>;
  readonly deterministic_coaching: Record<string, unknown>;
  readonly winner: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    readonly [k: string]: unknown;
  };
  readonly runner_up: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    readonly [k: string]: unknown;
  } | null;
  readonly flip_threshold_data?: ReadonlyArray<Record<string, unknown>>;
  /** Adapter-side diagnostics — never injected into the user message. */
  readonly _meta?: DecisionReviewMeta;
}

export interface InvokeDecisionReviewOptions {
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface DecisionReviewInvokeResult {
  /** Parsed JSON object from the LLM response, or null when extraction failed. */
  readonly output: Record<string, unknown> | null;
  /** Raw LLM content (pre-extraction), for logging. */
  readonly raw: string;
  readonly model: string;
  readonly provider: string;
  readonly llm_latency_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly prompt_version: string | undefined;
  /**
   * Model-routing resolution for this call. Closes the V5 holistic audit
   * UU-16 observability gap: previously this site used `getAdapter(...)`
   * which does not surface the precedence-chain outcome, leaving the only
   * post-run_analysis LLM call invisible on the `model_resolutions`
   * dashboard. Callers that have per-turn context (the V5 enricher does)
   * forward this into `recordModelResolution` so turn-debug attributions
   * cover decision_review alongside ORIENT.
   */
  readonly resolution: ModelResolution;
}

// ============================================================================
// User message assembly (identical to route handler's buildUserMessage)
// ============================================================================

export function buildDecisionReviewUserMessage(
  input: DecisionReviewInvokeInput,
  margin: number | null,
): string {
  const sections: string[] = [];

  sections.push('<BRIEF>');
  sections.push(input.brief);
  sections.push('</BRIEF>');

  sections.push('<GRAPH>');
  sections.push(JSON.stringify(input.graph, null, 2));
  sections.push('</GRAPH>');

  sections.push('<ISL_RESULTS>');
  sections.push(JSON.stringify(input.isl_results, null, 2));
  sections.push('</ISL_RESULTS>');

  sections.push('<DETERMINISTIC_COACHING>');
  sections.push(JSON.stringify(input.deterministic_coaching, null, 2));
  sections.push('</DETERMINISTIC_COACHING>');

  sections.push('<DECISION_CONTEXT>');
  sections.push(`winner: ${JSON.stringify(input.winner)}`);
  if (input.runner_up !== null) {
    sections.push(`runner_up: ${JSON.stringify(input.runner_up)}`);
  } else {
    sections.push('runner_up: null (single-option decision)');
  }
  sections.push(`margin: ${JSON.stringify(margin)}`);
  sections.push('</DECISION_CONTEXT>');

  sections.push('<FLIP_THRESHOLD_DATA>');
  if (input.flip_threshold_data && input.flip_threshold_data.length > 0) {
    sections.push(JSON.stringify(input.flip_threshold_data, null, 2));
  } else {
    sections.push('Not available');
  }
  sections.push('</FLIP_THRESHOLD_DATA>');

  return sections.join('\n\n');
}

// ============================================================================
// Single-shot invocation
// ============================================================================

/**
 * Load the decision_review prompt, call the configured adapter once, and
 * extract the JSON body. Returns `output: null` when JSON extraction fails.
 * Throws only on adapter / transport / timeout errors; caller is expected to
 * catch and decide how to degrade.
 */
export async function invokeDecisionReview(
  input: DecisionReviewInvokeInput,
  options: InvokeDecisionReviewOptions,
): Promise<DecisionReviewInvokeResult> {
  const rawPrompt = await getSystemPrompt('decision_review');
  const promptMeta = getSystemPromptMeta('decision_review');

  let assembledPrompt = rawPrompt;
  const scienceResult = buildScienceClaimsSection();
  if (scienceResult !== null && !rawPrompt.includes('<SCIENCE_CLAIMS>')) {
    assembledPrompt = injectScienceClaimsSection(rawPrompt, scienceResult.section);
  }

  const margin =
    input.runner_up !== null
      ? input.winner.win_probability - input.runner_up.win_probability
      : null;

  const userMessage = buildDecisionReviewUserMessage(input, margin);

  const { adapter, resolution } = getAdapterWithResolution('decision_review');
  const configuredMaxTokens = getMaxTokensFromConfig('decision_review');
  const maxTokens = configuredMaxTokens ?? 4096;

  const callOpts: CallOpts = {
    requestId: options.requestId,
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  };

  const llmResult = await adapter.chat(
    {
      system: assembledPrompt,
      userMessage,
      temperature: 0,
      maxTokens,
      responseFormat: 'json_object',
    },
    callOpts,
  );

  const extraction = extractJsonFromResponse(llmResult.content, {
    task: 'decision_review',
    model: llmResult.model,
    correlationId: options.requestId,
  });

  const parsed =
    extraction.json && typeof extraction.json === 'object' && !Array.isArray(extraction.json)
      ? (extraction.json as Record<string, unknown>)
      : null;

  return {
    output: parsed,
    raw: llmResult.content,
    model: llmResult.model,
    provider: adapter.name,
    llm_latency_ms: llmResult.latencyMs,
    input_tokens: llmResult.usage.input_tokens,
    output_tokens: llmResult.usage.output_tokens,
    prompt_version: promptMeta.prompt_version,
    resolution,
  };
}
