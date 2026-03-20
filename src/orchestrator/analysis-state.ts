import type { ConversationContext, DecisionStage, V2RunResponseEnvelope } from "./types.js";
import { log } from "../utils/telemetry.js";

function hasConfiguredInterventions(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const interventions = value as Record<string, unknown>;
  return Object.keys(interventions).length > 0;
}

function getOptionResultCandidates(response: V2RunResponseEnvelope): unknown[] {
  const r = response as Record<string, unknown>;

  // PLoT /v2/run returns option_comparison; the UI normalizer copies it to results.
  // Check results as array first
  if (Array.isArray(r.results) && r.results.length > 0) return r.results;

  // Check option_comparison as array
  if (Array.isArray(r.option_comparison) && r.option_comparison.length > 0) return r.option_comparison;

  // Check results as object with nested arrays (AnalysisInputsSummary shape or V2-nested)
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    const nested = r.results as Record<string, unknown>;
    if (Array.isArray(nested.option_comparison)) return nested.option_comparison;
    if (Array.isArray(nested.options)) return nested.options;
    if (Array.isArray(nested.option_results)) return nested.option_results;
  }

  // Log unexpected shape for diagnostics
  if (r.results !== undefined && r.results !== null) {
    log.warn({
      event: 'analysis_state.unexpected_results_shape',
      type: typeof r.results,
      isArray: Array.isArray(r.results),
      keys: r.results && typeof r.results === 'object' ? Object.keys(r.results as object) : null,
    });
  }

  return [];
}

function hasValidOptionResults(response: V2RunResponseEnvelope): boolean {
  return getOptionResultCandidates(response).some((result) => {
    const candidate = result as Record<string, unknown>;
    return typeof candidate.option_label === "string" && typeof candidate.win_probability === "number";
  });
}

/**
 * Get the nested results object when the UI sends V2 fields inside results as an object.
 * Returns null if results is not an object or is an array.
 */
function getNestedResults(response: V2RunResponseEnvelope): Record<string, unknown> | null {
  const r = response as Record<string, unknown>;
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    return r.results as Record<string, unknown>;
  }
  return null;
}

function hasValidSensitivity(response: V2RunResponseEnvelope): boolean {
  const sensitivity = response.factor_sensitivity ?? getNestedResults(response)?.factor_sensitivity;
  return Array.isArray(sensitivity) && sensitivity.some((factor) => {
    const candidate = factor as Record<string, unknown>;
    return typeof candidate.label === "string" || typeof candidate.factor_label === "string";
  });
}

function hasValidConstraintAnalysis(response: V2RunResponseEnvelope): boolean {
  const ca = response.constraint_analysis ?? getNestedResults(response)?.constraint_analysis;
  const jointProbability = (ca as Record<string, unknown> | null | undefined)?.joint_probability;
  return typeof jointProbability === "number" && Number.isFinite(jointProbability);
}

function hasValidRobustness(response: V2RunResponseEnvelope): boolean {
  const robustness = response.robustness ?? getNestedResults(response)?.robustness;
  const level = (robustness as Record<string, unknown> | null | undefined)?.level;
  return typeof level === "string" && (level as string).length > 0;
}

export function isAnalysisPresent(response: V2RunResponseEnvelope | null | undefined): response is V2RunResponseEnvelope {
  return response != null;
}

/**
 * Normalize an analysis envelope that may be missing analysis_status.
 * PLoT responses always include meta.response_hash and results[] when complete,
 * but may omit analysis_status. Infer it when possible.
 */
export function normalizeAnalysisEnvelope(response: V2RunResponseEnvelope): V2RunResponseEnvelope {
  const r = response as Record<string, unknown>;
  const resultsShape = r.results === null ? 'null'
    : r.results === undefined ? 'undefined'
    : Array.isArray(r.results) ? 'array'
    : typeof r.results;
  log.info({
    analysis_status: response.analysis_status ?? null,
    meta_response_hash: response.meta?.response_hash ?? null,
    results_shape: resultsShape,
    results_keys: resultsShape === 'object' ? Object.keys(r.results as object) : null,
    has_option_comparison: Array.isArray(r.option_comparison),
  }, 'normalizeAnalysisEnvelope: incoming payload shape');

  if (
    !response.analysis_status
    && response.meta?.response_hash
    && getOptionResultCandidates(response).length > 0
    && hasValidOptionResults(response)
  ) {
    return { ...response, analysis_status: 'completed' };
  }
  return response;
}

export function isAnalysisExplainable(response: V2RunResponseEnvelope | null | undefined): response is V2RunResponseEnvelope {
  if (!response) return false;
  if (response.analysis_status !== "completed" && response.analysis_status !== "computed" && response.analysis_status !== "complete") return false;

  const explainable = hasValidOptionResults(response)
    || hasValidSensitivity(response)
    || hasValidConstraintAnalysis(response)
    || hasValidRobustness(response);

  if (!explainable) {
    const r = response as Record<string, unknown>;
    log.warn({
      event: 'analysis_state.completed_but_no_valid_data',
      analysis_status: response.analysis_status,
      results_type: typeof r.results,
      results_length: Array.isArray(r.results) ? r.results.length : null,
      has_option_comparison: 'option_comparison' in r,
      has_factor_sensitivity: Array.isArray(response.factor_sensitivity),
      has_robustness: response.robustness != null,
      has_constraint_analysis: response.constraint_analysis != null,
    });
  }

  return explainable;
}

export function isResultsExplanationEligible(
  stage: DecisionStage | null | undefined,
  response: V2RunResponseEnvelope | null | undefined,
): response is V2RunResponseEnvelope {
  return isAnalysisExplainable(response) && isAnalysisCurrent(stage, response);
}

export function isAnalysisCurrent(
  stage: DecisionStage | null | undefined,
  response: V2RunResponseEnvelope | null | undefined,
): boolean {
  return response != null && stage !== "ideate";
}

export function isAnalysisRunnable(context: ConversationContext): boolean {
  if (!context.graph || !context.analysis_inputs) return false;
  if (!Array.isArray(context.analysis_inputs.options) || context.analysis_inputs.options.length === 0) return false;

  return context.analysis_inputs.options.every((option) => hasConfiguredInterventions(option.interventions));
}
