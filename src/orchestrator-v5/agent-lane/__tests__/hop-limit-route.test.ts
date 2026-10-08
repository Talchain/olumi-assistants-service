/**
 * ⛔ RT-7 THROUGH THE REAL ROUTE: a turn whose every tool call is refused in-process uses all its hops, and the user reads
 * the typed reason, never "Ask me again and I will continue" (which only replays the same refusals). Seams: the provider's
 * HTTP call (`fetch`: the Agent asks for the same refused proposal on every hop) and the product's graph read.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
let providerRow: 'unresolved' | 'held' | 'empty' = 'unresolved';
const HELD_MESSAGE = "Set 'New option' to change 'Sprint capacity for integration fix' to 50%.";
const EMPTY_FALLBACK = 'I could not settle that within this turn, and nothing in your model was changed. Try asking for one change at a time.';
type WireTurn = {
  assistant_text: string;
  suggested_actions: { id: string; label: string; message: string; detail?: string }[];
  _agent: { stopped_reason: string; hops: number; mutated: boolean;
    tool_calls: { name: string; ok: boolean; refusal?: string; proposal_id?: string }[] };
};

describe('RT-7: the hop limit says why nothing changed', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] === 'none') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }), { status: 200 });
      }
      agentCalls += 1;
      const args = providerRow === 'empty' ? { interventions: [] }
        : providerRow === 'held' ? { interventions: [{ option_label: 'New option', factor_label: 'Sprint capacity for integration fix', value: 50, unit: '%', user_stated: true }] }
        : { interventions: [{ option_label: 'Raise price', factor_label: 'Bread price increase', value: 6, user_stated: true }] };
      return new Response(JSON.stringify({ output: [{
        type: 'function_call', name: 'propose_option_interventions', call_id: `c${agentCalls}`,
        arguments: JSON.stringify(args),
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
        { id: 'o2', kind: 'option', label: 'New option' },
        { id: 'f2', kind: 'factor', label: 'Sprint capacity for integration fix', observed_state: { value: 0.25, raw_value: 25, cap: 100, unit: '%' } },
      ], edges: [{ from: 'o2', to: 'f2', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] },
      graph_hash: 'h-rt7',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { agentCalls = 0; providerRow = 'unresolved'; });

  it('a held user figure survives later refusals through the FINAL hop-limit wire reply and its approval card', async () => {
    providerRow = 'held';
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: HELD_MESSAGE } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as WireTurn;
    expect(b._agent.stopped_reason).toBe('hop_limit');
    expect(b._agent.hops).toBe(6);
    expect(agentCalls).toBe(6);
    expect(b._agent.mutated).toBe(false);
    const [held, ...refused] = b._agent.tool_calls;
    expect(held).toMatchObject({ name: 'propose_option_interventions', ok: true, proposal_id: expect.any(String) });
    expect(refused).toHaveLength(5);
    expect(refused.every(c => c.name === 'propose_option_interventions' && !c.ok && c.refusal === 'one_change_per_approval')).toBe(true);
    // This is the final route body, including all appended write/refusal/disclosure lines.
    expect(b.assistant_text).not.toMatch(/could not settle|nothing in your model was changed/i);
    expect(b.assistant_text).toContain('I’ve prepared this change: New option sets Sprint capacity for integration fix to 50%');
    expect(b.assistant_text).toContain('Approve this change?');
    expect(b.assistant_text).not.toMatch(/Olumi’s estimate|saved|not saved/i);
    const approvals = b.suggested_actions.filter(c => c.id.startsWith('agent-approve-proposal:'));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ id: `agent-approve-proposal:${held!.proposal_id}`, label: 'Save 50% for New option', message: 'Yes, use those.' });
  });

  it('CONTROL: no held change keeps today’s honest hop-limit sentence on the FINAL wire and offers no approval', async () => {
    providerRow = 'empty';
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Help me with this model.' } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as WireTurn;
    expect(b._agent.stopped_reason).toBe('hop_limit');
    expect(b._agent.hops).toBe(6);
    expect(agentCalls).toBe(6);
    expect(b._agent.mutated).toBe(false);
    expect(b._agent.tool_calls).toHaveLength(6);
    expect(b._agent.tool_calls.every(c => !c.ok && c.refusal === 'empty_proposal' && c.proposal_id === undefined)).toBe(true);
    expect(b.assistant_text).toBe(EMPTY_FALLBACK);
    expect(b.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });

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
