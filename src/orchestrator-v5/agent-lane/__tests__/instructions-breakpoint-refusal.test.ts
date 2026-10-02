/**
 * T1 (b) — A PROVIDER THAT REFUSES THE INSTRUCTIONS CACHE BREAKPOINT NEVER FAILS A TURN. A 400 whose `error.param` names
 * `prompt_cache_breakpoint` gets the SAME request with top-level `instructions` (today's carrier) exactly once, and every
 * later converse call goes plain. Any other 400, a 429 or a 5xx is never resent by this path (budget rule).
 *
 * ⛔ BOUND TO THE WIRE: every assertion reads what the stubbed provider RECEIVED. The refusal latch is module state, so
 * this file imports the route once and the latch row runs LAST.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Sent = Record<string, unknown> & { text?: { format?: { type?: string } } };
type Row = Record<string, unknown> & { site: string };

const A = '4d5e6f70-8a9b-4cad-8e0f-2a3b4c5d6e01';
const B = '4d5e6f70-8a9b-4cad-8e0f-2a3b4c5d6e02';
const isConversation = (s: Sent) => s.text?.format?.type !== 'json_schema';
const carriesBreakpoint = (s: Sent) => JSON.stringify(s['input'] ?? []).includes('prompt_cache_breakpoint');

describe('T1 (b): a refused instructions breakpoint falls back to top-level instructions, once', () => {
  let app: FastifyInstance;
  let sent: Sent[] = [];
  /** How the provider answers a request that carries the breakpoint; null = an ordinary 200. */
  let refuse: { status: number; param: string } | null = null;
  const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Sent;
      sent.push(body);
      if (refuse !== null && carriesBreakpoint(body)) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported parameter.', type: 'invalid_request_error', param: refuse.param, code: 'unsupported_parameter' } }), { status: refuse.status });
      }
      if (!isConversation(body)) return new Response(JSON.stringify({ output: [] }), { status: 200 });
      return new Response(JSON.stringify(say('Here is where the model stands.')), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1' }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] }, graph_hash: 'h1',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { sent = []; refuse = null; });

  const turn = async (scenarioId: string) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenarioId, message: 'Where does the model stand?' } });
    return { status: r.statusCode, rows: ((r.json() as { _provider_calls?: Row[] })._provider_calls ?? []) };
  };

  it('CONTROL: an accepted breakpoint is sent once, with no top-level instructions beside it', async () => {
    const { status } = await turn(A);
    expect(status).toBe(200);
    const conv = sent.filter(isConversation);
    expect(conv.length).toBeGreaterThanOrEqual(1);
    expect(conv.every(carriesBreakpoint)).toBe(true);
    expect(conv.some((s) => 'instructions' in s)).toBe(false);
  });

  it.each([
    ['a 400 naming another parameter', 400, 'max_output_tokens'],
    ['a 429', 429, 'input[0].content[0].prompt_cache_breakpoint'],
    ['a 5xx', 500, 'input[0].content[0].prompt_cache_breakpoint'],
  ])('CONTROL: %s is never resent without the breakpoint by this path', async (_name, status, param) => {
    refuse = { status, param };
    await turn(A);
    const conv = sent.filter(isConversation);
    expect(conv.length).toBeGreaterThanOrEqual(1);
    expect(conv.every(carriesBreakpoint), 'no plain resend').toBe(true);
  });

  // ⛔ Runs LAST: it sets the module's refusal latch.
  it('RED: a 400 naming the breakpoint → ONE resend with top-level instructions; the turn answers; later calls go plain; both calls are on the ledger', async () => {
    refuse = { status: 400, param: 'input[0].content[0].prompt_cache_breakpoint' };
    const first = await turn(A);
    expect(first.status).toBe(200);
    const conv = sent.filter(isConversation);
    expect(carriesBreakpoint(conv[0]!), 'the first request carried it').toBe(true);
    expect(conv[1], 'the resend').toBeDefined();
    expect(carriesBreakpoint(conv[1]!)).toBe(false);
    const block = ((conv[0]!['input'] as Record<string, unknown>[])[0]!['content'] as Record<string, unknown>[])[0]!;
    expect(conv[1]!['instructions'], 'the resend carries the SAME text, top-level').toBe(block['text']);
    const callRows = first.rows.filter((r) => r.site === 'agent-v1-turn.callModel');
    expect(callRows.slice(0, 2).map((r) => r['instructions_carrier']), 'the refused call is counted too (#2492)').toEqual(['developer_breakpoint', 'instructions']);
    sent = [];
    const second = await turn(B);
    expect(second.status).toBe(200);
    expect(sent.filter(isConversation).some(carriesBreakpoint), 'the latch: no further breakpoint').toBe(false);
  });
});
