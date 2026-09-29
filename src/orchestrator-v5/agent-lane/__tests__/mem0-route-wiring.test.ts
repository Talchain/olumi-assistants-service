/**
 * EXPERIMENT (exp/mem0-context-spike-20260929): the flag-gated Mem0 wiring through the REAL `/agent/v1/turn` route.
 * Hosted Mem0 is replaced by a fake `mem0ai` module; nothing leaves the process.
 *
 *   · allowlisted scenario → recall is searched with user AND scenario filters, guarded, and reaches the model as one
 *     user item before the live message; the user's typed words are remembered after the reply (verbatim, infer=false);
 *   · a search that fails never costs the turn;
 *   · a scenario NOT on the allowlist → no search, no add.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => []),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const ALLOWED = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER = '8b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const mem0 = {
  searches: [] as { query: string; opts: Record<string, unknown> }[],
  adds: [] as { messages: unknown[]; opts: Record<string, unknown> }[],
  failSearch: false,
};
vi.mock('mem0ai', () => ({
  default: class {
    constructor(_o: unknown) {}
    async search(query: string, opts: Record<string, unknown>) {
      mem0.searches.push({ query, opts });
      if (mem0.failSearch) throw new Error('mem0 503');
      return { results: [
        { id: 'm1', memory: 'Olumi asked: "Who are most of your customers?" — user: "Mostly creative agencies with 5 to 20 staff."', userId: 'olumi-poc-guest', runId: ALLOWED, score: 0.8,
          metadata: { user_words: 'Mostly creative agencies with 5 to 20 staff.', answered_question: 'Who are most of your customers?', said_at: '2026-09-29T09:00:00Z', turn_id: 't1' } },
        { id: 'm2', memory: 'User: "Yes, apply it."', userId: 'olumi-poc-guest', runId: ALLOWED, score: 0.7, metadata: { user_words: 'Yes, apply it.' } },
        { id: 'm3', memory: 'User: "Leaked from elsewhere"', userId: 'olumi-poc-guest', runId: OTHER, score: 0.9, metadata: { user_words: 'Leaked from elsewhere' } },
      ] };
    }
    async add(messages: unknown[], opts: Record<string, unknown>) { mem0.adds.push({ messages, opts }); return { status: 'SUCCEEDED' }; }
  },
}));

type Item = { role?: string; content?: unknown };
const textOf = (c: unknown): string => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((p) => String((p as { text?: unknown }).text ?? '')).join('') : '');

describe('Mem0 experiment wiring on /agent/v1/turn', () => {
  let app: FastifyInstance;
  const inputs: Item[][] = [];
  const ENV = {
    AGENT_LANE_ENABLED: 'true', AGENT_LANE_PREVIEW: 'false', CEE_MEM0_CONTEXT_EXPERIMENT: 'true', CEE_CONTEXT_INHOUSE_QA_PAIRING: 'true',
    MEM0_API_KEY: 'test-key-not-real', CEE_MEM0_SCENARIO_ALLOWLIST: ALLOWED,
  };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      inputs.push((JSON.parse(String(init?.body ?? '{}')).input ?? []) as Item[]);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted. What else matters?' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    Object.assign(process.env, ENV);
    const mod = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h2' }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); for (const k of Object.keys(ENV)) delete process.env[k]; });

  const say = (scenario: string, message: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message } });

  it('allowlisted: guarded recall reaches the model before the live message; the typed words are remembered', async () => {
    inputs.length = 0; mem0.searches.length = 0; mem0.adds.length = 0;
    const r = await say(ALLOWED, 'Which segment should the new tier target?');
    expect(r.statusCode).toBe(200);
    expect(mem0.searches[0]!.opts.filters).toEqual({ AND: [{ user_id: 'olumi-poc-guest' }, { run_id: ALLOWED }] });
    const texts = inputs[0]!.filter((i) => typeof i.role === 'string').map((i) => textOf(i.content));
    const recall = texts.find((t) => t.includes('supplementary_historical_recall'));
    expect(recall, 'the recall item is in the model input').toBeDefined();
    expect(recall).toContain('creative agencies');
    expect(recall, 'an approval never survives the guard').not.toContain('apply it');
    expect(recall, 'another scenario never survives the guard').not.toContain('Leaked from elsewhere');
    expect(texts.at(-1)).toBe('Which segment should the new tier target?');
    await vi.waitFor(() => expect(mem0.adds.length).toBe(1));
    expect(mem0.adds[0]!.opts).toMatchObject({ userId: 'olumi-poc-guest', runId: ALLOWED, infer: false });
    expect(JSON.stringify(mem0.adds[0]!.messages)).toContain('Which segment should the new tier target?');
  });

  it('a failing search never costs the turn', async () => {
    inputs.length = 0; mem0.failSearch = true;
    const r = await say(ALLOWED, 'And the price?');
    mem0.failSearch = false;
    expect(r.statusCode).toBe(200);
    const texts = inputs[0]!.map((i) => textOf(i.content));
    expect(texts.some((t) => t.includes('supplementary_historical_recall'))).toBe(false);
  });

  it('a scenario NOT on the allowlist: nothing is searched or sent', async () => {
    mem0.searches.length = 0; mem0.adds.length = 0;
    const r = await say(OTHER, 'Tell me about pricing.');
    expect(r.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 50));
    expect(mem0.searches).toEqual([]);
    expect(mem0.adds).toEqual([]);
  });
});
