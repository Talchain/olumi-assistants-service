import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { structuralChallengePressId } from '../method-turn/structural-challenge-turn.js';

type Rec = Record<string, any>;
const LINK = { from_id: 'driver_retention', to_id: 'goal_value' };
const RUN_A = 'run-a';
const RUN_B = 'run-b';
const SCENARIO = '8e3f4a51-6c7d-4e8f-9a01-b2c3d4e5f6';
const PRESS = structuralChallengePressId(LINK);
const dispatch = vi.hoisted(() => ({ calls: [] as Rec[] }));
const graphReads = vi.hoisted(() => ({ count: 0 }));
const state = vi.hoisted(() => ({ run: 'run-a', permission: 'licensed' as 'licensed' | 'withdrawn' }));

vi.mock('../../handlers/structural-challenge-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchStructuralChallenge: vi.fn(async (params: Rec) => {
    dispatch.calls.push(params);
    return { kind: 'result', result: { status: 'completed', baseline: { run_id: RUN_A, scenario_id: SCENARIO, graph_hash_at_run: 'graph-a', sent_digest: 'sent-a', seed_used: 7, n_samples: 1000 }, alternative: { op: 'remove_link', ...LINK, origin: 'user_selected', sizing: 'unmarked' }, claims: [{ kind: 'leader', baseline_option_id: 'option_a', alternative_option_id: 'option_a', verdict: 'holds', basis: 'within_noise', invariant_by_construction: false }], pair_provenance: null, not_compared: [], attribution_case: 'C2_unpaired', retention: 'not_retained' }, labels: new Map([['driver_retention', 'Driver retention'], ['goal_value', 'Goal value'], ['option_a', 'Option A']]), baselineRunIdentity: { run_id: state.run, scenario_id: SCENARIO, graph_hash_at_run: 'graph-a' }, finalRead: undefined };
  }),
}));

vi.mock('../method-turn/structural-challenge-turn.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    structuralChallengeTurnUnderLicence: (turn: Rec) => turn,
    structuralChallengeTurnFor: vi.fn(async (chipId: unknown, ask: (link: typeof LINK) => Promise<Rec>) => {
      if (chipId === undefined || typeof chipId !== 'string' || !chipId.startsWith('agent-test-without-link:')) return null;
      const parsed = actual.parseStructuralChallengePress(chipId);
      if (parsed === null) return { reply: 'This test needs a link between two distinct nodes with valid recorded identities. Nothing in your model changed.', outcome: 'unsupported', result: null, labels: new Map(), actions: [{ id: 'agent-talk-it-through' }] };
      const result = await ask(parsed);
      if (state.permission === 'withdrawn') return { reply: 'The current analysis permission does not allow this comparison to be shown, so there is no conclusion to report. Nothing in your model changed.', outcome: 'withheld', result: null, labels: new Map(), actions: [{ id: 'agent-talk-it-through' }] };
      if (state.run !== RUN_A) return { reply: 'Your model has changed since this analysis ran, so I can\'t test it against that run. Run the analysis again, then try this test.', outcome: 'stale', result: null, labels: new Map(), actions: [{ id: 'agent-talk-it-through' }] };
      return { reply: 'Without the link from Driver retention to Goal value, the tested conclusions still hold. This test is not saved.', outcome: 'completed', result: result.result, labels: result.labels, actions: [{ id: 'agent-talk-it-through' }] };
    }),
  };
});

const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Rec) => { const key = `${w.scenario_id}:${w.turn_id}`; rows.set(key, { id: `row-${rows.size + 1}` }); return { id: rows.get(key)!.id }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }) }));

describe('agent route: structural challenge press', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'normal' }] }] }), { status: 200 })));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => { graphReads.count += 1; return { graph: { nodes: [{ id: LINK.from_id, kind: 'factor', label: 'Driver retention' }, { id: LINK.to_id, kind: 'goal', label: 'Goal value' }], edges: [{ from: LINK.from_id, to: LINK.to_id }] }, graph_hash: 'graph-a', analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-04T10:00:00.000Z' } }, analysis_ready: { status: 'ready', may_run: true } }; });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'normal', blocks: [] }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { dispatch.calls.length = 0; graphReads.count = 0; store.append.mockClear(); state.run = RUN_A; state.permission = 'licensed'; });
  const post = async (chip: string | undefined, message = 'test') => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, source: chip ? 'chip' : 'user', ...(chip ? { chip: { id: chip } } : {}) } }));

  it('current licensed Run: replies structurally, makes no model call, appends no graph change, and marks fastPath method', async () => {
    const response = await post(PRESS); const body = response.json();
    expect(response.statusCode).toBe(200); expect(body.assistant_text).toContain('Without the link'); expect(body._diagnostic_trace.fast_path).toBe('method');
    expect(dispatch.calls).toHaveLength(1); expect(dispatch.calls[0].link).toEqual(LINK); expect(dispatch.calls[0].requestId).toContain('structural-challenge');
    expect(store.append).toHaveBeenCalledTimes(0); expect(body._agent?.tool_calls ?? []).toEqual([]);
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
  it.each(['not-a-press', 'agent-test-without-link:', 'agent-test-without-link:["driver_retention"]'])('malformed or unknown press falls through to normal handling: %s', async (chip) => {
    const response = await post(chip, 'normal'); const body = response.json();
    expect(response.statusCode).toBe(200); expect(dispatch.calls).toHaveLength(0); expect(body.assistant_text).toBe('normal');
  });
});
