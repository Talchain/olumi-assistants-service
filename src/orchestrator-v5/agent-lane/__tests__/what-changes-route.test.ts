/**
 * "What would change the result?" through THE REAL ROUTE (SCIENCE ROBUSTNESS, EXPERIMENT; #85 lease 5950283606; route
 * hunk leased by HARNESS 5950400056). Seams: the product's internal graph read (serving R3's served D3 response), the
 * provider's HTTP call (`fetch`, counted) and the decision-flip dispatch (its own rows: `handlers/__tests__/`). The
 * dispatch answers with ISL's REAL D3 block (ISL #220 @51bab705) for the links the turn asks about.
 * Harness modelled on `strengthen-press.test.ts`.
 */
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXT_STEP_CHIPS } from '../../../routes/agent-v1-turn.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; body: Rec }[] };
const D3 = SERVED.cases.find((c) => c.id === 'A-WHAT-CHANGES-NONE-MEASURABLE-SILENT')!;
const ISL_D3_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"switch_to_gcp","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"monthly_cloud_savings","to_id":"monthly_spend","status":"quoted","reason":null,"current_mean":-0.3555555555555555,"threshold":-0.09324009324009322,"replicate_thresholds":[-0.09324009324009322,-0.09572649572649569,-0.08578088578088575,-0.09324009324009322],"replicate_range":0.009945609945609946,"to_option_id":"stay_on_aws"},{"from_id":"monthly_cloud_overspend_during_migration","to_id":"monthly_spend","status":"no_change","reason":null,"current_mean":0.17777777777777776,"threshold":null,"replicate_thresholds":[null,null,null,null],"replicate_range":null,"to_option_id":null}]};
const PRESS = NEXT_STEP_CHIPS.find((c) => c.id === 'agent-next-what-would-change')!;

const dispatch = vi.hoisted(() => ({ calls: [] as Rec[], answer: 'measured' as 'measured' | 'stale' }));
vi.mock('../../handlers/decision-flip-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchDecisionFlip: vi.fn(async (params: Rec) => {
    dispatch.calls.push(params);
    return dispatch.answer === 'stale' ? { status: 'stale' }
      : { status: 'measured', block: ISL_D3_BLOCK, links: params.candidateLinks.slice(0, 2) };
  }),
}));

const SCENARIO_BASE = '8e3f4a51-6c7d-4e8f-9a01-b2c3d4e5f6';
let n = 0;
let SCENARIO = '';
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Rec) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: [] });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('the real route: "What would change the result?" → measured tipping points, 0 model calls', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'An improvised answer.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: D3.body.draft_graph, graph_hash: 'h-d3', analysis_state: D3.body.analysis_state,
      analysis_result: D3.body.analysis_result, analysis_option_participation: D3.body.option_participation,
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelCalls = 0; dispatch.calls.length = 0; dispatch.answer = 'measured'; n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`; });

  const post = async (chipId: string, message: string) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, source: 'chip', chip: { id: chipId } } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { assistant_text: string; suggested_actions: { id: string }[] };
  };

  it('W1: the press is answered from the measured block — RC\'s sentences, the turn\'s own follow-up, no model call', async () => {
    const body = await post(PRESS.id, PRESS.message);
    expect(modelCalls).toBe(0);
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0].payload.scenario_id).toBe(SCENARIO);
    const answer = "‘Stay on AWS’ would come out ahead if monthly cloud savings's effect on monthly spend fell below about a quarter of what it is now. "
      + "‘Switch to GCP’ would still lead even if monthly cloud overspend during migration's average effect on monthly spend fell to zero.";
    // The turn's answer is the reply's last paragraph, intact. This served Run is quantified-provisional (the user's
    // own estimates are off the deciding path), so the leader wire gate puts its caveat first: the governing egress
    // rule (leading-option-wire-enforcement.ts), not this turn's words.
    expect(body.assistant_text === answer || body.assistant_text.endsWith(`\n\n${answer}`), body.assistant_text).toBe(true);
    expect(body.assistant_text).not.toMatch(/no single (assumption|factor)|nothing would change/i);
    expect(body.suggested_actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });

  it('W2: a model changed since its Run is said as such, with no model call', async () => {
    dispatch.answer = 'stale';
    const body = await post(PRESS.id, PRESS.message);
    expect(modelCalls).toBe(0);
    expect(body.assistant_text).toMatch(/(^|\n\n)Your model has changed since its last analysis, so I can’t say what would change that result\. Run the analysis again, then ask\.$/);
  });

  it('W3: the kill switch (CEE_WHAT_CHANGES_MEASURED_ENABLED=false) leaves the press to the ordinary Agent turn', async () => {
    const { _resetConfigCache } = await import('../../../config/index.js');
    process.env.CEE_WHAT_CHANGES_MEASURED_ENABLED = 'false';
    _resetConfigCache();
    try {
      const body = await post(PRESS.id, PRESS.message);
      expect(dispatch.calls).toHaveLength(0);
      expect(modelCalls).toBeGreaterThan(0);
      expect(body.assistant_text).not.toMatch(/would come out ahead|would still lead/);
    } finally {
      delete process.env.CEE_WHAT_CHANGES_MEASURED_ENABLED;
      _resetConfigCache();
    }
  });

  it('CONTROL: another next step never reaches the decision-flip dispatch', async () => {
    const other = NEXT_STEP_CHIPS.find((c) => c.id !== PRESS.id && c.id !== 'agent-next-strengthen' && c.id !== 'agent-next-pre-mortem') ?? NEXT_STEP_CHIPS.find((c) => c.id !== PRESS.id)!;
    await post(other.id, other.message);
    expect(dispatch.calls).toHaveLength(0);
  });
});
