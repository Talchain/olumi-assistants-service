/**
 * DL 22 Oct (served board 6ce4f6ae, cee 1d8f3c85): "revenue is loaves sold times the price per loaf" was refused as
 * `identity_unit_mismatch`, so its parts lost their edges and the Run refused ORPHAN_NODE / NO_PATH_TO_GOAL. Money per X
 * times a count of X per period is money per period ("£ per loaf" × "loaves a week" = "£ per week"); "loaves" is "loaf".
 * Synthetic figures: 900 loaves a week at £3 a loaf is £2,700 a week; opening on Sundays sells 1,020, so £3,060 ≥ £2,900.
 */
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { singular } from '../../../agent-lane/same-unit.js';
import { mapLivingModel } from '../mapper.js';
import { F1_DEFINED, F1_UNIT_MISMATCH } from './track2-f1-identity.fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const level = (id: string, label: string, value: number, unit: string, quote: string) =>
  ({ id, label, kind: 'factor' as const, estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(quote) });

const bakery = (loavesUnit: string, priceUnit: string, aimUnit = '£ per week'): LivingModelT => ({
  aims: [{ id: 'takings', text: 'Weekly takings of at least £2,900', status: 'current', ...who('we need at least £2,900 a week; today it is £2,700'),
    target: { quantity: 'weekly takings', comparator: '>=', value: 2900, low: null, high: null, unit: aimUnit, by_when: null, period_months: null,
      baseline: 'today', current: 2700, current_source: null, current_unit: null, change_kind: null, source: null },
    defined_as: { op: 'product', of: ['loaves', 'price'], ...who('takings are loaves sold times the price per loaf') } }],
  options: [
    { status: 'feasible', id: 'hold', label: 'Carry on', settings: [], developed_from: null, ...who('or we carry on') },
    { status: 'feasible', id: 'sundays', label: 'Open on Sundays', developed_from: null, ...who('opening Sundays would sell 1,020 a week'),
      settings: [{ factor_id: 'loaves', estimate_by: null, value: 1020, low: null, high: null, unit: loavesUnit, ...who('opening Sundays would sell 1,020 a week') }] },
  ],
  factors: [level('loaves', 'Loaves sold', 900, loavesUnit, 'we sell 900 loaves a week'), level('price', 'Price per loaf', 3, priceUnit, 'at £3 a loaf')],
  links: [], risks: [], conditions: [], views: [], history: [],
});

const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

/** The real Run's PLoT request (as `track2-f1-identity.test.ts`), or the refusal it throws. */
async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `rpc-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `rpc-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `rpc-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  return request!;
}
const node = (r: Rec, id: string) => (r.graph.nodes as Rec[]).find((n) => n.id === id)!;

describe('a product of money per X and a count of X per period is money per period', () => {
  it('"£ per loaf" × "loaves a week" = "£ per week": the definition reaches the engine and the Run keeps the £2,900 threshold', async () => {
    const model = bakery('loaves a week', '£ per loaf');
    expect(reasons(model)).toEqual([]);
    const r = await requestTheRunSends('fine', model);
    expect(node(r, r.goal_node_id).goal_threshold_raw).toBe(2900);
    expect(node(r, 'takings').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['loaves', 'price'], stated_in_brief: true });
    for (const from of ['loaves', 'price']) expect((r.graph.edges as Rec[]).filter((e) => e.from === from && e.to === 'takings'), from).toHaveLength(1);
  });

  it('the same with "loaves per week", and with the period on the price instead ("£ per loaf per week" × "loaves")', () => {
    expect(reasons(bakery('loaves per week', '£ per loaf'))).toEqual([]);
    expect(reasons(bakery('loaves', '£ per loaf per week'))).toEqual([]);
  });

  it('the period may be an adverb on either part or on the whole ("loaves weekly"; "£ weekly")', () => {
    expect(reasons(bakery('loaves weekly', '£ per loaf'))).toEqual([]);
    expect(reasons(bakery('loaves a week', '£ per loaf', '£ weekly'))).toEqual([]);
  });

  it('NEGATIVE: two periods ("£ per loaf per week" × "loaves a week") are money per week², refused by name', () => {
    expect(reasons(bakery('loaves a week', '£ per loaf per week'))).toEqual(['takings:identity_unit_mismatch', 'takings:chance_rests_on_withheld']);
  });

  it('NEGATIVE: a period that is not the defined quantity\'s own (a weekly count for "£ per month") is refused', () => {
    expect(reasons(bakery('loaves a week', '£ per loaf', '£ per month'))).toEqual(['takings:identity_unit_mismatch', 'takings:chance_rests_on_withheld']);
  });

  it('NEGATIVE: a denominator that is not the count\'s noun ("£ per customer" × "loaves a week") is refused', () => {
    expect(reasons(bakery('loaves a week', '£ per customer'))).toEqual(['takings:identity_unit_mismatch', 'takings:chance_rests_on_withheld']);
  });

  it('NEGATIVE (Codex r1): the count\'s own denominator, a repeated period and a scale word are each refused, never read as £ per week', () => {
    for (const [loaves, price] of [['loaves per customer per week', '£ per loaf'], ['loaves/week/week', '£ per loaf'], ['loaves', '£/loaf/week/week'],
      ['thousand loaves a week', '£ per loaf'], ['loaves a week', '£k per loaf'], ['loaves a week', '£ per loaf each'],
      // Codex r2: a count with its own denominator, and a duration read as a period.
      ['users per account per week', '£ per user account'], ['person-weeks', '£ per person']] as const) {
      expect(reasons(bakery(loaves, price)), `${price} × ${loaves}`).toEqual(['takings:identity_unit_mismatch', 'takings:chance_rests_on_withheld']);
    }
  });

  it('CONTROL: the existing forms are unchanged (F1 accepted; £ per ORDER × customers still refused)', () => {
    expect(reasons(F1_DEFINED)).toEqual([]);
    expect(reasons(F1_UNIT_MISMATCH)).toEqual(['rev:identity_unit_mismatch', 'rev:chance_rests_on_withheld']);
  });

  it('singular: an irregular "-ves" plural is its singular; a regular one is unchanged', () => {
    expect(['loaves', 'shelves', 'knives', 'incentives', 'subscribers', 'gloves'].map(singular))
      .toEqual(['loaf', 'shelf', 'knife', 'incentive', 'subscriber', 'glove']);
  });
});
