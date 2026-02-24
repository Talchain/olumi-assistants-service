/**
 * Context Serialisation
 *
 * Compact serialisation of graph and analysis response for LLM context.
 * Full graph is sent to PLoT; compact form is for LLM context window only.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { V2RunResponseEnvelope, ConversationContext } from "../types.js";
import type { GraphV3Compact, CompactNode, CompactEdge, AnalysisResponseSummary, OptionSummary, DriverSummary } from "./types.js";

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 * Preserves: node IDs, labels, kinds. Edges as from→to with strength.
 */
export function compactGraph(graph: GraphV3T): GraphV3Compact {
  const nodes: CompactNode[] = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: node.kind,
  }));

  const edges: CompactEdge[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    strength_mean: edge.strength?.mean ?? 0,
    exists_probability: edge.exists_probability ?? 1,
  }));

  return { nodes, edges };
}

// ============================================================================
// Analysis Response Summary
// ============================================================================

/**
 * Summarise a V2RunResponseEnvelope for LLM context.
 * Extracts: winner, top 3 option probabilities, top 5 drivers, robustness, constraints.
 */
export function summariseAnalysisResponse(response: V2RunResponseEnvelope): AnalysisResponseSummary {
  // Option probabilities (top 3)
  const results = (response.results ?? []) as Array<Record<string, unknown>>;
  const optionProbabilities: OptionSummary[] = results
    .filter((r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number')
    .map((r) => ({
      label: r.option_label as string,
      win_probability: r.win_probability as number,
    }))
    .sort((a, b) => b.win_probability - a.win_probability)
    .slice(0, 3);

  const winner = optionProbabilities.length > 0 ? optionProbabilities[0].label : null;

  // Top 5 sensitivity drivers
  const factors = (response.factor_sensitivity ?? []) as Array<Record<string, unknown>>;
  const topDrivers: DriverSummary[] = factors
    .filter((f) => typeof f.label === 'string')
    .slice(0, 5)
    .map((f) => ({
      label: f.label as string,
      elasticity: (f.elasticity as number) ?? 0,
      direction: (f.direction as string) ?? 'unknown',
    }));

  // Robustness
  const robustnessLevel = response.robustness?.level ?? null;

  // Constraint joint probability
  const constraintJointProbability = response.constraint_analysis?.joint_probability ?? null;

  return {
    winner,
    option_probabilities: optionProbabilities,
    top_drivers: topDrivers,
    robustness_level: robustnessLevel,
    constraint_joint_probability: constraintJointProbability,
  };
}

// ============================================================================
// Full Context Serialisation
// ============================================================================

/**
 * Serialise conversation context for LLM prompt.
 * Uses compact graph and analysis summary to fit within token budget.
 */
export function serialiseContextForLLM(context: ConversationContext): string {
  const sections: string[] = [];

  // Graph section
  if (context.graph) {
    const compact = compactGraph(context.graph as GraphV3T);
    sections.push(`## Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
    sections.push(JSON.stringify(compact));
  }

  // Analysis summary section
  if (context.analysis_response) {
    const summary = summariseAnalysisResponse(context.analysis_response);
    sections.push('## Analysis Summary');
    sections.push(JSON.stringify(summary));
  }

  // Framing section
  if (context.framing) {
    sections.push(`## Decision Stage: ${context.framing.stage}`);
    if (context.framing.goal) {
      sections.push(`Goal: ${context.framing.goal}`);
    }
  }

  // Event log summary
  if (context.event_log_summary) {
    sections.push('## Progress');
    sections.push(context.event_log_summary);
  }

  return sections.join('\n\n');
}
