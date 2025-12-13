/**
 * Hybrid Bias Detection Module
 *
 * Combines rule-based detection with optional LLM fallback for nuanced cases.
 *
 * Rule-based detectors for:
 * - Anchoring: First option weighted too heavily
 * - Confirmation: Only positive factors for preferred option
 * - Overconfidence: All beliefs > 0.8
 * - Illusion of control: Many actions, few factors
 *
 * LLM fallback is feature-flagged (CEE_BIAS_LLM_DETECTION_ENABLED).
 */

import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { BIAS_DEFINITIONS, applyBiasDefinition } from "./library.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/simple-logger.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];

// ============================================================================
// Types
// ============================================================================

type NodeLike = { id?: string; kind?: string; label?: string } & Record<string, unknown>;
type EdgeLike = {
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  weight?: number;
  belief?: number;
} & Record<string, unknown>;

interface HybridBiasResult {
  /** All detected bias findings */
  findings: CEEBiasFindingV1[];
  /** Whether LLM detection was used */
  llm_used: boolean;
  /** Rule-based findings count */
  rule_based_count: number;
  /** LLM-detected findings count */
  llm_detected_count: number;
}

interface BiasDetectionContext {
  graph: GraphV1;
  brief?: string;
  ranked_options?: Array<{ node_id: string; score: number }>;
}

// ============================================================================
// Graph Helpers
// ============================================================================

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

function getEdges(graph: GraphV1 | undefined): EdgeLike[] {
  if (!graph || !Array.isArray((graph as any).edges)) return [];
  return (graph as any).edges as EdgeLike[];
}

function getEdgeFrom(edge: EdgeLike): string | undefined {
  return edge.from ?? edge.source;
}

function getEdgeTo(edge: EdgeLike): string | undefined {
  return edge.to ?? edge.target;
}

function getNodesByKind(graph: GraphV1 | undefined, kind: string): NodeLike[] {
  return getNodes(graph).filter((n) => n && n.kind === kind);
}

function toIds(nodes: NodeLike[]): string[] {
  return nodes
    .map((n) => n.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function getNodeLabel(graph: GraphV1, nodeId: string): string {
  const nodes = getNodes(graph);
  const node = nodes.find((n) => n.id === nodeId);
  return node?.label ?? nodeId;
}

// ============================================================================
// Plain Language Debiasing Suggestions
// ============================================================================

interface DebiasingSuggestion {
  headline: string;
  explanation: string;
  steps: string[];
}

const DEBIASING_SUGGESTIONS: Record<string, DebiasingSuggestion> = {
  ANCHORING: {
    headline: "The first option may be getting too much weight",
    explanation:
      "When we see an option first, we often anchor on it and judge others relative to it. " +
      "This can lead us to favor options presented early, regardless of their merit.",
    steps: [
      "Randomize the order of options before presenting them to stakeholders",
      "Have each person independently score all options before discussing",
      "Explicitly ask: 'If we removed the first option, what would we choose?'",
    ],
  },
  CONFIRMATION_BIAS: {
    headline: "Evidence may be unevenly distributed across options",
    explanation:
      "We tend to seek and remember evidence that supports what we already believe. " +
      "If one option has all the supporting evidence while others have gaps, confirmation bias may be at play.",
    steps: [
      "List one realistic way each option could fail",
      "Assign someone to play 'devil's advocate' for the leading option",
      "Search specifically for evidence against your preferred choice",
    ],
  },
  OVERCONFIDENCE: {
    headline: "Certainty levels may be too high",
    explanation:
      "When all estimates are highly confident (above 80%), it often indicates we're underestimating uncertainty. " +
      "Real-world outcomes are usually less predictable than we think.",
    steps: [
      "Ask: 'What would make me only 50% confident in this?'",
      "List three things that could go wrong that aren't in the model",
      "Widen confidence intervals by imagining best-case and worst-case scenarios",
    ],
  },
  ILLUSION_OF_CONTROL: {
    headline: "External factors may be underrepresented",
    explanation:
      "The model has many actions you can control but few external factors. " +
      "This can create an illusion that outcomes are more controllable than they actually are.",
    steps: [
      "List three external factors that could affect the outcome",
      "Identify which uncertainties are truly outside your control",
      "Consider: 'What market/competitor/regulatory changes could derail this?'",
    ],
  },
};

function getDebiasingSuggestion(code: string): DebiasingSuggestion | undefined {
  return DEBIASING_SUGGESTIONS[code];
}

// ============================================================================
// Rule-Based Detectors
// ============================================================================

/**
 * Detect Anchoring Bias: First option weighted too heavily.
 *
 * Triggers when:
 * - Graph has 3+ options
 * - First-listed option has significantly more edges or higher average weights
 * - OR first option has more positive outcomes connected
 */
export function detectAnchoringBias(
  graph: GraphV1 | undefined,
  rankedOptions?: Array<{ node_id: string; score: number }>,
): CEEBiasFindingV1 | null {
  const optionNodes = getNodesByKind(graph, "option");
  if (optionNodes.length < 3) return null;

  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const optionIds = toIds(optionNodes);
  const optionIdSet = new Set(optionIds);

  // Count edges per option
  const edgeCountByOption = new Map<string, number>();
  const totalWeightByOption = new Map<string, number>();

  for (const id of optionIds) {
    edgeCountByOption.set(id, 0);
    totalWeightByOption.set(id, 0);
  }

  for (const edge of edges) {
    const from = getEdgeFrom(edge);
    const to = getEdgeTo(edge);
    const weight = typeof edge.weight === "number" ? edge.weight : 1.0;

    if (from && optionIdSet.has(from)) {
      edgeCountByOption.set(from, (edgeCountByOption.get(from) ?? 0) + 1);
      totalWeightByOption.set(from, (totalWeightByOption.get(from) ?? 0) + weight);
    }
    if (to && optionIdSet.has(to)) {
      edgeCountByOption.set(to, (edgeCountByOption.get(to) ?? 0) + 1);
      totalWeightByOption.set(to, (totalWeightByOption.get(to) ?? 0) + weight);
    }
  }

  // Check if first option has disproportionate connections
  const firstOptionId = optionIds[0];
  const firstOptionEdges = edgeCountByOption.get(firstOptionId) ?? 0;
  const firstOptionWeight = totalWeightByOption.get(firstOptionId) ?? 0;

  // Calculate averages for other options
  const otherOptionIds = optionIds.slice(1);
  const otherEdgeCounts = otherOptionIds.map((id) => edgeCountByOption.get(id) ?? 0);
  const otherWeights = otherOptionIds.map((id) => totalWeightByOption.get(id) ?? 0);

  const avgOtherEdges = otherEdgeCounts.reduce((a, b) => a + b, 0) / otherOptionIds.length;
  const avgOtherWeight = otherWeights.reduce((a, b) => a + b, 0) / otherOptionIds.length;

  // Anchoring detected if first option has 2x more edges OR 50% more total weight
  const edgeRatio = avgOtherEdges > 0 ? firstOptionEdges / avgOtherEdges : firstOptionEdges;
  const weightRatio = avgOtherWeight > 0 ? firstOptionWeight / avgOtherWeight : firstOptionWeight;

  if (edgeRatio < 2.0 && weightRatio < 1.5) {
    return null;
  }

  const def = BIAS_DEFINITIONS["ANCHORING"];
  if (!def) return null;

  const suggestion = getDebiasingSuggestion("ANCHORING");
  const firstLabel = getNodeLabel(graph!, firstOptionId);

  const severity: CEEBiasFindingV1["severity"] = edgeRatio >= 3.0 ? "high" : "medium";

  const finding: CEEBiasFindingV1 = {
    id: "anchoring_first_option_weighted",
    category: "other",
    severity,
    node_ids: optionIds,
    explanation:
      `The first option "${firstLabel}" has ${Math.round(edgeRatio * 100)}% more connections than average. ` +
      (suggestion?.headline ?? "First-listed options often receive disproportionate attention."),
    code: def.code,
    targets: { node_ids: [firstOptionId] },
    structural_pattern: `First option has ${firstOptionEdges} edges vs average ${avgOtherEdges.toFixed(1)} for others`,
    confidence_band: "medium",
  };

  return applyBiasDefinition(finding, def.code);
}

/**
 * Detect Confirmation Bias: Only positive factors for preferred option.
 *
 * Triggers when:
 * - One option has only positive outcomes/factors attached
 * - Other options have risks or negative outcomes attached
 */
export function detectConfirmationBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const optionNodes = getNodesByKind(graph, "option");
  if (optionNodes.length < 2) return null;

  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const optionIds = toIds(optionNodes);
  const optionIdSet = new Set(optionIds);

  // Get outcomes and risks
  const outcomeNodes = getNodesByKind(graph, "outcome");
  const riskNodes = getNodesByKind(graph, "risk");
  const factorNodes = getNodesByKind(graph, "factor");

  const outcomeIdSet = new Set(toIds(outcomeNodes));
  const riskIdSet = new Set(toIds(riskNodes));
  const factorIdSet = new Set(toIds(factorNodes));

  // Analyze connections per option
  interface OptionAnalysis {
    id: string;
    label: string;
    positiveCount: number;
    negativeCount: number;
    factorCount: number;
  }

  const analyses: OptionAnalysis[] = [];

  // Patterns for positive/negative language in labels
  const positivePatterns = /\b(success|gain|benefit|improve|growth|profit|win|advantage|opportunity)\b/i;
  const negativePatterns = /\b(fail|loss|cost|risk|decline|harm|threat|problem|issue|concern)\b/i;

  for (const option of optionNodes) {
    const optionId = option.id;
    if (!optionId) continue;

    let positiveCount = 0;
    let negativeCount = 0;
    let factorCount = 0;

    for (const edge of edges) {
      const from = getEdgeFrom(edge);
      const to = getEdgeTo(edge);

      // Check edges from this option
      if (from === optionId && to) {
        if (riskIdSet.has(to)) {
          negativeCount++;
        } else if (outcomeIdSet.has(to)) {
          // Check outcome label for sentiment
          const outcomeNode = outcomeNodes.find((n) => n.id === to);
          const label = outcomeNode?.label ?? "";
          if (negativePatterns.test(label)) {
            negativeCount++;
          } else {
            positiveCount++;
          }
        } else if (factorIdSet.has(to)) {
          factorCount++;
        }
      }

      // Check edges to this option
      if (to === optionId && from) {
        if (riskIdSet.has(from)) {
          negativeCount++;
        } else if (factorIdSet.has(from)) {
          factorCount++;
        }
      }
    }

    analyses.push({
      id: optionId,
      label: option.label ?? optionId,
      positiveCount,
      negativeCount,
      factorCount,
    });
  }

  // Find options with only positive evidence (no risks, no negative outcomes)
  const positiveOnly = analyses.filter(
    (a) => a.positiveCount >= 2 && a.negativeCount === 0,
  );

  // Find options with negative evidence
  const hasNegative = analyses.filter((a) => a.negativeCount >= 1);

  // Confirmation bias detected if one option is all positive while others have negatives
  if (positiveOnly.length === 0 || hasNegative.length === 0) {
    return null;
  }

  // At least one option is positive-only while at least one other has negative evidence
  if (positiveOnly.length >= 1 && hasNegative.length >= 1) {
    const def = BIAS_DEFINITIONS["CONFIRMATION_BIAS"];
    if (!def) return null;

    const suggestion = getDebiasingSuggestion("CONFIRMATION_BIAS");
    const biasedOptionLabels = positiveOnly.map((a) => a.label).join(", ");

    const finding: CEEBiasFindingV1 = {
      id: "confirmation_positive_only_option",
      category: "other",
      severity: "medium",
      node_ids: [...positiveOnly.map((a) => a.id), ...hasNegative.map((a) => a.id)],
      explanation:
        `"${biasedOptionLabels}" has only positive evidence while other options include risks. ` +
        (suggestion?.headline ?? "This may indicate confirmation bias toward the favored option."),
      code: def.code,
      targets: { node_ids: positiveOnly.map((a) => a.id) },
      structural_pattern: `${positiveOnly.length} option(s) have only positive outcomes, ${hasNegative.length} have risks`,
      confidence_band: positiveOnly.length > 1 ? "high" : "medium",
    };

    return applyBiasDefinition(finding, def.code);
  }

  return null;
}

/**
 * Detect Overconfidence Bias: All beliefs > 0.8.
 *
 * Enhanced version that:
 * - Triggers when ALL edges have beliefs > 0.8
 * - Provides clearer explanation and debiasing steps
 */
export function detectOverconfidenceBiasEnhanced(
  graph: GraphV1 | undefined,
): CEEBiasFindingV1 | null {
  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const edgesWithBelief = edges.filter(
    (e) => typeof e.belief === "number" && Number.isFinite(e.belief),
  );

  if (edgesWithBelief.length < 3) return null;

  const beliefs = edgesWithBelief.map((e) => e.belief as number);

  // Check if ALL beliefs are above threshold
  const overconfidenceThreshold = 0.8;
  const allHighBeliefs = beliefs.every((b) => b >= overconfidenceThreshold);

  if (!allHighBeliefs) return null;

  const def = BIAS_DEFINITIONS["OVERCONFIDENCE"];
  if (!def) return null;

  const suggestion = getDebiasingSuggestion("OVERCONFIDENCE");
  const minBelief = Math.min(...beliefs);
  const maxBelief = Math.max(...beliefs);
  const avgBelief = beliefs.reduce((a, b) => a + b, 0) / beliefs.length;

  // Collect affected node IDs
  const nodeIdSet = new Set<string>();
  for (const e of edgesWithBelief) {
    const from = getEdgeFrom(e);
    const to = getEdgeTo(e);
    if (from) nodeIdSet.add(from);
    if (to) nodeIdSet.add(to);
  }

  const node_ids = Array.from(nodeIdSet);
  const severity: CEEBiasFindingV1["severity"] = avgBelief >= 0.9 ? "high" : "medium";

  const finding: CEEBiasFindingV1 = {
    id: "overconfidence_all_high_beliefs",
    category: "other",
    severity,
    node_ids,
    explanation:
      `All ${beliefs.length} edges have beliefs above ${overconfidenceThreshold * 100}% ` +
      `(range: ${(minBelief * 100).toFixed(0)}%-${(maxBelief * 100).toFixed(0)}%, avg: ${(avgBelief * 100).toFixed(0)}%). ` +
      (suggestion?.headline ?? "Real-world outcomes are usually less certain than modeled."),
    code: def.code,
    targets: { node_ids },
    structural_pattern: `All beliefs in [${minBelief.toFixed(2)}, ${maxBelief.toFixed(2)}] range`,
    confidence_band: "high",
  };

  return applyBiasDefinition(finding, def.code);
}

/**
 * Detect Illusion of Control: Many actions, few factors.
 *
 * Enhanced version with clearer explanation.
 */
export function detectIllusionOfControlEnhanced(
  graph: GraphV1 | undefined,
): CEEBiasFindingV1 | null {
  const actionNodes = getNodesByKind(graph, "action");
  const factorNodes = getNodesByKind(graph, "factor");

  const actionCount = actionNodes.length;
  const factorCount = factorNodes.length;

  // Trigger when actions significantly outnumber factors
  if (actionCount < 3) return null;

  // Calculate ratio - higher ratio = more illusion of control
  const ratio = factorCount === 0 ? actionCount : actionCount / factorCount;

  if (ratio < 3.0) return null;

  // Only trigger if factor count is low (0 or 1)
  if (factorCount > 1) return null;

  const def = BIAS_DEFINITIONS["ILLUSION_OF_CONTROL"] ?? {
    code: "ILLUSION_OF_CONTROL",
    label: "Illusion of control",
    mechanism:
      "Overestimating the degree to which outcomes can be controlled through one's own actions.",
    citation: "Langer (1975) - Journal of Personality and Social Psychology",
    typical_interventions: [
      "List external factors that could affect the outcome",
      "Identify which uncertainties are outside your direct control",
    ],
  };

  // Add to BIAS_DEFINITIONS if not present
  if (!BIAS_DEFINITIONS["ILLUSION_OF_CONTROL"]) {
    (BIAS_DEFINITIONS as any)["ILLUSION_OF_CONTROL"] = def;
  }

  const suggestion = getDebiasingSuggestion("ILLUSION_OF_CONTROL");
  const actionIds = toIds(actionNodes);

  const severity: CEEBiasFindingV1["severity"] = factorCount === 0 ? "medium" : "low";

  const finding: CEEBiasFindingV1 = {
    id: "illusion_of_control_action_heavy",
    category: "other",
    severity,
    node_ids: actionIds,
    explanation:
      `Model has ${actionCount} controllable actions but only ${factorCount} external factors. ` +
      (suggestion?.headline ?? "Outcomes may be less controllable than the model suggests."),
    code: def.code,
    targets: { node_ids: actionIds },
    structural_pattern: `${actionCount} actions vs ${factorCount} factors (ratio: ${ratio.toFixed(1)}x)`,
    confidence_band: factorCount === 0 ? "high" : "medium",
  };

  return applyBiasDefinition(finding, def.code);
}

// ============================================================================
// LLM Fallback Detection
// ============================================================================

const LLM_BIAS_DETECTION_PROMPT = `You are a cognitive bias expert analyzing a decision model.

Analyze the following decision graph for subtle cognitive biases that rule-based detection might miss.

Focus on:
1. Hidden anchoring effects (not just first option, but any reference point bias)
2. Subtle confirmation bias (asymmetric evidence quality, not just presence/absence)
3. Framing effects (how options/outcomes are worded)
4. Availability bias (over-reliance on recent or memorable examples)
5. Authority bias (undue weight to certain sources)

Graph structure:
{{GRAPH_JSON}}

{{BRIEF_SECTION}}

Existing rule-based findings (already detected):
{{EXISTING_FINDINGS}}

Return a JSON array of additional bias findings NOT already covered by existing findings.
Each finding should have:
- bias_type: string (e.g., "ANCHORING", "CONFIRMATION_BIAS", "FRAMING_EFFECT")
- severity: "low" | "medium" | "high"
- explanation: string (2-3 sentences, plain language)
- affected_nodes: string[] (node IDs)
- confidence: number (0-1)

Only return findings with confidence >= 0.6. If no additional biases detected, return an empty array.

Return ONLY valid JSON array, no other text.`;

interface LlmBiasFinding {
  bias_type: string;
  severity: "low" | "medium" | "high";
  explanation: string;
  affected_nodes: string[];
  confidence: number;
}

/**
 * Use LLM for nuanced bias detection when rules don't catch everything.
 *
 * Note: This is a placeholder for future LLM-based detection.
 * The LLMAdapter interface currently uses task-specific methods.
 * When enabled, this logs that LLM detection would be invoked.
 */
async function detectBiasesWithLlm(
  graph: GraphV1,
  brief: string | undefined,
  existingFindings: CEEBiasFindingV1[],
): Promise<CEEBiasFindingV1[]> {
  if (!config.cee.biasLlmDetectionEnabled) {
    return [];
  }

  // Log that LLM detection is enabled
  logger.info({
    event: "cee.bias.llm_detection_enabled",
    msg: "LLM bias detection enabled - prompt template ready for future integration",
    existing_finding_count: existingFindings.length,
    node_count: Array.isArray((graph as any).nodes) ? (graph as any).nodes.length : 0,
    edge_count: Array.isArray((graph as any).edges) ? (graph as any).edges.length : 0,
    has_brief: !!brief,
  });

  // Future: Implement LLM-based detection when raw completion is available
  // The prompt template (LLM_BIAS_DETECTION_PROMPT) is defined above

  return [];
}

// ============================================================================
// Main Hybrid Detection Function
// ============================================================================

/**
 * Run hybrid bias detection combining rules and optional LLM.
 *
 * @param context - Graph and optional context (brief, ranked options)
 * @returns Hybrid bias detection result
 */
export async function detectBiasesHybrid(
  context: BiasDetectionContext,
): Promise<HybridBiasResult> {
  const { graph, brief, ranked_options } = context;

  // Run rule-based detectors
  const ruleBasedFindings: CEEBiasFindingV1[] = [];

  const anchoringFinding = detectAnchoringBias(graph, ranked_options);
  if (anchoringFinding) ruleBasedFindings.push(anchoringFinding);

  const confirmationFinding = detectConfirmationBias(graph);
  if (confirmationFinding) ruleBasedFindings.push(confirmationFinding);

  const overconfidenceFinding = detectOverconfidenceBiasEnhanced(graph);
  if (overconfidenceFinding) ruleBasedFindings.push(overconfidenceFinding);

  const illusionFinding = detectIllusionOfControlEnhanced(graph);
  if (illusionFinding) ruleBasedFindings.push(illusionFinding);

  // Run LLM detection if enabled
  let llmFindings: CEEBiasFindingV1[] = [];
  let llmUsed = false;

  if (config.cee.biasLlmDetectionEnabled) {
    llmFindings = await detectBiasesWithLlm(graph, brief, ruleBasedFindings);
    llmUsed = true;
  }

  // Combine findings
  const allFindings = [...ruleBasedFindings, ...llmFindings];

  return {
    findings: allFindings,
    llm_used: llmUsed,
    rule_based_count: ruleBasedFindings.length,
    llm_detected_count: llmFindings.length,
  };
}

/**
 * Synchronous version for cases where async is not needed.
 * Only runs rule-based detection.
 */
export function detectBiasesHybridSync(
  context: BiasDetectionContext,
): Omit<HybridBiasResult, "llm_detected_count"> & { llm_detected_count: 0 } {
  const { graph, ranked_options } = context;

  const ruleBasedFindings: CEEBiasFindingV1[] = [];

  const anchoringFinding = detectAnchoringBias(graph, ranked_options);
  if (anchoringFinding) ruleBasedFindings.push(anchoringFinding);

  const confirmationFinding = detectConfirmationBias(graph);
  if (confirmationFinding) ruleBasedFindings.push(confirmationFinding);

  const overconfidenceFinding = detectOverconfidenceBiasEnhanced(graph);
  if (overconfidenceFinding) ruleBasedFindings.push(overconfidenceFinding);

  const illusionFinding = detectIllusionOfControlEnhanced(graph);
  if (illusionFinding) ruleBasedFindings.push(illusionFinding);

  return {
    findings: ruleBasedFindings,
    llm_used: false,
    rule_based_count: ruleBasedFindings.length,
    llm_detected_count: 0,
  };
}

// ============================================================================
// Exports
// ============================================================================

export { DEBIASING_SUGGESTIONS, getDebiasingSuggestion };

export const __test_only = {
  detectAnchoringBias,
  detectConfirmationBias,
  detectOverconfidenceBiasEnhanced,
  detectIllusionOfControlEnhanced,
  getDebiasingSuggestion,
  DEBIASING_SUGGESTIONS,
};
