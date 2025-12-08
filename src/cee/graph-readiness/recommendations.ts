/**
 * Graph Readiness Recommendation Generation
 *
 * Generates actionable recommendations based on detected issues
 * and estimates potential improvement for each quality factor.
 */

import type { QualityFactorName } from "./types.js";
import { IMPROVEMENT_ESTIMATION } from "./constants.js";

// ============================================================================
// Recommendation Templates
// ============================================================================

const RECOMMENDATION_TEMPLATES: Record<QualityFactorName, Record<string, string>> = {
  causal_detail: {
    "low edge density":
      "Add edges to connect isolated nodes and clarify cause-effect relationships",
    "many edges lack belief":
      "Assign probability values (0-1) to edges representing likelihood",
    "outcomes are not connected":
      "Connect each outcome to at least one option via an edge",
    disconnected:
      "Review graph structure and add edges to connect isolated components",
  },
  weight_refinement: {
    "identical values":
      "Differentiate belief values based on evidence or expert judgment",
    "default 0.5":
      "Review and adjust default beliefs based on domain knowledge",
    "extreme belief":
      "Add provenance/evidence for high-confidence (>0.9) or low-confidence (<0.1) beliefs",
    "no belief":
      "Add belief values to edges to represent probability estimates",
    placeholder:
      "Replace placeholder values with calibrated probability estimates",
  },
  risk_coverage: {
    "no risk nodes":
      "Add risk nodes to represent potential negative outcomes for each option",
    "few risks":
      "Consider additional risks like implementation challenges, market changes, or dependencies",
    "not connected":
      "Link risk nodes to the options they affect",
    "no options":
      "Add option nodes before assessing risk coverage",
  },
  outcome_balance: {
    "no connected outcomes":
      "Add outcomes (positive and negative) for each option",
    "uneven outcome":
      "Balance analysis by adding similar depth for all options",
    missing:
      "Add both options and outcomes to enable balance analysis",
    "confirmation bias":
      "Ensure all options have comparable outcome analysis",
  },
  option_diversity: {
    "only one option":
      "Add at least 2 more alternatives to enable meaningful comparison",
    "not connected to a decision":
      "Link all options to their parent decision node",
    "no options":
      "Define decision options before assessing diversity",
    "many options":
      "Consider grouping similar options or prioritizing top candidates",
  },
};

const DEFAULT_RECOMMENDATIONS: Record<QualityFactorName, string> = {
  causal_detail:
    "Add more edges with belief values to strengthen causal relationships",
  weight_refinement:
    "Review and calibrate edge belief values based on evidence",
  risk_coverage:
    "Add risk nodes for each option to capture potential downsides",
  outcome_balance:
    "Ensure each option has connected outcomes for fair comparison",
  option_diversity:
    "Consider adding more alternative options",
};

// ============================================================================
// Recommendation Generation
// ============================================================================

/**
 * Generate a specific recommendation based on factor and detected issues.
 */
export function generateRecommendation(
  factor: QualityFactorName,
  issues: string[],
): string {
  const templates = RECOMMENDATION_TEMPLATES[factor] ?? {};

  // Find the first matching template
  for (const issue of issues) {
    const issueLower = issue.toLowerCase();
    for (const [pattern, recommendation] of Object.entries(templates)) {
      if (issueLower.includes(pattern.toLowerCase())) {
        return recommendation;
      }
    }
  }

  // Return default if no specific match
  return DEFAULT_RECOMMENDATIONS[factor] ?? "Review and enhance this quality factor";
}

/**
 * Estimate potential improvement if recommendations are followed.
 *
 * The estimate is based on:
 * - Gap from perfect score (100)
 * - Actionability of detected issues
 */
export function estimatePotentialImprovement(
  factor: QualityFactorName,
  currentScore: number,
  issues: string[],
): number {
  const maxImprovement = 100 - currentScore;
  const { baseImprovement, actionablePatterns } = IMPROVEMENT_ESTIMATION;

  // Start with base improvement, capped at max possible
  let improvement = Math.min(maxImprovement, baseImprovement);

  // Add bonuses for actionable issues
  const appliedPatterns = new Set<string>();
  for (const issue of issues) {
    const issueLower = issue.toLowerCase();
    for (const [pattern, bonus] of Object.entries(actionablePatterns)) {
      if (issueLower.includes(pattern) && !appliedPatterns.has(pattern)) {
        improvement = Math.min(maxImprovement, improvement + bonus);
        appliedPatterns.add(pattern);
        break; // Only apply one bonus per issue
      }
    }
  }

  return Math.round(improvement);
}

/**
 * Generate confidence explanation based on graph size and score consistency.
 */
export function generateConfidenceExplanation(
  confidenceLevel: "high" | "medium" | "low",
  nodeCount: number,
  factorScores: Record<QualityFactorName, number>,
): string {
  const scores = Object.values(factorScores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  switch (confidenceLevel) {
    case "high":
      return `Your model has sufficient detail (${nodeCount} nodes) for reliable assessment`;

    case "medium":
      if (nodeCount < 5) {
        return `Your model has sufficient detail for directional insights but adding more nodes would improve confidence`;
      }
      return `Assessment is moderately reliable - scores vary across factors (average: ${Math.round(avgScore)})`;

    case "low":
      if (nodeCount < 3) {
        return `Graph is too small (${nodeCount} nodes) for reliable assessment - add more structure`;
      }
      return `Assessment may not be reliable - factor scores are inconsistent (average: ${Math.round(avgScore)})`;

    default:
      return "Assessment confidence could not be determined";
  }
}
