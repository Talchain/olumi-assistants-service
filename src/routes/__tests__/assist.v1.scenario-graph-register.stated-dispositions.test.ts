/**
 * ⭐ THE RECORDS COMPILER'S STATED DISPOSITIONS SURVIVE THE REAL WRITE AND COME BACK ON THE READ (DL ruling, 5 Oct 2026).
 *
 * The compiler computes one typed disposition per stated item at registration. Until `graph.stated_dispositions`
 * it rode the register request BESIDE the graph (`build-model-from-records.ts`) and was never stored, so the cold
 * read could only stamp its read-time label (`no_executable_quantity_carrier`) on every unmodelled figure, and the
 * independent scorer credits that label only when a row says a compiler TYPED it (`typed: true`).
 *
 * These rows drive the REAL register route — its real `projectGraphForPersistence`, `assignEntityRefs` and
 * `appendCheckedGraphWrite` — and the REAL read route over EXACTLY the bytes the write handed the store (a JSON
 * round trip, as `scenarios.graph` is jsonb). Only the session store is a double, at the same boundary every other
 * register-route suite in this directory mocks, and it copies the production row: the write's `graph` is what
 * `supabase-store.ts` passes as `p_graph`, and the read returns `{ graph, briefText }` exactly as
 * `loadGraphAndBriefText` does.
 *
 * The NO-FIELD CONTROL compares against a capture taken by running the SAME row on the base commit
 * (`__fixtures__/stated-dispositions.no-field-control.base.json`, written with `CAPTURE_BASE=1` at 9e0750dd).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SCENARIO = "5d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/telemetry.js")>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});

const append = vi.fn();
const loadGraph = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const scenarioExists = vi.fn();
const readCommittedTurn = vi.fn();
const readMostRecentPendingActions = vi.fn();
const store = {
  append, loadGraph, loadGraphAndBriefText, ensureScenarioExists, getScenarioOwner, scenarioExists,
  readCommittedTurn, readMostRecentPendingActions,
};
vi.mock("../../orchestrator-v5/session/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../orchestrator-v5/session/index.js")>()),
  getSessionStore: () => store,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from "../assist.v1.scenario-graph-register.js";
import scenarioGraphRoute from "../assist.v1.scenario-graph.js";
import { computeGraphIdentityHash } from "../../orchestrator-v5/context/graph-identity.js";
import { computeAnalysisAffectingGraphHash } from "../../orchestrator-v5/context/graph-hash.js";

type Rec = Record<string, unknown>;

const Q_PRICE = "Our Pro plan costs £49 a month";
const Q_LOSS = "Raising it to £59 would lose about 5% of customers";
const Q_CHURN = "Monthly churn is 3% today";
const Q_OPTION = "Raising it to £59";
const BRIEF = `${Q_PRICE}. ${Q_LOSS}. ${Q_CHURN}.`;
const span = (quote: string, literal: string) => ({ start: quote.indexOf(literal), end: quote.indexOf(literal) + literal.length });

const GRAPH = {
  goal_node_id: "g_mrr",
  nodes: [
    { id: "g_mrr", kind: "goal", label: "MRR" },
    { id: "dec_price", kind: "decision", label: "Pro price" },
    { id: "fac_price", kind: "factor", label: "Pro plan price", category: "controllable", observed_state: { value: 0.245 } },
    { id: "opt_keep", kind: "option", label: "Keep £49", is_baseline: true, interventions: { fac_price: 0.245 } },
    { id: "opt_59", kind: "option", label: "Raise to £59", interventions: { fac_price: 0.295 } },
  ],
  edges: [
    { from: "fac_price", to: "g_mrr", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
    { from: "dec_price", to: "opt_keep", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
    { from: "dec_price", to: "opt_59", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
    { from: "opt_keep", to: "fac_price", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
    { from: "opt_59", to: "fac_price", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
  ],
};

/** What `reconcileStatedDispositions` hands the register request today (`build-model-from-records.ts`). */
const SIDECAR = [
  // 0 — CARRIED on a carrier the stored graph holds: never a rejection on the read.
  { stated_index: 0, stated_item: { kind: "figure", source_quote: Q_PRICE, value: 49, unit: "£/month", value_span: span(Q_PRICE, "£49") },
    disposition: "carried", location: { kind: "node", node_id: "fac_price", path: [] }, stored_value: { id: "fac_price" } },
  // 1 — REJECTED with the compiler's typed reason.
  { stated_index: 1, stated_item: { kind: "cause", source_quote: Q_LOSS, value: 5, unit: "%", value_span: span(Q_LOSS, "5%") },
    disposition: "rejected", reason: "stated_relationship_not_carried" },
  // 2 — ASKED: the compiler put the question to the user.
  { stated_index: 2, stated_item: { kind: "figure", source_quote: Q_CHURN, value: 3, unit: "%", value_span: span(Q_CHURN, "3%") },
    disposition: "asked" },
  // 3 — claims CARRIED on a node the stored graph does NOT hold: the server's reconciliation must withdraw it.
  { stated_index: 3, stated_item: { kind: "option", source_quote: Q_OPTION },
    disposition: "carried", location: { kind: "node", node_id: "opt_gone", path: [] }, stored_value: { id: "opt_gone" } },
];

async function register(payload: Rec) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await app.inject({ method: "POST", url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload });
  await app.close();
  return res;
}
async function read() {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  const res = await app.inject({ method: "POST", url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  await app.close();
  return res;
}
/** The production writer's row: `write.graph` is `p_graph`; jsonb hands it back as a fresh parse. */
const storedRow = () => {
  const write = append.mock.calls[0]![0] as Rec;
  return { write, graph: JSON.parse(JSON.stringify(write.graph)) as Rec, briefText: write.briefText as string };
};
/** Read back exactly what the write stored. */
const readBackStored = () => {
  const row = storedRow();
  loadGraphAndBriefText.mockResolvedValue({ graph: row.graph, briefText: row.briefText });
  return row;
};
const typedItems = (body: Rec): Rec[] =>
  (((body.not_modelled as Rec | undefined)?.stated_dispositions as Rec | undefined)?.items as Rec[] | undefined) ?? [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CEE_GRAPH_MANAGEMENT_MODE", "live");
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: "u-1" });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(null);
  append.mockResolvedValue({ id: "turn-1" });
  readCommittedTurn.mockResolvedValue(null);
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe("graph.stated_dispositions — register write → stored row → cold read", () => {
  it("⭐ RED: the register writes the sidecar onto the stored graph, reconciled against the bytes it stores", async () => {
    const res = await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, stated_dispositions: structuredClone(SIDECAR) });
    expect(res.statusCode, res.body).toBe(200);
    const stored = storedRow().graph.stated_dispositions as Rec[];
    expect(stored.map((r) => [r.stated_index, r.disposition, r.reason])).toEqual([
      [0, "carried", undefined],
      [1, "rejected", "stated_relationship_not_carried"],
      [2, "asked", undefined],
      // the carrier the request claimed is not in the stored bytes → withdrawn, never advertised
      [3, "rejected", "carrier_removed"],
    ]);
    expect(stored[0]!.location).toEqual({ kind: "node", node_id: "fac_price", path: [] });
    expect((stored[1]!.stated_item as Rec).source_quote).toBe(Q_LOSS);
  });

  it("⭐ RED: the cold read emits every persisted rejected/asked disposition as a typed not_modelled row at the stated item's offset", async () => {
    await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, stated_dispositions: structuredClone(SIDECAR) });
    readBackStored();
    const res = await read();
    expect(res.statusCode, res.body).toBe(200);
    const items = typedItems(res.json() as Rec);
    expect(items).toEqual([
      { stated_index: 1, stated_item_kind: "cause", literal: "5%", char_offset: BRIEF.indexOf(Q_LOSS) + Q_LOSS.indexOf("5%"),
        disposition: "rejected", reason: "stated_relationship_not_carried", typed: true },
      { stated_index: 2, stated_item_kind: "figure", literal: "3%", char_offset: BRIEF.indexOf(Q_CHURN) + Q_CHURN.indexOf("3%"),
        disposition: "clarification_asked", reason: "clarification_asked", typed: true },
      { stated_index: 3, stated_item_kind: "option", literal: Q_OPTION, char_offset: BRIEF.indexOf(Q_OPTION),
        disposition: "rejected", reason: "carrier_removed", typed: true },
    ]);
    // Each offset addresses the user's own bytes.
    for (const item of items) expect(BRIEF.slice(item.char_offset as number).startsWith(item.literal as string)).toBe(true);
  });

  it("⭐ RED: a CARRIED disposition is never emitted as a rejection", async () => {
    await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, stated_dispositions: structuredClone(SIDECAR) });
    readBackStored();
    const body = (await read()).json() as Rec;
    // contrast: the typed rows ARE there, so the absence below is a measurement, not a blind probe
    expect(typedItems(body).length).toBe(3);
    expect(typedItems(body).some((r) => r.stated_index === 0)).toBe(false);
    expect(JSON.stringify(body.not_modelled)).not.toContain('"stated_index":0');
  });

  it("⭐ RED (egress): the UI-facing graph omits the receipt; both hash tokens are those of the STORED bytes", async () => {
    const ack = (await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, stated_dispositions: structuredClone(SIDECAR) })).json() as Rec;
    const row = readBackStored();
    expect(row.graph).toHaveProperty("stated_dispositions"); // contrast: the stored row carries it
    const body = (await read()).json() as Rec;
    expect(body.graph as Rec).not.toHaveProperty("stated_dispositions");
    const { stated_dispositions: _r, ...withoutReceipt } = row.graph;
    expect(body.graph).toEqual(withoutReceipt);
    // The CAS tokens a later write is checked against are the stored bytes' own (`computeExpectedGraphCasHashes(base)`).
    expect(body.graph_identity_hash).toEqual(computeGraphIdentityHash(row.graph as never));
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(row.graph as never));
    // The UI compares the read's identity with the register ACK's (DGAI `seedWriteBaseAfterRegistration.ts`); a token
    // derived from the stripped graph would read as `identityMismatch` and leave its write base unseeded.
    expect(body.graph_identity_hash).toEqual(ack.graph_identity_hash);
    expect(body.graph_hash).toBe(ack.graph_hash);
  });

  it("⭐ RED: a key smuggled inside `graph` is never stored — the sidecar, reconciled, is the only source", async () => {
    const smuggled = { ...structuredClone(GRAPH), stated_dispositions: [SIDECAR[1]] };
    const res = await register({ graph: smuggled, brief_text: BRIEF });
    expect(res.statusCode, res.body).toBe(200);
    expect(storedRow().graph).not.toHaveProperty("stated_dispositions");
    // contrast: the same request with the sidecar does store it
    vi.mocked(append).mockClear();
    await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, stated_dispositions: [SIDECAR[1]] });
    expect(storedRow().graph).toHaveProperty("stated_dispositions");
  });

  it("RED: a malformed sidecar is refused before anything is written", async () => {
    const res = await register({ graph: structuredClone(GRAPH), brief_text: BRIEF,
      stated_dispositions: [{ stated_index: 1, disposition: "rejected", reason: "Not A Code" }] });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { details?: { code?: string } }).details?.code).toBe("STATED_DISPOSITIONS_INVALID");
    expect(append).not.toHaveBeenCalled();
  });
});

describe("NO-FIELD CONTROL — a register without the key stores and serves exactly what the base did", () => {
  const FIXTURE = fileURLToPath(new URL("./__fixtures__/stated-dispositions.no-field-control.base.json", import.meta.url));

  it("byte-identical stored row and an identical read response to the base commit", async () => {
    // A fixed operation id: the turn id (and so the mutation id) derives from it, else it is random per run.
    const reg = await register({ graph: structuredClone(GRAPH), brief_text: BRIEF, operation_id: "0c0c0c0c-1d1d-4e4e-8f8f-a0a0a0a0a0a0" });
    expect(reg.statusCode, reg.body).toBe(200);
    const row = readBackStored();
    const res = await read();
    expect(res.statusCode, res.body).toBe(200);
    const { duration_ms: _d, ...writeWithoutClock } = row.write;
    const { request_id: _q, ...readWithoutRequestId } = res.json() as Rec;
    const { request_id: _q2, ...registerWithoutRequestId } = reg.json() as Rec;
    const capture = {
      stored_graph_bytes: JSON.stringify(row.write.graph),
      write: JSON.parse(JSON.stringify(writeWithoutClock)) as unknown,
      register_response: registerWithoutRequestId,
      read_response_bytes: JSON.stringify(readWithoutRequestId),
    };
    if (process.env.CAPTURE_BASE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(capture, null, 2)}\n`);
      return;
    }
    expect(existsSync(FIXTURE)).toBe(true);
    const base = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof capture;
    expect(capture.stored_graph_bytes).toBe(base.stored_graph_bytes);
    expect(capture.write).toEqual(base.write);
    expect(capture.register_response).toEqual(base.register_response);
    expect(capture.read_response_bytes).toBe(base.read_response_bytes);
  });
});
