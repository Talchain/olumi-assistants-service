/**
 * ⛔ THE RESPONSE ITSELF NAMES WHAT A PROPOSAL LEFT OUT, BEFORE THE ONE-CLICK APPROVAL
 * (independent review of #1800, 5807008891). The approve chip is generic ("Use as starting
 * assumptions") and the Agent's words are the model's: a reply that says only "here is a starting
 * point" would offer consent while a user-named input (a risk that cannot hold a value) was absent.
 * The omission is composed by Olumi from the proposer's own result, whatever the model says.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/** Records rows by (scenario, turn), so a turn_id-bearing turn takes the real claim → answer path. */
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0 });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let n = 0; let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b${String(n).padStart(2, '0')}`; };
const NODES = [
  { id: 'velocity', kind: 'goal', label: 'Delivery velocity' },
  { id: 'onboarding_load', kind: 'factor', label: 'Onboarding load', category: 'observable', scale_frame: 100 },
  { id: 'hiring_ramp_up_delay', kind: 'risk', label: 'Hiring ramp-up delay' },
  { id: 'hire_two', kind: 'option', label: 'Hire two developers' },
];
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
const EDGES = [edge('hire_two', 'onboarding_load'), edge('onboarding_load', 'velocity'), edge('hiring_ramp_up_delay', 'velocity')];
const RISK = { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' };
const FACTOR = { factor_label: 'Onboarding load', value: 40, unit: '', basis: 'typical' };
const LEVEL = { option_label: 'Hire two developers', factor_label: 'Onboarding load', value: 60, basis: 'more onboarding' };

type Chip = { id: string; label: string };
describe('a starting point that leaves a named input out says so in the response itself', () => {
  let app: FastifyInstance;
  let args: Record<string, unknown> = {};
  let calls = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: unknown[] };
      calls += 1;
      const already = JSON.stringify(body.input ?? []).includes('function_call_output');
      if (!already) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_starting_point', call_id: `c${calls}`, arguments: JSON.stringify(args) }] }), { status: 200 });
      }
      // The model's narration OMITS the risk entirely.
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is a starting point for you to approve.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: NODES, edges: EDGES }, graph_hash: 'h0' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); calls = 0; });

  const turn = async (turnId?: string) => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Suggest a starting point.', ...(turnId ? { turn_id: turnId } : {}) } })).json() as { assistant_text: string; suggested_actions: Chip[] };

  it('RED: the model omits the risk; the response still names it and why — alongside the approve chip', async () => {
    args = { assumptions: [RISK, FACTOR], option_levels: [LEVEL] };
    store.append.mockClear();
    const b = await turn('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'the control: something approvable was offered').toBe(true);
    expect(b.assistant_text).toContain('Not included in this proposal: Hiring ramp-up delay (a risk)');
    expect(b.assistant_text).toMatch(/Only a factor can hold a starting value/);
    // The committed answer (what a replay returns) carries the same disclosure.
    const persisted = JSON.stringify(store.append.mock.calls);
    expect(persisted).toContain('Not included in this proposal: Hiring ramp-up delay (a risk)');
  });

  it('CONTRAST: an all-factor complete starting point — the ordinary approval, no omission line', async () => {
    args = { assumptions: [FACTOR], option_levels: [LEVEL] };
    const b = await turn();
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(true);
    expect(b.assistant_text).not.toContain('Not included in this proposal');
  });

  it('CONTRAST: an all-risk input — nothing approvable, and the response still says what was left out', async () => {
    args = { assumptions: [RISK], option_levels: [] };
    const b = await turn();
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
    expect(b.assistant_text).toContain('Not included in this proposal: Hiring ramp-up delay (a risk)');
  });
});
