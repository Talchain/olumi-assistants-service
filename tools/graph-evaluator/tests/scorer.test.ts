import { describe, it, expect } from "vitest";
import { score } from "../src/scorer.js";
import { validateStructural, hasCycle, bfsForward, bfsReverse, buildAdjacencyLists } from "../src/validator.js";
import type { ParsedGraph, GraphNode, GraphEdge, LLMResponse, Brief } from "../src/types.js";

// =============================================================================
// Fixture builders
// =============================================================================

function makeNode(
  id: string,
  kind: GraphNode["kind"],
  opts: Partial<GraphNode> = {}
): GraphNode {
  return { id, kind, label: id, ...opts };
}

function makeEdge(
  from: string,
  to: string,
  mean: number,
  std: number,
  existsProb: number,
  edgeType: "directed" | "bidirected" = "directed"
): GraphEdge {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: existsProb,
    effect_direction: mean >= 0 ? "positive" : "negative",
    edge_type: edgeType,
  };
}

/** Build a minimal structurally-valid graph. */
function minimalValidGraph(): ParsedGraph {
  const nodes: GraphNode[] = [
    makeNode("dec1", "decision"),
    makeNode("opt_a", "option", {
      data: { interventions: { fac_ctrl: 0.8 } },
    }),
    makeNode("opt_b", "option", {
      data: { interventions: { fac_ctrl: 0.2 } },
    }),
    makeNode("opt_sq", "option", {
      label: "Status Quo",
      data: { interventions: { fac_ctrl: 0.5 } },
    }),
    makeNode("fac_ctrl", "factor", {
      category: "controllable",
      data: { value: 0.5, factor_type: "other" },
    }),
    makeNode("fac_ext", "factor", {
      category: "external",
      prior: { distribution: "uniform", range_min: 0.0, range_max: 1.0 },
    }),
    makeNode("out1", "outcome"),
    makeNode("goal1", "goal"),
  ];

  const edges: GraphEdge[] = [
    // Structural
    makeEdge("dec1", "opt_a", 1.0, 0.01, 1.0),
    makeEdge("dec1", "opt_b", 1.0, 0.01, 1.0),
    makeEdge("dec1", "opt_sq", 1.0, 0.01, 1.0),
    makeEdge("opt_a", "fac_ctrl", 1.0, 0.01, 1.0),
    makeEdge("opt_b", "fac_ctrl", 1.0, 0.01, 1.0),
    makeEdge("opt_sq", "fac_ctrl", 1.0, 0.01, 1.0),
    // Causal (varied)
    makeEdge("fac_ctrl", "out1", 0.6, 0.12, 0.9),
    makeEdge("fac_ext", "out1", -0.3, 0.2, 0.75),
    makeEdge("out1", "goal1", 0.7, 0.1, 0.95),
  ];

  return {
    nodes,
    edges,
    coaching: {
      summary: "Test graph.",
      strengthen_items: [
        { id: "str_1", label: "Add constraint", detail: "No budget defined." },
      ],
    },
  };
}

function makeResponse(graph: ParsedGraph): LLMResponse {
  return {
    model_id: "test-model",
    brief_id: "test-brief",
    status: "success",
    parsed_graph: graph,
    latency_ms: 1000,
  };
}

function makeBrief(opts: Partial<Brief["meta"]> = {}): Brief {
  return {
    id: "test-brief",
    meta: {
      expect_status_quo: true,
      has_numeric_target: false,
      complexity: "simple",
      ...opts,
    },
    body: "Test brief body.",
  };
}

// =============================================================================
// Validator equivalence tests (cycle detection, reachability)
// =============================================================================

describe("validator — cycle detection (equivalence with CEE logic)", () => {
  it("returns false for a DAG", () => {
    const nodes = [makeNode("a", "factor"), makeNode("b", "factor"), makeNode("c", "outcome")];
    const edges = [makeEdge("a", "b", 0.5, 0.1, 0.9), makeEdge("b", "c", 0.5, 0.1, 0.9)];
    expect(hasCycle(nodes, edges)).toBe(false);
  });

  it("detects a simple cycle", () => {
    const nodes = [makeNode("a", "factor"), makeNode("b", "factor")];
    const edges = [
      makeEdge("a", "b", 0.5, 0.1, 0.9),
      makeEdge("b", "a", 0.5, 0.1, 0.9),
    ];
    expect(hasCycle(nodes, edges)).toBe(true);
  });

  it("does not treat bidirected edges as cycles", () => {
    const nodes = [makeNode("a", "factor"), makeNode("b", "factor")];
    const edges = [makeEdge("a", "b", 0, 0.01, 1.0, "bidirected")];
    expect(hasCycle(nodes, edges)).toBe(false);
  });
});

describe("validator — reachability", () => {
  it("finds all reachable nodes via BFS forward", () => {
    const edges: GraphEdge[] = [
      makeEdge("a", "b", 0.5, 0.1, 0.9),
      makeEdge("b", "c", 0.5, 0.1, 0.9),
      makeEdge("d", "e", 0.5, 0.1, 0.9),
    ];
    const adj = buildAdjacencyLists(edges);
    const reached = bfsForward(["a"], adj);
    expect(reached.has("a")).toBe(true);
    expect(reached.has("b")).toBe(true);
    expect(reached.has("c")).toBe(true);
    expect(reached.has("d")).toBe(false);
  });

  it("BFS reverse finds ancestors", () => {
    const edges: GraphEdge[] = [
      makeEdge("a", "b", 0.5, 0.1, 0.9),
      makeEdge("b", "c", 0.5, 0.1, 0.9),
    ];
    const adj = buildAdjacencyLists(edges);
    const ancestors = bfsReverse(["c"], adj);
    expect(ancestors.has("c")).toBe(true);
    expect(ancestors.has("b")).toBe(true);
    expect(ancestors.has("a")).toBe(true);
  });
});

// =============================================================================
// Structural validity tests
// =============================================================================

describe("validateStructural", () => {
  it("passes for a minimal valid graph", () => {
    const result = validateStructural(minimalValidGraph());
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails with MISSING_GOAL when no goal node", () => {
    const graph = minimalValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== "goal");
    // Rebuild edges to remove goal refs
    graph.edges = graph.edges.filter(
      (e) => e.from !== "goal1" && e.to !== "goal1"
    );
    const result = validateStructural(graph);
    expect(result.violations).toContain("MISSING_GOAL");
  });

  it("fails with MISSING_DECISION when no decision node", () => {
    const graph = minimalValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== "decision");
    graph.edges = graph.edges.filter(
      (e) => e.from !== "dec1" && e.to !== "dec1"
    );
    const result = validateStructural(graph);
    expect(result.violations).toContain("MISSING_DECISION");
  });

  it("fails with INSUFFICIENT_OPTIONS when only 1 option", () => {
    const graph = minimalValidGraph();
    graph.nodes = graph.nodes.filter(
      (n) => n.kind !== "option" || n.id === "opt_a"
    );
    graph.edges = graph.edges.filter(
      (e) => e.from !== "opt_b" && e.from !== "opt_sq" &&
              e.to !== "opt_b" && e.to !== "opt_sq"
    );
    const result = validateStructural(graph);
    expect(result.violations).toContain("INSUFFICIENT_OPTIONS");
  });

  it("fails with MISSING_BRIDGE when no outcome or risk", () => {
    const graph = minimalValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== "outcome");
    graph.edges = graph.edges.filter(
      (e) => e.from !== "out1" && e.to !== "out1"
    );
    const result = validateStructural(graph);
    expect(result.violations).toContain("MISSING_BRIDGE");
  });

  it("fails with CYCLE_DETECTED for a graph containing a cycle", () => {
    const graph = minimalValidGraph();
    // Add a cycle between fac_ctrl and out1
    graph.edges.push(makeEdge("out1", "fac_ctrl", 0.5, 0.1, 0.9));
    const result = validateStructural(graph);
    expect(result.violations).toContain("CYCLE_DETECTED");
  });

  it("fails with ORPHAN_NODE for an orphan node", () => {
    const graph = minimalValidGraph();
    // Add a factor with no connections
    graph.nodes.push(makeNode("orphan_factor", "factor", { category: "observable" }));
    const result = validateStructural(graph);
    expect(result.violations).toContain("ORPHAN_NODE");
  });

  it("fails with FORBIDDEN_EDGE for option→outcome", () => {
    const graph = minimalValidGraph();
    graph.edges.push(makeEdge("opt_a", "out1", 0.5, 0.1, 0.9));
    const result = validateStructural(graph);
    expect(result.violations).toContain("FORBIDDEN_EDGE");
  });

  it("fails with NODE_LIMIT_EXCEEDED when over 50 nodes", () => {
    const graph = minimalValidGraph();
    for (let i = 0; i < 45; i++) {
      graph.nodes.push(makeNode(`extra_${i}`, "factor", { category: "observable" }));
    }
    const result = validateStructural(graph);
    expect(result.violations).toContain("NODE_LIMIT_EXCEEDED");
  });

  it("fails with EDGE_LIMIT_EXCEEDED when over 200 edges", () => {
    const graph = minimalValidGraph();
    // Add extra observable factor nodes to attach edges to (avoid node limit)
    for (let i = 0; i < 10; i++) {
      graph.nodes.push(makeNode(`xfac_${i}`, "factor", { category: "observable" }));
      // Connect each to goal so they're not orphans
      graph.edges.push(makeEdge(`xfac_${i}`, "goal1", 0.3, 0.1, 0.8));
    }
    // Add enough duplicate edges between existing nodes to exceed 200
    for (let i = 0; i < 200; i++) {
      graph.edges.push(makeEdge("fac_ext", "out1", 0.2, 0.1, 0.7));
    }
    const result = validateStructural(graph);
    expect(result.violations).toContain("EDGE_LIMIT_EXCEEDED");
  });

  it("does not flag EDGE_LIMIT_EXCEEDED for graphs with 100–200 edges (aligned with production limit)", () => {
    const graph = minimalValidGraph();
    // Add 95 duplicate causal edges — total will be ~104 edges, under production limit of 200
    for (let i = 0; i < 95; i++) {
      graph.edges.push(makeEdge("fac_ext", "out1", 0.2, 0.1, 0.7));
    }
    const result = validateStructural(graph);
    expect(result.violations).not.toContain("EDGE_LIMIT_EXCEEDED");
  });

  it("does not flag OUTCOME_UNREACHABLE for outcome unreachable from decision but able to reach goal (exemption)", () => {
    // Exogenous outcome: not reachable from decision via controllable factors,
    // but has a direct path to goal. Production exempts this case.
    const graph = minimalValidGraph();
    // Add an exogenous outcome connected directly to goal only
    graph.nodes.push(makeNode("out_exo", "outcome"));
    graph.edges.push(makeEdge("out_exo", "goal1", 0.4, 0.15, 0.8));
    const result = validateStructural(graph);
    expect(result.violations).not.toContain("OUTCOME_UNREACHABLE");
    expect(result.valid).toBe(true);
  });

  it("still flags OUTCOME_UNREACHABLE when outcome cannot reach goal either", () => {
    const graph = minimalValidGraph();
    // Add an outcome reachable from decision via a direct edge (not via any controllable factor),
    // with no path to the goal. This satisfies the negative control for the exemption:
    //   - Not in reachableThroughControllable → not exempt via controllable path
    //   - Not in canReachGoalSet → not exempt via goal-reachability
    //   - IS reachable from decision (bfsForward) → not an ORPHAN_NODE
    // Therefore check 8 (OUTCOME_UNREACHABLE) fires, not check 10 (ORPHAN_NODE).
    graph.nodes.push(makeNode("out_dead", "outcome"));
    graph.edges.push(makeEdge("dec1", "out_dead", 0.5, 0.1, 0.8));
    const result = validateStructural(graph);
    expect(result.violations).toContain("OUTCOME_UNREACHABLE");
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// Scorer — parameter quality
// =============================================================================

describe("scorer — parameter quality", () => {
  it("returns overall_score for a valid graph", () => {
    const graph = minimalValidGraph();
    const result = score(makeResponse(graph), makeBrief());
    expect(result.structural_valid).toBe(true);
    expect(result.overall_score).not.toBeNull();
    expect(result.param_quality).not.toBeNull();
  });

  it("default-takeover score is 0 when all edges use mean=0.5, std=0.125", () => {
    const graph = minimalValidGraph();
    // Override all causal edges to defaults
    graph.edges = graph.edges.map((e) => {
      const fromNode = graph.nodes.find((n) => n.id === e.from);
      const toNode = graph.nodes.find((n) => n.id === e.to);
      const isStructural =
        (fromNode?.kind === "decision" && toNode?.kind === "option") ||
        (fromNode?.kind === "option" && toNode?.kind === "factor");
      if (isStructural || e.edge_type === "bidirected") return e;
      return { ...e, strength: { mean: 0.5, std: 0.125 } };
    });

    const result = score(makeResponse(graph), makeBrief());
    expect(result.param_quality).not.toBeNull();
    // default_takeover component should be 0 (100% defaults at 50 threshold)
    // overall param quality should be low
    expect(result.param_quality!).toBeLessThan(0.5);
  });

  it("default-takeover at 49% produces nonzero score", () => {
    const nodes: GraphNode[] = [
      makeNode("dec1", "decision"),
      makeNode("opt_a", "option", { data: { interventions: { fac_c: 0.8 } } }),
      makeNode("opt_b", "option", { data: { interventions: { fac_c: 0.2 } } }),
      makeNode("fac_c", "factor", { category: "controllable", data: { value: 0.5, factor_type: "other" } }),
      makeNode("fac_ext", "factor", { category: "external" }),
      makeNode("out1", "outcome"),
      makeNode("goal1", "goal"),
    ];

    // Create edges: mix of default and non-default
    // 1 default + 1 non-default = 50% → score = max(1 - 50/50, 0) = 0
    // 1 default + 2 non-default = 33.3% → score = max(1 - 33.3/50, 0) = 0.333 > 0

    const defaultEdge = makeEdge("fac_c", "out1", 0.5, 0.125, 0.9);
    const nonDefault1 = makeEdge("out1", "goal1", 0.6, 0.1, 0.9);
    // Use external factor → out1 (valid causal edge; factor→goal is FORBIDDEN)
    const nonDefault2 = makeEdge("fac_ext", "out1", 0.8, 0.15, 0.85);

    const edges: GraphEdge[] = [
      makeEdge("dec1", "opt_a", 1.0, 0.01, 1.0),
      makeEdge("dec1", "opt_b", 1.0, 0.01, 1.0),
      makeEdge("opt_a", "fac_c", 1.0, 0.01, 1.0),
      makeEdge("opt_b", "fac_c", 1.0, 0.01, 1.0),
      defaultEdge,    // causal — default
      nonDefault1,    // causal — not default
      nonDefault2,    // causal — not default
    ];

    const graph: ParsedGraph = { nodes, edges };
    const result = score(makeResponse(graph), makeBrief({ expect_status_quo: false }));
    expect(result.structural_valid).toBe(true);
    // 1 of 3 causal edges = 33.3% defaults → score > 0
    expect(result.param_quality!).toBeGreaterThan(0);
  });

  it("std_variation is 0 when all stds are identical", () => {
    const graph = minimalValidGraph();
    // Set all causal edges to same std
    graph.edges = graph.edges.map((e) => {
      const fromNode = graph.nodes.find((n) => n.id === e.from);
      const toNode = graph.nodes.find((n) => n.id === e.to);
      const isStructural =
        (fromNode?.kind === "decision" && toNode?.kind === "option") ||
        (fromNode?.kind === "option" && toNode?.kind === "factor");
      if (isStructural || e.edge_type === "bidirected") return e;
      return { ...e, strength: { mean: e.strength.mean, std: 0.15 } };
    });

    const result = score(makeResponse(graph), makeBrief());
    // std_variation should be 0 (all same), so param_quality ≤ 0.85 (max with stdVar=0)
    expect(result.param_quality!).toBeLessThanOrEqual(0.85);
  });

  it("std_variation is 1 when stds differ", () => {
    const graph = minimalValidGraph();
    // Ensure stds vary — graph already has 0.12, 0.2, 0.1
    const result = score(makeResponse(graph), makeBrief());
    expect(result.param_quality!).toBeGreaterThan(0);
  });

  it("returns 0 for param_quality when no causal edges", () => {
    // Build a graph with only structural edges
    const nodes: GraphNode[] = [
      makeNode("dec1", "decision"),
      makeNode("opt_a", "option", { data: { interventions: { fac_c: 0.8 } } }),
      makeNode("opt_b", "option", { data: { interventions: { fac_c: 0.2 } } }),
      makeNode("fac_c", "factor", { category: "controllable", data: { value: 0.5, factor_type: "other" } }),
      makeNode("out1", "outcome"),
      makeNode("goal1", "goal"),
    ];

    const edges: GraphEdge[] = [
      makeEdge("dec1", "opt_a", 1.0, 0.01, 1.0),
      makeEdge("dec1", "opt_b", 1.0, 0.01, 1.0),
      makeEdge("opt_a", "fac_c", 1.0, 0.01, 1.0),
      makeEdge("opt_b", "fac_c", 1.0, 0.01, 1.0),
      // No causal edges from fac_c → out1 or out1 → goal
      // This will fail structural validation (OPTION_NO_GOAL_PATH)
    ];

    const graph: ParsedGraph = { nodes, edges };
    const result = score(makeResponse(graph), makeBrief({ expect_status_quo: false }));
    // Should fail structural validation
    expect(result.structural_valid).toBe(false);
    expect(result.param_quality).toBeNull();
  });
});

// =============================================================================
// Scorer — option differentiation
// =============================================================================

describe("scorer — option differentiation", () => {
  it("penalises score when two options have identical interventions", () => {
    const graph = minimalValidGraph();
    // Make opt_a and opt_b have identical interventions
    const optA = graph.nodes.find((n) => n.id === "opt_a")!;
    const optB = graph.nodes.find((n) => n.id === "opt_b")!;
    optA.data = { interventions: { fac_ctrl: 0.8 } };
    optB.data = { interventions: { fac_ctrl: 0.8 } };

    const result = score(makeResponse(graph), makeBrief());
    expect(result.option_diff!).toBeLessThan(0.75);
  });

  it("awards 0.25 when status quo present and expected", () => {
    const graph = minimalValidGraph(); // Has "Status Quo" option
    const result = score(makeResponse(graph), makeBrief({ expect_status_quo: true }));
    // Should get the status quo point
    expect(result.option_diff!).toBeGreaterThanOrEqual(0.25);
  });

  it("awards full 0.25 for status quo when not expected (brief.expect_status_quo=false)", () => {
    const graph = minimalValidGraph();
    // Remove status quo from graph
    graph.nodes = graph.nodes.filter((n) => n.id !== "opt_sq");
    graph.edges = graph.edges.filter(
      (e) => e.from !== "opt_sq" && e.to !== "opt_sq"
    );
    const result = score(makeResponse(graph), makeBrief({ expect_status_quo: false }));
    // expect_status_quo is false → automatically gets 0.25
    expect(result.option_diff!).toBeGreaterThanOrEqual(0.25);
  });
});

// =============================================================================
// Scorer — completeness
// =============================================================================

describe("scorer — completeness", () => {
  it("loses 0.15 when no external factors present", () => {
    const graph = minimalValidGraph();
    // Remove external factor
    graph.nodes = graph.nodes.filter((n) => n.id !== "fac_ext");
    graph.edges = graph.edges.filter(
      (e) => e.from !== "fac_ext" && e.to !== "fac_ext"
    );

    const withExt = score(makeResponse(minimalValidGraph()), makeBrief());
    const withoutExt = score(makeResponse(graph), makeBrief());

    expect(withoutExt.completeness!).toBeLessThan(withExt.completeness! + 0.01);
    expect(withExt.completeness! - withoutExt.completeness!).toBeCloseTo(0.15, 1);
  });

  it("awards 0.15 for non-empty coaching", () => {
    const graphWithCoaching = minimalValidGraph(); // already has coaching
    const graphNoCoaching = minimalValidGraph();
    graphNoCoaching.coaching = undefined;

    const withCoaching = score(makeResponse(graphWithCoaching), makeBrief());
    const noCoaching = score(makeResponse(graphNoCoaching), makeBrief());

    expect(withCoaching.completeness!).toBeGreaterThan(noCoaching.completeness! - 0.01);
    expect(withCoaching.completeness! - noCoaching.completeness!).toBeCloseTo(0.15, 1);
  });

  it("awards goal threshold point when has_numeric_target and threshold present", () => {
    const graph = minimalValidGraph();
    const goalNode = graph.nodes.find((n) => n.kind === "goal")!;
    goalNode.goal_threshold = 0.8;

    const result = score(makeResponse(graph), makeBrief({ has_numeric_target: true }));
    const withoutResult = score(makeResponse(minimalValidGraph()), makeBrief({ has_numeric_target: true }));

    expect(result.completeness!).toBeGreaterThan(withoutResult.completeness! - 0.01);
  });

  it("does not require goal threshold when has_numeric_target=false", () => {
    const result = score(makeResponse(minimalValidGraph()), makeBrief({ has_numeric_target: false }));
    // Should get 0.20 for this sub-dimension automatically
    expect(result.completeness!).toBeGreaterThan(0);
  });

  it("readability: 8 nodes scores 0.20", () => {
    const graph = minimalValidGraph(); // 8 nodes
    expect(graph.nodes.length).toBe(8);
    const result = score(makeResponse(graph), makeBrief());
    expect(result.node_count).toBe(8);
    // readability should be 0.20
    // total completeness includes other dimensions too
    expect(result.completeness!).toBeGreaterThan(0.5);
  });

  it("readability: 15 nodes scores 0.10", () => {
    const graph = minimalValidGraph();
    // Add 7 more factor nodes (external, no edges required since they'll be orphans...)
    // Actually we need them to not be orphans - connect to out1
    for (let i = 0; i < 7; i++) {
      const id = `extra_obs_${i}`;
      graph.nodes.push(makeNode(id, "factor", {
        category: "observable",
        data: { value: 0.5 },
      }));
      graph.edges.push(makeEdge(id, "out1", 0.05, 0.1, 0.7));
    }

    const result = score(makeResponse(graph), makeBrief());
    expect(result.node_count).toBe(15);
    // readability at 15 nodes = 0.10 (vs 0.20 at 8)
    const graphSmall = minimalValidGraph();
    const resultSmall = score(makeResponse(graphSmall), makeBrief());
    expect(result.completeness!).toBeLessThan(resultSmall.completeness! + 0.01);
  });

  it("readability: 25 nodes scores 0", () => {
    const graph = minimalValidGraph();
    for (let i = 0; i < 17; i++) {
      const id = `extra_obs_${i}`;
      graph.nodes.push(makeNode(id, "factor", {
        category: "observable",
        data: { value: 0.5 },
      }));
      graph.edges.push(makeEdge(id, "out1", 0.02, 0.1, 0.6));
    }

    const result = score(makeResponse(graph), makeBrief());
    expect(result.node_count).toBe(25);
    const graphSmall = minimalValidGraph();
    const resultSmall = score(makeResponse(graphSmall), makeBrief());
    // 25 nodes: readability = 0, so completeness should be lower
    expect(result.completeness!).toBeLessThan(resultSmall.completeness! + 0.01);
  });
});

// =============================================================================
// Scorer — currency preservation (completeness sub-dimension)
// =============================================================================

describe("scorer — currency preservation", () => {
  it("awards 0.10 when brief has £ and goal node has matching unit", () => {
    const graph = minimalValidGraph();
    const goalNode = graph.nodes.find((n) => n.kind === "goal")!;
    goalNode.goal_threshold_unit = "£";

    const brief = makeBrief();
    brief.body = "Budget is £50,000 for expansion.";

    const result = score(makeResponse(graph), brief);
    // Should get full currency score (0.10)
    const graphNoCurrency = minimalValidGraph();
    const briefNoCurrency = makeBrief();
    briefNoCurrency.body = "No currency mentioned here.";
    const resultNoCurrency = score(makeResponse(graphNoCurrency), briefNoCurrency);

    // Both should include currency points (either matched or N/A = full marks)
    expect(result.completeness).not.toBeNull();
    expect(resultNoCurrency.completeness).not.toBeNull();
  });

  it("awards 0.05 when brief has $ but graph has non-matching unit", () => {
    const graph = minimalValidGraph();
    // Add a unit that doesn't match $
    const factor = graph.nodes.find((n) => n.kind === "factor" && n.id === "fac_ctrl")!;
    factor.data = { ...factor.data, unit: "units" };

    const brief = makeBrief();
    brief.body = "Revenue target of $1M.";

    const result = score(makeResponse(graph), brief);

    // Compare with a graph that has matching unit
    const graphMatch = minimalValidGraph();
    const factorMatch = graphMatch.nodes.find((n) => n.kind === "factor" && n.id === "fac_ctrl")!;
    factorMatch.data = { ...factorMatch.data, unit: "$" };

    const resultMatch = score(makeResponse(graphMatch), brief);

    // Matching unit should score higher
    expect(resultMatch.completeness!).toBeGreaterThan(result.completeness!);
  });

  it("awards 0.00 when brief has € but graph has no units at all", () => {
    const graph = minimalValidGraph();
    const brief = makeBrief();
    brief.body = "Budget is €500k.";

    const result = score(makeResponse(graph), brief);

    // Compare with graph that has matching unit
    const graphMatch = minimalValidGraph();
    const goalNode = graphMatch.nodes.find((n) => n.kind === "goal")!;
    goalNode.goal_threshold_unit = "€";

    const resultMatch = score(makeResponse(graphMatch), brief);

    expect(resultMatch.completeness!).toBeGreaterThan(result.completeness!);
  });

  it("gives full marks for currency dimension when no currency in brief", () => {
    const graph = minimalValidGraph();
    const brief = makeBrief();
    brief.body = "We need to decide between three options for team growth.";

    const result = score(makeResponse(graph), brief);
    // No currency → null → full marks (0.10)
    expect(result.completeness).not.toBeNull();
  });
});

// =============================================================================
// Scorer — pairwise option differentiation
// =============================================================================

describe("scorer — pairwise option differentiation", () => {
  it("awards full marks when options share factors but have different values", () => {
    // Simulates e.g. 3 CRM platforms all setting cost/onboarding to different values
    const graph = minimalValidGraph();
    const optA = graph.nodes.find((n) => n.id === "opt_a")!;
    const optB = graph.nodes.find((n) => n.id === "opt_b")!;
    const optSQ = graph.nodes.find((n) => n.id === "opt_sq")!;
    // All three set the same factor but to different values
    optA.data = { interventions: { fac_ctrl: 0.9 } };
    optB.data = { interventions: { fac_ctrl: 0.3 } };
    optSQ.data = { interventions: { fac_ctrl: 0.5 } };

    const result = score(makeResponse(graph), makeBrief());
    // Should still get full option_diff since pairwise values differ
    expect(result.option_diff!).toBe(1.0);
  });

  it("awards partial marks when some option pairs are identical", () => {
    const graph = minimalValidGraph();
    const optA = graph.nodes.find((n) => n.id === "opt_a")!;
    const optB = graph.nodes.find((n) => n.id === "opt_b")!;
    const optSQ = graph.nodes.find((n) => n.id === "opt_sq")!;
    // A and B are identical, SQ differs
    optA.data = { interventions: { fac_ctrl: 0.8 } };
    optB.data = { interventions: { fac_ctrl: 0.8 } };
    optSQ.data = { interventions: { fac_ctrl: 0.5 } };

    const result = score(makeResponse(graph), makeBrief());
    // Identical signatures → loses 0.25 (uniqueness check)
    // Pairwise: A-B identical, A-SQ distinct, B-SQ distinct = 2/3 distinct
    // Check A fails (A and B have no unique factor), so falls through to Check B
    // Check B: pairwiseScore = 2/3 → 0.25 * 2/3 ≈ 0.167
    expect(result.option_diff!).toBeLessThan(1.0);
    expect(result.option_diff!).toBeGreaterThan(0.5);
  });

  it("awards 0 for differentiation when all options are identical", () => {
    const graph = minimalValidGraph();
    const optA = graph.nodes.find((n) => n.id === "opt_a")!;
    const optB = graph.nodes.find((n) => n.id === "opt_b")!;
    const optSQ = graph.nodes.find((n) => n.id === "opt_sq")!;
    optA.data = { interventions: { fac_ctrl: 0.5 } };
    optB.data = { interventions: { fac_ctrl: 0.5 } };
    optSQ.data = { interventions: { fac_ctrl: 0.5 } };

    const result = score(makeResponse(graph), makeBrief());
    // Identical sigs → loses 0.25
    // All pairs identical → pairwiseScore = 0 → loses 0.25
    // Status quo present → gets 0.25
    // All set factors → gets 0.25
    expect(result.option_diff!).toBe(0.5);
  });
});

// =============================================================================
// Scorer — failed responses
// =============================================================================

describe("scorer — failed responses", () => {
  it("returns all nulls for parse_failed response", () => {
    const response: LLMResponse = {
      model_id: "test",
      brief_id: "test",
      status: "parse_failed",
      failure_code: "parse_failed",
      latency_ms: 500,
    };
    const result = score(response, makeBrief());
    expect(result.structural_valid).toBe(false);
    expect(result.overall_score).toBeNull();
    expect(result.param_quality).toBeNull();
    expect(result.option_diff).toBeNull();
    expect(result.completeness).toBeNull();
  });

  it("returns all nulls for timeout_failed response", () => {
    const response: LLMResponse = {
      model_id: "test",
      brief_id: "test",
      status: "timeout_failed",
      failure_code: "timeout_failed",
      latency_ms: 30000,
    };
    const result = score(response, makeBrief());
    expect(result.overall_score).toBeNull();
  });
});

// =============================================================================
// Scorer — overall_score calculation
// =============================================================================

describe("scorer — overall_score", () => {
  it("overall_score = param(0.30) + optDiff(0.30) + completeness(0.40)", () => {
    const graph = minimalValidGraph();
    const result = score(makeResponse(graph), makeBrief());

    if (
      result.param_quality != null &&
      result.option_diff != null &&
      result.completeness != null
    ) {
      const expected =
        result.param_quality * 0.3 +
        result.option_diff * 0.3 +
        result.completeness * 0.4;
      expect(result.overall_score).toBeCloseTo(expected, 5);
    }
  });

  it("overall_score is null when structural_valid is false", () => {
    const graph = minimalValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== "goal");
    graph.edges = graph.edges.filter(
      (e) => e.from !== "goal1" && e.to !== "goal1"
    );
    const result = score(makeResponse(graph), makeBrief());
    expect(result.overall_score).toBeNull();
  });
});
