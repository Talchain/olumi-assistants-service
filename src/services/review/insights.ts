/**
 * Insights Aggregator
 *
 * Aggregates insights from multiple CEE sources into a unified format
 * for the Results Panel. Sources include:
 * - Robustness synthesis (fragile assumptions)
 * - Bias detection (potential biases)
 * - Domain completeness (information gaps)
 * - Evidence quality (information gaps)
 */

import type { components } from "../../generated/openapi.d.ts";
import type { AssumptionExplanation } from "../../schemas/review.js";
import type {
  DomainCompletenessResult,
  EvidenceQualityDistribution,
} from "../../cee/graph-readiness/types.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];

export type InsightType = "fragile_assumption" | "potential_bias" | "information_gap";
export type InsightSeverity = "low" | "medium" | "high";

export interface Insight {
  type: InsightType;
  content: string;
  severity?: InsightSeverity;
}

export interface InsightsContext {
  /** Assumption explanations from robustness synthesis */
  assumptionExplanations?: Array<{
    edge_id: string;
    explanation: string;
    severity: "fragile" | "moderate" | "robust";
  }>;
  /** Bias findings from detectBiases() */
  biasFindings?: CEEBiasFindingV1[];
  /** Domain completeness analysis */
  domainCompleteness?: DomainCompletenessResult;
  /** Evidence quality distribution */
  evidenceQuality?: EvidenceQualityDistribution;
}

const MAX_INSIGHTS = 5;
const MAX_BIAS_INSIGHTS = 2;
const MAX_GAP_INSIGHTS = 2;

/**
 * Aggregate insights from multiple sources into a unified list.
 * Returns at most 5 insights, prioritized by severity and type.
 */
export function aggregateInsights(context: InsightsContext): Insight[] {
  const insights: Insight[] = [];

  // 1. Fragile assumptions (highest priority)
  const fragileAssumptions = mapFragileAssumptions(context.assumptionExplanations);
  insights.push(...fragileAssumptions);

  // 2. Potential biases (high priority)
  const biasInsights = mapBiasInsights(context.biasFindings);
  insights.push(...biasInsights);

  // 3. Information gaps (medium priority)
  const gapInsights = mapInformationGaps(
    context.domainCompleteness,
    context.evidenceQuality
  );
  insights.push(...gapInsights);

  // Prioritize by severity and return top 5
  return prioritizeInsights(insights).slice(0, MAX_INSIGHTS);
}

/**
 * Map fragile assumptions from robustness synthesis to insights.
 */
function mapFragileAssumptions(
  explanations?: InsightsContext["assumptionExplanations"]
): Insight[] {
  if (!explanations || explanations.length === 0) return [];

  return explanations.map((exp) => ({
    type: "fragile_assumption" as const,
    content: exp.explanation,
    severity: mapAssumptionSeverity(exp.severity),
  }));
}

/**
 * Map assumption severity to insight severity.
 */
function mapAssumptionSeverity(
  severity: "fragile" | "moderate" | "robust"
): InsightSeverity {
  switch (severity) {
    case "fragile":
      return "high";
    case "moderate":
      return "medium";
    case "robust":
      return "low";
    default:
      return "medium";
  }
}

/**
 * Map bias findings to insights.
 * Only includes high and medium severity biases, max 2.
 */
function mapBiasInsights(findings?: CEEBiasFindingV1[]): Insight[] {
  if (!findings || findings.length === 0) return [];

  return findings
    .filter((f) => (f.severity === "high" || f.severity === "medium") && f.explanation)
    .slice(0, MAX_BIAS_INSIGHTS)
    .map((f) => ({
      type: "potential_bias" as const,
      content: f.explanation!, // Guaranteed by filter above
      severity: f.severity as InsightSeverity,
    }));
}

/**
 * Map domain completeness and evidence quality to information gap insights.
 */
function mapInformationGaps(
  domain?: DomainCompletenessResult,
  evidence?: EvidenceQualityDistribution
): Insight[] {
  const gaps: Insight[] = [];

  // Missing critical domain factors
  if (domain?.missing_factors) {
    const criticalMissing = domain.missing_factors.filter(
      (f) => f.importance === "critical"
    );

    criticalMissing.slice(0, MAX_GAP_INSIGHTS).forEach((f) => {
      gaps.push({
        type: "information_gap",
        content: `Missing factor: ${f.name} — ${f.rationale}`,
        severity: "medium",
      });
    });
  }

  // Weak evidence coverage
  if (evidence && gaps.length < MAX_GAP_INSIGHTS) {
    const totalWithEvidence = evidence.strong + evidence.moderate;
    const totalWeak = evidence.weak + evidence.none;

    if (totalWeak > totalWithEvidence && totalWeak > 2) {
      gaps.push({
        type: "information_gap",
        content: "Most relationships lack strong evidence backing",
        severity: "low",
      });
    }
  }

  return gaps;
}

/**
 * Prioritize insights by severity, then by type.
 * Order: high severity first, then medium, then low.
 * Within same severity: fragile_assumption > potential_bias > information_gap
 */
function prioritizeInsights(insights: Insight[]): Insight[] {
  const severityOrder: Record<InsightSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const typeOrder: Record<InsightType, number> = {
    fragile_assumption: 0,
    potential_bias: 1,
    information_gap: 2,
  };

  return [...insights].sort((a, b) => {
    // Sort by severity first (high = 0, medium = 1, low = 2)
    const severityA = severityOrder[a.severity ?? "medium"];
    const severityB = severityOrder[b.severity ?? "medium"];

    if (severityA !== severityB) {
      return severityA - severityB;
    }

    // Then by type
    return typeOrder[a.type] - typeOrder[b.type];
  });
}
