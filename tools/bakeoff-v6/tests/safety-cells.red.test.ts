/**
 * RED-first: each deterministic safety cell must FIRE on a violation before
 * it is relied on, and must stay quiet on derivable/clean content.
 */
import { describe, expect, it } from "vitest";
import { briefNumberSet, runSafetyCells } from "../src/scoring/safety-cells.ts";
import { makeBlind } from "./helpers.ts";

describe("safety cells (deterministic, blind-payload only)", () => {
  it("catches a fabricated value/unit not derivable from the brief", () => {
    const blind = makeBlind();
    blind.graph.nodes.push({ id: "fac_market", kind: "factor", label: "Market size", value: 987654, unit: "EUR" });
    const hits = runSafetyCells(blind);
    expect(hits.some((h) => h.cell === "invented_value_unit_or_effect" && h.element_id === "node:fac_market")).toBe(true);
  });

  it("accepts values derivable from the brief ($200k => 200000; 6 months)", () => {
    const blind = makeBlind();
    blind.graph.nodes.push({ id: "fac_budget", kind: "factor", label: "Budget", value: 200000, unit: "USD" });
    blind.graph.nodes.push({ id: "fac_horizon", kind: "factor", label: "Launch horizon", value: 6, unit: "months" });
    const hits = runSafetyCells(blind).filter((h) => h.cell === "invented_value_unit_or_effect");
    expect(hits).toEqual([]);
  });

  it("catches an invented intervention value on an option", () => {
    const blind = makeBlind();
    blind.graph.options[0].interventions.push({ factor_id: "fac_cost", value: 31337, unit: "USD" });
    const hits = runSafetyCells(blind);
    expect(hits.some((h) => h.cell === "invented_value_unit_or_effect" && h.detail.includes("31337"))).toBe(true);
  });

  it("catches unsafe_to_apply: dangling edge endpoint", () => {
    const blind = makeBlind();
    blind.graph.edges.push({ from: "fac_ghost", to: "goal_1", strength_mean: 0.4, strength_std: 0.2, exists_probability: 0.8, effect_direction: "positive" });
    const hits = runSafetyCells(blind);
    expect(hits.some((h) => h.cell === "unsafe_to_apply" && h.element_id.includes("fac_ghost"))).toBe(true);
  });

  it("catches unsafe_to_apply: duplicate node id and non-goal goal reference", () => {
    const blind = makeBlind();
    blind.graph.nodes.push({ id: "fac_cost", kind: "factor", label: "Shadow cost" });
    blind.graph.goal_node_id = "dec_1";
    const hits = runSafetyCells(blind);
    expect(hits.some((h) => h.cell === "unsafe_to_apply" && h.detail.includes("duplicate node id"))).toBe(true);
    expect(hits.some((h) => h.cell === "unsafe_to_apply" && h.detail.includes('kind "decision"'))).toBe(true);
  });

  it("flags an unsupported causal link between brief-alien concepts (heuristic proxy)", () => {
    const blind = makeBlind();
    blind.graph.nodes.push(
      { id: "fac_alien", kind: "factor", label: "Alien invasion frequency" },
      { id: "out_quantum", kind: "outcome", label: "Quantum blessing yield" }
    );
    blind.graph.edges.push(
      { from: "opt_buy", to: "fac_alien", strength_mean: 0.1, strength_std: 0.2, exists_probability: 0.5, effect_direction: "positive" },
      { from: "fac_alien", to: "out_quantum", strength_mean: 0.9, strength_std: 0.1, exists_probability: 0.95, effect_direction: "positive" }
    );
    const hits = runSafetyCells(blind);
    expect(hits.some((h) => h.cell === "unsupported_causal_link" && h.element_id === "edge:fac_alien->out_quantum")).toBe(true);
  });

  it("stays quiet on the clean baseline graph", () => {
    expect(runSafetyCells(makeBlind())).toEqual([]);
  });

  it("briefNumberSet expands k/m/percent forms", () => {
    const numbers = briefNumberSet("budget of $200k, 3.5m users, 20% margin, 6 months");
    expect(numbers.has(200000)).toBe(true);
    expect(numbers.has(3500000)).toBe(true);
    expect(numbers.has(0.2)).toBe(true);
    expect(numbers.has(6)).toBe(true);
  });
});
