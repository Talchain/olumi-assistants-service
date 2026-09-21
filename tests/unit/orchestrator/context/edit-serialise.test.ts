import { describe, it, expect } from "vitest";
import {
  editCompactGraph,
  truncateGraphJson,
  serialiseEditContextForLLM,
} from "../../../../src/orchestrator/context/serialise.js";
import type { GraphV3T, ConversationContext } from "../../../../src/orchestrator/types.js";
import type { EditCompactGraph } from "../../../../src/orchestrator/context/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeV3Graph(nodeCount = 3, edgeCount = 2): GraphV3T {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node_${i}`,
    kind: i === 0 ? "goal" : "factor",
    label: `Node ${i}`,
  }));

  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `node_${i + 1 < nodeCount ? i + 1 : 1}`,
    to: "node_0",
    strength: { mean: 0.5 + i * 0.1, std: 0.125 },
    exists_probability: 0.9,
    effect_direction: "positive" as const,
  }));

  return { nodes, edges } as unknown as GraphV3T;
}

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: makeV3Graph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test",
    ...overrides,
  };
}

// ============================================================================
// editCompactGraph
// ============================================================================

describe("editCompactGraph", () => {
  it("produces compact nodes with id, label, kind", () => {
    const graph = makeV3Graph();
    const compact = editCompactGraph(graph);
    expect(compact.nodes).toHaveLength(3);
    expect(compact.nodes[0]).toHaveProperty("id");
    expect(compact.nodes[0]).toHaveProperty("label");
    expect(compact.nodes[0]).toHaveProperty("kind");
  });

  it("produces compact edges with strength_mean, strength_std, exists_probability, effect_direction", () => {
    const graph = makeV3Graph();
    const compact = editCompactGraph(graph);
    expect(compact.edges).toHaveLength(2);
    const edge = compact.edges[0];
    expect(edge).toHaveProperty("from");
    expect(edge).toHaveProperty("to");
    expect(edge).toHaveProperty("strength_mean");
    expect(edge).toHaveProperty("strength_std");
    expect(edge).toHaveProperty("exists_probability");
    expect(edge).toHaveProperty("effect_direction");
  });

  it("includes category when present on node", () => {
    const graph = makeV3Graph();
    (graph.nodes[0] as Record<string, unknown>).category = "financial";
    const compact = editCompactGraph(graph);
    expect(compact.nodes[0].category).toBe("financial");
  });

  it("omits category when absent", () => {
    const graph = makeV3Graph();
    const compact = editCompactGraph(graph);
    expect(compact.nodes[0].category).toBeUndefined();
  });

  it("includes edge label when present", () => {
    const graph = makeV3Graph();
    (graph.edges[0] as Record<string, unknown>).label = "impacts";
    const compact = editCompactGraph(graph);
    expect(compact.edges[0].label).toBe("impacts");
  });

  it("defaults strength_std to 0.125 when missing", () => {
    const graph = makeV3Graph();
    // Remove std from strength
    (graph.edges[0] as any).strength = { mean: 0.5 };
    const compact = editCompactGraph(graph);
    expect(compact.edges[0].strength_std).toBe(0.125);
  });

  it("defaults effect_direction to 'positive' when missing", () => {
    const graph = makeV3Graph();
    delete (graph.edges[0] as any).effect_direction;
    const compact = editCompactGraph(graph);
    expect(compact.edges[0].effect_direction).toBe("positive");
  });
});

// ============================================================================
// truncateGraphJson
// ============================================================================

describe("truncateGraphJson", () => {
  it("returns full JSON when under maxBytes", () => {
    const compact: EditCompactGraph = {
      nodes: [{ id: "a", label: "A", kind: "goal" }],
      edges: [],
    };
    const json = truncateGraphJson(compact, 10000);
    expect(JSON.parse(json)).toEqual(compact);
  });

  it("truncates by removing edges first", () => {
    const compact: EditCompactGraph = {
      nodes: [
        { id: "a", label: "A", kind: "goal" },
        { id: "b", label: "B", kind: "factor" },
      ],
      edges: Array.from({ length: 50 }, (_, i) => ({
        from: "b",
        to: "a",
        strength_mean: 0.5,
        strength_std: 0.1,
        exists_probability: 0.9,
        effect_direction: `positive-${i}`,
      })),
    };

    const fullLength = JSON.stringify(compact).length;
    const maxBytes = Math.floor(fullLength * 0.5);
    const json = truncateGraphJson(compact, maxBytes);

    expect(json.length).toBeLessThanOrEqual(maxBytes);
    // Should still be valid JSON
    const parsed = JSON.parse(json);
    expect(parsed.nodes).toHaveLength(2); // Nodes preserved
    expect(parsed.edges.length).toBeLessThan(50); // Edges reduced
  });

  it("produces valid JSON even when heavily truncated", () => {
    const compact: EditCompactGraph = {
      nodes: Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`,
        label: `Node ${i}`,
        kind: "factor",
      })),
      edges: Array.from({ length: 25 }, (_, i) => ({
        from: `n${i % 20}`,
        to: `n${(i + 1) % 20}`,
        strength_mean: 0.5,
        strength_std: 0.1,
        exists_probability: 0.9,
        effect_direction: "positive",
      })),
    };

    const json = truncateGraphJson(compact, 200);
    // Must be valid JSON
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ============================================================================
// serialiseEditContextForLLM
// ============================================================================

describe("serialiseEditContextForLLM", () => {
  it("includes graph section header with node/edge counts", () => {
    const ctx = makeContext();
    const result = serialiseEditContextForLLM(ctx);
    expect(result).toContain("## Current Graph");
    expect(result).toContain("3 nodes");
    expect(result).toContain("2 edges");
  });

  it("includes json code fence", () => {
    const ctx = makeContext();
    const result = serialiseEditContextForLLM(ctx);
    expect(result).toContain("```json");
    expect(result).toContain("```");
  });

  it("includes decision stage when framing provided", () => {
    const ctx = makeContext({ framing: { stage: "evaluate", goal: "Max revenue" } });
    const result = serialiseEditContextForLLM(ctx);
    expect(result).toContain("## Decision Stage: evaluate");
    expect(result).toContain("Goal: Max revenue");
  });

  it("includes FOCUS section when selected_elements present", () => {
    const ctx = makeContext({ selected_elements: ["node_1", "node_2"] });
    const result = serialiseEditContextForLLM(ctx);
    expect(result).toContain("## FOCUS");
    expect(result).toContain("- node_1");
    expect(result).toContain("- node_2");
  });

  it("omits FOCUS section when no selected_elements", () => {
    const ctx = makeContext();
    const result = serialiseEditContextForLLM(ctx);
    expect(result).not.toContain("## FOCUS");
  });

  it("skips graph section when graph is null", () => {
    const ctx = makeContext({ graph: null });
    const result = serialiseEditContextForLLM(ctx);
    expect(result).not.toContain("## Current Graph");
  });
});
