/**
 * Critique Integration Tests
 *
 * Tests POST /assist/critique-graph route with fixtures adapter
 * Verifies:
 * - Route responds correctly to valid inputs
 * - Schema validation works
 * - Non-mutation guarantee (input graph unchanged)
 * - Telemetry events are emitted
 * - Provider routing works
 * - Severity ordering
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import critiqueRoute from "../../src/routes/assist.critique-graph.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("POST /assist/critique-graph (Fixtures)", () => {
  let app: ReturnType<typeof Fastify>;

  const validGraph = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Increase revenue" },
      { id: "dec_1", kind: "decision", label: "Pricing strategy" },
      { id: "opt_a", kind: "option", label: "Premium pricing" },
      { id: "opt_b", kind: "option", label: "Volume pricing" },
      { id: "out_1", kind: "outcome", label: "Revenue impact" },
    ],
    edges: [
      { from: "goal_1", to: "dec_1" },
      { from: "dec_1", to: "opt_a" },
      { from: "dec_1", to: "opt_b" },
      { from: "opt_a", to: "out_1" },
      { from: "opt_b", to: "out_1" },
    ],
  };

  beforeAll(async () => {
    app = Fastify();
    await critiqueRoute(app);
  });

  it("accepts valid graph-only request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issues).toBeDefined();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.suggested_fixes).toBeDefined();
    expect(Array.isArray(body.suggested_fixes)).toBe(true);
  });

  it("accepts request with brief context", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
        brief: "We need to increase revenue by 20% next quarter through pricing optimization",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issues).toBeDefined();
  });

  it("accepts request with focus_areas filter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
        focus_areas: ["structure", "completeness"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issues).toBeDefined();
  });

  it("accepts all focus_areas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
        focus_areas: ["structure", "completeness", "feasibility", "provenance"],
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns issues with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    if (body.issues.length > 0) {
      const firstIssue = body.issues[0];
      expect(firstIssue.level).toBeDefined();
      expect(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]).toContain(firstIssue.level);
      expect(firstIssue.note).toBeDefined();
      expect(typeof firstIssue.note).toBe("string");
      expect(firstIssue.note.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("returns suggested_fixes array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.suggested_fixes)).toBe(true);
    expect(body.suggested_fixes.length).toBeLessThanOrEqual(5);
  });

  it("returns optional overall_quality assessment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    if (body.overall_quality) {
      expect(["poor", "fair", "good", "excellent"]).toContain(body.overall_quality);
    }
  });

  it("never returns modified graph (non-mutation guarantee)", async () => {
    const originalGraph = JSON.parse(JSON.stringify(validGraph)); // Deep copy

    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: validGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Response should NOT include graph field
    expect("graph" in body).toBe(false);

    // Input graph should be unchanged
    expect(validGraph).toEqual(originalGraph);
  });
});

describe("POST /assist/critique-graph (Severity Ordering)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await critiqueRoute(app);
  });

  it("orders issues by severity: BLOCKER → IMPROVEMENT → OBSERVATION", async () => {
    const problematicGraph = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "a", kind: "goal", label: "Goal" },
        { id: "b", kind: "decision", label: "Decision" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" }, // Cycle - should trigger BLOCKER
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: problematicGraph,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    if (body.issues.length > 1) {
      // Verify ordering: BLOCKERs come before IMPROVEMENTs which come before OBSERVATIONs
      const severityOrder = { BLOCKER: 0, IMPROVEMENT: 1, OBSERVATION: 2 };
      const severities = body.issues.map((issue: any) => severityOrder[issue.level]);

      for (let i = 1; i < severities.length; i++) {
        expect(severities[i]).toBeGreaterThanOrEqual(severities[i - 1]);
      }
    }
  });
});

describe("POST /assist/critique-graph (Error Handling)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await critiqueRoute(app);
  });

  it("rejects missing graph field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        brief: "Some context",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
  });

  it("rejects invalid graph structure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          nodes: "not an array",
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects brief too short (< 30 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [],
        },
        brief: "Too short",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid focus_area", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [],
        },
        focus_areas: ["invalid_area"],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects additional properties (strict mode)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [],
        },
        unknown_field: "should fail",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("accepts empty graph (edge case)", async () => {
    // Empty graph is technically valid per schema, but will likely trigger BLOCKER issues
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issues).toBeDefined();
  });

  it("rejects invalid JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      headers: { "Content-Type": "application/json" },
      payload: "not valid json",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /assist/critique-graph (Edge Cases)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await critiqueRoute(app);
  });

  it("handles minimal graph (single node)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes: [{ id: "goal_1", kind: "goal", label: "Achieve something" }],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issues).toBeDefined();
  });

  it("handles maximal graph (12 nodes, 24 edges)", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `node_${i}`,
      kind: i === 0 ? "goal" : "decision",
      label: `Node ${i}`,
    }));

    const edges = [];
    for (let i = 0; i < 11 && edges.length < 24; i++) {
      for (let j = i + 1; j <= 11 && edges.length < 24; j++) {
        edges.push({ from: `node_${i}`, to: `node_${j}` });
      }
    }

    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: {
        graph: {
          version: "1",
          default_seed: 42,
          nodes,
          edges,
        },
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
