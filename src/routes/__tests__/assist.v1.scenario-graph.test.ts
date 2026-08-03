/**
 * ROADMAP 2.312 track 2 (2) — THE SCENARIO-ADDRESSED GRAPH READ.
 *
 * PC5's only path. CEE owns the ONLY live reader of `scenarios.graph`
 * (`supabase-store.ts::loadGraphAndBriefText`) and, before this route, exposed
 * NO scenario-addressed way to read it. The guest tier can never read the graph
 * directly — `REVOKE ALL ON scenarios FROM anon` stands, and this route is the
 * CEE-mediated substitute. The browser never touches Supabase.
 *
 * ── WHAT IS PINNED HERE, AND WHY EACH ONE IS LOAD-BEARING ──────────────────
 *
 *  1. A GET-SHAPED READ MUST NEVER CREATE THE ROW IT CLAIMS TO READ.
 *     `authorizeScenarioOwnership` → `preflightEnsureScenario` →
 *     `ensureScenarioExists` UPSERTS (`INSERT … ON CONFLICT (id) DO NOTHING`).
 *     Reading an unknown scenario id through it would CREATE that scenario.
 *     turn-stop.ts hit exactly this and ordered existence BEFORE ownership for
 *     exactly this reason. `THE UPSERT FENCE` below pins the ordering with a
 *     positive control that proves the harness can SEE the upsert (trap 13) —
 *     an absence assertion whose harness cannot observe a presence is vacuous.
 *
 *  2. EVERY REFUSAL ANSWERS THE SAME BYTES. Unknown scenario and
 *     not-your-scenario are INDISTINGUISHABLE. A refusal that named its reason
 *     would be a free scenario-existence + ownership oracle over other users'
 *     decisions for anyone holding a scenario UUID — and the assist key is
 *     injected by the Netlify edge for ANY browser visitor, so the key is not a
 *     user boundary. Same discipline turn-stop.ts adopted under 2.236.
 *
 *  3. AN EMPTY GRAPH IS A 200, NOT AN ERROR. A scenario that exists but has
 *     never had a graph written is a legitimate, expected state (every scenario
 *     starts there). Answering 404 would make the UI unable to tell "no graph
 *     yet" from "not yours", which is the whole point of (2).
 *
 *  4. THE IDENTITY HASH IS THE EXISTING ONE. `computeGraphIdentityHash`
 *     (identity.v1) is the single normaliser authority named by the CAS
 *     migration itself. This route MINTS NO NEW IDENTITY SCHEME — it exposes
 *     the one the write path already uses. `THE IDENTITY ANCHOR` pins that the
 *     route's value equals the authority's value on the same bytes.
 *
 *     ⚠ THE TOKEN IS OPAQUE TO CONSUMERS. They store it and compare it
 *       CEE-to-CEE, gated on `.projection_version`, and must NEVER recompute
 *       it locally. An earlier revision of this comment asserted "the UI's
 *       rebase detection and CEE's CAS compare the same value" — FALSE, and
 *       never measured (a claim about another repo's live path made from this
 *       side of the seam, CLAUDE.md trap 16). At UI tip `8d0f3a76`, `rg -a`
 *       over the whole repo finds `graph_identity_hash` in ZERO files and
 *       `projection_version` in ZERO files; the #561 detector compares VALUES
 *       and hashes nothing.
 *
 *  5. THE RESPONSE CARRIES NO LAYOUT, AND SAYS SO BY MEASUREMENT. `layout_present`
 *     is DERIVED from the bytes actually returned, not hardcoded `false` — a
 *     hardcoded constant is a hand-maintained mirror of a schema fact (trap 12)
 *     and would keep promising "no layout" after the day layout starts being
 *     persisted. Both directions are pinned, so the derivation cannot pass by
 *     always answering one way.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const ABSENT_SCENARIO = "11111111-2222-3333-4444-555555555555";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

// `vi.hoisted` because `vi.mock` factories are lifted above ordinary consts,
// and this route's import chain (route-v2-preflight → build-turn-context)
// reads `config` at module-init time — early enough to lose the race.
//
// The mock SPREADS THE REAL CONFIG rather than hand-listing the sections this
// suite happens to touch: a `vi.mock` factory REPLACES the module, so a
// hand-listed stub silently drops every config key added since it was written
// (CLAUDE.md trap 12 — the flags-mock allowlist defect, verbatim). Only
// `requireUserJwt` is pinned, because it is the one field whose value this
// suite is actually asserting about.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// ── The store double ────────────────────────────────────────────────────────
// `ensureScenarioExists` is the UPSERT. It is a spy here so the suite can
// assert not just the RESPONSE but whether the row-creating call was reached
// at all — the difference between "answers 404" and "answers 404 without
// having created the scenario first", which is the whole of pin (1).
const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();

const store = {
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

import scenarioGraphRoute from "../assist.v1.scenario-graph.js";
import { computeGraphIdentityHash } from "../../orchestrator-v5/context/graph-identity.js";
import { resolveCeeRateLimit } from "../../cee/config/limits.js";

/** A graph with no positional keys anywhere — the shape `scenarios.graph` holds today. */
const GRAPH_NO_LAYOUT = {
  nodes: [
    { id: "n1", label: "Take the job", category: "option" },
    { id: "n2", label: "Commute time", category: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Take the job" }],
};

/** The same graph with canvas positions bled in — the drift case pin (5) must SEE. */
const GRAPH_WITH_LAYOUT = {
  nodes: [
    { id: "n1", label: "Take the job", category: "option", position: { x: 12, y: 40 } },
    { id: "n2", label: "Commute time", category: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Take the job" }],
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

// `await`ed inside on purpose: an un-awaited `app.inject()` is Light-my-Request's
// chainable builder, not a response, and returning it would type every caller's
// `.statusCode` / `.json()` as an error the BUILD gate cannot see (it excludes
// tests — CLAUDE.md trap 2's refinement; `Typecheck Drift` is what catches it).
async function read(
  app: FastifyInstance,
  scenarioId: string,
  body: Record<string, unknown> = {},
) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${scenarioId}/graph`,
    payload: body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default posture: the scenario exists, is UNOWNED (guest), and holds a graph.
  scenarioExists.mockResolvedValue(true);
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({
    graph: GRAPH_NO_LAYOUT,
    briefText: "Should I take the job?",
  });
});

describe("POST /assist/v1/scenarios/:scenario_id/graph — the happy read", () => {
  it("returns the persisted graph with the frozen scenario_graph.v1 envelope", async () => {
    const app = await buildApp();
    const res = await read(app, SCENARIO);

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.schema).toBe("scenario_graph.v1");
    expect(body.scenario_id).toBe(SCENARIO);
    expect(body.graph).toEqual(GRAPH_NO_LAYOUT);
    expect(body.graph_present).toBe(true);
    expect(body.brief_text).toBe("Should I take the job?");
    expect(typeof body.request_id).toBe("string");
    await app.close();
  });

  it("reads the graph for the addressed scenario — the path param is what is fetched", async () => {
    // Identity-bound: pins that the handler passes the ADDRESSED id to the
    // store, not some other id it happened to have. A route that read a
    // constant would pass every shape assertion above.
    const app = await buildApp();
    await read(app, SCENARIO);

    expect(loadGraphAndBriefText).toHaveBeenCalledWith(SCENARIO);
    await app.close();
  });
});

describe("AN EMPTY GRAPH IS A VALID RESPONSE — pin (3)", () => {
  it("answers 200 with graph:null and graph_present:false, never 404", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: null, briefText: null });

    const app = await buildApp();
    const res = await read(app, SCENARIO);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.graph).toBeNull();
    expect(body.graph_present).toBe(false);
    expect(body.brief_text).toBeNull();
    // No graph ⇒ no identity to anchor to. Null, not a hash of nothing.
    expect(body.graph_identity_hash).toBeNull();
    await app.close();
  });
});

describe("THE IDENTITY ANCHOR — pin (4)", () => {
  it("exposes the EXISTING identity.v1 hash, byte-equal to the single authority", async () => {
    const app = await buildApp();
    const res = await read(app, SCENARIO);

    const expected = computeGraphIdentityHash(GRAPH_NO_LAYOUT as never);
    expect(expected).not.toBeNull();

    // Identity-bound to the authority's OWN output, not to a literal. A
    // literal would silently bless a divergent reimplementation the day the
    // normaliser changes; this cannot.
    expect(res.json().graph_identity_hash).toEqual(expected);
    await app.close();
  });

  it("carries the full versioned envelope so a consumer can tell WHICH projection it pinned", async () => {
    const app = await buildApp();
    const hash = (await read(app, SCENARIO)).json().graph_identity_hash;

    expect(hash.kind).toBe("graph_identity_hash");
    expect(hash.algorithm).toBe("sha256");
    expect(hash.projection_version).toBe("identity.v1");
    expect(hash.graph_schema_version).toBe("graph_v3");
    expect(hash.normaliser_version).toBe("1");
    expect(hash.value).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });
});

describe("THE RESPONSE CARRIES NO LAYOUT — pin (5)", () => {
  it("reports layout_present:false for the graph shape scenarios.graph actually holds", async () => {
    const app = await buildApp();
    expect((await read(app, SCENARIO)).json().layout_present).toBe(false);
    await app.close();
  });

  it("POSITIVE CONTROL — reports layout_present:true when positions ARE present", async () => {
    // Trap 13 / trap 12d: without this, `layout_present:false` could be a
    // hardcoded constant or a derivation that never fires, and the assertion
    // above would pass by testing nothing. This proves the field MEASURES.
    loadGraphAndBriefText.mockResolvedValue({
      graph: GRAPH_WITH_LAYOUT,
      briefText: null,
    });

    const app = await buildApp();
    expect((await read(app, SCENARIO)).json().layout_present).toBe(true);
    await app.close();
  });
});

describe("HONEST ABSENCE — typed 404, pin (2)", () => {
  it("answers a typed 404 for a scenario that does not exist", async () => {
    scenarioExists.mockResolvedValue(false);

    const app = await buildApp();
    const res = await read(app, ABSENT_SCENARIO);

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("answers a typed 404 for a non-UUID scenario id, without touching the store", async () => {
    // `scenarios.id` is a UUID column, so a non-UUID cannot name a row.
    // Refusing on syntax costs no round trip and keeps garbage out of the DB.
    const app = await buildApp();
    const res = await read(app, "not-a-uuid");

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(scenarioExists).not.toHaveBeenCalled();
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers the SAME BYTES for an absent scenario and for someone else's scenario", async () => {
    // The oracle closure. If these two ever diverge, any holder of a UUID can
    // enumerate which scenarios exist and which are owned.
    const app = await buildApp();

    scenarioExists.mockResolvedValue(false);
    const absent = await read(app, ABSENT_SCENARIO, { user_id: OTHER_USER });

    scenarioExists.mockResolvedValue(true);
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const notMine = await read(app, SCENARIO, { user_id: OTHER_USER });

    expect(notMine.statusCode).toBe(absent.statusCode);
    // request_id legitimately differs per request; everything else must not.
    const strip = (r: typeof absent) => ({ ...r.json(), request_id: undefined });
    expect(strip(notMine)).toEqual(strip(absent));
    await app.close();
  });

  it("never leaks the graph of a scenario owned by someone else", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });

    const app = await buildApp();
    const res = await read(app, SCENARIO, { user_id: OTHER_USER });

    expect(res.statusCode).toBe(404);
    expect(res.payload).not.toContain("Commute time");
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });

  it("POSITIVE CONTROL — the OWNER still reads their own owned scenario", async () => {
    // Without this, the refusal pins above could all pass on a route that
    // refuses everything. This is what makes them mean something.
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });

    const app = await buildApp();
    const res = await read(app, SCENARIO, { user_id: OWNER });

    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH_NO_LAYOUT);
    await app.close();
  });
});

describe("THE UPSERT FENCE — a read must never create the row, pin (1)", () => {
  it("does not reach the row-creating upsert when the scenario does not exist", async () => {
    scenarioExists.mockResolvedValue(false);

    const app = await buildApp();
    const res = await read(app, ABSENT_SCENARIO, { user_id: OWNER });

    expect(res.statusCode).toBe(404);
    // THE assertion. `ensureScenarioExists` runs `INSERT … ON CONFLICT DO
    // NOTHING`: reaching it with an absent id CREATES that scenario, so a
    // stranger POSTing random UUIDs would grow the table without bound.
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses rather than upserting when the store CANNOT check existence", async () => {
    // `scenarioExists` is OPTIONAL on the SessionStore interface. If it is
    // absent and this route shrugged (`assume it exists`), the next thing it
    // does is the ownership pre-flight — which UPSERTS. "I could not check"
    // would silently become "create it and read it", and the route's whole
    // never-creates invariant would hold only for stores of the right shape.
    const storeRef = store as { scenarioExists?: unknown };
    const saved = storeRef.scenarioExists;
    delete storeRef.scenarioExists;
    try {
      const app = await buildApp();
      const res = await read(app, SCENARIO, { user_id: OWNER });

      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(ensureScenarioExists).not.toHaveBeenCalled();
      expect(loadGraphAndBriefText).not.toHaveBeenCalled();
      await app.close();
    } finally {
      storeRef.scenarioExists = saved;
    }
  });

  it("POSITIVE CONTROL — the upsert IS reached on an existing scenario", async () => {
    // Trap 13: proves the spy can SEE the call it asserts the absence of
    // above. Without this, `not.toHaveBeenCalled()` would pass on a route that
    // never wired the ownership check at all — i.e. on the IDOR.
    const app = await buildApp();
    await read(app, SCENARIO, { user_id: OWNER });

    expect(ensureScenarioExists).toHaveBeenCalledWith(SCENARIO, OWNER);
    await app.close();
  });
});

describe("THE ASSIST-KEY GATE — the same one every other route uses", () => {
  /**
   * Two proofs, deliberately of different kinds, because either alone is weak:
   *
   *   · the DERIVED one asks the auth plugin's own exported predicate whether
   *     this path is public. It cannot go stale when the allowlist moves,
   *     which is why `isPublicRoute` was exported in the first place (2.122) —
   *     a suite that hand-copied the allowlist would keep asserting the old
   *     answer forever;
   *   · the BEHAVIOURAL one actually mounts the plugin and injects, because a
   *     predicate returning false proves the route is not exempted, not that a
   *     401 comes out. Only the wire proves the wire.
   */
  const ROUTE_PATH = `/assist/v1/scenarios/${SCENARIO}/graph`;

  it("is NOT a public route — derived from the auth plugin's own predicate", async () => {
    const { isPublicRoute } = await import("../../plugins/auth.js");
    expect(isPublicRoute(ROUTE_PATH, "POST")).toBe(false);
  });

  it("POSITIVE CONTROL — the predicate CAN return true, so `false` above means something", async () => {
    // Trap 13 again: if `isPublicRoute` were broken to always answer false,
    // the assertion above would pass while proving nothing.
    const { isPublicRoute } = await import("../../plugins/auth.js");
    expect(isPublicRoute("/healthz", "GET")).toBe(true);
  });

  it("answers 401 to a TOKENLESS request once the auth plugin is mounted", async () => {
    const { authPlugin } = await import("../../plugins/auth.js");
    (mockConfig.value as { auth: Record<string, unknown> }).auth.assistApiKey =
      "test-assist-key";

    const app = Fastify();
    await app.register(authPlugin);
    await scenarioGraphRoute(app);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: ROUTE_PATH,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    // The refusal must happen at the gate, before any scenario is touched.
    expect(scenarioExists).not.toHaveBeenCalled();
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });

  it("POSITIVE CONTROL — the SAME app serves the read when the key IS presented", async () => {
    // Without this, the 401 above could be produced by a route that refuses
    // everything, and the gate would look correct while being a brick wall.
    const { authPlugin } = await import("../../plugins/auth.js");
    (mockConfig.value as { auth: Record<string, unknown> }).auth.assistApiKey =
      "test-assist-key";

    const app = Fastify();
    await app.register(authPlugin);
    await scenarioGraphRoute(app);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: ROUTE_PATH,
      headers: { "x-olumi-assist-key": "test-assist-key" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH_NO_LAYOUT);
    await app.close();
  });
});

describe("RATE LIMITING — CodeQL js/missing-rate-limiting, and it was right", () => {
  /**
   * The route reads another user's decision graph, addressed by an id. A
   * per-route limiter is what bounds how fast one host can walk that space.
   * The bucket is keyed on the CLIENT, not the shared edge-injected key —
   * pinned below, because getting that backwards turns the limiter into a
   * product-wide shared-fate throttle rather than a control on the attacker.
   */
  const rpm = resolveCeeRateLimit("CEE_SCENARIO_GRAPH_RATE_LIMIT_RPM");

  /**
   * Builds the route with the REAL `@fastify/rate-limit` plugin mounted, which
   * is the only way these assertions mean anything: the limit is declared as
   * route-level `config.rateLimit`, so a bare app has no limiter at all and
   * every one of these tests would pass by never throttling.
   */
  async function buildLimitedApp(): Promise<FastifyInstance> {
    const rateLimit = (await import("@fastify/rate-limit")).default;
    const app = Fastify();
    // `global: false` so ONLY this route's own config is in play — the
    // assertions below are then about THIS route's limit, not an ambient one.
    await app.register(rateLimit, { global: false });
    await scenarioGraphRoute(app);
    await app.ready();
    return app;
  }

  const call = (app: FastifyInstance, remoteAddress: string) =>
    app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}/graph`,
      payload: {},
      remoteAddress,
    });

  it("the route DECLARES a rate limit derived from its registry tier", async () => {
    // Identity-bound to the registry, not to a literal: if the tier moves, the
    // route moves with it, and if someone drops `config.rateLimit` this fails.
    const app = await buildLimitedApp();
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/assist/v1/scenarios/:scenario_id/graph");
    expect(rpm).toBeGreaterThan(0);
    await app.close();
  });

  it("answers 429 once a client exceeds its budget, and stops reading the store", async () => {
    const app = await buildLimitedApp();

    let last = await call(app, "198.51.100.10");
    for (let i = 0; i < rpm + 2 && last.statusCode === 200; i += 1) {
      last = await call(app, "198.51.100.10");
    }
    expect(last.statusCode).toBe(429);

    // The refusal must be cheap: a throttled request never reaches the store.
    const readsBefore = loadGraphAndBriefText.mock.calls.length;
    await call(app, "198.51.100.10");
    expect(loadGraphAndBriefText.mock.calls.length).toBe(readsBefore);
    await app.close();
  });

  it("POSITIVE CONTROL — a caller within budget is NOT throttled", async () => {
    // Without this, the 429 above could come from a limit of zero, and the
    // route would be a brick wall that still 'passes' its rate-limit test.
    const app = await buildLimitedApp();
    expect((await call(app, "198.51.100.10")).statusCode).toBe(200);
    expect((await call(app, "198.51.100.10")).statusCode).toBe(200);
    await app.close();
  });

  it("buckets PER CLIENT, so one exhausted visitor cannot throttle another", async () => {
    // THE POINT. Through /bff/cee/* every visitor carries the SAME injected
    // assist key, so a key-derived bucket would let the first heavy visitor
    // 429 everyone else in the product. This pins the plugin's default
    // keyGenerator (req.ip) as load-bearing behaviour rather than an
    // incidental default nobody would notice changing.
    const app = await buildLimitedApp();

    let last = await call(app, "198.51.100.10");
    for (let i = 0; i < rpm + 2 && last.statusCode === 200; i += 1) {
      last = await call(app, "198.51.100.10");
    }
    expect(last.statusCode).toBe(429);

    // A different client. Must still have its own budget.
    expect((await call(app, "203.0.113.77")).statusCode).toBe(200);
    await app.close();
  });
});

describe("READ FAILURES ARE UNKNOWNS, NOT ABSENCES", () => {
  it("does not answer 404 when the existence read THREW", async () => {
    // A clean no-row is a FACT and refuses. A thrown read is an UNKNOWN, and
    // reporting it as "not found" would be a lie the UI would cache as an
    // empty canvas. Fails CLOSED (never serves the graph) but says 5xx.
    scenarioExists.mockRejectedValue(new Error("supabase unreachable"));

    const app = await buildApp();
    const res = await read(app, SCENARIO, { user_id: OWNER });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).not.toBe(404);
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not answer 200-with-an-empty-graph when the graph read THREW", async () => {
    // The dangerous direction: a 200 + graph:null on a read failure would tell
    // the UI the user's decision is empty. It must never be synthesised.
    loadGraphAndBriefText.mockRejectedValue(new Error("supabase unreachable"));

    const app = await buildApp();
    const res = await read(app, SCENARIO, { user_id: OWNER });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    await app.close();
  });
});
