/**
 * ⛔ S10 — A WHOLE MODEL IS SAVED ONLY INTO AN EMPTY SCENARIO (`assist.v1.scenario-graph-register.ts`, `MODEL_ALREADY_SAVED`).
 *
 * A client's whole-graph register over a saved model replaces it with the client's copy: every element the copy lacks is
 * deleted and every value it holds wins, with no edit, approval or receipt (arch12 `10-shared-data-layer.md` (iv); the UI
 * re-arms one whenever its canvas is not acknowledged, DGAI `useImportRegistration.ts:214-241`). The saved model in each
 * row is a SERVED read from a real journey — marketing (`0dac5dcc`, read 02) and hiring (`post3007`, read 01) — and the
 * client's copy is that model with one element missing: the overwrite that would delete it.
 *
 * CEE's own whole-graph writers run inside the Agent's in-process dispatch for the scenario (`runAsAgentSubturn`), which
 * nothing outside the process can forge; they keep writing, under their own compare-and-set.
 */
import { readFileSync } from "node:fs";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installOwnershipHarness } from "../../../tests/utils/ownership-route-harness.js";

const SCENARIO = "5b0e2f61-7a3c-4d8e-9f10-2a3b4c5d6e7f";
const OTHER_SCENARIO = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const append = vi.fn();
const loadGraph = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const scenarioExists = vi.fn();
const readCommittedTurn = vi.fn();
const store = { readMostRecentPendingActions: vi.fn(async () => []), append, loadGraph,
  loadGraphAndBriefText: async (scenarioId: string) => ({ graph: await loadGraph(scenarioId), briefText: null, revision: 7 }),
  ensureScenarioExists, getScenarioOwner, scenarioExists, readCommittedTurn };
vi.mock("../../orchestrator-v5/session/index.js", () => ({ getSessionStore: () => store }));

vi.mock("../../utils/supabase-user-jwt.js", async () => ({
  looksLikeJwt: () => true,
  verifySupabaseUserJwt: (await import("../../../tests/utils/ownership-route-harness.js")).verifyFixtureIdentity,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from "../assist.v1.scenario-graph-register.js";
import { computeExpectedGraphCasHashes } from "../../orchestrator-v5/context/graph-cas-conflict.js";
import { runAsAgentSubturn } from "../../orchestrator-v5/session/agent-subturn-context.js";
import { __setUseAppendV6ForTest } from "../../orchestrator-v5/session/supabase-store.js";

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };

const servedGraph = (url: URL): Graph => (JSON.parse(readFileSync(url, "utf8")) as { body: { graph: Graph } }).body.graph;
const BRIEFS: ReadonlyArray<{ readonly name: string; readonly saved: Graph }> = [
  { name: "marketing (served 0dac5dcc read 02)",
    saved: servedGraph(new URL("../../orchestrator-v5/agent-lane/__tests__/fixtures/marketing-e2e-0dac5dcc-read02-after-approve.json", import.meta.url)) },
  { name: "hiring (served post3007 read 01)",
    saved: servedGraph(new URL("../../../tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json", import.meta.url)) },
];

/** The client's copy: the saved model with its last risk (else last factor) missing, and that node's links. */
function clientCopyLackingOne(saved: Graph): { copy: Graph; dropped: string } {
  const pick = [...saved.nodes].reverse().find((n) => n.kind === "risk") ?? [...saved.nodes].reverse().find((n) => n.kind === "factor");
  const dropped = String(pick?.id);
  return { dropped, copy: { ...saved, nodes: saved.nodes.filter((n) => n.id !== dropped),
    edges: saved.edges.filter((e) => e.from !== dropped && e.to !== dropped) } };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await installOwnershipHarness(app, () => resolveUserIdentity());
  await registerRoute(app);
  await app.ready();
  return app;
}

async function post(app: FastifyInstance, scenarioId: string, body: Rec) {
  return await app.inject({ method: "POST", url: `/assist/v1/scenarios/${scenarioId}/graph/register`, payload: body });
}

beforeEach(() => {
  vi.resetAllMocks();
  __setUseAppendV6ForTest(true);
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  append.mockResolvedValue({ id: "turn-1" });
  readCommittedTurn.mockResolvedValue(null);
});
afterEach(() => __setUseAppendV6ForTest(false));

describe.each(BRIEFS)("S10 — a client's whole-model register over a saved model is refused: $name", ({ saved }) => {
  it("refuses with MODEL_ALREADY_SAVED and its reason; nothing is written, and the saved model keeps the element the copy lacked", async () => {
    const { copy, dropped } = clientCopyLackingOne(saved);
    expect(saved.nodes.some((n) => n.id === dropped), "the copy must lack an element the saved model holds").toBe(true);
    loadGraph.mockResolvedValue(saved);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: copy });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(409);
    const body = res.json();
    expect(body.details.code).toBe("MODEL_ALREADY_SAVED");
    expect(body.message).toBe("This scenario already has a saved model, and a whole model is only saved into an empty scenario. Nothing was written — change the saved model through its edits, or start a new scenario for this one.");
    expect(body.details.current_graph_identity_hash).toBe(computeExpectedGraphCasHashes(saved).expectedGraphIdentityHash);
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("a client that names the saved model's own hashes is still refused — a compare-and-set does not license a client overwrite", async () => {
    const { copy } = clientCopyLackingOne(saved);
    loadGraph.mockResolvedValue(saved);
    const h = computeExpectedGraphCasHashes(saved);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: copy, expected_graph_hash: h.expectedGraphAnalysisHash, expected_graph_identity_hash: h.expectedGraphIdentityHash });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(409);
    expect(res.json().details.code).toBe("MODEL_ALREADY_SAVED");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("CONTRAST: CEE's own writer (the Agent's in-process dispatch for THIS scenario) writes the same bytes over the same saved model", async () => {
    const { copy } = clientCopyLackingOne(saved);
    loadGraph.mockResolvedValue(saved);
    const app = await buildApp();
    const res = await runAsAgentSubturn(SCENARIO, () => post(app, SCENARIO, { graph: copy }));
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].scenario_id).toBe(SCENARIO);
    await app.close();
  });

  it("CONTRAST: a dispatch marked for ANOTHER scenario does not license this one", async () => {
    const { copy } = clientCopyLackingOne(saved);
    loadGraph.mockResolvedValue(saved);
    const app = await buildApp();
    const res = await runAsAgentSubturn(OTHER_SCENARIO, () => post(app, SCENARIO, { graph: copy }));
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("MODEL_ALREADY_SAVED");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });

  it("an EMPTY scenario (no stored model) takes the client's whole model", async () => {
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: saved });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("an ENTITY-LESS stored model is empty too: the client's whole model is written", async () => {
    loadGraph.mockResolvedValue({ nodes: [], edges: [] });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: saved });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(append).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("a client's IDENTICAL lost-response retry of its first model is its own replay, not an overwrite", async () => {
    const OP = "4f3c2b1a-0d9e-4c8b-a7f6-e5d4c3b2a190";
    // The first save, into the empty scenario: what was written, and under which request hash.
    loadGraph.mockResolvedValue(null);
    const app = await buildApp();
    expect((await post(app, SCENARIO, { graph: saved, operation_id: OP })).statusCode).toBe(200);
    const first = append.mock.calls[0][0] as { graph: Graph; request_hash: string };
    // Its response was lost; the same request again finds that write present and its committed turn.
    loadGraph.mockResolvedValue(first.graph);
    readCommittedTurn.mockResolvedValue({ id: "row-1", request_hash: first.request_hash, assistant_message: null, user_message: null, llm_calls_used: 0 });
    append.mockResolvedValue({ id: "turn-1", replayedPriorTurn: true });
    const res = await post(app, SCENARIO, { graph: saved, operation_id: OP });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.json().replayed).toBe(true);
    await app.close();
  });

  it("CONTRAST: the same operation with DIFFERENT bytes over that saved model is refused — never a replay", async () => {
    const OP = "4f3c2b1a-0d9e-4c8b-a7f6-e5d4c3b2a190";
    loadGraph.mockResolvedValue(saved);
    readCommittedTurn.mockResolvedValue({ id: "row-1", request_hash: "a-different-request", assistant_message: null, user_message: null, llm_calls_used: 0 });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: clientCopyLackingOne(saved).copy, operation_id: OP });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.code).toBe("MODEL_ALREADY_SAVED");
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("S10 — a stored model that cannot be read is still a saved model", () => {
  it("a client register over present, unparseable bytes is refused; nothing is written", async () => {
    loadGraph.mockResolvedValue({ nodes: "not a graph" });
    const app = await buildApp();
    const res = await post(app, SCENARIO, { graph: BRIEFS[0].saved });
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toMatchObject({ code: "MODEL_ALREADY_SAVED", current_graph_unhashable: true });
    expect(append).not.toHaveBeenCalled();
    await app.close();
  });
});
