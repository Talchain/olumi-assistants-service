import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema, RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { ModelVersionDiffV1Schema, ModelVersionDiffV2Schema } from '@talchain/schemas/boundary';
import { FROM, TO, PRIOR, CURRENT, factSet, savedRun } from '../../orchestrator-v5/model-management/__tests__/version-result-fixtures.js';
import { FIX_SCENARIO, FIX_OWNER, versionRecord } from '../../orchestrator-v5/model-management/__tests__/fixtures.js';
import { readMayNameLeadingOptionVerdictForFact } from '../../orchestrator-v5/context/claim-safety-read.js';
import { GraphStateIngressSchema } from '../../orchestrator-v5/boundary/request-extensions.js';
import { deriveEveryOptionLimitVerdict, readRatifiedConstraints } from '../../orchestrator/context/constraint-feasibility.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(), facts: vi.fn(), identity: vi.fn(),
  residualLeader: undefined as 'prior_leading_option_id' | 'current_leading_option_id' | undefined,
  session: { scenarioExists: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), loadGraph: vi.fn() },
}));
vi.mock('../../orchestrator-v5/coaching/build-run-delta.js', async (original) => {
  const actual = await original<typeof import('../../orchestrator-v5/coaching/build-run-delta.js')>();
  return { ...actual, buildRunDelta: (input: Parameters<typeof actual.buildRunDelta>[0]) => {
    const built = actual.buildRunDelta(input);
    if (built.kind !== 'ok' || mocks.residualLeader === undefined) return built;
    // Residual leader ids and shares from the real producer must be removed at final egress.
    return { ...built, delta: { ...built.delta,
      leader: { ...built.delta.leader, [mocks.residualLeader]: 'opt-a' },
      win_probabilities: [{ option_id: 'opt-a', prior: 0.62, current: 0.45, noise_verdict: 'not_noise_qualified' as const }],
    } };
  } };
});
vi.mock('../../orchestrator/user-identity.js', async (original) => ({
  ...await original<typeof import('../../orchestrator/user-identity.js')>(), resolveUserIdentity: mocks.identity,
}));
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => mocks.session }));
vi.mock('../../orchestrator-v5/build-turn-context.js', async (original) => ({
  ...await original<typeof import('../../orchestrator-v5/build-turn-context.js')>(),
  loadScenarioAnalysisFactsForRead: mocks.facts,
}));
vi.mock('../../orchestrator-v5/model-management/index.js', async (original) => {
  const actual = await original<typeof import('../../orchestrator-v5/model-management/index.js')>();
  return { ...actual, getModelManagementService: () => new actual.ModelManagementService({ isEnabled: () => true,
    store: { getVersion: mocks.getVersion, saveVersion: vi.fn(), listVersions: vi.fn(),
      getCurrentVersionId: vi.fn() } }) };
});
import versionsRoute from '../assist.v1.scenario-versions.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.residualLeader = undefined;
  mocks.identity.mockResolvedValue({ mode: 'verified', userId: FIX_OWNER });
  mocks.session.scenarioExists.mockResolvedValue(true);
  mocks.session.ensureScenarioExists.mockResolvedValue({ user_id: FIX_OWNER });
  mocks.session.getScenarioOwner.mockResolvedValue(FIX_OWNER);
  mocks.session.loadGraph.mockResolvedValue(FROM.graph);
  mocks.getVersion.mockImplementation(async (_scenario: string, id: string) => id === FROM.id ? FROM : id === TO.id ? TO : null);
  mocks.facts.mockResolvedValue({ factSet: factSet(), hotWindow: { status: 'ok', facts: [] } });
});
async function compare(body: Record<string, unknown> = {}) {
  const app = Fastify();
  try {
    await versionsRoute(app); await app.ready();
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${FIX_SCENARIO}/versions/compare`,
      payload: { from_version_id: FROM.id, to_version_id: TO.id, response_schema: 'model_version_diff.v2', ...body } });
  } finally { await app.close(); }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const result = (fact: HandlerFact) => (fact as unknown as { result: Record<string, unknown> }).result;

function pairWithRatifiedLimits(priorSatisfaction: number, currentSatisfaction: number) {
  const endpoints = [FROM, TO].map((version, i) => {
    // Distinct limits prove each permission reads its own saved graph, not the live/TO graph.
    const constraint = { constraint_id: `saved-limit-${i}`, node_id: 'n_price',
      operator: '<=', value: 100, label: 'Price at most £100' };
    const saved = versionRecord(GraphStateIngressSchema.parse({
      ...GraphStateIngressSchema.parse(version.graph), goal_constraints: [constraint],
    }), { id: version.id });
    const run = savedRun(saved, i === 0 ? 'bound-prior' : 'bound-current',
      i === 0 ? '2026-10-02T00:00:00.000Z' : '2026-10-02T01:00:00.000Z', i === 0 ? 0.62 : 0.45);
    const enrichment = result(run).enrichment as Record<string, unknown>;
    const satisfaction = i === 0 ? priorSatisfaction : currentSatisfaction;
    enrichment.option_comparison = ['opt-a', 'opt-b'].map((option_id, j) => ({
      option_id, constraints_decision_grade: true,
      constraint_probabilities: { [constraint.constraint_id]: satisfaction + j * 0.1 },
    }));
    enrichment.constraint_results = [{ ...constraint,
      scale_provenance: { decision_grade: true, range_unified: true, source: 'explicit_cap' } }];
    return { saved, run };
  });
  const [prior, current] = endpoints;
  mocks.getVersion.mockImplementation(async (_scenario: string, id: string) =>
    id === FROM.id ? prior!.saved : id === TO.id ? current!.saved : null);
  mocks.facts.mockResolvedValue({ factSet: factSet([current!.run, prior!.run]), hotWindow: { status: 'ok', facts: [] } });
  return { prior: prior!, current: current! };
}

function pairWithAdmission(side: 'prior' | 'current', mode: 'none' | 'exploratory' | 'quantified_provisional') {
  const endpoints = [FROM, TO].map((version, i) => {
    const graph = clone(GraphStateIngressSchema.parse(version.graph));
    if (i === (side === 'prior' ? 0 : 1)) {
      for (const node of graph.nodes) {
        if (mode === 'none' && node.kind === 'option') node.interventions = {};
        if (mode === 'exploratory' && node.id === 'opt-b') {
          node.interventions = { n_price: { value: 12, source: 'brief_extraction' } };
        }
        if (mode === 'quantified_provisional' && node.id === 'n_price') {
          node.observed_state = { value: 10, source: 'cee_inference' };
        }
      }
    }
    const saved = versionRecord(graph, { id: version.id });
    const run = savedRun(saved, i === 0 ? 'bound-prior' : 'bound-current',
      i === 0 ? '2026-10-02T00:00:00.000Z' : '2026-10-02T01:00:00.000Z', i === 0 ? 0.62 : 0.45);
    const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(readiness?.analysis_admission).toMatchObject(i === (side === 'prior' ? 0 : 1)
      ? { permitted_analysis_mode: mode, structurally_analysable: mode === 'quantified_provisional' }
      : { permitted_analysis_mode: 'comparative_leader', structurally_analysable: true });
    const permission = readMayNameLeadingOptionVerdictForFact(run);
    expect(permission.may_name_leading_option).toBe(true);
    expect(permission.separation_withhold).toBeNull();
    return { saved, run };
  });
  const [prior, current] = endpoints;
  mocks.getVersion.mockImplementation(async (_scenario: string, id: string) =>
    id === FROM.id ? prior!.saved : id === TO.id ? current!.saved : null);
  mocks.facts.mockResolvedValue({ factSet: factSet([current!.run, prior!.run]), hotWindow: { status: 'ok', facts: [] } });
}

describe('version result comparison uses the real route, service, binder and delta producer', () => {
  it('Compare goal chances survive a withheld leader at the route’s final licence projection', async () => {
    const prior = clone(PRIOR); const current = clone(CURRENT);
    result(current).constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' };
    for (const [run, chances] of [[prior, { 'opt-a': 47, 'opt-b': 70 }], [current, { 'opt-a': 62, 'opt-b': 35 }]] as const) {
      const enrichment = result(run).enrichment as Record<string, unknown>;
      enrichment.inference_warnings = [...(Array.isArray(enrichment.inference_warnings) ? enrichment.inference_warnings : []),
        { code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['opt-a', 'opt-b'], pct_by_option: chances }];
    }
    mocks.facts.mockResolvedValue({ factSet: factSet([current, prior]), hotWindow: { status: 'ok', facts: [] } });
    mocks.residualLeader = 'current_leading_option_id';
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs' });
    if (value.status !== 'available' || value.kind !== 'paired_runs') throw new Error('Expected paired Runs');
    expect(value.run_delta.win_probabilities).toStrictEqual([]);
    expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
    expect(value.run_delta.goal_chances).toStrictEqual([
      { option_id: 'opt-a', prior: { kind: 'point', pct: 47, rounding: 'whole' }, current: { kind: 'point', pct: 62, rounding: 'whole' } },
      { option_id: 'opt-b', prior: { kind: 'point', pct: 70, rounding: 'whole' }, current: { kind: 'point', pct: 35, rounding: 'whole' } },
    ]);
  });

  it.each([
    ['N3', 'prior', 'exploratory'], ['N4', 'current', 'exploratory'],
    ['N3', 'prior', 'none'], ['N4', 'current', 'none'],
    ['N5', 'prior', 'quantified_provisional'], ['N5', 'current', 'quantified_provisional'],
  ] as const)('%s: withholds an identity-bound %s Run in %s mode', async (_row, side, mode) => {
    pairWithAdmission(side, mode);
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs',
      prior_run: { run_id: 'bound-prior' }, current_run: { run_id: 'bound-current' } });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(value.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
      expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it.each([
    ['N1', 'prior', 0.2, 0.8], ['N2', 'current', 0.8, 0.2],
  ] as const)('%s: withholds both leaders when the %s Run has every option likely breaking its saved limit', async (_row, side, priorP, currentP) => {
    const pair = pairWithRatifiedLimits(priorP, currentP);
    for (const endpoint of Object.values(pair)) {
      expect(buildCanonicalAnalysisReadyFromGraph(endpoint.saved.graph)?.analysis_admission)
        .toMatchObject({ permitted_analysis_mode: 'comparative_leader', structurally_analysable: true });
    }
    const { saved, run } = pair[side];
    const permission = readMayNameLeadingOptionVerdictForFact(run);
    expect(permission.may_name_leading_option).toBe(true);
    expect(permission.separation_withhold).toBeNull();
    expect(deriveEveryOptionLimitVerdict(result(run), readRatifiedConstraints(saved.graph)))
      .toEqual({ kind: 'likely_breaks', constraintId: side === 'prior' ? 'saved-limit-0' : 'saved-limit-1' });
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs' });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(value.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
      expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it('P1: a licensed pair retains the existing leader ids and win probabilities', async () => {
    const baseline = ModelVersionDiffV2Schema.parse((await compare()).json()).result_comparison;
    const pair = pairWithRatifiedLimits(0.8, 0.8);
    for (const endpoint of Object.values(pair)) {
      expect(buildCanonicalAnalysisReadyFromGraph(endpoint.saved.graph)?.analysis_admission)
        .toMatchObject({ permitted_analysis_mode: 'comparative_leader', structurally_analysable: true });
    }
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs', run_delta: {
      leader: { prior_leading_option_id: 'opt-a', current_leading_option_id: 'opt-b', changed: true },
    } });
    if (value.status === 'available' && value.kind === 'paired_runs'
      && baseline.status === 'available' && baseline.kind === 'paired_runs') {
      expect(value.run_delta.win_probabilities).toStrictEqual(baseline.run_delta.win_probabilities);
      expect(value.run_delta.win_probabilities).not.toHaveLength(0);
    }
  });

  it('serves the exact selected pair without extra version reads or raw result envelopes', async () => {
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const body = ModelVersionDiffV2Schema.parse(reply.json());
    expect(body.result_comparison).toMatchObject({ status: 'available', kind: 'paired_runs',
      prior_run: { run_id: 'bound-prior' }, current_run: { run_id: 'bound-current' },
      run_delta: { leader: { prior_leading_option_id: 'opt-a', current_leading_option_id: 'opt-b', changed: true },
        endpoints: { prior: { run_id: 'bound-prior' }, current: { run_id: 'bound-current' } } } });
    expect(mocks.getVersion).toHaveBeenCalledTimes(2); expect(mocks.facts).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty('records'); expect(body.result_comparison).not.toHaveProperty('prior_result');
  });

  it('keeps the default v1 response strict and adds no fact read', async () => {
    const reply = await compare({ response_schema: undefined }); expect(reply.statusCode).toBe(200);
    const body = ModelVersionDiffV1Schema.parse(reply.json());
    expect(body).not.toHaveProperty('result_comparison'); expect(body).not.toHaveProperty('records');
    expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.getVersion).toHaveBeenCalledTimes(2);
  });

  it('computes reverse selection with the original FROM and TO dates', async () => {
    const reply = await compare({ from_version_id: TO.id, to_version_id: FROM.id });
    expect(reply.statusCode).toBe(200);
    const body = ModelVersionDiffV2Schema.parse(reply.json());
    expect(body.result_comparison).toMatchObject({ kind: 'paired_runs',
      run_delta: { endpoints: { prior: { run_id: 'bound-current', computed_at: '2026-10-02T01:00:00.000Z' },
        current: { run_id: 'bound-prior', computed_at: '2026-10-02T00:00:00.000Z' } } } });
  });

  it('returns a shared result once without a fabricated delta', async () => {
    const same = versionRecord(FROM.graph as Parameters<typeof versionRecord>[0], { id: TO.id });
    mocks.getVersion.mockImplementation(async (_scenario: string, id: string) => id === FROM.id ? FROM : same);
    mocks.facts.mockResolvedValue({ factSet: factSet([PRIOR]), hotWindow: { status: 'ok', facts: [] } });
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const body = ModelVersionDiffV2Schema.parse(reply.json());
    expect(body.result_comparison).toMatchObject({ status: 'available', kind: 'shared_run', recorded_run: { run_id: 'bound-prior' } });
    expect(body.result_comparison).not.toHaveProperty('run_delta');
  });

  it.each(['missing_run', 'unconfirmed_identity', 'incompatible_results'] as const)('serves figure-free %s', async (reason) => {
    const fact = clone(PRIOR);
    if (reason === 'unconfirmed_identity') delete result(fact).run_id;
    if (reason === 'incompatible_results') (result(fact).input_snapshot as { goal: { unit: string } }).goal.unit = 'USD/month';
    mocks.facts.mockResolvedValue({ factSet: factSet(reason === 'missing_run' ? [] : [fact, CURRENT]),
      hotWindow: { status: 'ok', facts: [] } });
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    expect(ModelVersionDiffV2Schema.parse(reply.json()).result_comparison).toStrictEqual({ status: 'unavailable', reason });
  });

  it('retains the selected Run’s withheld leader in the actual wire', async () => {
    const withheld = clone(CURRENT);
    result(withheld).constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' };
    mocks.facts.mockResolvedValue({ factSet: factSet([PRIOR, withheld]), hotWindow: { status: 'ok', facts: [] } });
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs' });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(value.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
      expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it('preserves recorded input changes containing a lead option id on a withheld pair', async () => {
    const endpoints = [FROM, TO].map((version, i) => {
      const graph = clone(GraphStateIngressSchema.parse(version.graph));
      const price = i === 0 ? 12 : 13;
      for (const node of graph.nodes) {
        if (node.id === 'opt-a') {
          node.id = 'generate-leads';
          node.interventions = { n_price: { value: price, source: 'brief_extraction' } };
        }
      }
      for (const edge of graph.edges) {
        if (edge.from === 'opt-a') edge.from = 'generate-leads';
        if (edge.to === 'opt-a') edge.to = 'generate-leads';
      }
      const saved = versionRecord(graph, { id: version.id });
      const base = savedRun(saved, i === 0 ? 'bound-prior' : 'bound-current',
        i === 0 ? '2026-10-02T00:00:00.000Z' : '2026-10-02T01:00:00.000Z', i === 0 ? 0.62 : 0.45);
      const recorded = result(base);
      const enrichment = recorded.enrichment as Record<string, unknown>;
      enrichment.results = (enrichment.results as Record<string, unknown>[]).map(option =>
        ({ ...option, option_id: option.option_id === 'opt-a' ? 'generate-leads' : option.option_id }));
      const run = RunAnalysisHandlerFactSchema.parse({ ...base, fact_version: 1, result: {
        ...recorded, leading_option_id: i === 0 ? 'generate-leads' : 'opt-b', summary: '',
        constraint_verdict: { may_name_leading_option: i === 0, constraint_verdict_state: 'evaluated_feasible' },
        input_snapshot: RunInputSnapshotSchema.parse({ ...(recorded.input_snapshot as Record<string, unknown>),
          options: [{ option_id: 'generate-leads', label: 'Offshore partner', settings: [
            { factor_id: 'n_price', label: 'Price', raw: price, unit: 'GBP', encoded: price },
          ] }],
        }),
      } });
      return { saved, run };
    });
    mocks.getVersion.mockImplementation(async (_scenario: string, id: string) =>
      id === FROM.id ? endpoints[0]!.saved : id === TO.id ? endpoints[1]!.saved : null);
    mocks.facts.mockResolvedValue({ factSet: factSet(endpoints.map(endpoint => endpoint.run)),
      hotWindow: { status: 'ok', facts: [] } });

    const v1 = await compare({ response_schema: undefined }); expect(v1.statusCode).toBe(200);
    ModelVersionDiffV1Schema.parse(v1.json());
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs',
      prior_run: { run_id: 'bound-prior' }, current_run: { run_id: 'bound-current' } });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(value.run_delta.input_changes).toStrictEqual([{
        entity_kind: 'option_setting', entity_id: 'n_price', option_id: 'generate-leads', field: 'value',
        label_before: 'Price', label_after: 'Price',
        before: { raw: 12, unit: 'GBP' }, after: { raw: 13, unit: 'GBP' }, change: 'changed',
      }]);
      expect(value.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
      expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it.each([
    'prior_leading_option_id', 'current_leading_option_id',
  ] as const)('final egress omits residual %s without nulling or losing the delta', async (field) => {
    const withheld = clone(CURRENT);
    result(withheld).constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' };
    mocks.facts.mockResolvedValue({ factSet: factSet([PRIOR, withheld]), hotWindow: { status: 'ok', facts: [] } });
    mocks.residualLeader = field;
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ kind: 'paired_runs', run_delta: { endpoints: {
      prior: { run_id: 'bound-prior' }, current: { run_id: 'bound-current' },
    } } });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(Object.hasOwn(value.run_delta.leader, field)).toBe(false);
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it.each([
    ['prior', 'separation_unavailable'], ['current', 'separation_unavailable'],
    ['prior', 'near_tie'], ['current', 'near_tie'],
  ] as const)('retains %s %s withholding without naming either leader by arithmetic', async (side, reason) => {
    const prior = clone(PRIOR); const current = clone(CURRENT);
    const fact = side === 'prior' ? prior : current;
    const enrichment = result(fact).enrichment as Record<string, unknown>;
    if (reason === 'separation_unavailable') delete enrichment.robustness;
    else enrichment.robustness = { level: 'high', near_tie: { is_tie: true } };
    const permission = readMayNameLeadingOptionVerdictForFact(fact);
    expect(permission.may_name_leading_option).toBe(true); // constraint permission alone is insufficient
    expect(permission.separation_withhold).not.toBeNull();
    mocks.facts.mockResolvedValue({ factSet: factSet([current, prior]), hotWindow: { status: 'ok', facts: [] } });
    const reply = await compare(); expect(reply.statusCode).toBe(200);
    const value = ModelVersionDiffV2Schema.parse(reply.json()).result_comparison;
    expect(value).toMatchObject({ status: 'available', kind: 'paired_runs' });
    if (value.status === 'available' && value.kind === 'paired_runs') {
      expect(value.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
      expect(value.run_delta.leader).not.toHaveProperty('current_leading_option_id');
      expect(value.run_delta.win_probabilities).toStrictEqual([]);
    }
  });

  it('refuses client graph/hash truth before reading selected versions', async () => {
    const reply = await compare({ graph: FROM.graph }); expect(reply.statusCode).toBe(422);
    expect(mocks.getVersion).not.toHaveBeenCalled(); expect(mocks.facts).not.toHaveBeenCalled();
  });
});
