/**
 * AI HARNESS PR-L1 — a REPLAY is an exit too. A committed answer row written before the final egress existed (or under
 * a licence that has since changed) is replayed with no model call; its words are re-checked against TODAY's licence on
 * the same readback, so a lost-response retry cannot ship a withheld leader around the backstop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
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

const provider = { calls: 0, text: 'A fresh answer.' };
const fakeFetch = vi.fn(async () => {
  provider.calls += 1;
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: provider.text }] }] }), { status: 200 });
});

const SID = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '3c8c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const MESSAGE = 'Which option should I pick?';
const LEADER_PROSE = 'AI Reporting Sprint currently performs best, leading in 46% of simulations.';
const GRAPH = { nodes: [
  { id: 'goal', kind: 'goal', label: 'Quarterly revenue' },
  { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' },
  { id: 'signup_fix_sprint', kind: 'option', label: 'Signup Fix Sprint' },
], edges: [] };

let leaderPermitted = false;
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({
    graph: GRAPH,
    graph_hash: 'h1',
    analysis_state: { leader_claim: leaderPermitted ? { permitted: true } : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
  }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('a replayed Agent turn passes the final leader egress', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    rows.clear(); provider.calls = 0; provider.text = 'A fresh answer.'; leaderPermitted = false;
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
    const { agentTurnRequestHash } = await import('../../../routes/agent-v1-turn.js');
    rows.set(T1, { id: 'row-1', turn_id: T1, request_hash: agentTurnRequestHash(SID, null, MESSAGE), assistant_message: LEADER_PROSE, user_message: MESSAGE, llm_calls_used: 1 });
  }, 60_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const retry = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: MESSAGE, turn_id: T1 } });

  it('RED: a stored leader claim is edited on replay when today\'s licence withholds it — and no model is called', async () => {
    const r = await retry();
    expect(r.statusCode).toBe(200);
    const body = r.json() as { assistant_text?: string; _agent?: { replayed?: boolean } };
    expect(body._agent?.replayed).toBe(true);
    expect(provider.calls).toBe(0);
    expect(body.assistant_text).not.toContain('AI Reporting Sprint currently performs best');
  });

  it('RED (DL 5932495794 item 3): a licence NEWLY withheld after the answer was written edits the replay — the stored words came from a live permitted turn', async () => {
    // Turn 1 runs live under a PERMITTED licence: the model names the leader and the answer row stores those words.
    const T2 = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
    await app.close();
    leaderPermitted = true;
    provider.text = LEADER_PROSE;
    app = await freshApp();
    const live = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: MESSAGE, turn_id: T2 } });
    expect(live.statusCode).toBe(200);
    expect((live.json() as { assistant_text?: string }).assistant_text).toBe(LEADER_PROSE);
    expect(rows.get(T2)?.assistant_message).toBe(LEADER_PROSE);
    const callsAfterLive = provider.calls;
    expect(callsAfterLive).toBeGreaterThan(0);
    // The licence is then withheld (a later Run, a new limit). A lost-response retry of turn 1 replays the stored row.
    await app.close();
    leaderPermitted = false;
    app = await freshApp();
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: MESSAGE, turn_id: T2 } });
    expect(replay.statusCode).toBe(200);
    const body = replay.json() as { assistant_text?: string; _agent?: { replayed?: boolean } };
    expect(body._agent?.replayed).toBe(true);
    expect(provider.calls, 'a replay calls no model').toBe(callsAfterLive);
    expect(body.assistant_text).not.toContain('AI Reporting Sprint currently performs best');
  });

  it('CONTROL: when today\'s licence permits it, the replay returns the stored words exactly', async () => {
    await app.close();
    leaderPermitted = true;
    app = await freshApp();
    const r = await retry();
    expect(r.statusCode).toBe(200);
    expect((r.json() as { assistant_text?: string }).assistant_text).toBe(LEADER_PROSE);
    expect(provider.calls).toBe(0);
  });
});
