/**
 * V1 tombstone FAIL-SAFE-BY-DEFAULT guard test.
 *
 * The `/orchestrate/v1/turn` route is a tombstone: the live product path is
 * `/orchestrate/v2/turn` (V5). The 410 V4_DISABLED guard
 * (src/orchestrator/route.ts:~102) must fire whenever `CEE_PIPELINE_V4_ENABLED`
 * is NOT explicitly set — i.e. it must rest on the CODE DEFAULT, not on an
 * out-of-band Render dashboard env var. A fresh deploy or a wiped env var must
 * NOT silently resurrect the tombstoned V1/V4 pipeline.
 *
 * This differs from route-v4-disabled-guard.test.ts, which mocks
 * `pipelineV4Enabled` to an explicit `false`. Here we deliberately do NOT
 * override `pipelineV4Enabled` — it falls through to the REAL config value,
 * which (with `CEE_PIPELINE_V4_ENABLED` unset in the test env — see
 * vitest.setup.ts) resolves to the schema default. The test therefore pins the
 * schema default itself: absent env var → 410. It is RED while the default is
 * `true` (the pre-fix defect: absent env → V4 resurrected) and GREEN once the
 * default is the fail-safe `false`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock config: only force `orchestrator` true so the V1 route registers at all
// (otherwise the route is never mounted and we'd see 404, not the 410 we are
// asserting). CRITICALLY, we do NOT override `pipelineV4Enabled` — it falls
// through to the real config value so this test pins the schema default.
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
              // pipelineV4Enabled intentionally NOT overridden — real default.
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

// Mock the V4 executor so that IF the guard fails to fire (pre-fix / default
// true), the route returns a clean 200 rather than exercising the real
// pipeline (LLM/PLoT). This keeps the RED state a crisp `410 !== 200`
// assertion instead of a hang or unrelated error.
const mockExecutePipelineV4 = vi.fn(async function* () {
  yield {
    type: "turn_complete" as const,
    seq: 0,
    envelope: {
      turn_id: "should-not-be-reached",
      assistant_text: "resurrected V4 response",
      blocks: [],
      lineage: { context_hash: "h1" },
    },
  };
});
vi.mock("../../../src/orchestrator/deterministic/pipeline-v4.js", () => ({
  executePipelineV4: mockExecutePipelineV4,
}));

const { ceeOrchestratorRouteV1 } = await import("../../../src/orchestrator/route.js");

function makeValidRequest() {
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

describe("POST /orchestrate/v1/turn — fail-safe tombstone by CODE DEFAULT", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV1(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("410s V4_DISABLED when CEE_PIPELINE_V4_ENABLED is UNSET (relies on the code default, not an env var)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest(),
    });

    // The tombstone must hold on the schema default alone. If this fails with
    // 200, the default re-enables the dead V1/V4 pipeline when the env var is
    // absent — the exact "fresh deploy / wiped dashboard var resurrects a dead
    // route" defect this test guards against.
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({
      error: "V4_DISABLED",
      message: "V4 orchestration is disabled. Use /orchestrate/v2/turn.",
      retryable: false,
    });
    // The V4 executor must never run when the tombstone is in effect.
    expect(mockExecutePipelineV4).not.toHaveBeenCalled();
  });
});
