/**
 * STABLE ENTITY REFS on the register route (`graph/entity-refs.ts`; lease 5909544405). The route assigns refs to the
 * bytes it hashes and writes, carries the base's refs forward by node id, and never backfills an entity the base held
 * without one. The identity it returns is the identity of exactly the stored bytes.
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
const readCommittedTurn = vi.fn();

const store = { append, loadGraph, ensureScenarioExists, getScenarioOwner, scenarioExists, readCommittedTurn };
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
import { GraphV3 } from "../../schemas/cee-v3.js";
import { GraphStaleWriteError } from "../../orchestrator-v5/session/store.js";
import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from "../../config/graphCaps.js";
import { resolveCeeRateLimit } from "../../cee/config/limits.js";
import { RATE_BUCKET_REGISTRY } from "../../cee/config/limits.js";
import { checkPersistedGraphInvariants } from "../../orchestrator-v5/persisted-graph-invariants.js";
import { currentTurnFenceSlot, TurnFenceRejectedError } from "../../orchestrator-v5/session/turn-fence.js";
import { registrationRequestHash, registrationTurnId } from "../../orchestrator-v5/graph-registration/registration-identity.js";



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
  readCommittedTurn.mockResolvedValue(null);
});


type Json = Record<string, any>;
const refsOf = (g: Json) => Object.fromEntries((g.nodes as Json[]).map((n) => [n.id, n.ref]));
const stripRefs = (g: Json): Json => {
  const { ref_high_water: _hw, ...rest } = g;
  return { ...rest, nodes: (g.nodes as Json[]).map(({ ref: _r, ...n }) => n) };
};

describe("register — stable entity refs", () => {
  it("a FIRST construction stores a ref on every entity (kind order) + the high-water; the returned identity is the stored bytes'", async () => {
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(200);
    const stored = writtenGraph() as unknown as Json;
    const refs = Object.values(refsOf(stored));
    expect(refs.every((r) => typeof r === "string" && /^(OC|G|O|F|R|D|A)[1-9][0-9]*$/.test(r as string))).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    expect(stored.ref_high_water).toBeDefined();
    expect(res.json().graph_identity_hash.value).toBe(computeGraphIdentityHash(stored as never)?.value);
    // nothing but refs was added to the projected bytes
    expect(stripRefs(stored)).toEqual(projectGraphForPersistence(IMPORTED, {}));
    await app.close();
  });

  it("re-registering onto a PRE-REFS graph backfills nothing: the entities the base held stay ref-less", async () => {
    const app = await buildApp();                        // default: the scenario holds SERVER_PRE_IMPORT (no refs)
    const res = await post(app, SCENARIO, { graph: IMPORTED });
    expect(res.statusCode).toBe(200);
    expect(Object.values(refsOf(writtenGraph() as unknown as Json)).every((r) => r === undefined)).toBe(true);
    expect(writtenGraph()).toEqual(projectGraphForPersistence(IMPORTED, {}));
    await app.close();
  });

  it("an incoming graph that DROPPED its refs gets the base's refs back by node id (never renumbered)", async () => {
    loadGraph.mockResolvedValue(null);
    const app1 = await buildApp();
    await post(app1, SCENARIO, { graph: IMPORTED });
    const first = writtenGraph() as unknown as Json;
    await app1.close();

    vi.resetAllMocks();
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
    ensureScenarioExists.mockResolvedValue({ user_id: null });
    getScenarioOwner.mockResolvedValue(null);
    scenarioExists.mockResolvedValue(true);
    loadGraph.mockResolvedValue(first);                   // the stored graph now carries refs
    append.mockResolvedValue({ id: "turn-2" });
    readCommittedTurn.mockResolvedValue(null);
    const edited = stripRefs(first);                      // a client that knows nothing of refs
    (edited.nodes as Json[])[0]!.label = "Renamed by the user";
    const app2 = await buildApp();
    const res = await post(app2, SCENARIO, { graph: edited, expected_graph_identity_hash: computeGraphIdentityHash(first as never)?.value });
    expect(res.statusCode, res.body).toBe(200);
    expect(refsOf(writtenGraph() as unknown as Json)).toEqual(refsOf(first));
    await app2.close();
  });
});
