/**
 * `POST /proxy/v5/turn/stream` — BROWSER INGRESS: guest admission and the
 * client-asserted identity strip.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The streamed proxy carried a copy of the buffered proxy's required-login
 * front door, and — measured at `219490ec`, with a contrast control — it had
 * NO test anywhere that exercised it: sweeping the whole suite for
 * `requireUserJwt` / `sign_in_required` returned 13 hits in the buffered
 * proxy's spec and ZERO in any streamed-proxy spec. A gate with no coverage is
 * a gate nobody can safely change, which is precisely the situation this lane
 * found itself in.
 *
 * The existing streamed suite (`tests/integration/proxy-v5-turn-stream.test.ts`)
 * builds the whole server and runs real turns, so it is the wrong instrument
 * for an ingress predicate: it cannot vary the flag, and a 90-second turn is a
 * poor way to observe one `if`. This suite mocks the shared transport and looks
 * at exactly what the route decides and what it forwards.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *   1. A JWT-less browser turn is ADMITTED (the front door is gone).
 *   2. The caller-asserted `user_id` NEVER reaches the internal turn, so an
 *      anonymous caller cannot act as anyone — the property that makes (1)
 *      safe. In every mode except `verified`, `authorizeScenarioOwnership`
 *      takes the body `user_id` AS the identity, so without the strip (1)
 *      would mean "anyone may send a turn as anyone".
 *   3. The `Authorization` header still crosses intact, so a signed-in caller
 *      is still verified downstream.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const TEST_ASSIST_KEY = "test-assist-key-stream";
const VICTIM_USER_ID = "3f7c1a92-5d84-4b0e-9c31-2a6f8e5d1b47";

const mockConfig = {
  proxy: {
    browserProxyEnabled: true,
    browserProxyAllowedOrigins: STAGING_ORIGIN,
    browserProxyTimeoutMs: 5_000,
  },
  auth: {
    assistApiKey: TEST_ASSIST_KEY,
    requireUserJwt: false,
  },
};
vi.mock("../../config/index.js", () => ({ config: mockConfig }));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

/**
 * The shared SSE transport is mocked to a plain 200 so this suite observes the
 * INGRESS decision and the forwarded payload, and nothing else. Everything
 * downstream of here is pinned by `streamed-turn-sse.test.ts`.
 */
const streamCalls: Array<{ payload: string; internalHeaders: Record<string, string> }> = [];
vi.mock("../streamed-turn-sse.js", () => ({
  STAGED_FRAME_CLASSES: {},
  streamTurnAsStagedSse: vi.fn(
    async ({
      reply,
      payload,
      internalHeaders,
    }: {
      reply: { code: (n: number) => { send: (b: unknown) => unknown } };
      payload: string;
      internalHeaders: Record<string, string>;
    }) => {
      streamCalls.push({ payload, internalHeaders });
      reply.code(200).send({ streamed: true });
    },
  ),
}));

const { default: proxyV5TurnStreamRoute, PROXY_STREAMED_TURN_ROUTE } = await import(
  "../proxy-v5-turn-stream.js"
);

const SAMPLE_PAYLOAD = {
  kind: "message",
  turn_id: "turn-stream-001",
  scenario_id: "scen-stream-001",
  message: "Should I hire a tech lead or two developers?",
  stage: "frame",
  turn_class: "frame",
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await proxyV5TurnStreamRoute(app);
  await app.ready();
  return app;
}

function post(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: PROXY_STREAMED_TURN_ROUTE,
    headers: { origin: STAGING_ORIGIN, "content-type": "application/json", ...headers },
    payload: payload as object,
  });
}

/** The body the internal turn route would actually receive. */
function forwardedBody(): Record<string, unknown> {
  expect(streamCalls, "the route never reached the transport").toHaveLength(1);
  return JSON.parse(streamCalls[0].payload) as Record<string, unknown>;
}

beforeEach(() => {
  streamCalls.length = 0;
  mockConfig.auth.requireUserJwt = false;
});

describe("POST /proxy/v5/turn/stream — guest admission", () => {
  it("GUEST (acceptance 1): flag ON, NO Authorization — the turn is ADMITTED, not refused", async () => {
    mockConfig.auth.requireUserJwt = true;
    const app = await buildApp();
    try {
      const res = await post(app, SAMPLE_PAYLOAD);
      expect(res.statusCode).toBe(200);
      // Reaching the transport is the decisive fact: the old front door
      // returned 401 without ever getting here.
      expect(streamCalls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("flag OFF: unchanged — a JWT-less turn is admitted exactly as before (dormancy pin)", async () => {
    const app = await buildApp();
    try {
      const res = await post(app, SAMPLE_PAYLOAD);
      expect(res.statusCode).toBe(200);
      expect(streamCalls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("an origin outside the allowlist is still refused 403 — admission is not a free-for-all", async () => {
    // The negative control for the two tests above: they must not be passing
    // because ingress stopped refusing ANYTHING.
    mockConfig.auth.requireUserJwt = true;
    const app = await buildApp();
    try {
      const res = await post(app, SAMPLE_PAYLOAD, { origin: "https://evil.example.com" });
      expect(res.statusCode).toBe(403);
      expect(streamCalls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("POST /proxy/v5/turn/stream — client-asserted identity is stripped", () => {
  it("ATTACK (acceptance 3): an anonymous caller's body user_id NEVER reaches the internal turn", async () => {
    mockConfig.auth.requireUserJwt = true;
    const app = await buildApp();
    try {
      const res = await post(app, { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID });
      expect(res.statusCode).toBe(200);
      // Bound by the IDENTITY of the field: absent means
      // `parseRequestExtensions` yields userId === null, so the caller is
      // anonymous to `preflightEnsureScenario` — refused on any owned scenario
      // (preflight-ensure-scenario-ownership.test.ts:117), admitted only on an
      // unowned one (:75).
      expect(forwardedBody()).not.toHaveProperty("user_id");
    } finally {
      await app.close();
    }
  });

  it("the strip removes ONLY the identity field — every other turn field survives", async () => {
    const app = await buildApp();
    try {
      await post(app, { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID });
      expect(forwardedBody()).toEqual(SAMPLE_PAYLOAD);
    } finally {
      await app.close();
    }
  });

  it("a SIGNED-IN caller keeps their Authorization header while losing the body claim", async () => {
    mockConfig.auth.requireUserJwt = true;
    const jwt = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged-test-signature";
    const app = await buildApp();
    try {
      await post(app, { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID }, { authorization: jwt });
      expect(forwardedBody()).not.toHaveProperty("user_id");
      // Acceptance 2's proxy half — the credential must still cross, or the
      // downstream verifier has nothing to verify.
      expect(streamCalls[0].internalHeaders["authorization"]).toBe(jwt);
    } finally {
      await app.close();
    }
  });
});
