import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parseRequestExtensions } from '../../boundary/request-extensions.js';
import { OpenAIAdapter } from '../../../adapters/llm/openai.js';
import { projectDraftRecords } from '../../../cee/draft/records/seam.js';
import { stripModelAuthoredGoalThreshold } from '../../../adapters/llm/normalisation.js';
import { checkFieldSafety, stripPipelineOwnedFromAddOperations } from '../../graph-management/field-safety.js';
import { refereeMutation } from '../../graph-management/referee.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from '../../graph-management/__tests__/fixtures.js';
import { applyStructuralAdd } from '../../system-events/structural-add.js';
import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import { horizonBasisMetricKey, horizonSteadyAttested } from '../horizon-basis.js';
import { applyGoalSteadyEdit, goalSteadyPostimageIsScoped } from '../goal-steady-write.js';
import { __setUseAppendV6ForTest } from '../../session/supabase-store.js';

const sdk = vi.hoisted(() => ({ draft: '', calls: 0 }));
vi.mock('openai', () => ({ default: class {
  chat = { completions: { create: async () => {
    sdk.calls += 1;
    return { choices: [{ message: { content: sdk.draft }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 }, model: 'gpt-4o-mini' };
  } } };
} }));
// Real entry functions; only storage/auth/telemetry and the model adapter are doubles.
vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, llm: { ...actual.config.llm, openaiApiKey: 's5-sdk-double' }, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../../utils/telemetry.js', async original => ({
  ...await original<typeof import('../../../utils/telemetry.js')>(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
}));
vi.mock('../../../orchestrator/user-identity.js', () => ({
  resolveUserIdentity: vi.fn(async () => ({ mode: 'verified', userId: 'u-1' })),
}));
vi.mock('../../session/index.js', async original => ({
  ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => activeStore,
}));
import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import { runTurnExecutor } from '../../turn-executor.js';

type Rec = Record<string, any>;
const SCENARIO = 'd9e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60';
const TURN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const seed = (): Rec => projectGraphForPersistence(GraphV3.parse({
  nodes: [{ id: 'goal', kind: 'goal', label: 'Service quality', goal_horizon_months: 9, goal_threshold_unit: '%' },
    { id: 'option', kind: 'option', label: 'Pilot', interventions: { factor: { value: 0.2, source: 'cee_hypothesis',
      target_match: { node_id: 'factor', match_type: 'exact_id', confidence: 'high' } } } },
    { id: 'factor', kind: 'factor', label: 'Coverage', observed_state: { value: 0.5, source: 'user_override' } }],
  edges: [['option', 'factor'], ['factor', 'goal']].map(([from, to]) => ({ from, to,
    strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
})) as Rec;
const goalOf = (g: Rec, id = 'goal'): Rec => g.nodes.find((n: Rec) => n.id === id);
const metric = (g: Rec, scenario = SCENARIO, id = 'goal') => {
  const goal = goalOf(g, id);
  return createHash('sha256').update(JSON.stringify([scenario, id, goal.label.trim().toLowerCase().replace(/\s+/g, ' '),
    goal.goal_threshold_unit ?? null, goal.goal_horizon_months])).digest('hex').slice(0, 32);
};
const attested = (): Rec => {
  const g = seed();
  goalOf(g).horizon_basis = { basis: 'steady_attested', source: 'user_stated', bound_months: 9, metric: metric(g) };
  return g;
};
function world(initial: unknown) {
  let bytes = JSON.stringify(initial);
  const writes: SessionTurnWrite[] = [];
  const read = () => JSON.parse(bytes) as Rec;
  const store = createMockSessionStore({
    loadGraph: async id => { expect(id).toBe(SCENARIO); return read(); },
    loadGraphAndBriefText: async () => ({ graph: read(), briefText: null, revision: 31 }),
    append: async write => {
      expect(write.scenario_id).toBe(SCENARIO);
      writes.push(clone(write));
      if (write.graph != null) bytes = JSON.stringify(write.graph);
      return { id: 'row-1' };
    },
    readRecent: async () => writes.map(write => makeSessionTurnRow({ id: 'row-1', scenario_id: SCENARIO,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, assistant_message: write.assistantMessage ?? null })),
    readFactsWithTurnFor: async () => writes.flatMap(write => write.handler_facts.map(fact => ({
      turn_id: 'row-1', fact_created_at: '2026-10-09T00:00:00.000Z', fact }))),
    readCommittedTurn: async () => null,
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readMostRecentPendingActions: async () => [],
  });
  return { store, writes, read };
}
let activeStore = world(null).store;
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  __setUseAppendV6ForTest(false);
});
afterEach(() => { vi.unstubAllEnvs(); __setUseAppendV6ForTest(undefined); });
function input(g: Rec, extra: Rec = {}) {
  return { targets: [], goalSteady: { goal_id: 'goal', months: 9 }, scenarioId: SCENARIO, turnId: TURN,
    requestId: 's5-door', stage: 'analyse' as const, requestHash: 's5-request', freshness: 'fresh' as const,
    hasExistingAnalysis: false, expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!, ...extra };
}
async function register(g: Rec, w: ReturnType<typeof world>) {
  activeStore = w.store;
  const app = Fastify();
  await registerRoute(app);
  try {
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph: g } });
    expect(res.statusCode, res.body).toBe(200);
    expect(w.writes).toHaveLength(1);
    return w.read();
  } finally { await app.close(); }
}
async function turn(g: Rec, w: ReturnType<typeof world>) {
  activeStore = w.store;
  await runTurnExecutor({ kind: 'message', source: 'composer', turn_id: TURN, scenario_id: SCENARIO,
    message: 'any thoughts?', turn_class: 'frame', stage: 'analyse' }, 's5-first-touch', {
    graphState: g as never,
    routingAdapter: { chatWithTools: vi.fn(async () => ({ content: [{ type: 'text', text: 'Consider the assumptions.' }],
      stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, model: 'test-double', latencyMs: 0 })) } as never,
  });
  expect(w.writes).toHaveLength(1);
  return w.read();
}

describe('S5 horizon_basis door: real ingress and commit paths, bound to goal + scenario', () => {
  it.each([false, true])('R1 one approved goal writes the typed object with one commit and exact confirmation (v6: %s)', async v6 => {
    __setUseAppendV6ForTest(v6);
    const g = seed(), w = world(g);
    const r = await executeOptionInterventionBatch(input(g), w.store);
    expect(r.kind).toBe('committed');
    expect(w.writes).toHaveLength(1);
    expect(goalOf(w.read()).horizon_basis).toEqual(goalOf(attested()).horizon_basis);
    expect(w.writes[0]!.assistantMessage).toBe('Recorded as your judgement: ‘Service quality’ stays about the same over 9 months unless you act. Then run the analysis again.');
    expect(horizonSteadyAttested(w.read(), SCENARIO)).toBe(true);
    expect(goalOf(g)).not.toHaveProperty('horizon_basis');
    expect(goalSteadyPostimageIsScoped(g, w.read(), { goal_id: 'goal', months: 9 }, SCENARIO)).toBe(true);
  });
  it('R1 dispatch in-process goal_steady reaches the same one-commit writer', async () => {
    const g = seed(), w = world(g); activeStore = w.store;
    const result = await commitOptionLevelsInProcess({ scenario_id: SCENARIO, turn_id: TURN, stage: 'analyse',
      base_graph_hash: computeAnalysisAffectingGraphHash(g as never)!, levels: [], links: [],
      goal_steady: { goal_id: 'goal', months: 9 } }, 's5-dispatch');
    expect(result.status).toBe('committed');
    expect(w.writes).toHaveLength(1);
    expect(goalOf(w.read()).horizon_basis).toEqual(goalOf(attested()).horizon_basis);
  });
  it.each([
    { targets: [{ optionId: 'option', factorId: 'factor', modelValue: 0.3 }] },
    { values: [{}] }, { frames: [{}] }, { linkStrengths: [{}] }, { linkEffect: {} }, { linkEffects: [{}] },
    { identityConfirm: {} }, { goalHorizon: {} }, { teamTime: {} }, { expectedLinks: ['option::factor'] }, { optionGaps: [{}] },
  ])('R2 alone-only refuses another member: %j', async member => {
    const g = seed(), w = world(g);
    expect(await executeOptionInterventionBatch(input(g, member), w.store)).toMatchObject({ kind: 'refused', reason: 'goal_steady_not_alone' });
    expect(w.writes).toHaveLength(0);
    expect(w.read()).toEqual(g);
  });
  it('R3 changed months refuse without committing', async () => {
    const g = seed(), w = world(g);
    expect(await executeOptionInterventionBatch(input(g, { goalSteady: { goal_id: 'goal', months: 12 } }), w.store))
      .toMatchObject({ kind: 'refused', reason: 'goal_month_changed' });
    expect(w.writes).toHaveLength(0);
  });
  it.each(['label', 'unit', 'months', 'scenario', 'id'])('R4 key voids after %s moves', field => {
    const issued = applyGoalSteadyEdit(seed(), { goal_id: 'goal', months: 9 }, SCENARIO);
    if (issued.kind !== 'mutated') throw new Error('not written');
    const g = issued.mutatedGraph;
    expect(horizonSteadyAttested(g, SCENARIO)).toBe(true);
    if (field === 'label') goalOf(g).label = 'Annual revenue';
    if (field === 'unit') goalOf(g).goal_threshold_unit = '£/year';
    if (field === 'months') goalOf(g).goal_horizon_months = 12;
    if (field === 'id') goalOf(g).id = 'other_goal';
    expect(horizonSteadyAttested(g, field === 'scenario' ? 'different-scenario' : SCENARIO)).toBe(false);
  });
  it('R4 normalisation and exact key match parked sha256 tuple', () => {
    const g = attested(); goalOf(g).label = '  SERVICE   quality  ';
    expect(horizonBasisMetricKey(goalOf(g), SCENARIO)).toBe(metric(g));
    expect(horizonSteadyAttested(g, SCENARIO)).toBe(true);
  });
  it.each([false, true])('R5 register/import drops a complete client forgery (existing: %s)', async existing => {
    const g = attested(), w = world(existing ? seed() : null);
    expect(horizonSteadyAttested(g, SCENARIO)).toBe(true);
    expect(goalOf(await register(g, w))).not.toHaveProperty('horizon_basis');
  });
  it('R5 graph_state boundary drops client basis without changing caller bytes', () => {
    const g = attested(), before = clone(g);
    const parsed = parseRequestExtensions({ graph_state: g }, 's5-boundary');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('boundary refused');
    expect(goalOf(parsed.value.graphState!)).not.toHaveProperty('horizon_basis');
    expect(g).toEqual(before);
  });
  it('R5 first-touch executor cannot persist forged basis even when boundary is bypassed', async () => {
    const after = await turn(attested(), world(null));
    expect(after.nodes).toHaveLength(seed().nodes.length);
    expect(goalOf(after)).not.toHaveProperty('horizon_basis');
  });
  it('R5 structural-add ignores client basis; stored A carries back unchanged', () => {
    const g = attested(), event = { kind: 'structural_add', node_id: 'b', node_kind: 'goal', label: 'Other goal',
      base_graph_hash: computeAnalysisAffectingGraphHash(g as never), horizon_basis: goalOf(g).horizon_basis };
    const r = applyStructuralAdd({ payload: { kind: 'system_event', turn_id: TURN, scenario_id: SCENARIO,
      stage: 'frame', event } as never, event: event as never, requestId: 's5-add', persistedGraph: g });
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error('add refused');
    expect(goalOf(r.graph, 'b')).not.toHaveProperty('horizon_basis');
    expect(goalOf(r.graph).horizon_basis).toEqual(goalOf(g).horizon_basis);
  });
  it('R5 draft normalisation strips forged basis', () => {
    const g = attested(); stripModelAuthoredGoalThreshold(g);
    expect(goalOf(g)).not.toHaveProperty('horizon_basis');
  });
  it('R5 OpenAI draft adapter entry strips the model-forged basis (SDK double, zero network)', async () => {
    const g = attested(); sdk.draft = JSON.stringify(g); sdk.calls = 0;
    const result = await new OpenAIAdapter('gpt-4o-mini').draftGraph({ brief: 'Improve service quality; pilot more coverage.',
      docs: [], seed: 1 }, { requestId: 's5-draft', timeoutMs: 1000, preloadedSystemPrompt: { operation: 'draft_graph', content: 'test-only draft prompt',
        meta: { taskId: 'draft_graph', prompt_hash: 'test', source: 'default' } as never } });
    expect(sdk.calls).toBeGreaterThan(0);
    const nodes = (result.graph as Rec).nodes as Rec[];
    expect(nodes.some(n => n.id === 'goal')).toBe(true);
    expect(nodes.find(n => n.id === 'goal')).not.toHaveProperty('horizon_basis');
  });
  it('R5 records draft entry rebuilds goal bytes and discards model basis', () => {
    const result = projectDraftRecords({ stated_items: [
      { kind: 'goal', source_quote: 'Service quality', horizon_basis: goalOf(attested()).horizon_basis },
      { kind: 'option', source_quote: 'Pilot' },
    ], claims: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('record draft refused');
    const goal = result.projection.graph.nodes.find(n => n.kind === 'goal');
    expect(goal).toBeDefined();
    expect(goal).not.toHaveProperty('horizon_basis');
  });
  it.each(['omitted', 'forged'])('R6 register carries server bytes byte-identically (%s client)', async mode => {
    const g = attested(), w = world(g), client = clone(g);
    if (mode === 'omitted') delete goalOf(client).horizon_basis;
    else goalOf(client).horizon_basis.metric = 'f'.repeat(32);
    expect(JSON.stringify(goalOf(await register(client, w)).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it('R6 turn server model wins over client omission and forgery', async () => {
    const g = attested(), client = seed(), w = world(g);
    expect(JSON.stringify(goalOf(await turn(client, w)).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it('R6 ordinary batch carries stored basis unchanged', async () => {
    const g = attested(), w = world(g);
    const r = await executeOptionInterventionBatch(input(g, { goalSteady: undefined,
      targets: [{ optionId: 'option', factorId: 'factor', modelValue: 0.3 }] }), w.store);
    expect(r.kind).toBe('committed');
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it.each(['olumi_reading', 'missing_metric', 'extra', 'fraction', 'wrong_basis'])('R7 malformed stored object reads absent: %s', mode => {
    const g = attested(), b = goalOf(g).horizon_basis;
    if (mode === 'olumi_reading') b.source = mode;
    if (mode === 'missing_metric') delete b.metric;
    if (mode === 'extra') b.extra = true;
    if (mode === 'fraction') b.bound_months = 1.5;
    if (mode === 'wrong_basis') b.basis = 'inferred';
    expect(NodeV3.parse(goalOf(g)).horizon_basis).toBeUndefined();
    expect(horizonSteadyAttested(g, SCENARIO)).toBe(false);
  });
  it('R8 field-safety rejects LLM update and strips add-node basis', () => {
    const basis = goalOf(attested()).horizon_basis;
    expect(checkFieldSafety({ kind: 'update_node_field', payload: { node_id: 'goal', field: 'horizon_basis', to: basis } } as never))
      .toMatchObject({ ok: false, code: 'PIPELINE_OWNED_FIELD' });
    const ready = buildReadyGraph();
    const screened = refereeMutation(makeEnvelope('update_node_field', { node_id: 'g-profit', field: 'horizon_basis',
      from: null, to: basis }, { base_graph_hash: hashOf(ready) }), ready, frameFor(ready));
    expect(screened.blocker?.code).toBe('PIPELINE_OWNED_FIELD');
    const result = stripPipelineOwnedFromAddOperations([{ op: 'add_node', value: goalOf(attested()) }]);
    expect(result.operations[0]!.value).not.toHaveProperty('horizon_basis');
  });
  it('R9 press moves analysis hash and no-op re-press does not commit', async () => {
    const g = seed(), w = world(g), hash = computeAnalysisAffectingGraphHash(g as never);
    expect((await executeOptionInterventionBatch(input(g), w.store)).kind).toBe('committed');
    const after = w.read(), moved = computeAnalysisAffectingGraphHash(after as never);
    expect(moved).not.toBe(hash);
    expect(await executeOptionInterventionBatch(input(after), w.store)).toEqual({ kind: 'unchanged' });
    expect(w.writes).toHaveLength(1);
    expect(computeAnalysisAffectingGraphHash(w.read() as never)).toBe(moved);
  });
  it('R9 stored bytes and goal meaning are hashed without validity interpretation', () => {
    for (const field of ['label', 'goal_threshold_unit', 'goal_horizon_months']) {
      const g = attested(), hash = computeAnalysisAffectingGraphHash(g as never);
      goalOf(g)[field] = field === 'goal_horizon_months' ? 12 : 'changed';
      expect(computeAnalysisAffectingGraphHash(g as never)).not.toBe(hash);
    }
    const g = attested(), hash = computeAnalysisAffectingGraphHash(g as never);
    goalOf(g).horizon_basis.source = 'olumi_reading';
    expect(computeAnalysisAffectingGraphHash(g as never)).not.toBe(hash);
  });
  it('R10 two goals: door targets B, A untouched, no one-goal licence', async () => {
    const g = seed(); g.nodes.push({ ...clone(goalOf(g)), id: 'b' });
    const w = world(g);
    expect((await executeOptionInterventionBatch(input(g, { goalSteady: { goal_id: 'b', months: 9 } }), w.store)).kind).toBe('committed');
    expect(goalOf(w.read())).toEqual(goalOf(g));
    expect(goalOf(w.read(), 'b').horizon_basis.metric).toBe(metric(g, SCENARIO, 'b'));
    expect(horizonSteadyAttested(w.read(), SCENARIO)).toBe(false);
  });
  it('door scope refuses unrelated changes, missing goal and wrong scenario key', () => {
    const g = seed(), edit = applyGoalSteadyEdit(g, { goal_id: 'goal', months: 9 }, SCENARIO);
    expect(edit.kind).toBe('mutated');
    if (edit.kind !== 'mutated') throw new Error('no edit');
    edit.mutatedGraph.edges = [];
    expect(goalSteadyPostimageIsScoped(g, edit.mutatedGraph, { goal_id: 'goal', months: 9 }, SCENARIO)).toBe(false);
    expect(applyGoalSteadyEdit(g, { goal_id: 'missing', months: 9 }, SCENARIO).kind).toBe('refused');
    expect(horizonSteadyAttested(attested(), undefined)).toBe(false);
    const carrier = attested(); carrier.nodes.push({ id: 'stock', nonlinear_identity: { operation: 'accumulation' } });
    expect(horizonSteadyAttested(carrier, SCENARIO)).toBe(false);
  });
});
