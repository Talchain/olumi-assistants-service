/**
 * "Ask about this comparison" through the LIVE route (`comparison-answer.ts`; lease #85 5949274551). An ORDINARY typed turn
 * ("Why did the result change?"), the model stubbed, the graph read = a SERVED cold read (`fixtures/comparison`). The store
 * double reads rows back as the real store does (the `rerun-explanation.route` harness).
 *   · INPUT: the model's request carries the read's `comparison` block (what_changed = the plan's code line); none without
 *     a pair;
 *   · BACKSTOP: an unlicensed cause sentence never reaches the wire, a stored row or a replay; the code line is said instead;
 *   · CONTROL: on C1 + complete the same reply ships as written.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rerunPlanForGraph } from '../rerun-explanation.js';

type Read = { json: { graph: { nodes: { id: string; label: string }[] }; graph_hash: string; current_read: { run_delta?: { input_changes: { label_after?: string; link?: { from: string; to: string } }[] } } } };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/comparison/${name}.json`, import.meta.url), 'utf8')) as Read;
const C1_COMPLETE = read('c1-complete');
const C1_PARTIAL = read('c1-partial');
const NO_PAIR = read('stale-no-pair');
const planOf = (r: Read) => rerunPlanForGraph(r.json.current_read.run_delta, r.json.graph, false);
const SCENARIO = '3c9b1e2d-4f5a-4b6c-8d7e-9f0a1b2c3dc1';
const CLAIM = 'Your change to Trial profile abandonment rate caused the difference between the two runs.';
const WHY = 'The comparison now rests on that figure.';

type Row = Record<string, unknown>;
const rows: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const r = rows.find((x) => x.turn_id === id);
    return r === undefined ? null : { id: String(r.turn_id), request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null,
      user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] };
  }),
  append: vi.fn(async (row: Row) => { rows.push({ ...row }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served: Read = C1_PARTIAL;
let modelText = `${CLAIM} ${WHY}`;
const requests: string[] = [];

type Body = { assistant_text: string; _answer_shape?: unknown };

describe('"Ask about this comparison" on the live route: an ordinary answer says only what the shown pair licenses', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelText }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => served.json);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; requests.length = 0; served = C1_PARTIAL; modelText = `${CLAIM} ${WHY}`; });

  const ask = (turnId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: turnId, message: 'Why did the result change?' } });

  it('R2 (route): C1 on PARTIAL coverage → the cause is dropped from the wire, the stored rows and a replay; the code line is said', async () => {
    const t = randomUUID();
    const body = (await ask(t)).json() as Body;
    expect(requests.length, 'the model really answered').toBeGreaterThan(0);
    expect(requests.some((r) => r.includes(JSON.stringify(planOf(C1_PARTIAL)!.codeLine).slice(1, -1))), 'INPUT: the block reached the model').toBe(true);
    expect(body.assistant_text).toContain(WHY);
    expect(body.assistant_text).toContain(planOf(C1_PARTIAL)!.fallback);
    expect(body.assistant_text).not.toContain('caused the difference');
    expect(body._answer_shape, 'the host composed it → shipped whole').toBeUndefined();
    expect(rows.length, 'the control: rows were written').toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('caused the difference');
    const calls = requests.length;
    const replay = (await ask(t)).json() as Body;
    expect(requests.length, 'a replay calls no model').toBe(calls);
    expect(replay.assistant_text).toBe(body.assistant_text);
  });

  it('R1 CONTROL (route): C1 + complete licenses the cause → the reply ships as the model wrote it', async () => {
    served = C1_COMPLETE;
    const body = (await ask(randomUUID())).json() as Body;
    expect(body.assistant_text).toContain(`${CLAIM} ${WHY}`);
    expect(body.assistant_text).not.toContain(planOf(C1_COMPLETE)!.fallback);
  });

  it('R5 (route): a stale read with no pair → no block reaches the model, and the cause is still dropped (fail-closed)', async () => {
    served = NO_PAIR;
    const body = (await ask(randomUUID())).json() as Body;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((r) => r.includes('what_changed')), 'no comparison block').toBe(false);
    expect(body.assistant_text).toContain(WHY);
    expect(body.assistant_text).not.toContain('caused the difference');
  });
});
