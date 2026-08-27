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

// `warn` is HOISTED so the return-leg tests can assert the DISCLOSURE, not just
// the status code: "admitted knowingly" is the whole of the widening, and an
// unlogged admission is a silent one.
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// ── Identity resolution — the seam the ORDERING pin (7) drives ──────────────
// Spread the REAL module (trap 12: a hand-listed stub silently drops every
// export added since) and control only `resolveUserIdentity`. Everything below
// it stays real: `resolveVerifiedIdentityOrRefuse` and the sign-in envelope are
// the production ones, so the 401 this suite asserts is the route's own bytes.
// ⚠ THE DEFAULT IDENTITY IS NOW A VERIFIED SUBJECT, AND THAT IS THE POINT.
// It used to be `{ mode: "off" }`, with every case establishing ownership by
// putting `user_id` in the request body. That is no longer an ownership input
// on these routes (see the route header), so 100% of this suite ran in the mode
// the cutover abolishes — it could not have observed the ownership step either
// way. Only the CARRIER of identity changed here: every assertion is preserved,
// and the cross-tenant case below now varies the TOKEN subject rather than a
// body field. `requireUserJwt: false` above is left as-is: `resolveUserIdentity`
// is mocked, so the flag no longer decides what this suite exercises.
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
// The HEAD record reader — the restore path's return-leg input. Distinct from
// `getCurrentVersionPointer`, which ships the id only; this one ships the whole
// record because the return-leg binding needs its provenance, undo pointer and
// identity envelope.
const getCurrentVersion = vi.fn();
const compareVersions = vi.fn();

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
      getCurrentVersion,
      compareVersions,
    }),
  };
});

import scenarioVersionsRoute from "../assist.v1.scenario-versions.js";
// The REAL identity authority — the return-leg fixtures build the head's
// envelope with the same function the route compares against, so the fixture
// cannot drift away from the production hash. Not mocked anywhere in this file.
import { computeGraphIdentityHash } from "../../orchestrator-v5/context/graph-identity.js";

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
    analysis_affecting_hash: ANALYSIS_HASH,
    mutation_id: null,
    parent_version_id: null,
    root_version_id: null,
    actor_kind: null,
    authored_by: null,
    creation_kind: null,
    source_version_id: null,
    source_turn_id: null,
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
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
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
  // DEFAULT: no head record. `isReturnLegRestore` returns false, so every test
  // that does not deliberately construct a return leg exercises the unchanged
  // fail-closed path.
  getCurrentVersion.mockResolvedValue({ status: "ok", value: null });
  compareVersions.mockResolvedValue({
    status: "ok",
    value: {
      relation: "different",
      short_circuit: false,
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
      from_full_hash: HASH_A,
      to_full_hash: HASH_B,
      analysis_equivalent: false,
      categories: {
        structure: [{
          path: "/nodes/n2",
          change_kind: "added",
          entity_kind: "node",
          entity_id: "n2",
          label: "Revenue",
          before_display: null,
          after_display: "{\"id\":\"n2\"}",
          summary: "Added Revenue",
          why_it_matters: "Changes what the shared reasoning model contains.",
        }],
        relationships: [],
        values_uncertainty: [],
        evidence_provenance: [],
        goals_constraints_options: [],
        assumptions_claims: [],
        presentation: [],
        other_model_fields: [],
      },
      coverage: {
        known_undetectable: ["conversation_or_discussion_not_committed_to_the_shared_graph"],
        known_uninterpreted_paths: [],
      },
      diff: {
        nodes_added: 1,
        nodes_removed: 0,
        nodes_changed: 0,
        edges_added: 0,
        edges_removed: 0,
        edges_changed: 0,
      },
    },
  });
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
  restoreVersionAtomic.mockResolvedValue(atomicRestoreOk());
});

/**
 * A well-formed atomic-restore receipt. Extracted so the return-leg tests,
 * which DO reach the RPC, cannot stub it with a shape the route's egress
 * validation rejects — a `{}` there produces a 500 that looks exactly like a
 * refusal and would have hidden the admission it was meant to prove.
 */
function atomicRestoreOk() {
  return {
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions — list", () => {
  it("returns the scenario's versions with the frozen envelope and current pointer", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions", {});

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_versions_list.v2");
    expect(body.scenario_id).toBe(SCENARIO);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version_id).toBe(VERSION_B);
    expect(body.versions[0].actor).toEqual({ kind: "unknown" });
    expect(body.versions[0].analysis_affecting_hash).toBe(ANALYSIS_HASH);
    expect(body.versions[0]).not.toHaveProperty("graph");
    expect(body.current_version_id).toBe(VERSION_B);
    expect(body.next_cursor).toBeNull();
    expect(typeof body.request_id).toBe("string");
    await app.close();
  });

  it("lists the ADDRESSED scenario — identity-bound to the path param", async () => {
    const app = await buildApp();
    await post(app, "/versions", {});
    expect(listVersions).toHaveBeenCalledWith(SCENARIO, 51, undefined);
    await app.close();
  });

  it("passes a valid limit through and refuses an invalid one without a service call", async () => {
    const app = await buildApp();
    await post(app, "/versions", { limit: 5 });
    expect(listVersions).toHaveBeenCalledWith(SCENARIO, 6, undefined);

    listVersions.mockClear();
    const res = await post(app, "/versions", { limit: -2 });
    expect(res.statusCode).toBe(422);
    expect(listVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns an opaque exclusive cursor and keeps the authoritative head on later pages", async () => {
    listVersions.mockResolvedValueOnce({
      status: "ok",
      value: [
        summary({ id: SNAPSHOT_VERSION, version_number: 3 }),
        summary({ id: VERSION_B, version_number: 2 }),
        summary({ id: VERSION_A, version_number: 1 }),
      ],
    });
    const app = await buildApp();
    const first = await post(app, "/versions", { limit: 2 });

    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.versions.map((row: { sequence: number }) => row.sequence)).toEqual([3, 2]);
    expect(firstBody.next_cursor).toEqual(expect.any(String));
    expect(firstBody.next_cursor).not.toBe("2");

    listVersions.mockResolvedValueOnce({
      status: "ok",
      value: [summary({ id: VERSION_A, version_number: 1 })],
    });
    const second = await post(app, "/versions", {
      limit: 2,
      cursor: firstBody.next_cursor,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().current_version_id).toBe(VERSION_B);
    expect(listVersions).toHaveBeenLastCalledWith(SCENARIO, 3, 2);
    await app.close();
  });

  it("fails closed on a forged history cursor", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions", {
      cursor: "not-a-server-cursor",
    });
    expect(res.statusCode).toBe(422);
    expect(listVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["owner", { actor_kind: "known", authored_by: "owner" }, { kind: "known", authored_by: "owner" }],
    ["assistant", { actor_kind: "known", authored_by: "assistant" }, { kind: "known", authored_by: "assistant" }],
    ["participant", { actor_kind: "known", authored_by: OWNER }, { kind: "known", authored_by: OWNER }],
    ["system", { actor_kind: "system", authored_by: null }, { kind: "system" }],
    ["unknown", { actor_kind: null, authored_by: null }, { kind: "unknown" }],
  ])("renders producer-attested %s attribution without inference", async (_label, metadata, expected) => {
    listVersions.mockResolvedValueOnce({
      status: "ok",
      value: [summary(metadata)],
    });
    const app = await buildApp();
    const res = await post(app, "/versions", {});
    expect(res.statusCode).toBe(200);
    expect(res.json().versions[0].actor).toEqual(expected);
    await app.close();
  });

  it("refuses authored_by when no producer-attested actor kind travelled", async () => {
    listVersions.mockResolvedValueOnce({
      status: "ok",
      value: [summary({ actor_kind: null, authored_by: "owner" })],
    });
    const app = await buildApp();
    const res = await post(app, "/versions", {});
    expect(res.statusCode).toBe(503);
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
    await post(app, "/versions", {});
    expect(ensureScenarioExists).toHaveBeenCalled();
    await app.close();
  });

  it("refuses another user's scenario with the same 404 bytes as an absent one", async () => {
    // The caller is a VERIFIED stranger. Carried by the token, because a body
    // field would no longer change the outcome in either direction.
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });
    const app = await buildApp();
    const resOther = await post(app, "/versions", {});
    expect(resOther.statusCode).toBe(404);

    scenarioExists.mockResolvedValue(false);
    const resAbsent = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${ABSENT_SCENARIO}/versions`,
      payload: {},
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
    const res = await post(app, "/versions", {});
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("maps a disabled service to 503 with an honest reason, never an empty list", async () => {
    listVersions.mockResolvedValue({ status: "disabled" });
    const app = await buildApp();
    const res = await post(app, "/versions", {});
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
    const res = await post(app, "/versions", {});
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions/compare — authoritative stored-version diff", () => {
  it("compares only the two addressed server versions and omits internal count telemetry", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema).toBe("model_version_diff.v1");
    expect(body.scenario_id).toBe(SCENARIO);
    expect(body.categories.structure[0].summary).toBe("Added Revenue");
    expect(body.diff).toBeUndefined();
    expect(body.short_circuit).toBeUndefined();
    expect(compareVersions).toHaveBeenCalledWith(SCENARIO, VERSION_A, VERSION_B);
    await app.close();
  });

  it("omits the internal short-circuit marker from identical wire responses", async () => {
    compareVersions.mockResolvedValue({
      status: "ok",
      value: {
        relation: "identical",
        short_circuit: true,
        from_version_id: VERSION_A,
        to_version_id: VERSION_B,
        from_full_hash: HASH_A,
        to_full_hash: HASH_A,
        analysis_equivalent: true,
        categories: {
          structure: [],
          relationships: [],
          values_uncertainty: [],
          evidence_provenance: [],
          goals_constraints_options: [],
          assumptions_claims: [],
          presentation: [],
          other_model_fields: [],
        },
        coverage: {
          known_undetectable: ["conversation_or_discussion_not_committed_to_the_shared_graph"],
          known_uninterpreted_paths: [],
        },
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().relation).toBe("identical");
    expect(res.json().short_circuit).toBeUndefined();
    await app.close();
  });

  it("fails closed when the internal comparison would violate the public diff contract", async () => {
    const current = await compareVersions();
    compareVersions.mockResolvedValue({
      ...current,
      value: {
        ...current.value,
        categories: {
          ...current.value.categories,
          structure: [
            {
              ...current.value.categories.structure[0],
              path: "not-a-json-pointer",
              entity_id: "",
            },
          ],
        },
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toBe("Those versions could not be compared right now.");
    await app.close();
  });

  it("rejects client graph or alleged hash truth", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
      graph: { nodes: [{ id: "fabricated" }], edges: [] },
      from_full_hash: HASH_A,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("VERSION_COMPARE_SERVER_AUTHORITY_REQUIRED");
    expect(compareVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses malformed ids before comparison", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: "not-a-version",
      to_version_id: VERSION_B,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("VERSION_COMPARE_PAYLOAD_INVALID");
    expect(compareVersions).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails closed when a stored graph is incompatible", async () => {
    compareVersions.mockResolvedValue({
      status: "error",
      error: {
        code: "version_graph_incompatible",
        recoverable: false,
        message: "duplicate node id",
      },
    });
    const app = await buildApp();
    const res = await post(app, "/versions/compare", {
      from_version_id: VERSION_A,
      to_version_id: VERSION_B,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("VERSION_GRAPH_INCOMPATIBLE");
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAVE (named)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions/save — named save of the SERVER's current graph", () => {
  it("versions the server's persisted graph with the user's label and provenance user_save", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/save", { label: "Before pivot" });

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
    const res = await post(app, "/versions/save", { graph: smuggled });

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
    const res = await post(app, "/versions/save", {});
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
      expected_graph_identity_hash: HASH_B,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("VERSION_STALE");
    await app.close();
  });

  it("refuses a non-string label without a service call", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/save", { label: 42 });
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
        version_id: VERSION_A,
        expected_graph_identity_hash: HASH_B,
      },
    });
    expect(missingMutation.statusCode).toBe(422);

    const missingCas = await app.inject({
      method: "POST",
      url: `/assist/v1/scenarios/${SCENARIO}/versions/restore`,
      payload: {
        version_id: VERSION_A,
        mutation_id: MUTATION_ID,
      },
    });
    expect(missingCas.statusCode).toBe(422);

    const nullCas = await post(app, "/versions/restore", {
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
      version_id: VERSION_A,
    });
    expect(res.statusCode).toBe(503);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a missing/invalid version_id without any service call", async () => {
    const app = await buildApp();
    const res = await post(app, "/versions/restore", {});
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
      const res = await post(app, path, body);

      expect(res.statusCode).toBe(422);
      await app.close();
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 8 — C8: THE RESTORE TIER STANDS ON THE SHARED PERSISTENCE FLOOR'S CHECK
//
// This route is the THIRD production `scenarios.graph` writer. `commit.ts` and
// `assist.v1.scenario-graph-register.ts` reach the terminal structural
// invariants through `appendCheckedGraphWrite`; this one cannot, because its RPC
// owns graph + undo + version + head + event in one statement AND its CAS is
// unconditional where the turn family's is `p_cas_enforce DEFAULT FALSE`. So it
// takes the CHECK half — `assertNoIntroducedGraphViolations` — and keeps its own
// append. Before C8 it enforced nothing: a stored version carrying a duplicate
// node id was written straight back.
//
// ⚠ EVERY ASSERTION HERE BINDS BY IDENTITY, never by a value predicate: the
// refusal is matched on `details.code === "GRAPH_INVARIANT_VIOLATION"` AND the
// named invariant code AND the offending entity id, and the no-write half is
// `restoreVersionAtomic` not-called — not merely "a non-2xx".
//
// ⚠ MUTANT OBLIGATION (the discriminating pair): delete the
// `assertNoIntroducedGraphViolations` call in `assist.v1.scenario-versions.ts`
// and every refusal test below must RED. Break a DIFFERENT writer's check (the
// `appendCheckedGraphWrite` call in `assist.v1.scenario-graph-register.ts`) and
// they must all stay GREEN — that pair is what proves these bind to THIS path
// rather than to the floor in general.
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /versions/restore — C8 persisted-graph invariants", () => {
  /** A stored version whose graph carries a DUPLICATE node id (`n2` twice). */
  const DUPLICATE_NODE_VERSION_GRAPH = {
    nodes: [
      { id: "n1", label: "Take the job", kind: "option" },
      { id: "n2", label: "Commute time", kind: "factor" },
      { id: "n2", label: "Commute time (again)", kind: "factor" },
    ],
    edges: [{
      from: "n1",
      to: "n2",
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    }],
  };

  /** A stored version with an edge endpoint naming a node that does not exist. */
  const DANGLING_EDGE_VERSION_GRAPH = {
    nodes: [{ id: "n1", label: "Take the job", kind: "option" }],
    edges: [{
      from: "n1",
      to: "n_missing",
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    }],
  };

  const storedVersionIs = (graph: unknown) =>
    getVersion.mockResolvedValue({
      status: "ok",
      value: { ...summary(), graph },
    });

  it("REFUSES a version that INTRODUCES a duplicate node id — 422, and NOTHING is written", async () => {
    storedVersionIs(DUPLICATE_NODE_VERSION_GRAPH);
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    // Bind to the SPECIFIC invariant and the SPECIFIC offending id — a generic
    // 422 would pass a weaker assertion for entirely unrelated reasons.
    expect(body.details.violations).toEqual([
      expect.objectContaining({ code: "DUPLICATE_NODE_ID", entity_ids: ["n2"] }),
    ]);
    // THE POINT OF THE WHOLE CLOSURE: the atomic RPC never ran.
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("REFUSES a version whose edge endpoint names no node — 422, and NOTHING is written", async () => {
    storedVersionIs(DANGLING_EDGE_VERSION_GRAPH);
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.violations).toEqual([
      expect.objectContaining({
        code: "EDGE_ENDPOINT_MISSING",
        entity_ids: ["n_missing"],
      }),
    ]);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("ABSORBS a violation the CURRENT graph already carries — the OUTWARD leg", async () => {
    // Delta-scoping: the check refuses making a scenario structurally WORSE, not
    // restoring it to a state it is already in. ⚠ This is the OUTWARD leg ONLY —
    // its opposite-direction twin (the return leg) is pinned below, and it does
    // NOT succeed. Do not read this test as "a corrupt scenario stays freely
    // restorable"; an earlier version of this name said exactly that and was
    // false.
    storedVersionIs(DUPLICATE_NODE_VERSION_GRAPH);
    loadGraph.mockResolvedValue(DUPLICATE_NODE_VERSION_GRAPH);
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
  });

  it("is ABSOLUTE on an empty scenario — `loadGraph` null is a baseline, NOT the observe-only degrade", async () => {
    // `store.loadGraph` returns `null`, never `undefined`, and the floor's
    // observe-only degrade keys on a STRICT `=== undefined`. A `?? undefined`
    // anywhere on this path would silently convert this journey from
    // fail-closed to write-anything, and every other test here would stay green.
    storedVersionIs(DUPLICATE_NODE_VERSION_GRAPH);
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.violations).toEqual([
      expect.objectContaining({ code: "DUPLICATE_NODE_ID" }),
    ]);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("does NOT refuse on an OBSERVE-ONLY code — an unresolved goal_node_id still restores", async () => {
    // The fail-closed set is exactly {DUPLICATE_NODE_ID, EDGE_ENDPOINT_MISSING,
    // DUPLICATE_OPTION_ID}. Pinning the negative matters as much as the
    // positive: over-refusing here would break restores the turn path allows,
    // and no test above could see it.
    storedVersionIs({ ...STORED_VERSION_GRAPH, goal_node_id: "n_absent" });
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // GATE 1 — WHICH BYTES DID THE CHECK SEE?
  //
  // ⚠ THE DEFECT THIS CLOSES WAS IN THIS VERY FILE. Every test above asserts
  // what the **RPC** received; NONE asserted what the **CHECK** received. So
  // swapping the check's argument `graphForStore` -> `parsedGraph.data` (raw,
  // unprojected) left this suite GREEN 51/51 and the population pin GREEN 11/11.
  // That is the C8 defect class itself — persisted bytes never checked, suite
  // green — sitting inside the change that exists to close it.
  //
  // NON-EQUIVALENCE, MEASURED ON THE REAL MODULES (not argued):
  //   `reconcileTopLevelOptionsFromNodes` pushes into `missing[]` per NODE with
  //   NO dedup (`reconcile-top-level-options.ts:277-281`), so two option-kind
  //   nodes sharing an id mirror TWICE into a PRESENT `options[]`:
  //     CHECK(raw)       -> ["DUPLICATE_NODE_ID:n2"]
  //     CHECK(projected) -> ["DUPLICATE_NODE_ID:n2", "DUPLICATE_OPTION_ID:n2"]
  //   The second violation EXISTS ONLY AFTER PROJECTION. Asserting the exact
  //   list is therefore positive proof of which bytes reached the check.
  //   (`options: []` must be PRESENT — the pass is UPDATE-IF-PRESENT and an
  //   absent `options` is left alone, which is why a simpler fixture cannot
  //   discriminate.)
  // ───────────────────────────────────────────────────────────────────────

  it("the CHECK sees the PROJECTED bytes, not the raw stored version", async () => {
    getVersion.mockResolvedValue({
      status: "ok",
      value: {
        ...summary(),
        graph: {
          nodes: [
            { id: "n1", label: "Take the job", kind: "option" },
            { id: "n2", label: "Commute", kind: "option" },
            { id: "n2", label: "Commute again", kind: "option" },
          ],
          edges: [],
          options: [],
        },
      },
    });
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(422);
    // ⭐ DUPLICATE_OPTION_ID is unreachable from the raw stored graph — it is
    // created by the projection pass. Its presence here is the assertion.
    expect(res.json().details.violations).toEqual([
      expect.objectContaining({ code: "DUPLICATE_NODE_ID", entity_ids: ["n2"] }),
      expect.objectContaining({ code: "DUPLICATE_OPTION_ID", entity_ids: ["n2"] }),
    ]);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GATE 2 — THE RETURN LEG.
  //
  // ⚠ THIS GATE USED TO PIN THE OPPOSITE OUTCOME, and the rewrite is
  // deliberate rather than a deletion. The superseded test was named
  // "ONE-WAY DOOR — escaping a corrupt scenario succeeds, and UNDOING that
  // escape is REFUSED", and it said: *"If this ever returns 200, either the
  // undo capture became checked or the baseline semantics changed; both are
  // decisions that must be made deliberately."*
  //
  // ⭐ WHICH ONE HAPPENED: THE SECOND — the baseline semantics changed. The
  // first (check the undo capture at write, and refuse the whole outward
  // restore when the pre-restore graph would be unreturnable) was considered
  // and REJECTED: it does not remove the trap, it inverts it, leaving the user
  // trapped INSIDE the corruption with no escape at all, and it reverses this
  // estate's own rationale that an absolute refusal on an already-invalid base
  // "would make the scenario permanently uneditable" (`edit-graph.ts:2750-2755`).
  //
  // WHY THE SEMANTICS WERE WRONG: `introduced(target, current)` answers "does
  // the target carry violations the current graph doesn't?" — the same question
  // as "would this make the scenario worse" ONLY when the target is a NEW
  // state. A target the scenario ALREADY HELD cannot make it worse. The delta
  // check simply had no concept for the return leg.
  //
  // The four tests below are OPPOSITE-DIRECTION TWINS by construction: one
  // admits, three refuse, and each refusal removes exactly one conjunct of the
  // binding. A mutant that drops a conjunct REDs its own twin and nothing else.
  // ───────────────────────────────────────────────────────────────────────

  /** A graph carrying a terminal structural violation (duplicate node id). */
  const CORRUPT_GRAPH = {
    nodes: [
      { id: "n1", label: "Take the job", kind: "option" },
      { id: "n2", label: "Commute time", kind: "factor" },
      { id: "n2", label: "Commute time (again)", kind: "factor" },
    ],
    edges: [],
  };

  /**
   * The head record for a scenario whose LAST canonical mutation was a restore
   * of `undoVersionId`, leaving `heldGraph` as the working graph.
   *
   * The identity envelope is computed with the REAL authority the route uses,
   * never hardcoded: the binding compares value + algorithm + all three
   * versions, so a hand-written hash would make this fixture assert nothing the
   * day any of them moves. The DISCRIMINATION lives in the twins below, which
   * break exactly one conjunct each — not in the fixture.
   */
  function restoreHead(
    undoVersionId: string,
    heldGraph: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    const identity = computeGraphIdentityHash(heldGraph as never);
    if (identity === null) throw new Error("fixture: heldGraph has no identity");
    return {
      ...summary({
        id: RESTORED_VERSION,
        version_number: 3,
        provenance: "restore",
        creation_kind: "restore",
        parent_version_id: undoVersionId,
        restored_from_version_id: VERSION_B,
        graph_identity_hash: identity.value,
        hash_algorithm: identity.algorithm,
        identity_projection_version: identity.projection_version,
        identity_normaliser_version: identity.normaliser_version,
        graph_schema_version: identity.graph_schema_version,
        ...overrides,
      }),
      graph: heldGraph,
    };
  }

  /** The undo row the RPC captured: the corrupt pre-restore working graph. */
  function undoVersionIs() {
    getVersion.mockResolvedValue({
      status: "ok",
      // 'Before restore' / provenance 'pre_restore' — the undo row's own shape.
      value: {
        ...summary({ label: "Before restore", provenance: "pre_restore" }),
        graph: CORRUPT_GRAPH,
      },
    });
  }

  it("RETURN LEG — the door opens BOTH ways, and the SAME bytes are still refused when it is not a return leg", async () => {
    // ── OUTWARD LEG: corrupt working graph, restore a CLEAN version ──
    loadGraph.mockResolvedValue(CORRUPT_GRAPH);
    getVersion.mockResolvedValue({
      status: "ok",
      value: { ...summary(), graph: STORED_VERSION_GRAPH },
    });
    const outward = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });
    expect(outward.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);

    // ⭐ PRECONDITION CONTROL, IN-TEST. Before asserting the admission, prove
    // these exact return-leg bytes ARE refusable: with no head, the undo row is
    // an ordinary restore target and the floor refuses it 422. Without this the
    // 200 below could be a fixture that simply carries no violation, and the
    // test would pass while asserting nothing (this estate's documented decay
    // pattern — a discriminator whose precondition nothing pins).
    vi.clearAllMocks();
    restoreVersionAtomic.mockResolvedValue(atomicRestoreOk());
    getCurrentVersion.mockResolvedValue({ status: "ok", value: null });
    loadGraph.mockResolvedValue(STORED_VERSION_GRAPH);
    undoVersionIs();
    const notReturnLeg = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });
    expect(notReturnLeg.statusCode).toBe(422);
    expect(notReturnLeg.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(restoreVersionAtomic).not.toHaveBeenCalled();

    // ── RETURN LEG: identical bytes, ONE variable changed — the head is now
    // the restore whose undo pointer names this exact version.
    vi.clearAllMocks();
    restoreVersionAtomic.mockResolvedValue(atomicRestoreOk());
    loadGraph.mockResolvedValue(STORED_VERSION_GRAPH);
    undoVersionIs();
    getCurrentVersion.mockResolvedValue({
      status: "ok",
      value: restoreHead(VERSION_A, STORED_VERSION_GRAPH),
    });
    const undo = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });

    expect(undo.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
    // The undo goes through the SAME atomic RPC as any other restore — that is
    // the founder's constraint (same version/hash/receipt truth), and it is why
    // there is no undo route to assert against instead.
    expect(restoreVersionAtomic.mock.calls[0][0].version_id).toBe(VERSION_A);

    // ⭐ ADMITTED KNOWINGLY, NOT SILENTLY. The widening is real, so it must be
    // disclosed by name with the violations it let through.
    const admission = logWarn.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { event?: string } | undefined)?.event ===
        "v5.scenario_versions.return_leg_admitted",
    );
    expect(admission).toBeDefined();
    expect((admission![0] as { admitted: { code: string }[] }).admitted).toEqual([
      expect.objectContaining({ code: "DUPLICATE_NODE_ID", entity_ids: ["n2"] }),
    ]);
    expect((admission![0] as { head_version_id: string }).head_version_id).toBe(
      RESTORED_VERSION,
    );
  });

  it("NOT the return leg — a `pre_restore` version the head does NOT name is still REFUSED", async () => {
    // The binding is by IDENTITY, never by provenance: "a pre_restore row may be
    // restored" would be a value predicate every legacy corrupt row satisfies,
    // and would re-open the floor for the whole history (trap 19).
    loadGraph.mockResolvedValue(STORED_VERSION_GRAPH);
    undoVersionIs();
    getCurrentVersion.mockResolvedValue({
      status: "ok",
      // The head IS a restore, and its working graph IS current — but its undo
      // pointer names a DIFFERENT version than the one being restored.
      value: restoreHead(VERSION_B, STORED_VERSION_GRAPH),
    });

    const res = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("HEAD HAS MOVED ON — a turn since the restore makes the undo NOT a return to a held state", async () => {
    // The undo pointer matches, but the working graph is no longer the head's.
    // Restoring the old snapshot now would introduce old corruption into a graph
    // that has since changed — which is exactly what the floor exists to refuse.
    loadGraph.mockResolvedValue(CURRENT_GRAPH);
    undoVersionIs();
    getCurrentVersion.mockResolvedValue({
      status: "ok",
      value: restoreHead(VERSION_A, STORED_VERSION_GRAPH),
    });

    const res = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("HEAD IS NOT A RESTORE — a `user_save` head with a parent pointer is not something to return FROM", async () => {
    loadGraph.mockResolvedValue(STORED_VERSION_GRAPH);
    undoVersionIs();
    getCurrentVersion.mockResolvedValue({
      status: "ok",
      value: restoreHead(VERSION_A, STORED_VERSION_GRAPH, {
        provenance: "user_save",
      }),
    });

    const res = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });

    expect(res.statusCode).toBe(422);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();
  });

  it("A HEAD-READ FAILURE FAILS CLOSED — it can only ever GRANT the widening, never refuse a restore", async () => {
    // Two halves, because "fails closed" is two claims. (a) the return leg is
    // refused when the head cannot be read; (b) an ORDINARY restore is
    // unaffected by the same failure — this read must never be able to break a
    // restore that would otherwise succeed.
    loadGraph.mockResolvedValue(STORED_VERSION_GRAPH);
    undoVersionIs();
    getCurrentVersion.mockResolvedValue({
      status: "error",
      error: { code: "store_error", recoverable: true, message: "unreadable" },
    });
    const refused = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });
    expect(refused.statusCode).toBe(422);
    expect(restoreVersionAtomic).not.toHaveBeenCalled();

    vi.clearAllMocks();
    restoreVersionAtomic.mockResolvedValue(atomicRestoreOk());
    loadGraph.mockResolvedValue(CURRENT_GRAPH);
    getVersion.mockResolvedValue({
      status: "ok",
      value: { ...summary(), graph: STORED_VERSION_GRAPH },
    });
    getCurrentVersion.mockResolvedValue({
      status: "error",
      error: { code: "store_error", recoverable: true, message: "unreadable" },
    });
    const ordinary = await post(await buildApp(), "/versions/restore", {
      version_id: VERSION_A,
    });
    expect(ordinary.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
  });

  it("CONTROL — the clean default version still restores, and the check ran on the PROJECTED bytes", async () => {
    const app = await buildApp();

    const res = await post(app, "/versions/restore", { version_id: VERSION_A });

    expect(res.statusCode).toBe(200);
    expect(restoreVersionAtomic).toHaveBeenCalledTimes(1);
    // The bytes the check saw are the bytes the RPC received: same object, and
    // nothing mutates between step 7b and step 8.
    const sent = restoreVersionAtomic.mock.calls[0][0].graph;
    expect(sent.nodes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
  });
});
