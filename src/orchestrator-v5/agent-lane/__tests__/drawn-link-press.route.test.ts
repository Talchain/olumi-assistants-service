import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';

const store = createMockSessionStore();
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
const graph = { nodes: [{ id: 'team', kind: 'factor', label: 'Team capacity' }, { id: 'velocity', kind: 'outcome', label: 'Delivery pace' }], edges: [] };
const reason = 'More capacity helps the team deliver work.';
const card = `Olumi’s estimate: ‘Team capacity’ helps ‘Delivery pace’, slight. ${reason}`;
const proposal = { from_label: 'Team capacity', to_label: 'Delivery pace', direction: 'positive', strength: 'weak', reason, rationale: reason };
let n = 0;
let scenario = '';
let modelCalls: { tools: { name: string }[]; tool_choice?: unknown }[] = [];
let modelArgs: Record<string, unknown> = proposal;

describe('drawn link through the actual route and final card egress', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelCalls.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_model_change', call_id: 'drawn', arguments: JSON.stringify(modelArgs) }] }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'h-drawn' }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { scenario = `6f1c2a3b-4d5e-4f60-8a7b-${String(++n).padStart(12, '0')}`; modelCalls = []; modelArgs = proposal; });
  const press = async (id = 'agent-drawn-link:team>velocity', session_id?: string) => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario,
      message: 'Suggest this link.', source: 'chip', chip: { id }, ...(session_id !== undefined ? { session_id } : {}) } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { assistant_text: string; suggested_actions: { id: string; label: string; detail?: string }[];
      _agent: { session_id: string; mutated: boolean; tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
  };
  it('one forced call for the pressed pair yields the complete estimate card at final egress', async () => {
    const body = await press();
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.tool_choice).toEqual({ type: 'function', name: 'propose_model_change' });
    expect(modelCalls[0]!.tools.map(t => t.name)).toEqual(['propose_model_change']);
    expect(body._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_model_change', ok: true })]);
    expect(body._agent.mutated).toBe(false);
    expect(body.assistant_text).toContain(card);
    expect(body.suggested_actions.map(c => c.label)).toEqual(['Approve', 'Change something first', 'Decline']);
    expect(body.suggested_actions[0]!.detail).toBe(card);
  });
  it('unknown pair stays a plain refusal at final egress with no provider or tool call', async () => {
    const body = await press('agent-drawn-link:missing>velocity');
    expect(modelCalls).toEqual([]); expect(body._agent.tool_calls).toEqual([]);
    expect(body.assistant_text).toContain('could not find both cards');
    expect(body.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });
  it('a model-supplied different pair gets no approval card', async () => {
    modelArgs = { ...proposal, from_label: 'Delivery pace', to_label: 'Team capacity' };
    const body = await press();
    expect(modelCalls).toHaveLength(1);
    expect(body._agent.tool_calls[0]).toMatchObject({ name: 'propose_model_change', ok: false });
    expect(body.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });
  it('the actual decline chip withdraws the held proposal without another provider call', async () => {
    const body = await press();
    const declined = await press(body.suggested_actions.find(c => c.label === 'Decline')!.id, body._agent.session_id);
    expect(modelCalls).toHaveLength(1);
    expect(declined._agent.mutated).toBe(false);
    expect(declined._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: true })]);
    expect(declined.assistant_text).toContain('declined');
    expect(declined.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });
});
