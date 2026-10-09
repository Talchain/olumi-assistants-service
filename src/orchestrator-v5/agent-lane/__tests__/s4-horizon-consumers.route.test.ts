/**
 * S4 §(ad): three served brief shapes → real Run producer → real Agent reply route.
 * Provider responses are scripted; no provider or database is contacted.
 * Raw fixture rows keep the captured structure. Named carrier/sized controls
 * change test inputs explicitly; scripted draws are not observed provider results.
 */
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { goalHorizonVerdict, withholdGoalFiguresForUntestedHorizon } from '../../goal-target/goal-horizon-verdict.js';
import { goalKindOf } from '../../goal-target/goal-kind.js';
import { sayDate } from '../../goal-target/deadline-date.js';
import { teamShareMoments } from '../../goal-target/event-by-date-share.js';
import { CHANCE_FREE_HORIZON_PREFIX, untestedHorizonLineForCells, withUntestedHorizonWarning } from '../decision-input-ask.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const fixture = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const B1_GRAPH = fixture('../../system-events/__tests__/fixtures/b1-828d87ac-stored-graph.json');
const B2_GRAPH = fixture('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json').graph_with_target;
const READ_B3 = fixture('./fixtures/waveB3-unseen2-7addf05-readback-run1.json').j;
const SCENARIO = '5e0fbc03-8af8-488e-b02f-82c25499e59e';
const HORIZON_WITHHOLD = 'GOAL_FIGURES_HORIZON_NOT_TESTED';
const clone = <T>(value: T): T => structuredClone(value);
const goal = (graph: Rec): Rec => graph.nodes.find((node: Rec) => node.kind === 'goal');
const optionIds = (graph: Rec): string[] => graph.nodes.filter((node: Rec) => node.kind === 'option').map((node: Rec) => node.id);
const B2_READ = { analysis_state: READ_B3.analysis_state, analysis_ready: READ_B3.analysis_ready, graph_hash: READ_B3.graph_hash };

/** Keep the served graph intact; scripted nonzero-spread draws are test inputs, not observed provider outputs. */
function plotBody(): Rec {
  const g = goal(graph);
  const target = g.goal_threshold_raw ?? 20000;
  const body = { ...clone(minimalFixture), inference_warnings: [],
    option_comparison: optionIds(graph).map((id, i) => ({ option_id: id,
      option_label: graph.nodes.find((n: Rec) => n.id === id).label, probability_of_goal: 0.4 + i * 0.1,
      outcome: { p10: target * (0.8 + i * 0.05), p50: target * (1 + i * 0.05), p90: target * (1.2 + i * 0.05), mean: target * (1 + i * 0.05), std: target * 0.1,
        n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' },
    })),
    identity_evaluations: graph.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({
      node_id: n.id, ...clone(n.nonlinear_identity), evaluated: true,
      ...(n.kind === 'goal' ? { level_source: 'identity_inputs' } : {}),
    })),
  } as Rec;
  body.results = body.option_comparison.map((row: Rec) => ({ option_id: row.option_id,
    option_label: row.option_label, win_probability: distinctWins
      ? (body.option_comparison.indexOf(row) + 1) / (body.option_comparison.length * (body.option_comparison.length + 1) / 2)
      : 1 / body.option_comparison.length }));
  // Both current and fallback result carriers describe the same scripted ranking.
  for (const row of body.option_comparison) row.win_probability = body.results.find((r: Rec) => r.option_id === row.option_id).win_probability;
  return body;
}

/** zero-spread-certainty's carrier position, with all three user-stated positional inputs admitted. */
function b1Carrier(months: number, carrierMonths = months): Rec {
  const g = clone(B1_GRAPH);
  goal(g).goal_horizon_months = months;
  goal(g).nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true };
  g.nodes.find((n: Rec) => n.id === 'pro_paying_subscribers').nonlinear_identity = {
    operation: 'accumulation', factor_ids: ['s0', 'monthly_churn', 'new_pro_subscribers_per_month'],
    horizon_months: carrierMonths, rate_scale: 0.01, stated_in_brief: true,
  };
  g.nodes.push({ id: 's0', kind: 'factor', label: 'Pro subscribers today', category: 'observable',
    observed_state: { value: 0.3, raw_value: 300, cap: 1000, unit: 'subscribers', source: 'user_confirmed' } });
  g.edges.push({ from: 's0', to: 'pro_paying_subscribers', strength: { mean: 1, std: 0.01 },
    exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } });
  for (const id of ['monthly_churn', 'new_pro_subscribers_per_month']) {
    g.nodes.find((n: Rec) => n.id === id).observed_state.source = 'user_confirmed';
  }
  return g;
}

/** A fully sized B1 control isolates §(ad) from the served graph's separate target/path refusals. */
function sizedB1Carrier(months: number): Rec {
  const g = b1Carrier(months);
  const keepIds = new Set(['mrr', 'pro_plan_price', 'pro_paying_subscribers', 's0', 'monthly_churn', 'new_pro_subscribers_per_month',
    ...g.nodes.filter((n: Rec) => ['decision', 'option'].includes(n.kind)).map((n: Rec) => n.id)]);
  g.nodes = g.nodes.filter((n: Rec) => keepIds.has(n.id));
  g.edges = g.edges.filter((e: Rec) => keepIds.has(e.from) && keepIds.has(e.to)).map((e: Rec) => ({
    ...e, defaulted: false, exists_probability: 1, provenance: { source: 'user_specified', magnitude: 'user_stated' },
  }));
  // This is a stated level target and a user-confirmed starting level, as distinct from the raw capture.
  Object.assign(goal(g), { goal_direction: '>=', observed_state: {
    value: 0.84, baseline: 0.84, raw_value: 21000, cap: 25000, unit: '£/month', source: 'user_confirmed',
  } });
  return g;
}

/** Same explicit sizing as the B1 6/12/24 controls; B2 topology and options, no time carrier. */
function sizedB2(): Rec {
  const g = clone(B2_GRAPH);
  g.edges = g.edges.map((e: Rec) => ({ ...e, defaulted: false, exists_probability: 1,
    provenance: { source: 'user_specified', magnitude: 'user_stated' } }));
  Object.assign(goal(g), { goal_horizon_months: 9, goal_threshold_raw: 400, observed_state: {
    value: 0.5, baseline: 0.5, raw_value: 500, cap: 1000, unit: 'cancellations/month', source: 'user_confirmed',
  } });
  return g;
}

async function realRun(graph: Rec): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-ad-load', {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: clone(graph), briefText: goal(graph).id === 'monthly_profit' ? READ_B3.brief_text
      : goal(graph).id === 'monthly_cancellations' ? 'Compare ways to reduce monthly cancellations.' : 'Compare the Pro pricing options.' }),
    loadGraph: async () => clone(graph),
  } as never);
  const plotRun = vi.fn(async () => plotBody() as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-ad-producer' },
    requestId: 'req-ad-run', signal: new AbortController().signal, context: {}, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(plotRun).toHaveBeenCalled();
  const fact = outcome.handler_facts.find((item: Rec) => item.fact_type === 'run_analysis');
  if (fact === undefined) throw new Error('The real Run handler emitted no Run fact');
  return fact as Rec;
}

let graph: Rec;
let currentResult: Rec;
let currentFact: Rec | undefined;
let storedRunJson: string | undefined;
let script: Rec[][] = [];
let app: FastifyInstance;
let lastView: ReturnType<typeof projectCanonicalAnalysisView>;
let distinctWins = false;
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (write: Rec) => {
    const row = { ...write, assistant_message: write.assistantMessage, user_message: write.userMessage, id: `row-${rows.size + 1}` };
    rows.set(write.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Body = { assistant_text: string; _answer_shape: AnswerShape; _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };
let sequence = 0;
async function turn(narrator = 'Your results are ready.'): Promise<Body> {
  const tool = 'run_analysis';
  script = [[{ type: 'function_call', name: tool,
    arguments: JSON.stringify({ reason: 'compare' }), call_id: 'ad-run' }],
    [{ type: 'message', content: [{ type: 'output_text', text: narrator }] }]];
  sequence += 1;
  const payload = { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.',
    turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(sequence).padStart(12, '0')}` };
  const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as Body;
  expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: tool, ok: true }));
  if (body._answer_shape !== undefined) expect(body.assistant_text).toBe(deriveAnswerTextFromShape(body._answer_shape));
  const callsBeforeReplay = vi.mocked(fetch).mock.calls.length;
  const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json()._agent.replayed).toBe(true);
  expect(replay.json().assistant_text).toBe(body.assistant_text);
  expect(replay.json()._answer_shape).toEqual(body._answer_shape);
  expect(vi.mocked(fetch).mock.calls.length).toBe(callsBeforeReplay);
  return body;
}

describe('Science §(ad) through the producer and reply route', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const request = JSON.parse(String(init?.body ?? '{}'));
      if (request.tool_choice?.name === 'give_provisional_view') return new Response(JSON.stringify({ output: [{
        type: 'function_call', name: 'give_provisional_view', call_id: 'ad-forced',
        arguments: JSON.stringify({ view: 'Review the monthly changes.', reasoning: 'The goal is time-bound.', confirm_step: 'Add the missing figures.' }),
      }] }), { status: 200 });
      return new Response(JSON.stringify({ output: script.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      currentFact = await realRun(graph);
      storedRunJson = JSON.stringify(currentFact);
      currentResult = buildAnalysisResultBlock(JSON.parse(storedRunJson) as never) as Rec;
      return { response_version: 2, assistant_text: 'Your results are ready.', suggested_actions: [], insights: [],
        graph_hash: currentFact.result.graph_hash_at_run, blocks: [currentResult],
        analysis_ready: B2_READ.analysis_ready, analysis_state: B2_READ.analysis_state };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      lastView = projectCanonicalAnalysisView({ graph,
        runFact: ((storedRunJson === undefined ? currentFact : JSON.parse(storedRunJson)) ?? { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
          scenario_id: SCENARIO, run_id: 'fixture-ad-before', summary: currentResult.summary,
          enrichment: currentResult.enrichment, graph_hash_at_run: B2_READ.graph_hash,
          computed_at: B2_READ.analysis_state.run_state.computed_at,
        } }) as never,
        analysisState: B2_READ.analysis_state as never, analysisReady: B2_READ.analysis_ready,
        currentResult: currentResult as never });
      return { graph, graph_hash: currentFact?.result.graph_hash_at_run ?? B2_READ.graph_hash,
        analysis_result: currentResult, analysis_state: B2_READ.analysis_state,
        analysis_ready: B2_READ.analysis_ready, canonical_analysis_view: lastView };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { currentFact = undefined; storedRunJson = undefined; rows.clear(); script = [];
    distinctWins = false; });

  it('by March, no month or carrier: producer and canonical reload withhold every goal chance and retain Q-a ordering', async () => {
    graph = sizedB2(); distinctWins = true;
    delete goal(graph).goal_horizon_months;
    const deadline = '2027-03-31';
    goal(graph).goal_horizon = { deadline };
    const detail = `Your goal is for ${sayDate(deadline)}, and this model only has today's numbers.`;
    expect(graph.nodes.every((node: Rec) => node.nonlinear_identity === undefined)).toBe(true);
    // A7 without a month retains only its existing opener when no cell supplies the detail.
    expect(untestedHorizonLineForCells({ ...graph, goal_constraints: [] }, [])).toBe(`${CHANCE_FREE_HORIZON_PREFIX}.`);
    currentResult = { type: 'analysis_result', summary: 'Awaiting this Run.', enrichment: { option_comparison: [], inference_warnings: [] } };
    const body = await turn();
    const storedRun = JSON.parse(storedRunJson!) as Rec;
    const storedResult = buildAnalysisResultBlock(storedRun as never) as Rec;
    const reload = projectCanonicalAnalysisView({ graph, runFact: storedRun as never,
      currentResult: storedResult as never, analysisState: B2_READ.analysis_state as never, analysisReady: B2_READ.analysis_ready });
    const expectedLeader = optionIds(graph).at(-1)!;
    for (const fact of [currentFact!, storedRun]) {
      expect(goalHorizonVerdict(graph, fact.result.enrichment)).toBe('withhold');
      expect(fact.result.leading_option_id).toBe(expectedLeader);
      const enrichment = fact.result.enrichment;
      expect(enrichment.results).toEqual(plotBody().results);
      for (const id of optionIds(graph)) {
        expect(enrichment.option_comparison.find((row: Rec) => row.option_id === id)).not.toHaveProperty('probability_of_goal');
        expect(enrichment.inference_warnings).toContainEqual(expect.objectContaining({
          code: HORIZON_WITHHOLD, message: detail, say: detail, option_ids: expect.arrayContaining([id]),
        }));
      }
    }
    expect(currentResult.leading_option_id).toBe(expectedLeader);
    expect(storedResult.leading_option_id).toBe(expectedLeader);
    expect(reload.options).toEqual(lastView.options);
    expect(reload.options).toHaveLength(optionIds(graph).length);
    for (const row of reload.options) expect(row.cell).toMatchObject({ kind: 'withheld',
      reasons: expect.arrayContaining([expect.objectContaining({ code: HORIZON_WITHHOLD, message: detail })]) });
    expect(body._answer_shape.detail).toContain(detail);
    expect(body.assistant_text).not.toContain('%');
  }, 60_000);

  it('CONTROL: share-by-date with a calendar deadline keeps its event chance outside §(ad)', () => {
    const deadline = '2027-04-07';
    const unit = '% of launch';
    const moments = teamShareMoments(6, 6, 10);
    const shareGraph = { nodes: [
      { id: 'launch', kind: 'goal', label: 'Launch share', goal_horizon: { deadline }, goal_threshold_frame: 'level',
        goal_threshold: 1, goal_threshold_raw: 100, goal_threshold_cap: 100, goal_threshold_unit: unit, goal_direction: '>=' },
      { id: 'team', kind: 'factor', label: 'Team launch share', category: 'observable',
        observed_state: { value: moments.mean, std: moments.sd, unit, cap: 100, source: 'user_override',
        stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months', deadline, reference_date: '2026-10-07' } } },
      { id: 'keep', kind: 'option' },
    ], edges: [{ from: 'team', to: 'launch', strength: { mean: 1, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', definitional: true, natural_effect: {
        amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit,
        strength_mean: 1, strength_mean_frame: 'edge_strength' } } }] };
    expect(goalKindOf(shareGraph)).toBe('share_by_date');
    expect(goalHorizonVerdict(shareGraph)).toBe('no_horizon');
    const envelope = { option_comparison: [{ option_id: 'keep', probability_of_goal: 0.4 }] };
    expect(withholdGoalFiguresForUntestedHorizon(envelope, shareGraph)).toBe(envelope);
  });

  it('CONTROL: no deadline and no months is no_horizon', async () => {
    graph = sizedB2();
    delete goal(graph).goal_horizon_months;
    delete goal(graph).goal_horizon;
    expect(goalHorizonVerdict(graph)).toBe('no_horizon');
    const fact = await realRun(graph);
    expect(fact.result.enrichment.inference_warnings.some((warning: Rec) => warning.code === HORIZON_WITHHOLD)).toBe(false);
  });

  it('Q-a B2: withheld goal chances retain the leader and win shares without horizon claims, narrator included', async () => {
    graph = sizedB2(); distinctWins = true;
    expect(graph.edges.every((e: Rec) => e.provenance.magnitude === 'user_stated')).toBe(true);
    expect(graph.nodes.every((n: Rec) => n.nonlinear_identity === undefined)).toBe(true);
    currentResult = { type: 'analysis_result', summary: 'Awaiting this Run.', enrichment: { option_comparison: [], inference_warnings: [] } };
    const body = await turn('Your results are ready. The leading option is on track by month 9, in time and within 9 months.');
    const enrichment = currentFact!.result.enrichment;
    const expectedLeader = optionIds(graph).at(-1)!;
    expect(currentFact!.result.leading_option_id, 'leader retained under §(ad)').toBe(expectedLeader);
    expect(currentResult.leading_option_id).toBe(expectedLeader);
    expect(enrichment.results).toEqual(plotBody().results);
    expect(enrichment.inference_warnings.some((w: Rec) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')).toBe(false);
    expect(enrichment.results.every((row: Rec) => Number.isFinite(row.win_probability))).toBe(true);
    expect(lastView.options.every(row => row.cell.kind === 'withheld'
      && row.cell.reasons.some(reason => reason.code === HORIZON_WITHHOLD))).toBe(true);
    for (const row of enrichment.option_comparison) expect(row).not.toHaveProperty('probability_of_goal');
    const comparison = JSON.stringify({ results: enrichment.results, options: enrichment.option_comparison, summary: currentResult.summary });
    const face = [body._answer_shape.headline, ...body._answer_shape.bullets].join('\n');
    expect(comparison).not.toMatch(/by month|on track|in time|within 9 months/i);
    expect(face).not.toMatch(/by month|on track|in time|within 9 months/i);
    expect(body.assistant_text).not.toMatch(/by month|on track|in time|within 9 months/i);
    const horizonLeader = currentFact!.result.leading_option_id;
    delete goal(graph).goal_horizon_months;
    const noHorizon = await realRun(graph);
    expect(noHorizon.result.leading_option_id).toBe(horizonLeader);
    expect(noHorizon.result.enrichment.results).toEqual(enrichment.results);
    expect(noHorizon.result.enrichment.inference_warnings.some((w: Rec) => w.code === HORIZON_WITHHOLD)).toBe(false);
  }, 60_000);

  it('Q-c Run never two: §(ad) withheld detail occurs once and replaces A7', async () => {
    // A money-rate goal has no duration limit, so this row actually exercises A7/detail deduplication.
    graph = clone(B1_GRAPH); goal(graph).goal_horizon_months = 9;
    currentResult = { type: 'analysis_result', summary: 'Awaiting this Run.', enrichment: { option_comparison: [], inference_warnings: [] } };
    const body = await turn();
    const detail = currentFact!.result.enrichment.inference_warnings.find((w: Rec) => w.code === HORIZON_WITHHOLD).say;
    expect(body.assistant_text).not.toContain(CHANCE_FREE_HORIZON_PREFIX);
    expect(body._answer_shape.detail.split(detail)).toHaveLength(2);
    expect(body.assistant_text.split(detail)).toHaveLength(2);
    expect(currentFact!.result.enrichment.inference_warnings.some((w: Rec) => w.code === 'GOAL_HORIZON_NOT_TESTED')).toBe(false);
  }, 60_000);

  const cases = [
    { name: 'B1 H12, no carrier', make: () => clone(B1_GRAPH), verdict: 'withhold' },
    { name: 'B1 H12, carrier H12', make: () => b1Carrier(12), verdict: 'computed_at_h' },
    ...[6, 12, 24].map(months => ({ name: `B1 sized CONTROL H${months}`, make: () => sizedB1Carrier(months), verdict: 'computed_at_h', visible: true })),
    { name: 'B2 sized H9, no carrier', make: sizedB2, verdict: 'withhold' },
    { name: 'B2 cancellations H9, no carrier', make: () => {
      const g = clone(B2_GRAPH); goal(g).goal_horizon_months = 9; return g;
    }, verdict: 'withhold' },
    { name: 'B3 served by-Q3 wording, no numeric H', make: () => clone(READ_B3.graph), verdict: 'no_horizon' },
    ...[6, 12, 24].flatMap(months => [
      { name: `B1 goal H${months}, carrier H${months}`, make: () => b1Carrier(months), verdict: 'computed_at_h' },
      { name: `B1 goal H${months}, carrier H${months === 6 ? 12 : 6}`, make: () => b1Carrier(months, months === 6 ? 12 : 6), verdict: 'withhold' },
    ]),
  ];
  it.each(cases)('$name: producer → stored Run → conversation → UI', async ({ make, verdict, ...control }) => {
    graph = make();
    currentResult = { type: 'analysis_result', summary: 'Awaiting this Run.', enrichment: { option_comparison: [], inference_warnings: [] } };
    expect(goalHorizonVerdict(graph), 'fixture horizon verdict').toBe(verdict);
    const body = await turn();
    const produced = currentFact!.result.enrichment;
    // Reread the mock backend's stored Run bytes, written when the real handler completed.
    expect(storedRunJson).toBeDefined();
    const storedRun = JSON.parse(storedRunJson!) as Rec;
    const stored = storedRun.result.enrichment;
    expect(goalHorizonVerdict(graph, produced), 'producer').toBe(verdict);
    expect(goalHorizonVerdict(graph, stored), 'stored Run').toBe(verdict);
    const withholding = verdict === 'withhold';
    for (const enrichment of [produced, stored]) {
      const warnings = enrichment.inference_warnings.filter((w: Rec) => w.code === HORIZON_WITHHOLD);
      expect(warnings.length > 0).toBe(withholding);
      for (const id of optionIds(graph)) {
        expect(warnings.some((w: Rec) => w.option_ids.includes(id)), `horizon warning for ${id}`).toBe(withholding);
        if (withholding) expect(enrichment.option_comparison.find((r: Rec) => r.option_id === id)).not.toHaveProperty('probability_of_goal');
      }
    }
    const storedResult = buildAnalysisResultBlock(storedRun as never) as Rec;
    const ui = projectCanonicalAnalysisView({ graph, runFact: storedRun as never,
      currentResult: storedResult as never, analysisState: B2_READ.analysis_state as never, analysisReady: B2_READ.analysis_ready });
    expect(ui.options).toHaveLength(optionIds(graph).length);
    expect(ui.options).toEqual(lastView.options);
    const conversation = withUntestedHorizonWarning(stored, graph, ui.options.map(row => row.cell));
    expect(goalHorizonVerdict(graph, conversation), 'conversation input').toBe(verdict);
    expect(conversation.inference_warnings.some((w: Rec) => w.code === HORIZON_WITHHOLD)).toBe(withholding);
    for (const row of ui.options) {
      const horizonHeld = row.cell.kind === 'withheld' && row.cell.reasons.some(reason => reason.code === HORIZON_WITHHOLD);
      expect(horizonHeld, `UI horizon hold for ${row.option_id}`).toBe(withholding);
      if (withholding) expect(row.cell.kind).toBe('withheld');
    }
    if ('visible' in control && control.visible) {
      expect(ui.options.every(row => row.cell.kind === 'figure' || row.cell.kind === 'range'), `sized carrier control has visible chances: ${JSON.stringify(ui.options)}`).toBe(true);
    }
    if (withholding) {
      expect(body.assistant_text).not.toContain('%');
      // H held with no licensed projection: Run warning, cell detail or A7 must say the limit on at least one surface.
      const horizonDetail = produced.inference_warnings.find((w: Rec) => w.code === HORIZON_WITHHOLD).say;
      const runSaysLimit = stored.inference_warnings.some((w: Rec) => w.code === HORIZON_WITHHOLD && w.say === horizonDetail);
      const cellSaysLimit = ui.options.some(row => row.cell.kind === 'withheld'
        && row.cell.reasons.some(reason => reason.code === HORIZON_WITHHOLD && reason.message === horizonDetail));
      const replySaysLimit = body.assistant_text.includes(horizonDetail) || body.assistant_text.includes(CHANCE_FREE_HORIZON_PREFIX);
      expect([runSaysLimit, cellSaysLimit, replySaysLimit].filter(Boolean).length, 'horizon limit never zero').toBeGreaterThanOrEqual(1);
    }
    if (verdict !== 'no_horizon') expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    process.stdout.write(`S4 consumers: ${goal(graph).id} ${cases.find(c => c.make === make)?.name ?? ''}: producer=${verdict} stored=${verdict} conversation=${verdict} UI=${verdict}; cells=${ui.options.map(row => row.cell.kind).join(',')}; reasons=${ui.options.flatMap(row => row.cell.kind === 'withheld' ? row.cell.reasons.map(r => r.code) : []).join(',')}\n`);
  }, 60_000);
});
