/**
 * `POST /proxy/v5/turn/stream` — CORS under ALLOWLIST DRIFT.
 *
 * ROADMAP 2.122 / 1.204 M1, CEE lane 2.
 *
 * ── WHY THIS FILE EXISTS: A MUTANT SURVIVED ─────────────────────────────────
 * The browser route attaches CORS headers two ways: the derived set
 * (`buildStagedSseHeaders` re-emitting whatever `@fastify/cors` staged on the
 * Reply) and its own `buildCorsHeaders(origin)`. The route's comment justifies
 * the second layer by saying the two allowlists can DIVERGE.
 *
 * The lane's mutation battery **falsified that as tested**: deleting the second
 * layer entirely (`extraResponseHeaders: {}`) left every CORS pin GREEN, because
 * the main suite configures the same origin in BOTH
 * `BROWSER_PROXY_ALLOWED_ORIGINS` and `CORS_ALLOWED_ORIGINS`. A surviving mutant
 * against a claim the code makes in prose is an untested claim — the route was
 * carrying a justification nothing checked.
 *
 * This suite is the discriminating case, and the configuration is not
 * hypothetical: `server.ts` ships an explicit **origin-drift guard** that WARNS
 * (rather than refuses) when a proxy origin is absent from the global CORS
 * allowlist, so a deployment in exactly this state is tolerated by design. On
 * such a deployment the global plugin makes NO CORS decision for the origin, the
 * derived headers therefore carry no `access-control-allow-origin`, and the
 * route's own layer is the only thing standing between the user and an invisible
 * committed turn they cannot read.
 *
 * Separate file because the config is parsed once per module graph, so the two
 * allowlists have to diverge from process start.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("RATE_LIMIT_MAX", "10000");
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_COACH_RPM", "10000");
vi.stubEnv("CEE_RATE_BUCKET_READ_RPM", "10000");
vi.stubEnv("BROWSER_PROXY_ENABLED", "true");
vi.stubEnv("ASSIST_API_KEY", "origin-drift-suite-key");

/**
 * THE DRIFT. `DRIFTED_ORIGIN` is allowed by the PROXY and unknown to the global
 * CORS plugin — the state `server.ts`'s origin-drift guard warns about.
 */
const DRIFTED_ORIGIN = "https://preview-branch.netlify.app";
const GLOBAL_CORS_ORIGIN = "http://localhost:5173";
vi.stubEnv("BROWSER_PROXY_ALLOWED_ORIGINS", `${DRIFTED_ORIGIN},${GLOBAL_CORS_ORIGIN}`);
vi.stubEnv("CORS_ALLOWED_ORIGINS", GLOBAL_CORS_ORIGIN);

vi.mock("../../src/utils/fixtures.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  const pristineGraph = structuredClone(mod.fixtureGraph);
  return {
    ...mod,
    get fixtureGraph() {
      return structuredClone(pristineGraph);
    },
  };
});

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () => createMockSessionStore({}),
    resetSessionStoreForTests: () => {},
  };
});

const { build } = await import("../../src/server.js");
const { PROXY_STREAMED_TURN_ROUTE } = await import(
  "../../src/routes/proxy-v5-turn-stream.js"
);

let n = 0;
function payloadFor() {
  n += 1;
  return {
    kind: "message",
    turn_id: `a${n.toString().padStart(7, "0")}-2222-4222-8222-222222222222`,
    scenario_id: `b${n.toString().padStart(7, "0")}-1111-4111-8111-111111111111`,
    stage: "frame",
    message: "Should we expand the product into the German market next quarter or hold?",
    turn_class: "frame",
    source: "composer",
    explicit_generate: true,
  };
}

describe("browser streamed turn — CORS survives allowlist drift", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("NEGATIVE CONTROL: the global CORS plugin makes no decision for the drifted origin", async () => {
    // This is what makes the next test discriminating rather than decorative. If
    // the global plugin DID answer for this origin, the derived headers alone
    // would carry CORS and the route's own layer would be untestable here — the
    // exact blind spot that let a mutant survive in the main suite.
    const res = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: DRIFTED_ORIGIN },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();

    // Positive control on the same probe: it DOES answer for the global origin,
    // so the assertion above is about the origin, not about a broken probe.
    const known = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: GLOBAL_CORS_ORIGIN },
    });
    expect(known.headers["access-control-allow-origin"]).toBe(GLOBAL_CORS_ORIGIN);
  }, 30_000);

  it("the streamed reply is STILL browser-readable for a proxy-allowed origin the global plugin does not know", async () => {
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "application/json", origin: DRIFTED_ORIGIN },
      payload: payloadFor(),
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/event-stream");

    // THE PIN. Without the route's own CORS layer this is undefined, the browser
    // sees an opaque CORS failure, and the turn has already committed.
    expect(
      res.headers["access-control-allow-origin"],
      "a proxy-allowed origin got a streamed reply with no CORS header — the browser cannot " +
        "read it, yet the turn has already COMMITTED",
    ).toBe(DRIFTED_ORIGIN);
    expect(String(res.headers["vary"] ?? "")).toContain("Origin");
  }, 90_000);

  it("an origin in NEITHER list is still refused 403 before the stream opens", async () => {
    const res = await app.inject({
      method: "POST",
      url: PROXY_STREAMED_TURN_ROUTE,
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      payload: payloadFor(),
    });
    // Drift tolerance must not become an open door: the PROXY allowlist is still
    // the gate.
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("event: stage");
  }, 30_000);
});
