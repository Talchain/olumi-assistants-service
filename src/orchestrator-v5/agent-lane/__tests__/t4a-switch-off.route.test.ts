/** T4: real agent route, construction and first-Run admission; scripted provider,
 * in-memory registration/session storage and a counted Run dispatcher. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { AnalysisNotReadyError, resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { assessCanonicalAnalysisReadiness, blockerIssue } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';

import { runFirstAnalysisAfterConstruction } from '../first-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import minimalEngineResponse from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { valueClassOf } from '../../../cee/provenance/provenance-of.js';

type Rec = Record<string, any>;
let draft: Rec;
let brief: string;
let saved: Rec = { nodes: [], edges: [] };
let built = false;
let runs = 0;
let storedGraph: Rec | undefined;
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: async () => ({ user_id: null }),
  readCommittedTurn: async (_s: string, id: string) => rows.get(id) ?? null,
  readRecent: async () => [], readFactsFor: async () => [], readAnalysisInvalidatedAt: async () => null,
  append: async (w: Rec) => { rows.set(w.turn_id, { id: w.turn_id, request_hash: w.request_hash,
    assistant_message: w.assistantMessage, pending_actions: w.pending_actions ?? [], llm_calls_used: w.llm_calls_used ?? 0 }); return { id: w.turn_id }; },
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Rec>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_c: unknown, _b: unknown, _o: unknown, call: unknown, build: (c: unknown) => Promise<unknown>) => build(call),
}));
vi.mock('../../build-turn-context.js', async (original) => ({
  ...await original<Rec>(), loadPriorFactsWithReadState: async () => ({ status: 'ok', facts: [] }),
}));
vi.mock('../../handlers/chip-click-dispatch.js', async (original) => ({
  ...await original<Rec>(), dispatchChipClickRunAnalysis: async () => {
    await runEngine(saved);
    return { outcome: 'ok', response: { response_version: 2, assistant_text: 'Conditional model analysis.',
      blocks: [{ type: 'analysis_result', summary: 'Conditional model analysis.' }], suggested_actions: [], insights: [] } };
  },
}));
async function runEngine(graph: Rec) {
  const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const snapshot = await loadScenarioSnapshotForRunAnalysis(sid, 't4-engine', {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: brief }),
  } as never);
  const handler = createRunAnalysisHandler({
    scenarioReader: async () => snapshot,
    plotClient: { run: async () => { runs++; return structuredClone(minimalEngineResponse); }, validatePatch: async () => ({}) } as never,
  });
  const outcome = await handler({ payload: { scenario_id: sid, turn_id: 't4-engine', kind: 'message', message: 'Run analysis.' },
    requestId: 't4-engine', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(outcome.handler_facts[0]?.fact_type).toBe('run_analysis');
}
function candidate(): Rec {
  return {
    goal: { metric: 'Output', operator: '>=', target_stated: true, frame: 'level', value: 100,
      unit: 'tickets', horizon_months: 3, provenance: 'explicit', baseline_known: false, baseline_value: 60,
      baseline_provenance: 'ai_proposed', scope: null },
    constraints: [],
    options: [0, 1].map(i => ({ label: i ? 'Expanded service' : 'Current service', provenance: 'explicit', changes: [],
      is_status_quo: false, interventions: [{ factor_label: 'Staff', value: i ? 8 : 4, value_kind: 'absolute', unit: 'people', provenance: 'ai_proposed' }] })),
    factors: [{ label: 'Staff', role: 'controllable', baseline_known: false, baseline_value: 4, unit: 'people', provenance: 'ai_proposed', plausible_max: 10 }],
    risks: [], outcomes: [], identities: [], unknowns: [], decision_question: null,
    links: [{ from: 'Staff', to: 'Output', direction: 'positive', provenance: 'ai_proposed',
      effect_amount: 10, effect_per_source_change: 1, effect_provenance: 'ai_proposed', basis: 'Provisional capacity per person.' }],
  };
}
const node = (label: string) => saved.nodes.find((n: Rec) => n.label === label)!;
const edge = (from: string, to: string) => saved.edges.find((e: Rec) => e.from === from && e.to === to)!;
let app: FastifyInstance;
beforeAll(async () => {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Unexpected network: ${String(url)}`);
    const b = JSON.parse(init?.body ?? '{}');
    let response: Rec;
    if (b.text?.format?.type === 'json_schema' || b.response_format?.type === 'json_schema') {
      response = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] };
    } else if (!built) {
      built = true;
      response = { output: [{ type: 'function_call', name: 'build_model_from_brief', call_id: 'build', arguments: JSON.stringify({ brief }) }] };
    } else response = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'These are provisional assumptions in the current model.' }] }] };
    return new Response(JSON.stringify(response), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => {
    const analysis_state = { run_state: { kind: 'never_run' } };
    return { graph: saved, graph_hash: saved.nodes.length ? 't4-built' : 'empty', analysis_state,
      canonical_analysis_view: projectCanonicalAnalysisView({ graph: saved, analysisState: analysis_state as never }) };
  });
  app.post('/assist/v1/scenarios/:id/graph/register', async req => {
    saved = GraphV3.parse(storedGraph ?? (req.body as Rec).graph);
    return { registered: true, graph_hash: 't4-built', model_version: { version_number: 1 } };
  });
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
  await app.register(agentV1TurnRoute); await app.ready();
}, 120000);
afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { draft = candidate(); brief = 'Explore current service and expanded service. We aim for at least 100 tickets of Output within three months.';
  saved = { nodes: [], edges: [] }; rows.clear(); built = false; runs = 0; storedGraph = undefined; });
async function construct() {
  const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message: brief,
  } });
  expect(r.statusCode, r.body.slice(0, 500)).toBe(200);
  expect(r.json()._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
  expect(saved.nodes.length).toBeGreaterThan(0);
  return r.json();
}
describe('T4 admission through the real route', () => {

  it('T4b: an authenticated factor value replaces its drafted estimate before framing', async () => {
    draft.factors[0].label = 'Engineers'; draft.factors[0].unit = 'engineers';
    for (const o of draft.options) o.interventions[0].factor_label = 'Engineers';
    draft.links[0].from = 'Engineers';
    brief += ' We currently have 6 engineers.';
    await construct();
    expect(node('Engineers').observed_state).toEqual({ value: 0.6, raw_value: 6, cap: 10, declared_scale: 'unit_interval', unit: 'engineers', source: 'brief_extraction', extractionType: 'explicit' });
    expect(valueClassOf(node('Engineers').observed_state)).toBe('user_stated');
  });


  it('A2 deferred: staging withholds the absolute-change starting estimate', async () => {
    draft.goal.frame = 'change_abs'; draft.goal.value = 20;
    draft.goal.basis = { reference: 'today', denominator: 'current Output', period_months: 3, period_kind: 'at_end',
      effect_unit: 'tickets per person at month three', effects_at_period_end: true, also_required: [], open_question: null };
    brief = 'Explore current service and expanded service. Increase Output by at least 20 tickets within three months.';
    await construct();
    expect(node('Output').observed_state).toBeUndefined();
    expect(node('Output').goal_threshold_frame).toBe('change_abs');
  });
  it('A3: a named-unit factor estimate derives a disclosed coordinate frame without losing its number', async () => {
    draft.factors.push({ label: 'Demand', role: 'observable', baseline_known: false, baseline_value: 25, unit: 'tickets', provenance: 'ai_proposed', plausible_max: null });
    draft.links.push({ from: 'Demand', to: 'Output', direction: 'positive', provenance: 'ai_proposed', effect_amount: 0.1, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    await construct();
    expect(node('Demand').scale_frame).toBe(100);
    expect(node('Demand').observed_state).toEqual({ value: 0.25, raw_value: 25, unit: 'tickets', source: 'cee_inference', extractionType: 'inferred' });
  });
  it('A5: target-gap equality keeps the convertible size, labelled Olumi\'s', async () => {
    draft.goal.baseline_known = true; draft.goal.baseline_provenance = 'explicit';
    brief += ' Output is 60 tickets today.';
    await construct();
    expect(edge('staff', 'output').provenance.magnitude).toBe('olumi_estimate');
    expect(edge('staff', 'output').provenance.natural_effect).toMatchObject({ amount: 10, per_source_change: 1 });
  });
  it('A4 K1: an unconvertible estimate never becomes a sized effect on the goal scale', async () => {
    draft.goal.target_stated = false; draft.goal.value = null; draft.goal.baseline_value = null; draft.goal.unit = null;
    await construct();
    expect(node('Output').observed_state).toBeUndefined();
    expect(edge('staff', 'output').provenance.magnitude).not.toBe('olumi_estimate');
    expect(edge('staff', 'output').provenance.natural_effect).toBeUndefined();
  });
  it('A6: keeps the cost-rollup causal edge, labelled as an Olumi assumption', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/served-journey-e-pure-limit-074951Z.json', import.meta.url), 'utf8'));
    draft = fixture.e01_candidate; draft.goal.frame = 'level'; brief = fixture.brief;
    await construct();
    expect(edge('annual_salary_spend', 'ship_the_new_platform').provenance.source).toBe('cee_hypothesis');
    expect(saved.goal_constraints.find((c: Rec) => c.node_id === 'annual_salary_spend').value).toBe(400000);
  });

});

function readyGraph(unmoved = true): Rec {
  const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.2, std: 0.05 }, exists_probability: 1, effect_direction: 'positive' });
  return { nodes: [
    { id: 'd', kind: 'decision', label: 'Service plan' }, { id: 'g', kind: 'goal', label: 'Output' },
    ...['a', 'b'].map((id, i) => ({ id, kind: 'option', label: id, interventions: { f: { value: i ? 0.8 : 0.4, source: 'user_override' } } })),
    { id: 'f', kind: 'factor', label: 'Staff', category: 'controllable', observed_state: { value: 0.5, source: 'user_override' } },
    ...(unmoved ? [{ id: 'u', kind: 'factor', label: 'Demand', category: 'controllable', observed_state: { value: 0.3, source: 'user_override' } }] : []),
  ], edges: [e('d', 'a'), e('d', 'b'), e('a', 'f'), e('b', 'f'), e('f', 'g'), ...(unmoved ? [e('u', 'g')] : [])], goal_node_id: 'g' };
}
// The real automatic Run caller, used by the build route above; its admission
// is deliberately not injectable. Counted dispatcher is the sole Run seam.
async function firstRun(graph: Rec) {
  let called = 0;
  const out = await runFirstAnalysisAfterConstruction({ scenarioId: randomUUID(), constructionTurnId: 'T4',
    revisionHash: 'T4', revisionGraph: graph, requestId: 'T4', deadlineAt: Date.now() + 60000,
    readPriorFacts: async () => ({ status: 'ok', facts: [] }),
    dispatchRunAnalysis: async () => { called++; return { outcome: 'ok', response: { blocks: [{ type: 'analysis_result' }] } } as never; },
  });
  return { out, called };
}
describe('T4 real first-Run caller and kept K1 negatives', () => {
  const binaryRootGraph = (observed?: Rec): Rec => {
    const graph = readyGraph();
    const root = graph.nodes.find((n: Rec) => n.id === 'u');
    root.label = 'Release delivered'; root.scale_frame = 1;
    delete root.observed_state;
    if (observed) root.observed_state = observed;
    for (const option of graph.nodes.filter((n: Rec) => n.kind === 'option')) {
      option.interventions.u = { value: 1, source: 'user_override' };
    }
    return graph;
  };
  it('T4c K1: binary option 1 without a supported current state is unknown and blocks', async () => {
    const graph = binaryRootGraph();
    storedGraph = graph; await construct(); expect(runs).toBe(0);
    expect(node('Release delivered').observed_state).toBeUndefined();
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues).toContainEqual(expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', factor_id: 'u' }));
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect((await firstRun(graph)).called).toBe(0);
  });
  it.each([
    { label: 'Unlabelled continuation', is_baseline: true, value: 0 },
    { label: 'Status quo', value: 1 },
    { label: 'Carry on as now', value: 0 },
  ])('T4f unknown root: $label setting $value does not supply today', async ({ label, value, ...flags }) => {
    const graph = binaryRootGraph();
    const option = graph.nodes.find((n: Rec) => n.id === 'a');
    Object.assign(option, { label, ...flags }); option.interventions.u.value = value;
    const before = structuredClone(graph);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues.map(i => [i.code, i.factor_id, i.message])).toEqual([
      ['MISSING_FACTOR_LEVEL', 'u', 'What is "Release delivered" today, before any option changes it? Without a current level the analysis would treat it as zero.'],
    ]);
    expect((await firstRun(graph)).called).toBe(0);
    await expect(runEngine(graph)).rejects.toBeInstanceOf(AnalysisNotReadyError);
    expect(runs).toBe(0);
    expect(graph).toEqual(before);
  });
  it.each([
    { value: 0.25, raw_value: 0.25, source: 'brief_extraction', extractionType: 'explicit' },
    { value: 0.4, raw_value: 0.4, source: 'cee_inference', extractionType: 'inferred' },
  ])('T4f held state: a baseline setting preserves $source exactly', async (observed) => {
    const graph = binaryRootGraph(observed);
    const option = graph.nodes.find((n: Rec) => n.id === 'a');
    option.is_baseline = true; option.interventions.u.value = 1;
    const before = structuredClone(graph);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    expect((resolveRunAdmission(graph).assessment.canonicalGraph as Rec)?.nodes.find((n: Rec) => n.id === 'u')?.observed_state).toEqual(observed);
    expect((await firstRun(graph)).called).toBe(1);
    expect(graph).toEqual(before);
  });
  it('T4c: binary root with an explicit Olumi starting estimate runs and keeps its label', async () => {
    const observed = { value: 0, source: 'cee_inference', extractionType: 'inferred' };
    const graph = binaryRootGraph(observed);
    storedGraph = graph; await construct(); expect(runs).toBe(1);
    expect(node('Release delivered').observed_state).toEqual(observed);
    expect(valueClassOf(node('Release delivered').observed_state)).toBe('ai_drafted');
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    expect((await firstRun(graph)).called).toBe(1);
  });
  it('T4c: binary root with stated absence runs and keeps the human source', async () => {
    const observed = { value: 0, source: 'brief_extraction', extractionType: 'explicit' };
    const graph = binaryRootGraph(observed);
    storedGraph = graph; await construct(); expect(runs).toBe(1);
    expect(node('Release delivered').observed_state).toEqual(observed);
    expect(valueClassOf(node('Release delivered').observed_state)).toBe('user_stated');
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    expect((await firstRun(graph)).called).toBe(1);
  });
  it('R5: an unmoved but valued controllable factor runs with its limitation', async () => {
    const graph = readyGraph();
    storedGraph = graph; await construct(); expect(runs).toBe(1);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    expect(assessCanonicalAnalysisReadiness(graph).issues).toContainEqual(expect.objectContaining({ code: 'UNREACHABLE_CONTROLLABLE_FACTOR', obligation: 'offered' }));
    expect((await firstRun(graph)).called).toBe(1);
  });
  it('K1: removing that same root value still blocks before the dispatcher (never unknown = 0)', async () => {
    const graph = readyGraph(); delete graph.nodes.find((n: Rec) => n.id === 'u').observed_state;
    storedGraph = graph; await construct(); expect(runs).toBe(0);
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues).toContainEqual(expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', factor_id: 'u' }));
    expect(assessCanonicalAnalysisReadiness(graph).analysisReady?.blockers).toHaveLength(1);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect((await firstRun(graph)).called).toBe(0);
  });
  it('K1: an unknown risk withholds the numerical Run and offers its next step', async () => {
    const graph = readyGraph(); const root = graph.nodes.find((n: Rec) => n.id === 'u');
    root.kind = 'risk'; root.category = 'observable'; delete root.observed_state;
    storedGraph = graph; await construct(); expect(runs).toBe(0);
    expect(assessCanonicalAnalysisReadiness(graph).analysisReady?.unvalued_roots).toBeUndefined();
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues.map(i => i.message)).toEqual(['How likely or how large is "Demand" today? Olumi can’t run the numbers until this risk has a figure.']);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect((await firstRun(graph)).called).toBe(0);
  });
  it('R6: 24 nodes runs; the same-sized malformed cycle still blocks', async () => {
    const graph = readyGraph(false);
    for (let i = graph.nodes.length; i < 24; i++) {
      graph.nodes.push({ id: `p${i}`, kind: 'factor', label: `Context ${i}`, category: 'observable', observed_state: { value: 0.3 } });
      graph.edges.push({ from: `p${i}`, to: 'g', strength: { mean: 0.1, std: 0.05 }, exists_probability: 1, effect_direction: 'positive' });
    }
    expect(graph.nodes).toHaveLength(24);
    storedGraph = graph; await construct(); expect(runs).toBe(1);
    expect((await firstRun(graph)).called).toBe(1);
    graph.edges.push({ from: 'g', to: 'f', strength: { mean: 0.1, std: 0.05 }, exists_probability: 1, effect_direction: 'positive' });
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues).toContainEqual(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
    expect((await firstRun(graph)).called).toBe(0);
  });
  it('R4: the dropped-limit carrier explicitly says the check was not performed', () => {
    expect(blockerIssue({ blocker_type: 'constraint_dropped', factor_id: 'budget', factor_label: 'Budget' }, 0, 'ready')?.message)
      .toBe('This limit was not checked for "Budget"; analysis describes the current model without that check.');
  });
});
