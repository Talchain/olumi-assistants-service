/**
 * ITEM 2 (DL 22 Oct; Paul's 80a77832: "Have angel funding money in the bank within 3 weeks", no unit, no level). An aim with
 * no target figure has no chance to show, so the Run says what the model implies for the sized quantity nearest it that every
 * changing option moves ("Angels completing investment within three weeks", in angels): per option p10/p50/p90 in that unit,
 * bound to the SAME Run and stored with it. Synthetic model in that shape; the real mapper, stored projection and Run handler.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { mapLivingModel } from '../../path-b/living-model/mapper.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { goalChanceEstimateCounts } from '../../agent-lane/goal-chance-estimate-attribution.js';
import { goalChanceTargetCause } from '../goal-chance-gate.js';
import { IMPLIED_QUANTITY_KEY, impliedQuantityTarget, livingFramesOf, plotConvertsOutcomes, readImpliedQuantity, readStoredImpliedQuantity, sayTimeScope } from '../implied-quantity.js';

type Json = Record<string, any>;
const SCENARIO = 'f0f0f0f0-0000-4000-8000-0000000000a2';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const set = (factor_id: string, value: number, unit: string, quote: string) => ({ factor_id, estimate_by: null, value, low: null, high: null, unit, ...who(quote) });
const factor = (id: string, label: string, value: number, unit: string, kind: 'factor' | 'outcome' = 'factor') =>
  ({ id, kind, label, estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(`about ${value} ${unit}`) });
const point = (id: string, from: string, to: string, value: number, unit: string, quote: string) =>
  ({ id, from, to, ...who(quote), effect: { estimate_by: null, form: 'point' as const, value, sd: null, low: null, high: null, unit, sign: '+' as const } });
const unsized = (id: string, from: string, to: string) => ({ id, from, to, source: 'olumi' as const, party: null, quote: null,
  effect: { estimate_by: null, form: 'direction_only' as const, value: null, sd: null, low: null, high: null, unit: null, sign: '+' as const } });

/** 80a77832's shape: the aim has no unit and no level; "angels completing investment" (sized) sits one step before it. */
const angels = (opts: { target?: true; equalTarget?: true; splitPaths?: true; unsizedIntro?: true; olumiIntro?: true; currency?: true; noLevel?: true } = {}): LivingModelT => {
  const u = opts.currency ? 'currency' : 'angels';
  return {
  aims: [{ id: 'funding', text: 'Have angel funding money in the bank within 3 weeks', status: 'current', defined_as: null,
    ...who('we need the angel money in the bank within three weeks'),
    target: opts.target || opts.equalTarget
      ? { quantity: 'angel funding in the bank', comparator: opts.equalTarget ? '=' : '>=', value: 250000, low: null, high: null, unit: '£', by_when: 'within 3 weeks', period_months: null, period_by: null, period_deadline: null, period_read_on: null,
        baseline: null, current: 50000, current_source: null, current_unit: null, change_kind: null, source: null }
      : { quantity: 'angel funding money in the bank', comparator: '>=', value: null, low: null, high: null, unit: null, by_when: 'within 3 weeks', period_months: null, period_by: null, period_deadline: null, period_read_on: null,
        baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [
    { status: 'feasible', id: 'current', label: 'Continue your current fundraising approach', developed_from: null, settings: [], ...who('or carry on as we are') },
    { status: 'feasible', id: 'warm', label: 'Warm introductions', developed_from: null, settings: [set('intros', 6, 'introductions', 'get six warm introductions')], ...who('ask for warm introductions') },
    { status: 'feasible', id: 'direct', label: 'Direct outreach', developed_from: null, settings: [set('pitches', 30, 'pitches', 'send thirty pitches')], ...who('pitch angels directly') },
    // A quantity framed by a setting alone, with no level today.
    ...(opts.noLevel ? [{ status: 'feasible' as const, id: 'pledge', label: 'Ask for pledges', developed_from: null, settings: [set('commitments', 2, u, 'get two pledges')], ...who('ask for pledges') }] : []),
  ],
  factors: [
    factor('intros', 'Warm introductions made', 2, 'introductions'),
    factor('pitches', 'Cold pitches sent', 10, 'pitches'),
    opts.noLevel ? { ...factor('commitments', 'Angels completing investment within three weeks', 1, u, 'outcome'), value: null }
      : factor('commitments', 'Angels completing investment within three weeks', 1, u, 'outcome'),
    ...(opts.splitPaths ? [factor('meetings', 'Angel meetings held', 3, 'meetings', 'outcome')] : []),
  ],
  links: [
    opts.unsizedIntro ? unsized('intros_commitments', 'intros', 'commitments')
      : opts.olumiIntro ? { ...unsized('intros_commitments', 'intros', 'commitments'),
        effect: { estimate_by: 'olumi' as const, form: 'point' as const, value: 0.3, sd: null, low: 0.1, high: 0.5, unit: u, sign: '+' as const } }
        : point('intros_commitments', 'intros', 'commitments', 0.3, u, 'each warm intro is worth about a third of an angel'),
    ...(opts.splitPaths
      ? [point('pitches_meetings', 'pitches', 'meetings', 0.2, 'meetings', 'one in five pitches gets a meeting'), unsized('meetings_funding', 'meetings', 'funding')]
      : [point('pitches_commitments', 'pitches', 'commitments', 0.05, u, 'one in twenty pitches lands an angel')]),
    unsized('commitments_funding', 'commitments', 'funding'),
  ],
  risks: [], conditions: [], views: [], history: [],
  };
};
const stored = (model: LivingModelT): Json =>
  projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Json;
const OPTIONS = ['current', 'warm', 'direct'];

/** PLoT's answer for one target node, in the engine's frame (a level is raw / cap). */
const engineAnswer = (byOption: Record<string, [number, number, number]>, seed = 'seed-80a7') => ({
  meta: { seed_used: seed, n_samples: 1000 }, analysis_status: 'computed',
  option_comparison: Object.entries(byOption).map(([option_id, [p10, p50, p90]]) =>
    ({ option_id, option_label: option_id, status: 'computed', win_probability: 1 / 3, outcome: { mean: p50, std: 0.1, p10, p50, p90 } })),
});

describe('the quantity: sized, on every changing option\'s path, resting on nothing unsized, nearest the aim', () => {
  it('80a77832 shape: the aim cannot be sized, so it is "Angels completing investment within three weeks", in angels', () => {
    const g = stored(angels());
    const target = impliedQuantityTarget(g, 'funding', livingFramesOf(g)!, OPTIONS);
    expect(target).toMatchObject({ node_id: 'commitments', label: 'Angels completing investment within three weeks', unit: 'angels' });
    expect(livingFramesOf(g)!.has('funding'), 'precondition: the aim itself has no frame').toBe(false);
  });

  it('options whose paths share no sized quantity give nothing, with the reason', () => {
    const g = stored(angels({ splitPaths: true }));
    expect(impliedQuantityTarget(g, 'funding', livingFramesOf(g)!, OPTIONS)).toBe('no_sized_quantity_on_every_path');
  });

  it('a quantity resting on a link nobody sized is never read: nothing, with the reason', () => {
    const g = stored(angels({ unsizedIntro: true }));
    expect(impliedQuantityTarget(g, 'funding', livingFramesOf(g)!, OPTIONS)).toBe('no_sized_quantity_on_every_path');
  });

  it('no option changes anything: nothing, with the reason', () => {
    const g = stored(angels());
    expect(impliedQuantityTarget(g, 'funding', livingFramesOf(g)!, ['current'])).toBe('no_changing_option');
  });

  it('the time scope is the aim\'s own deadline as written; none declared, none said', () => {
    expect(livingFramesOf(stored(angels()))!.byWhen).toBe('within 3 weeks');
    const m = angels();
    const none = { ...m, aims: m.aims.map((a) => ({ ...a, target: { ...a.target!, by_when: null } })) };
    expect(livingFramesOf(stored(none))!.byWhen).toBeNull();
    expect(sayTimeScope('within 3 weeks')).toBe('within 3 weeks');
    expect(sayTimeScope('March 2027')).toBe('by March 2027');
    expect(sayTimeScope(null)).toBeNull();
  });

  it('Codex r1 on #3660: an unknown currency is never a range, and a quantity with no level today is never read', () => {
    const cur = stored(angels({ currency: true }));
    expect(livingFramesOf(cur)!.get('commitments'), 'precondition: framed, in the placeholder currency').toMatchObject({ unit: 'currency' });
    expect(impliedQuantityTarget(cur, 'funding', livingFramesOf(cur)!, OPTIONS)).toBe('no_sized_quantity_on_every_path');
    const bare = stored(angels({ noLevel: true }));
    expect(livingFramesOf(bare)!.get('commitments')?.cap, 'precondition: framed by a setting').toBeGreaterThan(0);
    expect((bare.nodes as Json[]).find((n) => n.id === 'commitments')!.observed_state, 'precondition: no level').toBeUndefined();
    expect(impliedQuantityTarget(bare, 'funding', livingFramesOf(bare)!, [...OPTIONS, 'pledge'])).toBe('no_sized_quantity_on_every_path');
  });

  it('a legacy scenario (no living model) has no frames, so no quantity is read', () => {
    const { living_model: _gone, ...legacy } = stored(angels());
    expect(livingFramesOf(legacy)).toBeUndefined();
  });
});

describe('the read: ONE engine read of the dispatched request, converted back with the quantity\'s cap', () => {
  it('the exact frame round trip: each engine figure × the cap, in angels, per option in the Run\'s order', async () => {
    const g = stored(angels());
    const frames = livingFramesOf(g)!;
    const cap = frames.get('commitments')!.cap;
    const run = vi.fn(async (_payload: Json) => engineAnswer({ current: [0.25, 0.5, 0.75], warm: [0.5, 0.75, 1], direct: [0.375, 0.625, 0.875] }));
    const dispatched = { graph: { nodes: [], edges: [] }, options: [{ id: 'warm' }], goal_node_id: 'funding', request_id: 'req-1', n_samples: 1000,
      goal_constraints: [{ id: 'x' }], goal_direction: 'maximise' };
    const implied = await readImpliedQuantity({ graph: g, goalId: 'funding', frames, optionIds: OPTIONS, dispatched, seed: 'seed-80a7', run });
    expect(implied).toEqual({ version: 1, status: 'computed', node_id: 'commitments', quantity: 'Angels completing investment within three weeks', unit: 'angels',
      by_option: { current: { p10: 0.25 * cap, p50: 0.5 * cap, p90: 0.75 * cap }, warm: { p10: 0.5 * cap, p50: 0.75 * cap, p90: 1 * cap },
        direct: { p10: 0.375 * cap, p50: 0.625 * cap, p90: 0.875 * cap } }, rests_on_olumi_estimates: false, by_when: 'within 3 weeks' });
    expect(Object.keys((implied as Json).by_option)).toEqual(OPTIONS);
    expect(((implied as Json).by_option.warm.p50 as number) / cap).toBe(0.75);
    // The Run's own graph, options and draws; nothing about the goal it has no target for.
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ graph: dispatched.graph, options: dispatched.options, goal_node_id: 'commitments',
      request_id: 'req-1-implied', seed: 'seed-80a7', n_samples: 1000 });
  });

  it('a quantity resting on Olumi\'s own estimate says so (rests_on_olumi_estimates); the person\'s own figures do not', async () => {
    const run = async () => engineAnswer({ current: [0.25, 0.5, 0.75], warm: [0.5, 0.75, 1], direct: [0.375, 0.625, 0.875] });
    const read = async (m: LivingModelT) => { const g = stored(m);
      return readImpliedQuantity({ graph: g, goalId: 'funding', frames: livingFramesOf(g)!, optionIds: OPTIONS, dispatched: { graph: {}, options: [] }, seed: 's', run }); };
    expect(await read(angels({ olumiIntro: true }))).toMatchObject({ status: 'computed', node_id: 'commitments', rests_on_olumi_estimates: true });
    expect(await read(angels())).toMatchObject({ status: 'computed', node_id: 'commitments', rests_on_olumi_estimates: false });
  });

  it('Codex r1 on #3660: figures PLoT converted itself (a setting outside [0, 1]) are taken as returned, never × the cap twice', async () => {
    const g = stored(angels());
    const run = async () => engineAnswer({ current: [0.25, 0.5, 0.75], warm: [0.5, 0.75, 1], direct: [0.375, 0.625, 0.875] });
    const read = (options: unknown[]) => readImpliedQuantity({ graph: g, goalId: 'funding', frames: livingFramesOf(g)!, optionIds: OPTIONS,
      dispatched: { graph: {}, options }, seed: 's', run });
    for (const value of [1.2, -0.4]) {
      expect(plotConvertsOutcomes([{ id: 'warm', interventions: { intros: { value } } }])).toBe(true);
      expect(await read([{ id: 'warm', interventions: { intros: { value } } }])).toMatchObject({ by_option: { warm: { p10: 0.5, p50: 0.75, p90: 1 } } });
    }
    const cap = livingFramesOf(g)!.get('commitments')!.cap;
    expect(cap, 'precondition: the two rules differ').not.toBe(1);
    expect(await read([{ id: 'warm', interventions: { intros: { value: 0.75 } } }])).toMatchObject({ by_option: { warm: { p50: 0.75 * cap } } });
  });

  it('Codex r1 on #3660: one option missing from the engine\'s answer: nothing is said for any option, with the reason', async () => {
    const g = stored(angels());
    const implied = await readImpliedQuantity({ graph: g, goalId: 'funding', frames: livingFramesOf(g)!, optionIds: OPTIONS,
      dispatched: { graph: {}, options: [] }, seed: 's', run: async () => engineAnswer({ current: [0.25, 0.5, 0.75], warm: [0.5, 0.75, 1] }) });
    expect(implied).toEqual({ version: 1, status: 'withheld', reason: 'engine_read_incomplete' });
  });

  it('Codex r1 on #3660: the quantity\'s OWN inputs: an estimate the person accepted is still Olumi\'s; one past the quantity is not its input', async () => {
    const run = async () => engineAnswer({ current: [0.25, 0.5, 0.75], warm: [0.5, 0.75, 1], direct: [0.375, 0.625, 0.875] });
    const read = (g: Json) => readImpliedQuantity({ graph: g, goalId: 'funding', frames: livingFramesOf(g)!, optionIds: OPTIONS, dispatched: { graph: {}, options: [] }, seed: 's', run });
    const accepted = stored(angels({ olumiIntro: true }));
    const edge = (accepted.edges as Json[]).find((e) => e.from === 'intros' && e.to === 'commitments')!;
    edge.provenance = { ...edge.provenance, reviewed_by_user: { intent: 'confirm' } };
    const before = goalChanceEstimateCounts(accepted, OPTIONS, 'funding', ['commitments'], { scoredInEvent: false });
    expect([before.links, before.acceptedLinks], 'precondition: accepted, not counted as an estimate').toEqual([0, 1]);
    expect(await read(accepted)).toMatchObject({ status: 'computed', rests_on_olumi_estimates: true });
    const past = stored(angels());
    const toAim = (past.edges as Json[]).find((e) => e.from === 'commitments' && e.to === 'funding')!;
    toAim.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    expect(goalChanceEstimateCounts(past, OPTIONS, 'funding').links, 'precondition: the aim\'s own census sees it').toBeGreaterThan(0);
    expect(await read(past)).toMatchObject({ status: 'computed', rests_on_olumi_estimates: false });
  });

  it('a failed engine read is said, never thrown, and stores no figure', async () => {
    const g = stored(angels());
    const implied = await readImpliedQuantity({ graph: g, goalId: 'funding', frames: livingFramesOf(g)!, optionIds: OPTIONS,
      dispatched: { graph: {}, options: [] }, seed: undefined, run: async () => { throw new Error('PLoT 503'); } });
    expect(implied).toEqual({ version: 1, status: 'withheld', reason: 'engine_read_failed' });
  });
});

/**
 * The real Run handler on the stored graph, PLoT stubbed per target node. The Run sends each setting raw (warm: 6
 * introductions), so PLoT converts the target's figures back itself: the stub answers the quantity in angels.
 */
async function runOn(model: LivingModelT) {
  const graph = stored(model);
  const plotRun = vi.fn(async (payload: Json) => clone(payload.goal_node_id === 'commitments'
    ? engineAnswer({ current: [0.6, 1, 1.4], warm: [1.1, 1.6, 2.15], direct: [0.8, 1.25, 1.7] }, 'never-read')
    : engineAnswer({ current: [0.2, 0.3, 0.4], warm: [0.3, 0.4, 0.5], direct: [0.25, 0.35, 0.45] })) as unknown as V2RunResponseEnvelope);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-iq-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: null })),
    loadGraph: vi.fn(async () => clone(graph)) } as never);
  const handler = createRunAnalysisHandler({
    plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) } as never);
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-iq', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-iq', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-iq', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  const fact = outcome.handler_facts[0] as Json;
  return { graph, plotRun, fact, enrichment: fact.result.enrichment as Json };
}

describe('the Run: bound to the SAME Run, stored with it, never a second Run', () => {
  it('80a77832 shape: one extra engine read on the Run\'s own draws; the Run stores what it implies for angels', async () => {
    const { graph, plotRun, fact, enrichment } = await runOn(angels());
    expect(plotRun).toHaveBeenCalledTimes(2);
    const [main, implied] = plotRun.mock.calls.map((c) => c[0] as Json);
    expect(main!.goal_node_id).toBe('funding');
    expect(implied).toMatchObject({ goal_node_id: 'commitments', graph: main!.graph, options: main!.options, seed: main!.seed ?? 'seed-80a7' });
    expect(implied).not.toHaveProperty('goal_constraints');
    expect(plotConvertsOutcomes(main!.options), 'precondition: the Run sends raw settings, so PLoT converts').toBe(true);
    expect(readStoredImpliedQuantity(enrichment)).toMatchObject({ status: 'computed', node_id: 'commitments', unit: 'angels',
      quantity: 'Angels completing investment within three weeks', by_option: { current: { p10: 0.6, p50: 1, p90: 1.4 },
        warm: { p10: 1.1, p50: 1.6, p90: 2.15 }, direct: { p10: 0.8, p50: 1.25, p90: 1.7 } } });
    // One Run record: the same fact carries it, beside the Run's own id.
    expect(fact.fact_type).toBe('run_analysis');
    expect(typeof fact.result.run_id).toBe('string');
    // The AI's Run facts name the quantity, in its unit, model-relative: never a chance, a target or a ranking.
    const facts = runFactsOf({ enrichment: {} }, graph, true, { impliedQuantity: enrichment[IMPLIED_QUANTITY_KEY] });
    // The aim's own deadline, saved with no window (by_when 'within 3 weeks', period_months null), is the declared time scope.
    expect(facts.implied_by_deadline).toMatchObject({ label: 'What the model implies for Angels completing investment within three weeks within 3 weeks, as the model stands',
      quantity: 'Angels completing investment within three weeks', unit: 'angels', ask: 'goal_target',
      by_option: { warm: { p10: 1.1, p50: 1.6, p90: 2.15 } } });
    expect(JSON.stringify(facts.implied_by_deadline)).not.toMatch(/chance|target figure|best|winner|recommend|lead/i);
    expect(runFactsOf({ enrichment: {} }, graph, false, { impliedQuantity: enrichment[IMPLIED_QUANTITY_KEY] }).implied_by_deadline,
      'a Run that is not current says nothing').toBeUndefined();
  });

  it('options sharing no sized quantity: the Run stores why, with no extra engine read', async () => {
    const { plotRun, enrichment } = await runOn(angels({ splitPaths: true }));
    expect(plotRun).toHaveBeenCalledTimes(1);
    expect(readStoredImpliedQuantity(enrichment)).toEqual({ version: 1, status: 'withheld', reason: 'no_sized_quantity_on_every_path' });
    // No range is made up: the facts keep the reason and name the one decisive missing input.
    expect(runFactsOf({ enrichment: {} }, {}, true, { impliedQuantity: enrichment[IMPLIED_QUANTITY_KEY] }).implied_by_deadline)
      .toEqual({ withheld: 'no_sized_quantity_on_every_path', ask: 'goal_target' });
  });

  it('CONTRAST: an aim WITH a target figure gives no extra engine read and stores nothing new', async () => {
    const { plotRun, enrichment } = await runOn(angels({ target: true }));
    expect(plotRun).toHaveBeenCalledTimes(1);
    expect(enrichment).not.toHaveProperty(IMPLIED_QUANTITY_KEY);
  });

  it('Codex r1 on #3660: a stated "= £250,000" target is a target, even where the engine graph projects none', async () => {
    const { graph, plotRun, enrichment } = await runOn(angels({ equalTarget: true }));
    expect(goalChanceTargetCause(graph, 'funding'), 'precondition: the projection holds no target').toBe('no_stated_target');
    expect(plotRun).toHaveBeenCalledTimes(1);
    expect(enrichment).not.toHaveProperty(IMPLIED_QUANTITY_KEY);
  });
});
