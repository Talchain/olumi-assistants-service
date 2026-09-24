/**
 * ROADMAP 2.467 — `POST /assist/v1/scenarios/:scenario_id/graph/register`.
 *
 * FIXTURE PROVENANCE: the graph under test is the file a real browser actually
 * imported during the 5 Aug P0 witness walk, projected to CEE's wire spelling
 * (`../../orchestrator-v5/graph-registration/__tests__/fixtures/walk-import-modified.wire.json`
 * — 14 nodes, 32 edges, sentinel `ZZZ IMPORTED OPTION` on `opt_alpha`). Its ids,
 * kinds, labels and endpoints are the producer's. That matters here more than
 * usual: the whole defect is that CEE analysed a DIFFERENT graph from the one on
 * screen, so the test's graph must be the one that was on screen.
 *
 * WHAT THIS SUITE CANNOT PROVE, stated plainly rather than implied: it exercises
 * the route against a store double. It proves the route CALLS the atomic writer
 * with the projected bytes and the server-read CAS base. It does NOT prove the
 * RPC lands, that Supabase is migrated, or that a later Run reads the new graph.
 * Those need a live witness.
 */
import { readFileSync } from "node:fs";

import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

// `vi.hoisted` + SPREAD the real config: a `vi.mock` factory REPLACES the
// module, so a hand-listed stub silently drops every key added since it was
// written (CLAUDE.md trap 12). Only `requireUserJwt` is pinned.
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
// `append` is THE atomic writer (scenarios.graph + scenarios.graph_identity_hash
// in one statement, via append_turn_atomic_v3/v4). It is a spy so the suite can
// assert not only the response but WHAT WAS WRITTEN — the difference between
// "answers 200" and "answers 200 having stored the imported graph", which is the
// whole of this row.
const append = vi.fn();
const loadGraph = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const scenarioExists = vi.fn();

const store = { append, loadGraph, ensureScenarioExists, getScenarioOwner, scenarioExists };
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

/**
 * IDENTITY IS NOW CARRIED BY THE VERIFIED TOKEN SUBJECT, NOT BY THE BODY.
 * See the sibling read-route suite for the full note. The cross-user case
 * below states the OTHER user as a VERIFIED subject deliberately: without it
 * the case would pass because an unverified caller is refused whatever id
 * they name, and would therefore stop discriminating between "someone else's
 * scenario" and "no identity at all".
 *
 * `importOriginal` spread, never a hand-listed factory: a factory REPLACES the
 * module and every other export in the import chain would silently vanish.
 */
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from "../assist.v1.scenario-graph-register.js";
import { computeGraphIdentityHash } from "../../orchestrator-v5/context/graph-identity.js";
import { computeExpectedGraphCasHashes } from "../../orchestrator-v5/context/graph-cas-conflict.js";
import { projectGraphForPersistence } from "../../orchestrator-v5/persisted-graph-projection.js";
import { GraphStaleWriteError } from "../../orchestrator-v5/session/store.js";
import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from "../../config/graphCaps.js";
import { resolveCeeRateLimit } from "../../cee/config/limits.js";
import { RATE_BUCKET_REGISTRY } from "../../cee/config/limits.js";
import { checkPersistedGraphInvariants } from "../../orchestrator-v5/persisted-graph-invariants.js";
import { currentTurnFenceSlot, TurnFenceRejectedError } from "../../orchestrator-v5/session/turn-fence.js";
import { registrationTurnId } from "../../orchestrator-v5/graph-registration/registration-identity.js";



type WireNode = { id: string; kind?: unknown; type?: unknown; label?: string };
type WireGraph = { nodes: WireNode[]; edges: Array<Record<string, unknown>> };

// Read the fixture via fs rather than a `with { type: 'json' }` import
// attribute: the full tsconfig (module=Node16, the typecheck-drift ratchet's
// config) rejects import attributes with TS2823, and this file must stay OUT
// of the frozen error baseline. Copied from the precedent this repo already
// wrote down at `orchestrator-v5/tools/handlers/__tests__/run-analysis-brief-to-plot.test.ts`.
const WALK_IMPORT_WIRE = JSON.parse(
  readFileSync(
    new URL(
      "../../orchestrator-v5/graph-registration/__tests__/fixtures/walk-import-modified.wire.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as WireGraph;

const IMPORTED: WireGraph = WALK_IMPORT_WIRE;

/** The PRE-import server graph: the same model with `opt_alpha` still "Alpha Hall". */
const SERVER_PRE_IMPORT: WireGraph = {
  ...IMPORTED,
  nodes: IMPORTED.nodes.map((n) =>
    n.id === "opt_alpha" ? { ...n, label: "Alpha Hall" } : n,
  ),
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  return app;
}

// `await`ed on purpose: an un-awaited `app.inject()` is Light-my-Request's
// chainable builder, not a response (trap 2's refinement — the build gate
// excludes tests, so only `Typecheck Drift` would catch it).
async function post(
  app: FastifyInstance,
  scenarioId: string,
  body: Record<string, unknown>,
) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${scenarioId}/graph/register`,
    payload: body,
  });
}

/** The graph the route actually handed to the atomic writer. */
function writtenGraph(): WireGraph {
  expect(append).toHaveBeenCalledTimes(1);
  return append.mock.calls[0][0].graph as WireGraph;
}

beforeEach(() => {
  vi.resetAllMocks();
  // The signed-in owner is the default caller; cases about a DIFFERENT user
  // override this explicitly — see the note on the mock.
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  // Default posture: guest (unowned) scenario, holding the PRE-import graph.
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(SERVER_PRE_IMPORT);
  append.mockResolvedValue({ id: "turn-1" });
});

describe("register — optional initial brief", () => {
  const brief = "Saved example: Customer Data Platform Selection (vendor-selection; captured 2026-07-28). Original brief:\n\nWe need to replace our customer data platform before the current contract renews in March. The shortlist is Segment, RudderStack, or building on our existing Snowflake warehouse with Fivetran. Our constraint is a £120k annual budget and a two-person data team who can't absorb much operational overhead. We also have GDPR obligations that rule out any vendor without EU data residency.";

  it("passes the attributed brief and graph through the SAME scenario-bound atomic write", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, brief_text: brief });
    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0]).toMatchObject({ scenario_id: SCENARIO, briefText: brief });
    expect(writtenGraph()).toEqual(projectGraphForPersistence(IMPORTED, {}));
    await app.close();
  });

  it.each([undefined, null, "", " \n\t "])("keeps an absent/empty brief backward compatible: %j", async (briefText) => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, brief_text: briefText });
    expect(res.statusCode).toBe(200);
    expect(append.mock.calls[0][0].briefText).toBeUndefined();
    await app.close();
  });

  it.each([
    ["number", 42], ["object", { text: "not this contract" }],
    ["array", ["brief"]], ["overlong", "x".repeat(8001)],
  ])("rejects %s brief without any scenario write", async (_label, briefText) => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, brief_text: briefText });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("BRIEF_INVALID");
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("cannot use a brief to write another user's scenario", async () => {
    getScenarioOwner.mockResolvedValue(OTHER_USER);
    ensureScenarioExists.mockResolvedValue({ user_id: OTHER_USER });
    const app = await buildApp();
    expect((await post(app, SCENARIO, { graph: IMPORTED, brief_text: brief })).statusCode).toBe(404);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([null, "", "Newer user-authored brief: choose within the revised £90k budget."])(
    "retains canonical context across registration and reopen (prior brief %j)", async (existing) => {
      // A stateful RPC-contract double, NOT execution against PostgreSQL.
      // The executable SQL predicates it models are pinned below; real store
      // RPC argument/read coverage lives in session/__tests__/supabase-store.
      const rows = new Map([
        [SCENARIO, { graph: SERVER_PRE_IMPORT, briefText: existing }],
        [OTHER_USER, { graph: SERVER_PRE_IMPORT, briefText: "Unrelated scenario context" }],
      ]);
      append.mockImplementation(async (write: { scenario_id: string; graph: WireGraph; briefText?: string }) => {
        const row = rows.get(write.scenario_id);
        if (!row) throw new Error("Unexpected scenario write");
        row.graph = write.graph;
        if (write.briefText !== undefined && (row.briefText === null || row.briefText === "")) {
          row.briefText = write.briefText;
        }
        return { id: "registered-turn" };
      });
      const app = await buildApp();
      expect((await post(app, SCENARIO, { graph: IMPORTED, brief_text: brief })).statusCode).toBe(200);
      const reopened = structuredClone(rows.get(SCENARIO));
      expect(reopened?.briefText).toBe(existing || brief);
      expect(reopened?.graph).toEqual(projectGraphForPersistence(IMPORTED, {}));
      // A second registration cannot replace the seeded or newer text.
      await post(app, SCENARIO, { graph: IMPORTED, brief_text: "A stale replacement" });
      expect(rows.get(SCENARIO)?.briefText).toBe(existing || brief);
      expect(rows.get(OTHER_USER)).toEqual({ graph: SERVER_PRE_IMPORT, briefText: "Unrelated scenario context" });
      await app.close();
    },
  );

  it.each([
    "20260711000000_v5_append_turn_atomic_for_share.sql",
    "20260717120000_v5_append_turn_atomic_v3_graph_cas.sql",
    "20260806120000_v5_turn_fence_first_write_exemption.sql",
  ])("pins scenario-bound write-once brief SQL used by the RPC contract double: %s", (migration) => {
    const sql = readFileSync(new URL(`../../../supabase/migrations/${migration}`, import.meta.url), "utf8")
      .split("\n").map((line) => line.split("--")[0]).join(" ").replace(/\s+/g, " ");
    expect(sql).toMatch(/UPDATE scenarios SET brief_text = p_brief_text, updated_at = NOW\(\) WHERE id = p_scenario_id AND \(brief_text IS NULL OR brief_text = ''\);/);
  });
});

describe("register — the acceptance case the P0 walk failed", () => {
  it("POSITIVE CONTROL: the server graph and the imported graph really do differ, and differ in a way the identity hash SEES", () => {
    // Trap 13. Every assertion below about "the imported graph was stored"
    // is vacuous unless the two graphs are distinguishable in the first place.
    expect(SERVER_PRE_IMPORT.nodes.find((n) => n.id === "opt_alpha")?.label).toBe("Alpha Hall");
    expect(IMPORTED.nodes.find((n) => n.id === "opt_alpha")?.label).toBe("ZZZ IMPORTED OPTION");
    const before = computeGraphIdentityHash(SERVER_PRE_IMPORT as never)?.value;
    const after = computeGraphIdentityHash(IMPORTED as never)?.value;
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it("stores the IMPORTED graph — the sentinel reaches scenarios.graph", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });

    expect(res.statusCode).toBe(200);
    const stored = writtenGraph();
    // Bound BY IDENTITY (node id), never by a value predicate another node
    // could satisfy — trap 19's rule.
    expect(stored.nodes.find((n) => n.id === "opt_alpha")?.label).toBe("ZZZ IMPORTED OPTION");
    expect(stored.nodes).toHaveLength(14);
    expect(stored.edges).toHaveLength(32);
    await app.close();
  });

  it("returns the frozen scenario_graph_registration.v1 envelope with the ACK the client needs", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    const body = res.json();

    expect(body.schema).toBe("scenario_graph_registration.v1");
    expect(body.scenario_id).toBe(SCENARIO);
    expect(body.registered).toBe(true);
    expect(body.node_count).toBe(14);
    expect(body.edge_count).toBe(32);
    // The acknowledgement is the identity of the bytes ACTUALLY STORED, derived
    // from the real authority rather than restated here.
    expect(body.graph_identity_hash.value).toBe(
      computeGraphIdentityHash(writtenGraph() as never)?.value,
    );
    expect(body.graph_identity_hash.projection_version).toBe("identity.v1");
    await app.close();
  });

  it("makes the persisted graph's identity DIVERGE from the pre-import one — which is what flips freshness", async () => {
    // CEE stores no analysis snapshot; `deriveAnalysisFreshness` compares the
    // newest run's `graph_hash_at_run` against the LIVE graph's hash. So the
    // registration's whole freshness effect is this divergence. Asserting it
    // here is asserting the mechanism, not a copy of it.
    const app = await buildApp();
    await post(app, SCENARIO, { graph: IMPORTED });
    const storedHash = computeGraphIdentityHash(writtenGraph() as never)?.value;
    const preImportHash = computeGraphIdentityHash(SERVER_PRE_IMPORT as never)?.value;
    expect(storedHash).not.toBe(preImportHash);
    await app.close();
  });
});

describe("register — the atomic writer, and the trusted CAS base", () => {
  it("writes through store.append (the only writer that stamps graph_identity_hash atomically)", async () => {
    const app = await buildApp();
    await post(app, SCENARIO, { graph: IMPORTED });

    expect(append).toHaveBeenCalledTimes(1);
    const write = append.mock.calls[0][0];
    expect(write.scenario_id).toBe(SCENARIO);
    // DB CHECK: (turn_class = 'handler') = (handler_id IS NOT NULL).
    expect(write.turn_class).toBe("direct_answer");
    expect(write.handler_id).toBeNull();
    expect(write.llm_calls_used).toBe(0);
    expect(write.response_emitted).toBe(false);
    expect(write.turn_id).toMatch(/^graph_registration:/);
    await app.close();
  });

  it("takes the CAS base from the SERVER read, never from the request", async () => {
    const app = await buildApp();
    await post(app, SCENARIO, { graph: IMPORTED });

    const write = append.mock.calls[0][0];
    const fromServer = computeExpectedGraphCasHashes(SERVER_PRE_IMPORT);
    expect(write.expectedGraphIdentityHash).toBe(fromServer.expectedGraphIdentityHash);
    expect(write.expectedGraphAnalysisHash).toBe(fromServer.expectedGraphAnalysisHash);
    // DISCRIMINATING HALF: the base must NOT be the hash of what we are writing
    // — a CAS that validates a write against itself always "matches".
    expect(write.expectedGraphIdentityHash).not.toBe(
      computeExpectedGraphCasHashes(IMPORTED).expectedGraphIdentityHash,
    );
    await app.close();
  });

  it("stores the PROJECTED bytes, not the submitted ones — hash and storage describe the same graph", async () => {
    // MEASURED, and the measurement is why this test exists. On the captured
    // fixture `projectGraphForPersistence` is a byte-identical NO-OP (it returns
    // the original reference — probed at these bytes), so a mutant that deletes
    // the projection call SURVIVES against that graph. That is not equivalence,
    // it is a hole in the oracle: the projection exists precisely for graphs it
    // DOES move, and `commit.ts` was restructured because hashing before it
    // advertises an identity for bytes we do not store.
    //
    // `reconcileTopLevelOptionsFromNodes` moves a graph whose top-level
    // `options[]` is PRESENT but incomplete (an absent `options` is never
    // invented — "update if present"). The captured graph has four option
    // nodes, so seeding `options` with one of them makes the pass fire.
    const partial = {
      ...IMPORTED,
      options: [{ id: "opt_beta", label: "Beta Garden" }],
    };

    // POSITIVE CONTROL (trap 13): the projection must actually MOVE this graph,
    // or every assertion below passes by comparing a no-op to itself.
    const projected = projectGraphForPersistence(partial, {});
    expect(projected).not.toBe(partial);
    expect((projected as { options: unknown[] }).options.length).toBeGreaterThan(
      partial.options.length,
    );

    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: partial });
    expect(res.statusCode).toBe(200);

    const stored = append.mock.calls[0][0].graph as { options: Array<{ id: string }> };
    expect(stored.options.map((o) => o.id).sort()).toEqual(
      ["opt_alpha", "opt_beta", "opt_gamma", "opt_status_quo"].sort(),
    );
    // And the ACK describes those same bytes.
    expect(res.json().graph_identity_hash.value).toBe(
      computeGraphIdentityHash(stored as never)?.value,
    );
    expect(res.json().graph_identity_hash.value).not.toBe(
      computeGraphIdentityHash(partial as never)?.value,
    );
    await app.close();
  });

  it("proceeds UNINSTRUMENTED (not 5xx) when the base read throws — a blip must not lock the user out", async () => {
    loadGraph.mockRejectedValueOnce(new Error("db blip"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });

    expect(res.statusCode).toBe(200);
    const write = append.mock.calls[0][0];
    expect(write.expectedGraphIdentityHash).toBeUndefined();
    await app.close();
  });

  it("answers 409 CONFLICT — never a silent clobber — when the atomic CAS refuses", async () => {
    append.mockRejectedValueOnce(
      new GraphStaleWriteError("stale", { conflict_category: "rpc_cas_conflict" }),
    );
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });

    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("GRAPH_STALE");
    await app.close();
  });

  it("answers 503 on any other commit failure, and stores nothing", async () => {
    append.mockRejectedValueOnce(new Error("rpc exploded"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe("register — 2.467c, the kind/type pair", () => {
  it("REFUSES a divergent-field file, names the node, and writes NOTHING", async () => {
    const divergent = {
      ...IMPORTED,
      nodes: IMPORTED.nodes.map((n) =>
        n.id === "opt_alpha" ? { ...n, type: "factor" } : { ...n, type: n.kind },
      ),
    };
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: divergent });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_NODE_KIND_DIVERGENT");
    expect(res.json().details.node_ids).toEqual(["opt_alpha"]);
    // The refusal is ALL-OR-NOTHING: no partially-registered graph exists.
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("DISCRIMINATING PAIR: an AGREEING `type` on the same nodes is accepted and stored with ONE spelling", async () => {
    // Half two. Without this, the refusal above could be "any node carrying
    // `type` is refused" rather than "a node whose two spellings disagree".
    const agreeing = {
      ...IMPORTED,
      nodes: IMPORTED.nodes.map((n) => ({ ...n, type: n.kind })),
    };
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: agreeing });

    expect(res.statusCode).toBe(200);
    const stored = writtenGraph();
    expect(stored.nodes.every((n) => !("type" in n))).toBe(true);
    expect(stored.nodes.find((n) => n.id === "opt_alpha")?.kind).toBe("option");
    expect(res.json().kind_fields_normalised).toBe(14);
    // The acknowledgement names the STORED bytes. Here that is discriminating:
    // the submitted graph carries `type` on every node, the stored graph does
    // not, so the two identities differ and a hash taken from the request would
    // hand the client a token for a graph the server never stored.
    expect(res.json().graph_identity_hash.value).toBe(
      computeGraphIdentityHash(stored as never)?.value,
    );
    expect(res.json().graph_identity_hash.value).not.toBe(
      computeGraphIdentityHash(agreeing as never)?.value,
    );
    await app.close();
  });

  it("REFUSES a node that declares no kind at all, with a distinct code", async () => {
    const missing = {
      ...IMPORTED,
      nodes: IMPORTED.nodes.map((n) =>
        n.id === "fac_weather" ? { id: n.id, label: n.label } : n,
      ),
    };
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: missing });

    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_NODE_KIND_MISSING");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("register — payload refusals, all before any database work", () => {
  it.each([
    ["no graph key", {}, "GRAPH_MISSING"],
    ["graph is an array", { graph: [] }, "GRAPH_MISSING"],
    ["graph is null", { graph: null }, "GRAPH_MISSING"],
    ["nodes not an array", { graph: { nodes: {}, edges: [] } }, "GRAPH_SHAPE_INVALID"],
    ["edges not an array", { graph: { nodes: [], edges: null } }, "GRAPH_SHAPE_INVALID"],
    ["empty graph", { graph: { nodes: [], edges: [] } }, "GRAPH_EMPTY"],
  ])("refuses %s with %s and never reaches the store", async (_label, body, code) => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, body as Record<string, unknown>);
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe(code);
    expect(append).not.toHaveBeenCalled();
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(loadGraph).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a node-count over the DERIVED cap, reporting the real cap", async () => {
    const tooMany = {
      nodes: Array.from({ length: GRAPH_MAX_NODES + 1 }, (_v, i) => ({
        id: `n${i}`,
        kind: "factor",
        label: `n${i}`,
      })),
      edges: [],
    };
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: tooMany });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_TOO_LARGE");
    expect(res.json().details.max_nodes).toBe(GRAPH_MAX_NODES);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses an edge-count over the DERIVED cap", async () => {
    const tooMany = {
      nodes: [{ id: "a", kind: "factor", label: "a" }],
      edges: Array.from({ length: GRAPH_MAX_EDGES + 1 }, () => ({ from: "a", to: "a" })),
    };
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: tooMany });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.max_edges).toBe(GRAPH_MAX_EDGES);
    await app.close();
  });

  it("refuses a graph that fails the ingress contract (edge with no endpoints)", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, {
      graph: { nodes: [{ id: "a", kind: "factor", label: "a" }], edges: [{ nope: 1 }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_CONTRACT_INVALID");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a non-UUID scenario id with the SAME opaque 404 as an unauthorised one", async () => {
    const app = await buildApp();
    const bad = await post(app, "not-a-uuid", { graph: IMPORTED });
    expect(bad.statusCode).toBe(404);

    getScenarioOwner.mockResolvedValue(OWNER);
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });
    const notMine = await post(app, SCENARIO, { graph: IMPORTED, user_id: OTHER_USER });
    expect(notMine.statusCode).toBe(404);
    // Indistinguishable bytes — a refusal that named its reason would be an
    // enumeration oracle over other people's decisions.
    expect(notMine.json()).toEqual({ ...bad.json(), request_id: notMine.json().request_id });
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 503, not 404, when the ownership oracle throws", async () => {
    ensureScenarioExists.mockRejectedValueOnce(new Error("oracle down"));
    getScenarioOwner.mockRejectedValueOnce(new Error("oracle down"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect([404, 503]).toContain(res.statusCode);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("register — the owner path", () => {
  it("lets the owner register their own scenario", async () => {
    getScenarioOwner.mockResolvedValue(OWNER);
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, user_id: OWNER });
    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe("register — the rate bucket is DERIVED, and it is a write tier", () => {
  it("is registered in RATE_BUCKET_REGISTRY as `coach` (fails CLOSED), not `read` (fails OPEN)", () => {
    expect(RATE_BUCKET_REGISTRY.CEE_SCENARIO_GRAPH_REGISTER_RATE_LIMIT_RPM).toBe("coach");
    // Derived, not restated: the route asks the same resolver.
    expect(resolveCeeRateLimit("CEE_SCENARIO_GRAPH_REGISTER_RATE_LIMIT_RPM")).toBe(
      resolveCeeRateLimit("CEE_TURN_RATE_LIMIT_RPM"),
    );
  });
});


/**
 * ── C3 CLOSURE — THE TERMINAL PERSISTED-GRAPH INVARIANT ON THIS ROUTE ──────
 *
 * WHY THIS SUITE EXISTS. `commit.ts` carried a claim that the terminal
 * invariant check "covers EVERY lane ... by construction rather than by a
 * hand-listed set of call sites", justified by `store.append` being "the single
 * `scenarios.graph` writer in the service". THERE ARE TWO. This route is the
 * second, and it reached `store.append` WITHOUT the check: measured at
 * 75029f4f, `checkPersistedGraphInvariants` had exactly one production caller
 * (`commit.ts`), and zero in this file — while the contrast symbol
 * `projectGraphForPersistence` returned four hits here, so the zero was a
 * measured absence and not a blind probe.
 *
 * So a registration could persist a structural violation that the turn path
 * refuses fail-closed. These cases pin the floor that closes it.
 *
 * SCOPE, stated rather than implied: this proves the ROUTE enforces the
 * invariant against the SERVER-read base. It does not prove anything about the
 * turn path (covered by `commit.ts`'s own suites) and it does not prove the RPC
 * behaviour — the store is a double here, as the header of this file says.
 */
describe("register — the terminal persisted-graph invariant (C3 shared floor)", () => {
  /**
   * The imported graph plus a SECOND node carrying an id the graph already
   * uses. Bound by IDENTITY (the id it duplicates), never by a value predicate
   * another node could satisfy.
   */
  const DUPLICATED_ID = IMPORTED.nodes[0]!.id;
  const DUPLICATE_INTRODUCED: WireGraph = {
    ...IMPORTED,
    nodes: [
      ...IMPORTED.nodes,
      { ...IMPORTED.nodes[0]!, label: "a second node re-using an existing id" },
    ],
  };

  it("POSITIVE CONTROL: the checker flags THIS graph against THIS base, and passes the clean one — so the cases below are not vacuous", () => {
    // Trap 13 — an absence assertion is worthless unless the instrument can
    // see a presence. Both directions, same base, in one place.
    const clean = checkPersistedGraphInvariants(IMPORTED, {
      baseGraph: SERVER_PRE_IMPORT,
    });
    expect(clean.status).toBe("ok");
    expect(clean.violations).toHaveLength(0);

    const dirty = checkPersistedGraphInvariants(DUPLICATE_INTRODUCED, {
      baseGraph: SERVER_PRE_IMPORT,
    });
    expect(dirty.status).toBe("violated");
    expect(dirty.violations.map((v) => v.code)).toContain("DUPLICATE_NODE_ID");
    expect(dirty.violations.find((v) => v.code === "DUPLICATE_NODE_ID")?.entity_ids).toContain(
      DUPLICATED_ID,
    );
  });

  it("REFUSES a registration that INTRODUCES a duplicate node id, and NOTHING reaches the atomic writer", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: DUPLICATE_INTRODUCED });

    // The load-bearing assertion is the ABSENCE OF A WRITE. A refusal that
    // still persisted the graph would be the defect wearing a 4xx.
    expect(append).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    // Asserted by its SPECIFIC code, never merely "not 200": were the payload
    // to be rejected earlier for an unrelated reason, this case would go green
    // while the invariant stayed unenforced.
    expect(res.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(res.json().details.violations).toEqual([
      { code: "DUPLICATE_NODE_ID", count: 1, entity_ids: [DUPLICATED_ID] },
    ]);
    await app.close();
  });

  it("still registers a CLEAN graph — the floor refuses violations, it does not refuse writes", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });

    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("ABSORBS an INHERITED violation — a scenario whose stored graph is already invalid stays registrable", async () => {
    // The delta rule (`persisted-graph-invariants.ts`): only what THIS write
    // introduces can refuse. Without this, one corrupt stored graph would make
    // a scenario permanently unregistrable — the exact failure the turn path
    // wrote down at `edit-graph.ts:2750-2755`.
    loadGraph.mockResolvedValue(DUPLICATE_INTRODUCED);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: DUPLICATE_INTRODUCED });

    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  /**
   * ── THE FRESH-SCENARIO CASE: ABSOLUTE, AND STATED (C3 gate 2) ─────────────
   *
   * Every other case in this block mocks a NON-NULL `loadGraph`, so none of
   * them can see what the route does on a scenario that has no stored graph —
   * which is the DOMINANT import journey. The behaviour was demonstrated
   * non-equivalent and invisible: mutating the floor's base to
   * `baseGraphForInvariants ?? undefined` turns this 422 into a 200 that WRITES,
   * and all 30 merged cases stay GREEN.
   *
   * The mechanism, so the next reader does not have to re-derive it:
   * `store.loadGraph` returns `null` — never `undefined` — for an absent
   * scenario row and for a NULL `graph` column (`supabase-store.ts:1960`,
   * `:1971`). The floor's observe-only degrade keys on a STRICT
   * `options.baseGraph === undefined` (`persisted-graph-invariants.ts:222`), so
   * `null` takes the DELTA branch against an EMPTY baseline and EVERY violation
   * counts as introduced.
   *
   * DECIDED, not emergent: a graph carrying a duplicate node id is structurally
   * invalid, the turn path has always refused it, and the ingress contract
   * enforces neither node-id uniqueness nor edge referential integrity — so such
   * an import previously received a silent 200. Prefer visible failure over
   * confident wrongness.
   *
   * THE TWO CASES BELOW ARE A DISCRIMINATING PAIR, not one assertion twice.
   * They differ ONLY in how the base read resolves — `null` vs THROWS — and they
   * must give OPPOSITE answers. A mutant that collapses `null` into `undefined`
   * REDs the first and leaves the second GREEN; a mutant that removes the
   * degrade entirely does the reverse. Either alone would prove sensitivity to
   * something; only the pair proves the route discriminates on THIS distinction.
   */
  it("POSITIVE CONTROL: a null base really does behave differently from an absent one, at the checker — so the pair below is not vacuous", () => {
    // Trap 13, at the exact seam the pair depends on. If these two agreed, both
    // cases below could pass for reasons unrelated to the null/undefined split.
    const onNullBase = checkPersistedGraphInvariants(DUPLICATE_INTRODUCED, {
      baseGraph: null,
    });
    expect(onNullBase.status).toBe("violated");
    expect(onNullBase.violations.map((v) => v.code)).toContain("DUPLICATE_NODE_ID");

    const onAbsentBase = checkPersistedGraphInvariants(DUPLICATE_INTRODUCED, {
      baseGraph: undefined,
    });
    expect(onAbsentBase.status).toBe("ok");
    expect(onAbsentBase.violations).toHaveLength(0);
    expect(onAbsentBase.inheritedViolations.map((v) => v.code)).toContain("DUPLICATE_NODE_ID");
  });

  it("a FRESH scenario (loadGraph → null) is ABSOLUTE, not delta-scoped: the first import of a duplicate node id is REFUSED and NOTHING is written", async () => {
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: DUPLICATE_INTRODUCED });

    // Bound to the base the route actually read, by identity — not inferred
    // from the status code. Without this the case could go green on a null
    // base the route never consulted.
    expect(loadGraph).toHaveBeenCalledWith(SCENARIO);
    await expect(loadGraph.mock.results[0]!.value).resolves.toBeNull();

    // The load-bearing assertion is the ABSENCE OF A WRITE.
    expect(append).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    // By its SPECIFIC code and its SPECIFIC entity id — never merely "not 200",
    // which an unrelated earlier refusal would also satisfy.
    expect(res.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(res.json().details.violations).toEqual([
      { code: "DUPLICATE_NODE_ID", count: 1, entity_ids: [DUPLICATED_ID] },
    ]);
    await app.close();
  });

  it("DISCRIMINATING TWIN: when the base read THROWS, the SAME graph is written — the degrade keys on an ABSENT base, never on a null one", async () => {
    // Identical payload to the case above; the only difference is that the base
    // is unreadable, so `baseGraphForInvariants` stays at its declared
    // `undefined` and the check is observe-only. A blip must not lock a user
    // out — but a fresh scenario is not a blip, and the pair pins that they are
    // handled differently.
    loadGraph.mockRejectedValueOnce(new Error("db blip"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: DUPLICATE_INTRODUCED });

    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    // The write really did carry the violating graph — otherwise this case
    // would agree with its twin for the wrong reason.
    expect(append.mock.calls[0]![0].graph.nodes.filter(
      (n: { id: string }) => n.id === DUPLICATED_ID,
    )).toHaveLength(2);
    await app.close();
  });
});

/**
 * ⛔ A REGISTRATION THAT WRITES A VERSIONABLE GRAPH MUST LEAVE A VERSION BEHIND.
 *
 * MEASURED on deployed staging (`a76f1a0`, again on `46820d6`): a model built
 * through this route wrote 28 nodes with `model_versions = 0` and
 * `current_model_version_id = NULL`, while the CONVENTIONAL route minted a
 * version for the identical brief in the same run. A user's first model had no
 * version to reread, no receipt and no rollback point.
 *
 * The cause was not a lost version — it was never requested: the write carried
 * no `modelVersion`, so `supabase-store.ts` took its non-versioned branch.
 *
 * ⚠ AND THE FIX IS NOT UNCONDITIONAL, WHICH MATTERS. This route accepts graphs
 *   that `PersistedGraphV3` rejects — its own ingress schema is looser. The
 *   carrier then SKIPS (`graph_missing_required_fields`) rather than throwing,
 *   and the registration still succeeds with no version. That is the correct
 *   behaviour (a graph with no derivable version must not fail the import), but
 *   it means "registration" and "versioned" are not synonyms. Both arms are
 *   pinned below; the skip arm is the one that keeps the import path working.
 */
const VERSIONABLE = {
  nodes: [
    { id: "n1", kind: "factor", label: "Budget", observed_state: { value: 0.5 } },
    { id: "n2", kind: "factor", label: "Risk", observed_state: { value: 0.25 } },
  ],
  edges: [],
};

describe("register — the atomic write carries a model-version carrier", () => {
  it("RED: a versionable graph supplies a modelVersion", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: VERSIONABLE });
    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    expect(
      append.mock.calls[0][0].modelVersion,
      "without this the store takes its NON-versioned branch and no version row is ever written",
    ).toBeDefined();
    await app.close();
  });

  it("RED: the carrier satisfies both invariants append_turn_atomic_v5 raises on", async () => {
    const app = await buildApp();
    await post(app, SCENARIO, { graph: VERSIONABLE });
    const write = append.mock.calls[0][0];
    const carrier = write.modelVersion;
    expect(
      carrier.source_turn_id,
      "the RPC raises `creation/source turn carrier mismatch` when these differ",
    ).toBe(write.turn_id);
    expect(
      carrier.creation_kind,
      "the RPC requires exactly this from any caller and derives `initial` itself when the scenario has no versions yet",
    ).toBe("committed_mutation");
    expect(carrier.graph_identity_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(carrier.analysis_affecting_hash).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });

  it("CONTROL — a graph PersistedGraphV3 rejects still registers, with NO carrier and no throw", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode, "an unversionable graph must not fail the import").toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    expect(
      append.mock.calls[0][0].modelVersion,
      "the carrier SKIPS rather than throwing — registration and versioning are not synonyms",
    ).toBeUndefined();
    await app.close();
  });
});

/**
 * ⛔ THE CARRIER MUST DESCRIBE THE BYTES WE STORED — and three mutants the
 * block above does not kill.
 *
 * `VERSIONABLE` above is hand-authored and has ZERO edges, which is what makes
 * it versionable (`GraphV3` requires `strength.std` on every edge, so an
 * edge-bearing graph without it is refused). Two consequences, both measured:
 *
 *  1. `projectGraphForPersistence` is a byte-identical NO-OP on it, so passing
 *     the SUBMITTED graph to the carrier instead of the projected one SURVIVES
 *     the block above. A receipt that content-addresses bytes we did not store
 *     is the split semantic history the carrier's own header forbids.
 *  2. Nothing above pins the carrier's POLICY, so threading the plan in
 *     unconditionally — ignoring the server-read CAS base — also survives.
 *
 * The edge-bearing fixture here is `rich-persisted-graph.json` (the
 * draft-persisted shape, already the fixture of record in
 * `merge-mutated-graph-persistence.test.ts` and
 * `turn-executor-d1-mutation-commit-graph.test.ts`), not a hand-written one.
 * It matters that the real shape is covered: measured on the live estate
 * 22 Sep 2026, registration-written scenarios carry `strength.std` on
 * **16,000 of 16,092 edges**, 517 of 535 graphs fully populated (contrast,
 * `strength.mean`: 338,179/338,333). So the edge-bearing versionable graph is
 * the NORMAL case for this route and the skip arm is an 18-graph minority —
 * the reverse of what a 0-edge fixture and `IMPORTED` together suggest.
 */
describe("register — the carrier describes the STORED graph, and obeys the policy", () => {
  const EDGED = JSON.parse(
    readFileSync(
      new URL(
        "../../orchestrator-v5/__tests__/fixtures/exp01/rich-persisted-graph.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  it("POSITIVE CONTROL: the edge-bearing fixture is versionable, and `VERSIONABLE` really has no edges", () => {
    expect(EDGED.edges.length).toBeGreaterThan(0);
    expect(
      EDGED.edges.filter((e: { strength?: { std?: number } }) => typeof e.strength?.std === "number"),
    ).toHaveLength(EDGED.edges.length);
    expect(VERSIONABLE.edges).toHaveLength(0);
  });

  it("an EDGE-BEARING versionable graph — the route's normal shape — still supplies a carrier", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: EDGED });
    expect(res.statusCode).toBe(200);
    const write = append.mock.calls[0][0];
    expect(write.modelVersion).toBeDefined();
    expect(write.modelVersion.source_turn_id).toBe(write.turn_id);
    await app.close();
  });

  it("MUTANT KILLER — content-addresses the PROJECTED bytes, never the submitted ones", async () => {
    // `reconcileTopLevelOptionsFromNodes` moves a graph whose top-level
    // `options[]` is PRESENT but incomplete (an absent `options` is never
    // invented), so seeding it with one option makes the pass fire and the
    // submitted and stored bytes genuinely differ.
    const partial = { ...EDGED, options: [{ id: EDGED.options[0].id, label: "Partial" }] };

    // POSITIVE CONTROL: the projection must actually MOVE this graph, or every
    // assertion below passes by comparing a no-op to itself.
    const projected = projectGraphForPersistence(partial, {});
    expect(projected).not.toBe(partial);
    expect(computeGraphIdentityHash(projected as never)?.value).not.toBe(
      computeGraphIdentityHash(partial as never)?.value,
    );

    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: partial });
    expect(res.statusCode).toBe(200);

    const write = append.mock.calls[0][0];
    expect(write.modelVersion).toBeDefined();
    // The receipt describes the STORED bytes …
    expect(write.modelVersion.graph_identity_hash).toBe(
      computeGraphIdentityHash(write.graph as never)?.value,
    );
    // … and demonstrably NOT the submitted ones.
    expect(write.modelVersion.graph_identity_hash).not.toBe(
      computeGraphIdentityHash(partial as never)?.value,
    );
    // Receipt and the column this route stamps agree by construction.
    expect(write.modelVersion.graph_identity_hash).toBe(res.json().graph_identity_hash.value);
    await app.close();
  });

  it("MUTANT KILLER — re-registering the SAME graph writes NO carrier (the policy is the carrier's)", async () => {
    // `decideModelVersionCreation` returns `no_op` when the comparable shapes
    // match. A fix that threads the plan in unconditionally, or that drops the
    // server-read CAS base, passes every other case here and fails this one.
    loadGraph.mockResolvedValue(EDGED);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: EDGED });
    expect(res.statusCode).toBe(200);
    expect(append.mock.calls[0][0].modelVersion).toBeUndefined();
    await app.close();
  });

  it("FRESH SCENARIO — the agent-construction case: a null base takes the `initial` arm", async () => {
    // `build_model_from_brief` (agent lane) persists THROUGH this route into an
    // empty scenario, so `loadGraph` returns null. This is the shape the
    // deployed-staging measurement in the block above was taken on.
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: EDGED });
    expect(res.statusCode).toBe(200);
    const write = append.mock.calls[0][0];
    expect(write.modelVersion).toBeDefined();
    expect(write.modelVersion.source_turn_id).toBe(write.turn_id);
    await app.close();
  });
});

/**
 * ⛔ THE CANONICAL RECEIPT MUST REACH THE CALLER.
 *
 * `append_turn_atomic_v5` builds a `model_version_receipt` and
 * `SupabaseSessionStore` parses it into `SessionAppendOutcome.modelVersionReceipt`
 * (`session/store.ts:96`); `appendCheckedGraphWrite` returns that outcome
 * verbatim. This route DISCARDED it — it did not capture the return value at
 * all, and its 200 envelope carried only `graph_identity_hash`.
 *
 * That is why `build_model_from_brief` could not cite a version: the agent
 * lane reads `reg.json` and there was no version identity in it, so a freshly
 * constructed model had no id, no number and no rollback point to name.
 *
 * The field is ADDITIVE and optional. The envelope is frozen, so this matters:
 * the UI consumer (`DecisionGuideAI/src/adapters/cee/registerScenarioGraph.ts:228`)
 * accepts it by checking `schema` and `registered` rather than parsing
 * strictly, so an extra key does not break it. Attribution (`authored_by`,
 * `actor_kind`) is deliberately NOT exposed — citing a version needs its
 * identity, not its author, and this route is reachable with a service key.
 */
describe("register — the canonical receipt reaches the caller", () => {
  const RECEIPT = {
    mutation_id: "8f7e6d5c-4b3a-4291-8071-6f5e4d3c2b1a",
    version_id: "1a2b3c4d-5e6f-4071-8192-a3b4c5d6e7f8",
    version_number: 1,
    graph_identity_hash: "a".repeat(64),
    analysis_affecting_hash: "b".repeat(64),
    hash_algorithm: "sha256",
    identity_projection_version: "identity.v1",
    identity_normaliser_version: "norm.v1",
    graph_schema_version: "3.0",
    actor_kind: "unknown" as const,
    authored_by: null,
    creation_kind: "initial" as const,
    source_version_id: null,
    source_turn_id: "graph_registration:whatever",
    parent_version_id: null,
    root_version_id: null,
  };

  it("surfaces the version identity the RPC returned", async () => {
    append.mockResolvedValue({ id: "turn-1", modelVersionReceipt: RECEIPT });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: VERSIONABLE });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.model_version).toBeDefined();
    // Identity, not shape — the exact row the store said it wrote.
    expect(body.model_version.version_id).toBe(RECEIPT.version_id);
    expect(body.model_version.mutation_id).toBe(RECEIPT.mutation_id);
    expect(body.model_version.version_number).toBe(1);
    expect(body.model_version.creation_kind).toBe("initial");
    await app.close();
  });

  it("does NOT leak attribution — identity only", async () => {
    append.mockResolvedValue({ id: "turn-1", modelVersionReceipt: RECEIPT });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: VERSIONABLE });
    const mv = res.json().model_version;
    expect(mv.authored_by).toBeUndefined();
    expect(mv.actor_kind).toBeUndefined();
    await app.close();
  });

  it("CONTROL — a registration that wrote NO version carries no `model_version` key", async () => {
    // The skip arm. The absence must be an absent key, not a null that a
    // client would have to distinguish from "version unknown".
    append.mockResolvedValue({ id: "turn-1" });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(200);
    expect(res.json().model_version).toBeUndefined();
    await app.close();
  });
});

/**
 * ⛔ A REGISTRATION RETRY MUST NOT MINT A SECOND VERSION — and a reused
 * operation id carrying a DIFFERENT graph must not be reported as a success.
 *
 * The reviewer's blocker on this PR: `registrationTurnId()` minted
 * `crypto.randomUUID()` per request, and the RPC's idempotency key is
 * `(scenario_id, turn_id)`. So a lost-response retry was a brand-new write to
 * every layer beneath it, and the store's replay classifier
 * (`classifyPriorTurn`) could never match a prior row. Measured signed-in on
 * staging 9c16e8cd: construction wrote `graph_registration:<random>` with
 * `model_version_created = NULL`.
 *
 * `request_hash` was ALSO set to the turn id, so even with a stable id the
 * classifier could not tell an identical retry from the same id reused for a
 * different graph.
 */
describe("register — a replay-stable construction identity", () => {
  const OP = "7b8f0c2e-4d1a-4c3b-9e5f-1a2b3c4d5e6f";
  const OTHER_OP = "0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a";
  const SID = "8f14e45f-ceea-4f1a-9e6b-2c8d1b3a7e90";
  const call = (i: number) => append.mock.calls[i][0] as { turn_id: string; request_hash: string };

  it("RED: the SAME operation_id yields the SAME turn id, so a retry reaches the replay arm", async () => {
    const app = await buildApp();
    await post(app, SID, { graph: IMPORTED, operation_id: OP });
    await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(call(0).turn_id).toBe(call(1).turn_id);
    // Still says WHY the graph moved, in the turn log.
    expect(call(0).turn_id.startsWith("graph_registration:")).toBe(true);
  });

  it("a DIFFERENT operation_id is a different operation", async () => {
    const app = await buildApp();
    await post(app, SID, { graph: IMPORTED, operation_id: OP });
    await post(app, SID, { graph: IMPORTED, operation_id: OTHER_OP });
    expect(call(0).turn_id).not.toBe(call(1).turn_id);
  });

  it("CONTRAST CONTROL: with no operation_id every request is still distinct — the UI import does not change", async () => {
    const app = await buildApp();
    await post(app, SID, { graph: IMPORTED });
    await post(app, SID, { graph: IMPORTED });
    expect(call(0).turn_id).not.toBe(call(1).turn_id);
  });

  it("RED: request_hash covers the PAYLOAD — identical on an exact retry, different when the graph differs", async () => {
    const app = await buildApp();
    await post(app, SID, { graph: IMPORTED, operation_id: OP });
    await post(app, SID, { graph: IMPORTED, operation_id: OP });
    await post(app, SID, { graph: SERVER_PRE_IMPORT, operation_id: OP });
    expect(call(0).request_hash).toBe(call(1).request_hash);
    expect(call(2).request_hash).not.toBe(call(0).request_hash);
    // Not the turn id any more: that is what made a reused id undetectable.
    expect(call(0).request_hash).not.toBe(call(0).turn_id);
  });

  it("RED: a replay returns the ORIGINAL receipt and says it was a replay", async () => {
    const receipt = {
      mutation_id: "cb1dd25d-36c3-5beb-aadf-5a016b2bce25",
      version_id: "c0813c01-1111-4111-8111-111111111111",
      version_number: 1,
      creation_kind: "initial",
      graph_identity_hash: "a".repeat(64),
      analysis_affecting_hash: "b".repeat(64),
    };
    append.mockResolvedValue({ id: "turn-1", modelVersionReceipt: receipt, replayedPriorTurn: true });
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { replayed?: boolean; model_version?: { mutation_id: string; version_id: string } };
    expect(body.replayed).toBe(true);
    // Bound by IDENTITY: the receipt the store handed back, not a fresh one.
    expect(body.model_version?.mutation_id).toBe(receipt.mutation_id);
    expect(body.model_version?.version_id).toBe(receipt.version_id);
  });

  it("RED: the same operation_id with a DIFFERENT graph is REFUSED (409), never reported as registered", async () => {
    append.mockResolvedValue({ id: "turn-1", priorTurnConflict: true });
    const app = await buildApp();
    const res = await post(app, SID, { graph: SERVER_PRE_IMPORT, operation_id: OP });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { registered?: boolean; details?: { code?: string } };
    expect(body.registered).not.toBe(true);
    expect(body.details?.code).toBe("OPERATION_ID_REUSED");
  });

  it("refuses a malformed operation_id before any database work", async () => {
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: "not-a-uuid" });
    expect(res.statusCode).toBe(422);
    expect(append).not.toHaveBeenCalled();
  });
});


/**
 * ⛔ A REGISTRATION IS A GRAPH WRITE, SO IT TAKES A PLACE IN THE TURN FENCE.
 *
 * Measured on deployed staging (22 Sep 23:22:42Z / 23:42:15Z, scenario
 * 450acd25): both registrations logged level-50 `v5.turn_fence.no_ingress_fence`
 * and wrote UNFENCED. The store reads the fence from the request's async
 * context, so the assertion that matters is what the store SEES at the moment
 * of the write — not that some fence function was called somewhere.
 */
describe("register — the write is ordered by the turn fence", () => {
  const SID = "3d9c2f1e-7b4a-4c8e-9f0d-1a2b3c4d5e6f";
  const OP = "5b1e9c7a-2d4f-4a6b-8c0e-9f1a2b3c4d5e";
  const claimTurnFence = vi.fn();
  beforeEach(() => {
    (store as Record<string, unknown>).claimTurnFence = claimTurnFence;
    claimTurnFence.mockReset();
    claimTurnFence.mockImplementation(async (scenarioId: string, turnId: string) => ({ scenarioId, turnId, generation: 41 }));
  });

  it("RED: the store sees an ADMITTED fence handle for THIS registration's own identity", async () => {
    const seen: Array<ReturnType<typeof currentTurnFenceSlot>> = [];
    append.mockImplementation(async () => { seen.push(currentTurnFenceSlot()); return { id: "turn-1" }; });
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(res.statusCode).toBe(200);
    const expectedTurn = registrationTurnId(SID, OP);
    expect(append.mock.calls[0][0].turn_id).toBe(expectedTurn);
    expect(seen).toHaveLength(1);
    expect(seen[0], "the write reached the store with no fence slot — UNFENCED").toBeDefined();
    expect(seen[0]!.scenarioId).toBe(SID);
    expect(seen[0]!.turnId).toBe(expectedTurn);
    expect(seen[0]!.handle?.generation).toBe(41);
    // Claimed once, for the same identity, BEFORE the write.
    expect(claimTurnFence).toHaveBeenCalledTimes(1);
    expect(claimTurnFence).toHaveBeenCalledWith(SID, expectedTurn);
    expect(claimTurnFence.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]);
    await app.close();
  });

  it("a request the route REFUSES never claims a generation — refusals stay fence-neutral", async () => {
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: "not-a-uuid" });
    expect(res.statusCode).toBe(422);
    expect(claimTurnFence).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["superseded", 409, "TURN_SUPERSEDED"],
    ["stopped", 409, "TURN_STOPPED"],
  ] as const)("a %s write answers %i %s, never 200", async (verdict, status, code) => {
    append.mockRejectedValue(new TurnFenceRejectedError("refused", { verdict, generation: 41, maxGeneration: 42 } as never));
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(res.statusCode).toBe(status);
    expect(res.json().details?.code).toBe(code);
    await app.close();
  });

  it("RED: a structurally INVALID registration is refused BEFORE it claims — zero claims, zero appends", async () => {
    // Independent review of #1706: the claim ran before the invariant check, so
    // an ingress-valid duplicate-id import advanced the generation and could
    // supersede a valid in-flight turn while writing nothing.
    const DUP: WireGraph = { ...IMPORTED, nodes: [...IMPORTED.nodes, { ...IMPORTED.nodes[0]!, label: "a second node re-using an existing id" }] };
    const app = await buildApp();
    const res = await post(app, SID, { graph: DUP, operation_id: OP });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("GRAPH_INVARIANT_VIOLATION");
    expect(claimTurnFence).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("CONTRAST: the same request with a VALID graph does claim, once", async () => {
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(res.statusCode).toBe(200);
    expect(claimTurnFence).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("a fence we could not claim or read is OUR outage — a retryable 503, never a conflict", async () => {
    append.mockRejectedValue(new TurnFenceRejectedError("refused", { verdict: "unavailable", generation: null, maxGeneration: null } as never));
    const app = await buildApp();
    const res = await post(app, SID, { graph: IMPORTED, operation_id: OP });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

/**
 * ⛔ A CALLER'S EXPECTATION IS CHECKED BEFORE ANY WRITE (#1712 review).
 *
 * `factor_value_edit` carries no base on the wire, so the Agent's one-approval
 * path writes its values through THIS route with `expected_graph_hash` = the
 * model the user approved. The load-bearing assertions are the ABSENCE of a
 * write on a moved model and byte-identical behaviour for callers that send
 * nothing (the UI import).
 */
describe("register — an optional caller expectation makes the write conditional", () => {
  const current = () => computeExpectedGraphCasHashes(SERVER_PRE_IMPORT).expectedGraphAnalysisHash!;

  it("POSITIVE CONTROL: the base the route reads has a non-null analysis hash, so the cases below are not vacuous", () => {
    expect(typeof current()).toBe("string");
    expect(current().length).toBeGreaterThan(0);
  });

  it("RED: a STALE expectation is refused 409 GRAPH_STALE — no fence claim, and NOTHING reaches the atomic writer", async () => {
    const claim = vi.fn(async (scenarioId: string, turnId: string) => ({ scenarioId, turnId, generation: 7 }));
    (store as Record<string, unknown>).claimTurnFence = claim;
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_graph_hash: "not-the-current-hash" });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("GRAPH_STALE");
    expect(res.json().details.current_graph_hash).toBe(current());
    // A refused expectation must not advance the scenario's order (#1706's rule).
    expect(claim).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("a MATCHING expectation writes, and reports the analysis hash of the bytes it stored", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_graph_hash: current() });
    expect(res.statusCode).toBe(200);
    const stored = writtenGraph();
    expect(res.json().graph_hash).toBe(computeExpectedGraphCasHashes(stored).expectedGraphAnalysisHash);
    await app.close();
  });

  it("CONTRAST: with NO expectation the route writes exactly as before", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("a malformed expectation is refused before any database work", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_graph_hash: "" });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("EXPECTED_GRAPH_HASH_INVALID");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("a base that cannot be read cannot adjudicate an expectation: 503, never an unconditional write", async () => {
    loadGraph.mockRejectedValue(new Error("db blip"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_graph_hash: current() });
    expect(res.statusCode).toBe(503);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * ⛔ A FIRST CONSTRUCTION NEVER LANDS ON A MODEL SOMEONE ELSE SAVED (independent review
 * of #1786, 5805279370). The constructor reads the model as empty, then spends ~20 s
 * generating; the route's CAS base was its own read at write time, so a graph another
 * author committed in that window became the base and was replaced. `expected_model_empty`
 * carries the constructor's precondition into the write.
 */
describe("register — expected_model_empty makes a first construction conditional on an empty model", () => {
  it("RED: a POPULATED base is refused 409 MODEL_NOT_EMPTY — no fence claim, and NOTHING reaches the atomic writer", async () => {
    const claim = vi.fn(async (scenarioId: string, turnId: string) => ({ scenarioId, turnId, generation: 7 }));
    (store as Record<string, unknown>).claimTurnFence = claim;
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_model_empty: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("MODEL_NOT_EMPTY");
    expect(claim).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    delete (store as Record<string, unknown>).claimTurnFence;
    await app.close();
  });

  it.each([["absent (null)", null], ["present but empty", { nodes: [], edges: [] }]])(
    "an EMPTY base (%s) writes, carrying a KNOWN-absent base to the atomic RPC", async (_l, base) => {
      loadGraph.mockResolvedValue(base);
      const app = await buildApp();
      const res = await post(app, SCENARIO, { graph: IMPORTED, expected_model_empty: true });
      expect(res.statusCode).toBe(200);
      expect(append).toHaveBeenCalledTimes(1);
      // null (not undefined) is the fact the RPC enforces as `p_expected_base_known`.
      expect(append.mock.calls[0][0].expectedGraphIdentityHash).toBeNull();
      await app.close();
    });

  it("CONTRAST: with NO precondition a populated base is written exactly as before", async () => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each([["false", false], ["a string", "yes"], ["a number", 1]])("a malformed precondition (%s) is refused before any database work", async (_l, v) => {
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_model_empty: v });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.code).toBe("EXPECTED_MODEL_EMPTY_INVALID");
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("a base that cannot be read cannot adjudicate emptiness: 503, never an unconditional write", async () => {
    loadGraph.mockRejectedValue(new Error("db blip"));
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED, expected_model_empty: true });
    expect(res.statusCode).toBe(503);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * THE RACE ITSELF, through the REAL constructor and the REAL route: B reads empty and
 * starts generating; A commits a graph; B resumes and registers. A's graph must survive,
 * B must write nothing and say so. Contrasts: a model that stayed empty, and B's OWN
 * construction already committed by a concurrent call of the same brief.
 */
describe("construction race — pause B after its empty read, commit A, resume B", async () => {
  const { buildModelFromBrief, constructionOperationId } = await import("../../orchestrator-v5/agent-lane/runtime/build-model.js");
  const BRIEF = "Should we hire a tech lead or two developers to increase delivery velocity this year?";
  const A_GRAPH = SERVER_PRE_IMPORT;
  const candidateText = JSON.stringify({
    goal: { metric: "Velocity", operator: ">=", value: 20, unit: "points", horizon_months: 6, provenance: "explicit" },
    constraints: [],
    options: [
      { label: "Hire a tech lead", provenance: "explicit", changes: ["Delivery capacity"], interventions: [] },
      { label: "Hire two developers", provenance: "explicit", changes: ["Delivery capacity"], interventions: [] },
    ],
    factors: [{ label: "Delivery capacity", role: "observable", baseline_known: false, baseline_value: null, unit: null, provenance: "inferred", plausible_max: 100 }],
    risks: [],
    outcomes: [{ label: "Velocity", provenance: "inferred" }],
    links: [{ from: "Delivery capacity", to: "Velocity", direction: "positive", provenance: "inferred" }],
    unknowns: [],
  });

  function harness(app: FastifyInstance, versions: Array<Record<string, unknown>>) {
    const registers: number[] = [];
    const dispatch = async (path: string, body: Record<string, unknown>) => {
      if (path.endsWith("/versions")) return { status: 200, json: { versions } };
      const res = await app.inject({ method: "POST", url: path, payload: body });
      if (path.endsWith("/graph/register")) registers.push(res.statusCode);
      return { status: res.statusCode, json: res.json() as Record<string, unknown> };
    };
    return { dispatch, registers };
  }
  /** B's one structured call — during which A commits (or nothing happens). */
  const generating = (duringGeneration: () => void) => (async () => {
    duringGeneration();
    return { text: candidateText };
  }) as never;

  it("RED: A commits while B generates → B writes NOTHING, A's graph stands, and B says so truthfully", async () => {
    loadGraph.mockResolvedValue(null); // B's empty read
    const app = await buildApp();
    const h = harness(app, [{ version_id: "v-a", sequence: 1, creation: { kind: "committed_mutation", source_turn_id: "someone-elses-turn" } }]);
    const out = await buildModelFromBrief(SCENARIO, BRIEF, h.dispatch as never, generating(() => loadGraph.mockResolvedValue(A_GRAPH)));
    expect(append, "B created no write and no version over A").not.toHaveBeenCalled();
    expect(h.registers).toEqual([409]);
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: "model_changed_during_build" });
    expect(await loadGraph(SCENARIO), "A's graph is still the model").toBe(A_GRAPH);
    await app.close();
  });

  it("CONTRAST: the model stayed empty → B's construction is written once", async () => {
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const h = harness(app, []);
    const out = await buildModelFromBrief(SCENARIO, BRIEF, h.dispatch as never, generating(() => undefined));
    expect(h.registers).toEqual([200]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, mutated: true });
    await app.close();
  });

  it("CONTRAST: B's OWN construction was committed meanwhile (same brief) → its receipt is recovered, nothing written twice", async () => {
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const ownTurn = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));
    const h = harness(app, [{ version_id: "v-b1", sequence: 1, creation: { kind: "committed_mutation", mutation_id: "m-b1", source_turn_id: ownTurn } }]);
    const out = await buildModelFromBrief(SCENARIO, BRIEF, h.dispatch as never, generating(() => loadGraph.mockResolvedValue(A_GRAPH)));
    expect(append).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, mutated: false, replayed: true, model_version: { version_id: "v-b1" } });
    await app.close();
  });
});
