/**
 * Stop-route hardening (ROADMAP 2.174 fix a; Codex round-2 P1).
 *
 * THE DEFECT (proven RED here at `a1fb06bd`): the public Stop route checked
 * Origin only, and `recordExplicitTurnStop` upserted a fence row for ANY
 * non-empty (scenario_id, turn_id) strings. Consequences:
 *   · random UUIDs grew `v5_turn_fence` without bound (every spray request
 *     left a permanent row — rows are never deleted by the application);
 *   · knowledge of a scenario UUID let an outsider tombstone-spray it.
 *
 * THE FIX, POC-proportionate (full auth is out of scope — the product is
 *   anonymous by design; the signed per-turn stop capability is the rowed
 *   follow-up, designed in the PR body):
 *   1. the scenario must EXIST: a Stop for an unknown scenario id is refused
 *      with a typed 404 — no fence write, no row growth. Fail-open on a
 *      FAILED existence read (a DB blip must not cost a legitimate user
 *      their Stop — the P0 protection outranks the hardening);
 *   2. the public rung is rate-limited per IP with the repo's own limiter
 *      (@fastify/rate-limit, the plugin server.ts already registers
 *      globally), via the per-route config override.
 *
 * Scenario-existence sits in the SHARED handler so both ingresses (public
 * proxy rung + service-key /orchestrate rung) refuse identically; the rate
 * limit sits on the PUBLIC rung only (the /orchestrate rung is service-key
 * gated and already behind the global 120 rpm).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const TURN = "dcfc3b50-03b0-4b74-bc56-6dd0ce1531d7";

const mockConfig = {
  proxy: {
    browserProxyEnabled: true,
    browserProxyAllowedOrigins: STAGING_ORIGIN,
    browserProxyTimeoutMs: 5_000,
  },
  auth: { assistApiKey: "test-assist-key", requireUserJwt: false },
};
vi.mock("../../config/index.js", () => ({ config: mockConfig }));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const markTurnStopped = vi.fn();
const scenarioExists = vi.fn();
let storeHasExistenceCheck = true;
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () =>
    storeHasExistenceCheck
      ? { markTurnStopped, scenarioExists }
      : { markTurnStopped },
}));

const { recordExplicitTurnStop } = await import("../turn-stop.js");
const { proxyV5TurnRoute, TURN_STOP_RATE_LIMIT_MAX } = await import(
  "../proxy-v5-turn.js"
);

beforeEach(() => {
  markTurnStopped.mockReset();
  markTurnStopped.mockResolvedValue({
    stopped: true,
    claimed: true,
    alreadyCommitted: false,
  });
  scenarioExists.mockReset();
  scenarioExists.mockResolvedValue(true);
  storeHasExistenceCheck = true;
});

// ── The shared handler: scenario existence ──────────────────────────────────

describe("recordExplicitTurnStop — the scenario must exist", () => {
  // THE PIN (RED at a1fb06bd: answered 200 and upserted a row).
  it("an UNKNOWN scenario id is refused with a typed 404 and writes NOTHING", async () => {
    scenarioExists.mockResolvedValue(false);
    const reply = await recordExplicitTurnStop(
      { scenario_id: SCENARIO, turn_id: TURN },
      "req-unknown-scenario",
    );
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({
      error: {
        code: "TURN_STOP_UNKNOWN_SCENARIO",
        source: "cee",
        request_id: "req-unknown-scenario",
      },
    });
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  // THE PIN (RED at a1fb06bd: the RPC was attempted with a non-UUID and the
  // route answered 502 — an untyped failure — while a mocked store upserted).
  it("a NON-UUID scenario id cannot exist: refused without touching the store at all", async () => {
    const reply = await recordExplicitTurnStop(
      { scenario_id: "not-a-uuid-at-all", turn_id: TURN },
      "req-non-uuid",
    );
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({
      error: { code: "TURN_STOP_UNKNOWN_SCENARIO" },
    });
    expect(scenarioExists).not.toHaveBeenCalled();
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  // THE CONTROL — the P0 protection, unweakened.
  it("an existing scenario records the Stop exactly as before", async () => {
    const reply = await recordExplicitTurnStop(
      { scenario_id: SCENARIO, turn_id: TURN },
      "req-existing",
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      stopped: true,
      claimed: true,
      already_committed: false,
    });
    expect(scenarioExists).toHaveBeenCalledWith(SCENARIO);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  // FAIL-OPEN — a broken existence read must not cost a legitimate Stop.
  it("an existence read that THROWS fails OPEN: the Stop is still recorded", async () => {
    scenarioExists.mockRejectedValue(new Error("scenarios table unreachable"));
    const reply = await recordExplicitTurnStop(
      { scenario_id: SCENARIO, turn_id: TURN },
      "req-read-blip",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  // A store double without the method (older mocks) keeps working.
  it("a store without scenarioExists skips the check (fail-open) and records", async () => {
    storeHasExistenceCheck = false;
    const reply = await recordExplicitTurnStop(
      { scenario_id: SCENARIO, turn_id: TURN },
      "req-no-method",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });
});

// ── The public rung: per-route rate limit ───────────────────────────────────

describe("POST /proxy/v5/turn/stop — rate-limited per IP", () => {
  async function buildLimitedApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    // The same plugin server.ts registers globally; the route's own config
    // override is what this suite pins. Global max is set high so any 429
    // seen below is unambiguously the ROUTE's limit.
    await app.register(rateLimit, {
      global: true,
      max: 10_000,
      timeWindow: "1 minute",
    });
    await proxyV5TurnRoute(app);
    await app.ready();
    return app;
  }

  function post(app: FastifyInstance) {
    return app.inject({
      method: "POST",
      url: "/proxy/v5/turn/stop",
      headers: { origin: STAGING_ORIGIN, "content-type": "application/json" },
      payload: { scenario_id: SCENARIO, turn_id: TURN },
    });
  }

  // THE PIN (RED at a1fb06bd: no per-route limit — request N+1 was a 200).
  it(`allows ${TURN_STOP_RATE_LIMIT_MAX} stops per window and 429s the next`, async () => {
    const app = await buildLimitedApp();
    try {
      for (let i = 0; i < TURN_STOP_RATE_LIMIT_MAX; i += 1) {
        const res = await post(app);
        expect(res.statusCode).toBe(200);
      }
      const overLimit = await post(app);
      expect(overLimit.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
