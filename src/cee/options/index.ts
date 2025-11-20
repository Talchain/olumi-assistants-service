import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";

type CEEOptionV1 = components["schemas"]["CEEOptionV1"];
type CEEOptionsRequestV1 = components["schemas"]["CEEOptionsRequestV1"];

type ArchetypeMeta = CEEOptionsRequestV1["archetype"];

function getNodesByKind(graph: GraphV1 | undefined, kind: string): any[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return ((graph as any).nodes as any[]).filter((n) => n && (n as any).kind === kind);
}

function uniqueById(options: CEEOptionV1[]): CEEOptionV1[] {
  const seen = new Set<string>();
  const result: CEEOptionV1[] = [];
  for (const opt of options) {
    if (!opt || typeof opt.id !== "string") continue;
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    result.push(opt);
  }
  return result;
}

/**
 * Deterministic options generator for CEE v1.
 *
 * Heuristics are intentionally simple and only use graph structure and
 * optional archetype metadata. No labels, free-text, or LLM calls.
 */
export function generateOptions(graph: GraphV1, archetype?: ArchetypeMeta | null): CEEOptionV1[] {
  const optionNodes = getNodesByKind(graph, "option");
  const goalNodes = getNodesByKind(graph, "goal");

  const optionIds = optionNodes.map((n) => (n as any).id as string).filter(Boolean);
  const goalIds = goalNodes.map((n) => (n as any).id as string).filter(Boolean);

  const optionCount = optionNodes.length;
  const decisionType = (archetype as any)?.decision_type as string | undefined;

  const suggestions: CEEOptionV1[] = [];

  // No options at all: encourage expanding the option set and channels.
  if (optionCount === 0) {
    suggestions.push({
      id: "expand_scope_add_options",
      kind: "expand_scope",
      node_ids: goalIds,
      priority: "high",
    } as CEEOptionV1);

    suggestions.push({
      id: "change_channel_explore_paths",
      kind: "change_channel",
      node_ids: goalIds,
      priority: "medium",
    } as CEEOptionV1);
  }

  // Single option: suggest adding comparators.
  if (optionCount === 1) {
    suggestions.push({
      id: "expand_scope_add_comparators",
      kind: "expand_scope",
      node_ids: optionIds,
      priority: "medium",
    } as CEEOptionV1);
  }

  // Multiple options: suggest narrowing focus.
  if (optionCount >= 2) {
    suggestions.push({
      id: "reduce_scope_focus_core",
      kind: "reduce_scope",
      node_ids: optionIds,
      priority: "medium",
    } as CEEOptionV1);
  }

  // Pricing-specific heuristics: consider timing/channel adjustments.
  if (decisionType === "pricing_decision") {
    suggestions.push({
      id: "adjust_timing_price_rollout",
      kind: "adjust_timing",
      node_ids: goalIds,
      priority: optionCount === 0 ? "high" : "medium",
    } as CEEOptionV1);

    if (optionCount >= 1) {
      suggestions.push({
        id: "change_channel_price_segment",
        kind: "change_channel",
        node_ids: optionIds,
        priority: "medium",
      } as CEEOptionV1);
    }
  }

  return uniqueById(suggestions);
}
