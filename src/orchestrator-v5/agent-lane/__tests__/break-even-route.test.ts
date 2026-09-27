/**
 * ⭐ AX1 THROUGH THE AGENT ROUTE (DL #70 5850280205). The served F8 Run (DL's joined run `f-20260926T201724Z`) answered
 * "No option can be put forward…" and nothing else. On a Run whose readback withholds the leader for the product
 * identity, the reply now carries the arithmetic on the model's own figures — appended AFTER the withheld-leader gate,
 * which drops any sentence that compares options, so the gate cannot remove it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';

const SCENARIO = '38b6c2a6-03f6-458b-8f85-043acfdf210c';
const HASH = '783e01ff91705f36';
const served = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
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

/** The served Run's own words (05-F8-run), as the interpreter wrote them. */
const SERVED_REPLY = 'No option can be put forward on MRR yet: the model treats MRR as depending on **Pro price × Pro subscribers**, but its comparison currently adds those effects rather than multiplying them.';

describe('AX1: a Run whose leader is withheld for the product still answers with the arithmetic', () => {
  let app: FastifyInstance;
  let permitted = false;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: SERVED_REPLY }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH,
      blocks: [{ type: 'analysis_result', computed_against_hash: HASH, leading_option_id: null }], analysis_ready: { status: 'ready', options: [], blockers: [] } }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: served, graph_hash: HASH,
      analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-09-26T20:20:00.000Z' },
        leader_claim: permitted ? { permitted: true, separation: 'separated' } : { permitted: false, withheld_reason: 'nonlinear_identity_sign_unproven', separation: 'separated' } },
      analysis_result: { type: 'analysis_result', computed_against_hash: HASH, leading_option_id: null },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { permitted = false; });

  const pressRun = async () => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } })).json() as { assistant_text: string; _diagnostic_trace?: { fast_path?: string }; _agent?: { break_even?: unknown } };

  it('RED (served F8): the Run\'s reply carries the break-even and the target arithmetic, after the gate', async () => {
    const b = await pressRun();
    expect(b._diagnostic_trace?.fast_path).toBe('run');
    expect(b.assistant_text).toContain('At £59/month, MRR stays at least that while 250 or more of the 300 stay (a loss of at most 50).');
    expect(b.assistant_text).toContain('£20,000/month needs 339 at £59/month, 371 at £54/month or 409 at £49/month.');
    expect(b.assistant_text).toContain('not the analysis ranking the options');
  });

  it('RED (served F8): the same arithmetic is on the wire as a typed fact, `_agent.break_even` (SERVED FIELD)', async () => {
    const b = await pressRun();
    expect(b._agent?.break_even).toMatchObject({
      goal: 'MRR', unit: 'GBP/month', baseline_price: 49, baseline_volume: 300, baseline_volume_by: 'approved', baseline_goal: 14_700,
      // A5 (DL #70 5855437928): the graph ids ride beside the labels on the wire.
      goal_id: 'mrr', price_factor_id: 'pro_plan_price', volume_factor_id: 'pro_paying_subscribers',
      options: [
        { option: 'Raise Pro to £59', option_id: 'raise_pro_to_59', price: 59, price_by: 'user', keep_at_least: 250 },
        { option: 'Hold £49 with AI release', option_id: 'hold_49_with_ai_release', price: 49, price_by: 'user' },
        { option: 'Raise Pro to £54', option_id: 'raise_pro_to_54', price: 54, price_by: 'olumi', keep_at_least: 273 },
      ],
      target: { value: 20_000, needs: [{ price: 59, volume: 339 }, { price: 54, volume: 371 }, { price: 49, volume: 409 }] },
    });
  });

  it('CONTRAST: a readback that permits the leader adds nothing (the analysis answers)', async () => {
    permitted = true;
    const b = await pressRun();
    expect(b.assistant_text).not.toContain('The arithmetic still answers');
    expect(b._agent, JSON.stringify(b)).toBeDefined();
    expect(Object.hasOwn(b._agent!, 'break_even')).toBe(false);
  });

  it('CONTRAST: a turn that ran no analysis adds nothing, even though the readback still carries the withheld run', async () => {
    const b = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does churn mean here?' } })).json() as { assistant_text: string; _agent?: Record<string, unknown> };
    expect(b.assistant_text).not.toContain('The arithmetic still answers');
    expect(b._agent, JSON.stringify(b)).toBeDefined();
    expect(Object.hasOwn(b._agent!, 'break_even')).toBe(false);
  });
});
