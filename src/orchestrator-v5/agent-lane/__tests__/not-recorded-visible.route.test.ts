/**
 * Score run 2 hidden answers, deadline 13 (DL 12 Oct; PL 6127523574 b4; judge finding 34): "The tool did not recognise the
 * seven-month forecast in your wording, so nothing was recorded." was folded under More detail. THE PATH: the real Agent
 * route (harness of `history-sent-text.route.test.ts`, every fetch scripted locally), the model's reply = the served words
 * verbatim. A write this turn refused (typed `tool_calls`: a real local refusal, `withdraw_proposal` of an unknown proposal)
 * → the reply ships whole, so what was not recorded is seen. CONTROL: the same words with no refused write fold as served.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fx from '../reply/__tests__/fixtures/score-run2-hidden-answers.json';

type Item = Record<string, unknown>;
const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SCENARIO = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c';
const D13 = (fx.cases as unknown as Record<string, { user_message: string; assistant_text: string; served_shape: Record<string, unknown> }>).deadline_13!;
const NOT_RECORDED = 'The tool did not recognise the seven-month forecast in your wording, so nothing was recorded.';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Share of next feature launch done by 12 April 2027' }], edges: [] };
const messageItem = (text: string, id: string): Item => ({
  type: 'message', role: 'assistant', id, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }],
});
type Reply = { assistant_text: string; _answer_shape?: { detail?: string }; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] } };

let scripted: Item[][] = [];
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  vi.stubEnv('AGENT_LANE_ENABLED', 'true');
  vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: 'h1', analysis_state: { leader_claim: { permitted: false } } }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('a write this turn refused: the reply\'s not-recorded words are seen (deadline 13, served words)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    rows.clear(); scripted = [];
    vi.clearAllMocks();
    // ALL fetches are intercepted. No provider or Supabase connection is possible through this stub.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      expect(String(url)).toMatch(/\/v1\/responses$/);
      const output = scripted.shift();
      expect(output, 'every model response is scripted locally').toBeDefined();
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    app = await freshApp();
  });
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const say = async (): Promise<Reply> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: D13.user_message, turn_id: randomUUID() } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Reply;
  };

  it('RED on C a11bc90f: with a refused write, "… so nothing was recorded." ships on the face (the reply whole)', async () => {
    const call = { type: 'function_call', id: 'fc_w', call_id: 'c_w', name: 'withdraw_proposal', arguments: JSON.stringify({ proposal_id: 'not_proposed_this_turn' }) };
    scripted.push([{ type: 'reasoning', id: 'rs_w', summary: [] }, call], [messageItem(D13.assistant_text, 'msg_d13')]);
    const reply = await say();
    expect(reply._agent.tool_calls.map((c) => [c.name, c.ok, c.refusal]), 'its reason: the write refused').toEqual([['withdraw_proposal', false, 'not_proposed_this_turn']]);
    expect(reply.assistant_text).toContain(NOT_RECORDED);
    expect(reply._answer_shape, 'nothing folds under More detail').toBeUndefined();
  });
  it('CONTROL: the same served words with no refused write fold as served', async () => {
    scripted.push([messageItem(D13.assistant_text, 'msg_d13')]);
    const reply = await say();
    expect(reply._agent.tool_calls).toEqual([]);
    expect(reply._answer_shape).toEqual(D13.served_shape);
  });
});
