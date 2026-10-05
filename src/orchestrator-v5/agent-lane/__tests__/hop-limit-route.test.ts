/**
 * ⛔ RT-7 THROUGH THE REAL ROUTE: a turn whose every tool call is refused in-process uses all its hops, and the user reads
 * the typed reason, never "Ask me again and I will continue" (which only replays the same refusals). Seams: the provider's
 * HTTP call (`fetch`: the Agent asks for the same refused proposal on every hop) and the product's graph read.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a71';
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let agentCalls = 0;

describe('RT-7: the hop limit says why nothing changed', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] === 'none') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }), { status: 200 });
      }
      agentCalls += 1;
      return new Response(JSON.stringify({ output: [{
        type: 'function_call', name: 'propose_option_interventions', call_id: `c${agentCalls}`,
        arguments: JSON.stringify({ interventions: [{ option_label: 'Raise price', factor_label: 'Bread price increase', value: 6, user_stated: true }] }),
      }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [
        { id: 'o1', kind: 'option', label: 'Raise prices', interventions: { f1: 8 } },
        { id: 'f1', kind: 'factor', label: 'Bread price increase', observed_state: { value: 8, unit: '%' } },
      ], edges: [] },
      graph_hash: 'h-rt7',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED (served 43e51050, turn 2ff3cc10): six refused proposals → the typed reason, no "ask me again" promise', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Make the rise 6% instead of 8%.' } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as { assistant_text: string; _agent: { stopped_reason: string; hops: number; mutated: boolean; tool_calls: { name: string; ok: boolean }[] } };
    expect(b._agent.stopped_reason, 'the control: the turn really hit the hop limit').toBe('hop_limit');
    expect(b._agent.mutated).toBe(false);
    expect(b._agent.tool_calls.every((c) => c.name === 'propose_option_interventions' && c.ok === false)).toBe(true);
    expect(b.assistant_text).toBe('Nothing was changed. I could not find option "Raise price" in your model.');
    expect(b.assistant_text).not.toMatch(/ask me again|continue/i);
  });
});
