/**
 * ⭐ THE ROUTE HANDS THE READ'S LIMIT ROWS TO THE WIRE GATE (companion to `no-leader-sentence-reads-limit-rows.test.ts`).
 *
 * The real `/agent/v1/turn` route, a fake graph read answering with served run 1's state (CEE 651a7fd, journey C C10:
 * leader withheld on `constraint_verdict_withheld`, both limits `estimate_only` on Olumi's estimates) and its
 * `analysis_result` block, and a model reply that ranks. The ranking is dropped and the appended sentence says the
 * limits were checked on Olumi's estimates — only if the route passes the SAME read's rows to the gate.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const RUN1 = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-071622Z-1-no-leader-sentence.json', import.meta.url), 'utf8')) as {
  analysis_ready: unknown; analysis_state: unknown; limit_verdicts: unknown; blocks: Array<{ type?: string }>; graph: unknown;
};
const RESULT = RUN1.blocks.find((b) => b.type === 'analysis_result');
const SCENARIO = '7c1f8e3b-4d5a-4f6b-8c9d-0e1f2a3b4c5e';
const RANKING = 'Features and Pro price rise leads the comparison at 41%.';

let readPayload: Record<string, unknown> = {};
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('the route passes the read’s limit rows to the no-leader sentence', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = [{ type: 'message', content: [{ type: 'output_text', text: `${RANKING} Both limits were checked only against Olumi estimates.` }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => readPayload);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    readPayload = { graph: RUN1.graph, graph_hash: 'a'.repeat(64), analysis_ready: RUN1.analysis_ready, analysis_state: RUN1.analysis_state, analysis_result: RESULT };
  });

  const turn = async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Which option should I pick?' } });
    expect(r.statusCode).toBe(200);
    return r.json() as { assistant_text: string; limit_verdicts?: unknown };
  };

  it('RED: the read carries the rows → the ranking is dropped and the sentence says the limits were checked on Olumi’s estimates', async () => {
    readPayload = { ...readPayload, analysis_limit_verdicts: RUN1.limit_verdicts };
    const body = await turn();
    expect(body.limit_verdicts, 'control: the read’s rows reached the turn').toEqual(RUN1.limit_verdicts);
    expect(body.assistant_text).not.toContain(RANKING);
    expect(body.assistant_text).toContain('your limits were checked only against Olumi’s estimates');
    expect(body.assistant_text).not.toContain('before it can be checked');
    // MG's producer asks about both served limits on this graph, so the reply asks in MG's words, never a second time here.
    const { limitAskIdsOf } = await import('../limit-checks.js');
    expect([...limitAskIdsOf(RUN1.graph)].length, 'precondition: MG asks on this graph').toBeGreaterThan(0);
    expect(body.assistant_text).not.toContain('give me a real figure you know');
  });

  it('CONTRAST: the read carries no rows → the default sentence, unchanged', async () => {
    const body = await turn();
    expect(body.assistant_text).not.toContain(RANKING);
    expect(body.assistant_text).toContain('ask me what the limit needs before it can be checked');
  });
});
