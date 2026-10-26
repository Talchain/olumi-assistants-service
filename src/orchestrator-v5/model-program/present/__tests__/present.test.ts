/**
 * present.ts rows. Every expected sentence and display is written out BY HAND from the model's own figures (deterministic
 * models, so each chance is exactly 0 or 1 and its display is the screen's edge words), never produced by calling the code
 * under test. Stochastic rows assert the labels and the invariance, not a sampled number.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, FixedAuthor, Goal, Limit, Option, Quantity, Reading, Withheld } from '../../executable.js';
import { simulate } from '../../simulate/simulate.js';
import { NO_DRIVER_REASON, NO_RANGE_REASON, presentAnalysisView, type PresentInput, type PresentQuantity } from '../present.js';

type Rec = Record<string, any>;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const fixed = (id: string, value: number, unit = '', reading: Reading = 'state', author: FixedAuthor = 'person'): Quantity =>
  ({ id, label: id, unit, reading, dist: { kind: 'fixed', value, author } });
const range = (id: string, low: number, high: number, mode: number | undefined, unit: string, basis: 'person_range' | 'olumi_estimate'): Quantity =>
  ({ id, label: id, unit, reading: 'state', dist: { kind: 'range', low, high, ...(mode !== undefined ? { mode } : {}), basis, range_kind: 'plausible' } });
const def = (id: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: { coefficient: string; driver: string }[], unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', equation: { form: 'effect', base, terms } });
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string): Goal => ({ id, label: id, quantity, cmp, target, aggregation: 'end', window: ONE });
const option = (id: string, label: string, sets: Option['sets'] = []): Option => ({ id, label, sets });
const model = (quantities: Quantity[], goals: Goal[], options: Option[], limits: Limit[] = [], withheld: Withheld[] = []): ExecutableModel =>
  ({ periods: 1, period_unit: 'month', quantities, goals, limits, options, risks: [], withheld });
const person = (label: string, relation = false): PresentQuantity => ({ label, author: 'person', confirmed: true, ...(relation ? { relation_author: 'person' as const } : {}) });
const cell = (v: Rec, id: string): Rec => v.options.find((o: Rec) => o.option_id === id).cell;
/** R8 (default deny): the person's own fixed figures and identities, said confirmed; an effect, an Olumi or unrecorded figure has no meta. */
const confirmedFigures = (m: ExecutableModel): Record<string, PresentQuantity> => Object.fromEntries(m.quantities
  .filter((x) => (x.dist?.kind === 'fixed' && x.dist.author === 'person') || x.equation?.form === 'definition').map((x) => [x.id, person(x.id)]));

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
  // R8 (default deny): the rows' goals and limits are the person's, confirmed, unless a row says otherwise.
  const aims = Object.fromEntries([...m.goals, ...m.limits].map((c) => [c.id, { confirmed: true, accepted: true }]));
  return presentAnalysisView({ model: m, result: simulate(m, { seed: 20261023, draws }), quantities: labels, aims, ...more }) as unknown as Rec;
}

// Hand-written words (the level template of goal-target-basis.ts `targetChanceWords`, the end of month 1 for a state):
const MRR_WORDS = '‘Monthly recurring revenue’ being at least £4,800 at 1 month from now';
const CUST_WORDS = '‘Customers’ being at least 90 customers at 1 month from now';
const EXACT = 'Simulation precision: exact. Every simulated draw gives the same result for this option, so no sampling is involved.';
// Lenses fit 2 (DL 23 Oct): an exact chance says the fixed value that makes it exact. Hold: £49 × 100 = £4,900 ≥ £4,800 and
// 100 ≥ 90 (both met, both named); Raise: 100 − 1.8 × 10 = 82 < 90 (the missed one is named; £59 × 82 = £4,838 is met).
const HOLD_WHY = 'in every simulated draw ‘Monthly recurring revenue’ is £4,900 at 1 month from now, at least £4,800 and ‘Customers’ is 100 customers at 1 month from now, at least 90 customers';
const RAISE_WHY = 'in every simulated draw ‘Customers’ is 82 customers at 1 month from now, below 90 customers';
const FORECAST_OR_VERDICT = /\b(will|win|wins|winner|best|recommend|recommended|should)\b|comes out on top/i;

describe('present: the canonical analysis view from a simulated model', () => {
  it('a 2-target model renders a per-target line for each, and the joint, each restating its question and its basis', () => {
    // Hold: MRR 49 × 100 = 4,900 ≥ 4,800 ✓; customers 100 ≥ 90 ✓ → joint 1, from fixed inputs only → exactly "100%".
    // Raise: customers 100 − 1.8 × 10 = 82; MRR 59 × 82 = 4,838 ≥ 4,800 ✓; 82 ≥ 90 ✗ → joint 0 → exactly "0%".
    // Every input is the person's figure and every relation theirs → "on your figures". One aim has no measure: left out, said.
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS,
      { leaves_out: ['Keep the regulars happy'] });
    const joint = `${MRR_WORDS} and ${CUST_WORDS}, leaving out ‘Keep the regulars happy’, which has no measure yet`;
    expect(v.goal_chance.chance_words).toBe(`chance of ${joint}`);
    expect(v.goal_chance.targets.joint).toEqual({ status: 'licensed', words: joint });
    expect(v.goal_chance.targets.per_target).toEqual([
      { constraint_id: 'g_mrr', words: `${MRR_WORDS}, in this model, on your figures`,
        options: [{ option_id: 'hold', display: '100%' }, { option_id: 'raise', display: '100%' }] },
      { constraint_id: 'g_cust', words: `${CUST_WORDS}, in this model, on your figures`,
        options: [{ option_id: 'hold', display: '100%' }, { option_id: 'raise', display: '0%' }] },
    ]);
    expect(cell(v, 'hold')).toEqual({ kind: 'figure', display: '100%',
      face: `‘Hold’: 100% chance of ${joint}, in this model, on your figures: ${HOLD_WHY}.`,
      detail: { precision_95: [1, 1], draws: 200, precision_words: EXACT } });
    expect(cell(v, 'raise').face).toBe(`‘Raise to £59’: 0% chance of ${joint}, in this model, on your figures: ${RAISE_WHY}.`);
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
    const own = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers'), fixed('price_59', 59, '£', 'state', 'olumi')), MRR_GOALS, MRR_OPTIONS),
      MRR_LABELS);
    expect(cell(own, 'hold').face.endsWith(`, in this model, on your figures: ${HOLD_WHY}.`)).toBe(true);
    expect(cell(own, 'raise').face.endsWith(`, in this model, if ‘New price’ is £59, Olumi’s figure: ${RAISE_WHY}.`)).toBe(true);
    // Codex #3769: no bare "on your figures" beside an option's own condition; the option named says what is conditional.
    expect(own.goal_chance.targets.per_target[0].words).toBe(`${MRR_WORDS}, in this model, with ‘Raise to £59’, if ‘New price’ is £59, Olumi’s figure`);
    for (const v of [olumi, theirs, own]) expect(JSON.stringify(v)).not.toMatch(FORECAST_OR_VERDICT);
  });

  it('(c)+(d) a goal waiting on ONE asked quantity: only it waits, and no threshold is said for it (alpha G10)', () => {
    // The compiled model holds the budget goal only: 'Reach 100 cases' waits on 'Cases per specialist' (asked).
    // Budget: cost = specialists × £40,000 ≤ £50,000. Hold 0 ✓, Add one 40,000 ✓ → each exactly "100%".
    const base = (each?: number): ExecutableModel => model([fixed('count', 0, 'specialists'), fixed('one', 1, 'specialists'),
      fixed('salary', 40000, '£'), def('cost', 'product', ['count', 'salary'], '£'), fixed('budget', 50000, '£'),
      ...(each === undefined ? [] : [fixed('today', 80, 'cases'), fixed('each', each, 'cases'),
        effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }], 'cases'), fixed('t100', 100, 'cases')])],
    [goal('g_cost', 'cost', '<=', 'budget'), ...(each === undefined ? [] : [goal('g_cap', 'capacity', '>=', 't100')])],
    [option('hold', 'Hold'), option('add', 'Add one specialist', [{ quantity: 'count', to: 'one', from_period: 0 }])]);
    const labels: Record<string, PresentQuantity> = { count: person('Specialists'), one: person('One specialist'), salary: person('Salary'),
      cost: person('Specialist cost', true), budget: person('Budget') };
    // S1 A4: what it waits on is said by label and listed, typed, with the figure its answer box fills; never a question.
    const waits_on = [{ id: 'each', code: 'asked', label: 'Cases per specialist', scope: ['g_cap'], answer: { quantity_id: 'each' } }];
    const v = present(base(), labels, {
      goals: [{ goal_id: 'g_cost', label: 'Stay within the budget', status: 'calculable', reasons: [], asks: [] },
        { goal_id: 'g_cap', label: 'Reach 100 cases', status: 'asks', reasons: ['It needs your answer.'], asks: ['each'] }],
      asks: [{ quantity_id: 'each', label: 'Cases per specialist', unit: 'cases' }], blockers: waits_on,
    });
    for (const id of ['hold', 'add']) {
      expect(cell(v, id)).toEqual({ kind: 'withheld', face: 'Not shown yet: needs your answer',
        why: '‘Reach 100 cases’ waits on ‘Cases per specialist’.',
        reasons: [{ code: 'goal_asks', message: 'It needs your answer.' }] });
    }
    expect(v.goal_chance.waits_on).toEqual(waits_on);
    expect(v.goal_chance.notes).toContain('‘Reach 100 cases’ waits on ‘Cases per specialist’.');
    expect(JSON.stringify(v)).not.toContain('?');
    expect(v.goal_chance.chance_words).toBeUndefined();
    expect(v.goal_chance.targets.joint).toEqual({ status: 'withheld',
      line: 'The chance of meeting all 2 goals together waits for ‘Reach 100 cases’; each goal that can be worked out is shown on its own.' });
    expect(v.goal_chance.targets.per_target).toEqual([{ constraint_id: 'g_cost',
      words: '‘Specialist cost’ being at most £50,000 at 1 month from now, in this model, on your figures',
      options: [{ option_id: 'hold', display: '100%' }, { option_id: 'add', display: '100%' }] }]);
    expect(v.goal_chance).not.toHaveProperty('thresholds');
    expect(JSON.stringify(v)).not.toMatch(/Threshold|at least 20/);
  });

  it('the same model in £ and in £k gives identical words apart from the unit, and identical figures', () => {
    // Every £ quantity ÷ 1000 (row 6 of the numerical check). The chances are identical draw for draw, so every display and
    // precision is identical; the only differences are the unit's own: £39 ↔ 0.039 £k, £59 ↔ 0.059 £k, £5,000 ↔ 5 £k,
    // £1,100 ↔ 1.1 £k.
    const build = (k: number) => model([range('price', 39 / k, 59 / k, 49 / k, k === 1 ? '£' : '£k', 'person_range'),
      range('customers', 80, 120, 100, 'customers', 'person_range'), def('mrr', 'product', ['price', 'customers'], k === 1 ? '£' : '£k'),
      fixed('unit_cost', 10 / k, k === 1 ? '£' : '£k'), def('cost', 'product', ['customers', 'unit_cost'], k === 1 ? '£' : '£k'),
      fixed('target', 5000 / k, k === 1 ? '£' : '£k'), fixed('budget', 1100 / k, k === 1 ? '£' : '£k')],
    [goal('g', 'mrr', '>=', 'target')], [option('hold', 'Hold')], [{ id: 'l', label: 'Budget limit', quantity: 'cost', cmp: '<=', bound: 'budget', aggregation: 'end', window: ONE }]);
    const labels: Record<string, PresentQuantity> = { price: person('Price'), customers: person('Customers'), mrr: person('Monthly recurring revenue', true),
      unit_cost: person('Cost per customer'), cost: person('Customer cost', true), target: person('Target'), budget: person('Budget') };
    const pounds = JSON.stringify(present(build(1), labels, {}, 20000));
    const thousands = JSON.stringify(present(build(1000), labels, {}, 20000));
    // The main driver's record holds its ends in the quantity's own unit, so they are the unit's own difference too.
    const swapped = [['£39', '0.039 £k'], ['£59', '0.059 £k'], ['£5,000', '5 £k'], ['£1,100', '1.1 £k'], ['"value":39,', '"value":0.039,'], ['"value":59,', '"value":0.059,'],
      ['(£49)', '(0.049 £k)'], ['"value":49,', '"value":0.049,']]
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

  it('a chance on fixed figures only names no driver (no range to test); no leader and no Run: currentness unknown', () => {
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(v.options.map((o: Rec) => o.main_driver)).toEqual([{ kind: 'none_licensed', reason: NO_RANGE_REASON }, { kind: 'none_licensed', reason: NO_RANGE_REASON }]);
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

  it('what the compiler left out (withheld[]): a goal waits, so the joint is never partial; a limit is named as not yet checked', () => {
    // The MRR model with 'Keep the regulars happy' (a goal with no measure) and the 'Overdraft' limit left out by the compiler.
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS, [], [
      { id: 'regulars', kind: 'goal', label: 'Keep the regulars happy', reason: 'It has no measure yet.' },
      { id: 'overdraft', kind: 'limit', label: 'Overdraft', reason: 'Its figure is unknown.' }]), MRR_LABELS);
    expect(cell(v, 'hold')).toEqual({ kind: 'withheld', face: 'Chance not shown yet',
      why: '‘Keep the regulars happy’ is not in the chance yet: It has no measure yet.',
      reasons: [{ code: 'goal_withheld', message: 'It has no measure yet.' }] });
    expect(v.goal_chance.targets.joint.status).toBe('withheld');
    expect(v.goal_chance.targets.per_target.map((t: Rec) => t.constraint_id)).toEqual(['g_mrr', 'g_cust']);
    expect(v.goal_chance.targets.per_target[0].words).toBe(`${MRR_WORDS}, in this model, on your figures`);
    expect(v.goal_chance.notes).toContain('Not yet checked: ‘Overdraft’ — Its figure is unknown.');
    const limitOnly = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS, [],
      [{ id: 'overdraft', kind: 'limit', label: 'Overdraft', reason: 'Its figure is unknown.' }]), MRR_LABELS);
    expect(cell(limitOnly, 'hold').face).toBe(`‘Hold’: 100% chance of ${MRR_WORDS} and ${CUST_WORDS}, in this model, on your figures: ${HOLD_WHY}. Not yet checked: ‘Overdraft’ — Its figure is unknown.`);
  });

  it('S3 fix 1: the basis lists only Olumi\u2019s quantities, coefficients and effect relations; identities never', () => {
    // Bakery: spend = price × loaves (a definition) on the person's figures, £3.50 × 40 = £140; a zero start built as
    // difference(x, x) = 0; a year's spend = (spend + zero) × 12 months a year (a unit conversion, structure).
    // £1,680 ≤ £2,400 in every draw → exactly 100%, "on your figures": no identity or conversion is an assumption.
    const bakery = (more: Quantity[] = [], extra: string[] = []) => model([fixed('price', 3.5, '£'), fixed('loaves', 40, 'loaves'),
      def('spend', 'product', ['price', 'loaves'], '£'), fixed('x', 7, '£'), def('zero', 'difference', ['x', 'x'], '£'),
      def('month_total', 'sum', ['spend', 'zero', ...extra], '£'), fixed('months', 12, 'month/year', 'state', 'structure'),
      def('year_total', 'product', ['month_total', 'months'], '£'), fixed('cap', 2400, '£'), ...more],
    [{ ...goal('g', 'year_total', '<=', 'cap'), label: 'Stay within the yearly budget' }], [option('hold', 'Hold')]);
    const plain = present(bakery(), confirmedFigures(bakery()));
    expect(cell(plain, 'hold').display).toBe('100%');
    // (£3.50 × 40 + 0) × 12 = £1,680 in every draw, at most £2,400.
    expect(cell(plain, 'hold').face.endsWith(', in this model, on your figures: in every simulated draw ‘year_total’ is £1,680 at 1 month from now, at most £2,400.')).toBe(true);
    // An effect whose size is Olumi's figure, and whose relation is Olumi's: both are listed, and nothing else.
    const withEffect = (relation_author?: 'person' | 'olumi') => {
      const m = bakery([fixed('base', 10, '£'), fixed('per_degree', -2, '£', 'state', 'olumi'),
        fixed('temperature', 1, 'degrees'), effect('weather', 'base', [{ coefficient: 'per_degree', driver: 'temperature' }], '£')], ['weather']);
      return present(m, { ...confirmedFigures(m), ...(relation_author === undefined ? {} : { weather: { label: 'weather', author: 'person', relation_author, confirmed: relation_author === 'person' } }) });
    };
    // Weather = 10 − 2 × 1 = £8, so (£140 + 0 + £8) × 12 = £1,776 in every draw: the basis, then why it is exact.
    const WHY = ': in every simulated draw ‘year_total’ is £1,776 at 1 month from now, at most £2,400.';
    const basis = (v: Rec): string => { const after = cell(v, 'hold').face.split(', in this model, ')[1] as string; expect(after.endsWith(WHY)).toBe(true); return after.slice(0, -WHY.length); };
    expect(basis(withEffect('olumi'))).toBe('if ‘per_degree’ is -£2, Olumi’s figure and ‘weather’ follows Olumi’s assumed relationship');
    expect(basis(withEffect('person'))).toBe('if ‘per_degree’ is -£2, Olumi’s figure');
    // DL ruling: a relation with NO recorded author is listed as an assumption, never read as the person's.
    expect(basis(withEffect())).toBe('if ‘per_degree’ is -£2, Olumi’s figure and ‘weather’ follows a relationship (author not recorded)');
    // No identity, conversion or person's figure is ever named in the basis.
    for (const v of [withEffect('olumi')]) expect(basis(v)).not.toMatch(/‘(price|loaves|spend|x|zero|month_total|months|year_total|cap|base|temperature)’/);
  });

  it('DL ruling: a quantity, coefficient or effect relation with NO recorded author is an assumption "(author not recorded)", never "on your figures"', () => {
    // Weather = base + per_degree × temperature = 10 + 2 × 1 = £12 ≥ £5 in every draw → exactly 100%. Every value is the
    // person's except the coefficient, whose author is not recorded (absent from the model and from the labels), and the
    // relation has no recorded author either. Both are listed; the chance never reads "on your figures".
    const unrecorded = (q: Quantity): Quantity => { const c = JSON.parse(JSON.stringify(q)) as Quantity; Reflect.deleteProperty(c.dist!, 'author'); return c; };
    const m = (coefficient: Quantity) => model([fixed('base', 10, '£'), coefficient, fixed('temperature', 1, 'degrees'),
      effect('weather', 'base', [{ coefficient: 'per_degree', driver: 'temperature' }], '£'), fixed('floor', 5, '£')],
    [{ ...goal('g', 'weather', '>=', 'floor'), label: 'Weather takings' }], [option('hold', 'Hold')]);
    const v = present(m(unrecorded(fixed('per_degree', 2, '£'))), confirmedFigures(m(unrecorded(fixed('per_degree', 2, '£')))));
    expect(cell(v, 'hold').display).toBe('100%');
    expect(cell(v, 'hold').face).toBe('‘Hold’: 100% chance of ‘weather’ being at least £5 at 1 month from now, in this model, '
      + 'if ‘per_degree’ is £2 (author not recorded) and ‘weather’ follows a relationship (author not recorded): in every simulated draw ‘weather’ is £12 at 1 month from now, at least £5.');
    expect(JSON.stringify(v)).not.toContain('on your figures');
    // Contrast: the same model with both authors recorded as the person's reads "on your figures".
    const own = present(m(fixed('per_degree', 2, '£')), { ...confirmedFigures(m(fixed('per_degree', 2, '£'))), weather: { label: 'weather', author: 'person', relation_author: 'person', confirmed: true } });
    expect(cell(own, 'hold').face.endsWith(', in this model, on your figures: in every simulated draw ‘weather’ is £12 at 1 month from now, at least £5.')).toBe(true);
  });

  it('S3 fix 3: every limit\u2019s own outcome is in the words, and a limit waiting on an ask is named with what it waits on', () => {
    // Specialist cost = specialists × £40,000 against two limits: ≤ £50,000 (hold 0 ✓, add 40,000 ✓ → 100%, 100%) and
    // ≤ £30,000 (hold ✓ 100%, add ✗ 0%). 'Desk space' waits on 'Desks free': named, never dropped.
    const m = model([fixed('count', 0, 'specialists'), fixed('one', 1, 'specialists'), fixed('salary', 40000, '£'),
      def('cost', 'product', ['count', 'salary'], '£'), fixed('b50', 50000, '£'), fixed('b30', 30000, '£'), fixed('zero', 0, 'specialists')],
    [goal('g', 'count', '>=', 'zero')], [option('hold', 'Hold'), option('add', 'Add one specialist', [{ quantity: 'count', to: 'one', from_period: 0 }])],
    [{ id: 'l50', label: 'Budget', quantity: 'cost', cmp: '<=', bound: 'b50', aggregation: 'end', window: ONE },
      { id: 'l30', label: 'Hard cap', quantity: 'cost', cmp: '<=', bound: 'b30', aggregation: 'end', window: ONE }]);
    const v = present(m, { cost: person('Specialist cost', true), count: person('Specialists') }, {
      limits: [{ limit_id: 'l50', label: 'Budget', status: 'calculable', reasons: [], asks: [] },
        { limit_id: 'l30', label: 'Hard cap', status: 'calculable', reasons: [], asks: [] },
        { limit_id: 'l_desks', label: 'Desk space', status: 'asks', reasons: [], asks: ['desks'] }],
      asks: [{ quantity_id: 'desks', label: 'Desks free', unit: 'desks' }],
    });
    const l50 = '‘Specialist cost’ is at most £50,000 at 1 month from now', l30 = '‘Specialist cost’ is at most £30,000 at 1 month from now';
    const unchecked = 'Not yet checked: ‘Desk space’ — waits on ‘Desks free’';
    expect(cell(v, 'hold').face).toContain(` Each limit on its own: ${l50}: 100%; ${l30}: 100%. ${unchecked}`);
    expect(cell(v, 'add').face).toContain(` Each limit on its own: ${l50}: 100%; ${l30}: 0%. ${unchecked}`);
    // Add's 0% is exact, and the limit that fixes it is named with its value: 1 × £40,000 = £40,000 > £30,000.
    expect(cell(v, 'add').face).toContain(': in every simulated draw ‘Specialist cost’ is £40,000 at 1 month from now, above £30,000. Each limit on its own:');
    expect(v.goal_chance.limits).toEqual([
      { constraint_id: 'l50', words: l50, options: [{ option_id: 'hold', display: '100%' }, { option_id: 'add', display: '100%' }] },
      { constraint_id: 'l30', words: l30, options: [{ option_id: 'hold', display: '100%' }, { option_id: 'add', display: '0%' }] }]);
    expect(v.goal_chance.unchecked_limits).toEqual([{ limit_id: 'l_desks', words: '‘Desk space’ — waits on ‘Desks free’' }]);
    expect(v.goal_chance.notes).toContain(`${unchecked}.`);
  });

  it('Codex r1 #3709: a figure said to be the person\u2019s whose words were not found is never "on your figures", whatever its recorded author', () => {
    // Weather = 10 + 2 × 1 = £12 ≥ £5 (exact). The coefficient's dist says person, but its words were not found (unverified).
    const m = model([fixed('base', 10, '£'), fixed('per_degree', 2, '£'), fixed('temperature', 1, 'degrees'),
      effect('weather', 'base', [{ coefficient: 'per_degree', driver: 'temperature' }], '£'), fixed('floor', 5, '£')],
    [{ ...goal('g', 'weather', '>=', 'floor'), label: 'Weather takings' }], [option('hold', 'Hold')]);
    const relation = { ...confirmedFigures(m), weather: { label: 'weather', author: 'person' as const, relation_author: 'person' as const, confirmed: true } };
    const v = present(m, { ...relation, per_degree: { label: 'per_degree', author: 'unverified' as const } });
    expect(cell(v, 'hold').face).toBe('‘Hold’: 100% chance of ‘weather’ being at least £5 at 1 month from now, in this model, '
      + 'if ‘per_degree’ is £2 (not found in your words): in every simulated draw ‘weather’ is £12 at 1 month from now, at least £5.');
    // Contrast: the same figure, its words found, is theirs.
    expect(cell(present(m, { ...relation, per_degree: person('per_degree') }), 'hold').face).toContain(', in this model, on your figures:');
  });

  it('Lenses fit 2 (DL 23 Oct): 0% only when the outcome is FIXED, with why; 0 of N sampled draws is "less than 1%", never 0%', () => {
    // Capacity: weekly = 80 + per_specialist × specialists. Keep sets specialists to 0, so weekly is 80 in every draw against
    // 100 even though per_specialist is Olumi's range (10 to 30 around 20): exact, and said why. With the target at 200, Add
    // one (80 + 10..30, a bell-shaped spread around 100, sd 20/√12 ≈ 5.8) meets it in none of 200 draws (it would need
    // +20 sd), yet the outcome is uncertain: "less than 1%" with the sampled precision, never "0%".
    const capacity = (target: number) => model([fixed('existing', 80, 'ticket/week'), fixed('none', 0, 'specialist'), fixed('one', 1, 'specialist'),
      fixed('specialists', 0, 'specialist'), range('per_specialist', 10, 30, 20, 'ticket/week/specialist', 'olumi_estimate'),
      effect('weekly', 'existing', [{ coefficient: 'per_specialist', driver: 'specialists' }], 'ticket/week'), fixed('target', target, 'ticket/week')],
    [goal('g', 'weekly', '>=', 'target')],
    [option('keep', 'Keep current staffing', [{ quantity: 'specialists', to: 'none', from_period: 0 }]), option('add', 'Add one specialist', [{ quantity: 'specialists', to: 'one', from_period: 0 }])]);
    const labels = { weekly: person('Weekly support capacity', true), existing: person('Existing capacity'), target: person('Target'),
      per_specialist: { label: 'Capacity per specialist', author: 'olumi' as const } };
    const v = present(capacity(100), labels);
    expect(cell(v, 'keep').display).toBe('0%');
    expect(cell(v, 'keep').detail.precision_words).toBe(EXACT);
    expect(cell(v, 'keep').face.endsWith(': in every simulated draw ‘Weekly support capacity’ is 80 ticket / week at 1 month from now, below 100 ticket / week.')).toBe(true);
    const far = present(capacity(200), labels);
    expect(cell(far, 'add').display).toBe('less than 1%');
    expect(cell(far, 'add').detail.precision_95[0]).toBeCloseTo(0, 12);
    expect(cell(far, 'add').detail.precision_95[1]).toBeGreaterThan(0);
    expect(cell(far, 'add').detail.precision_words).toMatch(/^Simulation precision: 0% to [0-9.]+%, from 200 simulated draws\./);
    expect(cell(far, 'add').face).not.toContain('in every simulated draw');
    expect(JSON.stringify(far)).not.toMatch(/"display":"0%"[^}]*"option_id":"add"|‘Add one specialist’: 0%/);
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

// ── What each computed chance rests on most (DL 24 Oct): one figure at a time at its low end, middle and high end ──────────
// Capacity = (80 + d) + c × added; the goal is capacity ≥ 95. c is Olumi's estimate, 10 to 30 tickets per specialist; d is
// the person's tiny day-to-day range, −0.1 to 0.1. "Add one specialist" sets added to 1.
const SPEC = (c: Quantity, d: Quantity = range('d', -0.1, 0.1, undefined, 'tickets', 'person_range')) => model([fixed('base', 80, 'tickets'), d,
  def('start', 'sum', ['base', 'd'], 'tickets'), c, fixed('added', 0, 'specialists', 'state', 'structure'), fixed('one', 1, 'specialists', 'state', 'structure'),
  effect('capacity', 'start', [{ coefficient: 'c', driver: 'added' }], 'tickets'), fixed('target', 95, 'tickets')],
  [goal('g', 'capacity', '>=', 'target')], [option('keep', 'Keep'), option('add', 'Add one specialist', [{ quantity: 'added', to: 'one', from_period: 0 }])]);
const SPEC_LABELS: Record<string, PresentQuantity> = { base: person('Tickets today'), d: person('Day-to-day variation'), start: person('Tickets before hiring', true),
  c: { label: 'Capacity per specialist', author: 'olumi' }, added: { label: 'Specialists added', author: 'structure' }, one: { label: 'One specialist', author: 'structure' },
  capacity: person('Weekly capacity', true), target: person('Capacity target') };
// c + e ≥ target: c is Olumi's 10 to 30 (spread 20/√12 = 5.77), e Olumi's 15 to 25 (2.89), both centred on 20.
const PAIR = (target: number) => model([range('c', 10, 30, undefined, 'tickets', 'olumi_estimate'), range('e', 15, 25, undefined, 'tickets', 'olumi_estimate'),
  def('total', 'sum', ['c', 'e'], 'tickets'), fixed('t', target, 'tickets')], [goal('g', 'total', '>=', 't')], [option('plan', 'Plan')]);
const PAIR_LABELS: Record<string, PresentQuantity> = { c: { label: 'Capacity per specialist', author: 'olumi' }, e: { label: 'Extra capacity', author: 'olumi' },
  total: person('Total capacity', true), t: person('Capacity target') };
const driver = (v: Rec, id: string): Rec => v.options.find((o: Rec) => o.option_id === id).main_driver;
const SPEC_DETAIL = (whose: string) => `In this model, of the figures tested one at a time, the chance is most sensitive to ‘Capacity per specialist’ (${whose}): `
  + 'at the low end (10 tickets) less than 1%, at the middle (20 tickets) more than 99%, at the high end (30 tickets) more than 99%.';
// A start that waits on a ranged delay: capacity is 80, or 110 once the hire starts; the goal is 100 at the end of month 6.
const timed = (delayOn: 'set' | 'risk') => ({ periods: 6, period_unit: 'month', withheld: [],
  quantities: [delayOn === 'set' ? fixed('base', 80, 'tickets') : fixed('base', 110, 'tickets'), fixed('added', 0, 'tickets', 'state', 'structure'),
    fixed('thirty', 30, 'tickets', 'state', 'structure'), def('capacity', 'sum', ['base', 'added'], 'tickets'), fixed('target', 100, 'tickets'),
    { id: 'delay', label: 'delay', unit: 'months', reading: 'state', dist: { kind: 'range', low: 2, high: 10, basis: 'olumi_estimate', range_kind: 'plausible', domain: { min: 0 } } },
    fixed('fires', 1, '', 'state', 'person'), fixed('loss', -50, 'tickets')],
  goals: [{ id: 'g', label: 'g', quantity: 'capacity', cmp: '>=', target: 'target', aggregation: 'end', window: { start_period: 0, periods: 6 } }], limits: [],
  options: delayOn === 'set' ? [option('hire', 'Hire', [{ quantity: 'added', to: 'thirty', from_period: 'delay' }])] : [option('carry_on', 'Carry on')],
  risks: delayOn === 'risk' ? [{ id: 'outage', occurrence: 'fires', severity: 'loss', effect_on: 'capacity', mode: 'add', from_period: 'delay' }] : [] }) as unknown as ExecutableModel;

describe('present: what each computed chance rests on most (one figure at a time at its low end, middle and high end)', () => {
  it('a hand-calculated model: the driver and its three settings are known, and an option nothing moves licenses none', () => {
    // Add: at c = 10, capacity is 90 + d, below 95 in every draw (d moves it by about 0.06): 0 of 200, "less than 1%"; at c = 20,
    // 100 + d, and at c = 30, 110 + d, met in every draw: "more than 99%". None is exact (d is still drawn). Swing 100 points;
    // d's own is about 1 point. Keep: 80 + d is never 95 at any setting: swing 0.
    const v = present(SPEC(range('c', 10, 30, undefined, 'tickets', 'olumi_estimate')), SPEC_LABELS);
    expect(cell(v, 'add').kind).toBe('figure');
    expect(driver(v, 'add')).toEqual({ kind: 'available',
      driver: { quantity: 'c', author: 'olumi', low: { value: 10, display: 'less than 1%' }, middle: { value: 20, display: 'more than 99%' },
        high: { value: 30, display: 'more than 99%' }, swing_points: 100, draws: 200, untested: [] },
      detail: SPEC_DETAIL('Olumi’s estimate') });
    expect(driver(v, 'keep')).toEqual({ kind: 'none_licensed', reason: NO_DRIVER_REASON });
    expect(driver(v, 'add').detail).not.toMatch(FORECAST_OR_VERDICT);
  });

  it('buddy #3728: a chance that peaks in the middle of a range is a driver, which the ends alone would miss', () => {
    // x is Olumi's 0 to 10; the goal is x ≥ 4 within the limit x ≤ 6. At x = 0 and x = 10 the chance is 0; at x = 5 it is
    // 100%. x is the only range, so each setting is exact.
    const m = model([range('x', 0, 10, undefined, 'tickets', 'olumi_estimate'), fixed('four', 4, 'tickets'), fixed('six', 6, 'tickets')],
      [goal('g', 'x', '>=', 'four')], [option('plan', 'Plan')], [{ id: 'l', label: 'l', quantity: 'x', cmp: '<=', bound: 'six', aggregation: 'end', window: ONE }]);
    const v = present(m, { x: { label: 'Tickets sold', author: 'olumi' }, four: person('Four'), six: person('Six') });
    expect(driver(v, 'plan')).toEqual({ kind: 'available',
      driver: { quantity: 'x', author: 'olumi', low: { value: 0, display: '0%' }, middle: { value: 5, display: '100%' }, high: { value: 10, display: '0%' }, swing_points: 100, draws: 200, untested: [] },
      detail: 'In this model, of the figures tested one at a time, the chance is most sensitive to ‘Tickets sold’ (Olumi’s estimate): at the low end (0 tickets) 0%, at the middle (5 tickets) 100%, at the high end (10 tickets) 0%.' });
  });

  it('buddy #3728: a ranged start delay is a driver (a set’s timing), and so is a ranged risk delay; both are in the basis too', () => {
    // Hire: capacity 80, plus 30 from month ceil(delay). At the end of month 6: delay 2 or 6 starts in time (110 ≥ 100, exact);
    // 10 does not (80). Carry on: 110, less 50 from month ceil(delay) when the outage fires (it always does): delay 2 or 6, 60;
    // 10, 110. The outage is a risk, so its chances are sampled: "less than 1%" and "more than 99%".
    const labels = { delay: { label: 'Start delay', author: 'olumi' as const }, base: person('Tickets today'), capacity: person('Weekly capacity', true), target: person('Target') };
    const hire = present(timed('set'), labels);
    expect(driver(hire, 'hire')).toEqual({ kind: 'available',
      driver: { quantity: 'delay', author: 'olumi', low: { value: 2, display: '100%' }, middle: { value: 6, display: '100%' }, high: { value: 10, display: '0%' }, swing_points: 100, draws: 200, untested: [] },
      detail: 'In this model, of the figures tested one at a time, the chance is most sensitive to ‘Start delay’ (Olumi’s estimate): at the low end (2 months) 100%, at the middle (6 months) 100%, at the high end (10 months) 0%.' });
    expect(cell(hire, 'hire').face).toContain('‘Start delay’ follows Olumi’s provisional conversion of Olumi’s own estimated range');
    const outage = driver(present(timed('risk'), { ...labels, delay: { label: 'Outage delay', author: 'olumi' as const } }), 'carry_on');
    expect(outage.kind).toBe('available');
    expect(outage.driver).toEqual({ quantity: 'delay', author: 'olumi', low: { value: 2, display: 'less than 1%' }, middle: { value: 6, display: 'less than 1%' },
      high: { value: 10, display: 'more than 99%' }, swing_points: 100, draws: 200, untested: [] });
  });

  it('Codex r1 #3728: a setting that cannot be worked out is named as not tested, never dropped, and nothing is concluded about it', () => {
    // (100 + noise) ÷ x, x Olumi's 0 to 10, noise the person's −1 to 1. At x = 0 the ratio divides by zero: that setting is not
    // worked out. Goal ≥ 15: at x = 5 it is about 20 (met in every draw), at x = 10 about 10 (never): x is the driver over the
    // settings that computed. Goal ≥ 5: at x = 5 and x = 10 it is met in every draw, so nothing tested moved the chance, and
    // the reason says x was not tested at its low end rather than that no figure moved it.
    const ratio = (target: number) => model([range('x', 0, 10, undefined, 'tickets', 'olumi_estimate'), fixed('hundred', 100, 'tickets'),
      range('noise', -1, 1, undefined, 'tickets', 'person_range'), def('num', 'sum', ['hundred', 'noise'], 'tickets'), def('per', 'ratio', ['num', 'x'], ''),
      fixed('t', target, '')], [goal('g', 'per', '>=', 't')], [option('plan', 'Plan')]);
    const labels = { x: { label: 'Batches', author: 'olumi' as const }, noise: person('Noise'), hundred: person('Hundred'), num: person('Numerator', true), per: person('Per batch', true), t: person('Target') };
    const fifteen = driver(present(ratio(15), labels), 'plan');
    expect(fifteen.kind).toBe('available');
    expect(fifteen.driver.quantity).toBe('x');
    expect(fifteen.driver.low).toEqual({ value: 0, display: null });
    expect(fifteen.driver.middle).toEqual({ value: 5, display: 'more than 99%' });
    expect(fifteen.driver.high).toEqual({ value: 10, display: 'less than 1%' });
    expect(fifteen.driver.untested).toEqual([{ quantity: 'x', settings: ['low end'] }]);
    expect(fifteen.detail).toBe('In this model, of the figures tested one at a time, the chance is most sensitive to ‘Batches’ (Olumi’s estimate): at the low end (0 tickets) could not be tested, at the middle (5 tickets) more than 99%, at the high end (10 tickets) less than 1%.');
    const five = driver(present(ratio(5), labels), 'plan');
    expect(five).toEqual({ kind: 'none_licensed', reason: '‘Batches’ could not be tested at its low end. Of the settings that could be tested, none moved this chance by more than 5 points.' });
    expect(five.reason).not.toContain(NO_DRIVER_REASON);
  });

  it('Codex r1 #3728: the sweep reads the Run’s own seed: its swing equals one worked out inline on that seed', () => {
    // PAIR(30) at the Run's seed 20261023 and 4,000 draws: c set to 10, 20 and 30 in turn, each simulated inline on the SAME
    // seed and draws; the swing is the highest chance less the lowest. Another seed draws e differently, so its swing differs.
    const at = (c: number) => simulate(model([fixed('c', c, 'tickets'), range('e', 15, 25, undefined, 'tickets', 'olumi_estimate'),
      def('total', 'sum', ['c', 'e'], 'tickets'), fixed('t', 30, 'tickets')], [goal('g', 'total', '>=', 't')], [option('plan', 'Plan')]),
      { seed: 20261023, draws: 4000 }).options[0]!.joint_within_limits as { chance: number };
    const chances = [at(10).chance, at(20).chance, at(30).chance];
    const swing = Number(((Math.max(...chances) - Math.min(...chances)) * 100).toFixed(1));
    expect(swing).toBeGreaterThan(45);
    expect(driver(present(PAIR(30), PAIR_LABELS, {}, 4000), 'plan').driver.swing_points).toBe(swing);
  });

  it('determinism: the same seed gives the same driver, settings and sentence', () => {
    const a = present(PAIR(30), PAIR_LABELS, {}, 4000), b = present(PAIR(30), PAIR_LABELS, {}, 4000);
    expect(driver(a, 'plan')).toEqual(driver(b, 'plan'));
    expect(JSON.stringify(a.options)).toBe(JSON.stringify(b.options));
    // A Run of 10,000 draws is swept on its first 4,000 (the probe machinery's count), never all of them.
    expect(driver(present(PAIR(30), PAIR_LABELS, {}, 10000), 'plan').driver.draws).toBe(4000);
  });

  it('none is licensed when no figure moves the chance by more than 5 points; over 5 points the largest swing is the driver', () => {
    expect(NO_DRIVER_REASON).toBe('Tested one at a time at each figure’s low end, middle and high end, no figure moved this chance by more than 5 points.');
    // Target 24 (hand-calculated): c at 10, 20, 30 gives P(e ≥ 14) = 98%, P(e ≥ 4) = 100%, 100%: 2 points. e at 15, 20, 25 gives
    // P(c ≥ 9) = 97%, P(c ≥ 4) = 99.7%, P(c ≥ −1) = 100%: 3 points. Neither is over 5.
    const none = present(PAIR(24), PAIR_LABELS, {}, 4000);
    expect(driver(none, 'plan')).toEqual({ kind: 'none_licensed', reason: NO_DRIVER_REASON });
    expect(JSON.stringify(none)).not.toContain('No single figure moves');
    // Target 30: c at 10, 20, 30 gives P(e ≥ 20) = 50%, P(e ≥ 10) = 99.97%, 100%: 50 points. e at 15, 20, 25 gives P(c ≥ 15) =
    // 81%, P(c ≥ 10) = 96%, P(c ≥ 5) = 99.5%: 19 points. c is the driver.
    const d = driver(present(PAIR(30), PAIR_LABELS, {}, 4000), 'plan');
    expect(d.kind).toBe('available');
    expect(d.driver.quantity).toBe('c');
    expect(d.driver.swing_points).toBeGreaterThan(45);
    expect(d.driver.swing_points).toBeLessThan(55);
    expect(d.driver.low.display).toMatch(/^about (4[89]|5[012])%$/);
    expect(d.driver.middle.display).toBe('more than 99%');
    expect(d.driver.high.display).toBe('more than 99%');
    expect(d.driver.draws).toBe(4000);
  });

  it('whose figure the driver is: Olumi’s estimate, the person’s range, or words not found in theirs', () => {
    const theirs = present(SPEC(range('c', 10, 30, undefined, 'tickets', 'person_range')), { ...SPEC_LABELS, c: person('Capacity per specialist') });
    expect(driver(theirs, 'add').driver.author).toBe('person');
    expect(driver(theirs, 'add').detail).toBe(SPEC_DETAIL('your range'));
    const unverified = present(SPEC(range('c', 10, 30, undefined, 'tickets', 'person_range')), { ...SPEC_LABELS, c: { label: 'Capacity per specialist', author: 'unverified' } });
    expect(driver(unverified, 'add').driver.author).toBe('unverified');
    expect(driver(unverified, 'add').detail).toContain('‘Capacity per specialist’ (not found in your words):');
  });

  it('a chance resting on no range says so; a withheld chance records no driver', () => {
    const fixedOnly = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(driver(fixedOnly, 'hold')).toEqual({ kind: 'none_licensed', reason: NO_RANGE_REASON });
    const m = model([fixed('revenue', 10, '£'), fixed('seats', 0, 'seats'), def('per_seat', 'ratio', ['revenue', 'seats'], '£/seat'), fixed('zero', 0, '£/seat')],
      [goal('g', 'per_seat', '>=', 'zero')], [option('hold', 'Hold')]);
    expect(driver(present(m, { revenue: person('Revenue'), seats: person('Seats'), per_seat: person('Revenue per seat', true), zero: person('Zero') }), 'hold')).toEqual({ kind: 'not_recorded' });
  });
});
