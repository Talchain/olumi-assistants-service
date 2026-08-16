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
// in one statement, via graph-only append_turn_atomic_v5). It is a spy so the suite can
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

import registerRoute from "../assist.v1.scenario-graph-register.js";
import { computeGraphIdentityHash } from "../../orchestrator-v5/context/graph-identity.js";
import { computeExpectedGraphCasHashes } from "../../orchestrator-v5/context/graph-cas-conflict.js";
import { projectGraphForPersistence } from "../../orchestrator-v5/persisted-graph-projection.js";
import { GraphStaleWriteError } from "../../orchestrator-v5/session/store.js";
import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from "../../config/graphCaps.js";
import { resolveCeeRateLimit } from "../../cee/config/limits.js";
import { RATE_BUCKET_REGISTRY } from "../../cee/config/limits.js";



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
  // Default posture: guest (unowned) scenario, holding the PRE-import graph.
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(SERVER_PRE_IMPORT);
  append.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    graph_write_disposition: "accepted_insert",
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

  it.each([
    ["byte-identical replay", { id: "11111111-1111-4111-8111-111111111111", graph_write_disposition: "byte_identical_replay" }],
    ["divergent replay", { id: "11111111-1111-4111-8111-111111111111", graph_write_disposition: "divergent_replay" }],
    ["missing disposition", { id: "11111111-1111-4111-8111-111111111111" }],
    ["malformed disposition", { id: "11111111-1111-4111-8111-111111111111", graph_write_disposition: "inserted" }],
  ])("answers 503 with no success receipt for %s", async (_label, result) => {
    append.mockResolvedValueOnce(result);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });

    expect(res.statusCode).toBe(503);
    expect(res.json().registered).not.toBe(true);
    expect(res.json().graph_identity_hash).toBeUndefined();
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
