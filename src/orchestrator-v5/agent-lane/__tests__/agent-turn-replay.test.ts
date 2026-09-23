/**
 * ⛔ THE WHOLE AGENT TURN IS ONE OPERATION, AND ITS IDENTITY IS THE CLIENT'S `turn_id`.
 *
 * Release Control, 23 Sep 2026 (olumi-programme-docs#63 5788656586): the
 * conversational `/agent/v1/turn` route read no `turn_id`, ran the model and
 * advanced the in-process history. So an exact lost-response retry was a FRESH
 * execution against a history the first attempt had already moved on — it took a
 * different next action and could write where the first had only proposed.
 *
 * The discriminators are RC's, in order. The store double classifies an append
 * the way `SupabaseSessionStore` does — same `(scenario_id, turn_id)` + same
 * `request_hash` is a replay, a different hash is a conflict — and the route
 * reads the committed row through `readCommittedTurn`, so a "restart" (a fresh
 * route module with fresh in-memory stores) is answered from the SAME durable
 * rows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number };
const rows = new Map<string, Row>();
let readFails = false;
let answerAppendFails = false;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => {
    if (readFails) throw new Error('read failed');
    return rows.get(turnId) ?? null;
  }),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
    if (answerAppendFails && w.turn_id.endsWith(':answer')) throw new Error('answer append failed');
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** The provider: every call is counted, and the Nth answer is "Answer N". */
const provider: { calls: number; userTurnsSeen: number[] } = { calls: 0, userTurnsSeen: [] };
const fakeFetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
  provider.calls += 1;
  const sent = JSON.parse(String(init?.body ?? '{}')) as { input?: { role?: string }[] };
  provider.userTurnsSeen.push((sent.input ?? []).filter((i) => i.role === 'user').length);
  const text = `Answer ${provider.calls}`;
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });
});

const SID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '0b8c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const T2 = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const T3 = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const textOf = (r: { json: () => unknown }) => String((r.json() as { assistant_text?: string }).assistant_text);

/** A FRESH route module each call — its HistoryStore/ProposalStore are new, as after a restart. */
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const mod = await import('../../../routes/agent-v1-turn.js');
  const { agentV1TurnRoute } = mod;
  // A request that loses the claim waits for the winner's answer — short here.
  mod.AGENT_TURN_CLAIM_WAIT.totalMs = 2_000;
  mod.AGENT_TURN_CLAIM_WAIT.everyMs = 20;
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h1' }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}
const say = (app: FastifyInstance, message: string, turnId?: string) =>
  app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message, ...(turnId ? { turn_id: turnId } : {}) } });
const agentOf = (r: { json: () => unknown }) => (r.json() as { _agent?: Record<string, unknown> })._agent ?? {};

describe('an Agent turn replays by its turn_id', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    rows.clear(); readFails = false; answerAppendFails = false; provider.calls = 0; provider.userTurnsSeen = [];
    store.append.mockClear(); store.readCommittedTurn.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED (1)+(2): a completed turn whose response was lost replays EXACTLY — 0 provider calls, 0 tool calls, 0 new turns', async () => {
    const first = await say(app, 'What should I consider?', T1);
    expect(first.statusCode).toBe(200);
    const firstText = String((first.json() as { assistant_text?: string }).assistant_text);
    expect(provider.calls).toBe(1);
    // One CLAIM row (the bare turn_id, taken before the run) + one ANSWER row.
    expect([...rows.keys()].sort()).toEqual([T1, `${T1}:answer`]);
    // (1) the response is "lost": nothing from it is carried forward.
    const retry = await say(app, 'What should I consider?', T1);
    expect(retry.statusCode).toBe(200);
    expect(String((retry.json() as { assistant_text?: string }).assistant_text)).toBe(firstText);
    expect(provider.calls, 'the retry must not call the model again').toBe(1);
    expect(agentOf(retry).tool_calls).toEqual([]);
    expect(agentOf(retry).replayed).toBe(true);
    expect(rows.size, 'no further turn row').toBe(2);
    expect(store.append, 'the retry claims nothing and writes nothing').toHaveBeenCalledTimes(2);
  });

  it('(3): the same turn_id with a CHANGED message refuses deterministically and runs nothing', async () => {
    await say(app, 'What should I consider?', T1);
    const reused = await say(app, 'Something else entirely', T1);
    expect(reused.statusCode).toBe(409);
    expect((reused.json() as { error?: string }).error).toBe('TURN_ID_REUSED');
    expect(provider.calls).toBe(1);
    expect(rows.size).toBe(2);
    expect(rows.get(`${T1}:answer`)?.user_message).toBe('What should I consider?');
  });

  it('(4): a RESTART between the attempt and the retry still replays — the answer comes from the durable row', async () => {
    const first = await say(app, 'What should I consider?', T1);
    const firstText = String((first.json() as { assistant_text?: string }).assistant_text);
    await app.close();
    app = await freshApp();
    const retry = await say(app, 'What should I consider?', T1);
    expect(retry.statusCode).toBe(200);
    expect(String((retry.json() as { assistant_text?: string }).assistant_text)).toBe(firstText);
    expect(provider.calls).toBe(1);
  });

  it('(5): a genuinely NEW turn id advances normally — and the replay did NOT advance the history', async () => {
    await say(app, 'What should I consider?', T1);
    await say(app, 'What should I consider?', T1); // replay
    const next = await say(app, 'And what about cost?', T2);
    expect(next.statusCode).toBe(200);
    expect(provider.calls).toBe(2);
    expect(rows.size).toBe(4);
    // The second model call saw ONE earlier user turn plus this one: the replay
    // added nothing to the conversation the model is given.
    expect(provider.userTurnsSeen).toEqual([1, 2]);
  });

  /**
   * ⛔ The reviewer's witnesses for #1720 at f616bc2a: a preflight READ let two
   * concurrent identical requests both run, and a turn whose answer row failed
   * to persist was re-run by its retry. The identity is now CLAIMED first.
   */
  it('RED (W1): two IDENTICAL requests released together → exactly ONE provider call, one history advance, and the SAME durable answer for both', async () => {
    const [a, b] = await Promise.all([say(app, 'What should I consider?', T3), say(app, 'What should I consider?', T3)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(provider.calls, 'only the request that won the claim may call the model').toBe(1);
    expect(textOf(a)).toBe(textOf(b));
    expect([...rows.keys()].sort()).toEqual([T3, `${T3}:answer`]);
    // One history advance: the next turn's model call sees ONE earlier user turn.
    await say(app, 'And what about cost?', T2);
    expect(provider.userTurnsSeen).toEqual([1, 2]);
  });

  it('RED (W2): the ANSWER could not be recorded → a retry on a FRESH instance runs NOTHING and says the outcome is unknown', async () => {
    answerAppendFails = true;
    const first = await say(app, 'What should I consider?', T3);
    expect(first.statusCode).toBe(200);
    expect(provider.calls).toBe(1);
    answerAppendFails = false;
    await app.close();
    app = await freshApp();
    const retry = await say(app, 'What should I consider?', T3);
    expect(retry.statusCode).toBe(409);
    expect((retry.json() as { error?: string }).error).toBe('TURN_OUTCOME_UNKNOWN');
    expect(provider.calls, 'the claim stands: the turn is never run twice').toBe(1);
    expect(rows.has(`${T3}:answer`)).toBe(false);
  });

  it('an unreadable prior-turn record refuses — it never re-runs a turn that may already have written', async () => {
    readFails = true;
    const r = await say(app, 'What should I consider?', T1);
    expect(r.statusCode).toBe(503);
    expect((r.json() as { error?: string }).error).toBe('TURN_STATE_UNVERIFIABLE');
    expect(provider.calls).toBe(0);
  });

  it('a malformed turn_id is refused before anything runs', async () => {
    const r = await say(app, 'What should I consider?', 'not-a-uuid');
    expect(r.statusCode).toBe(422);
    expect(provider.calls).toBe(0);
  });

  it('CONTRAST: with NO turn_id the route behaves exactly as before — every call runs, nothing is recorded', async () => {
    await say(app, 'What should I consider?');
    await say(app, 'What should I consider?');
    expect(provider.calls).toBe(2);
    expect(store.append).not.toHaveBeenCalled();
    expect(store.readCommittedTurn).not.toHaveBeenCalled();
  });
});
