import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock LLM adapter before imports
vi.mock("../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: "fixtures",
    model: "test-model",
    chat: vi.fn().mockResolvedValue({ content: "Test response" }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "I can help with that." }],
      stop_reason: "end_turn",
    }),
  }),
}));

// Mock PLoT client
vi.mock("../../../src/orchestrator/plot-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/orchestrator/plot-client.js")>();
  return {
    ...original,
    createPLoTClient: vi.fn().mockReturnValue(null),
  };
});

// Mock config to enable orchestrator
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
        if (prop === "plot") {
          return { baseUrl: undefined };
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { ceeOrchestratorRouteV1 } from "../../../src/orchestrator/route.js";
import { _clearIdempotencyCache } from "../../../src/orchestrator/idempotency.js";

// ============================================================================
// Helpers
// ============================================================================

function makeValidRequest(overrides?: Record<string, unknown>) {
  return {
    message: "Hello, how can you help?",
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: "frame" },
      messages: [],
      scenario_id: "test-scenario",
    },
    scenario_id: "test-scenario",
    client_turn_id: "test-turn-001",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("POST /orchestrate/v1/turn — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV1(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    _clearIdempotencyCache();
  });

  // ---------------------------------------------------
  // Request Validation
  // ---------------------------------------------------

  it("returns 400 for missing message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ message: "" }),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for missing context", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: {
        message: "hello",
        scenario_id: "test",
        client_turn_id: "turn-1",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for missing client_turn_id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: {
        message: "hello",
        context: {
          graph: null,
          analysis_response: null,
          framing: { stage: "frame" },
          messages: [],
          scenario_id: "test",
        },
        scenario_id: "test",
        // no client_turn_id
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for invalid framing stage", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({
        context: {
          graph: null,
          analysis_response: null,
          framing: { stage: "invalid_stage" },
          messages: [],
          scenario_id: "test",
        },
      }),
    });

    expect(response.statusCode).toBe(400);
  });

  // ---------------------------------------------------
  // Successful Turns
  // ---------------------------------------------------

  it("returns 200 with valid envelope for conversation turn", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Verify envelope structure
    expect(body).toHaveProperty("turn_id");
    expect(body).toHaveProperty("blocks");
    expect(body).toHaveProperty("lineage");
    expect(body.lineage).toHaveProperty("context_hash");
    expect(body.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it("includes stage_indicator from framing context", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({
        context: {
          graph: null,
          analysis_response: null,
          framing: { stage: "evaluate" },
          messages: [],
          scenario_id: "test-scenario",
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.stage_indicator).toBe("evaluate");
    expect(body.stage_label).toBe("Evaluating options");
  });

  // ---------------------------------------------------
  // System Events
  // ---------------------------------------------------

  it("returns 200 with empty blocks for patch_accepted event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({
        system_event: {
          type: "patch_accepted",
          payload: { block_id: "blk_123" },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.blocks).toEqual([]);
    expect(body.assistant_text).toBeNull();
    expect(body.turn_plan?.routing).toBe("deterministic");
  });

  it("returns 200 with empty blocks for feedback_submitted event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({
        system_event: {
          type: "feedback_submitted",
          payload: { rating: "positive" },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.blocks).toEqual([]);
  });

  // ---------------------------------------------------
  // Deterministic Routing
  // ---------------------------------------------------

  it("routes 'undo' to LLM (no deterministic match — removed in v2)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ message: "undo" }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.turn_plan?.routing).toBe("llm");
    expect(body.turn_plan?.selected_tool).toBeNull();
  });

  it("routes 'generate brief' deterministically", async () => {
    // No analysis_response → recoverable error
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ message: "generate brief" }),
    });

    // generate_brief with no analysis_response throws recoverable error → 502
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
    expect(body.turn_plan?.selected_tool).toBe("generate_brief");
    expect(body.turn_plan?.routing).toBe("deterministic");
  });

  // ---------------------------------------------------
  // Idempotency
  // ---------------------------------------------------

  it("returns cached response for duplicate client_turn_id", async () => {
    const payload = makeValidRequest({ client_turn_id: "idempotent-test-001" });

    const first = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload,
    });

    const second = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const body1 = JSON.parse(first.body);
    const body2 = JSON.parse(second.body);
    expect(body1.turn_id).toBe(body2.turn_id);
  });

  // ---------------------------------------------------
  // Error Responses
  // ---------------------------------------------------

  it("returns 502 for run_analysis without PLoT client", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ message: "run analysis" }),
    });

    const body = JSON.parse(response.body);
    // run_analysis needs graph + analysis_inputs, or PLoT client —
    // either way it should return an error, not crash
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("TOOL_EXECUTION_FAILED");
  });

  // ---------------------------------------------------
  // 404 when feature disabled (NOT tested here since we mock config.features.orchestrator = true)
  // The feature flag gating is in server.ts, not in the route itself.
  // ---------------------------------------------------
});
