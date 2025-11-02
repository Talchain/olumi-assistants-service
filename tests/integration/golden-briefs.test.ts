import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";
import type { GraphT } from "../../src/schemas/graph.js";
import { loadGoldenBrief, GOLDEN_BRIEFS } from "../utils/fixtures.js";

/**
 * Golden Brief Archetype Tests
 *
 * These tests lock in deterministic behavior for common decision patterns.
 * Each archetype represents a class of decisions users frequently make.
 */

// Mock Anthropic to return deterministic graphs
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockImplementation(({ brief }) => {
    // Return deterministic graphs based on brief keywords
    const lowerBrief = brief.toLowerCase();

    if (lowerBrief.includes("buy vs build") || lowerBrief.includes("make or buy")) {
      return Promise.resolve({
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal_1", kind: "goal", label: "Deliver capability on time" },
            { id: "dec_1", kind: "decision", label: "Buy vs Build decision" },
            { id: "opt_buy", kind: "option", label: "Buy commercial solution" },
            { id: "opt_build", kind: "option", label: "Build custom solution" },
            { id: "out_cost", kind: "outcome", label: "Total cost of ownership" },
            { id: "out_time", kind: "outcome", label: "Time to market" },
          ],
          edges: [
            { from: "goal_1", to: "dec_1" },
            { from: "dec_1", to: "opt_buy" },
            { from: "dec_1", to: "opt_build" },
            { from: "opt_buy", to: "out_cost", weight: 80000, belief: 0.9 },
            { from: "opt_buy", to: "out_time", weight: -3, belief: 0.85 },
            { from: "opt_build", to: "out_cost", weight: 120000, belief: 0.7 },
            { from: "opt_build", to: "out_time", weight: 6, belief: 0.75 },
          ],
          meta: {
            roots: ["goal_1"],
            leaves: ["out_cost", "out_time"],
            suggested_positions: {},
            source: "assistant",
          },
        },
        rationales: [
          { target: "opt_buy", why: "Faster deployment, lower initial cost" },
          { target: "opt_build", why: "Custom fit, long-term control" },
        ],
      });
    }

    if (lowerBrief.includes("hire") || lowerBrief.includes("headcount")) {
      return Promise.resolve({
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal_1", kind: "goal", label: "Increase team capacity" },
            { id: "dec_1", kind: "decision", label: "Hiring decision" },
            { id: "opt_fulltime", kind: "option", label: "Hire full-time" },
            { id: "opt_contract", kind: "option", label: "Contract workers" },
            { id: "opt_defer", kind: "option", label: "Defer hiring" },
            { id: "out_capacity", kind: "outcome", label: "Team output" },
            { id: "out_cost", kind: "outcome", label: "Annual cost" },
          ],
          edges: [
            { from: "goal_1", to: "dec_1" },
            { from: "dec_1", to: "opt_fulltime" },
            { from: "dec_1", to: "opt_contract" },
            { from: "dec_1", to: "opt_defer" },
            { from: "opt_fulltime", to: "out_capacity", weight: 10, belief: 0.8 },
            { from: "opt_fulltime", to: "out_cost", weight: 150000, belief: 0.95 },
            { from: "opt_contract", to: "out_capacity", weight: 8, belief: 0.75 },
            { from: "opt_contract", to: "out_cost", weight: 120000, belief: 0.9 },
          ],
          meta: {
            roots: ["goal_1"],
            leaves: ["out_capacity", "out_cost"],
            suggested_positions: {},
            source: "assistant",
          },
        },
        rationales: [
          { target: "opt_fulltime", why: "Long-term investment, team stability" },
          { target: "opt_contract", why: "Flexibility, faster onboarding" },
        ],
      });
    }

    // Default fallback
    return Promise.resolve({
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Achieve objective" },
          { id: "dec_1", kind: "decision", label: "Choose approach" },
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "opt_2", kind: "option", label: "Option B" },
          { id: "out_1", kind: "outcome", label: "Expected result" },
        ],
        edges: [
          { from: "goal_1", to: "dec_1" },
          { from: "dec_1", to: "opt_1" },
          { from: "dec_1", to: "opt_2" },
          { from: "opt_1", to: "out_1" },
          { from: "opt_2", to: "out_1" },
        ],
        meta: {
          roots: ["goal_1"],
          leaves: ["out_1"],
          suggested_positions: {},
          source: "assistant",
        },
      },
      rationales: [],
    });
  }),
  repairGraphWithAnthropic: vi.fn(),
}));

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe("Golden Brief Archetypes", () => {
  describe("Archetype 1: Buy vs Build", () => {
    // Fixture-based test (deterministic, no mock state issues)
    it("matches buy-vs-build archetype structure (fixture-based)", async () => {
      const fixture = await loadGoldenBrief(GOLDEN_BRIEFS.BUY_VS_BUILD);

      // Mock LLM to return fixture data
      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      vi.mocked(draftGraphWithAnthropic).mockResolvedValueOnce({
        graph: fixture.expected_response.graph,
        rationales: fixture.expected_response.rationales,
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: fixture.brief },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Validate graph structure matches archetype
      expect(body.graph.nodes.length).toBe(6);
      expect(body.graph.default_seed).toBe(17);

      // Verify decision graph pattern: goal → decision → options → outcomes
      const hasGoal = body.graph.nodes.some((n: any) => n.kind === "goal");
      const hasDecision = body.graph.nodes.some((n: any) => n.kind === "decision");
      const hasOptions = body.graph.nodes.filter((n: any) => n.kind === "option").length === 2;
      const hasOutcomes = body.graph.nodes.some((n: any) => n.kind === "outcome");

      expect(hasGoal).toBe(true);
      expect(hasDecision).toBe(true);
      expect(hasOptions).toBe(true);
      expect(hasOutcomes).toBe(true);

      // Verify cost/time tradeoff edges exist
      const hasWeightedEdges = body.graph.edges.some((e: any) => e.weight !== undefined);
      const hasBeliefScores = body.graph.edges.some((e: any) => e.belief !== undefined);

      expect(hasWeightedEdges).toBe(true);
      expect(hasBeliefScores).toBe(true);

      // Verify rationales for options
      expect(body.rationales).toBeDefined();
      expect(body.rationales.length).toBeGreaterThan(0);
    });

    // TODO: TEST-001 - Fix mock to return archetype-specific graphs instead of default
    // See Docs/issues/test-mock-refinement.md
    it.skip("generates deterministic buy-vs-build decision graph", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Should we buy a commercial CRM system or build our own? We need to launch within 6 months with a budget of $200k.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Validate graph structure
      expect(body.graph.nodes.length).toBe(6);
      expect(body.graph.edges.length).toBeGreaterThan(0);

      // Check for expected node types
      const hasGoal = body.graph.nodes.some((n: any) => n.kind === "goal");
      const hasDecision = body.graph.nodes.some((n: any) => n.kind === "decision");
      const hasOptions = body.graph.nodes.filter((n: any) => n.kind === "option").length >= 2;
      const hasOutcomes = body.graph.nodes.some((n: any) => n.kind === "outcome");

      expect(hasGoal).toBe(true);
      expect(hasDecision).toBe(true);
      expect(hasOptions).toBe(true);
      expect(hasOutcomes).toBe(true);

      // Check for cost/time trade-off edges
      const hasWeightedEdges = body.graph.edges.some((e: any) => e.weight !== undefined);
      const hasBeliefScores = body.graph.edges.some((e: any) => e.belief !== undefined);

      expect(hasWeightedEdges).toBe(true);
      expect(hasBeliefScores).toBe(true);

      // Verify deterministic seed
      expect(body.graph.default_seed).toBe(17);

      // Check for rationales
      expect(body.rationales).toBeDefined();
      expect(body.rationales.length).toBeGreaterThan(0);
    });

    it("produces consistent graph structure across invocations", async () => {
      const app = Fastify();
      await draftRoute(app);

      const brief = "Make or buy decision for payment processing system with compliance requirements";

      const res1 = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief },
      });

      const res2 = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief },
      });

      const graph1 = JSON.parse(res1.body).graph;
      const graph2 = JSON.parse(res2.body).graph;

      // Same structure
      expect(graph1.nodes.length).toBe(graph2.nodes.length);
      expect(graph1.edges.length).toBe(graph2.edges.length);
      expect(graph1.default_seed).toBe(graph2.default_seed);

      // Same node IDs in same order
      const nodeIds1 = graph1.nodes.map((n: any) => n.id);
      const nodeIds2 = graph2.nodes.map((n: any) => n.id);
      expect(nodeIds1).toEqual(nodeIds2);
    });
  });

  describe("Archetype 2: Hiring Decision", () => {
    it("generates deterministic hiring decision graph", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Should we hire 3 full-time engineers or use contract workers? Team needs to scale quickly but budget is tight.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.graph.nodes.length).toBeGreaterThan(4);

      // Should have hiring options
      const options = body.graph.nodes.filter((n: any) => n.kind === "option");
      expect(options.length).toBeGreaterThanOrEqual(2);

      // Should have cost and capacity outcomes
      const outcomes = body.graph.nodes.filter((n: any) => n.kind === "outcome");
      expect(outcomes.length).toBeGreaterThan(0);

      // Cost edges should exist
      const costEdges = body.graph.edges.filter((e: any) => e.weight && e.weight > 0);
      expect(costEdges.length).toBeGreaterThan(0);
    });
  });

  describe("Archetype 3: Generic Decision", () => {
    it("handles generic brief without specific keywords", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "We need to decide on our strategic direction for the next quarter with limited resources available.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Should still produce valid graph
      expect(body.graph.nodes.length).toBeGreaterThan(0);
      expect(body.graph.edges.length).toBeGreaterThan(0);
      expect(body.graph.meta.roots).toBeDefined();
      expect(body.graph.meta.leaves).toBeDefined();

      // Must be a DAG
      expect(body.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(body.graph.edges.length).toBeLessThanOrEqual(24);
    });
  });

  describe("Deterministic Behavior", () => {
    it("respects deterministic seed for reproducibility", async () => {
      const app = Fastify();
      await draftRoute(app);

      const brief = "Technical architecture decision: microservices vs monolith for new product with time pressure";

      const responses = [];
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/assist/draft-graph",
          payload: { brief },
        });
        responses.push(JSON.parse(res.body));
      }

      // All should have same seed
      const seeds = responses.map((r) => r.graph.default_seed);
      expect(seeds.every((s) => s === seeds[0])).toBe(true);

      // All should have same node count
      const nodeCounts = responses.map((r) => r.graph.nodes.length);
      expect(nodeCounts.every((c) => c === nodeCounts[0])).toBe(true);
    });

    it("includes meta.source for tracking graph origin", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic planning for Q4 with focus on revenue growth and customer satisfaction metrics",
        },
      });

      const body = JSON.parse(res.body);
      expect(body.graph.meta.source).toBe("assistant");
    });
  });

  describe("Graph Quality Checks", () => {
    it("enforces max nodes (12) and edges (24) limits", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Complex multi-stakeholder decision involving product strategy, technical architecture, hiring, budgets, and timelines",
        },
      });

      const body = JSON.parse(res.body);
      expect(body.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(body.graph.edges.length).toBeLessThanOrEqual(24);
    });

    it("ensures all edges reference valid nodes", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Product launch decision with market timing, feature scope, and competitive positioning considerations",
        },
      });

      const body = JSON.parse(res.body);
      const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));

      body.graph.edges.forEach((edge: any) => {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      });
    });

    it("validates belief scores are in [0, 1] range", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Investment decision under uncertainty with multiple risk factors and unknown outcomes needing careful analysis",
        },
      });

      const body = JSON.parse(res.body);
      const edgesWithBelief = body.graph.edges.filter((e: any) => e.belief !== undefined);

      edgesWithBelief.forEach((edge: any) => {
        expect(edge.belief).toBeGreaterThanOrEqual(0);
        expect(edge.belief).toBeLessThanOrEqual(1);
      });
    });
  });
});
