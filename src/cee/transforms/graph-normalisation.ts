/**
 * Graph version and provenance normalisation.
 *
 * Extracted from pipeline.ts for reuse in the unified pipeline.
 * Sets graph version to "1.2" and infers provenance_source on edges.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";

export function normaliseCeeGraphVersionAndProvenance(graph: GraphV1 | undefined): GraphV1 | undefined {
  if (!graph) {
    return graph;
  }

  const edges = Array.isArray((graph as any).edges) ? ((graph as any).edges as any[]) : undefined;

  if (!edges) {
    return {
      ...graph,
      version: "1.2",
    };
  }

  const normalisedEdges = edges.map((edge: any) => {
    if (!edge || edge.provenance_source) {
      return edge;
    }

    const cloned = { ...edge };

    // If there is no provenance at all, treat this as an engine-originated edge.
    if (cloned.provenance === undefined || cloned.provenance === null) {
      cloned.provenance_source = "engine";
      return cloned;
    }

    const prov = cloned.provenance;

    // Lightweight inference for hypothesis provenance when structured provenance is present.
    if (prov && typeof prov === "object" && typeof (prov as any).source === "string") {
      const src = ((prov as any).source as string).toLowerCase();
      if (src === "hypothesis") {
        cloned.provenance_source = "hypothesis";
      }
      return cloned;
    }

    // Legacy string provenance: infer "hypothesis" when clearly marked, otherwise leave undefined.
    if (typeof prov === "string") {
      const src = prov.toLowerCase();
      if (src.includes("hypothesis")) {
        cloned.provenance_source = "hypothesis";
      }
      return cloned;
    }

    return cloned;
  });

  return {
    ...graph,
    version: "1.2",
    edges: normalisedEdges as any,
  };
}
