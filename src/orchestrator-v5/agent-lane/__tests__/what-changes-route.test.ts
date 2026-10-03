/**
 * "What would change the result?" through THE REAL ROUTE (SCIENCE ROBUSTNESS, EXPERIMENT; #85 lease 5950283606; route
 * hunk leased by HARNESS 5950400056). Seams: the product's internal graph read (serving R3's served D3 response), the
 * provider's HTTP call (`fetch`, counted) and the decision-flip dispatch (its own rows: `handlers/__tests__/`). The
 * dispatch answers with ISL's REAL D3 block (ISL #220 @51bab705) for the links the turn asks about.
 * Harness modelled on `strengthen-press.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXT_STEP_CHIPS } from '../../../routes/agent-v1-turn.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; body: Rec }[] };
const D3 = SERVED.cases.find((c) => c.id === 'A-WHAT-CHANGES-NONE-MEASURABLE-SILENT')!;
const ISL_D3_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"switch_to_gcp","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"monthly_cloud_savings","to_id":"monthly_spend","status":"quoted","reason":null,"current_mean":-0.3555555555555555,"threshold":-0.09324009324009322,"replicate_thresholds":[-0.09324009324009322,-0.09572649572649569,-0.08578088578088575,-0.09324009324009322],"replicate_range":0.009945609945609946,"to_option_id":"stay_on_aws"},{"from_id":"monthly_cloud_overspend_during_migration","to_id":"monthly_spend","status":"no_change","reason":null,"current_mean":0.17777777777777776,"threshold":null,"replicate_thresholds":[null,null,null,null],"replicate_range":null,"to_option_id":null}]};
const PRESS = NEXT_STEP_CHIPS.find((c) => c.id === 'agent-next-what-would-change')!;
// The Run the served D3 read shows, by the identity the measurement carries (its fact's graph_hash_at_run + computed_at).
const D3_RUN = { graph_hash_at_run: D3.body.analysis_result.computed_against_hash, computed_at: D3.body.analysis_state.run_state.computed_at };
// Run B: the SAME model and leader, a newer Run (Codex P1 #2542: "unchanged leader/model variants").
const RUN_B_AT = '2026-10-01T12:30:00.000Z';
const runB = () => ({ ...D3.body.analysis_state, run_state: { ...D3.body.analysis_state.run_state, computed_at: RUN_B_AT } });

const dispatch = vi.hoisted(() => ({ calls: [] as Rec[], answer: 'measured' as 'measured' | 'stale' | 'unavailable', during: null as null | (() => void), run: null as null | Rec, block: null as null | Rec }));
vi.mock('../../handlers/decision-flip-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchDecisionFlip: vi.fn(async (params: Rec) => {
    dispatch.calls.push(params);
    dispatch.during?.();
    return dispatch.answer === 'stale' ? { status: 'stale' }
      : dispatch.answer === 'unavailable' ? { status: 'unavailable', reason: 'client_without_decision_flip' }
      : { status: 'measured', block: dispatch.block ?? ISL_D3_BLOCK, links: params.candidateLinks.slice(0, 2), run: dispatch.run ?? D3_RUN };
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

// What the product's graph read serves; rows change it to model an edit or a Run the Explain control cannot bind.
const served: { state: Rec; result: Rec; ready: Rec | undefined; reads: number; afterRead: null | ((n: number) => void) } = { state: D3.body.analysis_state, result: D3.body.analysis_result, ready: undefined, reads: 0, afterRead: null };
const RUN_NOT_CURRENT = 'I can’t explain that result as current. Check the current results before asking again.';

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
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      const read = { graph: D3.body.draft_graph, graph_hash: 'h-d3', analysis_state: served.state,
        analysis_result: served.result, analysis_option_participation: D3.body.option_participation,
        // Absent: the readback derives the producer's own admission from the graph (D3: M2, caveated permission).
        ...(served.ready !== undefined ? { analysis_ready: served.ready } : {}) };
      served.reads += 1;
      served.afterRead?.(served.reads);
      return read;
    });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    modelCalls = 0; dispatch.calls.length = 0; dispatch.answer = 'measured'; dispatch.during = null; dispatch.run = null; dispatch.block = null;
    served.state = D3.body.analysis_state; served.result = D3.body.analysis_result; served.ready = undefined; served.reads = 0; served.afterRead = null;
    n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`;
  });

  const post = async (chipId: string, message: string, turnId?: string) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, source: 'chip', chip: { id: chipId }, ...(turnId !== undefined ? { turn_id: turnId } : {}) } });
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

  // One chip, two grounded answers (#2536 SCI-HERO coaching shares `agent-next-what-would-change`): anything the
  // measurement does not answer is the Run's own tipping-point coaching, exactly as served before this branch.
  const killSwitchOff = async <T>(fn: () => Promise<T>): Promise<T> => {
    const { _resetConfigCache } = await import('../../../config/index.js');
    process.env.CEE_WHAT_CHANGES_MEASURED_ENABLED = 'false';
    _resetConfigCache();
    try { return await fn(); } finally {
      delete process.env.CEE_WHAT_CHANGES_MEASURED_ENABLED;
      _resetConfigCache();
    }
  };
  const coaching = async () => {
    dispatch.answer = 'measured';
    return killSwitchOff(async () => (await post(PRESS.id, PRESS.message)).assistant_text);
  };

  it('W3: the kill switch (CEE_WHAT_CHANGES_MEASURED_ENABLED=false) leaves the press to the Run\'s tipping-point coaching', async () => {
    const text = await coaching();
    expect(dispatch.calls).toHaveLength(0);
    expect(modelCalls).toBe(0);
    // D3's Run quotes no factor threshold (#2536 `no_flip_in_range`); the wire gate's caveat leads, as in W1.
    const coached = 'This analysis has no factor threshold to quote within the ranges it checked.';
    expect(text === coached || text.endsWith(`\n\n${coached}`), text).toBe(true);
    expect(text).not.toMatch(/would come out ahead|would still lead|Your model has changed since/);
  });

  it('W4: a measurement that is not an answer (unavailable) falls back to the same coaching, never RC\'s honest limit', async () => {
    dispatch.answer = 'unavailable';
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(1);
    expect(modelCalls).toBe(0);
    expect(body.assistant_text).toBe(await coaching());
    expect(body.assistant_text).not.toMatch(/would come out ahead|would still lead|can't yet measure what would change/);
    expect(body.suggested_actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });

  it('W2: #2522\'s digest disagreeing with a canonically current Run (stale) is the coaching, never "your model has changed"', async () => {
    dispatch.answer = 'stale';
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(1);
    expect(modelCalls).toBe(0);
    expect(body.assistant_text).toBe(await coaching());
    expect(body.assistant_text).not.toMatch(/Your model has changed since|would come out ahead|would still lead/);
  });

  it('W5: an edit while ISL measures (the bound Run is no longer current at the final read) is never answered', async () => {
    dispatch.during = () => { served.state = { ...D3.body.analysis_state, run_state: { ...D3.body.analysis_state.run_state, kind: 'complete_stale' } }; };
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(1);
    expect(modelCalls).toBe(0);
    expect(body.assistant_text.endsWith(RUN_NOT_CURRENT), body.assistant_text).toBe(true);
    expect(body.assistant_text).not.toMatch(/would come out ahead|would still lead/);
  });

  it('W6: a Run the Explain control cannot bind (no computed_against_hash) is never measured', async () => {
    const { computed_against_hash: _unbound, ...result } = D3.body.analysis_result;
    served.result = result;
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(0);
    expect(modelCalls).toBe(0);
    expect(body.assistant_text.endsWith(RUN_NOT_CURRENT), body.assistant_text).toBe(true);
  });

  it('W7: Run B (same model, same leader) landing while ISL measures Run A is never answered with Run A\'s tipping points', async () => {
    dispatch.during = () => { served.state = runB(); };
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(1);
    expect(body.assistant_text.endsWith(RUN_NOT_CURRENT), body.assistant_text).toBe(true);
    expect(body.assistant_text).not.toMatch(/would come out ahead|would still lead/);
  });

  it('W7b: a block measured for another Run than the one shown is refused: the shown Run\'s coaching answers', async () => {
    dispatch.run = { ...D3_RUN, computed_at: RUN_B_AT };
    const body = await post(PRESS.id, PRESS.message);
    expect(dispatch.calls).toHaveLength(1);
    expect(body.assistant_text).toBe(await coaching());
  });

  it('W8: a "no threshold" coaching answer (no_signal) is about ITS Run too: Run B landing before the final read is never answered', async () => {
    const text = await killSwitchOff(async () => {
      served.afterRead = (n) => { if (n === 1) served.state = runB(); }; // the turn's first read binds Run A; every later read shows Run B
      return (await post(PRESS.id, PRESS.message)).assistant_text;
    });
    expect(served.reads).toBeGreaterThan(1);
    expect(text.endsWith(RUN_NOT_CURRENT), text).toBe(true);
    expect(text).not.toMatch(/no factor threshold/);
  });

  describe('ONE owner on replay (Codex P1 #2542: the replay always chose SCI-HERO)', () => {
    const MEASURED = "‘Switch to GCP’ would still lead even if monthly cloud overspend during migration's average effect on monthly spend fell to zero.";
    it('R1: a retry of a measured turn, its Run still current, is the SAME measured answer and never measures again', async () => {
      const turn = randomUUID();
      const first = await post(PRESS.id, PRESS.message, turn);
      expect(first.assistant_text.endsWith(MEASURED), first.assistant_text).toBe(true);
      const again = await post(PRESS.id, PRESS.message, turn);
      expect(again.assistant_text).toBe(first.assistant_text);
      expect(dispatch.calls).toHaveLength(1);
      expect(modelCalls).toBe(0);
    });
    it('R2: once Run B is current, the retry is today\'s coaching, never Run A\'s measured words', async () => {
      const turn = randomUUID();
      await post(PRESS.id, PRESS.message, turn);
      served.state = runB();
      const again = await post(PRESS.id, PRESS.message, turn);
      expect(again.assistant_text).not.toMatch(/would come out ahead|would still lead/);
      expect(again.assistant_text).toMatch(/no factor threshold to quote within the ranges it checked\.$/);
      expect(dispatch.calls).toHaveLength(1);
    });
    it('R3: with the kill switch off, the retry is the coaching too', async () => {
      const turn = randomUUID();
      await post(PRESS.id, PRESS.message, turn);
      const again = await killSwitchOff(() => post(PRESS.id, PRESS.message, turn));
      expect(again.assistant_text).not.toMatch(/would come out ahead|would still lead/);
      expect(dispatch.calls).toHaveLength(1);
    });
  });

  describe('a measured answer is reused on replay only under TODAY\'s leader licence (Codex round 2 P1)', () => {
    // Each of RC's three measured sentence kinds, from ISL's real D3 links.
    const [savings, overspend] = ISL_D3_BLOCK.links;
    const STATUSES: Record<string, { block: Rec; said: RegExp }> = {
      quoted: { block: { ...ISL_D3_BLOCK, links: [savings] }, said: /would come out ahead if monthly cloud savings's effect on monthly spend fell below about a quarter/ },
      below_a_tenth: { block: { ...ISL_D3_BLOCK, links: [{ ...savings, threshold: -0.02, replicate_thresholds: [-0.02, -0.02, -0.02, -0.02], replicate_range: 0 }] },
        said: /would come out ahead only if monthly cloud savings's effect on monthly spend all but disappeared/ },
      no_change: { block: { ...ISL_D3_BLOCK, links: [overspend] }, said: /would still lead even if monthly cloud overspend during migration's average effect/ },
    };
    const canonical = buildCanonicalAnalysisReadyFromGraph(D3.body.draft_graph) as Rec;
    // The SAME Run (scenario, computed_against_hash, computed_at untouched): only the permission or the admission moves.
    const WITHHELD: Record<string, () => void> = {
      'leader claim revoked': () => { served.state = { ...D3.body.analysis_state, leader_claim: { ...D3.body.analysis_state.leader_claim, permitted: false } }; },
      'admission absent': () => { served.ready = { ...canonical, analysis_admission: undefined }; },
      'admission malformed': () => { served.ready = { ...canonical, analysis_admission: 'admitted' }; },
      'admission refused': () => { served.ready = { ...canonical, analysis_admission: { ...canonical.analysis_admission, structurally_analysable: false } }; },
      'admission exploratory': () => { served.ready = { ...canonical, analysis_admission: { ...canonical.analysis_admission, permitted_analysis_mode: 'exploratory' } }; },
    };
    it('the served D3 admission is M2 (caveated permission): the measured replay R1 stands under it', () => {
      expect(canonical.analysis_admission).toMatchObject({ structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' });
    });
    for (const [status, { block, said }] of Object.entries(STATUSES)) {
      for (const [how, withhold] of Object.entries(WITHHELD)) {
        it(`R4 ${status} · ${how}: the retry is today's coaching, never the measured words`, async () => {
          dispatch.block = block;
          const turn = randomUUID();
          const first = await post(PRESS.id, PRESS.message, turn);
          expect(first.assistant_text, first.assistant_text).toMatch(said);
          withhold();
          const again = await post(PRESS.id, PRESS.message, turn);
          expect(again.assistant_text, again.assistant_text).not.toMatch(/would come out ahead|would still lead|all but disappeared/);
          expect(again.assistant_text).toMatch(/no factor threshold to quote within the ranges it checked\./);
          expect(dispatch.calls).toHaveLength(1);
          expect(modelCalls).toBe(0);
        });
      }
    }
  });

  it('CONTROL: another next step never reaches the decision-flip dispatch', async () => {
    const other = NEXT_STEP_CHIPS.find((c) => c.id !== PRESS.id && c.id !== 'agent-next-strengthen' && c.id !== 'agent-next-pre-mortem') ?? NEXT_STEP_CHIPS.find((c) => c.id !== PRESS.id)!;
    await post(other.id, other.message);
    expect(dispatch.calls).toHaveLength(0);
  });
});
