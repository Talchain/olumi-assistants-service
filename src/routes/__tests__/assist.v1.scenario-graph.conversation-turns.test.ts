import { installOwnershipHarness } from "../../../tests/utils/ownership-route-harness.js";
/**
 * ⭐ "THE CHAT SURVIVES A RELOAD" — THE CEE READ (DL lease #75 5907582591; Canvas boundary 5907308286; AIQ 5907360564).
 *
 * CEE wrote every turn's text to `v5_conversation_turns` and served no read of it: a fresh browser or a second device
 * opened on an empty chat. The scenario-graph read now returns the turns WHEN ASKED (`include_conversation_turns: true`),
 * oldest first, capped, text only, behind the route's own identity → existence → ownership ladder. Unasked, the body is
 * byte-identical and no query runs (the Agent reads this route on every turn).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const ABSENT_SCENARIO = "11111111-2222-3333-4444-555555555555";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

// `vi.hoisted` because `vi.mock` factories are lifted above ordinary consts,
// and this route's import chain (route-v2-preflight → build-turn-context)
// reads `config` at module-init time — early enough to lose the race.
//
// The mock SPREADS THE REAL CONFIG rather than hand-listing the sections this
// suite happens to touch: a `vi.mock` factory REPLACES the module, so a
// hand-listed stub silently drops every config key added since it was written
// (CLAUDE.md trap 12 — the flags-mock allowlist defect, verbatim). Only
// `requireUserJwt` is pinned, because it is the one field whose value this
// suite is actually asserting about.
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

const { estimateAnalysis } = vi.hoisted(() => ({ estimateAnalysis: { value: null as unknown } }));
vi.mock("../scenario-graph-analysis-read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scenario-graph-analysis-read.js")>();
  return {
    ...actual,
    readScenarioAnalysis: (...args: Parameters<typeof actual.readScenarioAnalysis>) =>
      estimateAnalysis.value === null ? actual.readScenarioAnalysis(...args) : Promise.resolve(estimateAnalysis.value),
  };
});

// ── The store double ────────────────────────────────────────────────────────
// `ensureScenarioExists` is the UPSERT. It is a spy here so the suite can
// assert not just the RESPONSE but whether the row-creating call was reached
// at all — the difference between "answers 404" and "answers 404 without
// having created the scenario first", which is the whole of pin (1).
const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();

const readRecent = vi.fn();
const readCommittedTurn = vi.fn(async (_s: string, _t: string): Promise<{ run_narration: { status: string; run_key: string } | null } | null> => null);
const store = {
  readCommittedTurn,
  readMostRecentPendingActions: async () => [],
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

/**
 * IDENTITY IS NOW CARRIED BY THE VERIFIED TOKEN SUBJECT, NOT BY THE BODY.
 *
 * These cases previously established ownership by putting `user_id` in the
 * request body. That is no longer an ownership input on this route, so the
 * carrier changes and every assertion stays.
 *
 * ⚠ THE OVERRIDES BELOW ARE LOAD-BEARING, NOT TIDINESS. Without them the
 * cross-user refusal cases would still PASS — because an unverified caller is
 * refused whatever id they name — and would therefore have stopped
 * discriminating between "someone else's scenario" and "no identity at all".
 * A guard that passes for a reason unrelated to what it names is the failure
 * mode these positive controls exist to prevent, so each cross-user case now
 * states the OTHER user as a VERIFIED subject.
 *
 * `importOriginal` spread, never a hand-listed factory: a factory REPLACES the
 * module and every other export in the pre-flight import chain would silently
 * vanish.
 */
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import scenarioGraphRoute, { AGENT_ANSWER_REQUEST_HASH_PREFIX, CONVERSATION_ROWS_READ, CONVERSATION_TURNS_CAP } from "../assist.v1.scenario-graph.js";

/** A graph with no positional keys anywhere — the shape `scenarios.graph` holds today. */
const GRAPH_NO_LAYOUT = {
  nodes: [
    { id: "n1", label: "Take the job", category: "option" },
    { id: "n2", label: "Commute time", category: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Take the job" }],
};


async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await installOwnershipHarness(app, () => resolveUserIdentity());
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

// `await`ed inside on purpose: an un-awaited `app.inject()` is Light-my-Request's
// chainable builder, not a response, and returning it would type every caller's
// `.statusCode` / `.json()` as an error the BUILD gate cannot see (it excludes
// tests — CLAUDE.md trap 2's refinement; `Typecheck Drift` is what catches it).
async function read(
  app: FastifyInstance,
  scenarioId: string,
  body: Record<string, unknown> = {},
) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${scenarioId}/graph`,
    payload: body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  estimateAnalysis.value = null;
  // Default posture: the scenario exists, is UNOWNED (guest), and holds a graph.
  scenarioExists.mockResolvedValue(true);
  // The signed-in owner is the default caller. Cases about a DIFFERENT user
  // override this explicitly — see the note on the mock.
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
    getScenarioOwner.mockResolvedValue(null);
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({
    graph: GRAPH_NO_LAYOUT,
    briefText: "Should I take the job?",
  });
});


// Each row here is one of the Agent route's answer rows, so it carries that route's request hash (`agent_turn:`).
const row = (n: number, user: string | null, assistant: string | null) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, scenario_id: SCENARIO, user_id: null,
  turn_id: `turn-${n}`, handler_id: null, created_at: `2026-09-30T08:0${n}:00.000Z`,
  request_hash: `agent_turn:${String(n).repeat(64).slice(0, 64)}`,
  user_message: user, assistant_message: assistant,
});
// `readRecent` answers NEWEST first (supabase-store.ts `order('created_at', { ascending: false })`).
const NEWEST_FIRST = [
  row(3, "Run the analysis.", "No single option can be put forward yet, because how far apart the options are was not established on this run."),
  row(2, null, null),
  row(1, "Should we switch to GCP?", "I've mapped the decision."),
];

beforeEach(() => { readRecent.mockResolvedValue(NEWEST_FIRST); });

describe("the conversation, when asked", () => {
  it.each([true, false])("r12 reload: replaces a licensed estimate point with or without a scored-goal snapshot (%s), preserving risk bytes", async scored => {
    const graph = { nodes: [
      { id: "raise", kind: "option", label: "Raise to £59" },
      { id: "keep", kind: "option", label: "Keep at £49" },
      { id: "revenue", kind: "goal", label: "Revenue goal" },
    ], edges: [] };
    // Historical labels may come from the graph; a legacy licence binds its named option and exact value itself.
    const result = { type: "analysis_result", computed_against_hash: "0123456789abcdef", ...(scored ? { input_snapshot: { goal_node_id: "revenue" } } : {}),
      enrichment: { inference_warnings: [{
      code: "GOAL_CHANCE_LICENSED", form: "each", option_ids: ["raise", "keep"],
      pct_by_option: { raise: 67, keep: 30 }, olumi_estimate_link_count: 1,
      target: { comparator: "at_least", value: 1000, unit: "£" },
    }] } };
    const state = { run_state: { kind: "complete_current", computed_at: "2026-09-30T08:00:30.000Z" }, leader_claim: { permitted: true } };
    estimateAnalysis.value = {
      analysis_state: state,
      analysis_result: result, current_read: { analysis_ready: { status: "ready", may_run: true }, result },
      analysis_constraint_verdict_state: null,
    };
    loadGraphAndBriefText.mockResolvedValue({ graph, briefText: "Improve revenue." });
    // AMENDED (reload Run identity, 14 Oct): a reloaded answer is re-gated against the current Run only when the narration
    // stored WITH it names that Run. This row narrates the current Run (its 67%), so it is stored with that Run's narration.
    const { runExplanationKeyForRecord } = await import("../../orchestrator-v5/agent-lane/run-explanation.js");
    const runKey = runExplanationKeyForRecord(SCENARIO, state, result);
    expect(runKey).toMatch(/^[0-9a-f]{16}$/);
    readCommittedTurn.mockResolvedValue({ run_narration: { status: "ready", run_key: runKey! } });
    const bare = "‘Raise to £59’: about 67% in this model.";
    const preserved = "The chance of supplier failure is 10%.\n\tSupplier delivery has about 67% probability.  Keep this spacing.";
    const labelled = "‘Raise to £59’: about 67% chance of meeting your goal, in this model, using Olumi's estimates for 1 relationship (see Check estimates).";
    readRecent.mockResolvedValue([row(1, "What was the recorded chance?", `${bare}\n${preserved}\n${labelled}`)]);
    const app = await buildApp();
    const response = await read(app, SCENARIO, { include_conversation_turns: true });
    expect(response.statusCode).toBe(200);
    const text = response.json().conversation_turns[0].assistant_message as string;
    expect(text).not.toContain(bare);
    expect(text).toContain(labelled);
    expect(text.split(labelled).length - 1).toBe(1);
    expect(text).toContain(preserved);
    await app.close();
  });

  it("RED: include_conversation_turns → the turns oldest first, text only, capped at 50, as stored", async () => {
    const app = await buildApp();
    const res = await read(app, SCENARIO, { include_conversation_turns: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(readRecent).toHaveBeenCalledWith(SCENARIO, CONVERSATION_ROWS_READ);
    expect(CONVERSATION_TURNS_CAP).toBe(50);
    expect(body.conversation_turns).toEqual([
      { turn_id: "turn-1", created_at: "2026-09-30T08:01:00.000Z", user_message: "Should we switch to GCP?", assistant_message: "I've mapped the decision." },
      { turn_id: "turn-3", created_at: "2026-09-30T08:03:00.000Z", user_message: "Run the analysis.",
        assistant_message: "No single option can be put forward yet, because how far apart the options are was not established on this run." },
    ]);
    // Text only: no row id, user id or handler travels.
    for (const t of body.conversation_turns) expect(Object.keys(t).sort()).toEqual(["assistant_message", "created_at", "turn_id", "user_message"]);
    // The graph read itself is unchanged beside it.
    expect(body.graph).toEqual(GRAPH_NO_LAYOUT);
    await app.close();
  });

  it("AIQ row: a reply whose ranking the wire dropped is served exactly as stored (the post-drop text), never re-derived", async () => {
    const postDrop = "The run finished.\n\nNo single option can be put forward yet, because Olumi has not read your goal as the product of your own figures, so its figures cannot yet support a comparison.";
    readRecent.mockResolvedValue([row(1, "Run the analysis.", postDrop)]);
    const app = await buildApp();
    const body = (await read(app, SCENARIO, { include_conversation_turns: true })).json();
    expect(body.conversation_turns[0].assistant_message).toBe(postDrop);
    await app.close();
  });

  // The analysis leg already reads the hot window through `readRecent` (default 20) on every graph read; the conversation
  // is ONE further read, at its own cap, and only when asked.
  const conversationReads = () => readRecent.mock.calls.filter((c) => c[1] === CONVERSATION_ROWS_READ).length;

  it("CONTROL (unasked): no conversation_turns key and no conversation read — every existing caller is unchanged", async () => {
    const app = await buildApp();
    const body = (await read(app, SCENARIO)).json();
    expect(body).not.toHaveProperty("conversation_turns");
    expect(conversationReads()).toBe(0);
    const truthy = (await read(app, SCENARIO, { include_conversation_turns: "yes" })).json();
    expect(truthy).not.toHaveProperty("conversation_turns");
    expect(conversationReads()).toBe(0);
    await read(app, SCENARIO, { include_conversation_turns: true });
    expect(conversationReads()).toBe(1);
    await app.close();
  });

  it("CONTROL (not yours): the same refusal as any read, and the conversation is never read", async () => {
    resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OTHER_USER });
    getScenarioOwner.mockResolvedValue(OWNER);
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    getScenarioOwner.mockResolvedValue(OWNER);
    const app = await buildApp();
    const res = await read(app, SCENARIO, { include_conversation_turns: true });
    expect(res.statusCode).not.toBe(200);
    expect(res.json()).not.toHaveProperty("conversation_turns");
    expect(readRecent).not.toHaveBeenCalled();
    await app.close();
  });

  it("CONTROL (absent scenario): refused before any read, the conversation included", async () => {
    scenarioExists.mockResolvedValue(false);
    const app = await buildApp();
    const res = await read(app, ABSENT_SCENARIO, { include_conversation_turns: true });
    expect(res.statusCode).not.toBe(200);
    expect(readRecent).not.toHaveBeenCalled();
    await app.close();
  });

  it("a failed conversation read answers null (did not answer), and the graph read stands", async () => {
    readRecent.mockRejectedValue(new Error("db down"));
    const app = await buildApp();
    const res = await read(app, SCENARIO, { include_conversation_turns: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversation_turns).toBeNull();
    expect(body.graph).toEqual(GRAPH_NO_LAYOUT);
    await app.close();
  });
});

/**
 * ⛔ ONLY WHAT THE USER SAW (Canvas #75 5910906799; MG 5910983526; DL 5911089211; AIQ 5911161828). The served rows of MRR
 * `3b6369b0`, 01:42:37–01:44:29Z, exactly as stored except for shortened texts: every Agent turn is a claim row, the
 * Agent's internal sub-turns (the turn executor's `sha256:` rows) and the Agent's answer row (`agent_turn:`).
 */
describe("the restore returns only the Agent's answer rows — what the user saw", () => {
  const served = (t: string, turnId: string, cls: string, handler: string | null, hash: string, um: string | null, am: string | null) => ({
    id: `row-${turnId}`, scenario_id: SCENARIO, user_id: null, turn_id: turnId, turn_class: cls, handler_id: handler,
    request_hash: hash, created_at: `2026-09-30T${t}.000Z`, user_message: um, assistant_message: am,
  });
  const A = (x: string) => `agent_turn:${x.repeat(64).slice(0, 64)}`;
  const S = (x: string) => `sha256:${x.repeat(32).slice(0, 32)}`;
  const OLDEST_FIRST = [
    served("01:42:37", "a096:claim", "direct_answer", null, A("7"), null, null),
    served("01:43:05", "graph_registration:4072", "direct_answer", null, "graph_registration:fefa3", null, null),
    served("01:43:14", "8f22e3d6", "handler", "run_analysis", S("9"), null, "I ran a first analysis on the model I have just drafted."),
    served("01:43:24", "a096", "direct_answer", null, A("7"), "Should we raise our Pro plan price from £49 to £59 a month?", "I’ve drafted a provisional model, but it cannot yet be analysed."),
    served("01:43:40", "e3d5:claim", "direct_answer", null, A("5"), null, null),
    served("01:43:41", "085f9d61", "direct_answer", null, S("2"), null, "Recorded as yours: “MRR” is “Pro plan monthly price” × “Paying subscribers”."),
    served("01:43:43", "e3d5", "direct_answer", null, A("5"), "Yes — Is “MRR” your “Pro plan monthly price” × “Paying subscribers”?", "Recorded, as you confirmed."),
    served("01:43:53", "745a:claim", "direct_answer", null, A("b"), null, null),
    served("01:44:03", "0899b727", "handler", "run_analysis", S("4"), "The user asked to run the analysis after confirming how MRR is calculated.", "Raise price to £59 scored highest in 100% of runs."),
    served("01:44:10", "745a", "direct_answer", null, A("b"), "Run the analysis", "On the current model, raising Pro price to £59 does best."),
  ];

  it("RED: the served MRR thread restores the user's three turns and the Agent's three answers — no sub-turn row, no unseen text", async () => {
    readRecent.mockResolvedValue([...OLDEST_FIRST].reverse());
    const app = await buildApp();
    const body = (await read(app, SCENARIO, { include_conversation_turns: true })).json();
    expect(body.conversation_turns.map((t: { turn_id: string }) => t.turn_id)).toEqual(["a096", "e3d5", "745a"]);
    const restored = JSON.stringify(body.conversation_turns);
    expect(restored).not.toContain("The user asked to run the analysis");
    expect(restored).not.toContain("100% of runs");
    expect(restored).not.toContain("I ran a first analysis");
    expect(restored).not.toContain("Recorded as yours");
    expect(body.conversation_turns[2]).toEqual({ turn_id: "745a", created_at: "2026-09-30T01:44:10.000Z", user_message: "Run the analysis", assistant_message: "On the current model, raising Pro price to £59 does best." });
    await app.close();
  });

  it("a row with no request hash, or any other hash, is not restored (fails closed)", async () => {
    const { request_hash: _h, ...noHash } = row(1, "Should we switch to GCP?", "I've mapped the decision.");
    readRecent.mockResolvedValue([noHash, { ...row(2, "typed", "reply"), request_hash: "sha256:abc" }]);
    const app = await buildApp();
    expect((await read(app, SCENARIO, { include_conversation_turns: true })).json().conversation_turns).toEqual([]);
    await app.close();
  });

  it("the cap counts AFTER the drop: 60 Agent turns (claim + sub-turn + answer each) restore the newest 50 answers", async () => {
    const many = Array.from({ length: 60 }, (_, i) => {
      const n = String(i).padStart(2, "0");
      return [
        served(`02:${n}:00`, `t${n}:claim`, "direct_answer", null, A("c"), null, null),
        served(`02:${n}:01`, `sub${n}`, "handler", "run_analysis", S("d"), "the user pressed Run", "sub text"),
        served(`02:${n}:02`, `t${n}`, "direct_answer", null, A("c"), `user ${n}`, `reply ${n}`),
      ];
    }).flat();
    expect(CONVERSATION_ROWS_READ).toBeGreaterThanOrEqual(many.length);
    readRecent.mockResolvedValue([...many].reverse());
    const app = await buildApp();
    const turns = (await read(app, SCENARIO, { include_conversation_turns: true })).json().conversation_turns;
    expect(turns).toHaveLength(CONVERSATION_TURNS_CAP);
    expect(turns[0].turn_id).toBe("t10");
    expect(turns[49].turn_id).toBe("t59");
    expect(JSON.stringify(turns)).not.toContain("the user pressed Run");
    await app.close();
  });

  it("DRIFT PIN: the prefix is the one the Agent route writes on its answer rows", () => {
    const src = readFileSync(new URL("../agent-v1-turn.ts", import.meta.url), "utf8");
    expect(src).toContain(`return \`${AGENT_ANSWER_REQUEST_HASH_PREFIX}\${digest}\`;`);
  });
});

vi.mock('../../utils/supabase-user-jwt.js', async () => ({
  looksLikeJwt: () => true,
  verifySupabaseUserJwt: (await import('../../../tests/utils/ownership-route-harness.js')).verifyFixtureIdentity,
}));

/**
 * ⛔ AN EARLIER ANSWER NEVER ACQUIRES A NEWER RUN'S WORDS (capacity witness, staging 351eeda0, 14 Oct; judge row 6).
 * After a second Run, the reload rewrote the first Run's "about 37%" as the second Run's "about 64%": the egress gate ran
 * every stored answer against the CURRENT Run. The corpus is the witness's own: each row's bytes come from the read where
 * its own Run was current, proven equal to the stored row by md5 (`_source`), with the run_narration stored beside it.
 */
describe("the reload keeps each answer's own Run's words", () => {
  const FX = JSON.parse(readFileSync("tests/fixtures/reload-run-identity/capacity-post2996-20261014.json", "utf8")) as Record<string, any>;
  const SID: string = FX.scenario_id;
  const rows = (FX.rows as Record<string, any>[]).map((r, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, scenario_id: SID,
    user_id: null, handler_id: null, turn_id: r.turn_id, created_at: r.created_at, request_hash: r.request_hash,
    user_message: r.user_message, assistant_message: r.assistant_message }));
  const stored = (id: string): string => (FX.rows as Record<string, any>[]).find(r => r.turn_id === id)!.assistant_message;
  const RUN1 = "a3e3933c-47c5-4eda-9779-a471dd170bc5", RUN2 = "8ac9acfa-e312-425b-850e-47f8d1540bf1", BUILT = "3db16588-be9b-4257-9157-323bf2797ddd";
  const reloadOnRun2 = async (storedRows = rows) => {
    estimateAnalysis.value = { ...FX.run2, analysis_constraint_verdict_state: null };
    scenarioExists.mockResolvedValue(true);
    loadGraphAndBriefText.mockResolvedValue({ graph: FX.run2.graph, briefText: "capacity" });
    readRecent.mockResolvedValue([...storedRows].reverse());
    readCommittedTurn.mockImplementation(async (_s: string, t: string) =>
      ({ run_narration: (FX.rows as Record<string, any>[]).find(r => r.turn_id === t)?.run_narration ?? null }));
    const app = await buildApp();
    const res = await read(app, SID, { include_conversation_turns: true });
    await app.close();
    expect(res.statusCode).toBe(200);
    return new Map((res.json().conversation_turns as { turn_id: string; assistant_message: string }[]).map(t => [t.turn_id, t.assistant_message]));
  };

  it("precondition: the current Run's key is the one the writer stored with Run 2's answer, and Run 1's differs", async () => {
    const { runExplanationKeyForRecord } = await import("../../orchestrator-v5/agent-lane/run-explanation.js");
    expect(runExplanationKeyForRecord(SID, FX.run2.analysis_state, FX.run2.analysis_result)).toBe("7be47e1859051a85");
    expect(runExplanationKeyForRecord(SID, FX.run1.analysis_state, FX.run1.analysis_result)).toBe("4748ec658ba3d702");
    // Served (the defect): both older answers came back in Run 2's words.
    for (const id of [BUILT, RUN1]) {
      expect(FX.served_reload_after_run2[id]).not.toBe(stored(id));
      expect(stored(id)).toContain("about 37% chance of meeting your goal");
      expect(FX.served_reload_after_run2[id]).toContain("about 64% chance of meeting your goal");
    }
  });

  it("after Run 2, every earlier answer reloads byte for byte as stored; Run 2's own answer too", async () => {
    const shown = await reloadOnRun2();
    expect([...shown.keys()]).toEqual([BUILT, RUN1, RUN2]);
    for (const id of [BUILT, RUN1, RUN2]) expect(shown.get(id)).toBe(stored(id));
  });

  it("an old answer's stored text was already egress-gated for its own Run when written: re-gating it there changes nothing", async () => {
    const { withEstimateGoalPointsAtEgress } = await import("../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js");
    const userAuthoredTexts = (FX.rows as Record<string, any>[]).map(r => r.user_message as string);
    for (const [id, run] of [[RUN1, FX.run1], [RUN2, FX.run2]] as const) {
      expect(withEstimateGoalPointsAtEgress({ assistant_text: stored(id) }, { analysisResult: run.analysis_result, graph: run.graph,
        current: true, userAuthoredTexts }).assistant_text).toBe(stored(id));
    }
  });

  it("an answer stored WITH the current Run's narration is still re-gated against it: a wrong figure there is corrected", async () => {
    const wrong = stored(RUN2).replace("about 64% chance of meeting your goal", "about 50% chance of meeting your goal");
    expect(wrong).not.toBe(stored(RUN2));
    const shown = await reloadOnRun2(rows.map(r => r.turn_id === RUN2 ? { ...r, assistant_message: wrong } : r));
    expect(shown.get(RUN2)).toContain("about 64% chance of meeting your goal");
    expect(shown.get(RUN2)).not.toContain("about 50%");
    expect(shown.get(RUN1)).toBe(stored(RUN1));
  });
});
