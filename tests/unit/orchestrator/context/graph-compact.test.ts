import { describe, it, expect } from "vitest";
import { compactGraph } from "../../../../src/orchestrator/context/graph-compact.js";
import type { GraphV3T } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeNode(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    kind: "factor" as const,
    label: `Label ${id}`,
    ...overrides,
  };
}

function makeEdge(from: string, to: string, overrides?: Record<string, unknown>) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: "positive" as const,
    ...overrides,
  };
}

function makeGraph(nodes: unknown[], edges: unknown[]): GraphV3T {
  return { nodes, edges } as unknown as GraphV3T;
}

// ============================================================================
// Tests
// ============================================================================

describe("compactGraph", () => {
  it("returns empty compact graph for empty input", () => {
    const result = compactGraph(makeGraph([], []));
    expect(result).toEqual({
      nodes: [],
      edges: [],
      _node_count: 0,
      _edge_count: 0,
    });
  });

  it("keeps only id, kind, label per node (drops heavy fields)", () => {
    const node = makeNode("node_a", {
      description: "long description",
      body: "should be dropped",
      state_space: { min: 0, max: 1 },
      goal_threshold: 0.8,
    });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes).toHaveLength(1);
    const n = result.nodes[0];
    expect(n.id).toBe("node_a");
    expect(n.kind).toBe("factor");
    expect(n.label).toBe("Label node_a");
    expect(n).not.toHaveProperty("description");
    expect(n).not.toHaveProperty("body");
    expect(n).not.toHaveProperty("state_space");
    expect(n).not.toHaveProperty("goal_threshold");
  });

  it("keeps only from, to, strength (mean), exists per edge (drops std, effect_direction, label)", () => {
    const edge = makeEdge("a", "b", { label: "some label" });
    const result = compactGraph(makeGraph([], [edge]));
    expect(result.edges).toHaveLength(1);
    const e = result.edges[0];
    expect(e.from).toBe("a");
    expect(e.to).toBe("b");
    expect(e.strength).toBe(0.5);
    expect(e.exists).toBe(0.9);
    expect(e).not.toHaveProperty("std");
    expect(e).not.toHaveProperty("effect_direction");
    expect(e).not.toHaveProperty("label");
  });

  it("defaults exists_probability to 0.8 when absent", () => {
    const edge = {
      from: "a",
      to: "b",
      strength: { mean: 0.6, std: 0.1 },
      // exists_probability intentionally absent
      effect_direction: "positive" as const,
    };
    const result = compactGraph(makeGraph([], [edge as unknown as GraphV3T['edges'][0]]));
    expect(result.edges[0].exists).toBe(0.8);
  });

  it("extracts observed_state.value, unit into node fields; drops baseline and std", () => {
    const node = makeNode("node_a", {
      observed_state: {
        value: 42,
        baseline: 100,
        unit: "USD",
        source: "brief_extraction",
        std: 5,
      },
    });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0].value).toBe(42);
    expect(result.nodes[0].unit).toBe("USD");
    // Heavy observed_state fields must not appear at node level
    expect(result.nodes[0]).not.toHaveProperty("baseline");
    expect(result.nodes[0]).not.toHaveProperty("std");
  });

  it("omits value when observed_state is absent", () => {
    const node = makeNode("node_a");
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0]).not.toHaveProperty("value");
  });

  it("includes category when present", () => {
    const node = makeNode("node_a", { category: "controllable" });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0].category).toBe("controllable");
  });

  it("omits category when absent", () => {
    const node = makeNode("node_a");
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0]).not.toHaveProperty("category");
  });

  it("sorts nodes by id", () => {
    const nodes = [makeNode("node_z"), makeNode("node_a"), makeNode("node_m")];
    const result = compactGraph(makeGraph(nodes, []));
    expect(result.nodes.map((n) => n.id)).toEqual(["node_a", "node_m", "node_z"]);
  });

  it("sorts edges by from then to", () => {
    const edges = [
      makeEdge("b", "c"),
      makeEdge("a", "z"),
      makeEdge("a", "b"),
      makeEdge("b", "a"),
    ];
    const result = compactGraph(makeGraph([], edges));
    const pairs = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(pairs).toEqual(["a→b", "a→z", "b→a", "b→c"]);
  });

  it("populates _node_count and _edge_count correctly", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const result = compactGraph(makeGraph(nodes, edges));
    expect(result._node_count).toBe(3);
    expect(result._edge_count).toBe(2);
  });

  it("is deterministic — same input produces byte-identical JSON output", () => {
    const nodes = [makeNode("z"), makeNode("a"), makeNode("m")];
    const edges = [makeEdge("z", "a"), makeEdge("a", "m")];
    const graph = makeGraph(nodes, edges);

    const output1 = JSON.stringify(compactGraph(graph));
    const output2 = JSON.stringify(compactGraph(graph));
    expect(output1).toBe(output2);
  });

  // ==========================================================================
  // intervention_summary
  // ==========================================================================

  it("option node with interventions produces intervention_summary with resolved labels", () => {
    const nodes = [
      makeNode("fac_ai", { kind: "factor", label: "AI Expertise" }),
      makeNode("fac_cost", { kind: "factor", label: "Cost" }),
      makeNode("fac_velocity", { kind: "factor", label: "Velocity" }),
      makeNode("opt_a", {
        kind: "option",
        label: "Option A",
        data: { interventions: { fac_ai: 0.9, fac_cost: 0.7, fac_velocity: 0.8 } },
      }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_a")!;
    expect(optNode.intervention_summary).toBe("sets AI Expertise=0.9, Cost=0.7, Velocity=0.8");
  });

  it("option node without interventions has no intervention_summary", () => {
    const nodes = [
      makeNode("opt_b", { kind: "option", label: "Option B" }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_b")!;
    expect(optNode).not.toHaveProperty("intervention_summary");
  });

  it("option node with empty interventions has no intervention_summary", () => {
    const nodes = [
      makeNode("opt_c", { kind: "option", label: "Option C", data: { interventions: {} } }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_c")!;
    expect(optNode).not.toHaveProperty("intervention_summary");
  });

  it("intervention_summary uses factor labels not IDs", () => {
    const nodes = [
      makeNode("fac_x", { kind: "factor", label: "Revenue Growth" }),
      makeNode("opt_d", {
        kind: "option",
        label: "Option D",
        data: { interventions: { fac_x: 0.5 } },
      }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_d")!;
    expect(optNode.intervention_summary).toBe("sets Revenue Growth=0.5");
    expect(optNode.intervention_summary).not.toContain("fac_x");
  });

  it("intervention_summary truncates beyond 5 entries", () => {
    const factorNodes = Array.from({ length: 7 }, (_, i) =>
      makeNode(`fac_${i}`, { kind: "factor", label: `Factor ${i}` }),
    );
    const interventions: Record<string, number> = {};
    for (let i = 0; i < 7; i++) interventions[`fac_${i}`] = i * 0.1;
    const optNode = makeNode("opt_many", {
      kind: "option",
      label: "Many Interventions",
      data: { interventions },
    });
    const result = compactGraph(makeGraph([...factorNodes, optNode], []));
    const compact = result.nodes.find((n) => n.id === "opt_many")!;
    expect(compact.intervention_summary).toContain("...and 2 more");
  });

  it("factor nodes never get intervention_summary even with data field", () => {
    const nodes = [
      makeNode("fac_a", {
        kind: "factor",
        label: "Factor A",
        data: { interventions: { fac_b: 0.5 } },
      }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    expect(result.nodes[0]).not.toHaveProperty("intervention_summary");
  });

  // ==========================================================================
  // plain_interpretation
  // ==========================================================================

  it("causal edge produces correct plain_interpretation — positive strong high confidence", () => {
    const nodes = [
      makeNode("fac_price", { kind: "factor", label: "Pro Plan Price Level" }),
      makeNode("fac_churn", { kind: "factor", label: "Monthly Churn Rate" }),
    ];
    const edge = makeEdge("fac_price", "fac_churn", {
      strength: { mean: 0.8, std: 0.07 },
      effect_direction: "positive",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toBe(
      "Pro Plan Price Level strongly increases Monthly Churn Rate (high confidence)",
    );
  });

  it("causal edge produces correct plain_interpretation — negative weak uncertain", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "Marketing Spend" }),
      makeNode("b", { kind: "factor", label: "Customer Acquisition" }),
    ];
    const edge = makeEdge("a", "b", {
      strength: { mean: -0.2, std: 0.25 },
      effect_direction: "negative",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toBe(
      "Marketing Spend weakly decreases Customer Acquisition (uncertain)",
    );
  });

  it("causal edge produces correct plain_interpretation — moderate with moderate confidence", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "Factor A" }),
      makeNode("b", { kind: "factor", label: "Factor B" }),
    ];
    const edge = makeEdge("a", "b", {
      strength: { mean: 0.5, std: 0.15 },
      effect_direction: "positive",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toBe(
      "Factor A moderately increases Factor B (moderate confidence)",
    );
  });

  it("decision→option structural edges have no plain_interpretation (by node kind)", () => {
    const nodes = [
      makeNode("dec_1", { kind: "decision", label: "Decision" }),
      makeNode("opt_1", { kind: "option", label: "Option 1" }),
    ];
    const edge = makeEdge("dec_1", "opt_1", {
      strength: { mean: 1.0, std: 0.01 },
      effect_direction: "positive",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0]).not.toHaveProperty("plain_interpretation");
  });

  it("option→factor structural edges have no plain_interpretation (by node kind)", () => {
    const nodes = [
      makeNode("opt_1", { kind: "option", label: "Option 1" }),
      makeNode("fac_1", { kind: "factor", label: "Revenue" }),
    ];
    const edge = makeEdge("opt_1", "fac_1", {
      strength: { mean: 0.8, std: 0.05 },
      effect_direction: "positive",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0]).not.toHaveProperty("plain_interpretation");
  });

  it("real causal factor→factor edge with mean=1.0 DOES get plain_interpretation", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "Factor A" }),
      makeNode("b", { kind: "factor", label: "Factor B" }),
    ];
    const edge = makeEdge("a", "b", {
      strength: { mean: 1.0, std: 0.05 },
      effect_direction: "positive",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toBe(
      "Factor A strongly increases Factor B (high confidence)",
    );
  });

  it("bidirected edges have no plain_interpretation", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "Factor A" }),
      makeNode("b", { kind: "factor", label: "Factor B" }),
    ];
    const edge = makeEdge("a", "b", {
      strength: { mean: 0.6, std: 0.1 },
      effect_direction: "positive",
      edge_type: "bidirected",
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0]).not.toHaveProperty("plain_interpretation");
  });

  it("edge with zero mean has no plain_interpretation", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", {
      strength: { mean: 0, std: 0.1 },
    });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0]).not.toHaveProperty("plain_interpretation");
  });

  it("edge direction derived from mean sign when effect_direction absent", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = {
      from: "a",
      to: "b",
      strength: { mean: -0.6, std: 0.08 },
      exists_probability: 0.9,
      // effect_direction intentionally absent
    };
    const result = compactGraph(makeGraph(nodes, [edge as unknown as GraphV3T['edges'][0]]));
    expect(result.edges[0].plain_interpretation).toContain("decreases");
    expect(result.edges[0].plain_interpretation).toContain("high confidence");
  });

  it("unresolved intervention factor IDs are omitted — raw IDs never surface", () => {
    const nodes = [
      makeNode("fac_known", { kind: "factor", label: "Known Factor" }),
      makeNode("opt_e", {
        kind: "option",
        label: "Option E",
        data: { interventions: { fac_known: 0.5, unknown_id: 0.9 } },
      }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_e")!;
    expect(optNode.intervention_summary).toBe("sets Known Factor=0.5");
    expect(optNode.intervention_summary).not.toContain("unknown_id");
  });

  it("intervention_summary omitted entirely when all factor IDs are unresolved", () => {
    const nodes = [
      makeNode("opt_f", {
        kind: "option",
        label: "Option F",
        data: { interventions: { no_match_1: 0.5, no_match_2: 0.9 } },
      }),
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const optNode = result.nodes.find((n) => n.id === "opt_f")!;
    expect(optNode).not.toHaveProperty("intervention_summary");
  });

  // ==========================================================================
  // Confidence boundary pinning (std thresholds)
  // ==========================================================================

  it("std=0.05 → high confidence (inclusive lower bound)", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.05 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toContain("(high confidence)");
  });

  it("std=0.0999 → high confidence (just below 0.10 boundary)", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.0999 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toContain("(high confidence)");
  });

  it("std=0.10 → moderate confidence (boundary is exclusive for high)", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.10 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toContain("(moderate confidence)");
  });

  it("std=0.1999 → moderate confidence (just below 0.20 boundary)", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.1999 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toContain("(moderate confidence)");
  });

  it("std=0.20 → uncertain (inclusive lower bound)", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.20 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    expect(result.edges[0].plain_interpretation).toContain("(uncertain)");
  });

  it("std < 0.05 → no confidence qualifier", () => {
    const nodes = [
      makeNode("a", { kind: "factor", label: "A" }),
      makeNode("b", { kind: "factor", label: "B" }),
    ];
    const edge = makeEdge("a", "b", { strength: { mean: 0.5, std: 0.03 } });
    const result = compactGraph(makeGraph(nodes, [edge]));
    const interp = result.edges[0].plain_interpretation!;
    expect(interp).not.toContain("confidence");
    expect(interp).not.toContain("uncertain");
  });

  // ==========================================================================
  // Provenance projection (Tier 2 — display-safe vocabulary alongside `source`)
  // ==========================================================================

  // _raw_provenance is emitted ONLY for unrecognised upstream values — the
  // four canonical extractionType values are recoverable from `provenance` +
  // the mapping table, so emitting them here would just burn LLM context
  // tokens (see CompactNode._raw_provenance docstring).

  it("node extractionType=explicit → provenance=from_brief, source=user, no _raw_provenance", () => {
    const node = makeNode("n_explicit", { observed_state: { value: 10, extractionType: "explicit" } });
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.source).toBe("user");
    expect(n.provenance).toBe("from_brief");
    expect(n).not.toHaveProperty("_raw_provenance");
  });

  it("node extractionType=observed → provenance=from_brief, source=system, no _raw_provenance", () => {
    const node = makeNode("n_observed", { observed_state: { value: 10, extractionType: "observed" } });
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.source).toBe("system");
    expect(n.provenance).toBe("from_brief");
    expect(n).not.toHaveProperty("_raw_provenance");
  });

  it("node extractionType=inferred → provenance=ai_inferred, source=assumption, no _raw_provenance", () => {
    const node = makeNode("n_inferred", { observed_state: { value: 10, extractionType: "inferred" } });
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.source).toBe("assumption");
    expect(n.provenance).toBe("ai_inferred");
    expect(n).not.toHaveProperty("_raw_provenance");
  });

  it("node extractionType=range → provenance=ai_inferred, source=system, no _raw_provenance", () => {
    const node = makeNode("n_range", { observed_state: { value: 10, extractionType: "range" } });
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.source).toBe("system");
    expect(n.provenance).toBe("ai_inferred");
    expect(n).not.toHaveProperty("_raw_provenance");
  });

  it("node unknown extractionType → provenance=ai_inferred, _raw_provenance preserves the raw string", () => {
    const node = makeNode("n_unknown", { observed_state: { value: 10, extractionType: "future_unknown_value" } });
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.provenance).toBe("ai_inferred");
    expect(n._raw_provenance).toBe("future_unknown_value");
  });

  it("node with no observed_state → provenance=ai_inferred, no _raw_provenance", () => {
    const node = makeNode("n_no_obs");
    const result = compactGraph(makeGraph([node], []));
    const n = result.nodes[0];
    expect(n.source).toBe("system");
    expect(n.provenance).toBe("ai_inferred");
    expect(n).not.toHaveProperty("_raw_provenance");
  });

  it("edge provenance.source=brief_extraction → provenance=from_brief, no _raw_provenance", () => {
    const edge = makeEdge("a", "b", { provenance: { source: "brief_extraction" } });
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("from_brief");
    expect(e).not.toHaveProperty("_raw_provenance");
  });

  it("edge provenance.source=user_specified → provenance=user_set, no _raw_provenance", () => {
    const edge = makeEdge("a", "b", { provenance: { source: "user_specified" } });
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("user_set");
    expect(e).not.toHaveProperty("_raw_provenance");
  });

  it("edge provenance.source=cee_hypothesis → provenance=ai_inferred, no _raw_provenance", () => {
    const edge = makeEdge("a", "b", { provenance: { source: "cee_hypothesis" } });
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("ai_inferred");
    expect(e).not.toHaveProperty("_raw_provenance");
  });

  it("edge provenance.source=domain_knowledge → provenance=ai_inferred, no _raw_provenance", () => {
    const edge = makeEdge("a", "b", { provenance: { source: "domain_knowledge" } });
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("ai_inferred");
    expect(e).not.toHaveProperty("_raw_provenance");
  });

  it("edge with no provenance field → provenance=ai_inferred, no _raw_provenance", () => {
    const edge = makeEdge("a", "b");
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("ai_inferred");
    expect(e).not.toHaveProperty("_raw_provenance");
  });

  it("edge unknown provenance.source → provenance=ai_inferred, _raw_provenance preserves the raw string", () => {
    const edge = makeEdge("a", "b", { provenance: { source: "future_source_value" } });
    const result = compactGraph(makeGraph([], [edge]));
    const e = result.edges[0];
    expect(e.provenance).toBe("ai_inferred");
    expect(e._raw_provenance).toBe("future_source_value");
  });

  it("aggregate _node_count / _edge_count are unchanged by the provenance projection", () => {
    const nodes = [
      makeNode("a", { observed_state: { value: 1, extractionType: "explicit" } }),
      makeNode("b", { observed_state: { value: 2, extractionType: "inferred" } }),
    ];
    const edges = [makeEdge("a", "b", { provenance: { source: "brief_extraction" } })];
    const result = compactGraph(makeGraph(nodes, edges));
    expect(result._node_count).toBe(2);
    expect(result._edge_count).toBe(1);
  });

  it("legacy `source` field still emits today's vocabulary unchanged (regression)", () => {
    // Three nodes covering all three legacy source values.
    const nodes = [
      makeNode("u", { observed_state: { value: 1, extractionType: "explicit" } }),  // → user
      makeNode("a", { observed_state: { value: 2, extractionType: "inferred" } }),  // → assumption
      makeNode("s", { observed_state: { value: 3, extractionType: "range" } }),     // → system
    ];
    const result = compactGraph(makeGraph(nodes, []));
    const sourceById = Object.fromEntries(result.nodes.map((n) => [n.id, n.source]));
    expect(sourceById).toEqual({ u: "user", a: "assumption", s: "system" });
  });

  it("token size: realistic 10-node graph serialises to < 1500 tokens", () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode(`node_${i.toString().padStart(2, "0")}`, {
        kind: i === 0 ? "goal" : "factor",
        observed_state: { value: i * 10, baseline: 100, unit: "GBP" },
        category: "controllable",
      }),
    );
    const edges = Array.from({ length: 15 }, (_, i) => ({
      from: `node_${(i % 9 + 1).toString().padStart(2, "0")}`,
      to: `node_0${i % 5}`,
      strength: { mean: 0.5 + i * 0.02, std: 0.1 },
      exists_probability: 0.85,
      effect_direction: "positive" as const,
    }));
    const graph = makeGraph(nodes, edges);
    const compact = compactGraph(graph as unknown as GraphV3T);
    const json = JSON.stringify(compact);
    const estimatedTokens = Math.ceil(json.length / 4);
    expect(estimatedTokens).toBeLessThan(1500);
  });
});
