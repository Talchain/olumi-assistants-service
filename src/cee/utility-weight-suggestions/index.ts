/**
 * Utility Weight Suggestions Module
 *
 * Suggests relative importance weights for outcome nodes in a decision graph.
 * Uses semantic analysis of labels and decision context to infer priorities.
 *
 * @example
 * suggestUtilityWeights({
 *   graph: myGraph,
 *   outcome_node_ids: ["o1", "o2", "o3"],
 *   decision_description: "Choosing a market expansion strategy"
 * })
 * → { suggestions: [...], reasoning: "...", confidence: "medium" }
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";

export interface UtilityWeightInput {
  graph: GraphV1;
  outcome_node_ids: string[];
  decision_description?: string;
}

export interface WeightSuggestion {
  node_id: string;
  node_label: string;
  suggested_weight: number;
  reasoning: string;
}

export interface AlternativeWeighting {
  name: string;
  description: string;
  weights: Array<{ node_id: string; weight: number }>;
}

export interface UtilityWeightOutput {
  suggestions: WeightSuggestion[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
  alternatives?: AlternativeWeighting[];
  provenance: "cee";
}

// Semantic categories for weight inference
const HIGH_PRIORITY_PATTERNS = [
  /revenue/i,
  /profit/i,
  /growth/i,
  /customer.*satisfaction/i,
  /market.*share/i,
  /competitive.*advantage/i,
  /strategic/i,
  /core/i,
  /primary/i,
  /critical/i,
  /essential/i,
  /key/i,
  /main/i,
  /major/i,
  /significant/i,
  /important/i,
  /urgent/i,
  /high.*priority/i,
  /top.*priority/i,
  /must.*have/i,
  /success/i,
  /win/i,
  /achieve/i,
];

const MEDIUM_PRIORITY_PATTERNS = [
  /cost/i,
  /efficiency/i,
  /quality/i,
  /satisfaction/i,
  /engagement/i,
  /retention/i,
  /performance/i,
  /productivity/i,
  /improvement/i,
  /enhancement/i,
  /optimization/i,
  /secondary/i,
  /moderate/i,
  /standard/i,
  /normal/i,
  /typical/i,
];

const LOW_PRIORITY_PATTERNS = [
  /nice.*to.*have/i,
  /optional/i,
  /minor/i,
  /low.*priority/i,
  /tertiary/i,
  /experimental/i,
  /exploratory/i,
  /side/i,
  /peripheral/i,
  /supplementary/i,
  /bonus/i,
  /extra/i,
];

// Risk-related patterns (typically negative outcomes to minimize)
const RISK_PATTERNS = [
  /risk/i,
  /cost/i,
  /loss/i,
  /failure/i,
  /delay/i,
  /negative/i,
  /downside/i,
  /threat/i,
  /obstacle/i,
  /challenge/i,
  /problem/i,
  /issue/i,
  /concern/i,
  /liability/i,
];

// Benefit-related patterns (typically positive outcomes to maximize)
const BENEFIT_PATTERNS = [
  /benefit/i,
  /gain/i,
  /success/i,
  /revenue/i,
  /profit/i,
  /growth/i,
  /positive/i,
  /upside/i,
  /opportunity/i,
  /advantage/i,
  /strength/i,
  /value/i,
  /improvement/i,
  /satisfaction/i,
];

/**
 * Main entry point for utility weight suggestions.
 * Analyzes outcome nodes and suggests relative importance weights.
 */
export function suggestUtilityWeights(input: UtilityWeightInput): UtilityWeightOutput {
  const { graph, outcome_node_ids, decision_description } = input;

  if (!outcome_node_ids || outcome_node_ids.length === 0) {
    return {
      suggestions: [],
      reasoning: "No outcome nodes provided for weight suggestions.",
      confidence: "low",
      provenance: "cee",
    };
  }

  // Get node labels from graph
  const nodeMap = new Map<string, string>();
  for (const node of graph.nodes || []) {
    nodeMap.set(node.id, node.label || node.id);
  }

  // Filter to only valid outcome node IDs
  const validOutcomes = outcome_node_ids.filter((id) => nodeMap.has(id));

  if (validOutcomes.length === 0) {
    return {
      suggestions: [],
      reasoning: "None of the specified outcome node IDs were found in the graph.",
      confidence: "low",
      provenance: "cee",
    };
  }

  // Single outcome case - weight is 1.0
  if (validOutcomes.length === 1) {
    const nodeId = validOutcomes[0];
    const nodeLabel = nodeMap.get(nodeId)!;

    return {
      suggestions: [
        {
          node_id: nodeId,
          node_label: nodeLabel,
          suggested_weight: 1.0,
          reasoning: "Only outcome - receives full weight.",
        },
      ],
      reasoning: "With a single outcome, all weight is assigned to it.",
      confidence: "high",
      provenance: "cee",
    };
  }

  // Multiple outcomes - analyze and suggest weights
  const analysisResults = analyzeOutcomes(validOutcomes, nodeMap, decision_description);
  const suggestions = calculateWeights(analysisResults);
  const alternatives = generateAlternatives(analysisResults, validOutcomes, nodeMap);

  // Determine confidence based on semantic clarity
  const confidence = determineConfidence(analysisResults);

  // Generate reasoning
  const reasoning = generateReasoning(suggestions, decision_description);

  return {
    suggestions,
    reasoning,
    confidence,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    provenance: "cee",
  };
}

interface OutcomeAnalysis {
  node_id: string;
  node_label: string;
  priority_score: number;
  is_risk: boolean;
  is_benefit: boolean;
  semantic_signals: string[];
}

/**
 * Analyze outcomes for semantic signals about importance
 */
function analyzeOutcomes(
  outcomeIds: string[],
  nodeMap: Map<string, string>,
  decisionDescription?: string
): OutcomeAnalysis[] {
  const results: OutcomeAnalysis[] = [];

  for (const nodeId of outcomeIds) {
    const nodeLabel = nodeMap.get(nodeId)!;
    const combinedText = `${nodeLabel} ${decisionDescription || ""}`.toLowerCase();

    let priorityScore = 0.5; // Default to medium
    const semanticSignals: string[] = [];

    // Check for high priority signals
    for (const pattern of HIGH_PRIORITY_PATTERNS) {
      if (pattern.test(combinedText)) {
        priorityScore = Math.max(priorityScore, 0.8);
        semanticSignals.push("high-priority indicator");
        break;
      }
    }

    // Check for medium priority signals
    for (const pattern of MEDIUM_PRIORITY_PATTERNS) {
      if (pattern.test(combinedText)) {
        priorityScore = Math.max(priorityScore, 0.5);
        if (!semanticSignals.includes("high-priority indicator")) {
          semanticSignals.push("medium-priority indicator");
        }
        break;
      }
    }

    // Check for low priority signals
    for (const pattern of LOW_PRIORITY_PATTERNS) {
      if (pattern.test(combinedText)) {
        priorityScore = Math.min(priorityScore, 0.3);
        semanticSignals.push("low-priority indicator");
        break;
      }
    }

    // Check risk/benefit classification
    const isRisk = RISK_PATTERNS.some((p) => p.test(nodeLabel));
    const isBenefit = BENEFIT_PATTERNS.some((p) => p.test(nodeLabel));

    if (isRisk) semanticSignals.push("risk-related");
    if (isBenefit) semanticSignals.push("benefit-related");

    results.push({
      node_id: nodeId,
      node_label: nodeLabel,
      priority_score: priorityScore,
      is_risk: isRisk,
      is_benefit: isBenefit,
      semantic_signals: semanticSignals,
    });
  }

  return results;
}

/**
 * Calculate normalized weights from analysis results
 */
function calculateWeights(analyses: OutcomeAnalysis[]): WeightSuggestion[] {
  // Calculate raw weights based on priority scores
  const totalScore = analyses.reduce((sum, a) => sum + a.priority_score, 0);

  return analyses.map((analysis) => {
    const rawWeight = analysis.priority_score / totalScore;
    // Round to 2 decimal places
    const suggestedWeight = Math.round(rawWeight * 100) / 100;

    // Generate reasoning based on signals
    let reasoning = "";
    if (analysis.semantic_signals.length > 0) {
      reasoning = `Weight based on ${analysis.semantic_signals.join(", ")}.`;
    } else {
      reasoning = "Moderate weight assigned due to unclear priority signals.";
    }

    return {
      node_id: analysis.node_id,
      node_label: analysis.node_label,
      suggested_weight: suggestedWeight,
      reasoning,
    };
  });
}

/**
 * Generate alternative weighting schemes
 */
function generateAlternatives(
  analyses: OutcomeAnalysis[],
  outcomeIds: string[],
  _nodeMap: Map<string, string>
): AlternativeWeighting[] {
  const alternatives: AlternativeWeighting[] = [];

  // Only generate alternatives if we have 2+ outcomes
  if (outcomeIds.length < 2) {
    return alternatives;
  }

  // Check if we have both risks and benefits
  const hasRisks = analyses.some((a) => a.is_risk);
  const hasBenefits = analyses.some((a) => a.is_benefit);

  if (hasRisks && hasBenefits) {
    // Generate risk-averse alternative
    const riskAverseWeights = analyses.map((a) => ({
      node_id: a.node_id,
      weight: a.is_risk ? 0.6 / analyses.filter((x) => x.is_risk).length : 0.4 / analyses.filter((x) => !x.is_risk).length,
    }));
    normalizeWeights(riskAverseWeights);

    alternatives.push({
      name: "Risk-averse",
      description: "Emphasizes risk mitigation over benefit maximization.",
      weights: riskAverseWeights,
    });

    // Generate growth-focused alternative
    const growthWeights = analyses.map((a) => ({
      node_id: a.node_id,
      weight: a.is_benefit ? 0.7 / analyses.filter((x) => x.is_benefit).length : 0.3 / analyses.filter((x) => !x.is_benefit).length,
    }));
    normalizeWeights(growthWeights);

    alternatives.push({
      name: "Growth-focused",
      description: "Prioritizes benefits and opportunities over risk mitigation.",
      weights: growthWeights,
    });
  }

  // Always offer a balanced alternative
  const balancedWeights = outcomeIds.map((id) => ({
    node_id: id,
    weight: 1 / outcomeIds.length,
  }));

  alternatives.push({
    name: "Balanced",
    description: "Equal weight across all outcomes.",
    weights: balancedWeights,
  });

  return alternatives;
}

/**
 * Normalize weights to sum to 1.0
 */
function normalizeWeights(weights: Array<{ node_id: string; weight: number }>): void {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (total > 0) {
    for (const w of weights) {
      w.weight = Math.round((w.weight / total) * 100) / 100;
    }
  }
  // Ensure sum is exactly 1.0 (adjust last weight for rounding)
  const newTotal = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weights.length > 0 && Math.abs(newTotal - 1.0) > 0.001) {
    weights[weights.length - 1].weight += 1.0 - newTotal;
    weights[weights.length - 1].weight = Math.round(weights[weights.length - 1].weight * 100) / 100;
  }
}

/**
 * Determine confidence based on semantic clarity
 */
function determineConfidence(analyses: OutcomeAnalysis[]): "high" | "medium" | "low" {
  // Count how many outcomes have clear semantic signals
  const clearSignals = analyses.filter((a) => a.semantic_signals.length > 0).length;
  const ratio = clearSignals / analyses.length;

  if (ratio >= 0.8) {
    return "high";
  } else if (ratio >= 0.5) {
    return "medium";
  } else {
    return "low";
  }
}

/**
 * Generate overall reasoning for the weight suggestions
 */
function generateReasoning(suggestions: WeightSuggestion[], decisionDescription?: string): string {
  const highestWeight = suggestions.reduce((max, s) => (s.suggested_weight > max.suggested_weight ? s : max));
  const lowestWeight = suggestions.reduce((min, s) => (s.suggested_weight < min.suggested_weight ? s : min));

  let reasoning = "";

  if (decisionDescription) {
    reasoning += `Based on the decision context ("${decisionDescription.slice(0, 50)}${decisionDescription.length > 50 ? "..." : ""}"), `;
  } else {
    reasoning += "Based on semantic analysis of outcome labels, ";
  }

  if (Math.abs(highestWeight.suggested_weight - lowestWeight.suggested_weight) < 0.1) {
    reasoning += "outcomes appear similarly important—consider a balanced weighting.";
  } else {
    reasoning += `"${highestWeight.node_label}" appears most significant while "${lowestWeight.node_label}" is relatively lower priority.`;
  }

  return reasoning;
}

/**
 * Validate input for utility weight suggestions
 */
export function validateUtilityWeightInput(input: unknown): input is UtilityWeightInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  if (!obj.graph || typeof obj.graph !== "object") {
    return false;
  }

  if (!Array.isArray(obj.outcome_node_ids)) {
    return false;
  }

  if (obj.decision_description !== undefined && typeof obj.decision_description !== "string") {
    return false;
  }

  return true;
}
