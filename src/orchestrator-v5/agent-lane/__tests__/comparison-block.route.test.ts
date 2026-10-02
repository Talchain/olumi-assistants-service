/**
 * "Ask about this comparison", the input half, through the LIVE route (`comparison-block.ts`; lease #85 5949274551). An
 * ORDINARY typed turn ("Why did the result change?"), the model stubbed, the graph read = a SERVED cold read
 * (`fixtures/comparison`). What the model is sent is the proof: the read's pair reaches it as ONE `comparison` block in the
 * CURRENT MODEL STATE, in Olumi's own code line; a read with no pair sends none.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rerunPlanForGraph } from '../rerun-explanation.js';

type Read = { json: { graph: { nodes: unknown[] }; current_read: { run_delta?: unknown } } };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/comparison/${name}.json`, import.meta.url), 'utf8')) as Read;
const C2_PARTIAL = read('c2-partial');
const NO_PAIR = read('stale-no-pair');
const SCENARIO = '3c9b1e2d-4f5a-4b6c-8d7e-9f0a1b2c3dc2';

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

/** Every string anywhere in a decoded request (the state item is JSON text inside an input item). */
const textsOf = (v: unknown): string[] => typeof v === 'string' ? [v]
  : Array.isArray(v) ? v.flatMap(textsOf) : v !== null && typeof v === 'object' ? Object.values(v).flatMap(textsOf) : [];

let served: Read = C2_PARTIAL;
const requests: string[] = [];

describe('"Ask about this comparison" on the live route: the model is sent the read\'s pair', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The comparison rests on that change.' }] }] }), { status: 200 });
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
  beforeEach(() => { rows.length = 0; requests.length = 0; served = C2_PARTIAL; });

  const ask = () => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Why did the result change?' } });

  it('IDENTITY: the model\'s request carries the comparison block with the plan\'s own code line', async () => {
    const res = await ask();
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(requests.length, 'the model really answered').toBeGreaterThan(0);
    const codeLine = rerunPlanForGraph(C2_PARTIAL.json.current_read.run_delta, C2_PARTIAL.json.graph, false)!.codeLine;
    expect(codeLine, 'the control: the served pair names its change').toContain('Split Sprint Capacity');
    // The state item travels as JSON text inside the request: decode it, then read the block by its own fields.
    const decoded = textsOf(JSON.parse(requests[0]!)).join('\n');
    expect(decoded).toContain(JSON.stringify({ what_changed: codeLine, cause_licensed: false }).slice(1, -1));
  });

  it('CONTROL: a stale read with no pair sends no comparison block', async () => {
    served = NO_PAIR;
    const res = await ask();
    expect(res.statusCode).toBe(200);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((r) => r.includes('what_changed')), 'no comparison block').toBe(false);
  });
});
