/**
 * Model Management v1 — THE WIRING SLICE (versions list / save / restore).
 *
 * The dark module's own headers (model-management/index.ts, contracts.ts)
 * anticipate exactly this slice: routes that parse ingress / validate egress
 * with the prepared strict contracts and consume the service through
 * `getModelManagementService()`. These tests pin the wiring, not the module —
 * the module's own suites (service/store-adapter/contracts) already pin its
 * behaviour.
 *
 * ── WHAT IS PINNED HERE, AND WHY EACH ONE IS LOAD-BEARING ──────────────────
 *
 *  1. A READ-SHAPED ROUTE MUST NEVER CREATE THE ROW IT READS. All three
 *     routes gate on EXISTENCE before ownership, because
 *     `authorizeScenarioOwnership` UPSERTS (the scenario-graph read route's
 *     pin 1, inherited verbatim). The upsert fence carries a positive control:
 *     the harness proves it can SEE `ensureScenarioExists` being reached
 *     (trap 13), so the absence assertion is not vacuous.
 *
 *  2. SCENARIO-SHAPED REFUSALS ANSWER ONE INDISTINGUISHABLE 404. Absent
 *     scenario and not-your-scenario are the same bytes (no existence oracle).
 *     VERSION-shaped refusals, by contrast, name their cause — the caller
 *     already holds authorised access to the scenario, so "version not found"
 *     leaks nothing about anyone else's decisions.
 *
 *  3. RESTORE NEVER READS A CLIENT GRAPH. The graph written on restore comes
 *     from the STORED version (service.getVersion), byte-projected server-side.
 *     A request body smuggling a `graph` field must not influence what is
 *     appended — identity-bound: the append receives the stored version's
 *     nodes, not the smuggled ones.
 *
 *  4. THE PRE-RESTORE SNAPSHOT GUARD. Restore overwrites the working graph, so
 *     the CURRENT graph is snapshotted (provenance `pre_restore`) BEFORE the
 *     restore RPC runs. The RPC's no-op dedupe makes this free when the head
 *     already captures the current graph. A restore that skips the snapshot
 *     when a current graph exists is the mutant this suite must kill: work not
 *     captured by any version would be unrecoverable. The snapshot's outcome is
 *     also the `undo_version_id` the response carries.
 *
 *  5. RESTORE IS ONE ATOMIC RPC. Refusals happen before any state change; graph,
 *     version/head, event, undo and invalidation either all commit or all roll
 *     back. Mutation-id replay returns the same public receipt and no new rows.
 *
 *  6. AUTHENTICATION PRECEDES BODY VALIDATION. All three routes run the shared
 *     pre-flight BEFORE parsing their route-local body, so an unauthenticated
 *     caller with an invalid body sees 401, never 422 — the principle
 *     route-v2-preflight.ts states in its own header and the register route
 *     observes. Pinned with its PRECONDITION CONTROL: the same bytes must
 *     produce 422 for an authenticated caller, or the 401 proves nothing about
 *     ordering (a body that is not actually invalid would pass the test too).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const ABSENT_SCENARIO = "11111111-2222-3333-4444-555555555555";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";
const VERSION_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VERSION_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SNAPSHOT_VERSION = "cccccccc-3333-4333-8333-cccccccccccc";
const RESTORED_VERSION = "dddddddd-4444-4444-8444-dddddddddddd";
const MUTATION_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_SNAPSHOT = "c".repeat(64);
const ANALYSIS_HASH = "d".repeat(64);

// Same hoisted-config idiom as assist.v1.scenario-graph.test.ts — spread the
// REAL config (a hand-listed stub silently drops every key added since —
// trap 12), pin only what this suite asserts about.
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

// ── Identity resolution — the seam the ORDERING pin (7) drives ──────────────
// Spread the REAL module (trap 12: a hand-listed stub silently drops every
// export added since) and control only `resolveUserIdentity`. Everything below
// it stays real: `resolveVerifiedIdentityOrRefuse` and the sign-in envelope are
// the production ones, so the 401 this suite asserts is the route's own bytes.
// Default `{ mode: "off" }` is exactly what `requireUserJwt: false` produces,
// so every other test in this file is unaffected.
// `vi.hoisted` is load-bearing: this factory DEREFERENCES the spy when it runs
// (unlike the lazy `getSessionStore: () => store` idiom below), and `vi.mock` is
// hoisted above plain `const` declarations — a bare `const` here fails the whole
// file at collect with "Cannot access before initialization" (zero tests).
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../orchestrator/user-identity.js")>();
  return { ...actual, resolveUserIdentity };
});

// ── The store double (session store) ────────────────────────────────────────
const scenarioExists = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const loadGraph = vi.fn();
const appendSpy = vi.fn();
const readRecent = vi.fn();
const readFactsFor = vi.fn();

const store = {
  scenarioExists,
  ensureScenarioExists,
  getScenarioOwner,
  loadGraph,
  append: appendSpy,
  readRecent,
  readFactsFor,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

// ── The model-management service double ─────────────────────────────────────
const listVersions = vi.fn();
const getVersion = vi.fn();
const saveVersion = vi.fn();
const restoreVersion = vi.fn();
const restoreVersionAtomic = vi.fn();
const getCurrentVersionPointer = vi.fn();

vi.mock("../../orchestrator-v5/model-management/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../orchestrator-v5/model-management/index.js")>();
  return {
    ...actual,
    getModelManagementService: () => ({
      listVersions,
      getVersion,
      saveVersion,
      restoreVersion,
      restoreVersionAtomic,
      getCurrentVersionPointer,
    }),
  };
});

import scenarioVersionsRoute from "../assist.v1.scenario-versions.js";

/** A stored version graph — distinct labels so identity-bound assertions can
 *  tell it apart from anything a client smuggles. */
const STORED_VERSION_GRAPH = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n2", label: "Commute time", kind: "factor" },
  ],
  edges: [{
    from: "n1",
    to: "n2",
    strength: { mean: 0.4, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: "positive",
  }],
};

/** The CURRENT working graph — differs from the stored version. */
const CURRENT_GRAPH = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n3", label: "Salary offer", kind: "factor" },
  ],
  edges: [{
    from: "n1",
    to: "n3",
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.8,
    effect_direction: "positive",
  }],
};

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_A,
    scenario_id: SCENARIO,
    owner_user_id: OWNER,
    version_number: 1,
    graph_identity_hash: HASH_A,
    hash_algorithm: "sha256",
    identity_projection_version: "identity.v1",
    identity_normaliser_version: "normaliser.v1",
    graph_schema_version: "graph.v1",
    label: "First cut",
    provenance: "user_save",
    restored_from_version_id: null,
    created_at: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
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
  const payload =
    path === "/versions/restore"
      ? {
          mutation_id: MUTATION_ID,
          expected_graph_identity_hash: HASH_B,
          ...body,
        }
      : body;
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${SCENARIO}${path}`,
    payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default posture: scenario exists, OWNED by OWNER, holds CURRENT_GRAPH,
  // and has two versions with A as head/current.
  resolveUserIdentity.mockResolvedValue({ mode: "off" });
  scenarioExists.mockResolvedValue(true);
  ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
  getScenarioOwner.mockResolvedValue(OWNER);
  loadGraph.mockResolvedValue(CURRENT_GRAPH);
  appendSpy.mockResolvedValue({ id: "row-1" });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  listVersions.mockResolvedValue({
    status: "ok",
    value: [summary({ id: VERSION_B, version_number: 2, graph_identity_hash: HASH_B }), summary()],
  });
  getCurrentVersionPointer.mockResolvedValue({ status: "ok", value: VERSION_B });
  getVersion.mockResolvedValue({
    status: "ok",
    value: { ...summary(), graph: STORED_VERSION_GRAPH },
  });
  saveVersion.mockResolvedValue({
    status: "ok",
    value: {
      version_id: SNAPSHOT_VERSION,
      version_number: 3,
      graph_identity_hash: HASH_SNAPSHOT,
      deduped: false,
      event_id: "evt-snap",
    },
  });
  restoreVersion.mockResolvedValue({
    status: "ok",
    value: {
      version_id: RESTORED_VERSION,
      version_number: 4,
      graph_identity_hash: HASH_A,
      deduped: false,
      event_id: "evt-restore",
      restored_from_version_id: VERSION_A,
    },
  });
  restoreVersionAtomic.mockResolvedValue({
    status: "ok",
    value: {
      mutation_id: MUTATION_ID,
      version_id: RESTORED_VERSION,
      version_number: 4,
      graph_identity_hash: HASH_A,
      analysis_affecting_hash: ANALYSIS_HASH,
      hash_algorithm: "sha256",
      identity_projection_version: "identity.v1",
      identity_normaliser_version: "1",
      graph_schema_version: "graph_v3",
      restored_from_version_id: VERSION_A,
      undo_version_id: SNAPSHOT_VERSION,
      parent_version_id: SNAPSHOT_VERSION,
      root_version_id: SNAPSHOT_VERSION,
      actor_kind: "known",
      authored_by: "owner",
      creation_kind: "restore",
      source_version_id: VERSION_A,
      source_turn_id: null,
      graph: STORED_VERSION_GRAPH,
      deduped: false,
      replayed: false,
      analysis_invalidated_at: "2026-08-24T10:05:00.000Z",
      event_id: `model_version_restored_mutation_${MUTATION_ID}`,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions — list", () => {
  it("returns the scenario's versions with the frozen envelope and current pointer", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions", { user_id: OWNER });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_versions_list.v1");
    expect(body.scenario_id).toBe(SCENARIO);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].id).toBe(VERSION_B);
    expect(body.current_version_id).toBe(VERSION_B);
    expect(typeof body.request_id).toBe("string");
    await app.close();
  });

  it("lists the ADDRESSED scenario — identity-bound to the path param", async () => {
    const app = await buildApp();
    await post(app, "/versions", { user_id: OWNER });
    expect(listVersions).toHaveBeenCalledWith(SCENARIO, undefined);
    await app.close();
  });

  it("passes a valid limit through and refuses an invalid one without a service call", async () => {
    const app = await buildApp();
    await post(app, "/versions", { user_id: OWNER, limit: 5 });
    expect(listVersions).toHaveBeenCalledWith(SCENARIO, 5);

    listVersions.mockClear();
    const res = await post(app, "/versions", { user_id: OWNER, limit: -2 });
    expect(res.statusCode).toBe(422);
    expect(listVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers the ONE indistinguishable 404 for an absent scenario, without creating it", async () => {
    scenarioExists.mockResolvedValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${ABSENT_SCENARIO}/versions`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    // THE UPSERT FENCE — the row-creating call must never be reached.
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(listVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it("positive control for the upsert fence: an EXISTING owned scenario DOES reach the upsert-bearing pre-flight", async () => {
    const app = await buildApp();
    await post(app, "/versions", { user_id: OWNER });
    expect(ensureScenarioExists).toHaveBeenCalled();
    await app.close();
  });

  it("refuses another user's scenario with the same 404 bytes as an absent one", async () => {
    const app = await buildApp();
    const resOther = await post(app, "/versions", { user_id: OTHER_USER });
    expect(resOther.statusCode).toBe(404);

    scenarioExists.mockResolvedValue(false);
    const resAbsent = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${ABSENT_SCENARIO}/versions`,
      payload: { user_id: OTHER_USER },
    });
    const a = resOther.json();
    const b = resAbsent.json();
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
    await app.close();
  });

  it("fails CLOSED (503) when the existence probe is unavailable or throws", async () => {
    scenarioExists.mockRejectedValue(new Error("db blip"));
    const app = await buildApp();
    const res = await post(app, "/versions", { user_id: OWNER });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("maps a disabled service to 503 with an honest reason, never an empty list", async () => {
    listVersions.mockResolvedValue({ status: "disabled" });
    const app = await buildApp();
    const res = await post(app, "/versions", { user_id: OWNER });
    expect(res.statusCode).toBe(503);
    expect(res.json().details.code).toBe("VERSIONS_DISABLED");
    await app.close();
  });

  it("fails CLOSED on a malformed summary row rather than emitting it", async () => {
    listVersions.mockResolvedValue({
      status: "ok",
      value: [summary({ graph_identity_hash: "not-a-hash" })],
    });
    const app = await buildApp();
    const res = await post(app, "/versions", { user_id: OWNER });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAVE (named)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions/save — named save of the SERVER's current graph", () => {
  it("versions the server's persisted graph with the user's label and provenance user_save", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/save", { user_id: OWNER, label: "Before pivot" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_version_save.v1");
    expect(body.version.version_id).toBe(SNAPSHOT_VERSION);
    expect(body.version.deduped).toBe(false);

    // Identity-bound: the graph saved is the SERVER's current graph (n3
    // "Salary offer" present), and the provenance names the user action.
    expect(saveVersion).toHaveBeenCalledTimes(1);
    const arg = saveVersion.mock.calls[0][0];
    expect(arg.scenario_id).toBe(SCENARIO);
    expect(arg.graph).toEqual(CURRENT_GRAPH);
    expect(arg.label).toBe("Before pivot");
    expect(arg.provenance).toBe("user_save");
    await app.close();
  });

  it("NEVER saves a client-supplied graph — a smuggled `graph` body field is ignored", async () => {
    const smuggled = { nodes: [{ id: "evil", label: "Fabricated", kind: "factor" }], edges: [] };
    const app = await buildApp();
    const res = await post(app, "/versions/save", { user_id: OWNER, graph: smuggled });

    expect(res.statusCode).toBe(200);
    const arg = saveVersion.mock.calls[0][0];
    expect(arg.graph).toEqual(CURRENT_GRAPH);
    expect(JSON.stringify(arg.graph)).not.toContain("Fabricated");
    await app.close();
  });

  it("maps empty_graph to 422 NOTHING_TO_SAVE", async () => {
    saveVersion.mockResolvedValue({
      status: "error",
      error: { code: "empty_graph", recoverable: true, message: "No graph content to version." },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/save", { user_id: OWNER });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("NOTHING_TO_SAVE");
    await app.close();
  });

  it("maps the guest refusal (sign_in_required) to 401 SIGN_IN_REQUIRED", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: null });
    getScenarioOwner.mockResolvedValue(null);
    saveVersion.mockResolvedValue({
      status: "error",
      error: {
        code: "sign_in_required",
        recoverable: true,
        message: "Version history requires sign-in.",
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/save", {});
    expect(res.statusCode).toBe(401);
    expect(res.json().details.code).toBe("SIGN_IN_REQUIRED");
    await app.close();
  });

  it("maps a CAS conflict to 409 VERSION_STALE", async () => {
    saveVersion.mockResolvedValue({
      status: "conflict",
      conflict: {
        kind: "graph_identity_cas_conflict",
        expected_graph_identity_hash: HASH_B,
        message: "stale",
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/save", {
      user_id: OWNER,
      expected_graph_identity_hash: HASH_B,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("VERSION_STALE");
    await app.close();
  });

  it("refuses a non-string label without a service call", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/save", { user_id: OWNER, label: 42 });
    expect(res.statusCode).toBe(422);
    expect(saveVersion).not.toHaveBeenCalled();
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions/restore — C8-A atomic restore", () => {
  it("returns the one-transaction receipt with exact graph, undo and two hashes", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_version_restore.v2");
    expect(body.restored).toBe(true);
    expect(body.receipt.mutation_id).toBe(MUTATION_ID);
    expect(body.receipt.version_id).toBe(RESTORED_VERSION);
    expect(body.receipt.undo_version_id).toBe(SNAPSHOT_VERSION);
    expect(body.receipt.full_hash).toBe(HASH_A);
    expect(body.receipt.analysis_affecting_hash).toBe(ANALYSIS_HASH);
    expect(body.receipt.sequence).toBe(4);
    expect(body.receipt.actor).toEqual({ kind: "known", authored_by: "owner" });
    expect(body.receipt.creation).toEqual({
      kind: "restore",
      source_version_id: VERSION_A,
    });
    expect(body.receipt.lineage).toEqual({
      kind: "known",
      parent_version_id: SNAPSHOT_VERSION,
      root_version_id: SNAPSHOT_VERSION,
    });
    expect(body.receipt.graph).toEqual(STORED_VERSION_GRAPH);
    expect(body).toHaveProperty("analysis_state");
    expect(Object.keys(body).sort()).toEqual([
      "analysis_state",
      "receipt",
      "request_id",
      "restored",
      "scenario_id",
      "schema",
    ]);
    await app.close();
  });

  it("makes exactly one atomic service write — no snapshot RPC and no post-version append", async () => {
    const app = await buildApp();
    await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });

    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
    expect(saveVersion).not.toHaveBeenCalled();
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    const write = restoreVersionAtomic.mock.calls[0][0];
    expect(write.scenario_id).toBe(SCENARIO);
    expect(write.version_id).toBe(VERSION_A);
    expect(write.mutation_id).toBe(MUTATION_ID);
    expect(write.current_graph).toEqual(CURRENT_GRAPH);
    expect(write.expected_graph_identity_hash).toBe(HASH_B);
    expect(write.source_graph_identity_hash).toBe(HASH_A);
    await app.close();
  });

  it("never accepts a client graph — the atomic carrier receives the stored version projection", async () => {
    const app = await buildApp();
    await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      graph: {
        nodes: [{ id: "evil", label: "Fabricated", kind: "factor" }],
        edges: [],
      },
    });

    const write = restoreVersionAtomic.mock.calls[0][0];
    const ids = (write.graph.nodes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual(["n1", "n2"]);
    expect(JSON.stringify(write.graph)).not.toContain("Fabricated");
    await app.close();
  });

  it("requires mutation identity and an explicit nullable working-state CAS", async () => {
    const app = await buildApp();
    const missingMutation = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}/versions/restore`,
      payload: {
        user_id: OWNER,
        version_id: VERSION_A,
        expected_graph_identity_hash: HASH_B,
      },
    });
    expect(missingMutation.statusCode).toBe(422);

    const missingCas = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}/versions/restore`,
      payload: {
        user_id: OWNER,
        version_id: VERSION_A,
        mutation_id: MUTATION_ID,
      },
    });
    expect(missingCas.statusCode).toBe(422);

    const nullCas = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      expected_graph_identity_hash: null,
    });
    expect(nullCas.statusCode).toBe(200);
    expect(
      restoreVersionAtomic.mock.calls.at(-1)?.[0].expected_graph_identity_hash
    ).toBeNull();
    await app.close();
  });

  it("maps the atomic working-state CAS conflict to 409 with no second write seam", async () => {
    restoreVersionAtomic.mockResolvedValue({
      status: "conflict",
      conflict: {
        kind: "graph_identity_cas_conflict",
        expected_graph_identity_hash: HASH_B,
        message: "stale",
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("VERSION_STALE");
    expect(saveVersion).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns an idempotent replay receipt without any route-level follow-up write", async () => {
    const app = await buildApp();
    const original = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(original.statusCode).toBe(200);
    const originalReceipt = original.json().receipt;

    restoreVersionAtomic.mockResolvedValue({
      status: "ok",
      value: {
        mutation_id: MUTATION_ID,
        version_id: RESTORED_VERSION,
        version_number: 4,
        graph_identity_hash: HASH_A,
        analysis_affecting_hash: ANALYSIS_HASH,
        hash_algorithm: "sha256",
        identity_projection_version: "identity.v1",
        identity_normaliser_version: "1",
        graph_schema_version: "graph_v3",
        restored_from_version_id: VERSION_A,
        undo_version_id: SNAPSHOT_VERSION,
        parent_version_id: SNAPSHOT_VERSION,
        root_version_id: SNAPSHOT_VERSION,
        actor_kind: "known",
        authored_by: "owner",
        creation_kind: "restore",
        source_version_id: VERSION_A,
        source_turn_id: null,
        graph: STORED_VERSION_GRAPH,
        deduped: false,
        replayed: true,
        analysis_invalidated_at: "2026-08-24T10:05:00.000Z",
        event_id: `model_version_restored_mutation_${MUTATION_ID}`,
      },
    });
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(200);
    const replayReceipt = res.json().receipt;
    expect("deduped" in replayReceipt).toBe(false);
    expect("replayed" in replayReceipt).toBe(false);
    expect(replayReceipt).toEqual(originalReceipt);
    expect(replayReceipt).toEqual({
      schema: "model_version_mutation_receipt.v1",
      scenario_id: SCENARIO,
      mutation_id: MUTATION_ID,
      version_id: RESTORED_VERSION,
      sequence: 4,
      graph: STORED_VERSION_GRAPH,
      full_hash: HASH_A,
      hash_algorithm: "sha256",
      identity_projection_version: "identity.v1",
      identity_normaliser_version: "1",
      graph_schema_version: "graph_v3",
      analysis_affecting_hash: ANALYSIS_HASH,
      actor: { kind: "known", authored_by: "owner" },
      creation: { kind: "restore", source_version_id: VERSION_A },
      source_turn_id: null,
      lineage: {
        kind: "known",
        parent_version_id: SNAPSHOT_VERSION,
        root_version_id: SNAPSHOT_VERSION,
      },
      undo_version_id: SNAPSHOT_VERSION,
      event_id: `model_version_restored_mutation_${MUTATION_ID}`,
    });
    expect(appendSpy).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses mutation-id reuse for another target with a typed 409", async () => {
    restoreVersionAtomic.mockResolvedValue({
      status: "error",
      error: {
        code: "mutation_id_reused",
        recoverable: false,
        message: "reused",
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("MUTATION_ID_REUSED");
    await app.close();
  });

  it("fails closed when the current graph cannot be read", async () => {
    loadGraph.mockRejectedValue(new Error("unreadable"));
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(503);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a missing/invalid version_id without any service call", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER });
    expect(res.statusCode).toBe(422);
    expect(getVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses an incompatible stored graph before the atomic write", async () => {
    getVersion.mockResolvedValue({
      status: "ok",
      value: { ...summary(), graph: { nodes: "not-an-array" } },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("VERSION_GRAPH_INCOMPATIBLE");
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 7 — ORDERING: authentication precedes body validation
// ─────────────────────────────────────────────────────────────────────────────

describe("ordering — an unauthenticated caller learns nothing about payload validity", () => {
  /** One invalid body per route, each already proven to 422 elsewhere in this
   *  suite (list `limit`, save `label`, restore `version_id`). */
  const INVALID_BODY_PER_ROUTE: ReadonlyArray<
    readonly [string, Record<string, unknown>]
  > = [
    ["/versions", { limit: -2 }],
    ["/versions/save", { label: 42 }],
    ["/versions/restore", { version_id: "not-a-uuid" }],
  ];

  it.each(INVALID_BODY_PER_ROUTE)(
    "%s — an UNAUTHENTICATED caller with an invalid body gets 401, never 422",
    async (path, body) => {
      resolveUserIdentity.mockResolvedValue({
        mode: "refused",
        reason: "invalid_token",
      });
      const app = await buildApp();
      const res = await post(app, path, body);

      expect(res.statusCode).toBe(401);
      // The refusal is about the CALLER'S TOKEN and nothing else: no scenario
      // read happened, so it carries no existence/ownership information either.
      expect(scenarioExists).not.toHaveBeenCalled();
      expect(ensureScenarioExists).not.toHaveBeenCalled();
      expect(listVersions).not.toHaveBeenCalled();
      expect(saveVersion).not.toHaveBeenCalled();
      expect(getVersion).not.toHaveBeenCalled();
      await app.close();
    }
  );

  it.each(INVALID_BODY_PER_ROUTE)(
    "%s — PRECONDITION CONTROL: those same bytes ARE invalid, and an AUTHENTICATED caller sees the 422",
    async (path, body) => {
      // Without this control the 401 above is vacuous — a body that is not
      // actually invalid would satisfy it while proving nothing about order.
      const app = await buildApp();
      const res = await post(app, path, { ...body, user_id: OWNER });

      expect(res.statusCode).toBe(422);
      await app.close();
    }
  );
});
