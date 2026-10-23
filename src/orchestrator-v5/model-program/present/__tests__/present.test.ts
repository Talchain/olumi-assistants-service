/**
 * present.ts rows. Every expected sentence and display is written out BY HAND from the model's own figures (deterministic
 * models, so each chance is exactly 0 or 1 and its display is the screen's edge words), never produced by calling the code
 * under test. Stochastic rows assert the labels and the invariance, not a sampled number.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Goal, Limit, Option, Quantity, Reading } from '../../executable.js';
import { simulate } from '../../simulate/simulate.js';
import { presentAnalysisView, type PresentInput, type PresentQuantity } from '../present.js';

type Rec = Record<string, any>;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const fixed = (id: string, value: number, unit = '', reading: Reading = 'state'): Quantity => ({ id, unit, reading, dist: { kind: 'fixed', value } });
const range = (id: string, low: number, high: number, mode: number | undefined, unit: string, basis: 'person_range' | 'olumi_estimate'): Quantity =>
  ({ id, unit, reading: 'state', dist: { kind: 'range', low, high, ...(mode !== undefined ? { mode } : {}), basis } });
const def = (id: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], unit = ''): Quantity =>
  ({ id, unit, reading: 'state', equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: { coefficient: string; driver: string }[], unit = ''): Quantity =>
  ({ id, unit, reading: 'state', equation: { form: 'effect', base, terms } });
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string): Goal => ({ id, quantity, cmp, target, aggregation: 'end', window: ONE });
const option = (id: string, label: string, sets: Option['sets'] = []): Option => ({ id, label, sets });
const model = (quantities: Quantity[], goals: Goal[], options: Option[], limits: Limit[] = []): ExecutableModel =>
  ({ periods: 1, period_unit: 'month', quantities, goals, limits, options, risks: [] });
const person = (label: string, relation = false): PresentQuantity => ({ label, author: 'person', ...(relation ? { relation_author: 'person' as const } : {}) });
const cell = (v: Rec, id: string): Rec => v.options.find((o: Rec) => o.option_id === id).cell;

// ── The MRR model: MRR = price × customers; raising the price to £59 loses 1.8 customers per £1 (row 3 of the numerical check).
const MRR_QUANTITIES = (perPound: Quantity, newPrice: Quantity = fixed('price_59', 59, '£')): Quantity[] => [
  fixed('price', 49, '£'), newPrice, fixed('price_ref', 49, '£'), def('price_change', 'difference', ['price', 'price_ref'], '£'),
  fixed('customers_today', 100, 'customers'), perPound,
  effect('customers', 'customers_today', [{ coefficient: 'per_pound', driver: 'price_change' }], 'customers'),
  def('mrr', 'product', ['price', 'customers'], '£'), fixed('t_mrr', 4800, '£'), fixed('t_cust', 90, 'customers')];
const MRR_LABELS: Record<string, PresentQuantity> = {
  price: person('Price'), price_59: person('New price'), price_ref: person('Price today'), price_change: person('Price rise', true),
  customers_today: person('Customers today'), per_pound: person('Customers lost per £1 of price rise'),
  customers: person('Customers', true), mrr: person('Monthly recurring revenue', true), t_mrr: person('MRR target'), t_cust: person('Customer target'),
};
const MRR_OPTIONS = [option('hold', 'Hold'), option('raise', 'Raise to £59', [{ quantity: 'price', to: 'price_59', from_period: 0 }])];
const MRR_GOALS = [goal('g_mrr', 'mrr', '>=', 't_mrr'), goal('g_cust', 'customers', '>=', 't_cust')];
function present(m: ExecutableModel, labels: Record<string, PresentQuantity>, more: Partial<PresentInput> = {}, draws = 200) {
  return presentAnalysisView({ model: m, result: simulate(m, { seed: 20261023, draws }), quantities: labels, ...more }) as unknown as Rec;
}

// Hand-written words (the level template of goal-target-basis.ts `targetChanceWords`, the end of month 1 for a state):
const MRR_WORDS = '‘Monthly recurring revenue’ being at least £4,800 at 1 month from now';
const CUST_WORDS = '‘Customers’ being at least 90 customers at 1 month from now';
const EXACT = 'Simulation precision: exact. Every input is a fixed figure, so every simulated draw gives the same result.';
const FORECAST_OR_VERDICT = /\b(will|win|wins|winner|best|recommend|recommended|should)\b|comes out on top/i;

describe('present: the canonical analysis view from a simulated model', () => {
  it('a 2-target model renders a per-target line for each, and the joint, each restating its question and its basis', () => {
    // Hold: MRR 49 × 100 = 4,900 ≥ 4,800 ✓; customers 100 ≥ 90 ✓ → joint 1 → "more than 99%".
    // Raise: customers 100 − 1.8 × 10 = 82; MRR 59 × 82 = 4,838 ≥ 4,800 ✓; 82 ≥ 90 ✗ → joint 0 → "less than 1%".
    // Every input is the person's figure and every relation theirs → "on your figures". One aim has no measure: left out, said.
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS,
      { leaves_out: ['Keep the regulars happy'] });
    const joint = `${MRR_WORDS} and ${CUST_WORDS}, leaving out ‘Keep the regulars happy’, which has no measure yet`;
    expect(v.goal_chance.chance_words).toBe(`chance of ${joint}`);
    expect(v.goal_chance.targets.joint).toEqual({ status: 'licensed', words: joint });
    expect(v.goal_chance.targets.per_target).toEqual([
      { constraint_id: 'g_mrr', words: `${MRR_WORDS}, in this model, on your figures`,
        options: [{ option_id: 'hold', display: 'more than 99%' }, { option_id: 'raise', display: 'more than 99%' }] },
      { constraint_id: 'g_cust', words: `${CUST_WORDS}, in this model, on your figures`,
        options: [{ option_id: 'hold', display: 'more than 99%' }, { option_id: 'raise', display: 'less than 1%' }] },
    ]);
    expect(cell(v, 'hold')).toEqual({ kind: 'figure', display: 'more than 99%',
      face: `‘Hold’: more than 99% chance of ${joint}, in this model, on your figures.`,
      detail: { precision_95: [1, 1], draws: 200, precision_words: EXACT } });
    expect(cell(v, 'raise').face).toBe(`‘Raise to £59’: less than 1% chance of ${joint}, in this model, on your figures.`);
  });

  it('(b) the basis: "on your figures" only when every input is the person’s; otherwise "if" with Olumi’s assumptions listed', () => {
    // (i) Olumi's own estimated range for the per-£ loss, −2.2 to −1.4 around −1.8 (sd 0.8/√12 = 0.231, |−1.8| ≥ 0.462: a
    //     spread): conditional on Olumi's provisional conversion of its own range, for every option and every target.
    const olumi = present(model(MRR_QUANTITIES(range('per_pound', -2.2, -1.4, -1.8, 'customers', 'olumi_estimate')), MRR_GOALS, MRR_OPTIONS),
      { ...MRR_LABELS, per_pound: { label: 'Customers lost per £1 of price rise', author: 'olumi' } });
    const conversion = 'if ‘Customers lost per £1 of price rise’ follows Olumi’s provisional conversion of Olumi’s own estimated range,';
    for (const id of ['hold', 'raise']) {
      expect(cell(olumi, id).face).toContain(`, in this model, ${conversion}`);
      expect(cell(olumi, id).face).not.toContain('on your figures');
    }
    expect(olumi.goal_chance.targets.per_target[1].words).toContain(`${CUST_WORDS}, in this model, ${conversion}`);
    // (ii) The person's own range for the price: the bounds are theirs, the law is Olumi's provisional conversion of them.
    const theirs = present(model([...MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')).filter((x) => x.id !== 'price'),
      range('price', 39, 59, 49, '£', 'person_range')], MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(cell(theirs, 'hold').face).toContain(', in this model, if ‘Price’ follows Olumi’s provisional conversion of your range, £39 to £59, into a bell-shaped spread.');
    // (iii) An option's own Olumi figure: only that option's chance is conditional on it; the target says which option.
    const own = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS),
      { ...MRR_LABELS, price_59: { label: 'New price', author: 'olumi' } });
    expect(cell(own, 'hold').face).toMatch(/, in this model, on your figures\.$/);
    expect(cell(own, 'raise').face).toMatch(/, in this model, if ‘New price’ is £59, Olumi’s figure\.$/);
    expect(own.goal_chance.targets.per_target[0].words).toBe(`${MRR_WORDS}, in this model, on your figures; with ‘Raise to £59’, if ‘New price’ is £59, Olumi’s figure`);
    for (const v of [olumi, theirs, own]) expect(JSON.stringify(v)).not.toMatch(FORECAST_OR_VERDICT);
  });

  it('(c)+(d) a goal waiting on ONE asked quantity: only it waits, and it gets a threshold, said as a threshold, never a chance', () => {
    // The compiled model holds the budget goal only: 'Reach 100 cases' waits on 'Cases per specialist' (asked).
    // Budget: cost = specialists × £40,000 ≤ £50,000. Hold 0 ✓, Add one 40,000 ✓ → each "more than 99%".
    // Threshold: capacity = 80 + 1 × X ≥ 100 ⇔ X ≥ 20 (Add one); Hold stays at 80 whatever X is, so it has no threshold.
    const base = (each?: number): ExecutableModel => model([fixed('count', 0, 'specialists'), fixed('one', 1, 'specialists'),
      fixed('salary', 40000, '£'), def('cost', 'product', ['count', 'salary'], '£'), fixed('budget', 50000, '£'),
      ...(each === undefined ? [] : [fixed('today', 80, 'cases'), fixed('each', each, 'cases'),
        effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }], 'cases'), fixed('t100', 100, 'cases')])],
    [goal('g_cost', 'cost', '<=', 'budget'), ...(each === undefined ? [] : [goal('g_cap', 'capacity', '>=', 't100')])],
    [option('hold', 'Hold'), option('add', 'Add one specialist', [{ quantity: 'count', to: 'one', from_period: 0 }])]);
    const labels: Record<string, PresentQuantity> = { count: person('Specialists'), one: person('One specialist'), salary: person('Salary'),
      cost: person('Specialist cost', true), budget: person('Budget') };
    const question = 'How many cases does one specialist handle each month?';
    const v = present(base(), labels, {
      goals: [{ goal_id: 'g_cost', label: 'Stay within the budget', status: 'calculable', reasons: [], asks: [] },
        { goal_id: 'g_cap', label: 'Reach 100 cases', status: 'asks', reasons: ['It needs your answer.'], asks: ['each'] }],
      asks: [{ quantity_id: 'each', label: 'Cases per specialist', unit: 'cases', question }],
      tipping: { g_cap: { build: (x) => base(x) } },
    });
    for (const id of ['hold', 'add']) {
      expect(cell(v, id)).toEqual({ kind: 'withheld', face: 'Not shown yet: needs your answer',
        why: `‘Reach 100 cases’ waits for your answer: ${question}`,
        reasons: [{ code: 'goal_asks', message: 'It needs your answer.' }] });
    }
    expect(v.goal_chance.chance_words).toBeUndefined();
    expect(v.goal_chance.targets.joint).toEqual({ status: 'withheld',
      line: 'The chance of meeting all 2 goals together waits for ‘Reach 100 cases’; each goal that can be worked out is shown on its own.' });
    expect(v.goal_chance.targets.per_target).toEqual([{ constraint_id: 'g_cost',
      words: '‘Specialist cost’ being at most £50,000 at 1 month from now, in this model, on your figures',
      options: [{ option_id: 'hold', display: 'more than 99%' }, { option_id: 'add', display: 'more than 99%' }] }]);
    const words = 'Threshold: in this model, ‘Reach 100 cases’ is met with ‘Add one specialist’ if ‘Cases per specialist’ is at least 20 cases.';
    expect(v.goal_chance.thresholds).toEqual([{ kind: 'threshold', goal_id: 'g_cap', option_id: 'add', quantity: 'each', cmp: '>=', value: 20, words }]);
    expect(v.goal_chance.notes).toContain(words);
    expect(words).not.toMatch(/chance|%/);
  });

  it('the same model in £ and in £k gives identical words apart from the unit, and identical figures', () => {
    // Every £ quantity ÷ 1000 (row 6 of the numerical check). The chances are identical draw for draw, so every display and
    // precision is identical; the only differences are the unit's own: £39 ↔ 0.039 £k, £59 ↔ 0.059 £k, £5,000 ↔ 5 £k,
    // £1,100 ↔ 1.1 £k.
    const build = (k: number) => model([range('price', 39 / k, 59 / k, 49 / k, k === 1 ? '£' : '£k', 'person_range'),
      range('customers', 80, 120, 100, 'customers', 'person_range'), def('mrr', 'product', ['price', 'customers'], k === 1 ? '£' : '£k'),
      fixed('unit_cost', 10 / k, k === 1 ? '£' : '£k'), def('cost', 'product', ['customers', 'unit_cost'], k === 1 ? '£' : '£k'),
      fixed('target', 5000 / k, k === 1 ? '£' : '£k'), fixed('budget', 1100 / k, k === 1 ? '£' : '£k')],
    [goal('g', 'mrr', '>=', 'target')], [option('hold', 'Hold')], [{ id: 'l', quantity: 'cost', cmp: '<=', bound: 'budget', aggregation: 'end', window: ONE }]);
    const labels: Record<string, PresentQuantity> = { price: person('Price'), customers: person('Customers'), mrr: person('Monthly recurring revenue', true),
      unit_cost: person('Cost per customer'), cost: person('Customer cost', true), target: person('Target'), budget: person('Budget') };
    const pounds = JSON.stringify(present(build(1), labels, {}, 20000));
    const thousands = JSON.stringify(present(build(1000), labels, {}, 20000));
    const swapped = [['£39', '0.039 £k'], ['£59', '0.059 £k'], ['£5,000', '5 £k'], ['£1,100', '1.1 £k']]
      .reduce((s, [a, b]) => s.split(a!).join(b!), pounds);
    expect(swapped).not.toBe(pounds);
    expect(thousands).toBe(swapped);
  });

  it('simulation precision is labelled as precision, never as the chance’s band; no win share, verdict or forecast is said', () => {
    // The £ model above, stochastic: its cell's detail names the simulation's precision and says what it is not.
    const m = model([range('price', 39, 59, 49, '£', 'person_range'), range('customers', 80, 120, 100, 'customers', 'person_range'),
      def('mrr', 'product', ['price', 'customers'], '£'), fixed('target', 5000, '£')], [goal('g', 'mrr', '>=', 'target')], [option('hold', 'Hold')]);
    const v = present(m, { price: person('Price'), customers: person('Customers'), mrr: person('Monthly recurring revenue', true), target: person('Target') }, {}, 20000);
    const c = cell(v, 'hold');
    expect(c.kind).toBe('figure');
    expect(c.display).toMatch(/^about \d+%$/);
    expect(c.detail.precision_words).toMatch(/^Simulation precision: \d+(\.\d)?% to \d+(\.\d)?%, from 20,000 simulated draws\. This is how exactly the simulation measured the chance, not a range the chance could take\.$/);
    expect(c.face).not.toMatch(/precision|interval|range the chance/i);
    expect(JSON.stringify(v)).not.toMatch(FORECAST_OR_VERDICT);
  });

  it('an absent driver, leader and Run: the reader’s own "not_recorded", no leader, currentness unknown', () => {
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(v.options.map((o: Rec) => o.main_driver)).toEqual([{ kind: 'not_recorded' }, { kind: 'not_recorded' }]);
    expect(Object.hasOwn(v, 'leader')).toBe(false);
    expect(v.leader_licence).toBe('withheld');
    expect(v.run).toBeNull();
    expect(v.staleness).toEqual({ stale: null, revision: null, run_revision: null, basis: 'analysis_graph_hash_interim', reason: null,
      limitation: 'Currentness is unknown because an analysis hash is unavailable.' });
    const known = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS,
      { run: { run_id: 'r1', graph_hash_at_run: 'h1', computed_at: '2026-10-23T12:00:00Z' }, current: true, revision: 4 });
    expect(known.staleness).toEqual({ stale: false, revision: 4, run_revision: null, basis: 'analysis_graph_hash_interim', reason: null,
      limitation: 'Hash equality cannot detect brief, framing or stage changes.' });
  });

  it('a chance a nonfinite draw touched is a withheld cell with its count, never a figure', () => {
    // 10 ÷ 0 in every one of 200 draws: the goal, the joint and the headline are withheld (invalid_domain, 200, 'Revenue per seat').
    const m = model([fixed('revenue', 10, '£'), fixed('seats', 0, 'seats'), def('per_seat', 'ratio', ['revenue', 'seats'], '£/seat'), fixed('zero', 0, '£/seat')],
      [goal('g', 'per_seat', '>=', 'zero')], [option('hold', 'Hold')]);
    const v = present(m, { revenue: person('Revenue'), seats: person('Seats'), per_seat: person('Revenue per seat', true), zero: person('Zero') });
    expect(cell(v, 'hold')).toEqual({ kind: 'withheld', face: 'Chance not shown yet',
      why: 'In 200 of 200 simulated draws ‘Revenue per seat’ could not be worked out (for example a division by zero), so this model cannot give the chance yet.',
      reasons: [{ code: 'invalid_domain', message: '200 draws; per_seat' }] });
  });
});
