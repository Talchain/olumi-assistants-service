/**
 * Plain English Formatters for ISL Results
 *
 * Transforms raw ISL analysis results into user-friendly plain English
 * explanations. These formatters are used to enrich decision reviews
 * with actionable insights.
 */

import type { ISLSensitivityResponse, ISLContrastiveResponse, ISLConformalResponse, ISLValidationStrategiesResponse } from '../../adapters/isl/types.js';
import type { AssumptionWarning, ActionableAlternative, ConfidenceStatement, ModelImprovement, ISLEnhancements } from './schema.js';

/**
 * Format sensitivity analysis results into assumption warnings
 */
export function formatAssumptionWarnings(
  result: ISLSensitivityResponse | null | undefined,
): AssumptionWarning[] | undefined {
  if (!result || !result.sensitivities?.length) return undefined;

  return result.sensitivities
    .filter((s) => s.sensitivity_score >= 0.5) // Only high sensitivity nodes
    .map((s) => ({
      variable: s.node_id,
      sensitivity: s.sensitivity_score,
      impact: s.contributing_factors.map((f) => f.description).join('; ') || 'Unknown impact',
      plain_english: generateSensitivityPlainEnglish(s.node_id, s.sensitivity_score, s.classification, s.contributing_factors),
    }));
}

/**
 * Generate plain English for sensitivity
 */
function generateSensitivityPlainEnglish(
  nodeId: string,
  score: number,
  classification: string,
  factors: Array<{ type: string; impact: number; description: string }>,
): string {
  const sensitivityLevel = classification === 'high' ? 'highly' : classification === 'medium' ? 'moderately' : 'slightly';
  const topFactor = factors[0]?.description || 'various factors';

  if (score >= 0.8) {
    return `The assumption about "${nodeId}" is critical. Small changes here could significantly alter the outcome. ${topFactor}`;
  }
  if (score >= 0.5) {
    return `The assumption about "${nodeId}" is ${sensitivityLevel} sensitive. Consider validating this assumption. ${topFactor}`;
  }
  return `The assumption about "${nodeId}" has low sensitivity to changes.`;
}

/**
 * Format contrastive explanation results into actionable alternatives
 */
export function formatActionableAlternatives(
  result: ISLContrastiveResponse | null | undefined,
): ActionableAlternative[] | undefined {
  if (!result || !result.contrasts?.length) return undefined;

  return result.contrasts
    .filter((c) => c.counterfactual) // Only those with counterfactuals
    .map((c) => ({
      change: c.counterfactual!.change,
      outcome_diff: c.counterfactual!.predicted_impact,
      feasibility: c.confidence,
      plain_english: generateContrastivePlainEnglish(c.counterfactual!.change, c.counterfactual!.predicted_impact, c.confidence),
    }));
}

/**
 * Generate plain English for contrastive explanation
 */
function generateContrastivePlainEnglish(
  change: string,
  predictedImpact: string,
  feasibility: number,
): string {
  const feasibilityText = feasibility >= 0.7 ? 'This is a feasible change' : feasibility >= 0.4 ? 'This may be challenging' : 'This would require significant effort';
  return `Consider: ${change}. This would ${predictedImpact}. ${feasibilityText}.`;
}

/**
 * Format conformal prediction results into confidence statement
 */
export function formatConfidenceStatement(
  result: ISLConformalResponse | null | undefined,
): ConfidenceStatement | undefined {
  if (!result || !result.intervals?.length) return undefined;

  // Use the first interval as the primary confidence statement
  const primaryInterval = result.intervals[0];

  return {
    prediction_interval: [primaryInterval.lower_bound, primaryInterval.upper_bound],
    confidence_level: primaryInterval.confidence_level,
    uncertainty_source: primaryInterval.width_factors?.map((f) => f.factor).join(', ') || 'Unknown sources',
    plain_english: generateConformalPlainEnglish(
      primaryInterval.lower_bound,
      primaryInterval.upper_bound,
      primaryInterval.confidence_level,
      primaryInterval.width_factors?.map((f) => f.factor) || [],
    ),
  };
}

/**
 * Generate plain English for conformal prediction
 */
function generateConformalPlainEnglish(
  lower: number,
  upper: number,
  confidence: number,
  widthFactors: string[],
): string {
  const confidencePercent = Math.round(confidence * 100);
  const sourcesText = widthFactors.length > 0 ? `Uncertainty comes from ${widthFactors.join(' and ')}.` : '';
  return `With ${confidencePercent}% confidence, the outcome will be between ${lower.toFixed(2)} and ${upper.toFixed(2)}. ${sourcesText}`;
}

/**
 * Format validation strategies results into model improvements
 */
export function formatModelImprovements(
  result: ISLValidationStrategiesResponse | null | undefined,
): ModelImprovement[] | undefined {
  if (!result || !result.strategies?.length) return undefined;

  return result.strategies.map((s) => ({
    type: s.actions[0]?.type || 'general',
    description: s.description,
    priority: s.priority === 'critical' ? 'high' : s.priority,
    plain_english: generateImprovementPlainEnglish(s.title, s.description, s.priority),
  }));
}

/**
 * Generate plain English for model improvements
 */
function generateImprovementPlainEnglish(
  title: string,
  description: string,
  priority: string,
): string {
  const priorityLabel = priority.toUpperCase();
  return `[${priorityLabel}] ${title}: ${description}`;
}

/**
 * Build complete ISL enhancements from all results
 */
export function buildISLEnhancements(
  sensitivityResult: ISLSensitivityResponse | null | undefined,
  contrastiveResult: ISLContrastiveResponse | null | undefined,
  conformalResult: ISLConformalResponse | null | undefined,
  validationResult: ISLValidationStrategiesResponse | null | undefined,
): ISLEnhancements {
  const endpointsUsed: string[] = [];

  const assumptionWarnings = formatAssumptionWarnings(sensitivityResult);
  if (assumptionWarnings?.length) endpointsUsed.push('sensitivity');

  const actionableAlternatives = formatActionableAlternatives(contrastiveResult);
  if (actionableAlternatives?.length) endpointsUsed.push('contrastive');

  const confidenceStatement = formatConfidenceStatement(conformalResult);
  if (confidenceStatement) endpointsUsed.push('conformal');

  const modelImprovements = formatModelImprovements(validationResult);
  if (modelImprovements?.length) endpointsUsed.push('validation');

  return {
    assumption_warnings: assumptionWarnings,
    actionable_alternatives: actionableAlternatives,
    confidence_statement: confidenceStatement,
    model_improvements: modelImprovements,
    isl_available: endpointsUsed.length > 0,
    isl_endpoints_used: endpointsUsed,
  };
}
