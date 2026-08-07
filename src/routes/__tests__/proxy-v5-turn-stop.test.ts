/**
 * POST /proxy/v5/turn/stop — the explicit user Stop, made server-visible.
 *
 * Before this route existed there was NO cancel surface anywhere in CEE, and
 * pressing Stop only aborted the browser's own fetch — reproduced consequence
 * in PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md.
 *
 * What is pinned here is the CONTRACT THE UI'S COPY DEPENDS ON, because the
 * three terminal-notice variants are keyed on it:
 *   · 200 + already_committed:false → "cancelled before it was saved"
 *   · 200 + already_committed:true  → "had already been saved"
 *   · non-200                       → "we could not confirm"
 * A route that answered 200 for a Stop it failed to record would make the
 * middle and last states unreachable and the first one a lie, so the failure
 * path asserting a NON-200 is as load-bearing as the happy path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const DISALLOWED_ORIGIN = "https://evil.example.com";
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
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const markTurnStopped = vi.fn();
// ROADMAP 2.236 — this suite pins the UI-COPY CONTRACT (the three terminal
// notices), not authorization, so the double answers the permissive
// authorization inputs: a GUEST scenario (`user_id: null` — ownership is
// carved out by design, and it is what 100% of staging's recorded Stops run
// on) and an ADMITTED turn. Authorization is pinned by
// turn-stop-authorization.test.ts. `storeHasMethod` still removes ONLY
// `markTurnStopped`, which is the branch these tests are about.
const ensureScenarioExists = vi.fn(async () => ({ user_id: null }));
const turnFenceRowExists = vi.fn(async () => true);
let storeHasMethod = true;
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => ({
    ensureScenarioExists,
    turnFenceRowExists,
    ...(storeHasMethod ? { markTurnStopped } : {}),
  }),
}));

const { proxyV5TurnRoute } = await import("../proxy-v5-turn.js");
const { emit } = await import("../../utils/telemetry.js");

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await proxyV5TurnRoute(app);
  await app.ready();
  return app;
}

function post(app: FastifyInstance, payload: unknown, origin = STAGING_ORIGIN) {
  return app.inject({
    method: "POST",
    url: "/proxy/v5/turn/stop",
    headers: { origin, "content-type": "application/json" },
    payload: payload as object,
  });
}

beforeEach(() => {
  markTurnStopped.mockReset();
  storeHasMethod = true;
  vi.mocked(emit).mockClear();
});

describe("POST /proxy/v5/turn/stop", () => {
  it("records the stop and reports that the turn had NOT already committed", async () => {
    markTurnStopped.mockResolvedValue({ stopped: true, claimed: true, alreadyCommitted: false });
    const app = await buildApp();

    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stopped: true,
      claimed: true,
      already_committed: false,
      scenario_id: SCENARIO,
      turn_id: TURN,
    });
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      "V5TurnStopRequested",
      expect.objectContaining({ already_committed: false, claimed: true }),
    );
    await app.close();
  });

  it("reports already_committed when the turn had already been persisted", async () => {
    // Derived server-side from v5_conversation_turns — the fact that makes the
    // UI able to describe the past instead of predicting the commit.
    markTurnStopped.mockResolvedValue({ stopped: true, claimed: true, alreadyCommitted: true });
    const app = await buildApp();

    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stopped: true, already_committed: true });
    await app.close();
  });

  it("answers 502 — never a 200 — when the stop could NOT be recorded", async () => {
    markTurnStopped.mockRejectedValue(new Error("v5_mark_turn_stopped RPC failed"));
    const app = await buildApp();

    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: { code: "TURN_STOP_NOT_RECORDED", source: "cee" },
    });
    await app.close();
  });

  it("answers 502 when the store cannot record stops at all", async () => {
    storeHasMethod = false;
    const app = await buildApp();
    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it("requires both ids", async () => {
    const app = await buildApp();
    for (const payload of [{}, { scenario_id: SCENARIO }, { turn_id: TURN }, { scenario_id: "", turn_id: TURN }]) {
      const res = await post(app, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "TURN_STOP_INVALID_BODY" } });
    }
    expect(markTurnStopped).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a disallowed origin and never touches the store", async () => {
    const app = await buildApp();
    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN }, DISALLOWED_ORIGIN);
    expect(res.statusCode).toBe(403);
    expect(markTurnStopped).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the SHARED handler — the same function the /orchestrate sibling calls", async () => {
    // The two ingresses exist because the UI's endpoint ladder can resolve to
    // either rung; a second copy of the handler would be trap 12 with a
    // persistence-integrity blast radius, and the drift would be silent (a
    // divergent copy still answers 200). Pinned by the shared error codes: they
    // are the handler's, not the proxy's.
    markTurnStopped.mockRejectedValue(new Error("boom"));
    const app = await buildApp();
    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });
    expect(res.json()).toMatchObject({ error: { source: "cee" } });
    await app.close();
  });

  it("carries CORS headers so the browser can read the answer", async () => {
    // Without these the browser sees an opaque CORS error and cannot tell a
    // recorded stop from a failed one — which is precisely the state the
    // "could not confirm" copy exists for, reached by accident on every call.
    markTurnStopped.mockResolvedValue({ stopped: true, claimed: true, alreadyCommitted: false });
    const app = await buildApp();
    const res = await post(app, { scenario_id: SCENARIO, turn_id: TURN });
    expect(res.headers["access-control-allow-origin"]).toBe(STAGING_ORIGIN);
    await app.close();
  });
});
