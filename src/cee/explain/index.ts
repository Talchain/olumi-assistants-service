import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1, InferenceResultsV1 } from "../../contracts/plot/engine.js";

type CEEExplainGraphResponseV1 = components["schemas"]["CEEExplainGraphResponseV1"];

export type ExplanationPayload = CEEExplainGraphResponseV1["explanation"];

function getNodeLabel(graph: GraphV1 | undefined, nodeId: string): string | undefined {
  if (!graph || !Array.isArray((graph as any).nodes)) return undefined;
  const nodes = (graph as any).nodes as Array<{ id?: string; label?: string }>;
  const match = nodes.find((n) => n && n.id === nodeId);
  return typeof match?.label === "string" ? match.label : undefined;
}

/**
 * Build a deterministic explanation payload from inference results and graph.
 *
 * - Uses inference.explain.top_drivers when present.
 * - Sorts drivers by contribution desc, then id asc, and assigns stable ranks.
 * - Optionally enriches drivers with node labels from the graph.
 * - Leaves targets optional for v1 (can be extended when engine exposes them).
 */
export function buildExplanation(graph: GraphV1, inference: InferenceResultsV1): ExplanationPayload {
  const topDrivers = (inference.explain?.top_drivers ?? []) as Array<{
    node_id?: string;
    description?: string;
    contribution?: number;
  }>;

  const sorted = [...topDrivers].filter((d) => typeof d.node_id === "string").sort((a, b) => {
    const ca = typeof a.contribution === "number" ? a.contribution : 0;
    const cb = typeof b.contribution === "number" ? b.contribution : 0;
    if (cb !== ca) return cb - ca;
    return (a.node_id as string).localeCompare(b.node_id as string);
  });

  const drivers: NonNullable<ExplanationPayload["top_drivers"]> = sorted.map((driver, index) => {
    const id = driver.node_id as string;
    const impact = typeof driver.contribution === "number" ? driver.contribution : undefined;
    const label = getNodeLabel(graph, id);

    return {
      id,
      impact,
      rank: index + 1,
      label,
    };
  });

  const explanation: ExplanationPayload = {};

  if (drivers.length > 0) {
    explanation.top_drivers = drivers;
  }

  // For v1 we keep targets optional; we may extend this when engine exposes
  // target-specific distributions. The summary remains available to clients
  // via the original inference payload.

  return explanation;
}
