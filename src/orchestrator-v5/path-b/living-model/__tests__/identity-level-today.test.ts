/**
 * DL 23 Oct (Lenses' pre-flight on served UI 60ee5601 / CEE 7b0af1a9, synthetic café brief): after approve + Run every option
 * was withheld twice: Olumi's reading of the goal as a product was unconfirmed (`stated_in_brief: false`), and "today's level
 * is not recorded" (no `target.current`, so no goal level today: PLoT's `missing_goal_baseline`). Confirming the reading
 * still left the second: nothing worked out today's level, although it follows exactly from the person's own definition and
 * figures. Now the mapper works it out (a level target only), from their definition and their own point figures, never from
 * Olumi's, unstamped and said beside the result. Synthetic figures: 280 loaves a day at £3 a loaf is £840 a day; target £1,000.
 */
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';

type Rec = Record<string, any>;
const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const OLUMI = { source: 'olumi' as const, party: null, quote: null };
const level = (id: string, label: string, value: number, unit: string, quote: string, over: Rec = {}) =>
  ({ id, label, kind: 'factor' as const, estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(quote), ...over });

/** The bakery: today's takings not given; takings defined as loaves × price, by `definedBy`. */
const bakery = (definedBy: Rec, over: { target?: Rec; loaves?: Rec; price?: Rec } = {}): LivingModelT => ({
  aims: [{ id: 'takings', text: 'Daily takings of at least £1,000', status: 'current', defined_as: { op: 'product', of: ['loaves', 'price'], ...definedBy } as never,
    ...who('we want daily takings of at least £1,000'),
    target: { quantity: 'daily takings', comparator: '>=', value: 1000, low: null, high: null, unit: '£ per day', by_when: null, period_months: null,
      baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null, ...over.target } }],
  options: [
    { status: 'feasible', id: 'hold', label: 'Carry on', settings: [], developed_from: null, ...who('or we carry on') },
    { status: 'feasible', id: 'oven', label: 'A second oven', developed_from: null, ...who('a second oven would sell 360 a day'),
      settings: [{ factor_id: 'loaves', estimate_by: null, value: 360, low: null, high: null, unit: 'loaves a day', ...who('a second oven would sell 360 a day') }] },
  ],
  factors: [level('loaves', 'Loaves sold', 280, 'loaves a day', 'we sell 280 loaves a day', over.loaves),
    level('price', 'Price per loaf', 3, '£ per loaf', 'at £3 a loaf', over.price)],
  links: [], risks: [], conditions: [], views: [], history: [],
});
const THEIRS = who('takings are loaves sold times the price');
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const goalOf = (m: LivingModelT): Rec => (mapLivingModel(m).graph.nodes as Rec[]).find((n) => n.id === 'takings')!;
const SAID = 'Today’s daily takings is worked out from your figures: Loaves sold 280 loaves a day × Price per loaf £3 per loaf = £840 per day.';

async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `ilt-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `ilt-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `ilt-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  return request!;
}

describe('a confirmed definition gives the goal its level today, worked out from the person\'s own figures', () => {
  it('BEFORE (the pre-flight): Olumi\'s reading, no level today: the goal is held and has no level, the reading unconfirmed', () => {
    const m = bakery(OLUMI);
    expect(reasons(m)).toContain('takings:goal_level_unknown');
    expect(goalOf(m).observed_state).toBeUndefined();
    expect(goalOf(m).nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
  });

  it('confirmed by the person: today\'s level is 280 × £3 = £840, unstamped, said beside the result, and the definition is theirs', () => {
    const m = bakery(THEIRS);
    expect(reasons(m)).not.toContain('takings:goal_level_unknown');
    const goal = goalOf(m);
    expect(goal.observed_state).toMatchObject({ raw_value: 840, unit: '£ per day' });
    expect(goal.observed_state.source).toBeUndefined();
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['loaves', 'price'], stated_in_brief: true });
    expect(mapLivingModel(m).assumed).toContainEqual({ id: 'takings', text: SAID });
  });

  it('real path: the Run\'s PLoT request carries the confirmed identity and today\'s £840 on the goal', async () => {
    const goal = (await requestTheRunSends('confirmed', bakery(THEIRS))).graph.nodes.find((n: Rec) => n.id === 'takings');
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect(goal.observed_state).toMatchObject({ raw_value: 840 });
    expect(goal.goal_threshold_raw).toBe(1000);
  });

  it('the confirmation route: the person\'s "yes" makes the definition theirs through the kernel, and the level follows', () => {
    const saved = bakery(OLUMI);
    const proposed = bakery(who('Yes'));
    const { model } = applyKernel(proposed, ['Yes, that’s right'], saved);
    expect(model.aims[0]!.defined_as!.source).toBe('user');
    expect(goalOf(model).observed_state).toMatchObject({ raw_value: 840 });
  });

  it.each([
    ['Olumi\'s reading', OLUMI, {}],
    ['an unverified definition', { source: 'unverified', party: null, quote: null }, {}],
    ['a part Olumi estimated', THEIRS, { loaves: { estimate_by: 'olumi' } }],
    ['a part that is Olumi\'s', THEIRS, { price: { source: 'olumi', quote: null } }],
    ['a part with a range', THEIRS, { loaves: { low: 250, high: 310 } }],
    ['a part whose source is not confirmed', THEIRS, { price: { source: 'unverified', quote: null } }],
    ['a change target', THEIRS, { target: { comparator: 'increase', value: 20, unit: '%', change_kind: 'relative' } }],
  ] as const)('NEGATIVE: %s: no level is worked out', (_name, definedBy, over) => {
    const m = bakery(definedBy as Rec, over as never);
    expect(goalOf(m).observed_state?.raw_value).not.toBe(840);
    expect(mapLivingModel(m).assumed.some((a) => a.text.includes('worked out from your figures'))).toBe(false);
  });

  it('NEGATIVE: a level the person gave is never replaced, and one that disagrees with the definition is still refused', () => {
    expect(goalOf(bakery(THEIRS, { target: { current: 840 } })).observed_state).toMatchObject({ raw_value: 840 });
    expect(mapLivingModel(bakery(THEIRS, { target: { current: 840 } })).assumed.some((a) => a.text.includes('worked out'))).toBe(false);
    expect(reasons(bakery(THEIRS, { target: { current: 900 } }))).toContain('takings:identity_inconsistent');
  });

  it('Codex r1: worked out exactly as decimals, so 3 × £2.30 = £6.90 takes the same path as a stated £6.90', () => {
    const decimal = (current: number | null): LivingModelT => {
      const m = bakery(THEIRS, { target: { value: 6.9, current }, loaves: { value: 3 }, price: { value: 2.3 } });
      // Codex's input: words with no "stay" cue, so a level already at the target is asked about, not read silently.
      m.aims[0] = { ...m.aims[0]!, quote: 'Reach £6.90 daily takings' };
      return m;
    };
    expect(reasons(decimal(null))).toContain('takings:stay_within_unconfirmed');
    expect(reasons(decimal(6.9))).toContain('takings:stay_within_unconfirmed');
  });

  it('Codex r1: the sentence says each figure exactly as written, never rounded to £0', () => {
    const m = bakery(THEIRS, { target: { value: 20 }, loaves: { value: 1000000 }, price: { value: 0.00001 } });
    expect(goalOf(m).observed_state).toMatchObject({ raw_value: 10 });
    expect(mapLivingModel(m).assumed).toContainEqual({ id: 'takings',
      text: 'Today\u2019s daily takings is worked out from your figures: Loaves sold 1,000,000 loaves a day × Price per loaf £0.00001 per loaf = £10 per day.' });
  });

  it('a sum: today\'s level is the parts added', () => {
    const m: LivingModelT = { ...bakery(THEIRS), factors: [
      level('loaves', 'Morning takings', 400, '£ per day', 'mornings bring in £400'), level('price', 'Afternoon takings', 440, '£ per day', 'afternoons £440')] };
    m.aims[0]!.defined_as = { ...m.aims[0]!.defined_as!, op: 'sum' };
    expect(goalOf(m).observed_state).toMatchObject({ raw_value: 840 });
  });

  it('a ceiling target: today\'s worked-out level above it is its level today', () => {
    const m = bakery(THEIRS, { target: { comparator: '<=', value: 800 } });
    expect(goalOf(m).observed_state).toMatchObject({ raw_value: 840 });
  });

  it('NEGATIVE: a part that is itself defined: no level is worked out (the identity\'s own cycle check decides)', () => {
    const m = bakery(THEIRS);
    m.factors[1] = { ...m.factors[1]!, defined_as: { op: 'product', of: ['loaves', 'takings'], ...THEIRS } } as never;
    expect(mapLivingModel(m).assumed.some((a) => a.text.includes('worked out from your figures'))).toBe(false);
  });

  it('NEGATIVE: units that do not compose: the identity is held as today and no level is worked out', () => {
    const m = bakery(THEIRS, { price: { unit: 'minutes' } });
    expect(reasons(m)).toContain('takings:identity_unit_mismatch');
    expect(goalOf(m).observed_state).toBeUndefined();
  });
});
