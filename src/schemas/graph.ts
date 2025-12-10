import { z } from "zod";

export const ProvenanceSource = z.enum(["document", "metric", "hypothesis", "engine"]);
export const NodeKind = z.enum(["goal", "decision", "option", "outcome", "risk", "action"]);
export const Position = z.object({ x: z.number(), y: z.number() });

export const Node = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional()
});

// Structured provenance for production trust and traceability
export const StructuredProvenance = z.object({
  source: z.string().min(1), // File name, metric name, or "hypothesis"
  quote: z.string().max(100), // Short citation or statement
  location: z.string().optional(), // "page 3", "row 42", "line 15", etc.
});

/**
 * Raw edge input schema - accepts both from/to and source/target formats.
 * Used for parsing input; see EdgeInput for the flexible input type.
 */
const EdgeInput = z.object({
  id: z.string().optional(),
  // Primary format (PLoT convention)
  from: z.string().optional(),
  to: z.string().optional(),
  // Alternative format (common in graph libraries like D3, Cytoscape, vis.js)
  source: z.string().optional(),
  target: z.string().optional(),
  weight: z.number().optional(),
  belief: z.number().min(0).max(1).optional(),
  // Support both structured and legacy string provenance for migration
  provenance: z.union([StructuredProvenance, z.string().min(1)]).optional(),
  provenance_source: ProvenanceSource.optional()
}).refine(
  (edge) => (edge.from && edge.to) || (edge.source && edge.target),
  { message: "Edge must have either from/to or source/target fields" }
);

/**
 * Edge schema with normalization - accepts both formats, outputs from/to.
 *
 * Many graph libraries use source/target by default, so we accept both
 * at the API boundary and normalize to from/to internally.
 */
export const Edge = EdgeInput.transform((edge) => {
  // Normalize to from/to, removing source/target from output
  const { source, target, ...rest } = edge;
  return {
    ...rest,
    from: edge.from ?? source!,
    to: edge.to ?? target!,
  };
});

export const Graph = z.object({
  version: z.string().default("1"),
  default_seed: z.number().default(17),
  nodes: z.array(Node),
  edges: z.array(Edge),
  meta: z
    .object({
      roots: z.array(z.string()).default([]),
      leaves: z.array(z.string()).default([]),
      suggested_positions: z.record(z.string(), Position).default({}),
      source: z.enum(["assistant", "fixtures"]).default("assistant")
    })
    .default({ roots: [], leaves: [], suggested_positions: {}, source: "assistant" })
});

export type GraphT = z.infer<typeof Graph>;
export type EdgeT = z.infer<typeof Edge>;
export type NodeT = z.infer<typeof Node>;
export type StructuredProvenanceT = z.infer<typeof StructuredProvenance>;

/**
 * Check if a graph contains any legacy string provenance (for deprecation tracking)
 * Returns count of edges with string provenance for telemetry
 */
export function hasLegacyProvenance(graph: GraphT): { hasLegacy: boolean; count: number } {
  let count = 0;
  for (const edge of graph.edges) {
    if (edge.provenance && typeof edge.provenance === "string") {
      count++;
    }
  }
  return { hasLegacy: count > 0, count };
}
