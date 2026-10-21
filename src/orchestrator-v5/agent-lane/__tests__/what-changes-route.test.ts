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
const TALK = { id: 'agent-talk-it-through', message: 'Let’s talk it through.' }; // TALK_IT_THROUGH_CHIP: an ordinary chip
// The Run the served D3 read shows, by the identity the measurement carries (its fact's graph_hash_at_run + computed_at).
const D3_RUN = { graph_hash_at_run: D3.body.analysis_result.computed_against_hash, computed_at: D3.body.analysis_state.run_state.computed_at };
// Run B: the SAME model and leader, a newer Run (Codex P1 #2542: "unchanged leader/model variants").
const RUN_B_AT = '2026-10-01T12:30:00.000Z';
const runB = () => ({ ...D3.body.analysis_state, run_state: { ...D3.body.analysis_state.run_state, computed_at: RUN_B_AT } });

const dispatch = vi.hoisted(() => ({ calls: [] as Rec[], answer: 'measured' as 'measured' | 'stale' | 'unavailable', during: null as null | (() => void), run: null as null | Rec, block: null as null | Rec, gate: null as null | Promise<void> }));
vi.mock('../../handlers/decision-flip-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchDecisionFlip: vi.fn(async (params: Rec) => {
    dispatch.calls.push(params);
    dispatch.during?.();
    if (dispatch.gate !== null) await dispatch.gate; // a measurement still running (the claim-wait rows)
    return dispatch.answer === 'stale' ? { status: 'stale' }
      : dispatch.answer === 'unavailable' ? { status: 'unavailable', reason: 'client_without_decision_flip' }
      : { status: 'measured', block: dispatch.block ?? ISL_D3_BLOCK, links: params.candidateLinks.slice(0, 2), run: dispatch.run ?? D3_RUN };
  }),
}));

const SCENARIO_BASE = '8e3f4a51-6c7d-4e8f-9a01-b2c3d4e5f6';
let n = 0;
let SCENARIO = '';
const rows = new Map<string, Rec>();
// Store races the append-repair rows model: one answer read that misses a committed row (`hideOnce`), and an append the
// store reports as a replay because the row already exists under that key (`replayKey`, as the real store classifies it).
const storeCtl = { hideOnce: null as string | null, replayKey: null as string | null };
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const k = `${sid}:${turnId}`;
    if (storeCtl.hideOnce === k) { storeCtl.hideOnce = null; return null; }
    return rows.get(k) ?? null;
  }),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Rec) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (rows.has(k) && storeCtl.replayKey === k) return { id: rows.get(k)!.id, replayedPriorTurn: true as const };
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

// Each of RC's three measured sentence kinds, from ISL's real D3 links.
const [savings, overspend] = ISL_D3_BLOCK.links;
const STATUSES: Record<string, { block: Rec; said: RegExp }> = {
  quoted: { block: { ...ISL_D3_BLOCK, links: [savings] }, said: /‘[^’]+’ would be the first to be supported by the most runs if monthly cloud savings's effect on monthly spend fell below about a quarter/ },
  below_a_tenth: { block: { ...ISL_D3_BLOCK, links: [{ ...savings, threshold: -0.02, replicate_thresholds: [-0.02, -0.02, -0.02, -0.02], replicate_range: 0 }] },
    said: /‘[^’]+’ would be the first to be supported by the most runs only if monthly cloud savings's effect on monthly spend all but disappeared/ },
  no_change: { block: { ...ISL_D3_BLOCK, links: [overspend] }, said: /‘[^’]+’ would still be supported by the most runs even if monthly cloud overspend during migration's average effect/ },
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
    app = await buildApp();
  }, 120_000);
  /** A fresh import of the route is a fresh PROCESS: nothing remembered, the same store of committed rows. */
  const buildApp = async (): Promise<FastifyInstance> => {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const app = Fastify({ logger: false });
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
    return app;
  };
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    modelCalls = 0; dispatch.calls.length = 0; dispatch.answer = 'measured'; dispatch.during = null; dispatch.run = null; dispatch.block = null; dispatch.gate = null;
    storeCtl.hideOnce = null; storeCtl.replayKey = null;
    served.state = D3.body.analysis_state; served.result = D3.body.analysis_result; served.ready = undefined; served.reads = 0; served.afterRead = null;
    n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`;
  });

  /** The UI's retry (DGAI `retryLast`): the same words under the same turn_id, `source: 'retry'`, the chip omitted or null. */
  const retryChipless = async (on: FastifyInstance, turnId: string, chip: 'omitted' | 'null') => {
    const r = await on.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: PRESS.message, source: 'retry', turn_id: turnId, ...(chip === 'null' ? { chip: null } : {}) } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { assistant_text: string };
  };
  const post = async (chipId: string, message: string, turnId?: string) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, source: 'chip', chip: { id: chipId }, ...(turnId !== undefined ? { turn_id: turnId } : {}) } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { assistant_text: string; suggested_actions: { id: string }[] };
  };

  // ⛔ WITHDRAWN (Paul 21 Oct, no win framing; DL ruling): ISL's measured tipping copy ("would be supported by the most runs")
  // no longer answers the press. It is never asked for, and the Run's own tipping-point coaching answers instead.
  it('W1: the press asks ISL for nothing, makes no model call, and never says "supported by the most runs"', async () => {
    const body = await post(PRESS.id, PRESS.message);
    expect(modelCalls).toBe(0);
    expect(dispatch.calls).toHaveLength(0);
    expect(body.assistant_text).not.toMatch(/supported by the most runs/);
    // CONTRAST: the press is still answered (the Run's coaching), never left empty.
    expect(body.assistant_text.trim().length).toBeGreaterThan(0);
  });

  it('W2: a retry of that press is answered the same way, still with nothing asked of ISL', async () => {
    const turnId = randomUUID();
    const first = await post(PRESS.id, PRESS.message, turnId);
    const retried = await retryChipless(app, turnId, 'omitted');
    expect(dispatch.calls).toHaveLength(0);
    // The live reply may carry the leader gate's caveat first (egress, not this turn); the answer is its last paragraph.
    expect(first.assistant_text.endsWith(retried.assistant_text), `${first.assistant_text} | ${retried.assistant_text}`).toBe(true)
    expect(retried.assistant_text).not.toMatch(/supported by the most runs/);
  });
});
