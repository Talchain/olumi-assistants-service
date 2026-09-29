/**
 * ⭐ PJ-C1 LATENCY, AT THE ROUTE: the turn's first graph read runs BESIDE the turn claim, not after it
 * (#72 5861769155; served `84440ff` A13: ~560 ms of store reads + claim, THEN a 1,011 ms graph read).
 *
 * The store double makes the claim write slow and logs when it finishes; the product's own graph route double logs
 * when it is read. At base the read starts only after the claim has been written and read back. With the prefetch it
 * starts first, and a plain message turn still reads the model ONCE (the loop's read joins the prefetched one).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const events: string[] = [];
type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const claim = w.turn_id.endsWith(':claim');
    if (claim) {
      events.push('claim:start');
      await new Promise((r) => setTimeout(r, 150));
    }
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    if (claim) events.push('claim:end');
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer.' }] }] }), { status: 200 }));

const SID = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const TURN = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';

async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => {
    events.push('graph:read');
    return { graph: { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }], edges: [] }, graph_hash: 'h1' };
  });
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('the Agent turn starts its first read of the model beside the turn claim', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    events.length = 0; rows.clear();
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the graph read starts BEFORE the claim write finishes, and a plain message turn still reads the model ONCE', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: 'What matters most here', turn_id: TURN } });
    expect(r.statusCode, r.body).toBe(200);
    expect(events.filter((e) => e === 'graph:read'), JSON.stringify(events)).toHaveLength(1);
    expect(events.indexOf('claim:start'), JSON.stringify(events)).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('graph:read'), JSON.stringify(events)).toBeLessThan(events.indexOf('claim:end'));
  });
});
