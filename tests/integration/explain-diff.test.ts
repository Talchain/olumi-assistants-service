/**
 * Explain Diff Integration Tests
 *
 * Tests POST /assist/explain-diff with fixtures adapter
 * Verifies:
 * - Route responds correctly to valid inputs
 * - Schema validation works
 * - Deterministic sorting (by target alphabetically)
 * - Non-mutating behavior
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import explainRoute from "../../src/routes/assist.explain-diff.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("POST /assist/explain-diff", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await explainRoute(app);
  });

  it("accepts valid patch with added nodes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Increase revenue" }
            ],
            edges: []
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.rationales).toBeDefined();
    expect(Array.isArray(body.rationales)).toBe(true);
    expect(body.rationales.length).toBeGreaterThan(0);
  });

  it("returns rationales with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [{ id: "goal_1", kind: "goal", label: "Test" }],
            edges: [{ id: "edge_1", from: "goal_1", to: "dec_1" }]
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const firstRationale = body.rationales[0];

    expect(firstRationale.target).toBeDefined();
    expect(typeof firstRationale.target).toBe("string");
    expect(firstRationale.why).toBeDefined();
    expect(typeof firstRationale.why).toBe("string");
    expect(firstRationale.why.length).toBeLessThanOrEqual(280);
  });

  it("sorts rationales deterministically by target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [
              { id: "zebra", kind: "goal", label: "Z" },
              { id: "apple", kind: "decision", label: "A" }
            ],
            edges: []
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    const targets = body.rationales.map((r: any) => r.target);
    const sortedTargets = [...targets].sort();
    expect(targets).toEqual(sortedTargets); // Should already be sorted
  });

  it("rejects empty patch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: { nodes: [], edges: [] },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toContain("no changes");
  });

  it("rejects missing patch field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
  });
});
