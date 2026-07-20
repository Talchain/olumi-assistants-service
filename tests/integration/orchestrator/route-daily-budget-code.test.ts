import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

/**
 * Pins the wire error code for the DAILY TOKEN BUDGET breach on
 * POST /orchestrate/v1/turn (src/orchestrator/route.ts).
 *
 * This is a money/spend cap, not an RPM throttle. It used to emit
 * `CEE_RATE_LIMIT`, which collided with the genuine per-feature limiter in
 * src/middleware/rate-limit.ts and made 429s unreadable on-call. It now
 * emits `CEE_COST_CAP`.
 *
 * Everything else about the response is deliberately UNCHANGED — the
 * `Retry-After` header, `retryable: true` and `details.retry_after_seconds`
 * all remain, because retry-later semantics were always correct here; only
 * the CAUSE label was wrong. Those fields are asserted below so a future
 * edit cannot quietly drop them along with the rename.
 *
 * ⚠ Reachability caveat: this catch block sits behind the V1 route's
 * `pipelineV4Enabled` guard. `CEE_PIPELINE_V4_ENABLED` is false on staging
 * (see src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts:106), so V1
 * returns 410 there and this path is dark on the live estate today. The
 * test forces the flag on to exercise the mapping directly.
 */

// Force the V1 route past its V4_DISABLED 410 guard, and keep the
// orchestrator feature on.
vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "features") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === "orchestrator") return true;
              if (featProp === "pipelineV4Enabled") return true;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        if (prop === "plot") return { baseUrl: undefined };
        return Reflect.get(target, prop);
      },
    }),
  };
});

// Make the V4 pipeline throw the budget error so the route's catch runs.
vi.mock("../../../src/orchestrator/deterministic/pipeline-v4.js", async () => {
  const { DailyBudgetExceededError } = await import(
    "../../../src/adapters/llm/errors.js"
  );
  return {
    // eslint-disable-next-line require-yield
    executePipelineV4: async function* () {
      throw new DailyBudgetExceededError(
        "daily token budget exhausted",
        1800,
        "test-req-id",
        "user-abc",
      );
    },
  };
});

const { ceeOrchestratorRouteV1 } = await import(
  "../../../src/orchestrator/route.js"
);
const { _clearIdempotencyCache } = await import(
  "../../../src/orchestrator/idempotency.js"
);
const { _resetStore: _resetRateLimitStore } = await import(
  "../../../src/middleware/rate-limit.js"
);

function makeValidRequest(clientTurnId: string) {
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
    client_turn_id: clientTurnId,
  };
}

describe("POST /orchestrate/v1/turn — daily token budget wire code", () => {
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
    _resetRateLimitStore();
  });

  it("returns CEE_COST_CAP (not CEE_RATE_LIMIT) on DailyBudgetExceededError", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest("daily-budget-turn-001"),
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);

    expect(body.code).toBe("CEE_COST_CAP");
    // The whole point of the rename: a spend cap must not be reported as a
    // requests-per-minute throttle.
    expect(body.code).not.toBe("CEE_RATE_LIMIT");
    expect(body.message).toBe("Daily token budget exceeded");
  });

  it("preserves the retry-later contract unchanged alongside the rename", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/orchestrate/v1/turn",
      payload: makeValidRequest("daily-budget-turn-002"),
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);

    expect(body.schema).toBe("cee.error.v1");
    expect(body.retryable).toBe(true);
    expect(body.source).toBe("cee");
    expect(body.details.retry_after_seconds).toBe(1800);
    expect(res.headers["retry-after"]).toBe("1800");
  });
});
