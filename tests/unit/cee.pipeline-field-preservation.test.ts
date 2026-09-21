/**
 * CEE Pipeline Field Preservation Tests
 *
 * End-to-end contract test verifying that LLM-output fields survive the
 * full Zod parse → enrichment pipeline:
 *   - category on factor nodes
 *   - data.interventions on option nodes
 *   - no synthetic factor injection when V4 interventions are complete
 *
 * Based on olumi-debug-e0fa6878 personal assistant brief output.
 */

import { describe, it, expect } from "vitest";
import { Graph } from "../../src/schemas/graph.js";
import { enrichGraphWithFactorsAsync } from "../../src/cee/factor-extraction/enricher.js";
import type { GraphT } from "../../src/schemas/graph.js";

/**
 * Simulated LLM raw output for personal assistant brief.
 * Contains factor nodes with category and option nodes with data.interventions.
 */
const LLM_RAW_GRAPH = {
  version: "1",
  default_seed: 17,
  nodes: [
    {
      id: "goal_reduce_costs",
      kind: "goal",
      label: "Reduce Operating Costs",
    },
    {
      id: "dec_staffing",
      kind: "decision",
      label: "Staffing Model",
    },
    {
      id: "opt_hire_pa",
      kind: "option",
      label: "Hire Personal Assistant",
      data: {
        interventions: {
          fac_pa_cost: 1.0,
          fac_productivity: 0.8,
        },
      },
    },
    {
      id: "opt_status_quo",
      kind: "option",
      label: "Maintain Current Setup",
      data: {
        interventions: {
          fac_pa_cost: 0.0,
          fac_productivity: 0.0,
        },
      },
    },
    {
      id: "fac_pa_cost",
      kind: "factor",
      label: "Personal Assistant Cost",
      category: "controllable",
      data: {
        value: 0.6,
        raw_value: 30000,
        cap: 50000,
        unit: "£",
        factor_type: "cost",
        uncertainty_drivers: ["salary negotiation range"],
      },
    },
    {
      id: "fac_productivity",
      kind: "factor",
      label: "Productivity Gain",
      category: "observable",
      data: {
        value: 0.3,
        unit: "%",
        factor_type: "quality",
        uncertainty_drivers: ["individual variation"],
      },
    },
    {
      id: "fac_market_rate",
      kind: "factor",
      label: "Market Rate",
      category: "external",
      data: {
        value: 0.5,
        raw_value: 28000,
        cap: 50000,
        unit: "£",
        factor_type: "price",
      },
    },
    {
      id: "out_net_savings",
      kind: "outcome",
      label: "Net Annual Savings",
    },
  ],
  edges: [
    { from: "dec_staffing", to: "opt_hire_pa" },
    { from: "dec_staffing", to: "opt_status_quo" },
    { from: "opt_hire_pa", to: "fac_pa_cost" },
    { from: "opt_hire_pa", to: "fac_productivity" },
    { from: "opt_status_quo", to: "fac_pa_cost" },
    { from: "opt_status_quo", to: "fac_productivity" },
    { from: "fac_pa_cost", to: "out_net_savings" },
    { from: "fac_productivity", to: "out_net_savings" },
    { from: "fac_market_rate", to: "out_net_savings" },
    { from: "out_net_savings", to: "goal_reduce_costs" },
  ],
  meta: {
    roots: ["dec_staffing"],
    leaves: ["goal_reduce_costs"],
    suggested_positions: {},
    source: "assistant" as const,
  },
};

describe("CEE pipeline field preservation", () => {
  let parsed: GraphT;

  it("LLM raw output survives Graph.parse without field stripping", () => {
    parsed = Graph.parse(LLM_RAW_GRAPH);

    // category preserved on ALL factor nodes
    const factorNodes = parsed.nodes.filter(n => n.kind === "factor");
    expect(factorNodes.length).toBe(3);
    for (const factor of factorNodes) {
      expect(factor.category).toBeDefined();
      expect(["controllable", "observable", "external"]).toContain(factor.category);
    }
    expect(parsed.nodes.find(n => n.id === "fac_pa_cost")?.category).toBe("controllable");
    expect(parsed.nodes.find(n => n.id === "fac_productivity")?.category).toBe("observable");
    expect(parsed.nodes.find(n => n.id === "fac_market_rate")?.category).toBe("external");

    // data.interventions preserved on ALL option nodes
    const optionNodes = parsed.nodes.filter(n => n.kind === "option");
    expect(optionNodes.length).toBe(2);
    for (const opt of optionNodes) {
      expect(opt.data).toBeDefined();
      expect(opt.data).toHaveProperty("interventions");
      const interventions = (opt.data as any).interventions;
      expect(Object.keys(interventions).length).toBeGreaterThan(0);
    }

    // Specific intervention values
    const hireOpt = parsed.nodes.find(n => n.id === "opt_hire_pa");
    expect((hireOpt?.data as any).interventions).toEqual({
      fac_pa_cost: 1.0,
      fac_productivity: 0.8,
    });
  });

  it("enrichment skips injection when V4 interventions are complete", async () => {
    parsed = Graph.parse(LLM_RAW_GRAPH);

    const brief = "Should I hire a personal assistant for £30,000/year to improve productivity by 30%?";
    const result = await enrichGraphWithFactorsAsync(parsed, brief);

    // Enricher early exit
    expect(result.extractionMode).toBe("v4_complete_skip");
    expect(result.factorsAdded).toBe(0);

    // No synthetic factors injected
    const allFactors = result.graph.nodes.filter(n => n.kind === "factor");
    expect(allFactors.length).toBe(3); // Only the original three
    const syntheticFactors = allFactors.filter(n =>
      n.id.startsWith("factor_") && !["fac_pa_cost", "fac_productivity", "fac_market_rate"].includes(n.id)
    );
    expect(syntheticFactors.length).toBe(0);

    // category still preserved after enrichment
    for (const factor of allFactors) {
      expect(factor.category).toBeDefined();
    }

    // interventions still preserved after enrichment
    const optionNodes = result.graph.nodes.filter(n => n.kind === "option");
    for (const opt of optionNodes) {
      expect(opt.data).toHaveProperty("interventions");
      const interventions = (opt.data as any).interventions;
      expect(Object.keys(interventions).length).toBeGreaterThan(0);
    }
  });
});
