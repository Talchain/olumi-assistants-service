/**
 * Determinism Tests - Stable Edge IDs (v04)
 *
 * Verifies that graphs have stable, deterministic edge IDs and ordering
 * across multiple runs with identical inputs.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Use fixtures provider for deterministic, fast tests
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("Determinism - Stable Edge IDs (v04)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await draftRoute(app);
  });

  it("generates stable edge IDs across multiple runs with same brief", async () => {
    const brief = "Should I invest in renewable energy stocks for long-term growth?";

    // Run draft-graph 3 times with identical input
    const runs = await Promise.all([
      app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief },
      }),
      app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief },
      }),
      app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief },
      }),
    ]);

    // All should succeed
    for (const res of runs) {
      expect(res.statusCode).toBe(200);
    }

    // Parse responses
    const graphs = runs.map((res) => JSON.parse(res.body).graph);

    // Verify all graphs have stable edge IDs matching pattern: ${from}::${to}::${index}
    for (const graph of graphs) {
      for (const edge of graph.edges) {
        expect(edge.id).toBeDefined();
        expect(typeof edge.id).toBe("string");
        // Should match stable pattern
        expect(edge.id).toMatch(/^[a-z_0-9]+::[a-z_0-9]+::\d+$/);
      }
    }

    // Verify edge IDs are identical across all runs
    const edgeIds1 = graphs[0].edges.map((e: any) => e.id);
    const edgeIds2 = graphs[1].edges.map((e: any) => e.id);
    const edgeIds3 = graphs[2].edges.map((e: any) => e.id);

    expect(edgeIds1).toEqual(edgeIds2);
    expect(edgeIds2).toEqual(edgeIds3);
  });

  it("ensures nodes are sorted by id (ascending)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: "Optimize my hiring strategy for a tech startup" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const nodeIds = body.graph.nodes.map((n: any) => n.id);

    // Verify nodes are sorted
    const sortedIds = [...nodeIds].sort();
    expect(nodeIds).toEqual(sortedIds);
  });

  it("ensures edges are sorted by from→to→id (ascending)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: "Should I expand my business internationally?" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const edges = body.graph.edges;

    // Verify edges are sorted by from → to → id
    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1];
      const curr = edges[i];

      // Check from comparison
      const fromCompare = prev.from.localeCompare(curr.from);
      if (fromCompare < 0) continue; // Correct order
      if (fromCompare > 0) {
        throw new Error(`Edges not sorted by from: ${prev.from} > ${curr.from}`);
      }

      // from is equal, check to
      const toCompare = prev.to.localeCompare(curr.to);
      if (toCompare < 0) continue; // Correct order
      if (toCompare > 0) {
        throw new Error(`Edges not sorted by to: ${prev.to} > ${curr.to}`);
      }

      // from and to are equal, check id
      const idCompare = prev.id.localeCompare(curr.id);
      expect(idCompare).toBeLessThanOrEqual(0); // Should be ≤ 0 (sorted)
    }
  });

  it("maintains stable edge IDs in SSE stream", async () => {
    const brief = "Evaluate cloud providers for my application";

    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph/stream",
      payload: { brief },
    });

    expect(res.statusCode).toBe(200);

    // Parse SSE events
    const events = res.body.split("\n\n").filter(Boolean);
    let completeGraph: any = null;

    for (const event of events) {
      if (event.includes("event: stage")) {
        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch) {
          const stageData = JSON.parse(dataMatch[1]);
          if (stageData.stage === "COMPLETE" && stageData.payload?.graph) {
            completeGraph = stageData.payload.graph;
            break;
          }
        }
      }
    }

    expect(completeGraph).toBeTruthy();

    // Verify stable edge IDs in SSE response
    for (const edge of completeGraph.edges) {
      expect(edge.id).toBeDefined();
      expect(edge.id).toMatch(/^[a-z_0-9]+::[a-z_0-9]+::\d+$/);
    }

    // Verify sorted
    const nodeIds = completeGraph.nodes.map((n: any) => n.id);
    const sortedNodeIds = [...nodeIds].sort();
    expect(nodeIds).toEqual(sortedNodeIds);
  });

  it("preserves DAG property with stable edge IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: "Choose between buying vs leasing office space" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const graph = body.graph;

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const node of graph.nodes) {
      adj.set(node.id, new Set());
    }
    for (const edge of graph.edges) {
      adj.get(edge.from)?.add(edge.to);
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(node: string): boolean {
      visited.add(node);
      recStack.add(node);

      for (const neighbor of adj.get(node) || []) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true; // Cycle detected
        }
      }

      recStack.delete(node);
      return false;
    }

    // Check all nodes for cycles
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        expect(hasCycle(node.id)).toBe(false);
      }
    }
  });
});
