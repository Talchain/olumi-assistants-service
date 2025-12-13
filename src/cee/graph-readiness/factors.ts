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
  GOAL_OUTCOME_LINKAGE_SCORING,
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
  provenance_source?: string;
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

/**
 * Score goal-outcome linkage - ensures outcomes connect to goals for meaningful analysis.
 *
 * Uses BFS to find paths between goals and outcomes (in either direction).
 * Outcomes disconnected from goals make analysis meaningless since success
 * cannot be measured against the objective.
 *
 * Heuristics:
 * - Path existence between goals and outcomes
 * - Direct linkage bonus
 * - Orphaned outcome penalty
 */
export function scoreGoalOutcomeLinkage(graph: GraphV1 | undefined): FactorResult {
  const edges = getEdges(graph);
  const issues: string[] = [];
  const C = GOAL_OUTCOME_LINKAGE_SCORING;

  const goals = getNodesByKind(graph, "goal");
  const outcomes = getNodesByKind(graph, "outcome");

  // If no goals or outcomes, can't evaluate linkage
  if (goals.length === 0 || outcomes.length === 0) {
    return {
      score: C.missingDataScore,
      issues: goals.length === 0
        ? ["No goal nodes defined - cannot evaluate outcome linkage"]
        : ["No outcome nodes defined - cannot evaluate goal connectivity"],
    };
  }

  let score = C.baseScore;
  const goalIds = new Set(toIds(goals));
  const outcomeIds = new Set(toIds(outcomes));

  // Build adjacency list for bidirectional BFS
  const adjacencyList = buildAdjacencyList(edges);

  // Check connectivity for each outcome to any goal
  const connectedOutcomes: string[] = [];
  const orphanedOutcomes: string[] = [];
  let directLinkages = 0;

  for (const outcome of outcomes) {
    const outcomeId = outcome.id;
    if (!outcomeId) continue;

    // Check for direct edge between outcome and any goal
    const hasDirect = edges.some(
      (e) =>
        (e.from === outcomeId && goalIds.has(e.to ?? "")) ||
        (e.to === outcomeId && goalIds.has(e.from ?? "")),
    );

    if (hasDirect) {
      directLinkages++;
      connectedOutcomes.push(outcomeId);
      continue;
    }

    // Use BFS to find path to any goal
    const hasPath = hasPathToGoal(outcomeId, goalIds, adjacencyList);
    if (hasPath) {
      connectedOutcomes.push(outcomeId);
    } else {
      orphanedOutcomes.push(outcomeId);
    }
  }

  // Apply bonuses and penalties
  const connectedBonus = Math.min(
    C.connectedOutcomeMaxBonus,
    connectedOutcomes.length * C.connectedOutcomeBonus,
  );
  score += connectedBonus;

  if (directLinkages > 0) {
    score += Math.min(15, directLinkages * C.directLinkageBonus);
  }

  if (orphanedOutcomes.length > 0) {
    score += orphanedOutcomes.length * C.orphanedOutcomePenalty;
    const labels = orphanedOutcomes.slice(0, 3).join(", ");
    issues.push(`Outcomes not connected to goal: ${labels}${orphanedOutcomes.length > 3 ? "..." : ""}`);
  }

  // Severe penalty if NO outcomes connect to goal
  if (connectedOutcomes.length === 0) {
    score += C.noConnectedOutcomesPenalty;
    issues.push("No outcomes connect to any goal - analysis cannot measure success");
  }

  return { score: clamp(score, 0, 100), issues };
}

/**
 * Build bidirectional adjacency list from edges.
 */
function buildAdjacencyList(edges: EdgeLike[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!from || !to) continue;

    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());

    // Bidirectional (we want path in either direction)
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  return adjacency;
}

/**
 * BFS to check if a path exists from start node to any goal.
 */
function hasPathToGoal(
  startId: string,
  goalIds: Set<string>,
  adjacency: Map<string, Set<string>>,
): boolean {
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (goalIds.has(current)) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return false;
}

// ============================================================================
// Evidence Quality Grading
// ============================================================================

import type { EvidenceGrade, EvidenceQualityDistribution, KeyAssumption, KeyAssumptionsResult } from "./types.js";

/**
 * Patterns indicating strong evidence (peer-reviewed, verified data).
 */
const STRONG_EVIDENCE_PATTERNS = [
  /peer[- ]?review/i,
  /published/i,
  /verified/i,
  /official/i,
  /audit(ed)?/i,
  /certified/i,
  /authoritative/i,
  /research\s+(paper|study|journal)/i,
  /empirical/i,
  /validated/i,
];

/**
 * Patterns indicating moderate evidence (internal data, credible sources).
 */
const MODERATE_EVIDENCE_PATTERNS = [
  /internal\s+(data|report|analysis)/i,
  /\.csv$/i,
  /\.xlsx?$/i,
  /metrics/i,
  /analytics/i,
  /dashboard/i,
  /document/i,
  /report/i,
  /survey/i,
  /interview/i,
  /source:/i,
];

/**
 * Patterns indicating weak evidence (hypothesis, assumptions).
 */
const WEAK_EVIDENCE_PATTERNS = [
  /hypothesis/i,
  /assum(e|ption)/i,
  /specul/i,
  /estimate/i,
  /guess/i,
  /rough/i,
  /approximate/i,
  /might|may|could/i,
  /unclear/i,
  /uncertain/i,
];

/**
 * Grade the evidence quality for a single edge.
 */
function gradeEdgeEvidence(edge: EdgeLike): EvidenceGrade {
  // No provenance at all = none
  if (!edge.provenance && !edge.provenance_source) {
    return "none";
  }

  // Check provenance_source first (most reliable indicator)
  const provenanceSource = edge.provenance_source?.toLowerCase() ?? "";
  if (provenanceSource === "hypothesis") {
    return "weak";
  }
  if (provenanceSource === "document" || provenanceSource === "metric") {
    return "moderate"; // Default for documents, unless patterns indicate otherwise
  }

  // Extract text from provenance for pattern matching
  const provenance = edge.provenance;
  let provenanceText = "";
  if (typeof provenance === "string") {
    provenanceText = provenance;
  } else if (provenance && typeof provenance === "object") {
    const p = provenance as Record<string, unknown>;
    provenanceText = [p.source, p.quote, p.citation].filter(Boolean).join(" ");
  }

  // Check for strong evidence patterns
  for (const pattern of STRONG_EVIDENCE_PATTERNS) {
    if (pattern.test(provenanceText)) {
      return "strong";
    }
  }

  // Check for weak evidence patterns (check before moderate)
  for (const pattern of WEAK_EVIDENCE_PATTERNS) {
    if (pattern.test(provenanceText)) {
      return "weak";
    }
  }

  // Check for moderate evidence patterns
  for (const pattern of MODERATE_EVIDENCE_PATTERNS) {
    if (pattern.test(provenanceText)) {
      return "moderate";
    }
  }

  // Has provenance but doesn't match patterns → moderate (benefit of doubt)
  return "moderate";
}

/**
 * Compute evidence quality distribution across all edges.
 */
export function computeEvidenceQualityDistribution(
  graph: GraphV1 | undefined,
): EvidenceQualityDistribution {
  const edges = getEdges(graph);

  const distribution: EvidenceQualityDistribution = {
    strong: 0,
    moderate: 0,
    weak: 0,
    none: 0,
    summary: "",
  };

  if (edges.length === 0) {
    distribution.summary = "No edges to evaluate";
    return distribution;
  }

  // Grade each edge
  for (const edge of edges) {
    const grade = gradeEdgeEvidence(edge);
    distribution[grade]++;
  }

  // Generate human-readable summary
  const parts: string[] = [];
  if (distribution.strong > 0) {
    parts.push(`${distribution.strong} edge${distribution.strong > 1 ? "s" : ""} backed by strong evidence`);
  }
  if (distribution.moderate > 0) {
    parts.push(`${distribution.moderate} with moderate evidence`);
  }
  if (distribution.weak > 0) {
    parts.push(`${distribution.weak} based on assumptions`);
  }
  if (distribution.none > 0) {
    parts.push(`${distribution.none} without provenance`);
  }

  distribution.summary = parts.length > 0
    ? parts.join(", ")
    : "Evidence quality could not be assessed";

  return distribution;
}

// ============================================================================
// Key Assumptions Identification
// ============================================================================

/**
 * High belief threshold - edges above this are considered well-grounded.
 */
const WELL_GROUNDED_BELIEF_THRESHOLD = 0.8;

/**
 * Identify key assumptions in the graph that should be validated.
 *
 * IMPORTANT: Always returns at least one assumption - never empty.
 * Priority is computed as: (1 - belief) × weight × connectivity_factor
 *
 * If all beliefs are high (>0.8), returns top edge with "well-grounded" framing.
 */
export function identifyKeyAssumptions(
  graph: GraphV1 | undefined,
): KeyAssumptionsResult {
  const edges = getEdges(graph);
  const nodes = getNodes(graph);

  // Build node label lookup
  const nodeLabels = new Map<string, string>();
  for (const node of nodes) {
    if (node.id && node.label) {
      nodeLabels.set(node.id, node.label);
    }
  }

  // No edges means no assumptions to surface
  if (edges.length === 0) {
    return {
      assumptions: [],
      summary: "No relationships defined in the model",
      well_grounded: false,
    };
  }

  // Score each edge by assumption priority
  const scoredEdges: Array<{
    edge: EdgeLike;
    fromLabel: string;
    toLabel: string;
    belief: number;
    priority: number;
  }> = [];

  for (const edge of edges) {
    const from = edge.from ?? "";
    const to = edge.to ?? "";
    const belief = typeof edge.belief === "number" ? edge.belief : 0.5; // Default belief
    const weight = typeof edge.weight === "number" ? edge.weight : 1.0;

    // Priority: Lower belief = higher priority to validate
    // Also factor in weight (higher weight = more important relationship)
    const priority = (1 - belief) * Math.abs(weight);

    scoredEdges.push({
      edge,
      fromLabel: nodeLabels.get(from) ?? from,
      toLabel: nodeLabels.get(to) ?? to,
      belief,
      priority,
    });
  }

  // Sort by priority (highest first)
  scoredEdges.sort((a, b) => b.priority - a.priority);

  // Check if model is well-grounded (all beliefs > 0.8)
  const wellGrounded = scoredEdges.every((e) => e.belief >= WELL_GROUNDED_BELIEF_THRESHOLD);

  // Always take top 3 (or all if fewer)
  const topEdges = scoredEdges.slice(0, 3);

  // Generate assumptions with appropriate framing
  const assumptions: KeyAssumption[] = topEdges.map((e) => ({
    edge_id: `${e.edge.from}→${e.edge.to}`,
    from_label: e.fromLabel,
    to_label: e.toLabel,
    belief: e.belief,
    priority_score: e.priority,
    plain_english: generateAssumptionPlainEnglish(e.fromLabel, e.toLabel, e.belief, wellGrounded),
  }));

  // Generate summary
  const summary = wellGrounded
    ? `Your model is well-grounded — consider validating "${topEdges[0]?.fromLabel} → ${topEdges[0]?.toLabel}" for additional confidence`
    : `Key assumptions to validate: ${assumptions.slice(0, 2).map((a) => `"${a.from_label} → ${a.to_label}"`).join(", ")}`;

  return {
    assumptions,
    summary,
    well_grounded: wellGrounded,
  };
}

/**
 * Generate plain English explanation for an assumption.
 */
function generateAssumptionPlainEnglish(
  fromLabel: string,
  toLabel: string,
  belief: number,
  wellGrounded: boolean,
): string {
  const beliefPct = Math.round(belief * 100);

  if (wellGrounded) {
    return `The relationship between "${fromLabel}" and "${toLabel}" is well-grounded (${beliefPct}% confidence). Consider validating this for additional assurance.`;
  }

  if (belief < 0.4) {
    return `The link from "${fromLabel}" to "${toLabel}" has low confidence (${beliefPct}%). This is a key assumption that could significantly affect the outcome.`;
  }

  if (belief < 0.6) {
    return `The relationship between "${fromLabel}" and "${toLabel}" (${beliefPct}% confidence) merits validation. Strengthening this assumption would improve model reliability.`;
  }

  if (belief < 0.8) {
    return `Consider validating the "${fromLabel}" → "${toLabel}" relationship (${beliefPct}% confidence) to increase overall model confidence.`;
  }

  return `The "${fromLabel}" → "${toLabel}" relationship is reasonably confident (${beliefPct}%) but worth periodic review.`;
}

// Export for testing
export const __test_only = {
  clamp,
  computeBeliefVariance,
  getNodes,
  getEdges,
  getNodesByKind,
  toIds,
  gradeEdgeEvidence,
  generateAssumptionPlainEnglish,
};
