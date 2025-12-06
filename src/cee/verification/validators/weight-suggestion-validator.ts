import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { CEEWeightSuggestionV1T } from "../../../schemas/ceeResponses.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";

/**
 * WeightSuggestionValidator
 *
 * Analyzes graph edges for uniform/unrefined belief values and generates
 * suggestions for edges that may benefit from refinement. This validator
 * returns suggestions as data rather than failures.
 *
 * Detection heuristics:
 * - Uniform distribution: All outgoing edges from a decision node have equal beliefs
 * - Near-zero/near-one: Edge beliefs at extreme values (< 0.05 or > 0.95)
 */
export class WeightSuggestionValidator implements VerificationStage<unknown, unknown> {
  readonly name = "weight_suggestions" as const;

  private readonly uniformEpsilon = 0.01;
  private readonly nearZeroThreshold = 0.05;
  private readonly nearOneThreshold = 0.95;

  async validate(
    payload: unknown,
    _context?: VerificationContext,
  ): Promise<VerificationResult<unknown> & { suggestions?: CEEWeightSuggestionV1T[] }> {
    const graph = (payload as any)?.graph as GraphV1 | undefined;
    if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      };
    }

    const nodes = (graph as any).nodes as any[];
    const edges = (graph as any).edges as any[];

    // Build node kind map
    const kinds = new Map<string, string>();
    const labels = new Map<string, string>();
    for (const node of nodes) {
      const id = typeof (node as any)?.id === "string" ? ((node as any).id as string) : undefined;
      const kind = typeof (node as any)?.kind === "string" ? ((node as any).kind as string) : undefined;
      const label = typeof (node as any)?.label === "string" ? ((node as any).label as string) : undefined;
      if (!id || !kind) continue;
      kinds.set(id, kind);
      if (label) labels.set(id, label);
    }

    const suggestions: CEEWeightSuggestionV1T[] = [];

    // Group edges by source node for uniform distribution detection
    const edgesBySource = new Map<string, Array<{ edge: any; index: number }>>();
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index] as any;
      const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
      if (!from) continue;
      const existing = edgesBySource.get(from);
      if (existing) {
        existing.push({ edge, index });
      } else {
        edgesBySource.set(from, [{ edge, index }]);
      }
    }

    // Check for uniform distributions on decision→option edges
    for (const [sourceId, sourceEdges] of edgesBySource) {
      const sourceKind = kinds.get(sourceId);
      if (sourceKind !== "decision") continue;

      // Filter to only edges pointing to option nodes
      const optionEdges = sourceEdges.filter(({ edge }) => {
        const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
        return to && kinds.get(to) === "option";
      });

      if (optionEdges.length < 2) continue;

      // Check if all beliefs are equal (uniform distribution)
      const beliefs = optionEdges
        .map(({ edge }) => edge.belief)
        .filter((b): b is number => typeof b === "number" && Number.isFinite(b));

      if (beliefs.length < 2) continue;

      const firstBelief = beliefs[0];
      const isUniform = beliefs.every((b) => Math.abs(b - firstBelief) < this.uniformEpsilon);

      if (isUniform) {
        // Add suggestion for each uniform edge
        for (const { edge } of optionEdges) {
          const from = edge.from as string;
          const to = edge.to as string;
          const belief = typeof edge.belief === "number" ? edge.belief : 0;

          suggestions.push({
            edge_id: `${from}->${to}`,
            from_node_id: from,
            to_node_id: to,
            current_belief: belief,
            reason: "uniform_distribution",
            suggestion: `All options from "${labels.get(from) ?? from}" have equal probability. Consider differentiating based on likelihood.`,
          });
        }
      }
    }

    // Check for near-zero and near-one beliefs (all edges)
    for (const edge of edges) {
      const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
      const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
      const belief = typeof edge?.belief === "number" ? edge.belief : undefined;

      if (!from || !to || belief === undefined) continue;

      // Skip if already flagged as uniform
      const edgeId = `${from}->${to}`;
      if (suggestions.some((s) => s.edge_id === edgeId)) continue;

      if (belief < this.nearZeroThreshold) {
        suggestions.push({
          edge_id: edgeId,
          from_node_id: from,
          to_node_id: to,
          current_belief: belief,
          reason: "near_zero",
          suggestion: `Edge has very low belief (${belief.toFixed(2)}). If this outcome is unlikely, consider removing it or documenting why.`,
        });
      } else if (belief > this.nearOneThreshold) {
        suggestions.push({
          edge_id: edgeId,
          from_node_id: from,
          to_node_id: to,
          current_belief: belief,
          reason: "near_one",
          suggestion: `Edge has very high belief (${belief.toFixed(2)}). Consider whether alternative outcomes should also be modeled.`,
        });
      }
    }

    // Prioritize by severity: extremes (near_zero, near_one) before uniform_distribution
    const severityOrder: Record<string, number> = {
      near_zero: 0,
      near_one: 1,
      uniform_distribution: 2,
    };
    suggestions.sort((a, b) => (severityOrder[a.reason] ?? 99) - (severityOrder[b.reason] ?? 99));

    // Limit suggestions to top 10 to avoid noise
    const limitedSuggestions = suggestions.slice(0, 10);

    return {
      valid: true,
      stage: this.name,
      suggestions: limitedSuggestions,
      details: {
        total_suggestions: suggestions.length,
        suggestions_returned: limitedSuggestions.length,
        uniform_edges: suggestions.filter((s) => s.reason === "uniform_distribution").length,
        near_zero_edges: suggestions.filter((s) => s.reason === "near_zero").length,
        near_one_edges: suggestions.filter((s) => s.reason === "near_one").length,
      },
    };
  }
}
