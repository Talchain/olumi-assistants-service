import { createHash } from 'node:crypto';
import * as graphHashes from '../../context/graph-hash.js';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { _resetConfigCache } from '../../../config/index.js';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import { prepareHorizonBasisForWrite, assertDoorProvenance } from '../horizon-basis-provenance.js';
import { createApplyOperations, currentModelRevision } from '../../apply-operations.js';
import { dispatchEditGraph } from '../../handlers/edit-graph-dispatch.js';
import { dispatchDraftGraph } from '../../handlers/draft-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeGraphIdentityHash, computeVersionAnalysisAffectingHashRecord } from '../../context/graph-identity.js';
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

vi.mock('../../../orchestrator/tools/edit-graph.js', async original => ({
  ...await original<typeof import('../../../orchestrator/tools/edit-graph.js')>(), handleEditGraph: vi.fn(),
}));
vi.mock('../../../orchestrator/tools/draft-graph.js', async original => ({
  ...await original<typeof import('../../../orchestrator/tools/draft-graph.js')>(), handleDraftGraph: vi.fn(),
}));
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
  return { ...actual, config: new Proxy(actual.config, { get(target, key) {
    if (key === 'llm') return { ...target.llm, openaiApiKey: 's5-sdk-double' };
    if (key === 'auth') return { ...target.auth, requireUserJwt: false };
    return Reflect.get(target, key);
  } }) };
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
      if (write.modelVersion !== undefined) {
        expect(write.modelVersion.graph_identity_hash).toBe(computeGraphIdentityHash(write.graph as never)?.value);
        expect(write.modelVersion.analysis_affecting_hash).toBe(computeVersionAnalysisAffectingHashRecord(write.graph as never)?.value);
      }
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
  _resetConfigCache();
  __setUseAppendV6ForTest(false);
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); __setUseAppendV6ForTest(undefined); });
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
    expect(res.json().graph_hash).toBe(computeAnalysisAffectingGraphHash(w.read() as never));
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
  it('R5 graph_state boundary echoes client basis without changing caller bytes', () => {
    const g = attested(), before = clone(g);
    const parsed = parseRequestExtensions({ graph_state: g }, 's5-boundary');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('boundary refused');
    expect(goalOf(parsed.value.graphState!).horizon_basis).toEqual(goalOf(g).horizon_basis);
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
  it('R5 draft normalisation leaves forged basis for write preparation to drop', () => {
    const g = attested(); stripModelAuthoredGoalThreshold(g);
    expect(goalOf(g)).toHaveProperty('horizon_basis');
    prepareHorizonBasisForWrite(g, null, SCENARIO);
    expect(goalOf(g)).not.toHaveProperty('horizon_basis');
  });
  it('R5 OpenAI SDK-double draft commits with model-forged basis dropped from the stored result by preparation', async () => {
    const g = attested(); sdk.draft = JSON.stringify(g); sdk.calls = 0;
    const result = await new OpenAIAdapter('gpt-4o-mini').draftGraph({ brief: 'Improve service quality; pilot more coverage.',
      docs: [], seed: 1 }, { requestId: 's5-draft', timeoutMs: 1000, preloadedSystemPrompt: { operation: 'draft_graph', content: 'test-only draft prompt',
        meta: { taskId: 'draft_graph', prompt_hash: 'test', source: 'default' } as never } });
    expect(sdk.calls).toBeGreaterThan(0);
    const nodes = (result.graph as Rec).nodes as Rec[];
    expect(nodes.some(n => n.id === 'goal')).toBe(true);
    // Positive control: forged bytes reach the candidate; the stored-result assertion below tests preparation.
    expect(goalOf(result.graph as Rec).horizon_basis).toEqual(goalOf(g).horizon_basis);
    const w = world(seed()); activeStore = w.store;
    vi.mocked(handleDraftGraph).mockResolvedValue({ blocks: [], assistantText: 'Drafted the model.', latencyMs: 0,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: result.graph } as never);
    const committed = await dispatchDraftGraph({ payload: payload('Build the model again'),
      requestId: 's5-sdk-draft-commit', request: {} as never });
    expect(committed.commitPerformed).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(goalOf(w.read()).label).toBe(goalOf(result.graph as Rec).label);
    expect(goalOf(w.read())).not.toHaveProperty('horizon_basis');
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


function doorWrite(graph: Rec): SessionTurnWrite {
  return { scenario_id: SCENARIO, turn_id: TURN, turn_class: 'direct_answer', handler_id: null,
    request_hash: 'door-unit', response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph };
}
const payload = (message: string) => ({ kind: 'message' as const, source: 'composer' as const,
  turn_id: TURN, scenario_id: SCENARIO, message, turn_class: 'frame' as const, stage: 'analyse' as const });

describe('S5 r1 append-door provenance', () => {
  it.each(['update_node', 'add_node'])('P1-1 generic approval %s cannot forge a correctly bound basis', async op => {
    const g = seed(), w = world(g);
    const forged = clone(goalOf(attested()));
    if (op === 'add_node') { forged.id = 'b'; forged.horizon_basis.metric = horizonBasisMetricKey(forged, SCENARIO); }
    const apply = createApplyOperations({ scenarioId: SCENARIO, requestId: 'r1-approval', store: w.store });
    const pendingResult = apply({ proposalId: 'r1-forge', idempotencyKey: TURN,
      modelRevision: (await currentModelRevision(SCENARIO, { store: w.store }))!,
      operations: [{ kind: 'edit_graph', summary: 'Approved update', detail: { operations: [
        { op, path: op === 'add_node' ? 'b' : 'goal', value: op === 'add_node' ? forged : { horizon_basis: forged.horizon_basis } },
      ] } }] });
    if (op === 'add_node') {
      // 99d1a77f already adds refs only inside commit, then reports a readback mismatch.
      // Keep provenance coverage through the real append without repairing that separate defect.
      await expect(pendingResult).rejects.toThrow('committed_graph_mismatch');
    } else {
      const result = await pendingResult;
      expect(result).toMatchObject({ ok: true });
      if (result.ok) expect(result.newModelRevision).toBe(computeAnalysisAffectingGraphHash(w.read() as never));
    }
    expect(w.writes).toHaveLength(1);
    expect(goalOf(w.read(), op === 'add_node' ? 'b' : 'goal')).not.toHaveProperty('horizon_basis');
  });
  it.each(['live', 'off', 'shadow'])('P1-2 echoed basis survives an unrelated real edit in %s mode', async mode => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode); _resetConfigCache();
    const g = attested(), w = world(g), client = clone(g); activeStore = w.store;
    const boundary = parseRequestExtensions({ graph_state: client }, 'r1-edit');
    if (!boundary.ok) throw new Error('invalid client');
    const after = clone(boundary.value.graphState!); after.nodes.find((n: Rec) => n.id === 'factor').label = 'Coverage revised';
    vi.mocked(handleEditGraph).mockResolvedValue({ blocks: [], assistantText: 'Renamed Coverage.', latencyMs: 0,
      wasRejected: false, operations: [{ op: 'update_node', path: 'factor', value: { label: 'Coverage revised' } }],
      appliedGraph: after, appliedChanges: { summary: 'Renamed Coverage.',
        changes: [{ label: 'Coverage', description: 'Renamed.', element_ref: 'factor' }], rerun_recommended: false } } as never);
    const result = await dispatchEditGraph({ payload: payload('Rename Coverage to Coverage revised'),
      requestId: 'r1-edit', request: {} as never, graphState: boundary.value.graphState!, analysisState: null });
    expect(JSON.stringify(result)).not.toContain('BASE_HASH_DIVERGED');
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.graph).toBeDefined();
    expect(w.read().nodes.find((n: Rec) => n.id === 'factor').label).toBe('Coverage revised');
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it.each(['live', 'off', 'shadow'])('P1-1 empty-store real edit cannot promote client basis to stored authority in %s mode', async mode => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode); _resetConfigCache();
    const client = attested(), w = world(null); activeStore = w.store;
    const boundary = parseRequestExtensions({ graph_state: client }, 'r1-empty-edit');
    if (!boundary.ok) throw new Error('invalid client');
    const after = clone(boundary.value.graphState!); after.nodes.find((n: Rec) => n.id === 'factor').label = 'Coverage revised';
    vi.mocked(handleEditGraph).mockResolvedValue({ blocks: [], assistantText: 'Renamed Coverage.', latencyMs: 0,
      wasRejected: false, operations: [{ op: 'update_node', path: 'factor', value: { label: 'Coverage revised' } }],
      appliedGraph: after, appliedChanges: { summary: 'Renamed Coverage.', changes: [], rerun_recommended: false } } as never);
    const result = await dispatchEditGraph({ payload: payload('Rename Coverage to Coverage revised'),
      requestId: 'r1-empty-edit', request: {} as never, graphState: boundary.value.graphState!, analysisState: null });
    expect(result.commitPerformed).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(w.read().nodes.find((n: Rec) => n.id === 'factor').label).toBe('Coverage revised');
    expect(goalOf(w.read())).not.toHaveProperty('horizon_basis');
    expect(goalOf(result.response.draft_graph as Rec)).not.toHaveProperty('horizon_basis');
  });
  it('P1-a forged live echo commits the rename using the stored answer', async () => {
    const g = attested(), w = world(g), client = clone(g); activeStore = w.store;
    goalOf(client).horizon_basis.metric = 'f'.repeat(32);
    const boundary = parseRequestExtensions({ graph_state: client }, 'r1-forged-echo');
    if (!boundary.ok) throw new Error('invalid client');
    const after = clone(boundary.value.graphState!); after.nodes.find((n: Rec) => n.id === 'factor').label = 'Coverage revised';
    vi.mocked(handleEditGraph).mockResolvedValue({ blocks: [], assistantText: 'Renamed Coverage.', latencyMs: 0,
      wasRejected: false, operations: [{ op: 'update_node', path: 'factor', value: { label: 'Coverage revised' } }],
      appliedGraph: after, appliedChanges: { summary: 'Renamed Coverage.', changes: [], rerun_recommended: false } } as never);
    const result = await dispatchEditGraph({ payload: payload('Rename Coverage to Coverage revised'),
      requestId: 'r1-forged-echo', request: {} as never, graphState: boundary.value.graphState!, analysisState: null });
    expect(JSON.stringify(result)).not.toContain('BASE_HASH_DIVERGED');
    expect(result.commitPerformed).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.graph).toBeDefined();
    expect(w.read().nodes.find((n: Rec) => n.id === 'factor').label).toBe('Coverage revised');
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it.each(['live', 'off', 'shadow'])('P1-2b P1-a omitted basis survives the real edit path in %s mode', async mode => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode); _resetConfigCache();
    const g = attested(), w = world(g), client = clone(g); activeStore = w.store;
    delete goalOf(client).horizon_basis;
    const after = clone(client); after.nodes.find((n: Rec) => n.id === 'factor').label = 'Coverage revised';
    vi.mocked(handleEditGraph).mockResolvedValue({ blocks: [], assistantText: 'Renamed Coverage.', latencyMs: 0,
      wasRejected: false, operations: [{ op: 'update_node', path: 'factor', value: { label: 'Coverage revised' } }],
      appliedGraph: after, appliedChanges: { summary: 'Renamed Coverage.', changes: [], rerun_recommended: false } } as never);
    const result = await dispatchEditGraph({ payload: payload('Rename Coverage to Coverage revised'), requestId: 'r1-omit',
      request: {} as never, graphState: client as never, analysisState: null });
    expect(JSON.stringify(result)).not.toContain('BASE_HASH_DIVERGED');
    expect(result.commitPerformed).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(goalOf(result.graph as Rec).horizon_basis).toEqual(goalOf(g).horizon_basis);
    expect(goalOf(result.response.draft_graph as Rec).horizon_basis).toEqual(goalOf(g).horizon_basis);
    expect(w.read().nodes.find((n: Rec) => n.id === 'factor').label).toBe('Coverage revised');
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it.each([false, true])('P1-3 real redraft carries by id; changed meaning voids the read (%s)', async changed => {
    const g = attested(), w = world(g), redraft = seed(); activeStore = w.store;
    if (changed) goalOf(redraft).label = 'Annual revenue';
    vi.mocked(handleDraftGraph).mockResolvedValue({ blocks: [], assistantText: 'Drafted the model.', latencyMs: 0,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: redraft } as never);
    const result = await dispatchDraftGraph({ payload: payload('Build the model again'), requestId: 'r1-redraft', request: {} as never });
    expect(goalOf(result.graph as Rec).horizon_basis).toEqual(goalOf(g).horizon_basis);
    expect(goalOf(result.response.draft_graph as Rec).horizon_basis).toEqual(goalOf(g).horizon_basis);
    expect(w.writes).toHaveLength(1);
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
    expect(horizonSteadyAttested(w.read(), SCENARIO)).toBe(!changed);
  });
  it.each(['changed', 'removed'])('caller preparation restores stored value when unauthorised write %s it', async mode => {
    const g = attested(), proposed = clone(g), w = world(g);
    if (mode === 'removed') delete goalOf(proposed).horizon_basis;
    else goalOf(proposed).horizon_basis.metric = 'f'.repeat(32);
    prepareHorizonBasisForWrite(proposed, g, SCENARIO);
    const beforeDoor = clone(proposed);
    const result = await appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph: true, baseGraphForInvariants: g });
    expect(result).toEqual({ id: 'row-1' });
    expect(proposed).toEqual(beforeDoor);
    expect(w.read()).toEqual(beforeDoor);
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
  });
  it('door authorisation is scoped to B; forged A is replaced with stored A', async () => {
    const g = attested(); g.nodes.push({ ...clone(goalOf(seed())), id: 'b' });
    const edit = applyGoalSteadyEdit(g, { goal_id: 'b', months: 9 }, SCENARIO);
    if (edit.kind !== 'mutated') throw new Error('no edit');
    const proposed = clone(edit.mutatedGraph);
    goalOf(proposed).horizon_basis.metric = 'f'.repeat(32);
    const w = world(g);
    prepareHorizonBasisForWrite(proposed, g, SCENARIO, edit.horizonBasisWrite);
    await appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph: true,
      baseGraphForInvariants: g, horizonBasisWrite: edit.horizonBasisWrite });
    expect(goalOf(w.read()).horizon_basis).toEqual(goalOf(g).horizon_basis);
    expect(goalOf(w.read(), 'b').horizon_basis).toEqual(goalOf(edit.mutatedGraph, 'b').horizon_basis);
  });
  it('door refuses a tampered authorisation value before append', async () => {
    const g = seed(), w = world(g), edit = applyGoalSteadyEdit(g, { goal_id: 'goal', months: 9 }, SCENARIO);
    if (edit.kind !== 'mutated') throw new Error('no edit');
    const authorisation = (edit as Rec).horizonBasisWrite ?? { goal_id: 'goal', value: goalOf(edit.mutatedGraph).horizon_basis };
    authorisation.value = { ...authorisation.value, metric: 'f'.repeat(32) };
    await expect(appendCheckedGraphWrite({ store: w.store, write: doorWrite(edit.mutatedGraph), writesGraph: true,
      baseGraphForInvariants: g, horizonBasisWrite: authorisation } as never)).rejects.toThrow('horizon_basis');
    expect(w.writes).toHaveLength(0);
  });
  it('door keeps a basis when the graph and stored base share an object', async () => {
    const g = attested(), expected = clone(goalOf(g).horizon_basis), w = world(g);
    await appendCheckedGraphWrite({ store: w.store, write: doorWrite(g), writesGraph: true, baseGraphForInvariants: g });
    expect(goalOf(w.read()).horizon_basis).toEqual(expected);
  });
  it('door rejects a plain wire-shaped authorisation even with the correct value', async () => {
    const g = seed(), w = world(g);
    await expect(appendCheckedGraphWrite({ store: w.store, write: doorWrite(attested()), writesGraph: true,
      baseGraphForInvariants: g, horizonBasisWrite: { goal_id: 'goal', value: goalOf(attested()).horizon_basis } } as never))
      .rejects.toThrow('horizon_basis');
    expect(w.writes).toHaveLength(0);
  });
  it.each([true, false])('door fails closed without a stored base (writesGraph: %s)', async writesGraph => {
    const proposed = attested(), w = world(proposed);
    const unchanged = clone(proposed);
    await expect(appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph })).rejects.toThrow('horizon_basis');
    expect(w.writes).toHaveLength(0);
    expect(proposed).toEqual(unchanged);
    prepareHorizonBasisForWrite(proposed, undefined, SCENARIO);
    await appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph });
    expect(goalOf(w.read())).not.toHaveProperty('horizon_basis');
  });
  it('P45 unconfirmed accumulation carrier refuses attestation', () => {
    const g = attested();
    g.nodes.push({ id: 'stock', kind: 'factor', label: 'Stock', nonlinear_identity: {
      operation: 'accumulation', confirmed: false } });
    expect(horizonSteadyAttested(g, SCENARIO)).toBe(false);
  });
});


// Baseline diagnostic: no horizon basis or preparation needed.
describe('S5 r2 reference allocation finding', () => {
  it('pre-existing plain add_node readback mismatch remains out of scope', async () => {
    const g = seed(), w = world(g);
    const added = { id: 'new_factor', kind: 'factor', label: 'Plain new factor' };
    const apply = createApplyOperations({ scenarioId: SCENARIO, requestId: 'r2-plain-add', store: w.store });
    const result = apply({ proposalId: 'r2-plain-add', idempotencyKey: TURN,
      modelRevision: (await currentModelRevision(SCENARIO, { store: w.store }))!,
      operations: [{ kind: 'edit_graph', summary: 'Add a factor', detail: { operations: [
        { op: 'add_node', path: added.id, value: added },
      ] } }] });
    await expect(result).rejects.toThrow('committed_graph_mismatch');
    expect(w.writes).toHaveLength(1);
    expect(w.read().nodes.find((n: Rec) => n.id === added.id)).toMatchObject({ ...added, ref: 'F1' });
  });
});


describe('S5 r2 pure append-door assertion', () => {
  it('direct door refuses unprepared forged basis without append; prepared bytes append', async () => {
    const base = seed(), proposed = attested(), w = world(base), before = clone(proposed);
    await expect(appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph: true,
      baseGraphForInvariants: base })).rejects.toThrow('horizon_basis');
    expect(w.writes).toHaveLength(0);
    expect(proposed).toEqual(before);
    prepareHorizonBasisForWrite(proposed, base, SCENARIO);
    const prepared = clone(proposed);
    await appendCheckedGraphWrite({ store: w.store, write: doorWrite(proposed), writesGraph: true,
      baseGraphForInvariants: base });
    expect(w.writes).toHaveLength(1);
    expect(w.read()).toEqual(prepared);
    expect(proposed).toEqual(prepared);
  });
  it.each(['prepared', 'forged', 'omitted', 'no-base', 'non-goal'])('door assert is pure on %s graph bytes', mode => {
    const base = attested(), graph = clone(base);
    if (mode === 'forged') goalOf(graph).horizon_basis.metric = 'f'.repeat(32);
    if (mode === 'omitted') delete goalOf(graph).horizon_basis;
    if (mode === 'non-goal') graph.nodes.find((n: Rec) => n.id === 'factor').horizon_basis = clone(goalOf(base).horizon_basis);
    const beforeGraph = clone(graph), beforeBase = clone(base), bytes = JSON.stringify(graph);
    const call = () => assertDoorProvenance(graph, mode === 'no-base' ? undefined : base, SCENARIO);
    if (mode === 'prepared') expect(call).not.toThrow();
    else expect(call).toThrow('horizon_basis');
    expect(graph).toEqual(beforeGraph);
    expect(base).toEqual(beforeBase);
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it.each(['absent', 'ambiguous'])('door refuses an authorised goal that is %s without mutation or append', async mode => {
    const base = seed(), w = world(base), edit = applyGoalSteadyEdit(base, { goal_id: 'goal', months: 9 }, SCENARIO);
    if (edit.kind !== 'mutated') throw new Error('no edit');
    const graph = clone(edit.mutatedGraph);
    if (mode === 'absent') graph.nodes = graph.nodes.filter((n: Rec) => n.id !== 'goal');
    else graph.nodes.push(clone(goalOf(graph)));
    const before = clone(graph), capability = clone(edit.horizonBasisWrite);
    await expect(appendCheckedGraphWrite({ store: w.store, write: doorWrite(graph), writesGraph: true,
      baseGraphForInvariants: base, horizonBasisWrite: edit.horizonBasisWrite })).rejects.toThrow('horizon_basis authorised goal');
    expect(graph).toEqual(before);
    expect(edit.horizonBasisWrite).toEqual(capability);
    expect(w.writes).toHaveLength(0);
  });
  it('door assert is pure for a valid authorised write', () => {
    const base = seed(), edit = applyGoalSteadyEdit(base, { goal_id: 'goal', months: 9 }, SCENARIO);
    if (edit.kind !== 'mutated') throw new Error('no edit');
    const before = clone(edit.mutatedGraph), originalBase = clone(base), capability = clone(edit.horizonBasisWrite);
    expect(() => assertDoorProvenance(edit.mutatedGraph, base, SCENARIO, edit.horizonBasisWrite)).not.toThrow();
    expect(edit.mutatedGraph).toEqual(before);
    expect(base).toEqual(originalBase);
    expect(edit.horizonBasisWrite).toEqual(capability);
  });
});


describe('S5 r4 prepared candidate hashes and cold Run', () => {
  it.each(['omitted', 'forged'])('D1b direct commit prepares the %s candidate before hashing and appending', async variant => {
    const { commitDirectAnswer } = await import('../../commit.js');
    const g = attested(), candidate = clone(g), w = world(g);
    if (variant === 'omitted') delete goalOf(candidate).horizon_basis;
    else goalOf(candidate).horizon_basis.metric = 'f'.repeat(32);
    const result = await commitDirectAnswer({ response_version: 2, assistant_text: 'Recorded.', blocks: [],
      suggested_actions: [], insights: [], stage_indicator: 'analyse' }, {
      scenario_id: SCENARIO, turn_id: TURN, request_hash: 'r4-direct', turn_class: 'direct_answer',
      handler_id: null, llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: candidate,
      baseGraphForInvariants: g, storedGraphForHorizonBasis: g,
    }, w.store);
    expect(result.performed).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(JSON.stringify(goalOf(w.read()).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
    expect(result.persistedAnalysisGraphHash).toBe(computeAnalysisAffectingGraphHash(w.read() as never));
  });

  it('P1-b redraft target question binds to the committed hash and 80% resumes through clarification-resume', async () => {
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe'); _resetConfigCache();
    const { tryGoalTargetElicitationResume } = await import('../../routing/clarification-resume.js');
    const g = attested(), w = world(g); activeStore = w.store;
    expect(goalOf(g)).not.toHaveProperty('goal_threshold');
    vi.mocked(handleDraftGraph).mockResolvedValue({ blocks: [], assistantText: 'Drafted the model.', latencyMs: 0,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: seed(), goalTargetCandidate: {
        goal_node_id: 'goal', value_user_units: 80, unit: '%', label_span: 'Service quality', brief_span: '80%',
        binding: 'governed', reason: 'governed',
      } } as never);
    const result = await dispatchDraftGraph({ payload: payload('Build the model again with 80% service quality'),
      requestId: 'r4-redraft', request: {} as never });
    expect(result.commitPerformed).toBe(true);
    expect(w.writes).toHaveLength(1);
    const stored = w.read(), hash = computeAnalysisAffectingGraphHash(stored as never)!;
    const pendings = w.writes[0]!.pending_actions ?? [];
    const question = pendings.find(p => p.action.kind === 'elicit_goal_target');
    expect(question).toBeDefined();
    expect(question!.preconditions.graph_hash).toBe(hash);
    expect(JSON.stringify(goalOf(stored).horizon_basis)).toBe(JSON.stringify(goalOf(g).horizon_basis));
    expect(horizonSteadyAttested(stored, SCENARIO)).toBe(true);
    const resumed = tryGoalTargetElicitationResume({ message: '80%', pendingActions: pendings,
      nowMs: Date.now(), currentGraphHash: hash, graphNodes: stored.nodes });
    expect(resumed).toMatchObject({ matched: true, goalNodeId: 'goal', value: 80, unit: '%' });
  });

  it('DL condition (1): cold stamped Run stays stale after real press and the proposed Run loads the stored attestation', async () => {
    const { createRunAnalysisTool } = await import('../../replacement/run-analysis-tool.js');
    const { projectTurnContext } = await import('../../replacement/turn-context-view.js');
    const { reconcileScenarioAnalysisFacts } = await import('../../context/reconcile-scenario-analysis-facts.js');
    const { RUN_ANALYSIS_PROJECTION_KEY, ANALYSIS_PROJECTION_VERSION } = await import('../../context/graph-identity.js');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { readFileSync } = await import('node:fs');
    const g = projectGraphForPersistence(GraphV3.parse(buildReadyGraph())) as Rec;
    goalOf(g, 'g-profit').goal_horizon_months = 9;
    const hashBefore = computeAnalysisAffectingGraphHash(g as never)!;
    const w = world(g);
    const pressed = await executeOptionInterventionBatch(input(g, {
      goalSteady: { goal_id: 'g-profit', months: 9 }, hasExistingAnalysis: true,
    }), w.store);
    expect(pressed.kind).toBe('committed');
    expect(w.writes).toHaveLength(1);
    const after = w.read(), hashAfter = computeAnalysisAffectingGraphHash(after as never)!;
    expect(horizonSteadyAttested(after, SCENARIO)).toBe(true);
    expect(computeGraphIdentityHash(after as never)?.value).not.toBe(computeGraphIdentityHash(g as never)?.value);
    const run = { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: SCENARIO, leading_option_id: 'o-a', summary: 'The analysis ran.',
      graph_hash_at_run: hashBefore, computed_at: '2026-10-08T20:00:00.000Z',
      enrichment: { analysis_status: 'computed', [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION },
    } };
    // Exactly the r3 cold witness: empty recent-turn facts, the stamped Run retained in the durable scenario carrier.
    const set = reconcileScenarioAnalysisFacts({ scenarioId: SCENARIO, hotWindowFacts: [],
      hotWindowFactsWithIdentity: [], durableRead: { status: 'ok', scenario_id: SCENARIO,
        query_limit: 21, total_count: 1, facts: [{ fact: run as never, fact_row_id: 'prior-run',
          fact_created_at: '2026-10-08T20:00:00.000Z' }] } });
    expect(set.status).toBe('complete');
    const context = { session_id: SCENARIO, prior_turns: [], prior_facts: [], prior_facts_read_ok: true,
      scenario_analysis_fact_set: set, prior_facts_with_turn: [] };
    const cold = projectTurnContext(context as never, hashAfter, after as never);
    const proposed = await createRunAnalysisTool({ getGraph: () => after as never,
      getAnalysis: () => cold.snapshot }).execute({});
    expect(proposed, JSON.stringify({ freshness: cold.freshness, runOutcome: proposed })).toMatchObject({ type: 'proposed' });
    expect(cold.freshness).toMatchObject({ freshness: 'stale', reason: 'graph_hash_diverged' });
    expect(hashAfter).not.toBe(hashBefore);
    const runTransport = vi.fn(async () => JSON.parse(readFileSync(new URL(
      '../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url), 'utf8')));
    const scenarioReader = vi.fn(async () => {
      const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'r4-run-load', w.store);
      expect(horizonSteadyAttested(snapshot.graph, SCENARIO)).toBe(true);
      expect(JSON.stringify(goalOf(snapshot.graph as Rec, 'g-profit').horizon_basis))
        .toBe(JSON.stringify(goalOf(after, 'g-profit').horizon_basis));
      return snapshot;
    });
    const outcome = await createRunAnalysisHandler({ scenarioReader,
      plotClient: { run: runTransport, validatePatch: vi.fn(async () => ({})) } as never,
    })({ context: { ...context, stage: 'analyse', entity_registry: { option_ids: [], goal_id: null },
      capabilities: {}, messages: [], request_id: 'r4-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      scenarioBriefText: null, persistedGraph: null }, payload: payload('Run the analysis.'),
      requestId: 'r4-run', signal: new AbortController().signal, orientationText: '',
    } as never);
    expect(scenarioReader).toHaveBeenCalledTimes(1);
    expect(runTransport).toHaveBeenCalledTimes(1);
    expect(outcome.handler_facts[0]).toMatchObject({ fact_type: 'run_analysis', noop: false,
      result: { graph_hash_at_run: hashAfter } });
  });

  it('DL condition (2) existing read gate: a saved supported Run -> restore removes the answer -> reload withholds', async () => {
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    const { RUN_ANALYSIS_PROJECTION_KEY, ANALYSIS_PROJECTION_VERSION } = await import('../../context/graph-identity.js');
    const { readFileSync } = await import('node:fs');
    const oldVersion = projectGraphForPersistence(GraphV3.parse(buildReadyGraph())) as Rec;
    goalOf(oldVersion, 'g-profit').goal_horizon_months = 9;
    const issued = applyGoalSteadyEdit(oldVersion, { goal_id: 'g-profit', months: 9 }, SCENARIO);
    if (issued.kind !== 'mutated') throw new Error('not attested');
    const supportedGraph = issued.mutatedGraph;
    const enrichment = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url), 'utf8'));
    enrichment[RUN_ANALYSIS_PROJECTION_KEY] = ANALYSIS_PROJECTION_VERSION;
    const fact = { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: SCENARIO, summary: 'The analysis ran.', leading_option_id: 'opt_a',
      graph_hash_at_run: computeAnalysisAffectingGraphHash(supportedGraph as never),
      computed_at: '2026-10-09T00:00:00.000Z', enrichment,
    } };
    activeStore = createMockSessionStore({ readScenarioRunAnalysisFactsFor: async () => ({ total_count: 1,
      facts: [{ fact: fact as never, fact_row_id: 'supported-run', fact_created_at: '2026-10-09T00:00:00.000Z' }] }) });
    const supported = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: supportedGraph, requestId: 'r4-supported' });
    expect(supported.current_read.run_state).toMatchObject({ kind: 'complete_current' });
    expect(supported.current_read.result).not.toBeNull();
    // Restore returns that stored version's own answer/absence, without carrying today's answer.
    const restored = clone(oldVersion);
    expect(goalOf(restored, 'g-profit')).not.toHaveProperty('horizon_basis');
    expect(horizonSteadyAttested(restored, SCENARIO)).toBe(false);
    const reloaded = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: restored, requestId: 'r4-restored' });
    expect(reloaded.current_read.run_state).toMatchObject({ kind: 'complete_stale' });
    expect(reloaded.current_read.result).toBeNull();
    expect(reloaded.current_read.figures).toEqual([]);
  });

  it.todo('DL condition (1) PENDING #2895/P45 rebase: Run loaded with horizonSteadyAttested=true licenses the goal chance for the attested months and removes the untested-horizon withhold');
  it.todo('DL condition (2) PENDING #2895 rebase: supported attested Run -> restore pre-attestation version removes answer -> reload read-time goalHorizonVerdict withholds the former horizon chance');
});


// These snapshots are generated by the real entry functions at staging-source
// HEAD 2197d207 (runner swaps ONLY the four r4 production files, then restores
// their exact bytes in finally). R5 and mutants must match those same snapshots.
describe('P0 staging parity without horizon_basis', () => {
  const states = ['ok_present', 'ok_absent', 'failed'] as const;
  const paths = ['route-request', 'executor-provisional-proposal', 'executor-post-handler',
    'draft-post-draft', 'edit-candidate', 'edit-early-question'] as const;
  it.each(paths.flatMap(path => states.map(state => ({ path, state }))))('$path / $state', async ({ path, state }) => {
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
    vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'off');
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_REPLACEMENT_COACH_ENABLED', 'false');
    _resetConfigCache(); __setUseAppendV6ForTest(false);
    const g = seed(), w = world(state === 'ok_present' ? g : null);
    const reads: string[] = [];
    const baseStore = w.store;
    activeStore = new Proxy(baseStore, { get(target, key) {
      const fn = Reflect.get(target, key);
      if (typeof fn !== 'function') return fn;
      return (...args: unknown[]) => {
        if (/^(load|read|count|get|has)/.test(String(key)) || key === 'scenarioExists') reads.push(String(key));
        if (key === 'loadGraph' || key === 'loadGraphAndBriefText') {
          if (state === 'failed') return Promise.reject(new Error('P0 degraded stored read'));
        }
        return fn.apply(target, args);
      };
    } });
    const traces: Rec[] = [];
    const realHash = graphHashes.computeAnalysisAffectingGraphHash;
    const spy = vi.spyOn(graphHashes, 'computeAnalysisAffectingGraphHash').mockImplementation(graph => {
      const stack = new Error().stack ?? '';
      const caller = stack.split('\n').find(line => /(?:route-v2|turn-executor|draft-graph-dispatch|edit-graph-dispatch)\.ts/.test(line));
      const hash = realHash(graph);
      if (caller) traces.push({ caller: caller.trim().replace(/:\d+:\d+/g, '').replaceAll(process.cwd(), '<root>'),
        nonNull: graph != null, bytes: JSON.stringify(graph) ?? null, hash });
      return hash;
    });
    vi.spyOn(Date, 'now').mockReturnValue(1791504000000);
    const after = clone(g); after.nodes.find((n: Rec) => n.id === 'factor').label = 'Coverage revised';
    vi.mocked(handleEditGraph).mockResolvedValue({ blocks: [], assistantText: 'Renamed Coverage.', latencyMs: 0,
      wasRejected: false, operations: [{ op: 'update_node', path: 'factor', value: { label: 'Coverage revised' } }],
      appliedGraph: after, appliedChanges: { summary: 'Renamed Coverage.', changes: [], rerun_recommended: false } } as never);
    vi.mocked(handleDraftGraph).mockResolvedValue({ blocks: [], assistantText: 'Drafted the model.', latencyMs: 0,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: g, goalTargetCandidate: {
        goal_node_id: 'goal', value_user_units: 80, unit: '%', label_span: 'Service quality', brief_span: '80%',
        binding: 'governed', reason: 'governed',
      } } as never);
    let outcome: Rec;
    const summarise = (r: Rec) => ({ commit: r.commitPerformed ?? r.telemetry?.commit_performed ?? null,
      graphNonNull: r.graph != null, assistant: r.response?.assistant_text ?? null,
      blocks: r.response?.blocks?.map((b: Rec) => b.type) ?? [],
      stage: r.response?.stage_indicator ?? null });
    try {
      if (path === 'route-request') {
        const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
        const app = Fastify(); await ceeOrchestratorRouteV2(app);
        try {
          const result = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn',
            payload: { ...payload('Add a risk for supplier delays affecting the launch'), turn_class: 'decide', graph_state: g,
              analysis_state: { analysis_status: 'completed', meta: { graph_hash_at_run: realHash(g as never) } } } });
          const body = result.json();
          outcome = { status: result.statusCode, ...summarise({ response: body }), error: body.error ?? null };
        } finally { await app.close(); }
      } else if (path.startsWith('executor')) {
        const handler = vi.fn(async () => ({ assistant_text: 'Would you like me to add reliability as a factor?',
          handler_facts: [], llm_calls_used: 0, mutated_graph: after }));
        const routedInput = { intent_class: 'execute', action: { handler_id: 'explain_from_structure',
          entity: { id: 'factor', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
          parameters: [], cited_context_fields: [] } };
        const { OLUMI_ACTION_TOOL_NAME } = await import('../../routing/tool-schema.js');
        const adapter = { chatWithTools: vi.fn(async () => ({
          content: path === 'executor-post-handler'
            ? [{ type: 'tool_use', id: 'p0-tool', name: OLUMI_ACTION_TOOL_NAME, input: routedInput }]
            : [{ type: 'text', text: 'Would you like me to add reliability as a factor?' }],
          stop_reason: path === 'executor-post-handler' ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 }, model: 'test-double', latencyMs: 0,
        })) };
        const result = await runTurnExecutor(payload('Please improve the coverage assumption'), 'p0-executor', {
          graphState: g as never, routingAdapter: adapter as never,
          handlerRegistry: new Map([['explain_from_structure', handler]]) as never,
          validationRegistry: { explain_from_structure: { handler_id: 'explain_from_structure', accepted_entity_kinds: ['node'],
            preconditions: () => ({ ok: true }), confirmation_template: 'Value updated' } } as never,
        });
        outcome = { ...summarise(result), validationError: result.telemetry.validation_error_code, handlerCalls: handler.mock.calls.length, adapterCalls: adapter.chatWithTools.mock.calls.length };
      } else if (path === 'draft-post-draft') {
        const result = await dispatchDraftGraph({ payload: payload('Build the model with 80% service quality'),
          requestId: 'p0-draft', request: {} as never });
        outcome = summarise(result);
      } else {
        const result = await dispatchEditGraph({ payload: payload(path === 'edit-early-question' ? 'Add delays as a risk' : 'Rename Coverage to Coverage revised'),
          requestId: 'p0-edit', request: {} as never, graphState: g as never, analysisState: null });
        outcome = summarise(result);
      }
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : String(error) };
    } finally { spy.mockRestore(); vi.spyOn(Date, 'now').mockRestore(); }
    expect(traces.length, 'real hash entry must be witnessed').toBeGreaterThan(0);
    if (path === 'executor-post-handler') expect(outcome.handlerCalls, JSON.stringify(outcome)).toBe(1);
    if (path === 'route-request') expect(traces.some(t => t.caller.includes('route-v2'))).toBe(true);
    // Entire candidate bytes, non-nullness, hashes, read order/count, writes,
    // refusal/error outcomes and pending question/proposal bindings are pinned.
    expect({ traces, reads, outcome, writes: w.writes.map(write => ({ graph: write.graph ?? null,
      pendingHashes: (write.pending_actions ?? []).map(p => p.preconditions.graph_hash ?? null),
      assistant: write.assistantMessage ?? null })) }).toMatchSnapshot();
  });
});

// Unavailable provenance affects basis bytes only; existing store failures
// remain owned by staging's dispatch/commit logic.
describe('R5 unavailable read drops basis without nulling hash candidates', () => {
  it.each(['route-request', 'executor-proposal', 'edit-early-question'])('%s retains its graph and hashes after dropping submitted basis', async path => {
    const g = attested(), w = world(null);
    activeStore = new Proxy(w.store, { get(target, key) {
      if (key === 'loadGraph' || key === 'loadGraphAndBriefText') {
        return async () => { throw new Error('Unavailable stored provenance'); };
      }
      return Reflect.get(target, key);
    } });
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_REPLACEMENT_COACH_ENABLED', 'false');
    _resetConfigCache();
    const hashes: { graph: unknown; hash: string | null }[] = [];
    const realHash = graphHashes.computeAnalysisAffectingGraphHash;
    const spy = vi.spyOn(graphHashes, 'computeAnalysisAffectingGraphHash').mockImplementation(graph => {
      const hash = realHash(graph);
      hashes.push({ graph: graph == null ? null : clone(graph), hash });
      return hash;
    });
    try {
      if (path === 'route-request') {
        const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
        const app = Fastify(); await ceeOrchestratorRouteV2(app);
        try {
          await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
            ...payload('Add a risk for supplier delays affecting the launch'), turn_class: 'decide', graph_state: g,
            analysis_state: { analysis_status: 'completed', meta: { graph_hash_at_run: realHash(seed() as never) } },
          } });
        } finally { await app.close(); }
      } else if (path === 'executor-proposal') {
        await runTurnExecutor(payload('Any thoughts?'), 'r5-drop', { graphState: g as never,
          routingAdapter: { chatWithTools: vi.fn(async () => ({ content: [{ type: 'text', text: 'Would you like me to add reliability as a factor?' }],
            stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, model: 'test-double', latencyMs: 0 })) } as never,
        });
      } else {
        await dispatchEditGraph({ payload: payload('Add delays as a risk'), requestId: 'r5-drop',
          request: {} as never, graphState: g as never, analysisState: null });
      }
      const candidates = hashes.filter(h => h.graph != null);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some(h => h.hash === realHash(seed() as never))).toBe(true);
      for (const candidate of candidates) expect(goalOf(candidate.graph as Rec)).not.toHaveProperty('horizon_basis');
      expect(goalOf(g)).toHaveProperty('horizon_basis');
    } finally { spy.mockRestore(); }
  });
});

it('R5 residual edge: CAS off/v6 off redraft carries stored basis at the single commit read after the pending question hash', async () => {
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off'); vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'off');
  _resetConfigCache(); __setUseAppendV6ForTest(false);
  const g = attested(), w = world(g), reads: string[] = [];
  activeStore = new Proxy(w.store, { get(target, key) {
    const fn = Reflect.get(target, key);
    if (typeof fn !== 'function') return fn;
    return (...args: unknown[]) => {
      if (key === 'loadGraph' || key === 'loadGraphAndBriefText') reads.push(String(key));
      return fn.apply(target, args);
    };
  } });
  vi.mocked(handleDraftGraph).mockResolvedValue({ blocks: [], assistantText: 'Drafted the model.', latencyMs: 0,
    strengthenItems: [], coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
    draftWarnings: [], graphOutput: seed(), goalTargetCandidate: {
      goal_node_id: 'goal', value_user_units: 80, unit: '%', label_span: 'Service quality', brief_span: '80%',
      binding: 'governed', reason: 'governed',
    } } as never);
  const result = await dispatchDraftGraph({ payload: payload('Build the model again with 80% service quality'),
    requestId: 'r5-residual', request: {} as never });
  expect(result.commitPerformed).toBe(true);
  expect(reads).toEqual(['loadGraph']);
  expect(goalOf(w.read()).horizon_basis).toEqual(goalOf(g).horizon_basis);
  const question = w.writes[0]!.pending_actions!.find(p => p.action.kind === 'elicit_goal_target')!;
  expect(question).toBeDefined();
  expect(question.preconditions.graph_hash).toBe(computeAnalysisAffectingGraphHash(seed() as never));
  expect(question.preconditions.graph_hash).not.toBe(computeAnalysisAffectingGraphHash(w.read() as never));
});
