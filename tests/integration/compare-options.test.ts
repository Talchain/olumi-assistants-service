import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("POST /assist/compare-options", () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Clear module cache and set test env
    vi.resetModules();
    process.env.LLM_PROVIDER = "fixtures";
    process.env.ASSIST_API_KEYS = "test-key-1";

    // Dynamic import after env is set
    const { build } = await import("../../src/server.js");
    app = await build();
  });

  afterAll(async () => {
    await app.close();
    // Restore env
    process.env = originalEnv;
    vi.resetModules();
  });

  it("should compare options in multi mode (default)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "opt_1", kind: "option", label: "Option A", body: "Description A" },
            { id: "opt_2", kind: "option", label: "Option B", body: "Description B" },
          ],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "opt_2"],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.option_ids).toEqual(["opt_1", "opt_2"]);
    expect(body.fields).toBeDefined();
    expect(body.edges_from).toBeDefined();
    expect(body.edges_to).toBeDefined();
  });

  it("should compare options in pair mode", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "opt_1", kind: "option", label: "Option A" },
            { id: "opt_2", kind: "option", label: "Option B" },
          ],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "opt_2"],
        mode: "pair",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.option_a).toBeDefined();
    expect(body.option_b).toBeDefined();
    expect(body.label_diff).toBeDefined();
    expect(body.body_diff).toBeDefined();
  });

  it("should compare options in matrix mode", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "opt_1", kind: "option", label: "A" },
            { id: "opt_2", kind: "option", label: "B" },
            { id: "opt_3", kind: "option", label: "C" },
          ],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "opt_2", "opt_3"],
        mode: "matrix",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.opt_1).toBeDefined();
    expect(body.opt_2).toBeDefined();
    expect(body.opt_3).toBeDefined();
    expect(body.opt_1.opt_1).toBe(1.0); // Self-similarity
  });

  it("should return 400 if less than 2 option IDs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "opt_1", kind: "option", label: "A" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1"],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
  });

  it("should return 400 if pair mode with != 2 options", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "opt_1", kind: "option", label: "A" },
            { id: "opt_2", kind: "option", label: "B" },
            { id: "opt_3", kind: "option", label: "C" },
          ],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "opt_2", "opt_3"],
        mode: "pair",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toContain("exactly 2");
  });

  it("should return 400 if option not found", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "opt_1", kind: "option", label: "A" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "opt_999"],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toContain("not found");
  });

  it("should return 400 if node is not an option", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "opt_1", kind: "option", label: "A" },
            { id: "goal_1", kind: "goal", label: "G" },
          ],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        option_ids: ["opt_1", "goal_1"],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toContain("not an option");
  });

  it("should return 400 if invalid graph schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/compare-options",
      headers: {
        "X-Olumi-Assist-Key": "test-key-1",
      },
      payload: {
        graph: {
          version: "1",
          // Missing required fields
          nodes: [],
          edges: [],
        },
        option_ids: ["opt_1", "opt_2"],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
  });
});
