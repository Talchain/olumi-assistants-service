/**
 * Improvement Guidance Generator
 *
 * Aggregates actionable improvement recommendations from multiple CEE sources
 * for the Results Panel. Sources include:
 * - Missing baseline values on factor nodes
 * - Fragile edges from robustness analysis
 * - Bias mitigations from bias detection
 * - Structural recommendations from factor analysis
 * - Readiness recommendations (for caution/not_ready states)
 */

import type { components } from "../../generated/openapi.d.ts";
import type { KeyAssumptionsResult } from "../../cee/graph-readiness/types.js";
import type { ReadinessAssessment } from "./readinessAssessor.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];

export type ImprovementSource = "missing_baseline" | "fragile_edge" | "bias" | "structure" | "readiness";

export interface ImprovementGuidanceItem {
  priority: number; // 1-5 (1 = highest)
  action: string;
  reason: string;
  source: ImprovementSource;
}

/**
 * Result of improvement guidance generation with metadata
 */
export interface ImprovementGuidanceResult {
  items: ImprovementGuidanceItem[];
  /** True when more items were available but capped at MAX_GUIDANCE_ITEMS */
  truncated: boolean;
  /** Number of items before truncation */
  total_available: number;
}

export interface ImprovementGuidanceContext {
  /** Graph with nodes to analyze for missing baselines */
  graph?: {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      observed_state?: { value?: number };
    }>;
  };
  /** Investigation suggestions from robustness synthesis */
  investigationSuggestions?: Array<{
    factor_id: string;
    factor_label?: string;
    elasticity: number;
    rationale?: string;
  }>;
  /** Key assumptions from graph readiness analysis */
  keyAssumptions?: KeyAssumptionsResult;
  /** Factor recommendations from readiness analysis */
  factorRecommendations?: Array<{
    factor_id: string;
    recommendation: string;
    issues: string[];
  }>;
  /** Bias findings with micro-interventions */
  biasFindings?: CEEBiasFindingV1[];
  /** Readiness assessment for ensuring minimum guidance when not ready */
  readiness?: ReadinessAssessment;
}

const MAX_GUIDANCE_ITEMS = 5;
const MAX_MISSING_BASELINE_ITEMS = 2;
const MAX_BIAS_ITEMS = 2;
const MAX_READINESS_ITEMS = 2;

/**
 * Generate prioritized improvement guidance from multiple sources.
 * Returns at most 5 items, prioritized by impact and actionability.
 *
 * IMPORTANT: When readiness.level is "caution" or "not_ready" and no
 * other guidance is available, this function will inject readiness
 * recommendations to ensure users always have actionable next steps.
 */
export function generateImprovementGuidance(
  context: ImprovementGuidanceContext
): ImprovementGuidanceResult {
  const items: ImprovementGuidanceItem[] = [];

  // 1. Missing baselines (highest priority if present)
  const missingBaselines = detectMissingBaselines(context.graph);
  items.push(...missingBaselines);

  // 2. Fragile edges from robustness data
  const fragileEdges = mapInvestigationSuggestions(context.investigationSuggestions);
  items.push(...fragileEdges);

  // 3. Bias mitigations
  const biasMitigations = mapBiasMitigations(context.biasFindings);
  items.push(...biasMitigations);

  // 4. Structural improvements from factor recommendations
  const structuralImprovements = mapFactorRecommendations(context.factorRecommendations);
  items.push(...structuralImprovements);

  // 5. Readiness recommendations (fallback for caution/not_ready)
  // Only inject if readiness indicates issues AND we have few/no items
  const readinessItems = mapReadinessRecommendations(context.readiness, items.length);
  items.push(...readinessItems);

  // Prioritize and dedupe
  const dedupedItems = prioritizeAndDedupe(items);
  const totalAvailable = dedupedItems.length;
  const truncated = totalAvailable > MAX_GUIDANCE_ITEMS;
  const finalItems = dedupedItems.slice(0, MAX_GUIDANCE_ITEMS);

  // Ensure minimum guidance rule: if readiness is caution/not_ready and
  // guidance array is empty, inject at least one blocker-derived action
  if (finalItems.length === 0 && context.readiness) {
    const minGuidance = ensureMinimumGuidance(context.readiness);
    if (minGuidance) {
      finalItems.push(minGuidance);
    }
  }

  return {
    items: finalItems,
    truncated,
    total_available: totalAvailable,
  };
}

/**
 * Legacy function signature for backward compatibility.
 * Returns just the items array.
 */
export function generateImprovementGuidanceItems(
  context: ImprovementGuidanceContext
): ImprovementGuidanceItem[] {
  return generateImprovementGuidance(context).items;
}

/**
 * Detect factor nodes missing baseline values.
 */
function detectMissingBaselines(
  graph?: ImprovementGuidanceContext["graph"]
): ImprovementGuidanceItem[] {
  if (!graph?.nodes) return [];

  const factorNodes = graph.nodes.filter((n) => n.kind === "factor");
  const missing = factorNodes.filter((n) => {
    const value = n.observed_state?.value;
    return value === undefined || value === null;
  });

  return missing.slice(0, MAX_MISSING_BASELINE_ITEMS).map((node, _idx) => ({
    priority: 1, // Highest priority
    action: `Add baseline value for "${node.label}"`,
    reason: "Factor has no current estimate — analysis assumes default",
    source: "missing_baseline" as const,
  }));
}

/**
 * Map investigation suggestions from robustness synthesis to guidance items.
 */
function mapInvestigationSuggestions(
  suggestions?: ImprovementGuidanceContext["investigationSuggestions"]
): ImprovementGuidanceItem[] {
  if (!suggestions || suggestions.length === 0) return [];

  return suggestions.slice(0, 2).map((s, idx) => {
    const factorName = s.factor_label || s.factor_id.replace("fac_", "").replace(/_/g, " ");
    const isHighInfluence = s.elasticity >= 0.5;

    return {
      priority: 2 + idx, // After missing baselines
      action: `Validate your "${factorName}" estimate`,
      reason: isHighInfluence
        ? "High influence factor — small changes significantly affect outcome"
        : "Moderate influence — worth confirming your assumption",
      source: "fragile_edge" as const,
    };
  });
}

/**
 * Map bias findings with micro-interventions to guidance items.
 */
function mapBiasMitigations(
  findings?: CEEBiasFindingV1[]
): ImprovementGuidanceItem[] {
  if (!findings || findings.length === 0) return [];

  return findings
    .filter((f): f is CEEBiasFindingV1 & { micro_intervention: { steps: [string, ...string[]] } } =>
      Boolean(f.micro_intervention?.steps && f.micro_intervention.steps.length > 0)
    )
    .slice(0, MAX_BIAS_ITEMS)
    .map((f) => ({
      priority: 3,
      action: f.micro_intervention.steps[0],
      reason: f.explanation || `Address potential ${f.category?.replace(/_/g, " ") || "bias"}`,
      source: "bias" as const,
    }));
}

/**
 * Map factor recommendations to structural improvement guidance.
 */
function mapFactorRecommendations(
  recommendations?: ImprovementGuidanceContext["factorRecommendations"]
): ImprovementGuidanceItem[] {
  if (!recommendations || recommendations.length === 0) return [];

  return recommendations.slice(0, 2).map((rec) => ({
    priority: 4,
    action: rec.recommendation,
    reason: rec.issues.join("; ") || "Structural improvement recommended",
    source: "structure" as const,
  }));
}

/**
 * Prioritize by priority number and deduplicate similar actions.
 */
function prioritizeAndDedupe(
  items: ImprovementGuidanceItem[]
): ImprovementGuidanceItem[] {
  // Sort by priority (lower = higher priority)
  const sorted = [...items].sort((a, b) => a.priority - b.priority);

  // Dedupe by similar action text (first 30 chars lowercase)
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const key = item.action.toLowerCase().slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Map readiness recommendations to guidance items.
 * Only injects if readiness is caution/not_ready AND we have few existing items.
 *
 * @param readiness - ReadinessAssessment from readinessAssessor
 * @param existingItemCount - Number of guidance items already collected
 */
function mapReadinessRecommendations(
  readiness: ImprovementGuidanceContext["readiness"],
  existingItemCount: number
): ImprovementGuidanceItem[] {
  if (!readiness) return [];

  // Only inject readiness recommendations if:
  // 1. Level is caution or not_ready
  // 2. We have few existing items (leave room for readiness guidance)
  const needsReadinessGuidance =
    (readiness.level === "caution" || readiness.level === "not_ready") &&
    existingItemCount < 3;

  if (!needsReadinessGuidance) return [];
  if (!readiness.recommendations || readiness.recommendations.length === 0) return [];

  // Convert readiness recommendations to guidance items
  // Priority 2 for not_ready (higher urgency), 3 for caution
  const basePriority = readiness.level === "not_ready" ? 2 : 3;

  return readiness.recommendations.slice(0, MAX_READINESS_ITEMS).map((rec, idx) => ({
    priority: basePriority + idx,
    action: rec,
    reason: readiness.level === "not_ready"
      ? "Critical: Model not ready for analysis"
      : "Model needs improvement before reliable analysis",
    source: "readiness" as const,
  }));
}

/**
 * Ensure minimum guidance when readiness indicates issues.
 * This is the last-resort fallback when all other sources produce no guidance.
 *
 * @param readiness - ReadinessAssessment from readinessAssessor
 * @returns A single guidance item or undefined
 */
function ensureMinimumGuidance(
  readiness: ReadinessAssessment
): ImprovementGuidanceItem | undefined {
  // Only apply to caution or not_ready states
  if (readiness.level === "ready") return undefined;

  // Try to use a recommendation first
  if (readiness.recommendations && readiness.recommendations.length > 0) {
    return {
      priority: 1,
      action: readiness.recommendations[0],
      reason: readiness.summary || "Model needs improvement",
      source: "readiness",
    };
  }

  // Fallback to summary-based guidance
  if (readiness.summary) {
    // Extract actionable hint from summary
    const action = readiness.level === "not_ready"
      ? "Address critical model issues before proceeding"
      : "Review model structure for potential improvements";

    return {
      priority: 1,
      action,
      reason: readiness.summary,
      source: "readiness",
    };
  }

  // Final fallback - generic guidance based on level
  if (readiness.level === "not_ready") {
    return {
      priority: 1,
      action: "Complete the decision model before analysis",
      reason: "Model is missing key elements required for reliable analysis",
      source: "readiness",
    };
  }

  return undefined;
}
