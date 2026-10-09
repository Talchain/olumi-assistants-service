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
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { withUntestedHorizonWarning } from '../decision-input-ask.js';
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
    option_label: row.option_label, win_probability: 1 / body.option_comparison.length }));
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
  beforeEach(() => { currentFact = undefined; storedRunJson = undefined; rows.clear(); script = []; });

  const cases = [
    { name: 'B1 H12, no carrier', make: () => clone(B1_GRAPH), verdict: 'withhold' },
    { name: 'B1 H12, carrier H12', make: () => b1Carrier(12), verdict: 'computed_at_h' },
    ...[6, 12, 24].map(months => ({ name: `B1 sized CONTROL H${months}`, make: () => sizedB1Carrier(months), verdict: 'computed_at_h', visible: true })),
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
      expect(body._answer_shape.detail).toContain(produced.inference_warnings.find((w: Rec) => w.code === HORIZON_WITHHOLD).say);
    }
    if (verdict !== 'no_horizon') expect(body.assistant_text).not.toMatch(/This chance uses|These chances use/);
    process.stdout.write(`S4 consumers: ${goal(graph).id} ${cases.find(c => c.make === make)?.name ?? ''}: producer=${verdict} stored=${verdict} conversation=${verdict} UI=${verdict}; cells=${ui.options.map(row => row.cell.kind).join(',')}; reasons=${ui.options.flatMap(row => row.cell.kind === 'withheld' ? row.cell.reasons.map(r => r.code) : []).join(',')}\n`);
  }, 60_000);
});
