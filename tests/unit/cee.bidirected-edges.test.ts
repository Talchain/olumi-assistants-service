/**
 * 3A-trust-CEE: Bidirected Edge Tests
 *
 * Validates that bidirected edges (edge_type: "bidirected") survive the full
 * CEE pipeline and do not interfere with directed-edge-only logic (DAG checks,
 * cycle detection, layout).
 */

import { describe, it, expect, vi } from "vitest";
import { Edge, EdgeType } from "../../src/schemas/graph.js";
import { isDirectedEdge, filterDirectedEdges } from "../../src/schemas/graph.js";
import { EdgeV3 } from "../../src/schemas/cee-v3.js";
import { LLMEdge } from "../../src/adapters/llm/shared-schemas.js";
import {
  detectCycles,
  isDAG,
  breakCycles,
  calculateMeta,
  enforceGraphCompliance,
} from "../../src/utils/graphGuards.js";
import { transformEdgeToV3 } from "../../src/cee/transforms/schema-v3.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import type { V1Edge, V1Node } from "../../src/cee/transforms/schema-v2.js";
import type { NodeT, EdgeT, GraphT } from "../../src/schemas/graph.js";

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  calculateCost: vi.fn(),
  TelemetryEvents: {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal V1 nodes for transform tests. */
const v1Nodes: V1Node[] = [
  { id: "fac_a", kind: "factor", label: "Factor A" },
  { id: "fac_b", kind: "factor", label: "Factor B" },
  { id: "out_1", kind: "outcome", label: "Outcome" },
  { id: "goal_1", kind: "goal", label: "Goal" },
];

/** Minimal graph for compliance tests. */
function makeGraph(edges: EdgeT[]): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "fac_a", kind: "factor", label: "Factor A" },
      { id: "fac_b", kind: "factor", label: "Factor B" },
      { id: "out_1", kind: "outcome", label: "Outcome" },
      { id: "goal_1", kind: "goal", label: "Goal" },
    ],
    edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  };
}

// ============================================================================
// Test 1: Bidirected edge survives full pipeline
// ============================================================================

describe("3A-trust: bidirected edge pipeline preservation", () => {
  it("bidirected edge_type survives LLMEdge → V1 → V3 transform → EdgeV3 parse", () => {
    // Step 1: LLMEdge parse (simulates LLM output)
    // Note: strength.std must be > 0 per EdgeStrength schema (z.number().positive())
    const llmInput = {
      from: "fac_a",
      to: "fac_b",
      strength: { mean: 0, std: 0.01 },
      exists_probability: 1.0,
      effect_direction: "positive" as const,
      edge_type: "bidirected" as const,
    };
    const llmResult = LLMEdge.safeParse(llmInput);
    expect(llmResult.success).toBe(true);
    expect(llmResult.data!.edge_type).toBe("bidirected");

    // Step 2: V1Edge (post-normalisation) — edge_type preserved via spread
    const v1Edge: V1Edge = {
      from: "fac_a",
      to: "fac_b",
      strength_mean: 0,
      strength_std: 0.01,
      belief_exists: 1.0,
      effect_direction: "positive",
      edge_type: "bidirected",
    };

    // Step 3: V3 transform
    const v3Edge = transformEdgeToV3(v1Edge, 0, v1Nodes);
    expect(v3Edge.edge_type).toBe("bidirected");

    // Step 4: EdgeV3 Zod parse
    const v3Result = EdgeV3.safeParse(v3Edge);
    expect(v3Result.success).toBe(true);
    expect(v3Result.data!.edge_type).toBe("bidirected");
  });
});

// ============================================================================
// Test 2: Directed edges unaffected (backward compatibility)
// ============================================================================

describe("3A-trust: directed edges unaffected", () => {
  it("directed edge survives pipeline identically to before", () => {
    const v1Edge: V1Edge = {
      from: "fac_a",
      to: "out_1",
      strength_mean: 0.6,
      strength_std: 0.15,
      belief_exists: 0.85,
      effect_direction: "positive",
      edge_type: "directed",
    };

    const v3Edge = transformEdgeToV3(v1Edge, 0, v1Nodes);

    expect(v3Edge.from).toBe("fac_a");
    expect(v3Edge.to).toBe("out_1");
    expect(v3Edge.strength_mean).toBeCloseTo(0.6);
    expect(v3Edge.belief_exists).toBeCloseTo(0.85);
    expect(v3Edge.effect_direction).toBe("positive");
    expect(v3Edge.edge_type).toBe("directed");
  });

  it("explicit edge_type='directed' and omitted edge_type produce equivalent V3 output", () => {
    const withType: V1Edge = {
      from: "fac_a", to: "out_1",
      strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8,
      effect_direction: "positive",
      edge_type: "directed",
    };
    const withoutType: V1Edge = {
      from: "fac_a", to: "out_1",
      strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8,
      effect_direction: "positive",
    };

    const v3With = transformEdgeToV3(withType, 0, v1Nodes);
    const v3Without = transformEdgeToV3(withoutType, 0, v1Nodes);

    // Core fields identical
    expect(v3With.strength_mean).toBe(v3Without.strength_mean);
    expect(v3With.strength_std).toBe(v3Without.strength_std);
    expect(v3With.belief_exists).toBe(v3Without.belief_exists);
    expect(v3With.effect_direction).toBe(v3Without.effect_direction);

    // edge_type: "directed" present on explicit, absent on omitted
    expect(v3With.edge_type).toBe("directed");
    expect(v3Without.edge_type).toBeUndefined();
  });
});

// ============================================================================
// Test 3: Schema validation accepts bidirected edge_type
// ============================================================================

describe("3A-trust: schema validation", () => {
  it("Edge schema accepts edge_type: 'bidirected'", () => {
    const result = Edge.safeParse({
      from: "fac_a",
      to: "fac_b",
      edge_type: "bidirected",
    });
    expect(result.success).toBe(true);
    expect(result.data!.edge_type).toBe("bidirected");
  });

  it("Edge schema accepts edge_type: 'directed'", () => {
    const result = Edge.safeParse({
      from: "fac_a",
      to: "fac_b",
      edge_type: "directed",
    });
    expect(result.success).toBe(true);
    expect(result.data!.edge_type).toBe("directed");
  });

  it("Edge schema accepts omitted edge_type (backward compatible)", () => {
    const result = Edge.safeParse({
      from: "fac_a",
      to: "fac_b",
    });
    expect(result.success).toBe(true);
    expect(result.data!.edge_type).toBeUndefined();
  });

  it("Edge schema rejects invalid edge_type", () => {
    const result = Edge.safeParse({
      from: "fac_a",
      to: "fac_b",
      edge_type: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("EdgeType enum contains exactly directed and bidirected", () => {
    expect(EdgeType.options).toEqual(["directed", "bidirected"]);
  });

  it("EdgeV3 schema accepts edge_type: 'bidirected'", () => {
    const result = EdgeV3.safeParse({
      from: "fac_a",
      to: "fac_b",
      strength_mean: 0,
      strength_std: 0.001,
      belief_exists: 1.0,
      effect_direction: "positive",
      edge_type: "bidirected",
    });
    expect(result.success).toBe(true);
    expect(result.data!.edge_type).toBe("bidirected");
  });

  it("LLMEdge schema accepts edge_type: 'bidirected'", () => {
    const result = LLMEdge.safeParse({
      from: "fac_a",
      to: "fac_b",
      strength: { mean: 0, std: 0.01 },
      edge_type: "bidirected",
    });
    expect(result.success).toBe(true);
    expect(result.data!.edge_type).toBe("bidirected");
  });
});

// ============================================================================
// Test 4: STRP / normalisation spread preserves edge_type
// ============================================================================

describe("3A-trust: normalisation preserves edge_type via spread", () => {
  it("isDirectedEdge returns true for directed edges", () => {
    expect(isDirectedEdge({ from: "a", to: "b", edge_type: "directed" })).toBe(true);
  });

  it("isDirectedEdge returns true for omitted edge_type (backward compat)", () => {
    expect(isDirectedEdge({ from: "a", to: "b" })).toBe(true);
  });

  it("isDirectedEdge returns false for bidirected edges", () => {
    expect(isDirectedEdge({ from: "a", to: "b", edge_type: "bidirected" })).toBe(false);
  });

  it("filterDirectedEdges excludes bidirected edges", () => {
    const edges: EdgeT[] = [
      { from: "a", to: "b", edge_type: "directed" },
      { from: "c", to: "d", edge_type: "bidirected" },
      { from: "e", to: "f" }, // omitted = directed
    ];
    const filtered = filterDirectedEdges(edges);
    expect(filtered).toHaveLength(2);
    expect(filtered.every(e => e.edge_type !== "bidirected")).toBe(true);
  });
});

// ============================================================================
// Test 5: Backward compatibility — omitted edge_type defaults to directed
// ============================================================================

describe("3A-trust: backward compatibility", () => {
  it("graph with no edge_type fields passes enforceGraphCompliance unchanged", () => {
    const edges: EdgeT[] = [
      { from: "dec_1", to: "opt_a" },
      { from: "opt_a", to: "fac_a" },
      { from: "fac_a", to: "out_1" },
      { from: "out_1", to: "goal_1" },
    ];
    const graph = makeGraph(edges);
    const result = enforceGraphCompliance(graph);

    // All edges preserved (none pruned)
    expect(result.edges.length).toBe(4);
    // No edge_type was injected
    expect(result.edges.every(e => e.edge_type === undefined)).toBe(true);
    // Nodes not pruned (all connected)
    expect(result.nodes.length).toBeGreaterThanOrEqual(4);
  });

  it("mixed graph with bidirected + directed edges preserves both", () => {
    const edges: EdgeT[] = [
      { from: "dec_1", to: "opt_a" },
      { from: "opt_a", to: "fac_a" },
      { from: "fac_a", to: "out_1" },
      { from: "out_1", to: "goal_1" },
      { from: "fac_a", to: "fac_b", edge_type: "bidirected" },
    ];
    const graph = makeGraph(edges);
    const result = enforceGraphCompliance(graph);

    // Bidirected edge preserved
    const bidirected = result.edges.filter(e => e.edge_type === "bidirected");
    expect(bidirected).toHaveLength(1);
    expect(bidirected[0].from).toBe("fac_a");
    expect(bidirected[0].to).toBe("fac_b");
  });
});

// ============================================================================
// Test 6: Quality warnings unaffected by bidirected edges
// ============================================================================

describe("3A-trust: DAG and cycle detection ignore bidirected edges", () => {
  it("bidirected A↔B does not create a cycle", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "factor" },
      { id: "b", kind: "factor" },
    ];
    // A→B directed + A↔B bidirected (not a cycle)
    const edges: EdgeT[] = [
      { from: "a", to: "b", edge_type: "directed" },
      { from: "a", to: "b", edge_type: "bidirected" },
    ];

    expect(isDAG(nodes, edges)).toBe(true);
    expect(detectCycles(nodes, edges)).toHaveLength(0);
  });

  it("bidirected edges forming A↔B + B↔A pattern do not trigger cycle detection", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "factor" },
      { id: "b", kind: "factor" },
    ];
    // Both are bidirected — should NOT be treated as A→B→A cycle
    const edges: EdgeT[] = [
      { from: "a", to: "b", edge_type: "bidirected" },
      { from: "b", to: "a", edge_type: "bidirected" },
    ];

    expect(isDAG(nodes, edges)).toBe(true);
    expect(detectCycles(nodes, edges)).toHaveLength(0);
  });

  it("real directed cycle A→B→A is still detected alongside bidirected edges", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "factor" },
      { id: "b", kind: "factor" },
      { id: "c", kind: "factor" },
    ];
    const edges: EdgeT[] = [
      { from: "a", to: "b" },           // directed (default)
      { from: "b", to: "a" },           // directed — creates cycle
      { from: "a", to: "c", edge_type: "bidirected" }, // bidirected — NOT a cycle
    ];

    expect(isDAG(nodes, edges)).toBe(false);
    const cycles = detectCycles(nodes, edges);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("calculateMeta excludes bidirected edges from root/leaf calculation", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "factor" },
      { id: "b", kind: "factor" },
      { id: "c", kind: "factor" },
    ];
    // a→b directed, a↔c bidirected
    const edges: EdgeT[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c", edge_type: "bidirected" },
    ];

    const meta = calculateMeta(nodes, edges);

    // 'c' should be a root AND a leaf (bidirected edge doesn't count)
    expect(meta.roots).toContain("c");
    expect(meta.leaves).toContain("c");
    // 'a' has outgoing directed → not a leaf
    expect(meta.leaves).not.toContain("a");
    // 'b' has incoming directed → not a root
    expect(meta.roots).not.toContain("b");
  });
});

// ============================================================================
// Regression: H1 — bidirected edges excluded from reachability/semantic checks
// ============================================================================

describe("3A-trust regression: graph-validator excludes bidirected from reachability", () => {
  it("bidirected edge does not create false reachability (UNREACHABLE_FROM_DECISION)", () => {
    // Graph: dec→opt→fac_a→out→goal, with bidirected fac_a↔fac_b.
    // fac_b is only connected via bidirected edge — should be unreachable from decision.
    const graph: GraphT = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "fac_a", kind: "factor", label: "Factor A", category: "controllable" },
        { id: "fac_b", kind: "factor", label: "Factor B", category: "external" },
        { id: "out_1", kind: "outcome", label: "Outcome" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a" },
        { from: "opt_a", to: "fac_a" },
        { from: "fac_a", to: "out_1" },
        { from: "out_1", to: "goal_1" },
        // Bidirected: should NOT make fac_b reachable from decision
        { from: "fac_a", to: "fac_b", edge_type: "bidirected" },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
    };

    const result = validateGraph({ graph, requestId: "test-h1", phase: "post_normalisation" });

    // fac_b should appear in an unreachability error (it's only connected via bidirected)
    const unreachableErrors = result.errors.filter(
      e => e.code === "UNREACHABLE_FROM_DECISION" && e.message.includes("fac_b")
    );
    // fac_b IS unreachable from decision via directed edges
    expect(unreachableErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("bidirected-only connection does not create false path to goal (NO_PATH_TO_GOAL)", () => {
    // fac_b's only connection to the graph is via bidirected fac_a↔fac_b.
    // No directed edges connect fac_b to anything — it has no directed path to goal.
    const graph: GraphT = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "fac_a", kind: "factor", label: "Factor A", category: "controllable" },
        { id: "fac_b", kind: "factor", label: "Factor B", category: "controllable" },
        { id: "out_1", kind: "outcome", label: "Outcome" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a" },
        { from: "opt_a", to: "fac_a" },
        { from: "fac_a", to: "out_1" },
        { from: "out_1", to: "goal_1" },
        // fac_b connected ONLY via bidirected — no directed path to goal
        { from: "fac_a", to: "fac_b", edge_type: "bidirected" },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
    };

    const result = validateGraph({ graph, requestId: "test-h1b", phase: "post_normalisation" });

    // fac_b has NO directed path to goal — should trigger NO_PATH_TO_GOAL
    const noPathErrors = result.errors.filter(
      e => e.code === "NO_PATH_TO_GOAL" && e.message.includes("fac_b")
    );
    expect(noPathErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Regression: H3 — breakCycles only removes directed edges
// ============================================================================

describe("3A-trust regression: breakCycles preserves bidirected edges", () => {
  it("does not remove bidirected edge when breaking directed cycle on same from/to pair", () => {
    const nodes: NodeT[] = [
      { id: "a", kind: "factor" },
      { id: "b", kind: "factor" },
    ];
    // Directed cycle A→B→A, plus bidirected A↔B on same pair
    const edges: EdgeT[] = [
      { id: "dir_ab", from: "a", to: "b" },          // directed
      { id: "dir_ba", from: "b", to: "a" },          // directed — forms cycle
      { id: "bid_ab", from: "a", to: "b", edge_type: "bidirected" }, // bidirected — must survive
    ];

    const result = breakCycles(nodes, edges);

    // The bidirected edge must survive
    const bidirected = result.filter(e => e.edge_type === "bidirected");
    expect(bidirected).toHaveLength(1);
    expect(bidirected[0].id).toBe("bid_ab");

    // At least one directed edge removed to break cycle
    const directed = result.filter(e => e.edge_type !== "bidirected");
    // Original had 2 directed, at least 1 removed
    expect(directed.length).toBeLessThan(2);
  });
});

// ============================================================================
// Regression: H2 — v3-validator preserves edge_type through cycle detection
// ============================================================================

describe("3A-trust regression: v3-validator remap preserves edge_type", () => {
  it("bidirected edge in V3 response does not trigger false GRAPH_CONTAINS_CYCLE", () => {
    // A→B directed + B→A bidirected (same pair, opposite direction).
    // Without edge_type preservation in the remap, detectCycles would see A→B + B→A as a cycle.
    const v3Response = {
      schema_version: "3.0",
      goal_node_id: "goal_1",
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "decision_1", kind: "decision", label: "Decision" },
        { id: "option_1", kind: "option", label: "Option A" },
        { id: "factor_a", kind: "factor", label: "Factor A" },
        { id: "factor_b", kind: "factor", label: "Factor B" },
        { id: "outcome_1", kind: "outcome", label: "Outcome" },
      ],
      edges: [
        { from: "decision_1", to: "option_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "option_1", to: "factor_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        // Directed: factor_a → factor_b
        { from: "factor_a", to: "factor_b", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.85, effect_direction: "positive" },
        // Bidirected: factor_b ↔ factor_a (stored as from=factor_b, to=factor_a)
        // Without H2 fix, this + the directed edge above would look like a cycle
        { from: "factor_b", to: "factor_a", strength_mean: 0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive", edge_type: "bidirected" },
        { from: "factor_b", to: "outcome_1", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
        { from: "outcome_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
      ],
      options: [
        { id: "option_1", label: "Option A", status: "ready", interventions: {} },
      ],
    };

    const result = validateV3Response(v3Response);

    // No false cycle should be reported
    const cycleWarnings = result.warnings.filter(w => w.code === "GRAPH_CONTAINS_CYCLE");
    expect(cycleWarnings).toHaveLength(0);
  });
});
