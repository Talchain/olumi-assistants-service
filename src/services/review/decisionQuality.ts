/**
 * Decision Quality Assessment
 *
 * Maps existing quality metrics and readiness assessment to a simplified
 * decision quality level for the Results Panel.
 */

import type { components } from "../../generated/openapi.d.ts";

type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];

export type DecisionQualityLevel = "incomplete" | "needs_strengthening" | "good" | "solid";

export interface DecisionQualityResult {
  level: DecisionQualityLevel;
  summary: string;
}

export interface DecisionQualityInputs {
  quality: CEEQualityMeta;
  readiness: {
    level: string;
    score: number;
  };
  issues: string[];
  /** Number of factor nodes missing baseline values */
  missingBaselineCount?: number;
  /** Number of fragile edges from robustness analysis */
  fragileEdgeCount?: number;
}

// =============================================================================
// Summary Templates
// =============================================================================

const QUALITY_SUMMARIES = {
  incomplete: {
    missing_baselines: (count: number) =>
      `Model is missing baseline values for ${count} key factor${count !== 1 ? "s" : ""}`,
    no_options: "No decision options have been defined",
    disconnected_outcomes: "Outcomes are not connected to goals",
    low_coverage: "Model structure is incomplete — add options and factors",
    default: "Model requires significant improvements before analysis",
  },
  needs_strengthening: {
    uniform_weights: "Edge strengths use placeholder values — add real estimates",
    low_risk_coverage: "Consider adding risk factors for each option",
    fragile_recommendation: (count: number) =>
      `Recommendation is sensitive to ${count} assumption${count !== 1 ? "s" : ""}`,
    low_confidence: "Model structure needs refinement for reliable results",
    default: "Model needs some attention to improve analysis confidence",
  },
  good: {
    default: "Model structure is sound with good factor coverage",
  },
  solid: {
    default: "Well-structured model with calibrated estimates and risk coverage",
  },
} as const;

// =============================================================================
// Decision Quality Computation
// =============================================================================

/**
 * Compute decision quality level from existing metrics.
 *
 * Mapping logic:
 * - incomplete: readiness.level === "not_ready" OR quality.overall < 4
 * - needs_strengthening: readiness.level === "caution" OR quality.overall 4-6
 * - good: readiness.level === "ready" AND quality.overall 7-8
 * - solid: readiness.level === "ready" AND quality.overall >= 9
 */
export function computeDecisionQuality(inputs: DecisionQualityInputs): DecisionQualityResult {
  const { quality, readiness, issues, missingBaselineCount, fragileEdgeCount } = inputs;

  const level = determineLevel(quality, readiness);
  const summary = generateSummary(level, {
    quality,
    readiness,
    issues,
    missingBaselineCount,
    fragileEdgeCount,
  });

  return { level, summary };
}

function determineLevel(
  quality: CEEQualityMeta,
  readiness: { level: string; score: number }
): DecisionQualityLevel {
  const overall = quality.overall ?? 5;

  // Check for incomplete first (most restrictive)
  if (readiness.level === "not_ready" || overall < 4) {
    return "incomplete";
  }

  // Check for solid (highest quality)
  if (readiness.level === "ready" && overall >= 9) {
    return "solid";
  }

  // Check for good
  if (readiness.level === "ready" && overall >= 7) {
    return "good";
  }

  // Default to needs_strengthening
  return "needs_strengthening";
}

function generateSummary(
  level: DecisionQualityLevel,
  context: {
    quality: CEEQualityMeta;
    readiness: { level: string; score: number };
    issues: string[];
    missingBaselineCount?: number;
    fragileEdgeCount?: number;
  }
): string {
  const { quality, issues, missingBaselineCount, fragileEdgeCount } = context;
  const details = quality.details;

  switch (level) {
    case "incomplete": {
      // Prioritize specific issues
      if (missingBaselineCount && missingBaselineCount > 0) {
        return QUALITY_SUMMARIES.incomplete.missing_baselines(missingBaselineCount);
      }
      if (details?.option_count === 0) {
        return QUALITY_SUMMARIES.incomplete.no_options;
      }
      if (details?.outcome_count === 0) {
        return QUALITY_SUMMARIES.incomplete.disconnected_outcomes;
      }
      if ((quality.coverage ?? 5) < 4) {
        return QUALITY_SUMMARIES.incomplete.low_coverage;
      }
      return QUALITY_SUMMARIES.incomplete.default;
    }

    case "needs_strengthening": {
      // Check for uniform weights (placeholder detection)
      const hasUniformWeightIssue = issues.some(
        (issue) =>
          issue.toLowerCase().includes("uniform") ||
          issue.toLowerCase().includes("placeholder") ||
          issue.toLowerCase().includes("default")
      );
      if (hasUniformWeightIssue) {
        return QUALITY_SUMMARIES.needs_strengthening.uniform_weights;
      }

      // Check for fragile edges
      if (fragileEdgeCount && fragileEdgeCount > 0) {
        return QUALITY_SUMMARIES.needs_strengthening.fragile_recommendation(fragileEdgeCount);
      }

      // Check for low risk coverage
      const riskCount = typeof details?.risk_count === "number" ? details.risk_count : undefined;
      const optionCount = typeof details?.option_count === "number" ? details.option_count : 0;
      if (riskCount === 0 && optionCount >= 2) {
        return QUALITY_SUMMARIES.needs_strengthening.low_risk_coverage;
      }

      // Check for low confidence
      if ((quality.overall ?? 5) < 6) {
        return QUALITY_SUMMARIES.needs_strengthening.low_confidence;
      }

      return QUALITY_SUMMARIES.needs_strengthening.default;
    }

    case "good":
      return QUALITY_SUMMARIES.good.default;

    case "solid":
      return QUALITY_SUMMARIES.solid.default;

    default:
      return QUALITY_SUMMARIES.needs_strengthening.default;
  }
}

/**
 * Count factor nodes missing baseline values in a graph.
 */
export function countMissingBaselines(
  graph: { nodes: Array<{ kind: string; observed_state?: { value?: number } }> } | undefined
): number {
  if (!graph?.nodes) return 0;

  const factorNodes = graph.nodes.filter((n) => n.kind === "factor");
  return factorNodes.filter((n) => {
    const value = n.observed_state?.value;
    return value === undefined || value === null;
  }).length;
}
