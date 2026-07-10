/**
 * RED-first: a safety-cell hit whose element_id references a NONEXISTENT element (an intervention
 * pointing at a missing factor, or a goal_node_id pointing at no node) must not be silently dropped.
 * It has no decomposed element to attach to, so verdicts must surface it as a synthetic ungrounded
 * element that SAFETY_CAPs the graph.
 */
import { describe, expect, it } from "vitest";
import { SmokeStubVerdictProvider } from "../src/scoring/verdicts.ts";
import type { BlindCandidate, SafetyCellHit } from "../src/types.ts";

const blindWithGoalOrphan = (): BlindCandidate => ({
  blind_id: "B001",
  brief: "x",
  graph: {
    nodes: [{ id: "n_real", kind: "factor", label: "Real factor" }],
    edges: [],
    options: [],
    goal_node_id: "n_missing", // references no node
  },
  open_questions: [],
});

describe("verdicts — orphan safety hits are scored, not dropped", () => {
  it("surfaces a hit on a nonexistent goal node as an ungrounded, corroborated element", () => {
    const hits: SafetyCellHit[] = [
      { cell: "unsafe_to_apply", element_id: "node:n_missing", detail: "goal_node_id references no node" },
    ];
    const bundle = new SmokeStubVerdictProvider().provide(blindWithGoalOrphan(), hits);

    const orphan = bundle.elements.find((e) => e.id === "node:n_missing");
    expect(orphan, "orphan safety hit must appear as an element").toBeDefined();
    expect(orphan?.gate).toBe("ungrounded_or_fabricated");
    expect(orphan?.corroborated).toBe(true);
    expect(orphan?.flags).toContain("unsafe_to_apply");
  });

  it("does not synthesize an orphan when the hit maps to a real decomposed node", () => {
    const hits: SafetyCellHit[] = [
      { cell: "unsafe_to_apply", element_id: "node:n_real", detail: "duplicate node id" },
    ];
    const bundle = new SmokeStubVerdictProvider().provide(blindWithGoalOrphan(), hits);
    // Exactly one element carries node:n_real (the decomposed node), not a synthetic duplicate.
    expect(bundle.elements.filter((e) => e.id === "node:n_real")).toHaveLength(1);
  });
});
