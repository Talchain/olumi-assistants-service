/**
 * TRACK 2 (21 Oct 2026, DL after Codex r4 on #3522): the core living model's missing vocabulary, each mapped onto the legacy
 * GraphV3 representation the Run and the canvas already read. No new engine semantics.
 * - A LIMIT beside the aim ("we cannot spend more than £10,000 a month"): the legacy limit row (`goal_constraints`, as
 *   `add_constraint` writes it), read by PLoT on the factor's own frame (`observed_state.cap`).
 * - An option's STATUS ("outsourcing is not possible, keep it on the board"): `option_status` + `analysis_participation`,
 *   which the Run's option gate leaves out of the comparison (`user-option-status-filter.ts`).
 * - An OUTCOME the factors lead to: node kind `outcome` on the goal's path.
 * Every row goes through the real mapper, the stored projection and the Run handler, up to the request PLoT receives.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { mapLivingModel } from '../mapper.js';

type Rec = Record<string, any>;
const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const LIMIT_WORDS = 'we cannot spend more than £10,000 a month';

/**
 * Synthetic: couriers lead to on-time deliveries, which lead to profit; each courier also costs £1,500 a month, under a
 * £10,000 limit. Hire takes couriers to 5; outsourcing (couriers to 6) carries the status given.
 */
const deliveries = (onTime: 'factor' | 'outcome', outsource: 'feasible' | 'infeasible' = 'feasible'): LivingModelT => ({
  aims: [{ id: 'profit', text: 'Monthly profit of at least £2,000', status: 'current', defined_as: null, ...who('at least £2,000 a month; today £1,500'),
    target: { quantity: 'monthly profit', comparator: '>=', value: 2000, low: null, high: null, unit: '£', by_when: null, period_months: null, baseline: 'today',
      current: 1500, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [
    { id: 'carry_on', label: 'Carry on', settings: [], status: 'feasible', developed_from: null, ...who('or we carry on') },
    { id: 'hire', label: 'Hire two couriers', status: 'feasible', developed_from: null, ...who('hire two couriers'),
      settings: [{ estimate_by: null, factor_id: 'couriers', value: 5, low: null, high: null, unit: 'couriers', ...who('hire two couriers') }] },
    { id: 'outsource', label: 'Outsource', status: outsource, developed_from: null, ...who('outsource it'),
      settings: [{ estimate_by: null, factor_id: 'couriers', value: 6, low: null, high: null, unit: 'couriers', ...who('outsource it') }] },
  ],
  factors: [
    { estimate_by: null, id: 'couriers', label: 'Couriers', kind: 'factor', value: 3, low: null, high: null, unit: 'couriers', defined_as: null, limit: null, ...who('we have 3 couriers') },
    { estimate_by: null, id: 'on_time', label: 'On-time deliveries', kind: onTime, value: 80, low: null, high: null, unit: '%', defined_as: null, limit: null, ...who('80% arrive on time') },
    { estimate_by: null, id: 'monthly_cost', label: 'Monthly cost', kind: 'factor', value: 9000, low: null, high: null, unit: '£', defined_as: null,
      limit: { comparator: '<=', value: 10000, ...who(LIMIT_WORDS) }, ...who('costs are £9,000 a month') },
  ],
  links: [
    { id: 'couriers_on_time', from: 'couriers', to: 'on_time', ...who('each courier adds about 5 points'), effect: { estimate_by: null, form: 'point', value: 5, sd: null, low: null, high: null, unit: '%', sign: '+' } },
    { id: 'on_time_profit', from: 'on_time', to: 'profit', ...who('each point is worth about £50'), effect: { estimate_by: null, form: 'point', value: 50, sd: null, low: null, high: null, unit: '£', sign: '+' } },
    { id: 'couriers_cost', from: 'couriers', to: 'monthly_cost', ...who('each courier costs £1,500'), effect: { estimate_by: null, form: 'point', value: 1500, sd: null, low: null, high: null, unit: '£', sign: '+' } },
    { id: 'cost_profit', from: 'monthly_cost', to: 'profit', ...who('every pound of cost comes off profit'), effect: { estimate_by: null, form: 'point', value: 1, sd: null, low: null, high: null, unit: '£', sign: '-' } },
  ],
  risks: [], conditions: [], views: [], history: [],
});

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;
const node = (g: Rec, id: string): Rec | undefined => (g.nodes as Rec[]).find((n) => n.id === id);

async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `t2v-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `t2v-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `t2v-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  const out = process.env.F1_OUT;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${name}.cee-to-plot.json`), JSON.stringify(request, null, 2)); }
  return request!;
}

describe('Track 2: a limit beside the aim is the legacy limit row', () => {
  it('"cannot spend more than £10,000" reaches PLoT as the limit row on monthly cost, inside the frame PLoT reads it on', async () => {
    const request = await requestTheRunSends('limit', deliveries('factor'));
    expect(request.goal_constraints).toEqual([{ constraint_id: 'limit_monthly_cost', node_id: 'monthly_cost', operator: '<=', value: 10000, unit: '£',
      label: 'Monthly cost', provenance: 'explicit', source_quote: LIMIT_WORDS, value_frame: 'level' }]);
    const cap = node(request.graph, 'monthly_cost')!.observed_state.cap;
    expect(cap).toBeGreaterThanOrEqual(10000);
    // A limit is beside the aim, never the aim: the goal's own threshold is unchanged.
    expect(node(request.graph, 'profit')).toMatchObject({ goal_threshold_raw: 2000, goal_threshold_unit: '£' });
  });

  // Codex r1: widening the factor's frame to fit a limit rescales its links (PLoT then clamps them), so the frame never moves.
  it('a limit never moves the factor\'s frame: the graph is the one without it, plus the row', () => {
    const m = deliveries('factor');
    const without: LivingModelT = { ...m, factors: m.factors.map((f) => ({ ...f, limit: null })) };
    const { goal_constraints, ...rest } = mapLivingModel(m).graph as Rec;
    expect(goal_constraints).toHaveLength(1);
    expect(rest).toEqual(mapLivingModel(without).graph);
  });

  it('NEGATIVE: a limit with no known level, or off the factor\'s frame, is held with its reason, never sent unscaled or clamped', () => {
    for (const patch of [{ value: null }, { limit: { comparator: '<=' as const, value: 20000, ...who(LIMIT_WORDS) } }]) {
      const m = deliveries('factor');
      m.factors[2] = { ...m.factors[2]!, ...patch };
      const mapped = mapLivingModel(m);
      expect(mapped.graph, JSON.stringify(patch)).not.toHaveProperty('goal_constraints');
      expect(mapped.withheld.map((w) => `${w.id}:${w.reason}`)).toContain('monthly_cost:limit_not_in_slice');
    }
  });
});

describe('Track 2: an option the person rules out stays on the board and is not compared', () => {
  it('"outsourcing is not possible" keeps the option and its words on reopen, and the Run leaves it out', async () => {
    const graph = stored(deliveries('factor', 'infeasible'));
    expect(node(graph, 'outsource')).toMatchObject({ kind: 'option', label: 'Outsource', option_status: 'infeasible', analysis_participation: 'retained_excluded' });
    const request = await requestTheRunSends('status', deliveries('factor', 'infeasible'));
    expect((request.options as Rec[]).map((o) => o.option_id ?? o.id).sort()).toEqual(['carry_on', 'hire']);
    expect(node(request.graph, 'outsource')).toBeUndefined();
  });

  it('CONTROL: a feasible option carries no status and is compared, exactly as before', async () => {
    expect(node(stored(deliveries('factor')), 'outsource')).not.toHaveProperty('option_status');
    const request = await requestTheRunSends('feasible', deliveries('factor'));
    expect((request.options as Rec[]).map((o) => o.option_id ?? o.id).sort()).toEqual(['carry_on', 'hire', 'outsource']);
  });
});

describe('Track 2: the model has outcomes', () => {
  it('an outcome on the goal path reaches the Run as an outcome node, and the request is otherwise the factor one', async () => {
    const asOutcome = await requestTheRunSends('outcome', deliveries('outcome'));
    const asFactor = await requestTheRunSends('factor', deliveries('factor'));
    expect(node(asOutcome.graph, 'on_time')!.kind).toBe('outcome');
    expect(node(asOutcome.graph, 'on_time')).not.toHaveProperty('category');
    expect(node(asFactor.graph, 'on_time')).toMatchObject({ kind: 'factor', category: 'observable' });
    const same = structuredClone(asOutcome);
    same.graph.nodes = (same.graph.nodes as Rec[]).map((n) => (n.id === 'on_time' ? node(asFactor.graph, 'on_time') : n));
    expect(same).toEqual({ ...asFactor, request_id: asOutcome.request_id });
  });

  // DL ruling: a label never moves a number. On a goal whose level today is no one's, ISL does not anchor, and an outcome's
  // missing base uncertainty would move the mean (Codex r3, offline 0.70 → 0.30), so it is sent as a factor.
  it('on a goal with no one\'s level today, an outcome is sent exactly as the factor would be, and keeps its label in the model', async () => {
    const unanchored = (kind: 'factor' | 'outcome'): LivingModelT => {
      const m = deliveries(kind);
      return { ...m, aims: [{ ...m.aims[0]!, source: 'unverified' }] };
    };
    expect(node(mapLivingModel(unanchored('outcome')).graph, 'profit')!.observed_state).not.toHaveProperty('source');
    expect(mapLivingModel(unanchored('outcome')).graph).toEqual(mapLivingModel(unanchored('factor')).graph);
    const asOutcome = await requestTheRunSends('unanchored-outcome', unanchored('outcome'));
    expect(asOutcome).toEqual({ ...(await requestTheRunSends('unanchored-factor', unanchored('factor'))), request_id: asOutcome.request_id });
    expect(stored(unanchored('outcome')).living_model.factors.find((f: Rec) => f.id === 'on_time').kind).toBe('outcome');
  });

  it('NEGATIVE: an "outcome" an option sets, one with a limit sent, one nothing leads into, and one off the goal path stay factors', () => {
    const set = deliveries('factor');
    set.factors[0] = { ...set.factors[0]!, kind: 'outcome' };
    expect(node(mapLivingModel(set).graph, 'couriers')).toMatchObject({ kind: 'factor', category: 'controllable' });
    const off = deliveries('outcome');
    off.links = off.links.filter((l) => l.id !== 'on_time_profit');
    expect(node(mapLivingModel(off).graph, 'on_time')!.kind).toBe('factor');
    // PLoT drops a time limit on an outcome node, so a limited quantity stays a factor and its limit is scored.
    const limited = deliveries('outcome');
    limited.factors[1] = { ...limited.factors[1]!, limit: { comparator: '>=', value: 70, ...who('on-time must stay at 70% or more') } };
    expect(node(mapLivingModel(limited).graph, 'on_time')!.kind).toBe('factor');
    expect((mapLivingModel(limited).graph as Rec).goal_constraints.map((c: Rec) => c.node_id)).toContain('on_time');
    // Codex r2: a limit that is held (here, off the 100% frame) sends nothing, so it changes nothing: still an outcome.
    const held = deliveries('outcome');
    held.factors[1] = { ...held.factors[1]!, limit: { comparator: '>=', value: 200, ...who('at least 200% on time') } };
    expect(node(mapLivingModel(held).graph, 'on_time')!.kind).toBe('outcome');
    // ISL draws a root's level and never an outcome's, so an "outcome" nothing leads into stays a factor.
    const root = deliveries('outcome');
    root.links = root.links.filter((l) => l.id !== 'couriers_on_time');
    expect(node(mapLivingModel(root).graph, 'on_time')!.kind).toBe('factor');
  });
});

describe('Track 2: a model saved before reads as it did', () => {
  it('no kind, limit or status reads factor, none and feasible', () => {
    const before = JSON.parse(JSON.stringify(deliveries('factor')));
    for (const f of before.factors) { delete f.kind; delete f.limit; }
    for (const o of before.options) delete o.status;
    const read = LivingModel.parse(before);
    expect(read.factors.map((f) => [f.kind, f.limit])).toEqual([['factor', null], ['factor', null], ['factor', null]]);
    expect(read.options.map((o) => o.status)).toEqual(['feasible', 'feasible', 'feasible']);
  });
});
