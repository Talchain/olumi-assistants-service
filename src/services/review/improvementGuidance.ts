/**
 * Improvement Guidance Generator
 *
 * Aggregates actionable improvement recommendations from multiple CEE sources
 * for the Results Panel. Sources include:
 * - Missing baseline values on factor nodes
 * - Fragile edges from robustness analysis
 * - Bias mitigations from bias detection
 * - Structural recommendations from factor analysis
 */

import type { components } from "../../generated/openapi.d.ts";
import type { KeyAssumptionsResult } from "../../cee/graph-readiness/types.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];

export type ImprovementSource = "missing_baseline" | "fragile_edge" | "bias" | "structure";

export interface ImprovementGuidanceItem {
  priority: number; // 1-5 (1 = highest)
  action: string;
  reason: string;
  source: ImprovementSource;
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
}

const MAX_GUIDANCE_ITEMS = 5;
const MAX_MISSING_BASELINE_ITEMS = 2;
const MAX_BIAS_ITEMS = 2;

/**
 * Generate prioritized improvement guidance from multiple sources.
 * Returns at most 5 items, prioritized by impact and actionability.
 */
export function generateImprovementGuidance(
  context: ImprovementGuidanceContext
): ImprovementGuidanceItem[] {
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

  // Prioritize and dedupe
  return prioritizeAndDedupe(items).slice(0, MAX_GUIDANCE_ITEMS);
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

  return missing.slice(0, MAX_MISSING_BASELINE_ITEMS).map((node, idx) => ({
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
