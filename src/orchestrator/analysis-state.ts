import type { ConversationContext, DecisionStage, V2RunResponseEnvelope } from "./types.js";
import { log } from "../utils/telemetry.js";
import { winnerOptionResultSource } from "./context/option-result-source.js";

function hasConfiguredInterventions(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const interventions = value as Record<string, unknown>;
  return Object.keys(interventions).length > 0;
}

/**
 * Option-result candidate array for this envelope, in CURRENT-first precedence
 * with a WALK to the first source carrying a usable (finite, [0,1])
 * win_probability (shared {@link winnerOptionResultSource} +
 * isUsableWinProbability predicate).
 *
 * This selects the candidate SOURCE (used here for existence / status
 * inference, NOT to surface a winner identity to the user — see
 * hasValidOptionResults / normalizeAnalysisEnvelope). M1 / round-3/4:
 * single-sourced with analysis-compact, the decision-review enricher, and
 * analysis-result-headline so the source precedence + walk never diverge; the
 * thin-current envelope is skipped for the richer results[] rather than
 * regressing to a phantom 0% winner (the round-2 plain first-non-empty read did
 * regress it). Exported so the cross-surface agreement test can pin it.
 */
export function getOptionResultCandidates(response: V2RunResponseEnvelope): unknown[] {
  const candidates = winnerOptionResultSource(response as Record<string, unknown>);

  // Log unexpected shape for diagnostics: `results` is present but no
  // recognised option array could be extracted from it (or the envelope).
  if (candidates.length === 0) {
    const r = response as Record<string, unknown>;
    if (r.results !== undefined && r.results !== null) {
      log.warn({
        event: 'analysis_state.unexpected_results_shape',
        type: typeof r.results,
        isArray: Array.isArray(r.results),
        keys: r.results && typeof r.results === 'object' ? Object.keys(r.results as object) : null,
      });
    }
  }

  return [...candidates];
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

/**
 * True when `results` is a non-null object that carries at least one
 * field downstream readers understand: option_comparison / options /
 * option_results (option arrays), factor_sensitivity (sensitivity
 * array), constraint_analysis (object with joint_probability), or
 * robustness (object with level).
 *
 * Used by normalizeAnalysisEnvelope to gate the destructive results
 * repair. Two competing concerns drive the discriminator:
 *
 *   1. The UI may wrap analytic data inside `results` as an object —
 *      including nested option arrays AND nested factor_sensitivity /
 *      constraint_analysis / robustness with no option arrays at all.
 *      Downstream readers (getOptionResultCandidates, getNestedResults,
 *      hasValidSensitivity, etc.) all understand the nested shape;
 *      overwriting it with [] would silently destroy the payload.
 *
 *   2. The UI's redux state can hit circular references during JSON
 *      serialisation and substitute a sentinel like
 *      `{ __circular: true, type: 'object' }`. That object MUST be
 *      treated as malformed and rebuilt from top-level option_comparison
 *      so analysis data still reaches the LLM context.
 *
 * The discriminator is: does the object expose any field a downstream
 * reader will recognise? Legitimate payloads do; sentinels do not.
 *
 * Keep this list in sync with hasValidOptionResults (via
 * getOptionResultCandidates), hasValidSensitivity,
 * hasValidConstraintAnalysis, hasValidRobustness.
 */
function isPreservableResultsPayload(results: unknown): boolean {
  if (!results || typeof results !== 'object' || Array.isArray(results)) return false;
  const nested = results as Record<string, unknown>;
  return Array.isArray(nested.option_comparison)
    || Array.isArray(nested.options)
    || Array.isArray(nested.option_results)
    || Array.isArray(nested.factor_sensitivity)
    || (typeof nested.constraint_analysis === 'object' && nested.constraint_analysis !== null)
    || (typeof nested.robustness === 'object' && nested.robustness !== null);
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

  // Repair malformed results: when results is genuinely malformed
  // (null / undefined / string / number / boolean / object that does
  // not contain any recognised analytic field), attempt to reconstruct
  // from top-level option_comparison (the canonical PLoT V2 field —
  // see real-PLoT shape in tests/fixtures/golden/ui-analysis-state-real.json).
  //
  // Object payloads that DO contain a recognised analytic field are
  // preserved unconditionally — see isPreservableResultsPayload for
  // the rationale and the field list. The discriminator distinguishes
  // legitimate UI-side wrapping (preserve) from circular-reference
  // sentinels like `{ __circular: true }` (rebuild).
  let repaired = response;
  if (!Array.isArray(r.results) && !isPreservableResultsPayload(r.results)) {
    const optComp = r.option_comparison;
    if (Array.isArray(optComp) && optComp.length > 0) {
      const mapped = (optComp as Array<Record<string, unknown>>).map((entry) => ({
        ...entry,
        option_label: (entry.option_label as string) ?? (entry.label as string),
        win_probability: entry.win_probability,
      }));
      repaired = { ...response, results: mapped } as V2RunResponseEnvelope;
      log.info({ repaired_from: 'option_comparison', count: mapped.length }, 'normalizeAnalysisEnvelope: results repaired');
    } else {
      repaired = { ...response, results: [] } as V2RunResponseEnvelope;
      if (r.results !== undefined && r.results !== null) {
        log.warn({ original_shape: resultsShape }, 'normalizeAnalysisEnvelope: results not repairable, set to empty array');
      }
    }
  }

  if (
    !repaired.analysis_status
    && repaired.meta?.response_hash
    && getOptionResultCandidates(repaired).length > 0
    && hasValidOptionResults(repaired)
  ) {
    return { ...repaired, analysis_status: 'completed' };
  }
  return repaired;
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
