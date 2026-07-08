/**
 * Holistic deterministic scorer — a WORKING whole-graph scorer, not a stub.
 * It must reward a coherent connected graph and penalise corruption, clutter
 * and bloat, seeing the graph only as a whole (the guard against arm C
 * winning merely by decomposing cleanly).
 */
import { describe, expect, it } from "vitest";
import { scoreHolisticDeterministic } from "../src/scoring/holistic/deterministic.ts";
import { makeBlind } from "./helpers.ts";

describe("holistic deterministic scorer", () => {
  it("scores a clean connected graph highly", () => {
    const result = scoreHolisticDeterministic(makeBlind());
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.components.connectivity).toBe(1);
    expect(result.components.referential_integrity).toBe(1);
  });

  it("penalises corruption: orphans, dangling edges, duplicates, bad goal ref", () => {
    const clean = scoreHolisticDeterministic(makeBlind()).score;

    const corrupted = makeBlind();
    corrupted.graph.nodes.push(
      { id: "fac_orphan", kind: "factor", label: "Orphan factor" },
      { id: "fac_dup", kind: "factor", label: "Total budget cost" } // duplicate label
    );
    corrupted.graph.edges.push({
      from: "fac_ghost",
      to: "goal_1",
      strength_mean: 0.4,
      strength_std: 0.2,
      exists_probability: 0.8,
      effect_direction: "positive",
    });
    corrupted.graph.goal_node_id = "dec_1";
    const corruptedScore = scoreHolisticDeterministic(corrupted).score;
    expect(corruptedScore).toBeLessThan(clean - 0.1);
  });

  it("penalises bloat (parsimony) without zeroing the score", () => {
    const bloated = makeBlind();
    for (let i = 0; i < 40; i++) {
      bloated.graph.nodes.push({ id: `fac_pad_${i}`, kind: "factor", label: `Padding factor ${i}` });
      bloated.graph.edges.push({
        from: `fac_pad_${i}`,
        to: "goal_1",
        strength_mean: 0.1,
        strength_std: 0.2,
        exists_probability: 0.6,
        effect_direction: "positive",
      });
    }
    const clean = scoreHolisticDeterministic(makeBlind());
    const result = scoreHolisticDeterministic(bloated);
    expect(result.components.parsimony).toBeLessThan(1);
    expect(result.score).toBeLessThan(clean.score);
  });

  it("scores the empty graph 0", () => {
    const empty = makeBlind();
    empty.graph = { nodes: [], edges: [], options: [], goal_node_id: "" };
    expect(scoreHolisticDeterministic(empty).score).toBe(0);
  });

  it("penalises a single-option 'decision'", () => {
    const oneOption = makeBlind();
    oneOption.graph.options = [oneOption.graph.options[0]];
    const result = scoreHolisticDeterministic(oneOption);
    expect(result.components.option_coverage).toBe(0);
    expect(result.notes.join(" ")).toContain("alternatives");
  });
});
