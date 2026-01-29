/**
 * LLM Call Recorder Utility
 *
 * Helper functions for recording LLM calls to the observability collector.
 * Used by LLM adapters (anthropic.ts, openai.ts, extraction.ts).
 */

import type { LLMCallStep, ModelSelectionReason, PromptModelConfig } from "./types.js";
import type { ObservabilityCollector } from "./collector.js";

/**
 * Parameters for recording an LLM call.
 */
export interface RecordLLMCallParams {
  collector: ObservabilityCollector | undefined;
  step: LLMCallStep;
  /** Prompt ID (e.g., "default:draft_graph") */
  prompt_id?: string;
  model: string;
  provider: "anthropic" | "openai";
  /** Per-prompt model configuration */
  model_config?: PromptModelConfig;
  /** Why this model was selected */
  model_selection_reason?: ModelSelectionReason;
  attempt: number;
  success: boolean;
  error?: string;
  tokens: {
    input: number;
    output: number;
  };
  latency_ms: number;
  started_at: Date;
  completed_at: Date;
  raw_prompt?: string;
  raw_response?: string;
  prompt_version?: string;
  cache_hit?: boolean;
}

/**
 * Record an LLM call to the observability collector.
 * No-op if collector is undefined.
 */
export function recordLLMCall(params: RecordLLMCallParams): void {
  const { collector, ...callData } = params;
  if (!collector) {
    return;
  }

  collector.recordLLMCall({
    step: callData.step,
    prompt_id: callData.prompt_id,
    model: callData.model,
    provider: callData.provider,
    model_config: callData.model_config,
    model_selection_reason: callData.model_selection_reason,
    tokens: {
      input: callData.tokens.input,
      output: callData.tokens.output,
      total: callData.tokens.input + callData.tokens.output,
    },
    latency_ms: callData.latency_ms,
    attempt: callData.attempt,
    success: callData.success,
    error: callData.error,
    started_at: callData.started_at.toISOString(),
    completed_at: callData.completed_at.toISOString(),
    raw_prompt: callData.raw_prompt,
    raw_response: callData.raw_response,
    prompt_version: callData.prompt_version,
    cache_hit: callData.cache_hit,
  });
}

/**
 * Options for creating an LLM call context.
 */
export interface CreateLLMCallContextOptions {
  collector: ObservabilityCollector | undefined;
  step: LLMCallStep;
  model: string;
  provider: "anthropic" | "openai";
  /** Optional prompt ID */
  prompt_id?: string;
}

/**
 * Create a context object for tracking LLM call timing.
 * Returns a function to call when the LLM call completes.
 */
export function createLLMCallContext(
  collector: ObservabilityCollector | undefined,
  step: LLMCallStep,
  model: string,
  provider: "anthropic" | "openai",
  prompt_id?: string
): LLMCallContext {
  const startedAt = new Date();
  const startTime = performance.now();

  return {
    step,
    model,
    provider,
    startedAt,
    attempt: 1,
    complete: (params: LLMCallCompleteParams) => {
      const completedAt = new Date();
      const latencyMs = Math.round(performance.now() - startTime);

      recordLLMCall({
        collector,
        step,
        prompt_id,
        model,
        provider,
        model_config: params.model_config,
        model_selection_reason: params.model_selection_reason,
        attempt: params.attempt ?? 1,
        success: params.success,
        error: params.error,
        tokens: params.tokens,
        latency_ms: latencyMs,
        started_at: startedAt,
        completed_at: completedAt,
        raw_prompt: params.raw_prompt,
        raw_response: params.raw_response,
        prompt_version: params.prompt_version,
        cache_hit: params.cache_hit,
      });

      return latencyMs;
    },
  };
}

/**
 * LLM call context for tracking timing and completing recording.
 */
export interface LLMCallContext {
  step: LLMCallStep;
  model: string;
  provider: "anthropic" | "openai";
  startedAt: Date;
  attempt: number;
  complete: (params: LLMCallCompleteParams) => number;
}

/**
 * Parameters for completing an LLM call recording.
 */
export interface LLMCallCompleteParams {
  success: boolean;
  error?: string;
  tokens: {
    input: number;
    output: number;
  };
  attempt?: number;
  raw_prompt?: string;
  raw_response?: string;
  prompt_version?: string;
  cache_hit?: boolean;
  /** Per-prompt model configuration */
  model_config?: PromptModelConfig;
  /** Why this model was selected */
  model_selection_reason?: ModelSelectionReason;
}

/**
 * Map adapter method names to LLM call steps.
 */
export function methodToStep(method: string): LLMCallStep {
  switch (method) {
    case "draftGraph":
      return "draft_graph";
    case "repairGraph":
      return "repair_graph";
    case "suggestOptions":
      return "suggest_options";
    case "clarifyBrief":
      return "clarify_brief";
    case "critiqueGraph":
      return "critique_graph";
    case "explainDiff":
      return "explain_diff";
    case "factorExtraction":
      return "factor_extraction";
    case "constraintExtraction":
      return "constraint_extraction";
    case "factorEnrichment":
      return "factor_enrichment";
    default:
      return "other";
  }
}
