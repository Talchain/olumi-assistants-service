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
 *  5. RESTORE IS RPC-FIRST, APPEND-SECOND, AND HONEST ABOUT THE SEAM. Every
 *     refusal (guest MV001, missing version MV404, stale-head MV409) happens
 *     BEFORE the working graph is touched. If the append then fails, the
 *     response says so (`version_recorded: true` in details) rather than
 *     claiming success or pretending nothing happened. ⚠ This header used to
 *     add "and a retried restore converges (the RPC dedupes, the append
 *     re-runs)" — CORRECTED 2026-08-17: the pre-restore snapshot moves the head
 *     back to the current graph's hash on the retry, so the RPC's head-vs-target
 *     dedupe cannot fire; a same-hash retry 409s and a refreshed one completes
 *     at +2 version rows. The route header carries the derivation.
 *
 *     THE APPEND SEAM FAILS IN TWO DISTINGUISHABLE WAYS, and the two tests that
 *     pin them are a DISCRIMINATING PAIR at one seam: a `GraphStaleWriteError`
 *     (the working graph moved under the write) is a RECOVERABLE 409
 *     `VERSION_STALE`; any other throw is a 503 `RESTORE_INCOMPLETE`. Both carry
 *     `version_recorded: true`. The 409 limb was UNCOVERED until this pack —
 *     deleting the whole `instanceof GraphStaleWriteError` branch left the
 *     27-test suite fully green (measured), i.e. the route could have silently
 *     downgraded a recoverable conflict to an outage with nothing going red.
 *
 *  6. THE APPEND IS THE SANCTIONED ATOMIC WRITER. `store.append` with a
 *     `direct_answer` / null-handler turn (the graph-registration precedent) —
 *     never `store_draft_graph`, which does not move the identity hash with
 *     the graph and would poison every later CAS compare.
 *
 *  7. AUTHENTICATION PRECEDES BODY VALIDATION. All three routes run the shared
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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_SNAPSHOT = "c".repeat(64);

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

const store = {
  scenarioExists,
  ensureScenarioExists,
  getScenarioOwner,
  loadGraph,
  append: appendSpy,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

// ── The model-management service double ─────────────────────────────────────
const listVersions = vi.fn();
const getVersion = vi.fn();
const saveVersion = vi.fn();
const restoreVersion = vi.fn();
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
      getCurrentVersionPointer,
    }),
  };
});

// The REAL error class the route discriminates on (`session/store.js` is NOT
// mocked — only `session/index.js` is), so `instanceof` binds to the same
// constructor the route imports. A locally-declared look-alike would not.
import { GraphStaleWriteError } from "../../orchestrator-v5/session/store.js";
import scenarioVersionsRoute from "../assist.v1.scenario-versions.js";

/** A stored version graph — distinct labels so identity-bound assertions can
 *  tell it apart from anything a client smuggles. */
const STORED_VERSION_GRAPH = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n2", label: "Commute time", kind: "factor" },
  ],
  edges: [{ from: "n1", to: "n2" }],
};

/** The CURRENT working graph — differs from the stored version. */
const CURRENT_GRAPH = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n3", label: "Salary offer", kind: "factor" },
  ],
  edges: [{ from: "n1", to: "n3" }],
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
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${SCENARIO}${path}`,
    payload: body,
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

describe("POST /versions/restore — the guarded restore", () => {
  it("restores: snapshot-then-RPC-then-append, and answers with the restored graph + undo id", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      expected_graph_identity_hash: HASH_B,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_version_restore.v1");
    expect(body.restored).toBe(true);
    expect(body.version.version_id).toBe(RESTORED_VERSION);
    expect(body.undo_version_id).toBe(SNAPSHOT_VERSION);
    // The restored graph rides the response for the client-side reconcile.
    const nodeIds = (body.graph.nodes as Array<{ id: string }>).map((n) => n.id);
    expect(nodeIds).toEqual(["n1", "n2"]);
    expect(body.graph_identity_hash).not.toBeNull();
    await app.close();
  });

  it("PIN 4 — snapshots the CURRENT graph (provenance pre_restore) BEFORE the restore RPC", async () => {
    const order: string[] = [];
    saveVersion.mockImplementation(async () => {
      order.push("snapshot");
      return {
        status: "ok",
        value: {
          version_id: SNAPSHOT_VERSION,
          version_number: 3,
          graph_identity_hash: HASH_SNAPSHOT,
          deduped: false,
          event_id: "evt-snap",
        },
      };
    });
    restoreVersion.mockImplementation(async () => {
      order.push("restore");
      return {
        status: "ok",
        value: {
          version_id: RESTORED_VERSION,
          version_number: 4,
          graph_identity_hash: HASH_A,
          deduped: false,
          event_id: "evt-restore",
          restored_from_version_id: VERSION_A,
        },
      };
    });
    appendSpy.mockImplementation(async () => {
      order.push("append");
      return { id: "row-1" };
    });

    const app = await buildApp();
    await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(order).toEqual(["snapshot", "restore", "append"]);
    const snapArg = saveVersion.mock.calls[0][0];
    // Identity-bound: the snapshot captures the CURRENT graph (n3 present),
    // not the target version's.
    expect(snapArg.graph).toEqual(CURRENT_GRAPH);
    expect(snapArg.provenance).toBe("pre_restore");
    await app.close();
  });

  it("threads the CAS chain: client expected hash → snapshot; snapshot hash → restore RPC", async () => {
    const app = await buildApp();
    await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      expected_graph_identity_hash: HASH_B,
    });

    expect(saveVersion.mock.calls[0][0].expected_graph_identity_hash).toBe(HASH_B);
    expect(restoreVersion.mock.calls[0][0].expected_graph_identity_hash).toBe(HASH_SNAPSHOT);
    await app.close();
  });

  it("PIN 3 — a smuggled body `graph` never reaches the append; the STORED version's graph does", async () => {
    const app = await buildApp();
    await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      graph: { nodes: [{ id: "evil", label: "Fabricated", kind: "factor" }], edges: [] },
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const write = appendSpy.mock.calls[0][0];
    const ids = (write.graph.nodes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual(["n1", "n2"]);
    expect(JSON.stringify(write.graph)).not.toContain("Fabricated");
    await app.close();
  });

  it("PIN 6 — the append is the sanctioned direct_answer / null-handler turn write", async () => {
    const app = await buildApp();
    await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    const write = appendSpy.mock.calls[0][0];
    expect(write.scenario_id).toBe(SCENARIO);
    expect(write.turn_class).toBe("direct_answer");
    expect(write.handler_id).toBeNull();
    expect(write.turn_id).toMatch(/^version_restore:/);
    expect(write.llm_calls_used).toBe(0);
    await app.close();
  });

  it("PIN 5 — every version-level refusal happens BEFORE the working graph is touched", async () => {
    getVersion.mockResolvedValue({
      status: "error",
      error: { code: "version_not_found", recoverable: true, message: "not found" },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(res.statusCode).toBe(404);
    expect(res.json().details.code).toBe("VERSION_NOT_FOUND");
    expect(appendSpy).not.toHaveBeenCalled();
    expect(restoreVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("a snapshot CAS conflict aborts the restore with 409 and touches nothing", async () => {
    saveVersion.mockResolvedValue({
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
      expected_graph_identity_hash: HASH_B,
    });
    expect(res.statusCode).toBe(409);
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("PIN 5 — an append failure AFTER the RPC answers an honest 503 naming version_recorded", async () => {
    appendSpy.mockRejectedValue(new Error("db down"));
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.details.code).toBe("RESTORE_INCOMPLETE");
    expect(body.details.version_recorded).toBe(true);
    // Half of the DISCRIMINATING PAIR: a NON-CAS throw is the 503 limb. Its
    // twin below sends a GraphStaleWriteError through the same seam and must
    // get 409 — one test alone cannot show the route discriminates.
    await app.close();
  });

  it("PIN 5 — an append CAS conflict AFTER the RPC answers 409 VERSION_STALE, version_recorded", async () => {
    // The working graph moved between the restore RPC and the append. Nothing
    // was overwritten and the version row IS recorded, so this is RECOVERABLE
    // (refresh and retry), not the outage the 503 limb reports.
    appendSpy.mockRejectedValue(
      new GraphStaleWriteError("graph_identity CAS rejected the restore append", {
        conflict_category: "analysis_affecting_conflict",
      }),
    );
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {
      user_id: OWNER,
      version_id: VERSION_A,
      expected_graph_identity_hash: HASH_B,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.details.code).toBe("VERSION_STALE");
    expect(body.details.version_recorded).toBe(true);
    // PRECONDITION, PINNED IN-TEST: the conflict really is the one AFTER the
    // RPC. Both earlier stages ran to completion, so a 409 produced by an
    // earlier CAS limb (snapshot MV409, RPC MV409) cannot masquerade as this.
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(restoreVersion).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("a deduped restore (head already IS the target) skips the append and says deduped", async () => {
    // Snapshot dedupes (current == head) and the restore RPC dedupes
    // (head == target): nothing to write.
    saveVersion.mockResolvedValue({
      status: "ok",
      value: {
        version_id: VERSION_B,
        version_number: 2,
        graph_identity_hash: HASH_B,
        deduped: true,
        event_id: null,
      },
    });
    restoreVersion.mockResolvedValue({
      status: "ok",
      value: {
        version_id: VERSION_B,
        version_number: 2,
        graph_identity_hash: HASH_B,
        deduped: true,
        event_id: null,
        restored_from_version_id: VERSION_A,
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(res.statusCode).toBe(200);
    expect(res.json().deduped).toBe(true);
    expect(appendSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails CLOSED when the current graph cannot be read — the guard cannot be skipped blind", async () => {
    loadGraph.mockRejectedValue(new Error("unreadable"));
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(res.statusCode).toBe(503);
    expect(saveVersion).not.toHaveBeenCalled();
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a missing/invalid version_id without any service call", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER });
    expect(res.statusCode).toBe(422);
    expect(getVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("a version graph that no longer parses is refused honestly, before any write", async () => {
    getVersion.mockResolvedValue({
      status: "ok",
      value: { ...summary(), graph: { nodes: "not-an-array" } },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/restore", { user_id: OWNER, version_id: VERSION_A });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("VERSION_GRAPH_INCOMPATIBLE");
    expect(saveVersion).not.toHaveBeenCalled();
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 7 — ORDERING: authentication precedes body validation
// ─────────────────────────────────────────────────────────────────────────────

describe("ordering — an unauthenticated caller learns nothing about payload validity", () => {
  /** One invalid body per route, each already proven to 422 elsewhere in this
   *  suite (list `limit`, save `label`, restore `version_id`). */
  const INVALID_BODY_PER_ROUTE: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["/versions", { limit: -2 }],
    ["/versions/save", { label: 42 }],
    ["/versions/restore", { version_id: "not-a-uuid" }],
  ];

  it.each(INVALID_BODY_PER_ROUTE)(
    "%s — an UNAUTHENTICATED caller with an invalid body gets 401, never 422",
    async (path, body) => {
      resolveUserIdentity.mockResolvedValue({ mode: "refused", reason: "invalid_token" });
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
    },
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
    },
  );
});
