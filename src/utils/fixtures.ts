import type { GraphT } from "../schemas/graph.js";

/**
 * Minimal fixture graph for SSE 2.5s fallback
 * Shown to user while real draft is being generated
 *
 * V4 topology: decision → options → factor → outcome → goal
 * (option → outcome is NOT allowed in v4 closed-world edge rules)
 */
export const fixtureGraph: GraphT = {
  version: "1",
  default_seed: 17,
  nodes: [
    { id: "goal_1", kind: "goal", label: "Achieve primary objective" },
    { id: "dec_1", kind: "decision", label: "Consider options" },
    { id: "opt_1", kind: "option", label: "Option A" },
    { id: "opt_2", kind: "option", label: "Option B" },
    { id: "fac_1", kind: "factor", label: "Key factor", data: { value: 1 } },
    { id: "out_1", kind: "outcome", label: "Expected result" },
  ],
  edges: [
    // V4 topology: decision → options → factor → outcome → goal
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "opt_1", to: "fac_1" },  // option → factor (v4 allowed)
    { from: "opt_2", to: "fac_1" },  // option → factor (v4 allowed)
    { from: "fac_1", to: "out_1" },  // factor → outcome (v4 allowed)
    { from: "out_1", to: "goal_1" }, // outcome → goal (v4 allowed)
  ],
  meta: {
    roots: ["dec_1"],   // Decision is root (no incoming edges)
    leaves: ["goal_1"], // Goal is leaf/sink (no outgoing edges)
    suggested_positions: {
      goal_1: { x: 100, y: 50 },
      dec_1: { x: 100, y: 250 },
      opt_1: { x: 50, y: 350 },
      opt_2: { x: 150, y: 350 },
      fac_1: { x: 100, y: 450 },
      out_1: { x: 100, y: 150 },
    },
    source: "assistant",
  },
};
