/**
 * The scenario routes do not accept caller-asserted identity.
 *
 * ── THE LEAK, DEMONSTRATED BEFORE IT WAS FIXED ──────────────────────────────
 * Against DEPLOYED staging, positive and negative controls in one run:
 * an anonymous caller (no token) posting a scenario UUID with `user_id` set to
 * the OWNER's id received that scenario's full graph, brief and committed
 * analysis (200, canary present). The same request with a DIFFERENT id, with NO
 * id, and with a MALFORMED id all refused (404). The claimed identity string
 * was the only variable. The register route let the same caller CREATE a
 * scenario attributed to an arbitrary id.
 *
 * ── WHY THE FIX IS SCOPED TO THESE ROUTES AND NOT TO THE SHARED FUNCTION ────
 * `service_legacy` lets a key-authed internal caller act on a user's behalf,
 * justified as *"reachable by key-authed service callers only, never browser
 * paths"*. MEASURED: that is FALSE here and TRUE for the turn routes.
 *
 *   · The `/bff/cee/*` edge staples the assist key onto ANY visitor's request,
 *     and all five `/assist/v1/scenarios/*` routes answer from their live
 *     handlers through it. The handler cannot tell an internal harness from an
 *     anonymous stranger, so the premise fails.
 *   · `/bff/cee/orchestrate/v2/turn` and `/stop` answer `{"error":"Not found"}`
 *     — byte-identical to a fabricated-route control in the same run, while a
 *     scenario route answered from its live handler in that same run. Not
 *     anonymously reachable that way.
 *
 * So the shared `authorizeScenarioOwnership` is UNCHANGED and the turn routes
 * keep the carve-out. A positive control in `turn-stop-authorization.test.ts`
 * pins that service seam deliberately; scoping the fix here leaves it green
 * because nothing it guards has moved.
 *
 * ── THE PAIRS ARE THE POINT ────────────────────────────────────────────────
 * A refusal test alone would pass on a route that refuses everything, and an
 * admission test alone would pass on a route that admits everything. Each case
 * below has its opposite-direction twin, and the ONLY thing varying between
 * the first two is whether the identity was VERIFIED or merely CLAIMED.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, get config() { return mockConfig.value ?? actual.config; } };
});

/**
 * Only `resolveUserIdentity` is controlled. `importOriginal` spread, never a
 * hand-listed factory: a factory REPLACES the module and every other export in
 * the pre-flight import chain would silently vanish (CLAUDE.md trap 12).
 */
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

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

const scenarioGraphRoute = (await import("../assist.v1.scenario-graph.js")).default;

const GRAPH = {
  nodes: [{ id: "n1", label: "Take the job", category: "option" }],
  edges: [],
  options: [{ id: "n1", label: "Take the job" }],
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

async function read(app: FastifyInstance, body: Record<string, unknown> = {}) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${SCENARIO}/graph`,
    payload: body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scenarioExists.mockResolvedValue(true);
  loadGraphAndBriefText.mockResolvedValue({ graph: GRAPH, briefText: "Should I take the job?" });
  // The scenario is OWNED. That is what makes the claim worth forging.
  ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
  getScenarioOwner.mockResolvedValue(OWNER);
});

describe("an OWNED scenario is not readable on a caller's say-so", () => {
  it("REFUSES an unverified caller who claims to be the owner", async () => {
    // The exact request that returned a full graph on deployed staging.
    resolveUserIdentity.mockResolvedValue({ mode: "service_legacy" });

    const app = await buildApp();
    const res = await read(app, { user_id: OWNER });

    expect(res.statusCode).toBe(404);
    // Bound to the OUTCOME, not just the status: nothing was read.
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });

  it("ADMITS the owner when the same id is VERIFIED — the only variable that changed", async () => {
    // ⚠ THE DISCRIMINATOR. Without it, the refusal above would pass on a route
    // that refuses everything, and the fix would be indistinguishable from an
    // outage. The claimed id is gone; the verified subject is the same string.
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

    const app = await buildApp();
    const res = await read(app, {});

    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH);
    await app.close();
  });

  it("ignores a forged claim entirely — a VERIFIED owner reads even while claiming to be someone else", async () => {
    // Proves the body is not consulted in EITHER direction: it can neither
    // grant access nor withdraw it.
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

    const app = await buildApp();
    const res = await read(app, { user_id: OTHER_USER });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("REFUSES a verified caller who is not the owner", async () => {
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });

    const app = await buildApp();
    const res = await read(app, { user_id: OWNER });

    expect(res.statusCode).toBe(404);
    expect(loadGraphAndBriefText).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("every unverified mode behaves identically — no mode is a side door", () => {
  const modes = [
    { label: "service_legacy", identity: { mode: "service_legacy" } },
    { label: "off (flag down)", identity: { mode: "off" } },
  ];

  for (const { label, identity } of modes) {
    it(`${label}: claiming the owner's id is refused`, async () => {
      resolveUserIdentity.mockResolvedValue(identity);

      const app = await buildApp();
      const res = await read(app, { user_id: OWNER });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  }
});

describe("what this change does NOT do — guest access is untouched", () => {
  it("still serves an UNOWNED (guest) scenario to an anonymous caller", async () => {
    // ⚠ Deliberate. Closing this is change B, which removes guest access
    // entirely and has a far larger blast radius. If this test ever goes red
    // as a side effect of a change to THIS route, the two halves have been
    // conflated.
    ensureScenarioExists.mockResolvedValue({ user_id: null });
    getScenarioOwner.mockResolvedValue(null);
    resolveUserIdentity.mockResolvedValue({ mode: "off" });

    const app = await buildApp();
    const res = await read(app, {});

    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH);
    await app.close();
  });
});
