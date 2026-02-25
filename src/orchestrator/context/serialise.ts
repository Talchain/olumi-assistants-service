/**
 * Context Serialisation
 *
 * Compact serialisation of graph and analysis response for LLM context.
 * Full graph is sent to PLoT; compact form is for LLM context window only.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { V2RunResponseEnvelope, ConversationContext } from "../types.js";
import type { GraphV3Compact, CompactNode, CompactEdge, EditCompactGraph, EditCompactNode, EditCompactEdge, AnalysisResponseSummary, OptionSummary, DriverSummary } from "./types.js";

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
// Edit Compact Graph (for edit_graph prompt — includes category + edge fields)
// ============================================================================

/**
 * Compact a graph for the edit_graph LLM prompt.
 *
 * More fields than compactGraph() because the LLM needs category, effect_direction,
 * and strength_std to produce valid PatchOperations. Still strips data payloads,
 * positions, and other heavy fields.
 */
export function editCompactGraph(graph: GraphV3T): EditCompactGraph {
  const nodes: EditCompactNode[] = graph.nodes.map((node) => {
    const category = (node as Record<string, unknown>).category as string | undefined;
    const result: EditCompactNode = {
      id: node.id,
      label: node.label ?? node.id,
      kind: node.kind,
    };
    if (category) result.category = category;
    return result;
  });

  const edges: EditCompactEdge[] = graph.edges.map((edge) => {
    const edgeLabel = (edge as Record<string, unknown>).label as string | undefined;
    const result: EditCompactEdge = {
      from: edge.from,
      to: edge.to,
      strength_mean: edge.strength?.mean ?? 0,
      strength_std: edge.strength?.std ?? 0.125,
      exists_probability: edge.exists_probability ?? 1,
      effect_direction: edge.effect_direction ?? 'positive',
    };
    if (edgeLabel) result.label = edgeLabel;
    return result;
  });

  return { nodes, edges };
}

// ============================================================================
// Safe Graph JSON Truncation
// ============================================================================

/**
 * Produce a JSON string of the graph, safely truncated to `maxBytes`.
 *
 * Unlike `JSON.stringify().substring(n)`, this iteratively removes edges then
 * nodes to keep the result valid JSON. Returns the full string if it fits.
 */
export function truncateGraphJson(graph: EditCompactGraph, maxBytes: number): string {
  const full = JSON.stringify(graph);
  if (full.length <= maxBytes) return full;

  let truncated = { ...graph, nodes: [...graph.nodes], edges: [...graph.edges] };

  // Iteratively reduce: remove edges first, then nodes
  for (let i = 0; i < 10; i++) {
    const json = JSON.stringify(truncated);
    if (json.length <= maxBytes) return json;

    if (truncated.edges.length > 1) {
      const newLen = Math.ceil(truncated.edges.length * 0.8);
      truncated = { ...truncated, edges: truncated.edges.slice(0, newLen) };
    } else if (truncated.nodes.length > 1) {
      const newLen = Math.ceil(truncated.nodes.length * 0.8);
      const keptIds = new Set(truncated.nodes.slice(0, newLen).map(n => n.id));
      truncated = {
        ...truncated,
        nodes: truncated.nodes.slice(0, newLen),
        edges: truncated.edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to)),
      };
    } else {
      break;
    }
  }

  return JSON.stringify(truncated);
}

// ============================================================================
// Edit Context Serialisation (for edit_graph LLM prompt)
// ============================================================================

/**
 * Build the full context string for the edit_graph LLM prompt.
 *
 * Includes: edit compact graph, framing metadata, analysis summary, selected elements.
 * Does NOT include conversation turns — the orchestrator distils intent into editDescription.
 */
export function serialiseEditContextForLLM(
  context: ConversationContext,
  maxGraphBytes: number = 8000,
): string {
  const sections: string[] = [];

  // Graph section (always present — handler validates graph exists before calling)
  if (context.graph) {
    const compact = editCompactGraph(context.graph as GraphV3T);
    const graphJson = truncateGraphJson(compact, maxGraphBytes);
    sections.push(`## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
    sections.push('```json');
    sections.push(graphJson);
    sections.push('```');
  }

  // Framing metadata
  if (context.framing) {
    sections.push(`## Decision Stage: ${context.framing.stage}`);
    if (context.framing.goal) {
      sections.push(`Goal: ${context.framing.goal}`);
    }
    if (context.framing.constraints && (context.framing.constraints as unknown[]).length > 0) {
      sections.push(`Constraints: ${JSON.stringify(context.framing.constraints)}`);
    }
  }

  // Analysis summary (if available)
  if (context.analysis_response) {
    const summary = summariseAnalysisResponse(context.analysis_response);
    sections.push('## Analysis Summary');
    sections.push(JSON.stringify(summary));
  }

  // Selected elements (FOCUS section)
  if (context.selected_elements && context.selected_elements.length > 0) {
    sections.push('## FOCUS');
    sections.push('The user has selected these elements. Prioritise changes to these:');
    sections.push(context.selected_elements.map(el => `- ${el}`).join('\n'));
  }

  return sections.join('\n\n');
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
