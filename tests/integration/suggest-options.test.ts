/**
 * Suggest Options Integration Tests
 *
 * Tests POST /assist/suggest-options with fixtures adapter
 * Verifies:
 * - Route responds correctly to valid inputs
 * - Schema validation works
 * - Deterministic sorting (by id alphabetically)
 * - Capability error mapping
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import suggestRoute from "../../src/routes/assist.suggest-options.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("POST /assist/suggest-options", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await suggestRoute(app);
  });

  it("accepts valid goal input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/suggest-options",
      payload: {
        goal: "Optimize hiring strategy for my startup",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.options).toBeDefined();
    expect(Array.isArray(body.options)).toBe(true);
    expect(body.options.length).toBeGreaterThanOrEqual(3);
    expect(body.options.length).toBeLessThanOrEqual(5);
  });

  it("returns options with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/suggest-options",
      payload: {
        goal: "Choose cloud provider",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const firstOption = body.options[0];

    expect(firstOption.id).toBeDefined();
    expect(typeof firstOption.id).toBe("string");
    expect(firstOption.title).toBeDefined();
    expect(firstOption.pros).toBeDefined();
    expect(Array.isArray(firstOption.pros)).toBe(true);
    expect(firstOption.pros.length).toBeGreaterThanOrEqual(2);
    expect(firstOption.cons).toBeDefined();
    expect(Array.isArray(firstOption.cons)).toBe(true);
    expect(firstOption.cons.length).toBeGreaterThanOrEqual(2);
    expect(firstOption.evidence_to_gather).toBeDefined();
    expect(Array.isArray(firstOption.evidence_to_gather)).toBe(true);
  });

  it("sorts options deterministically by id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/suggest-options",
      payload: {
        goal: "Select database technology",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    const ids = body.options.map((opt: any) => opt.id);
    const sortedIds = [...ids].sort();
    expect(ids).toEqual(sortedIds); // Should already be sorted
  });

  it("rejects goal too short", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/suggest-options",
      payload: {
        goal: "Hi",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
  });

  it("rejects missing goal field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/suggest-options",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
  });
});
