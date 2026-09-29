/**
 * Model Receipt Builder
 *
 * Extracts server-constructed metadata from a graph_patch block
 * for the UI (node/edge counts, option labels, goal, insight, readiness, repairs).
 */

import type { TypedConversationBlock, GraphPatchBlockData, ModelReceipt } from "../../types.js";

/**
 * Build a ModelReceipt from the blocks produced this turn.
 * Returns undefined if no graph_patch block with an applied_graph is found.
 */
export function buildModelReceipt(
  blocks: TypedConversationBlock[],
  analysisReady?: GraphPatchBlockData['analysis_ready'],
): ModelReceipt | undefined {
  // Find the last graph_patch block
  const patchBlock = [...blocks]
    .reverse()
    .find((b) => b.block_type === 'graph_patch');

  if (!patchBlock) return undefined;

  const data = patchBlock.data as GraphPatchBlockData;
  const graph = data.applied_graph;
  if (!graph) return undefined;

  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  return {
    node_count: nodes.length,
    edge_count: edges.length,
    option_labels: nodes
      .filter((n) => n.kind === 'option')
      .map((n) => n.label),
    goal_label: nodes.find((n) => n.kind === 'goal')?.label ?? null,
    top_insight: data.summary ?? null,
    readiness_status: analysisReady?.status ?? null,
    repairs_applied_count: data.repairs_applied?.length ?? 0,
  };
}
