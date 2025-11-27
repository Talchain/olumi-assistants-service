/**
 * Plain-English Templates for Decision Review
 *
 * Converts ISL analysis results into human-readable explanations
 * for decision reviewers. Handles graceful degradation messaging.
 */

import type {
  EnhancedNodeCritique,
  ISLSensitivityResult,
  ISLContrastiveResult,
  ISLConformalResult,
  ValidationSuggestions,
  DecisionReviewResponse,
  ISLAvailabilitySummary,
} from './schema.js';

// ============================================================================
// Sensitivity Templates
// ============================================================================

/**
 * Generate plain-English explanation for sensitivity analysis
 */
export function formatSensitivityExplanation(
  sensitivity: ISLSensitivityResult,
  nodeTitle: string,
): string {
  if (!sensitivity.available) {
    return `Sensitivity analysis was unavailable for "${nodeTitle}". ${sensitivity.error ?? 'The analysis could not be completed.'}`;
  }

  const score = sensitivity.score ?? 0;
  const classification = sensitivity.classification ?? 'unknown';

  let explanation = '';

  if (classification === 'high') {
    explanation = `"${nodeTitle}" is highly sensitive to changes in the decision model. `;
    explanation += `With a sensitivity score of ${(score * 100).toFixed(0)}%, small changes to this element could significantly affect the overall decision outcome.`;
  } else if (classification === 'medium') {
    explanation = `"${nodeTitle}" has moderate sensitivity. `;
    explanation += `With a sensitivity score of ${(score * 100).toFixed(0)}%, changes to this element may affect the decision, but the impact is bounded.`;
  } else {
    explanation = `"${nodeTitle}" has low sensitivity. `;
    explanation += `With a sensitivity score of ${(score * 100).toFixed(0)}%, this element is relatively stable within the decision framework.`;
  }

  // Add contributing factors if available
  if (sensitivity.factors && sensitivity.factors.length > 0) {
    explanation += ` Key contributing factors: ${sensitivity.factors.slice(0, 3).join('; ')}.`;
  }

  return explanation;
}

// ============================================================================
// Contrastive Explanation Templates
// ============================================================================

/**
 * Generate plain-English explanation for contrastive analysis
 */
export function formatContrastiveExplanation(
  contrastive: ISLContrastiveResult,
  nodeTitle: string,
): string {
  if (!contrastive.available) {
    return `Contrastive analysis was unavailable for "${nodeTitle}". ${contrastive.error ?? 'The analysis could not be completed.'}`;
  }

  let explanation = '';

  if (contrastive.explanation) {
    explanation = contrastive.explanation;
  } else {
    explanation = `The decision at "${nodeTitle}" was reached based on the available evidence and analysis.`;
  }

  // Add key factors
  if (contrastive.keyFactors && contrastive.keyFactors.length > 0) {
    explanation += ` The key differentiating factors were: ${contrastive.keyFactors.join(', ')}.`;
  }

  // Add counterfactuals
  if (contrastive.counterfactuals && contrastive.counterfactuals.length > 0) {
    explanation += ' Alternative scenarios considered: ';
    explanation += contrastive.counterfactuals
      .slice(0, 2)
      .map((cf) => `if ${cf.change}, then ${cf.predictedImpact}`)
      .join('; ');
    explanation += '.';
  }

  return explanation;
}

// ============================================================================
// Conformal Prediction Templates
// ============================================================================

/**
 * Generate plain-English explanation for conformal prediction
 */
export function formatConformalExplanation(
  conformal: ISLConformalResult,
  nodeTitle: string,
): string {
  if (!conformal.available) {
    return `Prediction intervals were unavailable for "${nodeTitle}". ${conformal.error ?? 'The analysis could not be completed.'}`;
  }

  const interval = conformal.interval;
  const confidence = conformal.confidence ?? 0.9;

  if (!interval) {
    return `No prediction interval could be calculated for "${nodeTitle}".`;
  }

  let explanation = `For "${nodeTitle}", we estimate the value falls between ${interval.lower.toFixed(2)} and ${interval.upper.toFixed(2)} `;
  explanation += `with ${(confidence * 100).toFixed(0)}% confidence.`;

  if (conformal.wellCalibrated === true) {
    explanation += ' This interval is well-calibrated based on historical data.';
  } else if (conformal.wellCalibrated === false) {
    explanation += ' Note: This interval may be less reliable due to limited calibration data.';
  }

  // Add width factors
  if (conformal.widthFactors && conformal.widthFactors.length > 0) {
    explanation += ` Uncertainty is primarily driven by: ${conformal.widthFactors.slice(0, 2).join(', ')}.`;
  }

  return explanation;
}

// ============================================================================
// Validation Strategy Templates
// ============================================================================

/**
 * Generate plain-English summary of validation strategies
 */
export function formatValidationSuggestions(
  suggestions: ValidationSuggestions,
): string {
  if (!suggestions.available) {
    return `Validation strategy recommendations were unavailable. ${suggestions.error ?? 'The analysis could not be completed.'}`;
  }

  const strategies = suggestions.strategies ?? [];

  if (strategies.length === 0) {
    return 'No specific validation strategies are recommended at this time.';
  }

  let explanation = `We recommend ${strategies.length} validation ${strategies.length === 1 ? 'strategy' : 'strategies'} `;
  explanation += `to strengthen confidence in this decision:\n\n`;

  for (const strategy of strategies.slice(0, 5)) {
    const priorityLabel = strategy.priority === 'critical' ? '🔴 CRITICAL' :
      strategy.priority === 'high' ? '🟠 HIGH' :
      strategy.priority === 'medium' ? '🟡 MEDIUM' : '🟢 LOW';

    explanation += `${priorityLabel}: ${strategy.title}\n`;
    explanation += `  ${strategy.description}\n`;
    explanation += `  Effort: ${strategy.effort} | Expected impact: ${(strategy.expectedImpact * 100).toFixed(0)}%\n`;

    if (strategy.actions.length > 0) {
      explanation += `  Actions: ${strategy.actions.slice(0, 3).join('; ')}\n`;
    }
    explanation += '\n';
  }

  if (suggestions.coverage) {
    explanation += `Coverage: ${(suggestions.coverage.nodeCoverage * 100).toFixed(0)}% of nodes, `;
    explanation += `${(suggestions.coverage.riskCoverage * 100).toFixed(0)}% of identified risks.`;
  }

  return explanation;
}

// ============================================================================
// Node Critique Summary Templates
// ============================================================================

/**
 * Generate a complete plain-English summary for a node critique
 */
export function formatNodeCritiqueSummary(critique: EnhancedNodeCritique): string {
  const sections: string[] = [];

  // Header
  const severityLabel = critique.severity === 'critical' ? '🔴 CRITICAL' :
    critique.severity === 'high' ? '🟠 HIGH' :
    critique.severity === 'medium' ? '🟡 MEDIUM' :
    critique.severity === 'low' ? '🟢 LOW' : 'ℹ️ INFO';

  sections.push(`## ${critique.title} (${critique.kind})`);
  sections.push(`Severity: ${severityLabel} | Confidence: ${(critique.confidence * 100).toFixed(0)}%\n`);

  // LLM Critique
  sections.push(`**Summary:** ${critique.critique.summary}`);

  if (critique.critique.concerns.length > 0) {
    sections.push('\n**Concerns:**');
    for (const concern of critique.critique.concerns) {
      sections.push(`- ${concern}`);
    }
  }

  if (critique.critique.suggestions.length > 0) {
    sections.push('\n**Suggestions:**');
    for (const suggestion of critique.critique.suggestions) {
      sections.push(`- ${suggestion}`);
    }
  }

  // ISL Analysis
  if (critique.islAnalysis) {
    sections.push('\n**Causal Analysis:**');

    if (critique.islAnalysis.sensitivity) {
      sections.push(formatSensitivityExplanation(critique.islAnalysis.sensitivity, critique.title));
    }

    if (critique.islAnalysis.contrastive) {
      sections.push(formatContrastiveExplanation(critique.islAnalysis.contrastive, critique.title));
    }

    if (critique.islAnalysis.conformal) {
      sections.push(formatConformalExplanation(critique.islAnalysis.conformal, critique.title));
    }
  }

  return sections.join('\n');
}

// ============================================================================
// Full Review Summary Template
// ============================================================================

/**
 * Generate a complete plain-English summary of the decision review
 */
export function formatDecisionReviewSummary(response: DecisionReviewResponse): string {
  const sections: string[] = [];

  // Header
  sections.push('# Decision Review Summary\n');

  // Overview stats
  sections.push(`**Nodes Analyzed:** ${response.summary.nodesAnalyzed}`);
  sections.push(`**Issues Found:** ${response.summary.bySeverity.critical} critical, ${response.summary.bySeverity.high} high, ${response.summary.bySeverity.medium} medium`);

  // ISL availability
  sections.push('\n' + formatISLAvailability(response.islAvailability));

  // Top concerns
  if (response.summary.topConcerns.length > 0) {
    sections.push('\n## Top Concerns\n');
    for (const concern of response.summary.topConcerns) {
      sections.push(`- ${concern}`);
    }
  }

  // Priority strategies
  if (response.summary.priorityStrategies.length > 0) {
    sections.push('\n## Recommended Next Steps\n');
    for (const strategy of response.summary.priorityStrategies) {
      sections.push(`- ${strategy}`);
    }
  }

  // Global validation suggestions
  if (response.globalValidationSuggestions) {
    sections.push('\n## Validation Strategies\n');
    sections.push(formatValidationSuggestions(response.globalValidationSuggestions));
  }

  // Individual critiques
  sections.push('\n## Node-by-Node Analysis\n');
  for (const critique of response.critiques) {
    sections.push(formatNodeCritiqueSummary(critique));
    sections.push('\n---\n');
  }

  // Trace info
  sections.push(`\n*Request ID: ${response.trace.requestId}*`);
  sections.push(`*Latency: ${response.trace.latencyMs}ms (ISL: ${response.trace.islLatencyMs ?? 'N/A'}ms)*`);

  return sections.join('\n');
}

// ============================================================================
// ISL Availability Template
// ============================================================================

/**
 * Format ISL availability status as plain English
 */
export function formatISLAvailability(availability: ISLAvailabilitySummary): string {
  if (!availability.serviceAvailable) {
    return `**⚠️ ISL Analysis Unavailable:** ${availability.degradationReason ?? 'The causal analysis service was not available for this review. Results are based on LLM analysis only.'}`;
  }

  const parts: string[] = [];

  if (availability.sensitivitySuccessCount > 0) {
    parts.push(`sensitivity (${availability.sensitivitySuccessCount} nodes)`);
  }
  if (availability.contrastiveSuccessCount > 0) {
    parts.push('contrastive explanation');
  }
  if (availability.conformalSuccessCount > 0) {
    parts.push(`prediction intervals (${availability.conformalSuccessCount} nodes)`);
  }
  if (availability.validationStrategiesAvailable) {
    parts.push('validation strategies');
  }

  if (parts.length === 0) {
    return '**⚠️ ISL Analysis:** No causal analyses were completed successfully.';
  }

  return `**✓ ISL Analysis Completed:** ${parts.join(', ')}.`;
}

// ============================================================================
// Severity Explanation
// ============================================================================

/**
 * Explain what a severity level means
 */
export function explainSeverity(
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical',
): string {
  switch (severity) {
    case 'critical':
      return 'This requires immediate attention before proceeding with the decision.';
    case 'high':
      return 'This is a significant concern that should be addressed before finalizing the decision.';
    case 'medium':
      return 'This is a notable concern that warrants consideration.';
    case 'low':
      return 'This is a minor observation for your awareness.';
    case 'info':
    default:
      return 'This is informational and does not indicate a problem.';
  }
}

// ============================================================================
// Degradation Notice Template
// ============================================================================

/**
 * Generate a notice when ISL is degraded
 */
export function formatDegradationNotice(reason: string): string {
  return `**Note:** Some advanced analyses were not available for this review. ${reason} ` +
    'The review still includes LLM-based critique and suggestions. ' +
    'Consider re-running the review when the causal analysis service is available for deeper insights.';
}
