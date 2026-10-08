/**
 * Science §(ad): served B2 graph → real Run producer → real Agent reply route.
 * Provider responses are scripted; no provider or database is contacted.
 * The witness graph is unchanged. Raw point/outcome fields removed by its
 * public transport are reconstructed explicitly, not claimed as captured draws.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { untestedHorizonLine } from '../decision-input-ask.js';
import { horizonSteadyAttested, steadyAttestationKey } from '../../goal-target/horizon-basis.js';
import { applyGoalSteadyEdit } from '../../goal-target/goal-steady-write.js';
import { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from '../../goal-target/zero-spread-horizon-line.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { createRunAnalysisHandler, withholdGoalFiguresForUntestedHorizon } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const fixture = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const B2_RUN = fixture('../../../routes/__tests__/fixtures/b2-zero-spread/run.json');
const B2_READ = fixture('../../../routes/__tests__/fixtures/b2-zero-spread/read-graph-1791489457020.json').j;
const B1_GRAPH = fixture('./fixtures/served-b1-widened-20261008.json');
const SOURCE_RESULT = B2_RUN.blocks.find((block: Rec) => block.type === 'analysis_result');
const SCENARIO = '5e0fbc03-8af8-488e-b02f-82c25499e59e';
const GOAL = 'monthly_recurring_revenue';
const HORIZON_WITHHOLD = 'GOAL_FIGURES_HORIZON_NOT_TESTED';
const OLD_HORIZON = "This model doesn't yet say whether any option gets there within 9 months.";
const NARRATOR = 'Your results are ready. Launch starter tier has about 99% chance. Raise prices has about 46% chance. Keep current pricing has about 0% chance.';
const WHY = 'You said ‘monthly recurring revenue’ stays about where it is over 9 months unless you act, so this is its chance once each option is in effect.';
const CAPTURE_BASELINE = process.env.S2_CAPTURE_BASELINE === '1';
const clone = <T>(value: T): T => structuredClone(value);
const goal = (graph: Rec): Rec => graph.nodes.find((node: Rec) => node.kind === 'goal');
const optionIds = (graph: Rec): string[] => graph.nodes.filter((node: Rec) => node.kind === 'option').map((node: Rec) => node.id);

/** Science's raw point figures, on the exact served graph; Keep=0 was observed by a2. */
function plotBody(): Rec {
  if (providerBodyOverride !== undefined) return clone(providerBodyOverride);
  const body = { ...clone(minimalFixture), ...clone(SOURCE_RESULT.enrichment) };
  // Retain the witness's already-computed Starter range, stripping only its
  // retired qualifier. Fresh Run guards independently regenerate other codes.
  body.inference_warnings = body.inference_warnings.filter((warning: Rec) => warning.code === 'GOAL_CHANCE_RANGE'
    || !String(warning.code).startsWith('GOAL_')).map((warning: Rec) => {
    const next = { ...warning }; delete next.horizon_line; delete next.horizon_untested; return next;
  });
  body.option_comparison.forEach((row: Rec) => {
    row.probability_of_goal = row.option_id === 'launch_starter_tier' ? 0.99 : row.option_id === 'raise_prices_10' ? 0.46 : 0;
    if (row.option_id !== 'keep_current_pricing') row.outcome = {
      p10: row.option_id === 'launch_starter_tier' ? 130000 : 110000,
      p50: row.option_id === 'launch_starter_tier' ? 140000 : 125000,
      p90: row.option_id === 'launch_starter_tier' ? 155000 : 145000,
      mean: row.option_id === 'launch_starter_tier' ? 141000 : 127000, std: 10000,
      n_samples: 10000, validity_ratio: 1, n_valid_samples: 10000, percentiles_source: 'samples',
    };
  });
  body.results = body.option_comparison.map((row: Rec) => ({ option_id: row.option_id,
    option_label: row.option_label, win_probability: row.option_id === 'launch_starter_tier' ? 0.7 : 0.15 }));
  return body;
}

/**
 * A constructed, fully sized level-change B2 control isolates §(ad) from the
 * served capture's separate unsized-link refusals. The horizon is never scored.
 */
function cleanB2(): { graph: Rec; body: Rec } {
  const g = clone(B2_READ.graph);
  g.nodes = g.nodes.filter((node: Rec) => ['goal', 'option', 'decision'].includes(node.kind));
  g.nodes.push({ id: 'monthly_change', kind: 'factor', label: 'Monthly revenue change', scale_frame: 50000,
    provenance: 'user_set', observed_state: { value: 0, raw_value: 0, unit: '£/month', source: 'user_confirmed' } });
  g.nodes.filter((node: Rec) => node.kind === 'option').forEach((node: Rec, index: number) => {
    const raw = [6000, 20000, 0][index]!;
    node.interventions = { monthly_change: { value: raw / 50000, raw_value: raw, unit: '£/month', source: 'user_override' } };
  });
  const edge = (from: string, to: string): Rec => ({ from, to, strength: { mean: 1, std: 0.01 },
    exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } });
  g.edges = [...g.nodes.filter((node: Rec) => node.kind === 'option').flatMap((node: Rec) => [
    edge('decision_monthly_recurring_revenue', node.id), edge(node.id, 'monthly_change'),
  ]), { from: 'monthly_change', to: GOAL, strength: { mean: 50000 / 157500, std: 0.01 },
    // A typed existence hypothesis keeps the existing licence in per-option form; all path sizes remain stated.
    exists_probability: 0.8, effect_direction: 'positive', defaulted: false,
    provenance: { source: 'cee_hypothesis', magnitude: 'user_stated', natural_effect: {
      amount: 1, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month',
      strength_mean: 50000 / 157500, strength_mean_frame: 'edge_strength',
    } } }];
  const body = { ...clone(minimalFixture), option_comparison: [
    { option_id: 'raise_prices_10', option_label: 'Raise prices', probability_of_goal: 0.46,
      outcome: { p10: 110000, p50: 125000, p90: 145000, mean: 126000, std: 10000 } },
    { option_id: 'launch_starter_tier', option_label: 'Launch starter tier', probability_of_goal: 0.99,
      outcome: { p10: 128000, p50: 140000, p90: 155000, mean: 140000, std: 10000 } },
    { option_id: 'keep_current_pricing', option_label: 'Keep current pricing', probability_of_goal: 0.15,
      outcome: { p10: 110000, p50: 120000, p90: 130000, mean: 120000, std: 5000 } },
  ], inference_warnings: [] };
  body.results = body.option_comparison.map((row: Rec, index: number) => ({ option_id: row.option_id,
    option_label: row.option_label, win_probability: [0.2, 0.7, 0.1][index] }));
  return { graph: g, body };
}

async function realRun(graph: Rec): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-ad-load', {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: clone(graph), briefText: 'Compare the pricing options.' }),
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
let providerBodyOverride: Rec | undefined;
let script: Rec[][] = [];
let app: FastifyInstance;
let lastView: ReturnType<typeof projectCanonicalAnalysisView>;
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
async function turn(narrator = NARRATOR): Promise<Body> {
  script = [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'ad-run' }],
    [{ type: 'message', content: [{ type: 'output_text', text: narrator }] }]];
  sequence += 1;
  const payload = { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.',
    turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(sequence).padStart(12, '0')}` };
  const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as Body;
  expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'run_analysis', ok: true }));
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
      currentResult = buildAnalysisResultBlock(currentFact as never) as Rec;
      return { response_version: 2, assistant_text: 'Your results are ready.', suggested_actions: [], insights: [],
        graph_hash: currentFact.result.graph_hash_at_run, blocks: [currentResult],
        analysis_ready: B2_READ.analysis_ready, analysis_state: B2_READ.analysis_state };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      lastView = projectCanonicalAnalysisView({ graph,
        runFact: (currentFact ?? { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
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
  beforeEach(() => { graph = clone(B2_READ.graph); currentResult = clone(SOURCE_RESULT); currentFact = undefined;
    providerBodyOverride = undefined; rows.clear(); script = []; });

  it('B2 H9: every scored option withheld; no narrator percentage, same face marker, no retired clause', async () => {
    expect(goal(graph).goal_horizon_months).toBe(9);
    expect(graph.nodes.some((node: Rec) => node.nonlinear_identity?.operation === 'accumulation')).toBe(false);
    const body = await turn();
    const captureDir = process.env.S2_CAPTURE_REPLY_DIR;
    if (captureDir !== undefined) {
      if (!captureDir.startsWith('/private/tmp/')) throw new Error('Reply capture must stay under /private/tmp');
      mkdirSync(captureDir, { recursive: true });
      writeFileSync(join(captureDir, CAPTURE_BASELINE ? 'b2-before.txt' : 'b2-after.txt'), `${body.assistant_text}\n`);
      writeFileSync(join(captureDir, CAPTURE_BASELINE ? 'b2-before-shape.json' : 'b2-after-shape.json'), `${JSON.stringify(body._answer_shape, null, 2)}\n`);
      writeFileSync(join(captureDir, CAPTURE_BASELINE ? 'b2-before-cells.json' : 'b2-after-cells.json'), `${JSON.stringify(lastView.options, null, 2)}\n`);
    }
    if (CAPTURE_BASELINE) { expect(body.assistant_text).toContain('%'); return; }
    expect(currentFact!.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({
      code: HORIZON_WITHHOLD, option_ids: expect.arrayContaining(optionIds(graph)),
    }));
    for (const row of currentFact!.result.enrichment.option_comparison) expect(row).not.toHaveProperty('probability_of_goal');
    expect(lastView.options.map(row => row.option_id).sort()).toEqual(optionIds(graph).sort());
    for (const row of lastView.options) {
      expect(row.cell.kind).toBe('withheld');
      expect(row.cell).toMatchObject({ reasons: expect.arrayContaining([expect.objectContaining({ code: HORIZON_WITHHOLD })]) });
    }
    expect(body.assistant_text).not.toContain('%');
    expect([body._answer_shape.headline, ...body._answer_shape.bullets]).toContain(ZERO_SPREAD_NEEDS_MONTHLY_CHANGES);
    expect(body.assistant_text).not.toContain(OLD_HORIZON);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    expect(JSON.stringify(body)).not.toContain('Add monthly changes');
  }, 60_000);

  it('S4 joined: B2 H9 withholds, the real user press licences steady, another scenario withholds again', async () => {
    const clean = cleanB2(); graph = clean.graph; providerBodyOverride = clean.body;
    expect(goal(graph).goal_horizon_months).toBe(9);
    expect(graph.nodes.some((node: Rec) => node.nonlinear_identity?.operation === 'accumulation')).toBe(false);
    expect(goalHorizonVerdict(graph, undefined, SCENARIO)).toBe('withhold');
    const withheld = await realRun(graph);
    expect(withheld.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({
      code: HORIZON_WITHHOLD, option_ids: expect.arrayContaining(optionIds(graph)),
    }));
    expect(withheld.result.enrichment.option_comparison).toHaveLength(optionIds(graph).length);
    for (const row of withheld.result.enrichment.option_comparison) expect(row).not.toHaveProperty('probability_of_goal');
    const pressed = applyGoalSteadyEdit(graph, { goal_id: goal(graph).id, months: 9 }, SCENARIO);
    expect(pressed.kind).toBe('mutated');
    if (pressed.kind !== 'mutated') throw new Error('The user press was not written');
    graph = pressed.mutatedGraph;
    expect(goalHorizonVerdict(graph, undefined, SCENARIO)).toBe('steady_attested');
    const admitted = await realRun(graph);
    expect(admitted.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({
      code: 'GOAL_CHANCE_LICENSED',
      horizon_basis: { basis: 'steady_attested', source: 'user_stated', months: 9, why: WHY },
    }));
    expect(goalHorizonVerdict(graph, admitted.result.enrichment, 'another-scenario')).toBe('withhold');
  }, 60_000);

  it.skipIf(CAPTURE_BASELINE)('same served B2 + user attestation: its licensed range survives, Why once, no disclaimer', async () => {
    Object.assign(goal(graph), { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: goal(graph).goal_horizon_months });
    goal(graph).horizon_basis_key = steadyAttestationKey(goal(graph), SCENARIO);
    const body = await turn();
    expect(goalHorizonVerdict(graph, currentFact!.result.enrichment, SCENARIO)).toBe('steady_attested');
    expect(currentFact!.result.enrichment.inference_warnings.some((warning: Rec) => [HORIZON_WITHHOLD, 'GOAL_HORIZON_NOT_TESTED'].includes(warning.code))).toBe(false);
    // Raise's independently unsized links remain a separate refusal in the exact served model.
    expect(lastView.options.some(row => row.cell.kind === 'figure' || row.cell.kind === 'range')).toBe(true);
    expect(body.assistant_text).toContain('%');
    expect(body.assistant_text.split(WHY)).toHaveLength(2);
    if (body._answer_shape !== undefined) expect(body._answer_shape.detail).toContain(WHY);
    expect(body.assistant_text).not.toContain(OLD_HORIZON);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
  }, 60_000);

  it.skipIf(CAPTURE_BASELINE).each(['ai_inferred', 'from_brief'])('same B2 + %s attestation still withholds', async provenance => {
    Object.assign(goal(graph), { horizon_basis: 'steady_attested', horizon_basis_source: provenance, horizon_basis_months: goal(graph).goal_horizon_months });
    const body = await turn();
    expect(goalHorizonVerdict(graph, currentFact!.result.enrichment)).toBe('withhold');
    expect(lastView.options.every(row => row.cell.kind === 'withheld')).toBe(true);
    expect(body.assistant_text).not.toContain('%');
    expect(body.assistant_text).not.toContain(WHY);
    expect(body.assistant_text).not.toContain(OLD_HORIZON);
  }, 60_000);

  it.skipIf(CAPTURE_BASELINE)('fully sized B2 shape: attestation alone unlocks all three option chances, Why once', async () => {
    const clean = cleanB2(); graph = clean.graph; providerBodyOverride = clean.body;
    const withheld = await realRun(graph);
    expect(withheld.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({ code: HORIZON_WITHHOLD }));
    for (const row of withheld.result.enrichment.option_comparison) expect(row).not.toHaveProperty('probability_of_goal');
    Object.assign(goal(graph), { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: goal(graph).goal_horizon_months });
    goal(graph).horizon_basis_key = steadyAttestationKey(goal(graph), SCENARIO);
    const body = await turn();
    expect(goalHorizonVerdict(graph, currentFact!.result.enrichment, SCENARIO)).toBe('steady_attested');
    expect(lastView.options).toHaveLength(3);
    expect(lastView.options.every(row => row.cell.kind === 'figure')).toBe(true);
    expect(body.assistant_text).toContain('%');
    expect(body.assistant_text.split(WHY)).toHaveLength(2);
    if (body._answer_shape !== undefined) expect(body._answer_shape.detail).toContain(WHY);
    expect(body.assistant_text).not.toContain(OLD_HORIZON);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
  }, 60_000);

  it.skipIf(CAPTURE_BASELINE).each([false, true])('retired exact narrator horizon identities are removed (steady=%s)', async steady => {
    if (steady) {
      Object.assign(goal(graph), { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: goal(graph).goal_horizon_months });
      goal(graph).horizon_basis_key = steadyAttestationKey(goal(graph), SCENARIO);
    }
    const copies = [OLD_HORIZON, untestedHorizonLine(graph, { normalizationOnly: true }),
      untestedHorizonLine(graph, { plural: true, normalizationOnly: true })].filter((line): line is string => line !== null);
    const body = await turn([NARRATOR, ...copies].join(' '));
    for (const copy of copies) expect(body.assistant_text).not.toContain(copy);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    if (steady) expect(body.assistant_text.split(WHY)).toHaveLength(2);
    else expect(body.assistant_text).not.toContain('%');
  }, 60_000);

  it.skipIf(CAPTURE_BASELINE)('steady zero-spread option reads the same tolerant horizon facts as the producer', async () => {
    const clean = cleanB2(); graph = clean.graph; providerBodyOverride = clean.body;
    Object.assign(goal(graph), { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: goal(graph).goal_horizon_months });
    goal(graph).horizon_basis_key = steadyAttestationKey(goal(graph), SCENARIO);
    const keep = providerBodyOverride!.option_comparison.find((row: Rec) => row.option_id === 'keep_current_pricing');
    keep.probability_of_goal = 0;
    keep.outcome = { ...keep.outcome, mean: 120000, std: 0, p10: 120000, p50: 120000, p90: 120000 };
    const body = await turn();
    const licence = currentFact!.result.enrichment.inference_warnings.find((warning: Rec) => warning.code === 'GOAL_CHANCE_LICENSED');
    expect(licence.withheld_reason_by_option.keep_current_pricing.line).not.toBe(ZERO_SPREAD_NEEDS_MONTHLY_CHANGES);
    expect(body.assistant_text).not.toContain(ZERO_SPREAD_NEEDS_MONTHLY_CHANGES);
    expect(body.assistant_text.split(WHY)).toHaveLength(2);
  }, 60_000);

  it('no-H brief: all three current-number chances survive and baseline reply bytes are unchanged', async () => {
    const clean = cleanB2(); graph = clean.graph; providerBodyOverride = clean.body;
    delete goal(graph).goal_horizon_months;
    const body = await turn();
    expect(lastView.options).toHaveLength(3);
    expect(lastView.options.every(row => row.cell.kind === 'figure')).toBe(true);
    expect(currentFact!.result.enrichment.inference_warnings.some((warning: Rec) => warning.code === HORIZON_WITHHOLD)).toBe(false);
    expect(body.assistant_text).toContain('%');
    const captureDir = process.env.S2_CAPTURE_REPLY_DIR;
    if (captureDir !== undefined) {
      if (!captureDir.startsWith('/private/tmp/')) throw new Error('Reply capture must stay under /private/tmp');
      mkdirSync(captureDir, { recursive: true });
      const before = join(captureDir, 'no-h-before.txt');
      if (!CAPTURE_BASELINE && existsSync(before)) expect(`${body.assistant_text}\n`).toBe(readFileSync(before, 'utf8'));
      writeFileSync(join(captureDir, CAPTURE_BASELINE ? 'no-h-before.txt' : 'no-h-after.txt'), `${body.assistant_text}\n`);
    }
  }, 60_000);
});

describe.skipIf(CAPTURE_BASELINE)('Science §(ad) typed selector and unchanged controls', () => {
  // User attestation is bound to the single goal's meaning, month and scenario.
  const steady = (patch: Record<string, unknown> = {}) => {
    const g = { id: GOAL, label: 'Monthly recurring revenue', kind: 'goal', goal_horizon_months: 9,
      horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: 9, ...patch };
    return { nodes: [{ ...g, horizon_basis_key: steadyAttestationKey(g, SCENARIO) }] };
  };
  it.each(['ai_inferred', 'from_brief', 'drafter', undefined])('steady flag is not user attestation with source %s', source => {
    expect(horizonSteadyAttested(steady({ horizon_basis_source: source }), SCENARIO)).toBe(false);
  });
  it('accepts only a positive integer H, a user_stated source and the same attested month', () => {
    expect(horizonSteadyAttested(steady(), SCENARIO)).toBe(true);
    for (const horizon of [undefined, 0, -1, 1.5, '9', Number.NaN]) {
      expect(horizonSteadyAttested(steady({ goal_horizon_months: horizon }), SCENARIO)).toBe(false);
    }
    expect(horizonSteadyAttested(steady({ goal_horizon_months: 12 }), SCENARIO), 'a deadline edit voids the attestation').toBe(false);
    expect(horizonSteadyAttested(steady({ kind: 'factor' }), SCENARIO)).toBe(false);
    expect(horizonSteadyAttested(steady({ horizon_basis_source: undefined, provenance: 'user_set' }), SCENARIO),
      'goal provenance alone is not the attestation').toBe(false);
  });
  it('no H leaves the exact envelope object and bytes unchanged', () => {
    const graph = clone(B2_READ.graph); delete goal(graph).goal_horizon_months;
    const envelope = plotBody(); const before = JSON.stringify(envelope);
    expect(goalHorizonVerdict(graph, envelope)).toBe('no_horizon');
    expect(withholdGoalFiguresForUntestedHorizon(envelope, graph)).toBe(envelope);
    expect(JSON.stringify(envelope)).toBe(before);
  });
  it('served B1 has its accumulation carrier; admitted user-input/evaluated control is unchanged bytes', () => {
    const graph = clone(B1_GRAPH); const g = goal(graph);
    expect(g.goal_horizon_months).toBe(12);
    const carrier = graph.nodes.find((node: Rec) => node.nonlinear_identity?.operation === 'accumulation');
    expect(g.nonlinear_identity.factor_ids).toContain(carrier.id);
    // #2858/#2868 admit all three user-input slots; the raw served draft guessed them.
    carrier.nonlinear_identity.factor_ids.forEach((id: string) => {
      graph.nodes.find((node: Rec) => node.id === id).observed_state.source = 'user_confirmed';
    });
    const envelope = { ...plotBody(), identity_evaluations: graph.nodes.filter((node: Rec) => node.nonlinear_identity)
      .map((node: Rec) => ({ node_id: node.id, evaluated: true, ...node.nonlinear_identity })) };
    const before = JSON.stringify(envelope);
    expect(goalHorizonVerdict(graph, envelope)).toBe('computed_at_h');
    expect(withholdGoalFiguresForUntestedHorizon(envelope, graph)).toBe(envelope);
    expect(JSON.stringify(envelope)).toBe(before);
    const drift = clone(graph); goal(drift).goal_horizon_months = 9;
    expect(goalHorizonVerdict(drift, envelope)).toBe('withhold');
    const unattested = { ...envelope, identity_evaluations: [] };
    expect(goalHorizonVerdict(graph, unattested)).toBe('withhold');
  });
});
