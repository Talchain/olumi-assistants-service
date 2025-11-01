import type { GraphT } from "../schemas/graph.js";

/**
 * Minimal fixture graph for SSE 2.5s fallback
 * Shown to user while real draft is being generated
 */
export const fixtureGraph: GraphT = {
  version: "1",
  default_seed: 17,
  nodes: [
    { id: "goal_1", kind: "goal", label: "Achieve primary objective" },
    { id: "dec_1", kind: "decision", label: "Consider options" },
    { id: "opt_1", kind: "option", label: "Option A" },
    { id: "opt_2", kind: "option", label: "Option B" },
    { id: "out_1", kind: "outcome", label: "Expected result" },
  ],
  edges: [
    { from: "goal_1", to: "dec_1" },
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "opt_1", to: "out_1" },
    { from: "opt_2", to: "out_1" },
  ],
  meta: {
    roots: ["goal_1"],
    leaves: ["out_1"],
    suggested_positions: {
      goal_1: { x: 100, y: 100 },
      dec_1: { x: 100, y: 200 },
      opt_1: { x: 50, y: 300 },
      opt_2: { x: 150, y: 300 },
      out_1: { x: 100, y: 400 },
    },
    source: "fixtures",
  },
};
