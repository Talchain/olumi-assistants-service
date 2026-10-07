/** P48 (audit #27): the opt-in /graph read carries `changed_since_run`, so a reload keeps the canvas's changed marks. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";

// `vi.hoisted` because `vi.mock` factories are lifted above ordinary consts,
// and this route's import chain (route-v2-preflight → build-turn-context)
// reads `config` at module-init time — early enough to lose the race.
//
// The mock SPREADS THE REAL CONFIG rather than hand-listing the sections this
// suite happens to touch: a `vi.mock` factory REPLACES the module, so a
// hand-listed stub silently drops every config key added since it was written
// (CLAUDE.md trap 12 — the flags-mock allowlist defect, verbatim). Only
// `requireUserJwt` is pinned, because it is the one field whose value this
// suite is actually asserting about. The Agent lane is enabled only for the local turn witnesses.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// ── The store double: the two reads `changed_since_run` makes are spies, so the opt-in is observable ──
const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const readRecent = vi.fn(async () => []);
const readCommittedTurn = vi.fn(async () => null);
const append = vi.fn(async () => ({ id: "answer-row" }));
const readScenarioRunAnalysisFactsFor = vi.fn();
const readRecentAppliedMutationFactsFor = vi.fn();
const store = {
  readMostRecentPendingActions: vi.fn(async () => []),
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
  readCommittedTurn,
  append,
  readScenarioRunAnalysisFactsFor,
  readRecentAppliedMutationFactsFor,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import scenarioGraphRoute from "../assist.v1.scenario-graph.js";

const GRAPH = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n2", label: "Commute time", kind: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Take the job" }],
};
const RUN_AT = "2026-10-07T20:00:00.000Z";
const runRow = { fact: { fact_type: "run_analysis", fact_version: 1, noop: false, result: { run_id: "run_b", graph_hash_at_run: "aaaa", computed_at: RUN_AT } }, fact_row_id: "r1", fact_created_at: RUN_AT };
const receipt = (nodeId: string, iso: string) => ({ fact: { fact_type: "set_factor_value", fact_version: 1, noop: false, result: { target_id: nodeId, status: "applied", before: { value: 1 }, after: { value: 2 } } }, fact_row_id: `f-${nodeId}`, fact_created_at: iso });

async function readGraph(body: Record<string, unknown>) {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  try {
    return await app.inject({ method: "POST", url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: body });
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  scenarioExists.mockResolvedValue(true);
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({ graph: GRAPH, briefText: "Should I take the job?" });
  readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [runRow], total_count: 1 });
  readRecentAppliedMutationFactsFor.mockResolvedValue([receipt("n2", "2026-10-07T20:05:00.000Z"), receipt("n1", "2026-10-07T19:55:00.000Z")]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("POST /assist/v1/scenarios/:id/graph — changed_since_run", () => {
  it("the reload read (with the conversation) carries the ids changed since the last Run, and only those", async () => {
    const res = await readGraph({ include_conversation_turns: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed_since_run).toEqual({
      version: 1, since_run_id: "run_b", node_ids: ["n2"], links: [], unattributed_changes: 0, complete: true,
    });
  });

  it("the Agent's internal read (no conversation) is unchanged: no key and no extra receipt query", async () => {
    const res = await readGraph({});
    expect(res.statusCode).toBe(200);
    expect("changed_since_run" in res.json()).toBe(false);
    expect(readRecentAppliedMutationFactsFor).not.toHaveBeenCalled();
  });

  it("a failed receipt read omits the key and the graph still stands", async () => {
    readRecentAppliedMutationFactsFor.mockRejectedValue(new Error("db down"));
    const res = await readGraph({ include_conversation_turns: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH);
    expect("changed_since_run" in res.json()).toBe(false);
  });
});
