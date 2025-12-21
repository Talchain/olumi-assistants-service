/**
 * Block builders for /assist/v1/review endpoint
 *
 * M1: Deterministic placeholder logic - no LLM calls
 * M2+: Will add LLM-powered content generation
 *
 * Block type naming aligned with UI expectations:
 * - biases (formerly bias_check)
 * - recommendation (formerly options)
 * - drivers (formerly sensitivity_coach)
 * - gaps (formerly evidence_helper)
 * - prediction (formerly key_insight)
 * - risks (formerly structural_warnings)
 * - next_steps (formerly readiness)
 * - robustness (ISL sensitivity/uncertainty synthesis)
 */

import { randomUUID } from "node:crypto";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import type {
  ReviewBlockT,
  ReviewBlockTypeT,
} from "../../schemas/review.js";

// =============================================================================
// Types
// =============================================================================

export interface BlockBuilderContext {
  graph: GraphT;
  brief: string;
  requestId: string;
  inference?: {
    ranked_actions?: Array<{
      node_id: string;
      label: string;
      expected_utility: number;
      rank: number;
      dominant?: boolean;
    }>;
    top_drivers?: Array<{
      node_id: string;
      label: string;
      impact_pct?: number;
      direction?: "positive" | "negative" | "neutral";
    }>;
    summary?: string;
  };
  robustness?: {
    status: "computed" | "degraded" | "not_run" | "failed";
    status_reason?: string;
    overall_score?: number;
    confidence?: number;
    sensitivities?: Array<{
      node_id: string;
      label: string;
      sensitivity_score: number;
      classification: "low" | "medium" | "high";
      description?: string;
    }>;
    prediction_intervals?: Array<{
      node_id: string;
      lower_bound: number;
      upper_bound: number;
      confidence_level: number;
      well_calibrated: boolean;
    }>;
    critical_assumptions?: Array<{
      node_id: string;
      label: string;
      impact: number;
      recommendation?: string;
    }>;
  };
  seed?: string;
}

export interface BlockBuilderResult {
  block: ReviewBlockT;
  warnings?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

function generateBlockId(): string {
  return randomUUID();
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function getNodesByKind(graph: GraphT, kind: string): NodeT[] {
  return graph.nodes.filter((n) => n.kind === kind);
}

function countNodesByKind(graph: GraphT): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    counts[node.kind] = (counts[node.kind] || 0) + 1;
  }
  return counts;
}

function hasOrphanNodes(graph: GraphT): string[] {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return graph.nodes
    .filter((n) => !connected.has(n.id))
    .map((n) => n.id);
}

function detectCycles(graph: GraphT): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const from = adjacency.get(edge.from);
    if (from) {
      from.push(edge.to);
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);

    const neighbors = adjacency.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }

  return false;
}

// =============================================================================
// Block Builders
// =============================================================================

/**
 * Build biases block with deterministic placeholder findings
 */
export function buildBiasesBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph } = ctx;
  const findings: Array<{
    id: string;
    bias_type: string;
    severity: "low" | "medium" | "high";
    description: string;
    affected_nodes?: string[];
    mitigation_hint?: string;
  }> = [];

  // M1: Simple heuristic-based bias detection
  const options = getNodesByKind(graph, "option");
  const factors = getNodesByKind(graph, "factor");
  const outcomes = getNodesByKind(graph, "outcome");

  // Check for confirmation bias (too few options)
  if (options.length === 1) {
    findings.push({
      id: generateBlockId(),
      bias_type: "confirmation_bias",
      severity: "medium",
      description: "Only one option identified. Consider exploring alternatives.",
      affected_nodes: options.map((o) => o.id),
      mitigation_hint: "Add at least 2-3 alternative options to compare.",
    });
  }

  // Check for anchoring bias (unbalanced factor weights)
  if (factors.length > 0) {
    const edgesFromFactors = graph.edges.filter((e) =>
      factors.some((f) => f.id === e.from)
    );
    const highWeightEdges = edgesFromFactors.filter(
      (e) => typeof e.belief === "number" && e.belief > 0.9
    );
    if (highWeightEdges.length > factors.length * 0.5) {
      findings.push({
        id: generateBlockId(),
        bias_type: "anchoring_bias",
        severity: "low",
        description: "Many factors have very high weight. Consider if some should be lower.",
        mitigation_hint: "Review factor weights and consider if initial estimates are anchoring your judgment.",
      });
    }
  }

  // Check for outcome bias (missing negative outcomes)
  if (outcomes.length > 0) {
    const outcomeLabels = outcomes.map((o) => (o.label || "").toLowerCase());
    const hasNegativeOutcome = outcomeLabels.some(
      (l) => l.includes("risk") || l.includes("fail") || l.includes("loss") || l.includes("cost")
    );
    if (!hasNegativeOutcome) {
      findings.push({
        id: generateBlockId(),
        bias_type: "optimism_bias",
        severity: "low",
        description: "No negative outcomes identified. Consider potential downsides.",
        affected_nodes: outcomes.map((o) => o.id),
        mitigation_hint: "Add potential negative outcomes or risks to balance your analysis.",
      });
    }
  }

  // Calculate confidence based on graph completeness
  const confidence = Math.min(0.7, 0.4 + (graph.nodes.length * 0.03));

  return {
    block: {
      id: "biases",
      type: "biases" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      findings,
      confidence,
    },
  };
}

/**
 * Build recommendation block with placeholder suggestions
 */
export function buildRecommendationBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph, brief } = ctx;
  const existingOptions = getNodesByKind(graph, "option");

  const suggestions: Array<{
    id: string;
    label: string;
    description?: string;
    pros?: string[];
    cons?: string[];
  }> = [];

  // M1: Generate placeholder suggestions based on brief keywords
  const briefLower = brief.toLowerCase();

  if (existingOptions.length < 3) {
    // Suggest "do nothing" option if not present
    const hasDoNothing = existingOptions.some(
      (o) => (o.label || "").toLowerCase().includes("nothing") ||
             (o.label || "").toLowerCase().includes("status quo")
    );
    if (!hasDoNothing) {
      suggestions.push({
        id: generateBlockId(),
        label: "Status Quo",
        description: "Maintain current approach without changes",
        pros: ["No additional investment required", "Preserves stability"],
        cons: ["May miss opportunities", "Existing issues persist"],
      });
    }

    // Suggest hybrid option
    if (existingOptions.length >= 2) {
      suggestions.push({
        id: generateBlockId(),
        label: "Hybrid Approach",
        description: "Combine elements from existing options",
        pros: ["Balances competing concerns", "Reduces risk of single approach"],
        cons: ["May be more complex to implement", "Could dilute focus"],
      });
    }

    // Suggest pilot/experiment option
    if (briefLower.includes("decision") || briefLower.includes("choose")) {
      suggestions.push({
        id: generateBlockId(),
        label: "Pilot Program",
        description: "Test a small-scale implementation before full commitment",
        pros: ["Reduces risk", "Provides real data for decision"],
        cons: ["Delays full decision", "Requires additional resources"],
      });
    }
  }

  const confidence = suggestions.length > 0 ? 0.5 : 0.3;

  return {
    block: {
      id: "recommendation",
      type: "recommendation" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      suggestions,
      confidence,
    },
  };
}

/**
 * Build drivers block with placeholder suggestions
 */
export function buildDriversBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph, inference } = ctx;
  const suggestions: Array<{
    node_id: string;
    label: string;
    sensitivity: number;
    direction?: "positive" | "negative";
    impact_description?: string;
  }> = [];

  // M1: Use inference data if available, otherwise use heuristics
  if (inference?.top_drivers && inference.top_drivers.length > 0) {
    for (const driver of inference.top_drivers.slice(0, 5)) {
      suggestions.push({
        node_id: driver.node_id,
        label: driver.label,
        sensitivity: (driver.impact_pct || 50) / 100,
        direction: driver.direction === "positive" ? "positive" :
                   driver.direction === "negative" ? "negative" : undefined,
        impact_description: `This factor has ${driver.direction || "significant"} impact on the outcome.`,
      });
    }
  } else {
    // Fallback: identify factors with data
    const factors = getNodesByKind(graph, "factor").filter((f) => f.data);
    for (const factor of factors.slice(0, 3)) {
      const data = factor.data!;
      suggestions.push({
        node_id: factor.id,
        label: factor.label || factor.id,
        sensitivity: data.confidence || 0.5,
        direction: "positive",
        impact_description: `Consider how changes to ${factor.label || factor.id} affect the decision.`,
      });
    }
  }

  const confidence = suggestions.length > 0 ? 0.6 : 0.3;

  return {
    block: {
      id: "drivers",
      type: "drivers" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      suggestions,
      confidence,
    },
  };
}

/**
 * Build gaps block with placeholder suggestions
 */
export function buildGapsBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph } = ctx;
  const suggestions: Array<{
    id: string;
    type: "experiment" | "user_research" | "market_data" | "expert_opinion" | "other";
    description: string;
    priority?: "low" | "medium" | "high";
    target_nodes?: string[];
  }> = [];

  // M1: Suggest evidence based on node types present
  const factors = getNodesByKind(graph, "factor");
  const outcomes = getNodesByKind(graph, "outcome");

  // Check for factors without data
  const factorsWithoutData = factors.filter((f) => !f.data);
  if (factorsWithoutData.length > 0) {
    suggestions.push({
      id: generateBlockId(),
      type: "market_data",
      description: "Gather quantitative data for factors without measurements.",
      priority: "high",
      target_nodes: factorsWithoutData.slice(0, 3).map((f) => f.id),
    });
  }

  // Check for low-confidence edges
  const lowConfidenceEdges = graph.edges.filter(
    (e) => typeof e.belief === "number" && e.belief < 0.4
  );
  if (lowConfidenceEdges.length > 0) {
    suggestions.push({
      id: generateBlockId(),
      type: "expert_opinion",
      description: "Consult experts to validate uncertain causal relationships.",
      priority: "medium",
      target_nodes: [...new Set(lowConfidenceEdges.flatMap((e) => [e.from, e.to]))].slice(0, 5),
    });
  }

  // Generic suggestion for outcomes
  if (outcomes.length > 0) {
    suggestions.push({
      id: generateBlockId(),
      type: "user_research",
      description: "Validate outcome assumptions with stakeholder feedback.",
      priority: "medium",
      target_nodes: outcomes.slice(0, 3).map((o) => o.id),
    });
  }

  const confidence = 0.5;

  return {
    block: {
      id: "gaps",
      type: "gaps" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      suggestions,
      confidence,
    },
  };
}

/**
 * Build prediction block with placeholder headline
 */
export function buildPredictionBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph, inference } = ctx;

  let headline: string;
  let explanation: string | undefined;

  // M1: Generate headline based on inference or graph structure
  if (inference?.ranked_actions && inference.ranked_actions.length > 0) {
    const topAction = inference.ranked_actions[0];
    headline = `"${topAction.label}" appears to be the strongest option.`;
    explanation = inference.summary || `Based on the current model, ${topAction.label} has the highest expected utility.`;
  } else {
    const goals = getNodesByKind(graph, "goal");
    const options = getNodesByKind(graph, "option");

    if (goals.length > 0 && options.length > 0) {
      headline = `${options.length} options identified for achieving ${goals[0].label || "your goal"}.`;
      explanation = "Run inference to determine which option best achieves your goals.";
    } else if (goals.length === 0) {
      headline = "No clear goal identified in the model.";
      explanation = "Add a goal node to enable meaningful analysis.";
    } else {
      headline = "Model structure needs additional options to compare.";
      explanation = "Add option nodes representing the choices you're considering.";
    }
  }

  const confidence = inference?.ranked_actions ? 0.7 : 0.4;

  return {
    block: {
      id: "prediction",
      type: "prediction" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      headline,
      explanation,
      confidence,
    },
  };
}

/**
 * Build risks block
 */
export function buildRisksBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { graph } = ctx;
  const warnings: Array<{
    id: string;
    type: string;
    severity: "info" | "warning" | "error";
    message: string;
    affected_nodes?: string[];
    affected_edges?: string[];
  }> = [];

  // Check for orphan nodes
  const orphans = hasOrphanNodes(graph);
  if (orphans.length > 0) {
    warnings.push({
      id: generateBlockId(),
      type: "orphan_nodes",
      severity: "warning",
      message: `${orphans.length} node(s) are not connected to the graph.`,
      affected_nodes: orphans,
    });
  }

  // Check for cycles
  if (detectCycles(graph)) {
    warnings.push({
      id: generateBlockId(),
      type: "cycle_detected",
      severity: "warning",
      message: "Graph contains cycles. This may affect causal inference.",
    });
  }

  // Check for missing required node types
  const counts = countNodesByKind(graph);
  if (!counts.goal || counts.goal === 0) {
    warnings.push({
      id: generateBlockId(),
      type: "missing_goal",
      severity: "error",
      message: "No goal node found. Add a goal to define what you're trying to achieve.",
    });
  }
  if (!counts.decision || counts.decision === 0) {
    warnings.push({
      id: generateBlockId(),
      type: "missing_decision",
      severity: "error",
      message: "No decision node found. Add a decision to represent the choice being made.",
    });
  }
  if (!counts.option || counts.option === 0) {
    warnings.push({
      id: generateBlockId(),
      type: "missing_options",
      severity: "warning",
      message: "No option nodes found. Add options to represent alternatives.",
    });
  }

  // Check for disconnected subgraphs
  if (graph.nodes.length > 0 && graph.edges.length === 0) {
    warnings.push({
      id: generateBlockId(),
      type: "no_edges",
      severity: "warning",
      message: "Graph has no edges. Connect nodes to show relationships.",
    });
  }

  return {
    block: {
      id: "risks",
      type: "risks" as const,
      generated_at: getTimestamp(),
      placeholder: true,
      warnings,
    },
  };
}

/**
 * Build robustness block from ISL sensitivity/uncertainty analysis
 *
 * If robustness data is missing or degraded, returns a block with
 * status: 'cannot_compute' or 'requires_run' and a clear status_reason.
 * Never fails the overall review - gracefully degrades.
 */
export function buildRobustnessBlock(ctx: BlockBuilderContext): BlockBuilderResult {
  const { robustness } = ctx;

  // Case 1: No robustness data provided at all
  if (!robustness) {
    return {
      block: {
        id: "robustness",
        type: "robustness" as const,
        generated_at: getTimestamp(),
        placeholder: true,
        status: "requires_run" as const,
        status_reason: "ISL robustness analysis was not included in the request. Run ISL analysis to enable this block.",
      },
    };
  }

  // Case 2: ISL reported not_run or failed status
  if (robustness.status === "not_run") {
    return {
      block: {
        id: "robustness",
        type: "robustness" as const,
        generated_at: getTimestamp(),
        placeholder: true,
        status: "requires_run" as const,
        status_reason: robustness.status_reason || "ISL analysis has not been run for this decision graph.",
      },
    };
  }

  if (robustness.status === "failed") {
    return {
      block: {
        id: "robustness",
        type: "robustness" as const,
        generated_at: getTimestamp(),
        placeholder: true,
        status: "cannot_compute" as const,
        status_reason: robustness.status_reason || "ISL analysis failed. Check graph structure and retry.",
      },
    };
  }

  // Case 3: Degraded - partial data available
  if (robustness.status === "degraded") {
    const findings = buildRobustnessFindings(robustness);
    return {
      block: {
        id: "robustness",
        type: "robustness" as const,
        generated_at: getTimestamp(),
        placeholder: false,
        status: "degraded" as const,
        status_reason: robustness.status_reason || "Partial robustness data available. Some analyses could not complete.",
        overall_score: robustness.overall_score,
        findings: findings.length > 0 ? findings : undefined,
        summary: generateRobustnessSummary(robustness),
        confidence: robustness.confidence,
      },
    };
  }

  // Case 4: Fully computed - synthesize findings
  const findings = buildRobustnessFindings(robustness);
  const summary = generateRobustnessSummary(robustness);

  return {
    block: {
      id: "robustness",
      type: "robustness" as const,
      generated_at: getTimestamp(),
      placeholder: false,
      status: "computed" as const,
      overall_score: robustness.overall_score,
      findings: findings.length > 0 ? findings : undefined,
      summary,
      confidence: robustness.confidence,
    },
  };
}

/**
 * Build findings array from ISL robustness data
 */
function buildRobustnessFindings(robustness: NonNullable<BlockBuilderContext["robustness"]>): Array<{
  id: string;
  finding_type: "sensitivity" | "uncertainty" | "assumption" | "calibration";
  severity: "low" | "medium" | "high";
  node_id?: string;
  label: string;
  description: string;
  recommendation?: string;
  impact_score?: number;
}> {
  const findings: Array<{
    id: string;
    finding_type: "sensitivity" | "uncertainty" | "assumption" | "calibration";
    severity: "low" | "medium" | "high";
    node_id?: string;
    label: string;
    description: string;
    recommendation?: string;
    impact_score?: number;
  }> = [];

  // Convert high-sensitivity nodes to findings
  if (robustness.sensitivities) {
    for (const s of robustness.sensitivities.filter(s => s.classification === "high")) {
      findings.push({
        id: generateBlockId(),
        finding_type: "sensitivity",
        severity: "high",
        node_id: s.node_id,
        label: s.label,
        description: s.description || `${s.label} has high sensitivity (${(s.sensitivity_score * 100).toFixed(0)}%). Small changes could significantly affect the decision.`,
        impact_score: s.sensitivity_score,
      });
    }
  }

  // Convert poorly calibrated prediction intervals to findings
  if (robustness.prediction_intervals) {
    for (const p of robustness.prediction_intervals.filter(p => !p.well_calibrated)) {
      findings.push({
        id: generateBlockId(),
        finding_type: "calibration",
        severity: "medium",
        node_id: p.node_id,
        label: `Prediction interval for ${p.node_id}`,
        description: `Prediction interval [${p.lower_bound.toFixed(2)}, ${p.upper_bound.toFixed(2)}] may not be well-calibrated. Confidence level: ${(p.confidence_level * 100).toFixed(0)}%`,
        recommendation: "Review historical accuracy of predictions for this type of estimate.",
      });
    }
  }

  // Convert critical assumptions to findings
  if (robustness.critical_assumptions) {
    for (const a of robustness.critical_assumptions.filter(a => a.impact > 0.7)) {
      findings.push({
        id: generateBlockId(),
        finding_type: "assumption",
        severity: a.impact > 0.85 ? "high" : "medium",
        node_id: a.node_id,
        label: a.label,
        description: `This assumption has ${(a.impact * 100).toFixed(0)}% impact on the decision outcome.`,
        recommendation: a.recommendation,
        impact_score: a.impact,
      });
    }
  }

  return findings;
}

/**
 * Generate a summary headline for the robustness block
 */
function generateRobustnessSummary(robustness: NonNullable<BlockBuilderContext["robustness"]>): string {
  if (robustness.overall_score === undefined) {
    return "Robustness assessment available with partial data.";
  }

  if (robustness.overall_score >= 0.8) {
    return "Decision model is robust. Key assumptions and estimates are well-supported.";
  } else if (robustness.overall_score >= 0.5) {
    return "Moderate robustness. Some assumptions may benefit from additional validation.";
  } else {
    return "Low robustness detected. Decision is sensitive to uncertain assumptions.";
  }
}

// =============================================================================
// Legacy Aliases (for backward compatibility during migration)
// =============================================================================

export const buildBiasCheckBlock = buildBiasesBlock;
export const buildOptionsBlock = buildRecommendationBlock;
export const buildSensitivityCoachBlock = buildDriversBlock;
export const buildEvidenceHelperBlock = buildGapsBlock;
export const buildKeyInsightBlock = buildPredictionBlock;
export const buildStructuralWarningsBlock = buildRisksBlock;

// =============================================================================
// Main Builder
// =============================================================================

const BLOCK_BUILDERS: Record<ReviewBlockTypeT, (ctx: BlockBuilderContext) => BlockBuilderResult> = {
  biases: buildBiasesBlock,
  recommendation: buildRecommendationBlock,
  drivers: buildDriversBlock,
  gaps: buildGapsBlock,
  prediction: buildPredictionBlock,
  risks: buildRisksBlock,
  robustness: buildRobustnessBlock,
  next_steps: () => { throw new Error("Use buildReadinessBlock separately"); },
};

/**
 * Build all review blocks for a given context
 */
export function buildAllBlocks(
  ctx: BlockBuilderContext,
  blockTypes?: ReviewBlockTypeT[]
): { blocks: ReviewBlockT[]; warnings: string[] } {
  const typesToBuild = blockTypes || [
    "biases",
    "recommendation",
    "drivers",
    "gaps",
    "prediction",
    "risks",
    "robustness",
  ];

  const blocks: ReviewBlockT[] = [];
  const warnings: string[] = [];

  for (const type of typesToBuild) {
    if (type === "next_steps") continue; // Skip next_steps - handled separately

    const builder = BLOCK_BUILDERS[type];
    if (!builder) continue;

    try {
      const result = builder(ctx);
      blocks.push(result.block);
      if (result.warnings) {
        warnings.push(...result.warnings);
      }
    } catch (error) {
      warnings.push(`Failed to build ${type} block: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { blocks, warnings };
}

/**
 * Build a single block by type
 */
export function buildBlock(
  ctx: BlockBuilderContext,
  type: ReviewBlockTypeT
): BlockBuilderResult {
  const builder = BLOCK_BUILDERS[type];
  if (!builder) {
    throw new Error(`Unknown block type: ${type}`);
  }
  return builder(ctx);
}
