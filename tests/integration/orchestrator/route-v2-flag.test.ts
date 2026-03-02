/**
 * Flag-on / flag-off routing smoke tests.
 *
 * Uses app.inject() against /orchestrate/v1/turn to prove:
 * - orchestratorV2 ON  → response contains V2-only fields
 * - orchestratorV2 OFF → response does NOT contain V2-only fields
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ============================================================================
// Mocks — shared by both flag-on and flag-off tests
// ============================================================================

// Mock LLM adapter (V1 path uses this)
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

// Mock executePipeline (V2 path) — returns a V2 envelope with all V2-only fields
vi.mock("../../../src/orchestrator/pipeline/pipeline.js", () => ({
  executePipeline: vi.fn().mockResolvedValue({
    turn_id: "v2-mock-turn",
    assistant_text: "V2 mock response",
    blocks: [],
    suggested_actions: [],
    lineage: { context_hash: "abc123", dsk_version_hash: null },
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    science_ledger: { claims_used: [], techniques_used: [], scope_violations: [], phrasing_violations: [], rewrite_applied: false },
    progress_marker: { kind: "none" },
    observability: { triggers_fired: [], triggers_suppressed: [], intent_classification: "conversational", specialist_contributions: [], specialist_disagreement: null },
    turn_plan: { selected_tool: null, routing: "llm", long_running: false },
  }),
}));

// Mock production dep factories (V2 path needs these)
vi.mock("../../../src/orchestrator/pipeline/llm-client.js", () => ({
  createProductionLLMClient: vi.fn().mockReturnValue({ chatWithTools: vi.fn(), chat: vi.fn() }),
}));

vi.mock("../../../src/orchestrator/pipeline/phase4-tools/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/orchestrator/pipeline/phase4-tools/index.js")>();
  return {
    ...original,
    createProductionToolDispatcher: vi.fn().mockReturnValue({ dispatch: vi.fn() }),
  };
});

// Toggleable feature flag — controls V1 vs V2 dispatch
let v2Enabled = false;

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
              if (featProp === "orchestratorV2") return v2Enabled;
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
import { _clearNonceMap } from "../../../src/orchestrator/pipeline/route-v2.js";

// ============================================================================
// Helpers
// ============================================================================

const V2_ONLY_FIELDS = ["science_ledger", "progress_marker", "observability"] as const;

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

describe("V2 flag routing — app.inject()", () => {
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
    _clearNonceMap();
  });

  it("flag ON: response contains V2-only fields", async () => {
    v2Enabled = true;
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ client_turn_id: "v2-flag-on" }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    for (const field of V2_ONLY_FIELDS) {
      expect(body).toHaveProperty(field);
    }
    // Verify V2 fields are populated, not just present
    expect(body.science_ledger.claims_used).toEqual([]);
    expect(body.progress_marker.kind).toBeDefined();
    expect(body.observability.intent_classification).toBeDefined();
  });

  it("flag OFF: response does NOT contain V2-only fields", async () => {
    v2Enabled = false;
    const response = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest({ client_turn_id: "v1-flag-off" }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // V1 envelope fields present
    expect(body).toHaveProperty("turn_id");
    expect(body).toHaveProperty("blocks");
    expect(body).toHaveProperty("lineage");

    // V2-only fields absent
    for (const field of V2_ONLY_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
  });
});
