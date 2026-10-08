import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimPermissionsFrom } from '../first-analysis.js';
import { STRUCTURAL_CHALLENGE_LINES, structuralChallengePressId } from '../method-turn/structural-challenge-turn.js';

type Rec = Record<string, any>;
const LINK = { from_id: 'driver_retention', to_id: 'goal_value' };
const RUN_A = 'run-a';
const RUN_B = 'run-b';
const SCENARIO = '8e3f4a51-6c7d-4e8f-9a01-b2c3d4e5f6';
const PRESS = structuralChallengePressId(LINK);
const dispatch = vi.hoisted(() => ({ calls: [] as Rec[], baseline: null as Rec | null }));
const OPTIONS = [{ id: 'option_a', kind: 'option', label: 'Option A' }, { id: 'option_b', kind: 'option', label: 'Option B' }];
const graphReads = vi.hoisted(() => ({ count: 0, noGraph: false }));
const state = vi.hoisted(() => ({ run: 'run-a', permission: 'licensed' as 'licensed' | 'withdrawn', throws: false, noRun: false, provisionalReceipt: false }));

vi.mock('../../handlers/structural-challenge-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  /** This isolated route spec stubs both read seams; reachability rows exercise the real canonical reader. */
  readStructuralChallengeReceipt: vi.fn(async () => {
    const readState = { run_state: { kind: 'complete_current' }, requires_rerun: false,
      leader_claim: { permitted: state.permission === 'licensed', separation: 'separated' } };
    const permissions = claimPermissionsFrom(readState, { analysis_admission: { structurally_analysable: true,
      permitted_analysis_mode: state.provisionalReceipt ? 'quantified_provisional' : 'comparative_leader' } }, { requested: true });
    return { read: { analysis_state: readState, analysis_result: { type: 'analysis_result' } },
      currentness: { readOk: true, permissions, fact: { fact_type: 'run_analysis', result: {
        run_id: state.run, scenario_id: SCENARIO, graph_hash_at_run: 'a'.repeat(16), computed_at: '2026-10-04T10:00:00.000Z',
        enrichment: { meta: { seed_used: '7', n_samples: 1000 } },
        input_snapshot: { snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null, options: [], options_not_sent: [], factors: [], constraints: [], links: [] },
      } } } };
  }),
  dispatchStructuralChallenge: vi.fn(async (params: Rec) => {
    dispatch.calls.push(params);
    if (state.throws) throw new Error('offline SCI-DEEP dispatch exception');
    if (state.noRun) return { kind: 'no_run' };
    const baseline = { run_id: RUN_A, scenario_id: SCENARIO, graph_hash_at_run: 'a'.repeat(16), sent_digest: 'a'.repeat(64), seed_used: '7', n_samples: 1000 };
    dispatch.baseline = baseline;
    const missing = params.link.from_id === 'absent';
    const bidirected = params.link.from_id === 'shared';
    const status = missing || bidirected ? 'unsupported' : state.permission === 'withdrawn' ? 'withheld' : state.run !== RUN_A ? 'stale' : 'completed';
    const reason = missing ? 'link_not_found' : bidirected ? 'bidirected_link' : state.permission === 'withdrawn' ? 'exploratory_work_not_permitted' : state.run !== RUN_A ? 'run_not_current' : null;
    const readState = { run_state: { kind: 'complete_current' }, requires_rerun: false, leader_claim: { permitted: true, separation: 'separated' } };
    const permissions = claimPermissionsFrom(readState, { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } }, { requested: true });
    return { kind: 'result', result: { status, reason, baseline,
      alternative: { op: 'remove_link', ...params.link, origin: 'user_selected', sizing: 'unmarked' },
      claims: status === 'completed' ? [{ kind: 'leader', baseline_option_id: 'option_a', alternative_option_id: 'option_a', verdict: 'holds', basis: 'within_noise', invariant_by_construction: false },
        { kind: 'goal_probability', option_id: 'option_a', constraint_id: null, baseline: 0.53, alternative: 1,
          target: null, constraint_boundary: null, noise_verdict: 'signal', verdict: 'changes', basis: 'certainty_boundary_crossed', invariant_by_construction: false },
        { kind: 'constraint_probability', option_id: 'option_b', constraint_id: 'limit_cost', baseline: 0.3, alternative: 0.6,
          target: null, constraint_boundary: null, noise_verdict: 'signal', verdict: 'delta_only', basis: 'no_licensed_boundary', invariant_by_construction: false }] : [],
      pair_provenance: null, not_compared: [], attribution_case: 'C2_unpaired', retention: 'not_retained' },
      labels: new Map([['driver_retention', 'Driver retention'], ['goal_value', 'Goal value'], ['option_a', 'Option A'], ['option_b', 'Option B'], ['limit_cost', 'Cost limit']]),
      certainty: { baseline: [], alternative: [{ option_id: 'option_a', probability_of_goal: 1, earned: true }],
        baselineDisplay: { option_a: 'about 53%' }, alternativeDisplay: { option_a: '100%' } },
      candidateLeaderLicence: 'permitted', baselineRunIdentity: { run_id: RUN_A, scenario_id: SCENARIO, graph_hash_at_run: 'a'.repeat(16), computed_at: '2026-10-04T10:00:00.000Z' },
      finalRead: { read: { analysis_state: readState }, currentness: { readOk: true, permissions, fact: {
        fact_type: 'run_analysis', result: { ...baseline, computed_at: '2026-10-04T10:00:00.000Z',
          enrichment: { meta: { seed_used: baseline.seed_used, n_samples: baseline.n_samples } },
          input_snapshot: { snapshot_version: 1, sent_digest: baseline.sent_digest, goal: null, options: [], options_not_sent: [], factors: [], constraints: [], links: [] } },
      } } } };

  }),
}));

const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  releaseTurnClaim: vi.fn(async (sid: string, turnId: string, hash: string) => {
    const key = `${sid}:${turnId}`;
    if (rows.get(key)?.request_hash === hash) rows.delete(key);
  }),
  storeDraftGraph: vi.fn(async () => {}),
  append: vi.fn(async (w: Rec) => { const key = `${w.scenario_id}:${w.turn_id}`; rows.set(key, { ...w, assistant_message: w.assistantMessage, user_message: w.userMessage, id: `row-${rows.size + 1}` }); return { id: rows.get(key)!.id }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }) }));

describe('agent route: structural challenge press', () => {
  let app: FastifyInstance;
  let turnId: string;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'normal' }] }] }), { status: 200 })));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => { graphReads.count += 1; if (graphReads.noGraph) return {}; return { graph: { nodes: [{ id: LINK.from_id, kind: 'factor', label: 'Driver retention' }, { id: LINK.to_id, kind: 'goal', label: 'Goal value' }, ...OPTIONS], edges: [{ from: LINK.from_id, to: LINK.to_id }] }, graph_hash: 'graph-a', analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-04T10:00:00.000Z' }, leader_claim: { permitted: state.permission === 'licensed', separation: 'separated' } }, analysis_ready: { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: state.provisionalReceipt ? 'quantified_provisional' : 'comparative_leader' } } }; });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'normal', blocks: [] }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); dispatch.baseline = null; state.provisionalReceipt = false; turnId = randomUUID(); state.throws = false; state.noRun = false; graphReads.noGraph = false; store.releaseTurnClaim.mockClear(); store.storeDraftGraph.mockClear(); dispatch.calls.length = 0; graphReads.count = 0; store.append.mockClear(); vi.mocked(fetch).mockClear(); state.run = RUN_A; state.permission = 'licensed'; });
  const post = async (chip: string | undefined, message = 'test') => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message, source: chip ? 'chip' : 'user', ...(chip ? { chip: { id: chip } } : {}) } }));

  it('current licensed Run: replies structurally, makes no model call, appends no graph change, and marks fastPath method', async () => {
    const response = await post(PRESS); const body = response.json();
    expect(response.statusCode).toBe(200); expect(body.assistant_text).toContain('Without the link'); expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(LINK); expect(dispatch.calls[0].requestId).toContain('structural-challenge');
    expect(store.append).toHaveBeenCalledTimes(2); expect(store.append.mock.calls.filter(([write]) => write.turn_id === turnId)).toHaveLength(1); expect(store.storeDraftGraph).not.toHaveBeenCalled(); expect(body._agent.mutated).toBe(false); expect(body._agent?.tool_calls ?? []).toEqual([]);
  });
  it('accel P24 / SCI-10: a completed test carries its typed rows beside the reply, bound to the pressed link; a stale one carries none', async () => {
    const body = (await post(PRESS)).json();
    expect(body._method_result).toMatchObject({ v: 1, action_id: 'test_link', outcome: 'completed', scenario_id: SCENARIO, turn_id: turnId });
    expect(body._method_result.run).toEqual({ graph_hash_at_run: dispatch.baseline!.graph_hash_at_run, run_id: dispatch.baseline!.run_id });
    const rows = body._method_result.rows as Rec[];
    expect(rows.map((r) => r.row_id)).toEqual(expect.arrayContaining(['tested', 'goal:option_a', 'limit:option_b:limit_cost', 'not_saved']));
    for (const row of rows) {
      expect(body.assistant_text).toContain(row.text);
      expect(row.item_refs.filter((ref: Rec) => ref.kind === 'link')).toEqual(
        row.row_id === 'provisional' || row.row_id === 'not_saved' ? [] : [{ kind: 'link', ...LINK }]);
      if (row.row_id.startsWith('goal:') || row.row_id.startsWith('limit:')) {
        const optionRefs = row.item_refs.filter((ref: Rec) => ref.kind === 'option');
        expect(optionRefs).toHaveLength(1);
        expect(OPTIONS.map((option) => option.id)).toContain(optionRefs[0].id);
        expect(row.item_refs).toEqual([{ kind: 'option', id: row.row_id.startsWith('goal:') ? OPTIONS[0].id : OPTIONS[1].id }, { kind: 'link', ...LINK }]);
      }
      for (const figure of row.figures ?? []) expect(body.assistant_text).toContain(figure);
      expect(row.text).not.toMatch(/\bleads?\b/);
    }
    expect(body.assistant_text).toMatch(/\bleads?\b/); // control: the lead line is in the chat, never in a row
    turnId = randomUUID(); state.run = RUN_B;
    const stale = (await post(PRESS)).json();
    expect(stale._method_result).toMatchObject({ v: 1, action_id: 'test_link', outcome: 'stale', rows: [] });
  });
  it('builds rows from the final licensed presentation: a provisional final receipt adds its disclosure', async () => {
    state.provisionalReceipt = true; // dispatch's receipt remains comparative; only the final receipt narrows it
    const body = (await post(PRESS)).json();
    expect(body.assistant_text).toContain(STRUCTURAL_CHALLENGE_LINES.provisional);
    expect(body._method_result.rows.find((row: Rec) => row.row_id === 'provisional')).toMatchObject({
      text: STRUCTURAL_CHALLENGE_LINES.provisional, item_refs: [],
    });
    expect(body._method_result.turn_id).toBe(turnId);
  });
  it('identical replay carries the same typed rows; a changed re-presentation carries no sidecar', async () => {
    const first = (await post(PRESS)).json();
    expect(first._method_result.rows.length).toBeGreaterThan(0);
    const replay = (await post(PRESS)).json();
    expect(replay._agent.replayed).toBe(true);
    expect(replay.assistant_text).toBe(first.assistant_text);
    expect(replay._method_result).toEqual(first._method_result);
    expect(dispatch.calls).toHaveLength(1);
    state.provisionalReceipt = true; // same Run, different deterministic licensed presentation
    const changed = (await post(PRESS)).json();
    expect(changed._agent.replayed).toBe(true);
    expect(changed.assistant_text).not.toBe(first.assistant_text);
    expect(changed.assistant_text).toContain(STRUCTURAL_CHALLENGE_LINES.provisional);
    expect(changed._method_result).toBeUndefined();
    expect(dispatch.calls).toHaveLength(1);
  });
  it('ordinary text does not dispatch and performs no extra route read-back', async () => {
    const before = graphReads.count; const response = await post(undefined, 'ordinary message');
    expect(response.statusCode).toBe(200); expect(dispatch.calls).toHaveLength(0); expect(graphReads.count - before).toBe(1);
  });
  it.each([
    ['newer Run', () => { state.run = RUN_B; }, /model has changed.*no conclusion|model has changed/i],
    ['withdrawn permission', () => { state.permission = 'withdrawn'; }, /permission does not allow.*no conclusion/i],
  ])('final read refusal: %s is typed and has no conclusion', async (_name, mutate, expected) => {
    mutate(); const response = await post(PRESS); const body = response.json();
    expect(response.statusCode).toBe(200); expect(body.assistant_text).toMatch(expected); expect(body.assistant_text).not.toMatch(/leads in|still hold|changes\./);
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(LINK);
  });
  it('unknown press falls through to normal handling: not-a-press', async () => {
    const chip = 'not-a-press';
    const response = await post(chip, 'normal'); const body = response.json();
    expect(response.statusCode).toBe(200); expect(dispatch.calls).toHaveLength(0); expect(body.assistant_text).toBe('normal');
  });
  it.each(['agent-test-without-link:', 'agent-test-without-link:["driver_retention"]'])('prefixed malformed press gives a typed refusal with no model call: %s', async (chip) => {
    const response = await post(chip, 'normal'); const body = response.json();
    expect(response.statusCode).toBe(200); expect(dispatch.calls).toHaveLength(0);
    expect(body.assistant_text).toBe("I can't tell which link this is, so I can't test it. Nothing in your model changed.");
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(body._diagnostic_trace.timing.provider_calls).toBe(0); expect(fetch).not.toHaveBeenCalled();
    expect(store.append).toHaveBeenCalledTimes(2); expect(store.append.mock.calls.filter(([write]) => write.turn_id === turnId)).toHaveLength(1); expect(store.storeDraftGraph).not.toHaveBeenCalled(); expect(body._agent.mutated).toBe(false); expect(body._agent.tool_calls).toEqual([]);
  });
  it('canonical press absent from read-back graph reaches dispatcher typed link_not_found', async () => {
    const link = { from_id: 'absent', to_id: LINK.to_id };
    const response = await post(structuralChallengePressId(link));
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(link);
    expect(body.assistant_text).toBe("I can't test the link from absent to Goal value. That link isn't in the model this analysis ran on, so there is nothing to test. Nothing in your model changed.");
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(fetch).not.toHaveBeenCalled(); expect(body._diagnostic_trace.timing.provider_calls).toBe(0);
  });

  it('canonical press preserves dispatcher no_run even when read-back returns no graph', async () => {
    graphReads.noGraph = true; state.noRun = true;
    const response = await post(PRESS);
    expect(response.statusCode).toBe(200);
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(LINK);
    expect(response.json().assistant_text).toBe('There is no analysis to test yet. Run the analysis first, then try "Test without this link".');
    expect(response.json()._diagnostic_trace.fast_path).toBe('method');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('canonical press preserves dispatcher bidirected_link when read-back has no matching edge', async () => {
    const link = { from_id: 'shared', to_id: LINK.to_id };
    const response = await post(structuralChallengePressId(link));
    expect(response.statusCode).toBe(200);
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(link);
    expect(response.json().assistant_text).toContain("That link marks a shared cause the model doesn't measure");
    expect(response.json().assistant_text).toContain('Nothing in your model changed.');
    expect(response.json()._diagnostic_trace.fast_path).toBe('method');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a SCI-DEEP dispatch exception gives a typed, recorded failure, KEEPS its claim, and never calls a provider', async () => {
    state.throws = true;
    const response = await post(PRESS);
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.assistant_text).toBe("I couldn't finish this link test just now. Please try again. Nothing in your model changed.");
    expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(fetch).not.toHaveBeenCalled(); expect(body._diagnostic_trace.timing.provider_calls).toBe(0);
    expect(body._agent.tool_calls).toEqual([]); expect(body._agent.mutated).toBe(false);
    expect(store.storeDraftGraph).not.toHaveBeenCalled();
    expect(store.releaseTurnClaim).not.toHaveBeenCalled();
    expect(rows.has(`${SCENARIO}:${turnId}:claim`)).toBe(true);
    expect(store.append.mock.calls.filter(([write]) => write.turn_id === turnId)).toHaveLength(1);
    expect(rows.get(`${SCENARIO}:${turnId}`)?.assistant_message).toBe(body.assistant_text);
  });

});
