/**
 * Readiness assessor for /assist/v1/review endpoint
 *
 * Computes overall readiness score and level for a decision model
 * M1: Deterministic heuristics
 * M2+: Will add LLM-enhanced assessment
 */

import { randomUUID } from "node:crypto";
import type { GraphT, NodeT } from "../../schemas/graph.js";
import type { ReviewBlockT } from "../../schemas/review.js";

// =============================================================================
// Types
// =============================================================================

export type ReadinessLevel = "ready" | "caution" | "not_ready";

export interface ReadinessFactors {
  /** Completeness of the model (0-1) */
  completeness: number;
  /** Structural quality (0-1) */
  structure: number;
  /** Evidence coverage (0-1) */
  evidence: number;
  /** Bias risk (0-1, lower is better) */
  bias_risk: number;
}

export interface ReadinessAssessment {
  level: ReadinessLevel;
  score: number;
  factors: ReadinessFactors;
  summary: string;
  recommendations: string[];
}

export interface ReadinessContext {
  graph: GraphT;
  brief: string;
  blocks: ReviewBlockT[];
  requestId: string;
}

// =============================================================================
// Thresholds
// =============================================================================

const THRESHOLDS = {
  /** Score >= 0.7 is ready */
  ready: 0.7,
  /** Score >= 0.4 is caution */
  caution: 0.4,
  /** Score < 0.4 is not_ready */
};

const WEIGHTS = {
  completeness: 0.35,
  structure: 0.30,
  evidence: 0.20,
  bias_risk: 0.15,
};

// =============================================================================
// Factor Scoring
// =============================================================================

/**
 * Score model completeness based on required node types and counts
 */
function scoreCompleteness(graph: GraphT): number {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    counts[node.kind] = (counts[node.kind] || 0) + 1;
  }

  let score = 0;
  const total = 4; // goal, decision, option, factor/outcome

  // Goal present (25%)
  if (counts.goal && counts.goal >= 1) {
    score += 0.25;
  }

  // Decision present (25%)
  if (counts.decision && counts.decision >= 1) {
    score += 0.25;
  }

  // Multiple options (25%)
  if (counts.option && counts.option >= 2) {
    score += 0.25;
  } else if (counts.option && counts.option >= 1) {
    score += 0.15;
  }

  // Factors or outcomes (25%)
  const factorOutcomeCount = (counts.factor || 0) + (counts.outcome || 0);
  if (factorOutcomeCount >= 3) {
    score += 0.25;
  } else if (factorOutcomeCount >= 1) {
    score += 0.15;
  }

  return Math.min(1, score);
}

/**
 * Score structural quality based on connectivity and DAG properties
 */
function scoreStructure(graph: GraphT): number {
  if (graph.nodes.length === 0) return 0;
  if (graph.edges.length === 0 && graph.nodes.length > 1) return 0.2;

  let score = 0.5; // Base score for having nodes and edges

  // Check connectivity
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const orphanRatio = graph.nodes.length > 0
    ? (graph.nodes.length - connected.size) / graph.nodes.length
    : 0;

  // Penalize orphan nodes
  score -= orphanRatio * 0.3;

  // Check for cycles (simplistic: if edge count > node count, likely has cycles)
  const cycleRisk = graph.edges.length > graph.nodes.length * 2 ? 0.2 : 0;
  score -= cycleRisk;

  // Bonus for having edges from factors to decisions/outcomes
  const factors = graph.nodes.filter((n) => n.kind === "factor").map((n) => n.id);
  const factorEdges = graph.edges.filter((e) => factors.includes(e.from));
  if (factorEdges.length > 0) {
    score += 0.2;
  }

  // Bonus for decision-option edges
  const decisions = graph.nodes.filter((n) => n.kind === "decision").map((n) => n.id);
  const options = graph.nodes.filter((n) => n.kind === "option").map((n) => n.id);
  const decisionOptionEdges = graph.edges.filter(
    (e) => (decisions.includes(e.from) && options.includes(e.to)) ||
           (options.includes(e.from) && decisions.includes(e.to))
  );
  if (decisionOptionEdges.length > 0) {
    score += 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Score evidence coverage based on factor data and provenance
 */
function scoreEvidence(graph: GraphT): number {
  const factors = graph.nodes.filter((n) => n.kind === "factor");
  if (factors.length === 0) return 0.5; // No factors to evaluate

  let score = 0.3; // Base score

  // Check for factors with data
  const factorsWithData = factors.filter((f) => f.data);
  const dataRatio = factors.length > 0 ? factorsWithData.length / factors.length : 0;
  score += dataRatio * 0.4;

  // Check for edges with provenance
  const edgesWithProvenance = graph.edges.filter(
    (e) => e.provenance !== undefined && e.provenance !== null
  );
  const provenanceRatio = graph.edges.length > 0
    ? edgesWithProvenance.length / graph.edges.length
    : 0;
  score += provenanceRatio * 0.3;

  return Math.min(1, score);
}

/**
 * Score bias risk based on biases block findings
 */
function scoreBiasRisk(blocks: ReviewBlockT[]): number {
  const biasBlock = blocks.find((b) => b.type === "biases");
  if (!biasBlock || biasBlock.type !== "biases") return 0.3; // Medium risk if no check

  const findings = biasBlock.findings || [];
  if (findings.length === 0) return 0; // No biases found

  // Score based on severity
  let riskScore = 0;
  for (const finding of findings) {
    switch (finding.severity) {
      case "high":
        riskScore += 0.4;
        break;
      case "medium":
        riskScore += 0.2;
        break;
      case "low":
        riskScore += 0.1;
        break;
    }
  }

  return Math.min(1, riskScore);
}

// =============================================================================
// Recommendation Generation
// =============================================================================

function generateRecommendations(
  factors: ReadinessFactors,
  graph: GraphT,
  blocks: ReviewBlockT[]
): string[] {
  const recommendations: string[] = [];

  // Completeness recommendations
  if (factors.completeness < 0.5) {
    const counts: Record<string, number> = {};
    for (const node of graph.nodes) {
      counts[node.kind] = (counts[node.kind] || 0) + 1;
    }

    if (!counts.goal) {
      recommendations.push("Add a goal node to define what you're trying to achieve.");
    }
    if (!counts.decision) {
      recommendations.push("Add a decision node to represent the choice being made.");
    }
    if (!counts.option || counts.option < 2) {
      recommendations.push("Add at least 2 option nodes to compare alternatives.");
    }
  }

  // Structure recommendations
  if (factors.structure < 0.5) {
    if (graph.edges.length === 0) {
      recommendations.push("Connect nodes with edges to show causal relationships.");
    } else {
      recommendations.push("Review graph structure for disconnected or orphan nodes.");
    }
  }

  // Evidence recommendations
  if (factors.evidence < 0.5) {
    recommendations.push("Add quantitative data to factor nodes for better analysis.");
    recommendations.push("Include provenance for edge relationships to track assumptions.");
  }

  // Bias recommendations
  if (factors.bias_risk > 0.5) {
    const biasBlock = blocks.find((b) => b.type === "biases");
    if (biasBlock && biasBlock.type === "biases") {
      const highSeverity = biasBlock.findings.filter((f) => f.severity === "high");
      for (const finding of highSeverity.slice(0, 2)) {
        if (finding.mitigation_hint) {
          recommendations.push(finding.mitigation_hint);
        }
      }
    }
  }

  // Limit to top 5 recommendations
  return recommendations.slice(0, 5);
}

// =============================================================================
// Summary Generation
// =============================================================================

function generateSummary(level: ReadinessLevel, factors: ReadinessFactors): string {
  switch (level) {
    case "ready":
      return "The decision model is well-structured and ready for analysis. Minor improvements may still be valuable.";
    case "caution":
      if (factors.completeness < 0.5) {
        return "The model needs additional nodes to be complete. Add missing elements before proceeding.";
      }
      if (factors.structure < 0.5) {
        return "The model structure has issues. Review connections between nodes.";
      }
      if (factors.evidence < 0.5) {
        return "The model lacks sufficient evidence. Consider adding data and provenance.";
      }
      if (factors.bias_risk > 0.5) {
        return "Potential biases detected. Review and address before making decisions.";
      }
      return "The model needs some improvements before analysis. Review the recommendations.";
    case "not_ready":
      return "The model is not ready for analysis. Address the critical issues listed in recommendations.";
  }
}

// =============================================================================
// Main Assessment
// =============================================================================

/**
 * Assess the readiness of a decision model
 */
export function assessReadiness(ctx: ReadinessContext): ReadinessAssessment {
  const { graph, blocks } = ctx;

  // Calculate factor scores
  const factors: ReadinessFactors = {
    completeness: scoreCompleteness(graph),
    structure: scoreStructure(graph),
    evidence: scoreEvidence(graph),
    bias_risk: scoreBiasRisk(blocks),
  };

  // Calculate weighted score (bias_risk is inverted since lower is better)
  const score =
    factors.completeness * WEIGHTS.completeness +
    factors.structure * WEIGHTS.structure +
    factors.evidence * WEIGHTS.evidence +
    (1 - factors.bias_risk) * WEIGHTS.bias_risk;

  // Determine level
  let level: ReadinessLevel;
  if (score >= THRESHOLDS.ready) {
    level = "ready";
  } else if (score >= THRESHOLDS.caution) {
    level = "caution";
  } else {
    level = "not_ready";
  }

  // Generate recommendations
  const recommendations = generateRecommendations(factors, graph, blocks);

  // Generate summary
  const summary = generateSummary(level, factors);

  return {
    level,
    score: Math.round(score * 100) / 100,
    factors: {
      completeness: Math.round(factors.completeness * 100) / 100,
      structure: Math.round(factors.structure * 100) / 100,
      evidence: Math.round(factors.evidence * 100) / 100,
      bias_risk: Math.round(factors.bias_risk * 100) / 100,
    },
    summary,
    recommendations,
  };
}

/**
 * Build readiness block for review response
 */
export function buildReadinessBlock(ctx: ReadinessContext): {
  block: ReviewBlockT;
  assessment: ReadinessAssessment;
} {
  const assessment = assessReadiness(ctx);

  const block: ReviewBlockT = {
    id: "next_steps",
    type: "next_steps" as const,
    generated_at: new Date().toISOString(),
    placeholder: true,
    level: assessment.level,
    score: assessment.score,
    factors: assessment.factors,
    summary: assessment.summary,
    recommendations: assessment.recommendations,
  };

  return { block, assessment };
}

// =============================================================================
// Exports for Testing
// =============================================================================

export const __test_only = {
  scoreCompleteness,
  scoreStructure,
  scoreEvidence,
  scoreBiasRisk,
  generateRecommendations,
  generateSummary,
  THRESHOLDS,
  WEIGHTS,
};
