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

const { ceeOrchestratorRouteV1 } = await import("../../../src/orchestrator/route.js");

function makeValidRequest() {
  return {
    message: "Hello",
    stage: "frame",
    scenario_id: "00000000-0000-4000-8000-000000000001",
    client_turn_id: "11111111-1111-4111-8111-111111111111",
    context: { messages: [] },
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

  it("takes the V4 pipeline path when pipelineV4Enabled is true — asserts downstream V4 signals, not just != 410 (P1-6)", async () => {
    // Flag ON: the guard must NOT fire AND the request must actually
    // reach the V4 pipeline branch. Downstream may then fail for other
    // reasons in this minimal env (no PLoT, no LLM adapter), but the
    // outcome MUST be something the V4 pipeline produces, not the
    // guard's 410 JSON shape.
    mockPipelineV4Enabled = true;
    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest(),
    });

    // Concrete downstream signals (P1-6 tightening):
    //   1. Status code is never 410 (the guard's status).
    //   2. Response body is NOT the V4_DISABLED JSON shape — even if an
    //      unrelated downstream path happens to return 410 for some reason
    //      in the future, it MUST NOT masquerade as V4_DISABLED.
    expect(res.statusCode).not.toBe(410);
    const body = res.json();
    expect(body?.error).not.toBe("V4_DISABLED");
    expect(body?.message).not.toBe(
      "V4 orchestration is disabled. Use /orchestrate/v2/turn.",
    );
    // 3. Response must carry SOME V4-pipeline shape signal: V4 produces
    //    either a TurnResponseV1 envelope (with `turn_id`) or an error
    //    envelope with `error.code` (validation, tool-failure, etc).
    //    Both are shape-distinguishable from the 410 {error, message,
    //    retryable} tuple.
    const hasV4Envelope =
      typeof body?.turn_id === 'string' ||
      (typeof body?.error === 'object' && body?.error !== null);
    expect(hasV4Envelope).toBe(true);
  });
});
