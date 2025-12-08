/**
 * Graph Readiness Factor Scoring Functions
 *
 * Each factor scoring function analyzes graph structure and returns
 * a score (0-100) along with detected issues for recommendation generation.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { FactorResult, GraphStats } from "./types.js";
import {
  CAUSAL_DETAIL_SCORING,
  WEIGHT_REFINEMENT_SCORING,
  RISK_COVERAGE_SCORING,
  OUTCOME_BALANCE_SCORING,
  OPTION_DIVERSITY_SCORING,
} from "./constants.js";

// ============================================================================
// Utility Functions
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute variance for belief values (already in 0-1 range).
 */
function computeBeliefVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

type NodeLike = { id?: string; kind?: string; label?: string } & Record<string, unknown>;
type EdgeLike = {
  from?: string;
  to?: string;
  weight?: number;
  belief?: number;
  provenance?: unknown;
} & Record<string, unknown>;

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

function getEdges(graph: GraphV1 | undefined): EdgeLike[] {
  if (!graph || !Array.isArray((graph as any).edges)) return [];
  return (graph as any).edges as EdgeLike[];
}

function getNodesByKind(graph: GraphV1 | undefined, kind: string): NodeLike[] {
  return getNodes(graph).filter((n) => n && n.kind === kind);
}

function toIds(nodes: NodeLike[]): string[] {
  return nodes
    .map((n) => n.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ============================================================================
// Graph Statistics
// ============================================================================

export function computeGraphStats(graph: GraphV1 | undefined): GraphStats {
  const nodes = getNodes(graph);
  const edges = getEdges(graph);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    optionCount: getNodesByKind(graph, "option").length,
    riskCount: getNodesByKind(graph, "risk").length,
    outcomeCount: getNodesByKind(graph, "outcome").length,
    goalCount: getNodesByKind(graph, "goal").length,
    decisionCount: getNodesByKind(graph, "decision").length,
    factorCount: getNodesByKind(graph, "factor").length,
    actionCount: getNodesByKind(graph, "action").length,
    evidenceCount: getNodesByKind(graph, "evidence").length,
  };
}

// ============================================================================
// Factor Scoring Functions
// ============================================================================

/**
 * Score causal detail - measures richness of cause-effect relationships.
 *
 * Heuristics:
 * - Edge density (edges per node)
 * - Belief coverage on edges
 * - Presence of provenance
 * - Outcome node connectivity
 */
export function scoreCausalDetail(graph: GraphV1 | undefined): FactorResult {
  const nodes = getNodes(graph);
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = CAUSAL_DETAIL_SCORING;

  let score = C.baseScore;

  // Check edge density (edges per node)
  const edgeDensity = nodes.length > 0 ? edges.length / nodes.length : 0;
  if (edgeDensity < C.edgeDensityThreshold) {
    score += C.edgeDensityPenalty;
    issues.push("Low edge density - nodes appear disconnected");
  } else if (edgeDensity >= C.edgeDensityBonusThreshold) {
    score += C.edgeDensityBonus;
  }

  // Check for edges with beliefs
  const edgesWithBeliefs = edges.filter(
    (e) => typeof e.belief === "number" && e.belief > 0 && e.belief < 1,
  ).length;
  const beliefCoverage = edges.length > 0 ? edgesWithBeliefs / edges.length : 0;
  if (beliefCoverage < C.beliefCoverageThreshold) {
    score += C.beliefCoveragePenalty;
    issues.push("Many edges lack belief values");
  } else if (beliefCoverage >= C.beliefCoverageBonusThreshold) {
    score += C.beliefCoverageBonus;
  }

  // Check for provenance on edges
  const edgesWithProvenance = edges.filter((e) => e.provenance).length;
  if (edgesWithProvenance > 0) {
    score += Math.min(C.provenanceMaxBonus, edgesWithProvenance * C.provenanceBonus);
  }

  // Check outcome node connectivity
  const outcomes = getNodesByKind(graph, "outcome");
  const connectedOutcomes = outcomes.filter((o) =>
    edges.some((e) => e.to === o.id || e.from === o.id),
  ).length;
  if (outcomes.length > 0 && connectedOutcomes < outcomes.length) {
    score += C.disconnectedOutcomePenalty;
    issues.push("Some outcomes are not connected to options");
  }

  return { score: clamp(score, 0, 100), issues };
}

/**
 * Score weight refinement - detects uniform/placeholder belief values.
 *
 * Heuristics:
 * - Uniform distribution detection
 * - Default 0.5 value detection
 * - Extreme values without provenance
 * - Variance in belief values
 */
export function scoreWeightRefinement(graph: GraphV1 | undefined): FactorResult {
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = WEIGHT_REFINEMENT_SCORING;

  const beliefs = edges
    .map((e) => e.belief)
    .filter((b): b is number => typeof b === "number");

  if (beliefs.length === 0) {
    return { score: C.noBeliefsScore, issues: ["No belief values defined on edges"] };
  }

  let score = C.baseScore;

  // Check for uniform distribution (all same value)
  const uniqueBeliefs = new Set(beliefs.map((b) => b.toFixed(2)));
  if (uniqueBeliefs.size === 1 && beliefs.length > 2) {
    score += C.uniformBeliefsPenalty;
    issues.push("All beliefs have identical values (likely placeholders)");
  }

  // Check for default 0.5 values
  const defaultCount = beliefs.filter((b) => Math.abs(b - 0.5) < 0.01).length;
  const defaultRatio = defaultCount / beliefs.length;
  if (defaultRatio > C.defaultBeliefsThreshold) {
    score += C.defaultBeliefsPenalty;
    issues.push("Most beliefs are default 0.5 values");
  }

  // Check for extreme values (near 0 or 1 without provenance)
  const extremeEdges = edges.filter((e) => {
    const b = e.belief;
    return typeof b === "number" && (b < 0.1 || b > 0.9) && !e.provenance;
  });
  if (extremeEdges.length > 0) {
    score += C.extremeValuesPenalty;
    issues.push("Extreme belief values without supporting evidence");
  }

  // Reward variance (indicates thoughtful assignment)
  const variance = computeBeliefVariance(beliefs);
  if (variance > C.goodVarianceMin && variance < C.goodVarianceMax) {
    score += C.goodVarianceBonus;
  }

  return { score: clamp(score, 0, 100), issues };
}

/**
 * Score risk coverage - evaluates presence and distribution of risk nodes.
 *
 * Heuristics:
 * - Risk-to-option ratio
 * - Risk connectivity to options
 */
export function scoreRiskCoverage(graph: GraphV1 | undefined): FactorResult {
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = RISK_COVERAGE_SCORING;

  const options = getNodesByKind(graph, "option");
  const risks = getNodesByKind(graph, "risk");

  if (options.length === 0) {
    return { score: C.noOptionsScore, issues: ["No options defined"] };
  }

  if (risks.length === 0) {
    return {
      score: C.noRisksScore,
      issues: ["No risk nodes defined - consider potential downsides"],
    };
  }

  let score = C.baseScore;

  // Check risk-to-option ratio
  const riskRatio = risks.length / options.length;
  if (riskRatio < C.lowRiskRatioThreshold) {
    score += C.lowRiskRatioPenalty;
    issues.push("Few risks relative to options");
  } else if (riskRatio >= C.goodRiskRatioThreshold) {
    score += C.goodRiskRatioBonus;
  }

  // Check risk connectivity to options
  const optionIds = new Set(toIds(options));
  const connectedRisks = risks.filter((r) =>
    edges.some(
      (e) =>
        (e.from === r.id && optionIds.has(e.to ?? "")) ||
        (e.to === r.id && optionIds.has(e.from ?? "")),
    ),
  );
  if (connectedRisks.length < risks.length) {
    score += C.disconnectedRiskPenalty;
    issues.push("Some risks are not connected to options");
  }

  return { score: clamp(score, 0, 100), issues };
}

/**
 * Score outcome balance - ensures outcomes are evenly distributed across options.
 *
 * Heuristics:
 * - Options with no outcomes
 * - Balance of outcome distribution
 * - Average outcomes per option
 */
export function scoreOutcomeBalance(graph: GraphV1 | undefined): FactorResult {
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = OUTCOME_BALANCE_SCORING;

  const options = getNodesByKind(graph, "option");
  const outcomes = getNodesByKind(graph, "outcome");

  if (options.length === 0 || outcomes.length === 0) {
    return {
      score: C.missingDataScore,
      issues: ["Missing options or outcomes for balance analysis"],
    };
  }

  let score = C.baseScore;
  const outcomeIds = new Set(toIds(outcomes));

  // Count outcomes per option
  const outcomesPerOption = options.map((opt) => {
    return edges.filter(
      (e) => e.from === opt.id && outcomeIds.has(e.to ?? ""),
    ).length;
  });

  // Check for options with no outcomes
  const optionsWithoutOutcomes = outcomesPerOption.filter((c) => c === 0).length;
  if (optionsWithoutOutcomes > 0) {
    score += C.noOutcomesPenalty;
    issues.push(`${optionsWithoutOutcomes} option(s) have no connected outcomes`);
  }

  // Check balance (variance in outcome counts)
  const nonZeroCounts = outcomesPerOption.filter((c) => c > 0);
  if (nonZeroCounts.length >= 2) {
    const max = Math.max(...nonZeroCounts);
    const min = Math.min(...nonZeroCounts);
    if (max > min * C.unevenDistributionThreshold && max > 2) {
      score += C.unevenDistributionPenalty;
      issues.push("Options have uneven outcome coverage (potential confirmation bias)");
    }
  }

  // Reward multiple outcomes per option
  const avgOutcomes =
    outcomesPerOption.reduce((a, b) => a + b, 0) / options.length;
  if (avgOutcomes >= C.goodOutcomeCountThreshold) {
    score += C.goodOutcomeCountBonus;
  }

  return { score: clamp(score, 0, 100), issues };
}

/**
 * Score option diversity - evaluates number and structural diversity of options.
 *
 * Heuristics:
 * - Option count (optimal: 3-5)
 * - Decision-to-option connectivity
 */
export function scoreOptionDiversity(graph: GraphV1 | undefined): FactorResult {
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = OPTION_DIVERSITY_SCORING;

  const options = getNodesByKind(graph, "option");
  const decisions = getNodesByKind(graph, "decision");

  if (options.length === 0) {
    return { score: C.noOptionsScore, issues: ["No options defined"] };
  }

  let score = C.baseScore;

  // Check option count
  if (options.length === 1) {
    score += C.singleOptionPenalty;
    issues.push("Only one option - consider alternatives");
  } else if (options.length === 2) {
    score += C.twoOptionsBonus;
  } else if (options.length >= C.optimalRangeMin && options.length <= C.optimalRangeMax) {
    score += C.optimalRangeBonus;
  } else if (options.length > C.optimalRangeMax) {
    score += C.manyOptionsBonus;
    issues.push("Many options - consider grouping related alternatives");
  }

  // Check decision-to-option connectivity
  if (decisions.length > 0) {
    const decisionIds = new Set(toIds(decisions));
    const connectedOptions = options.filter((opt) =>
      edges.some((e) => decisionIds.has(e.from ?? "") && e.to === opt.id),
    );
    if (connectedOptions.length < options.length) {
      score += C.disconnectedOptionPenalty;
      issues.push("Some options not connected to a decision node");
    }
  }

  return { score: clamp(score, 0, 100), issues };
}

// Export for testing
export const __test_only = {
  clamp,
  computeBeliefVariance,
  getNodes,
  getEdges,
  getNodesByKind,
  toIds,
};
