/**
 * Integration tests for trace.goal_handling observability
 *
 * Tests that the draft-graph endpoint properly tracks goal handling
 * and returns the trace.goal_handling object in responses.
 *
 * Uses X-Debug-Force-Missing-Kinds header for deterministic testing
 * of the goal repair path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs
vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("NODE_ENV", "test"); // Ensure fault injection is enabled

// Configure API keys for test - multiple keys to avoid rate limiting
vi.stubEnv("ASSIST_API_KEYS", "goal-trace-happy,goal-trace-repair,goal-trace-safety,goal-trace-safety-2,goal-trace-schema");
vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "100"); // Increase rate limit for tests

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({
    warnings: [],
    uncertainNodeIds: [],
  }),
  detectUniformStrengths: () => ({
    detected: false,
    totalEdges: 0,
    defaultStrengthCount: 0,
    defaultStrengthPercentage: 0,
  }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }),
  // Goal inference utilities - needed for goal repair
  hasGoalNode: (graph: any) => {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    return graph.nodes.some((n: any) => n.kind === "goal");
  },
  ensureGoalNode: (graph: any, brief: string, _explicitGoal?: string) => {
    // Check if goal already exists
    if (graph && Array.isArray(graph.nodes)) {
      const hasGoal = graph.nodes.some((n: any) => n.kind === "goal");
      if (hasGoal) {
        return {
          graph,
          goalAdded: false,
          inferredFrom: undefined,
          goalNodeId: undefined,
        };
      }
    }

    // Add goal based on brief or placeholder
    const goalId = `goal_inferred_${Date.now()}`;
    const hasPattern = brief.toLowerCase().includes("focus") ||
                       brief.toLowerCase().includes("achieve") ||
                       brief.toLowerCase().includes("improve");

    const goalLabel = hasPattern
      ? "Focus on high-value tasks"
      : "Achieve the best outcome for this decision";

    const newGraph = {
      ...graph,
      nodes: [
        ...(graph?.nodes || []),
        { id: goalId, kind: "goal", label: goalLabel },
      ],
      edges: [...(graph?.edges || [])],
    };

    // Wire outcomes/risks to goal
    const outcomes = newGraph.nodes.filter((n: any) =>
      n.kind === "outcome" || n.kind === "risk"
    );
    for (const outcome of outcomes) {
      const isRisk = (outcome as any).kind === "risk";
      newGraph.edges.push({
        from: (outcome as any).id,
        to: goalId,
        strength: { mean: isRisk ? -0.5 : 0.6, std: 0.15 },
        exists_probability: 0.8,
      });
    }

    return {
      graph: newGraph,
      goalAdded: true,
      inferredFrom: hasPattern ? "brief" : "placeholder",
      goalNodeId: goalId,
    };
  },
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/draft-graph trace.goal_handling", () => {
  let app: FastifyInstance;

  // Different keys for each test group to avoid rate limiting
  const headersHappy = { "X-Olumi-Assist-Key": "goal-trace-happy" } as const;
  const headersRepair = { "X-Olumi-Assist-Key": "goal-trace-repair" } as const;
  const headersSafety = { "X-Olumi-Assist-Key": "goal-trace-safety" } as const;
  const headersSchema = { "X-Olumi-Assist-Key": "goal-trace-schema" } as const;

  beforeAll(async () => {
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Happy path - LLM generates goal", () => {
    it("returns goal_source='llm_generated' when LLM includes goal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: headersHappy,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // trace.goal_handling must be present
      expect(body.trace).toBeDefined();
      expect(body.trace.goal_handling).toBeDefined();

      // LLM generated goal
      expect(body.trace.goal_handling.goal_source).toBe("llm_generated");
      expect(body.trace.goal_handling.retry_attempted).toBe(false);

      // No original_missing_kinds since goal was present
      expect(body.trace.goal_handling.original_missing_kinds).toBeUndefined();
    });

    it("does not include goal_inferred warning when LLM generates goal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: headersHappy,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // No goal_inferred warning
      const goalWarning = body.draft_warnings?.find(
        (w: any) => w.id === "goal_inferred"
      );
      expect(goalWarning).toBeUndefined();
    });
  });

  describe("Repair path - Goal missing from LLM response", () => {
    it("repairs goal and returns goal_source='inferred' when brief has pattern", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          ...headersRepair,
          "X-Debug-Force-Missing-Kinds": "goal", // Strip goal to test repair
        },
        payload: {
          brief: "Should I hire a PA to enable me to focus on high-value tasks?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // trace.goal_handling must show repair
      expect(body.trace.goal_handling).toBeDefined();
      expect(body.trace.goal_handling.goal_source).toBe("inferred");
      expect(body.trace.goal_handling.retry_attempted).toBe(false);

      // original_missing_kinds should include goal
      expect(body.trace.goal_handling.original_missing_kinds).toContain("goal");

      // Goal node ID should be present
      expect(body.trace.goal_handling.goal_node_id).toBeDefined();

      // Graph should now have a goal node
      const goalNodes = body.nodes?.filter((n: any) => n.kind === "goal");
      expect(goalNodes?.length).toBeGreaterThanOrEqual(1);
    });

    it("repairs goal and returns goal_source='placeholder' when no pattern in brief", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          ...headersRepair,
          "X-Debug-Force-Missing-Kinds": "goal", // Strip goal to test repair
        },
        payload: {
          brief: "React or Vue for our frontend?", // No goal pattern
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // trace.goal_handling must show placeholder repair
      expect(body.trace.goal_handling).toBeDefined();
      expect(body.trace.goal_handling.goal_source).toBe("placeholder");
      expect(body.trace.goal_handling.retry_attempted).toBe(false);

      // original_missing_kinds should include goal
      expect(body.trace.goal_handling.original_missing_kinds).toContain("goal");
    });

    it("includes goal_inferred warning when repair occurs", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          ...headersRepair,
          "X-Debug-Force-Missing-Kinds": "goal",
        },
        payload: {
          brief: "Should I hire a PA to enable me to focus on strategic work?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // draft_warnings should contain goal_inferred
      expect(body.draft_warnings).toBeDefined();
      const goalWarning = body.draft_warnings?.find(
        (w: any) => w.id === "goal_inferred"
      );
      expect(goalWarning).toBeDefined();
      expect(goalWarning.severity).toBe("medium");
      expect(goalWarning.explanation).toContain("inferred");
    });
  });

  describe("Fault injection safety", () => {
    it("fault injection only works with header present", async () => {
      // Without fault injection header - should get llm_generated goal
      const res1 = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: headersSafety,
        payload: {
          brief: "Should we increase our subscription pricing from $49 to $59 per month?",
        },
      });

      // Debug: log response if not 200
      if (res1.statusCode !== 200) {
        console.log("First request failed:", JSON.parse(res1.body));
      }

      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.body);

      // Should be llm_generated (no fault injection)
      expect(body1.trace.goal_handling.goal_source).toBe("llm_generated");

      // With fault injection header - should trigger repair
      // Use a different key to avoid rate limiting
      const res2 = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "X-Olumi-Assist-Key": "goal-trace-safety-2",
          "X-Debug-Force-Missing-Kinds": "goal",
        },
        payload: {
          brief: "Should we increase our subscription pricing from $49 to $59 per month?",
        },
      });

      // Debug: log response if not 200
      if (res2.statusCode !== 200) {
        console.log("Second request failed:", JSON.parse(res2.body));
      }

      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.body);

      // Should be inferred or placeholder (fault injection triggered repair)
      expect(["inferred", "placeholder"]).toContain(
        body2.trace.goal_handling.goal_source
      );
    });
  });

  describe("trace.goal_handling structure", () => {
    it("has correct schema in happy path", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: headersSchema,
        payload: {
          brief: "Should we expand to new markets?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const gh = body.trace.goal_handling;
      expect(gh).toBeDefined();

      // Required fields
      expect(typeof gh.goal_source).toBe("string");
      expect(["llm_generated", "retry_generated", "inferred", "placeholder"]).toContain(
        gh.goal_source
      );
      expect(typeof gh.retry_attempted).toBe("boolean");

      // Optional fields
      if (gh.original_missing_kinds !== undefined) {
        expect(Array.isArray(gh.original_missing_kinds)).toBe(true);
      }
      if (gh.goal_node_id !== undefined) {
        expect(typeof gh.goal_node_id).toBe("string");
      }
    });

    it("has correct schema in repair path", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          ...headersSchema,
          "X-Debug-Force-Missing-Kinds": "goal",
        },
        payload: {
          brief: "Should we hire more engineers?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const gh = body.trace.goal_handling;
      expect(gh).toBeDefined();

      // In repair path, goal_source should be inferred or placeholder
      expect(["inferred", "placeholder"]).toContain(gh.goal_source);

      // original_missing_kinds should be present
      expect(Array.isArray(gh.original_missing_kinds)).toBe(true);
      expect(gh.original_missing_kinds).toContain("goal");

      // goal_node_id should be present (the repaired goal)
      expect(typeof gh.goal_node_id).toBe("string");
    });
  });
});
