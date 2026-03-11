import type { ConversationContext, DecisionStage, V2RunResponseEnvelope } from "./types.js";

function hasConfiguredInterventions(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const interventions = value as Record<string, unknown>;
  return Object.keys(interventions).length > 0;
}

function hasValidOptionResults(response: V2RunResponseEnvelope): boolean {
  return Array.isArray(response.results) && response.results.some((result) => {
    const candidate = result as Record<string, unknown>;
    return typeof candidate.option_label === "string" && typeof candidate.win_probability === "number";
  });
}

function hasValidSensitivity(response: V2RunResponseEnvelope): boolean {
  return Array.isArray(response.factor_sensitivity) && response.factor_sensitivity.some((factor) => {
    const candidate = factor as Record<string, unknown>;
    return typeof candidate.label === "string";
  });
}

function hasValidConstraintAnalysis(response: V2RunResponseEnvelope): boolean {
  const jointProbability = response.constraint_analysis?.joint_probability;
  return typeof jointProbability === "number" && Number.isFinite(jointProbability);
}

function hasValidRobustness(response: V2RunResponseEnvelope): boolean {
  return typeof response.robustness?.level === "string" && response.robustness.level.length > 0;
}

export function isAnalysisPresent(response: V2RunResponseEnvelope | null | undefined): response is V2RunResponseEnvelope {
  return response != null;
}

export function isAnalysisExplainable(response: V2RunResponseEnvelope | null | undefined): response is V2RunResponseEnvelope {
  if (!response) return false;
  if (response.analysis_status !== "completed") return false;

  return hasValidOptionResults(response)
    || hasValidSensitivity(response)
    || hasValidConstraintAnalysis(response)
    || hasValidRobustness(response);
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
