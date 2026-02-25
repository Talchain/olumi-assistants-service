import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock LLM adapter before imports
vi.mock("../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: "fixtures",
    model: "test-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { op: "add_node", path: "nodes/new_factor", value: { id: "new_factor", kind: "factor", label: "New Factor" } },
      ]),
    }),
  }),
}));

// Mock prompt loader
vi.mock("../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
}));

// Mock PLoT client (no PLOT_BASE_URL in tests)
vi.mock("../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn().mockReturnValue(null),
}));

// Mock config
vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "features") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === "orchestrator") return true;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import editGraphRoute from "../../../src/routes/assist.v1.edit-graph.js";
import { getAdapter } from "../../../src/adapters/llm/router.js";

// ============================================================================
// Tests
// ============================================================================

describe("POST /assist/v1/edit-graph — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await editGraphRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------
  // Validation
  // ---------------------------------------------------

  it("returns 400 for missing edit_description", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/v1/edit-graph",
      payload: { graph: { nodes: [], edges: [] } },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for empty edit_description", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/v1/edit-graph",
      payload: { graph: { nodes: [], edges: [] }, edit_description: "" },
    });

    expect(response.statusCode).toBe(400);
  });

  // ---------------------------------------------------
  // Success
  // ---------------------------------------------------

  it("returns 200 with blocks on success", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/v1/edit-graph",
      payload: {
        graph: { nodes: [{ id: "goal", kind: "goal", label: "My Goal" }], edges: [] },
        edit_description: "Add a new cost factor",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
    expect(body.blocks[0].block_type).toBe("graph_patch");
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------
  // Error mapping (uses getHttpStatusForError)
  // ---------------------------------------------------

  it("returns 502 for TOOL_EXECUTION_FAILED when no graph provided", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/v1/edit-graph",
      payload: {
        graph: null,
        edit_description: "Add a factor",
      },
    });

    // handleEditGraph throws TOOL_EXECUTION_FAILED when graph is null
    expect(response.statusCode).toBe(502);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("TOOL_EXECUTION_FAILED");
  });

  it("returns 502 for LLM call failures (mapped to TOOL_EXECUTION_FAILED by handler)", async () => {
    // Make adapter.chat throw on ALL calls (default mock + mockRejectedValue)
    // to ensure retry loop exhausts all attempts
    const adapter = getAdapter("orchestrator") as unknown as { chat: ReturnType<typeof vi.fn> };
    const originalImpl = adapter.chat.getMockImplementation();

    // Override: always reject for this test
    adapter.chat.mockRejectedValue(new Error("Request timed out"));

    const response = await app.inject({
      method: "POST",
      url: "/assist/v1/edit-graph",
      payload: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        edit_description: "Add a factor",
      },
    });

    expect(response.statusCode).toBe(502);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("TOOL_EXECUTION_FAILED");
    expect(body.error.recoverable).toBe(true);

    // Restore default mock for subsequent tests
    if (originalImpl) {
      adapter.chat.mockImplementation(originalImpl);
    } else {
      adapter.chat.mockResolvedValue({
        content: JSON.stringify([
          { op: "add_node", path: "nodes/new_factor", value: { id: "new_factor", kind: "factor", label: "New Factor" } },
        ]),
      });
    }
  });
});
