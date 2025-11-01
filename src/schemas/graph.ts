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

export const Edge = z.object({
  id: z.string().optional(),
  from: z.string(),
  to: z.string(),
  weight: z.number().optional(),
  belief: z.number().min(0).max(1).optional(),
  provenance: z.string().min(1).optional(),
  provenance_source: ProvenanceSource.optional()
});

export const Graph = z.object({
  version: z.string().default("1"),
  default_seed: z.number().default(17),
  nodes: z.array(Node).max(12),
  edges: z.array(Edge).max(24),
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
