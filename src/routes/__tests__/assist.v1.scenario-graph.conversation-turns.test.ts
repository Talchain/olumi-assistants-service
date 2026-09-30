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
const store = {
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

import scenarioGraphRoute, { CONVERSATION_TURNS_CAP } from "../assist.v1.scenario-graph.js";

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
  // Default posture: the scenario exists, is UNOWNED (guest), and holds a graph.
  scenarioExists.mockResolvedValue(true);
  // The signed-in owner is the default caller. Cases about a DIFFERENT user
  // override this explicitly — see the note on the mock.
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({
    graph: GRAPH_NO_LAYOUT,
    briefText: "Should I take the job?",
  });
});


const row = (n: number, user: string | null, assistant: string | null) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, scenario_id: SCENARIO, user_id: null,
  turn_id: `turn-${n}`, handler_id: null, created_at: `2026-09-30T08:0${n}:00.000Z`,
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
  it("RED: include_conversation_turns → the turns oldest first, text only, capped at 50, as stored", async () => {
    const app = await buildApp();
    const res = await read(app, SCENARIO, { include_conversation_turns: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(readRecent).toHaveBeenCalledWith(SCENARIO, CONVERSATION_TURNS_CAP);
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
  const conversationReads = () => readRecent.mock.calls.filter((c) => c[1] === CONVERSATION_TURNS_CAP).length;

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
