/**
 * Ownership on the scenario routes is derived from the verified token subject.
 *
 * ── WHAT THESE PIN ─────────────────────────────────────────────────────────
 * On these surfaces the effective user is the verified token subject or
 * nothing: an identifier carried in the request body is not an input to the
 * ownership decision, in either direction. It can neither grant access nor
 * withdraw it.
 *
 * ── WHY THE CHANGE IS AT THE CALL SITES, NOT IN THE SHARED FUNCTION ────────
 * `authorizeScenarioOwnership` is shared with the turn and Stop routes, where
 * a key-authed service caller acting on a user's behalf is the documented and
 * intended behaviour, and where a positive control in
 * `turn-stop-authorization.test.ts` pins that seam deliberately. Changing the
 * shared function would move behaviour there too; scoping it here leaves that
 * control green because nothing it guards has moved.
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
const VERSION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MUTATION_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

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
/** The WRITE route's first read after the ownership gate — see the register pairs. */
const loadGraph = vi.fn();
const append = vi.fn();
const store = {
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  loadGraph,
  append,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

// ── The model-management service double — the versions family's first reads
// AFTER its ownership gate. Same `importOriginal` spread rule as above.
const listVersions = vi.fn();
const getCurrentVersionPointer = vi.fn();
const saveVersion = vi.fn();
const getVersion = vi.fn();
const restoreVersion = vi.fn();
vi.mock("../../orchestrator-v5/model-management/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../orchestrator-v5/model-management/index.js")>();
  return {
    ...actual,
    getModelManagementService: () => ({
      listVersions,
      getCurrentVersionPointer,
      saveVersion,
      getVersion,
      restoreVersion,
    }),
  };
});

const scenarioGraphRoute = (await import("../assist.v1.scenario-graph.js")).default;
const scenarioRegisterRoute = (await import("../assist.v1.scenario-graph-register.js")).default;
const scenarioVersionsRoute = (await import("../assist.v1.scenario-versions.js")).default;

const GRAPH = {
  nodes: [{ id: "n1", label: "Take the job", category: "option" }],
  edges: [],
  options: [{ id: "n1", label: "Take the job" }],
};

/**
 * The WRITE route parses against the graph contract BEFORE the ownership gate,
 * and that contract requires each node to declare a `kind`. Derived from the
 * route's own refusal (`GRAPH_NODE_KIND_MISSING`) rather than assumed — a
 * fixture that cannot reach the gate would make every register case below pass
 * for the wrong reason.
 */
const REGISTERABLE_GRAPH = {
  nodes: [{ id: "n1", label: "Take the job", kind: "option", category: "option" }],
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
  // The scenario has a stored owner. That is what makes the pairs below
  // discriminating: an unowned scenario would admit everyone.
  ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
  getScenarioOwner.mockResolvedValue(OWNER);
  loadGraph.mockResolvedValue(GRAPH);
  append.mockResolvedValue({ ok: true });
  // Versions-family defaults. Shapes are plausible so an ADMITTED caller runs
  // past the gate into real handler code rather than dying on a malformed
  // result — the refusal cases bind to "was this reached", not to a status.
  listVersions.mockResolvedValue({ status: "ok", value: [] });
  getCurrentVersionPointer.mockResolvedValue({ status: "ok", value: null });
  saveVersion.mockResolvedValue({
    status: "ok",
    value: { id: VERSION_ID, version_number: 1, graph_identity_hash: "a".repeat(64) },
  });
  getVersion.mockResolvedValue({ status: "ok", value: { id: VERSION_ID, graph: GRAPH } });
  restoreVersion.mockResolvedValue({ status: "ok", value: { id: VERSION_ID } });
});

describe("an OWNED scenario is not readable on a caller's say-so", () => {
  it("REFUSES an unverified caller who claims to be the owner", async () => {
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

  it("the body is not consulted in either direction — a VERIFIED owner reads even while the body names someone else", async () => {
    // The body can neither grant access nor withdraw it.
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
    it(`${label}: a request-supplied owner identifier is not honoured`, async () => {
      resolveUserIdentity.mockResolvedValue(identity);

      const app = await buildApp();
      const res = await read(app, { user_id: OWNER });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  }
});

/**
 * THE WRITE ROUTE. Its own pair, on its own route.
 *
 * Bound to the OUTCOME rather than to a status code: `loadGraph` is the first
 * server read AFTER the ownership gate, so "was it called" answers "did this
 * caller get past the gate" without depending on how a refusal is shaped.
 *
 * These also make the mutant pair DISCRIMINATING PER ROUTE: reverting the read
 * route's call site must leave these GREEN, and reverting this route's call
 * site must leave the read route's GREEN. A single biting mutant would only
 * show the suite is sensitive to something.
 */
describe("registering a model is not authorised on a caller's say-so", () => {
  async function buildRegisterApp(): Promise<FastifyInstance> {
    const app = Fastify();
    await scenarioRegisterRoute(app);
    await app.ready();
    return app;
  }

  async function register(app: FastifyInstance, body: Record<string, unknown> = {}) {
    return await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
      payload: { graph: REGISTERABLE_GRAPH, ...body },
    });
  }

  it("REFUSES an unverified caller who supplies the owner's identifier", async () => {
    resolveUserIdentity.mockResolvedValue({ mode: "service_legacy" });

    const app = await buildRegisterApp();
    await register(app, { user_id: OWNER });

    // Nothing was written, and nothing was even read to write against.
    expect(loadGraph).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("ADMITS the VERIFIED owner past the gate — the only variable that changed", async () => {
    // ⚠ THE DISCRIMINATOR. Without it the refusal above would pass on a route
    // that refuses everything — including one broken by this change.
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

    const app = await buildRegisterApp();
    await register(app, {});

    expect(loadGraph).toHaveBeenCalled();
    await app.close();
  });

  it("REFUSES a verified caller who is not the owner", async () => {
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });

    const app = await buildRegisterApp();
    await register(app, { user_id: OWNER });

    expect(loadGraph).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * THE THIRD MEMBER OF THE FAMILY — versions list / save / restore.
 *
 * All three endpoints share ONE `preflight` helper, so one call site governs
 * them all; they are exercised separately anyway because two of them are
 * WRITES (`/versions/save`, `/versions/restore`) and a gate that admits a
 * write on a caller's say-so is not the same finding as one that admits a read.
 *
 * Bound to the OUTCOME rather than to a status code — each endpoint's first
 * service read AFTER the ownership gate answers "did this caller get past the
 * gate" without depending on how a refusal is shaped:
 *   list → listVersions · save → saveVersion · restore → getVersion
 *
 * These also extend the DISCRIMINATING MUTANT PAIR to three routes: reverting
 * this route's call site must leave the read and register cases GREEN, and
 * reverting either of theirs must leave these GREEN.
 */
describe("scenario version history is not reachable on a caller's say-so", () => {
  async function buildVersionsApp(): Promise<FastifyInstance> {
    const app = Fastify();
    await scenarioVersionsRoute(app);
    await app.ready();
    return app;
  }

  async function post(
    app: FastifyInstance,
    path: string,
    body: Record<string, unknown> = {},
  ) {
    return await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}${path}`,
      payload: body,
    });
  }

  describe("list (read tier)", () => {
    it("REFUSES an unverified caller who supplies the owner's identifier", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "service_legacy" });

      const app = await buildVersionsApp();
      const res = await post(app, "/versions", { user_id: OWNER });

      expect(res.statusCode).toBe(404);
      expect(listVersions).not.toHaveBeenCalled();
      await app.close();
    });

    it("ADMITS the owner when the same id is VERIFIED — the only variable that changed", async () => {
      // ⚠ THE DISCRIMINATOR. Without it the refusal above would pass on a
      // route that refuses everything, and the fix would be indistinguishable
      // from an outage.
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

      const app = await buildVersionsApp();
      const res = await post(app, "/versions", {});

      expect(res.statusCode).toBe(200);
      expect(listVersions).toHaveBeenCalled();
      await app.close();
    });

    it("REFUSES a verified caller who is not the owner", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });

      const app = await buildVersionsApp();
      const res = await post(app, "/versions", { user_id: OWNER });

      expect(res.statusCode).toBe(404);
      expect(listVersions).not.toHaveBeenCalled();
      await app.close();
    });

    it("the body is not consulted in either direction — and the VERIFIED subject is what threads to the store", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

      const app = await buildVersionsApp();
      const res = await post(app, "/versions", { user_id: OTHER_USER });

      // ⭐ THE VERIFIED-MODE EXECUTION PROOF, and it is identity-bound rather
      // than a status code: the ownership oracle is consulted with the TOKEN
      // subject while the body names someone else. A mock that silently failed
      // to bind would leave `resolveUserIdentity` uncalled and the real
      // resolver in the chain, so both assertions below would fail — which is
      // what makes this a precondition pin and not a tautology.
      expect(resolveUserIdentity).toHaveBeenCalled();
      expect(ensureScenarioExists).toHaveBeenCalledWith(SCENARIO, OWNER);
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("save (write tier)", () => {
    it("REFUSES an unverified caller who supplies the owner's identifier — nothing is written", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "service_legacy" });

      const app = await buildVersionsApp();
      await post(app, "/versions/save", { user_id: OWNER, label: "Before pivot" });

      expect(saveVersion).not.toHaveBeenCalled();
      await app.close();
    });

    it("ADMITS the VERIFIED owner past the gate — the only variable that changed", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

      const app = await buildVersionsApp();
      await post(app, "/versions/save", { label: "Before pivot" });

      expect(saveVersion).toHaveBeenCalled();
      await app.close();
    });

    it("REFUSES a verified caller who is not the owner", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });

      const app = await buildVersionsApp();
      await post(app, "/versions/save", { user_id: OWNER, label: "Before pivot" });

      expect(saveVersion).not.toHaveBeenCalled();
      await app.close();
    });
  });

  /**
   * ⚠ THE RESTORE BODY MUST STAY VALID, OR THE REFUSAL CASES GO VACUOUS.
   * `mutation_id` and `expected_graph_identity_hash` are required by
   * `RestoreBodySchema` — derived from the route's own refusal, not assumed.
   * An invalid body 422s BEFORE the ownership step, so "getVersion was not
   * called" would then hold for the wrong reason. The ADMISSION twin is what
   * pins this: it fails loudly if the fixture can no longer reach the gate,
   * and it did exactly that when `/compare` landed and the schema moved.
   */
  describe("restore (write tier)", () => {
    it("REFUSES an unverified caller who supplies the owner's identifier — the target is never even read", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "service_legacy" });

      const app = await buildVersionsApp();
      await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_ID, mutation_id: MUTATION_ID, expected_graph_identity_hash: null });

      expect(getVersion).not.toHaveBeenCalled();
      expect(restoreVersion).not.toHaveBeenCalled();
      await app.close();
    });

    it("ADMITS the VERIFIED owner past the gate — the only variable that changed", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });

      const app = await buildVersionsApp();
      await post(app, "/versions/restore", { version_id: VERSION_ID, mutation_id: MUTATION_ID, expected_graph_identity_hash: null });

      expect(getVersion).toHaveBeenCalled();
      await app.close();
    });

    it("REFUSES a verified caller who is not the owner", async () => {
      resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });

      const app = await buildVersionsApp();
      await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_ID, mutation_id: MUTATION_ID, expected_graph_identity_hash: null });

      expect(getVersion).not.toHaveBeenCalled();
      expect(restoreVersion).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("every unverified mode behaves identically — no mode is a side door", () => {
    const modes = [
      { label: "service_legacy", identity: { mode: "service_legacy" } },
      { label: "off (flag down)", identity: { mode: "off" } },
    ];

    for (const { label, identity } of modes) {
      it(`${label}: a request-supplied owner identifier is not honoured on a WRITE`, async () => {
        resolveUserIdentity.mockResolvedValue(identity);

        const app = await buildVersionsApp();
        await post(app, "/versions/save", { user_id: OWNER, label: "Before pivot" });

        expect(saveVersion).not.toHaveBeenCalled();
        await app.close();
      });
    }
  });

  it("guest (unowned) access is untouched here too — an anonymous caller still lists", async () => {
    // ⚠ Deliberate, and the same carve-out the read route pins. If this goes
    // red as a side effect of a change to THIS route, the two halves have been
    // conflated.
    ensureScenarioExists.mockResolvedValue({ user_id: null });
    getScenarioOwner.mockResolvedValue(null);
    resolveUserIdentity.mockResolvedValue({ mode: "off" });

    const app = await buildVersionsApp();
    const res = await post(app, "/versions", {});

    expect(res.statusCode).toBe(200);
    expect(listVersions).toHaveBeenCalled();
    await app.close();
  });
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
