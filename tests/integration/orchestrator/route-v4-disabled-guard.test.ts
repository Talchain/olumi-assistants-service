/**
 * V5 exclusive-cee brief §3 Task 1 — V4_DISABLED guard tests.
 *
 * When `CEE_PIPELINE_V4_ENABLED=false`, both V1 route entry points must
 * refuse with a plain-JSON 410 `V4_DISABLED` response rather than falling
 * through to the legacy V2/V1 pipelines. This is the loud-migration
 * signal for clients still pointing at `/orchestrate/v1/turn` when the
 * staging rollout has moved to V5 via `/orchestrate/v2/turn`.
 *
 * Streaming-route guard coverage lives in
 * tests/unit/orchestrator/route-stream.test.ts (the V4_DISABLED block).
 * This file covers the non-streaming twin on `/orchestrate/v1/turn`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

let mockPipelineV4Enabled = false;

vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "features") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              // Orchestrator feature gate must be true so the V1 route is
              // registered at all — otherwise we'd see 404, not 410.
              if (featProp === "orchestrator") return true;
              if (featProp === "pipelineV4Enabled") return mockPipelineV4Enabled;
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

vi.mock("../../../src/middleware/rate-limit.js", () => ({
  createOrchestratorRateLimitHook: () => async () => {},
  _resetStore: vi.fn(),
}));

// P1-5 follow-up: mock the V4 executor so the "flag on" sanity test
// can assert the V4 branch actually executes (a concrete downstream
// signal), not just "status != 410". The route dynamically imports
// this module; Vitest's `vi.mock` intercepts the dynamic import for
// any specifier that resolves to the same module.
const mockExecutePipelineV4 = vi.fn();
vi.mock("../../../src/orchestrator/deterministic/pipeline-v4.js", () => ({
  executePipelineV4: mockExecutePipelineV4,
}));

const { ceeOrchestratorRouteV1 } = await import("../../../src/orchestrator/route.js");

function makeValidRequest() {
  // Shape mirrors tests/integration/orchestrator/route.test.ts:62 —
  // TurnRequestSchema is strict about context's sub-fields.
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
  };
}

describe("POST /orchestrate/v1/turn — V4_DISABLED guard (v5-exclusive-cee Task 1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV1(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 410 V4_DISABLED with non-retryable signal when pipelineV4Enabled is false", async () => {
    mockPipelineV4Enabled = false;
    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest(),
    });
    expect(res.statusCode).toBe(410);
    const body = res.json();
    expect(body).toEqual({
      error: "V4_DISABLED",
      message: "V4 orchestration is disabled. Use /orchestrate/v2/turn.",
      retryable: false,
    });
  });

  it("takes the V4 pipeline path when pipelineV4Enabled is true — asserts executePipelineV4 actually runs (P1-5 follow-up)", async () => {
    // Flag ON: the guard must NOT fire AND the V4 executor must actually
    // run. Previous assertion was shape-based (had `turn_id` or
    // `error.code`), which a non-V4 path could satisfy. With mocked
    // executePipelineV4, we assert the concrete invocation — if the
    // route ever refactored to skip the V4 branch while pipelineV4Enabled
    // is true, this test would catch it.
    mockPipelineV4Enabled = true;
    mockExecutePipelineV4.mockReset();
    // Mock returns an async generator that yields a single
    // turn_complete event — matches the shape route.ts:263-267 expects.
    mockExecutePipelineV4.mockImplementation(async function* () {
      yield {
        type: 'turn_complete' as const,
        seq: 0,
        envelope: {
          turn_id: 'test-v4-turn',
          assistant_text: 'mocked V4 response',
          blocks: [],
          lineage: { context_hash: 'h1' },
        },
      };
    });

    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest(),
    });

    // Core P1-5 assertion: V4 executor was actually invoked. This is
    // the concrete branch signal — not the shape of the response.
    expect(mockExecutePipelineV4).toHaveBeenCalledTimes(1);
    // Sanity: response is NOT the 410 V4_DISABLED envelope.
    expect(res.statusCode).not.toBe(410);
    const body = res.json();
    expect(body?.error).not.toBe("V4_DISABLED");
    // With the mocked V4 executor, the 200 envelope carries the mocked
    // turn_id — proves the route plumbed our mock through, not a
    // different pipeline.
    expect(res.statusCode).toBe(200);
    expect(body.turn_id).toBe('test-v4-turn');
  });
});
