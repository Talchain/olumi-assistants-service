/**
 * present.ts rows. Every expected sentence and display is written out BY HAND from the model's own figures (deterministic
 * models, so each chance is exactly 0 or 1 and its display is the screen's edge words), never produced by calling the code
 * under test. Stochastic rows assert the labels and the invariance, not a sampled number.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, FixedAuthor, Goal, Limit, Option, Quantity, Reading, Withheld } from '../../executable.js';
import { simulate } from '../../simulate/simulate.js';
import { separated } from '../../simulate/paired.js';
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
const MRR_WORDS = '‘Monthly recurring revenue’ being at least £4,800 at 1 month from the start of this model';
const CUST_WORDS = '‘Customers’ being at least 90 customers at 1 month from the start of this model';
const EXACT = 'Simulation precision: exact. Every simulated draw gives the same result for this option, so no sampling is involved.';
// Lenses fit 2 (DL 23 Oct): an exact chance says the fixed value that makes it exact. Hold: £49 × 100 = £4,900 ≥ £4,800 and
// 100 ≥ 90 (both met, both named); Raise: 100 − 1.8 × 10 = 82 < 90 (the missed one is named; £59 × 82 = £4,838 is met).
const HOLD_WHY = 'Whatever the uncertain figures turn out to be, ‘Monthly recurring revenue’ is £4,900 at 1 month from the start of this model, at least £4,800 and ‘Customers’ is 100 customers at 1 month from the start of this model, at least 90 customers';
const RAISE_WHY = 'Whatever the uncertain figures turn out to be, ‘Customers’ is 82 customers at 1 month from the start of this model, below 90 customers';
const FORECAST_OR_VERDICT = /\b(will|win|wins|winner|best|recommend|recommended|should)\b|comes out on top/i;

describe('present: the canonical analysis view from a simulated model', () => {
  it('multiline labels, premises and approximate quotes stay readable on one line without rewriting their source', () => {
    const m = model([fixed('x', 2, 'tickets'), fixed('target', 1, 'tickets')], [goal('g', 'x', '>=', 'target')], [option('hold', 'Hold\n steady')]);
    const labels = { x: { ...person('Weekly\n capacity'), approximate: { quote: 'about\r\n two tickets' } }, target: person('Target') };
    const premise = { id: 'ready', text: 'Staff\n are trained.', author: 'person' as const, party: 'Our\n trainer', kind: 'condition' as const, confirmed: true };
    const before = JSON.stringify({ m, labels, premise });
    const v = present(m, labels, { goals: [{ goal_id: 'g', label: 'Capacity', status: 'calculable', reasons: [], asks: [], rests_on: [premise] }] });
    expect(v.goal_chance.chance_words).toBe('chance of ‘Weekly capacity’ being at least 1 ticket at 1 month from the start of this model');
    expect(cell(v, 'hold').face).toContain('Our trainer’s condition ‘Staff are trained’ is met');
    expect(cell(v, 'hold').face).toContain('you said ‘about two tickets’');
    expect(cell(v, 'hold').face).toContain('‘Hold steady’');
    expect(cell(v, 'hold').face).not.toMatch(/[\r\n]/);
    expect(v.goal_chance.chance_words).not.toMatch(/[\r\n]/);
    expect(JSON.stringify({ m, labels, premise })).toBe(before);
  });

  it('a later observation window counts from the model start for every state and flow reading, retaining each event and chance', () => {
    const horizons: { aggregation: Goal['aggregation']; state: string; flow: string; display: string }[] = [
      { aggregation: 'end', state: 'at 5 months', flow: 'in month 5', display: '0%' },
      { aggregation: 'sum', state: 'added up over months 3 to 5', flow: 'in total over months 3 to 5', display: '100%' },
      { aggregation: 'mean', state: 'on average at the ends of months 3 to 5', flow: 'on average per month over months 3 to 5', display: '0%' },
      { aggregation: 'max', state: 'at its highest at the ends of months 3 to 5', flow: 'in its highest month of months 3 to 5', display: '0%' },
      { aggregation: 'min', state: 'at its lowest at the ends of months 3 to 5', flow: 'in its lowest month of months 3 to 5', display: '0%' },
      { aggregation: 'every', state: 'at the end of every month from month 3 to month 5', flow: 'in every month from month 3 to month 5', display: '0%' },
    ];
    for (const row of horizons) for (const reading of ['state', 'flow'] as const) {
      // Period 0 stays the start: this window is months 3–5, never months 1–3 from the day it is read.
      // A fixed £2 meets £4 only when added across the three periods (£6); the other events remain below it.
      const m = model([fixed('x', 2, '£', reading), fixed('four', 4, '£')],
        [{ ...goal('g', 'x', '>=', 'four'), aggregation: row.aggregation, window: { start_period: 2, periods: 3 } }], [option('hold', 'Hold')]);
      m.periods = 5;
      const v = present(m, confirmedFigures(m));
      const horizon = `${row[reading]} from the start of this model${row.aggregation === 'sum' && reading === 'state' ? ', taking its level at the start of each month' : ''}`;
      const words = `‘x’ being at least £4 ${horizon}`;
      expect(v.goal_chance.chance_words).toBe(`chance of ${words}`);
      expect(cell(v, 'hold').face).toContain(`${words}, in this model. It rests on your figures.`);
      expect(cell(v, 'hold').display).toBe(row.display);
      expect(JSON.stringify(v)).not.toContain('from now');
    }
  });

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
      face: `‘Hold’: 100% chance of ${joint}, in this model. It rests on your figures. ${HOLD_WHY}.`,
      detail: { precision_95: [1, 1], draws: 200, precision_words: EXACT } });
    expect(cell(v, 'raise').face).toBe(`‘Raise to £59’: 0% chance of ${joint}, in this model. It rests on your figures. ${RAISE_WHY}.`);
  });

  it('(b) the basis: "on your figures" only when every input is the person’s; otherwise "if" with Olumi’s assumptions listed', () => {
    // (i) Olumi's own estimated range for the per-£ loss, −2.2 to −1.4 around −1.8 (W10: read as the range it falls in 8 times
    //     out of 10, a spread): conditional on Olumi's provisional reading of its own range, for every option and every target.
    const olumi = present(model(MRR_QUANTITIES(range('per_pound', -2.2, -1.4, -1.8, 'customers', 'olumi_estimate')), MRR_GOALS, MRR_OPTIONS),
      { ...MRR_LABELS, per_pound: { label: 'Customers lost per £1 of price rise', author: 'olumi' } });
    // W8 (c7.1): the reading is said in full once in the view (the first chance), and by its ends after.
    const reading = '‘Customers lost per £1 of price rise’ follows Olumi’s provisional reading of Olumi’s own estimated range, -2.2 to -1.4 customers';
    const conversion = `${reading}, as the range it falls in 8 times out of 10, with -1.8 customers as the middle value`;
    expect(cell(olumi, 'hold').face).toContain(`, in this model. It assumes ${conversion}.`);
    expect(cell(olumi, 'raise').face).toContain(`, in this model. It assumes ${reading}.`);
    for (const id of ['hold', 'raise']) expect(cell(olumi, id).face).not.toContain('on your figures');
    expect(olumi.goal_chance.targets.per_target[1].words).toContain(`${CUST_WORDS}, in this model, if ${reading}`);
    // (ii) The person's own range for the price: the ends are theirs, the reading is Olumi's provisional reading of them (W10).
    const theirs = present(model([...MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')).filter((x) => x.id !== 'price'),
      range('price', 39, 59, 49, '£', 'person_range')], MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(cell(theirs, 'hold').face).toContain(', in this model. It assumes ‘Price’ follows Olumi’s provisional reading of your range, £39 to £59, as the range it falls in 8 times out of 10, with £49 as the middle value.');
    // (iii) An option's own Olumi figure: only that option's chance is conditional on it; the target says which option.
    const own = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers'), fixed('price_59', 59, '£', 'state', 'olumi')), MRR_GOALS, MRR_OPTIONS),
      MRR_LABELS);
    expect(cell(own, 'hold').face.endsWith(`, in this model. It rests on your figures. ${HOLD_WHY}.`)).toBe(true);
    expect(cell(own, 'raise').face.endsWith(`, in this model. It assumes ‘New price’ is £59, Olumi’s figure. ${RAISE_WHY}.`)).toBe(true);
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
      words: '‘Specialist cost’ being at most £50,000 at 1 month from the start of this model, in this model, on your figures',
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
    const swapped = [['£39 to £59', '0.039 to 0.059 £k'], ['£39', '0.039 £k'], ['£59', '0.059 £k'], ['£5,000', '5 £k'], ['£1,100', '1.1 £k'], ['"value":39,', '"value":0.039,'], ['"value":59,', '"value":0.059,'],
      ['(£49)', '(0.049 £k)'], ['"value":49,', '"value":0.049,'], ['£49 as the middle value', '0.049 £k as the middle value']]
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

  it('a chance on fixed figures only names no driver (no range to test); no Run: currentness unknown', () => {
    const v = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(v.options.map((o: Rec) => o.main_driver)).toEqual([{ kind: 'none_licensed', reason: NO_RANGE_REASON }, { kind: 'none_licensed', reason: NO_RANGE_REASON }]);
    // W6: Hold meets both goals in every draw (100%, exact) and Raise misses one in every draw (0%, exact): no overlap, so the
    // words say which is most likely to achieve every goal together, both chances, the basis and that no figure has a range.
    expect(v.leader_licence).toBe('permitted');
    expect(v.leader).toEqual({ licence: 'permitted', option_id: null, goal_chance_leader: 'hold', similar_option_ids: [],
      words: 'In this model, ‘Hold’ is the option most likely to achieve every goal together: 100% chance, '
        + `against 0% for ‘Raise to £59’, the next most likely. It rests on your figures. ${NO_RANGE_REASON}` });
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
    expect(cell(limitOnly, 'hold').face).toBe(`‘Hold’: 100% chance of ${MRR_WORDS} and ${CUST_WORDS}, in this model. It rests on your figures. ${HOLD_WHY}. Not yet checked: ‘Overdraft’ — Its figure is unknown.`);
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
    expect(cell(plain, 'hold').face.endsWith(', in this model. It rests on your figures. Whatever the uncertain figures turn out to be, ‘year_total’ is £1,680 at 1 month from the start of this model, at most £2,400.')).toBe(true);
    // An effect whose size is Olumi's figure, and whose relation is Olumi's: both are listed, and nothing else.
    const withEffect = (relation_author?: 'person' | 'olumi') => {
      const m = bakery([fixed('base', 10, '£'), fixed('per_degree', -2, '£', 'state', 'olumi'),
        fixed('temperature', 1, 'degrees'), effect('weather', 'base', [{ coefficient: 'per_degree', driver: 'temperature' }], '£')], ['weather']);
      return present(m, { ...confirmedFigures(m), ...(relation_author === undefined ? {} : { weather: { label: 'weather', author: 'person', relation_author, confirmed: relation_author === 'person' } }) });
    };
    // Weather = 10 − 2 × 1 = £8, so (£140 + 0 + £8) × 12 = £1,776 in every draw: the basis, then why it is exact.
    const WHY = ' Whatever the uncertain figures turn out to be, ‘year_total’ is £1,776 at 1 month from the start of this model, at most £2,400.';
    const basis = (v: Rec): string => { const after = cell(v, 'hold').face.split(', in this model. ')[1] as string; expect(after.endsWith(WHY)).toBe(true); return after.slice(0, -WHY.length); };
    expect(basis(withEffect('olumi'))).toBe('It assumes ‘per_degree’ is -£2, Olumi’s figure. It also assumes ‘weather’ follows Olumi’s assumed relationship.');
    expect(basis(withEffect('person'))).toBe('It assumes ‘per_degree’ is -£2, Olumi’s figure.');
    // DL ruling: a relation with NO recorded author is listed as an assumption, never read as the person's.
    expect(basis(withEffect())).toBe('It assumes ‘per_degree’ is -£2, Olumi’s figure. It also assumes ‘weather’ follows a relationship (author not recorded).');
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
    expect(cell(v, 'hold').face).toBe('‘Hold’: 100% chance of ‘weather’ being at least £5 at 1 month from the start of this model, in this model. '
      + 'It assumes ‘per_degree’ is £2 (author not recorded). It also assumes ‘weather’ follows a relationship (author not recorded). Whatever the uncertain figures turn out to be, ‘weather’ is £12 at 1 month from the start of this model, at least £5.');
    expect(JSON.stringify(v)).not.toContain('on your figures');
    // Contrast: the same model with both authors recorded as the person's reads "on your figures".
    const own = present(m(fixed('per_degree', 2, '£')), { ...confirmedFigures(m(fixed('per_degree', 2, '£'))), weather: { label: 'weather', author: 'person', relation_author: 'person', confirmed: true } });
    expect(cell(own, 'hold').face.endsWith(', in this model. It rests on your figures. Whatever the uncertain figures turn out to be, ‘weather’ is £12 at 1 month from the start of this model, at least £5.')).toBe(true);
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
    const l50 = '‘Specialist cost’ is at most £50,000 at 1 month from the start of this model', l30 = '‘Specialist cost’ is at most £30,000 at 1 month from the start of this model';
    const unchecked = 'Not yet checked: ‘Desk space’ — waits on ‘Desks free’';
    expect(cell(v, 'hold').face).toContain(` Each limit on its own: ${l50}: 100%; ${l30}: 100%. ${unchecked}`);
    expect(cell(v, 'add').face).toContain(` Each limit on its own: ${l50}: 100%; ${l30}: 0%. ${unchecked}`);
    // Add's 0% is exact, and the limit that fixes it is named with its value: 1 × £40,000 = £40,000 > £30,000.
    expect(cell(v, 'add').face).toContain('. Whatever the uncertain figures turn out to be, ‘Specialist cost’ is £40,000 at 1 month from the start of this model, above £30,000. Each limit on its own:');
    expect(v.goal_chance.limits).toEqual([
      { constraint_id: 'l50', words: l50, options: [{ option_id: 'hold', display: '100%' }, { option_id: 'add', display: '100%' }] },
      { constraint_id: 'l30', words: l30, options: [{ option_id: 'hold', display: '100%' }, { option_id: 'add', display: '0%' }] }]);
    expect(v.goal_chance.unchecked_limits).toEqual([{ limit_id: 'l_desks', words: '‘Desk space’ — waits on ‘Desks free’' }]);
    expect(v.goal_chance.notes).toContain(`${unchecked}.`);
  });

  it('S1 strip (A25 off): a figure is the person\u2019s as the AI labels it, so it is "on your figures"; there is no "not found in your words"', () => {
    // Weather = 10 + 2 × 1 = £12 ≥ £5 (exact). The coefficient is the person's by its label: no quote check outranks it.
    const m = model([fixed('base', 10, '£'), fixed('per_degree', 2, '£'), fixed('temperature', 1, 'degrees'),
      effect('weather', 'base', [{ coefficient: 'per_degree', driver: 'temperature' }], '£'), fixed('floor', 5, '£')],
    [{ ...goal('g', 'weather', '>=', 'floor'), label: 'Weather takings' }], [option('hold', 'Hold')]);
    const relation = { ...confirmedFigures(m), weather: { label: 'weather', author: 'person' as const, relation_author: 'person' as const, confirmed: true } };
    const face = cell(present(m, { ...relation, per_degree: person('per_degree') }), 'hold').face;
    expect(face).toContain(', in this model. It rests on your figures. ');
    expect(face).not.toContain('not found in your words');
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
    // W8 (c7.3): the unit as a person writes it, never "ticket / week".
    expect(cell(v, 'keep').face.endsWith('. Whatever the uncertain figures turn out to be, ‘Weekly support capacity’ is 80 tickets per week at 1 month from the start of this model, below 100 tickets per week.')).toBe(true);
    const far = present(capacity(200), labels);
    expect(cell(far, 'add').display).toBe('less than 1%');
    expect(cell(far, 'add').detail.precision_95[0]).toBeCloseTo(0, 12);
    expect(cell(far, 'add').detail.precision_95[1]).toBeGreaterThan(0);
    expect(cell(far, 'add').detail.precision_words).toMatch(/^Simulation precision: 0% to [0-9.]+%, from 200 simulated draws\./);
    expect(cell(far, 'add').face).not.toContain('Whatever the uncertain figures turn out to be, ');
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
// c + e ≥ target: c is Olumi's 10 to 30, e Olumi's 15 to 25, both centred on 20; W10 reads each as the range it falls in 8 times
// out of 10: sd 10/1.2815516 = 7.8030 and 5/1.2815516 = 3.9015.
const PAIR = (target: number) => model([range('c', 10, 30, undefined, 'tickets', 'olumi_estimate'), range('e', 15, 25, undefined, 'tickets', 'olumi_estimate'),
  def('total', 'sum', ['c', 'e'], 'tickets'), fixed('t', target, 'tickets')], [goal('g', 'total', '>=', 't')], [option('plan', 'Plan')]);
const PAIR_LABELS: Record<string, PresentQuantity> = { c: { label: 'Capacity per specialist', author: 'olumi' }, e: { label: 'Extra capacity', author: 'olumi' },
  total: person('Total capacity', true), t: person('Capacity target') };
const driver = (v: Rec, id: string): Rec => v.options.find((o: Rec) => o.option_id === id).main_driver;
// W8 (c7.6): the three settings, then why the overall chance can sit far from any one of them, said once.
const SPEC_DETAIL = (whose: string) => `In this model, of the figures tested one at a time, the chance is most sensitive to ‘Capacity per specialist’ (${whose}). `
  + 'With ‘Capacity per specialist’ held at its low end (10 tickets), the chance is less than 1%; at its middle (20 tickets), more than 99%; at its high end (30 tickets), more than 99%. '
  + 'Each of these holds ‘Capacity per specialist’ at one value. The overall chance, about 70%, allows for every value it can take.';
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
  it('tests and reports only settings inside a declared domain, retaining the stated range in the model', () => {
    const x: Quantity = { ...range('x', -0.2, 1.2, undefined, '1', 'olumi_estimate'),
      dist: { kind: 'range', low: -0.2, high: 1.2, basis: 'olumi_estimate', range_kind: 'plausible', domain: { min: 0, max: 1 } } };
    const m = model([x, fixed('target', 0.8, '1')], [goal('g', 'x', '>=', 'target')], [option('hold', 'Hold')]);
    const v = present(m, { x: { label: 'Sell-through', author: 'olumi', shown_in: { unit: '%', factor: 0.01 } }, target: person('Target') });
    const d = driver(v, 'hold');
    // The permissible settings are 0%, 50%, 100%. Only 100% meets the 80% target, exactly, with no other uncertainty.
    expect(d.kind).toBe('available');
    expect(d.driver.low).toEqual({ value: 0, display: '0%' });
    expect(d.driver.middle).toEqual({ value: 0.5, display: '0%' });
    expect(d.driver.high).toEqual({ value: 1, display: '100%' });
    expect(d.detail).toContain('held at its low end (0%), the chance is 0%; at its middle (50%), 0%; at its high end (100%), 100%');
    expect(x.dist).toMatchObject({ low: -0.2, high: 1.2, domain: { min: 0, max: 1 } });
  });

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
      detail: 'In this model, of the figures tested one at a time, the chance is most sensitive to ‘Tickets sold’ (Olumi’s estimate). With ‘Tickets sold’ held at its low end (0 tickets), the chance is 0%; at its middle (5 tickets), 100%; at its high end (10 tickets), 0%. Each of these holds ‘Tickets sold’ at one value. The overall chance, about 25%, allows for every value it can take.' });
  });

  it('buddy #3728: a ranged start delay is a driver (a set’s timing), and so is a ranged risk delay; both are in the basis too', () => {
    // Hire: capacity 80, plus 30 from month ceil(delay). At the end of month 6: delay 2 or 6 starts in time (110 ≥ 100, exact);
    // 10 does not (80). Carry on: 110, less 50 from month ceil(delay) when the outage fires (it always does): delay 2 or 6, 60;
    // 10, 110. The outage is a risk, so its chances are sampled: "less than 1%" and "more than 99%".
    const labels = { delay: { label: 'Start delay', author: 'olumi' as const }, base: person('Tickets today'), capacity: person('Weekly capacity', true), target: person('Target') };
    const hire = present(timed('set'), labels);
    expect(driver(hire, 'hire')).toEqual({ kind: 'available',
      driver: { quantity: 'delay', author: 'olumi', low: { value: 2, display: '100%' }, middle: { value: 6, display: '100%' }, high: { value: 10, display: '0%' }, swing_points: 100, draws: 200, untested: [] },
      detail: 'In this model, of the figures tested one at a time, the chance is most sensitive to ‘Start delay’ (Olumi’s estimate). With ‘Start delay’ held at its low end (2 months), the chance is 100%; at its middle (6 months), 100%; at its high end (10 months), 0%. Each of these holds ‘Start delay’ at one value. The overall chance, about 50%, allows for every value it can take.' });
    // Codex B1 on #3801: the floor of 0 cuts into the lower tail (σL = 4/1.2815516 = 3.12122, a = −6/3.12122 = −1.92232:
    // ½ × (0.1 − Φ(a))/(½ − Φ(a)) = 0.0769 below 2, not 1 in 10), so no frequency is said; the middle value stays the median.
    expect(cell(hire, 'hire').face).toContain('‘Start delay’ follows Olumi’s provisional reading of Olumi’s own estimated range, 2 to 10 months, '
      + 'with 6 months as the middle value, kept to Olumi’s reading of what it can be (never below 0 months)');
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
    expect(fifteen.detail).toBe('In this model, of the figures tested one at a time, the chance is most sensitive to ‘Batches’ (Olumi’s estimate). With ‘Batches’ held at its low end (0 tickets), the chance could not be worked out; at its middle (5 tickets), more than 99%; at its high end (10 tickets), less than 1%. Each of these holds ‘Batches’ at one value. The overall chance, about 55%, allows for every value it can take.');
    const five = driver(present(ratio(5), labels), 'plan');
    expect(five).toEqual({ kind: 'none_licensed', reason: '‘Batches’ could not be tested at its low end. Of the settings that could be tested, none moved this chance by more than 5 points.' });
    expect(five.reason).not.toContain(NO_DRIVER_REASON);
  });

  it('Codex r2 numbers#2 (6), spec §3.7: a chance drawn within Olumi’s floor is said kept to that floor, and swept only within it', () => {
    // Capacity 110, less 50 when the outage happens; the target is 100, so the goal is met exactly when it does not happen. Its
    // chance is Olumi's 10 % to 60 % with Olumi's floor of 20 % (as the compiler gives it: the floor and a chance's 0 to 1): drawn
    // within 20 % to 100 %, so said kept to "0.2 to 1", never "0 to 1"; its stated low end, 0.1, is past that floor, so W10 says
    // only that it is never below 0.2 (no 1-in-10 or middle value is claimed where an end lies past an edge). The sweep sets it at the low end, middle and high end of
    // what it is drawn within, 0.2, 0.4 and 0.6 (chances about 80 %, 60 % and 40 %), never at 0.1, which it can never be.
    const within = { min: 0.2, max: 1 };
    const m = { periods: 1, period_unit: 'month', withheld: [], limits: [],
      quantities: [fixed('base', 110, 'tickets'), fixed('loss', -50, 'tickets'), fixed('target', 100, 'tickets'),
        { id: 'p', label: 'p', unit: '', reading: 'state', domain: within, dist: { kind: 'range', low: 0.1, high: 0.6, basis: 'olumi_estimate', range_kind: 'plausible', domain: within } }],
      goals: [goal('g', 'base', '>=', 'target')], options: [option('plan', 'Plan')],
      risks: [{ id: 'outage', occurrence: 'p', severity: 'loss', effect_on: 'base', mode: 'add', from_period: 0 }] } as unknown as ExecutableModel;
    const v = present(m, { p: { label: 'Outage chance', author: 'olumi' }, base: person('Capacity'), loss: person('Loss'), target: person('Target') });
    expect(cell(v, 'plan').face).toContain('‘Outage chance’ follows Olumi’s provisional reading of Olumi’s own estimated range, 0.1 to 0.6, as never below 0.2, '
      + 'kept to Olumi’s reading of what it can be (0.2 to 1)');
    const d = driver(v, 'plan');
    expect(d.kind).toBe('available');
    expect([d.driver.quantity, d.driver.low.value, d.driver.middle.value, d.driver.high.value]).toEqual(['p', 0.2, 0.4, 0.6]);
    expect(d.driver.untested).toEqual([]);
    expect(d.detail).toContain('held at its low end (0.2)');
    expect(d.detail).not.toContain('0.1');
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
    // W10 (adopted; the wider plausible reading moved the old targets 24 and 30, whose hand values were for the √12 law):
    // Target 20 (hand-calculated): c at 10, 20, 30 gives P(e ≥ 10) = Φ(10/3.9015 = 2.5631) = 99.5%, P(e ≥ 0) = 100%, 100%:
    // 0.5 points. e at 15, 20, 25 gives P(c ≥ 5) = Φ(15/7.8030 = 1.9223) = 97.3%, P(c ≥ 0) = Φ(2.5631) = 99.5%, P(c ≥ −5) =
    // Φ(3.2039) = 99.9%: 2.7 points. Neither is over 5.
    const none = present(PAIR(20), PAIR_LABELS, {}, 4000);
    expect(driver(none, 'plan')).toEqual({ kind: 'none_licensed', reason: NO_DRIVER_REASON });
    expect(JSON.stringify(none)).not.toContain('No single figure moves');
    // Target 28: c at 10, 20, 30 gives P(e ≥ 18) = Φ(2/3.9015 = 0.5126) = 69.6%, P(e ≥ 8) = Φ(3.0757) = 99.9%, P(e ≥ −2) = 100%:
    // 30.4 points. e at 15, 20, 25 gives P(c ≥ 13) = Φ(7/7.8030 = 0.8971) = 81.5%, P(c ≥ 8) = Φ(1.5379) = 93.8%, P(c ≥ 3) =
    // Φ(2.1786) = 98.5%: 17.0 points. c is the driver (on 4,000 draws each chance is within about ±1.5 points).
    const d = driver(present(PAIR(28), PAIR_LABELS, {}, 4000), 'plan');
    expect(d.kind).toBe('available');
    expect(d.driver.quantity).toBe('c');
    expect(d.driver.swing_points).toBeGreaterThan(25);
    expect(d.driver.swing_points).toBeLessThan(35);
    expect(d.driver.low.display).toMatch(/^about (6[89]|7[01])%$/);
    expect(d.driver.middle.display).toBe('more than 99%');
    expect(d.driver.high.display).toBe('more than 99%');
    expect(d.driver.draws).toBe(4000);
  });

  it('whose figure the driver is: Olumi’s estimate or the person’s range, by the range\'s own basis (S1 strip: no "not found in your words")', () => {
    const theirs = present(SPEC(range('c', 10, 30, undefined, 'tickets', 'person_range')), { ...SPEC_LABELS, c: person('Capacity per specialist') });
    expect(driver(theirs, 'add').driver.author).toBe('person');
    expect(driver(theirs, 'add').detail).toBe(SPEC_DETAIL('your range'));
    expect(driver(theirs, 'add').detail).not.toContain('not found in your words');
  });

  it('a chance resting on no range says so; a withheld chance records no driver', () => {
    const fixedOnly = present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS);
    expect(driver(fixedOnly, 'hold')).toEqual({ kind: 'none_licensed', reason: NO_RANGE_REASON });
    const m = model([fixed('revenue', 10, '£'), fixed('seats', 0, 'seats'), def('per_seat', 'ratio', ['revenue', 'seats'], '£/seat'), fixed('zero', 0, '£/seat')],
      [goal('g', 'per_seat', '>=', 'zero')], [option('hold', 'Hold')]);
    expect(driver(present(m, { revenue: person('Revenue'), seats: person('Seats'), per_seat: person('Revenue per seat', true), zero: person('Zero') }), 'hold')).toEqual({ kind: 'not_recorded' });
  });
});

describe('present: which option is most likely to achieve the goal, in this model (W6, Paul 6 and 14 Oct)', () => {
  // Never a choice made for the person, a superlative or a win share; "too close to call" is a finding, not a refusal.
  const FORBIDDEN = /\b(best|winner|wins?|recommend\w*|should|go with)\b|comes out on top/i;
  /** SPEC with its capacity target moved: Add one specialist meets it when 80 + d + c reaches the target, Keep never does. */
  const HIRE = (target: number) => {
    const m = SPEC(range('c', 10, 30, undefined, 'tickets', 'olumi_estimate'));
    return { ...m, quantities: m.quantities.map((x) => (x.id === 'target' ? fixed('target', target, 'tickets') : x)) };
  };
  /** The basis both chances rest on: the person's day-to-day range and Olumi's own range for the capacity per specialist. */
  /** W8 (c7.1): by the time the leader is said, each range's reading has been said in full with the first chance. */
  const HIRE_BASIS = 'if ‘Day-to-day variation’ follows Olumi’s provisional reading of your range, -0.1 to 0.1 tickets '
    + 'and ‘Capacity per specialist’ follows Olumi’s provisional reading of Olumi’s own estimated range, 10 to 30 tickets';
  /** W8 (c7.1): the leader names what its chance is most sensitive to; the settings are said once, with the option's chance. */
  const DRIVER_C = 'Its chance is most sensitive to ‘Capacity per specialist’ (Olumi’s estimate).';

  it('a clear leader: the highest chance, apart from the next by more than the simulation precision, is named with both chances, the basis and its driver', () => {
    // Target 95: Add meets it when c ≥ 15 − d; c is read as 10 to 30 eight times out of 10 (W10: median 20, sd 10/1.2815516 =
    // 7.8030), so about Φ(5/7.8030 = 0.6408) = 73.9% (on 2,000 draws within about ±2 points; before W10, 81%).
    // Keep is 80 + d (d within ±0.1): below 95 in every draw, sampled (d is drawn), so "less than 1%". The intervals are far apart.
    const v = present(HIRE(95), SPEC_LABELS, {}, 2000);
    const add = cell(v, 'add'), keep = cell(v, 'keep');
    expect(add.display).toMatch(/^about (7[0-8])%$/);
    expect(keep.display).toBe('less than 1%');
    expect(v.leader_licence).toBe('permitted');
    expect(v.leader).toEqual({ licence: 'permitted', option_id: null, goal_chance_leader: 'add', similar_option_ids: [], words: expect.any(String) });
    // At c = 10, 20, 30 the chance is P(d ≥ 5) = 0, P(d ≥ −5) = 1, 1: the driver's own three settings, as the cell's detail says them.
    expect(v.leader.words).toBe(`In this model, ‘Add one specialist’ is the option most likely to achieve the goal: ${add.display} chance, `
      + 'against less than 1% for ‘Keep’, the next most likely. Like each option’s chance, it rests on the assumptions listed with it. '
      + DRIVER_C);
    expect(driver(v, 'add').detail).toContain('the chance is less than 1%; at its middle (20 tickets), more than 99%; at its high end (30 tickets), more than 99%.');
    expect(v.leader.words).not.toContain('more likely to miss');
  });

  it('a clear leader that is still more likely to miss the goal says so', () => {
    // Target 105: Add needs c ≥ 25 − d, about 1 − Φ(0.6408) = 26.1% (W10; before it, 19%), its interval wholly below 50%; Keep
    // is still less than 1%.
    const v = present(HIRE(105), SPEC_LABELS, {}, 2000);
    expect(cell(v, 'add').display).toMatch(/^about (2[2-9]|30)%$/);
    expect(v.leader.goal_chance_leader).toBe('add');
    expect(v.leader.words).toContain('against less than 1% for ‘Keep’, the next most likely. ');
    expect(v.leader.words).toContain('. Even so, in this model it is more likely to miss the goal than to meet it. Its chance is most sensitive to');
  });

  it('options the shared draws cannot separate are too close to call, each chance said, no option named; the words say what was tested (SC2)', () => {
    // Hold meets 5 when x ≥ 5 (50%); Nudge when its own count y ≥ 4.8 (W10: Φ(0.2/3.9015 = 0.0513) ≈ 52%). x and y are drawn
    // separately, so on 200 draws the paired gap's precision is about ±10 points: the shared draws cannot separate them.
    const v = present(INDEP(0.2), INDEP_LABELS);
    const hold = cell(v, 'hold'), nudge = cell(v, 'nudge');
    expect(v.leader_licence).toBe('withheld');
    expect(v.leader).toMatchObject({ licence: 'withheld', option_id: null, goal_chance_leader: null, similar_option_ids: ['hold', 'nudge'] });
    expect(v.leader.words.startsWith(`In this model, ‘Hold’ (${hold.display}) and ‘Nudge’ (${nudge.display}) are too close to call: for their chances of `
      + '‘Total’ being at least 5 tickets at 1 month from the start of this model, the simulation cannot tell them apart on its shared draws, ')).toBe(true);
    // Contrast: NUDGE shares x, so Nudge meets the target wherever Hold does. Its two intervals overlap just as much, yet the
    // shared draws separate them, so (the 10-point gate off, S1) Nudge is named, and the words never say "cannot tell".
    const coupled = present(NUDGE(0.2), NUDGE_LABELS);
    expect(cell(coupled, 'hold').detail.precision_95[0]).toBeLessThanOrEqual(cell(coupled, 'nudge').detail.precision_95[1]);
    expect([coupled.leader_licence, coupled.leader.goal_chance_leader]).toEqual(['permitted', 'nudge']);
    expect(coupled.leader.words).not.toMatch(/cannot tell/);
  });

  // ── W6 review B1: the estate's three science conditions (goal-chance-licence.ts:891), all on the DISPLAYED chances ──────
  /** Total = x + extra, x the person's 0 to 10 (W10: median 5, sd 3.9015); Nudge adds `by`. */
  const NUDGE = (by: number, target = 5) => model([range('x', 0, 10, undefined, 'tickets', 'person_range'), fixed('extra', 0, 'tickets', 'state', 'structure'), fixed('tiny', by, 'tickets'),
    def('total', 'sum', ['x', 'extra'], 'tickets'), fixed('t', target, 'tickets')], [goal('g', 'total', '>=', 't')],
  [option('hold', 'Hold'), option('nudge', 'Nudge', [{ quantity: 'extra', to: 'tiny', from_period: 0 }])]);
  const NUDGE_LABELS = { x: person('Tickets'), extra: { label: 'Extra', author: 'structure' as const }, tiny: person('Nudge size'), total: person('Total', true), t: person('Target') };
  /** As NUDGE, but Nudge reads its own count ‘y’ (the same 0 to 10, drawn separately): the options share no draw of what decides them. */
  const INDEP = (by: number) => model([range('x', 0, 10, undefined, 'tickets', 'person_range'), range('y', 0, 10, undefined, 'tickets', 'person_range'),
    def('base', 'sum', ['x'], 'tickets'), fixed('extra', 0, 'tickets', 'state', 'structure'), fixed('tiny', by, 'tickets'),
    def('total', 'sum', ['base', 'extra'], 'tickets'), fixed('t', 5, 'tickets')], [goal('g', 'total', '>=', 't')],
  [option('hold', 'Hold'), option('nudge', 'Nudge', [{ quantity: 'base', to: 'y', from_period: 0 }, { quantity: 'extra', to: 'tiny', from_period: 0 }])]);
  const INDEP_LABELS = { ...NUDGE_LABELS, y: person('Second count'), base: person('Counted', true) };
  const pctOf = (display: string): number => (display === 'less than 1%' ? 0 : display === 'more than 99%' ? 100 : Number(display.replace(/^about /, '').replace('%', '')));

  it('S1 strip (the 1% gate off): a leading chance displayed under 1% whose precision interval is apart from the next names that option, and says it is more likely to miss', () => {
    // Target 120 (W10: at the old 115, Add's 1 − Φ(15/7.8030) = 2.7% is no longer under 1%): Add needs c ≥ 40 − d, c read as
    // 10 to 30 eight times out of 10 (median 20, sd 7.8030): 1 − Φ(20/7.8030 = 2.5631) = 0.52% (table Φ(2.56) = 0.99477,
    // Φ(2.57) = 0.99492), shown "less than 1%"; Keep (80 + d) never reaches it. On 10,000 draws Add's interval (about 52
    // draws) sits above Keep's (none): the difference is real in this model, so Add is named (only the interval condition stands).
    const v = present(HIRE(120), SPEC_LABELS, {}, 10_000);
    const add = cell(v, 'add'), keep = cell(v, 'keep');
    expect([add.display, keep.display]).toEqual(['less than 1%', 'less than 1%']);
    expect(add.detail.precision_95[0]).toBeGreaterThan(keep.detail.precision_95[1]);
    expect(v.leader_licence).toBe('permitted');
    expect(v.leader.goal_chance_leader).toBe('add');
    expect(v.leader.words.startsWith('In this model, ‘Add one specialist’ is the option most likely to achieve the goal: less than 1% chance, against less than 1% for ‘Keep’')).toBe(true);
    expect(v.leader.words).toContain('Even so, in this model it is more likely to miss the goal than to meet it.');
    expect(v.leader.words).not.toContain('no option is likely');
  });

  it('S1 strip (the 10-point gate off): a displayed gap under 10 points with distinct precision intervals names the leader (the probe "about 54% against about 50%")', () => {
    // Nudge adds 0.5: P(x ≥ 4.5) = Φ(0.5 / 3.9015) = Φ(0.1282) ≈ 55% against P(x ≥ 5) = 50% (W10; before it, 57%); on 10,000
    // draws each interval is about ±1 point.
    const v = present(NUDGE(0.5), NUDGE_LABELS, {}, 10_000);
    const hold = cell(v, 'hold'), nudge = cell(v, 'nudge');
    expect(nudge.detail.precision_95[0]).toBeGreaterThan(hold.detail.precision_95[1]);
    expect(pctOf(nudge.display) - pctOf(hold.display)).toBeGreaterThan(0);
    expect(pctOf(nudge.display) - pctOf(hold.display)).toBeLessThan(10);
    expect(v.leader_licence).toBe('permitted');
    expect(v.leader.goal_chance_leader).toBe('nudge');
    expect(v.leader.words.startsWith(`In this model, ‘Nudge’ is the option most likely to achieve the goal: ${nudge.display} chance, against `)).toBe(true);
    expect(v.leader.words).not.toContain('points apart');
    // Contrast: Nudge adds 3, P(x ≥ 2) = Φ(3/3.9015) = Φ(0.7689) ≈ 78% against 50% (W10; before it, 85%): distinct, so it is named too.
    const apart = present(NUDGE(3), NUDGE_LABELS, {}, 10_000);
    expect(apart.leader_licence).toBe('permitted');
    expect(apart.leader.goal_chance_leader).toBe('nudge');
    expect(apart.leader.words.startsWith(`In this model, ‘Nudge’ is the option most likely to achieve the goal: ${cell(apart, 'nudge').display} chance, against `)).toBe(true);
  });

  it('B2: while a limit is not yet checked no option is named; the words say why, with each chance', () => {
    // The same clear leader as above (74% against less than 1%), with a budget limit waiting on the specialist's cost.
    const limits = [{ limit_id: 'cost', label: 'Within budget', status: 'asks' as const, reasons: ['It needs the cost.'], asks: ['price'] }];
    const v = present(HIRE(95), SPEC_LABELS, { limits, asks: [{ quantity_id: 'price', label: 'Specialist cost', unit: '£' }] }, 2000);
    const add = cell(v, 'add');
    expect(add.face).toContain(' Not yet checked: ‘Within budget’ — waits on ‘Specialist cost’.');
    expect(v.leader_licence).toBe('withheld');
    expect(v.leader).toEqual({ licence: 'withheld', option_id: null, goal_chance_leader: null, similar_option_ids: [],
      words: 'In this model, which option is most likely to achieve the goal is not said yet, as a limit is not yet checked and these chances leave it out: '
        + `the chance of ‘Weekly capacity’ being at least 95 tickets at 1 month from the start of this model is less than 1% for ‘Keep’ and ${add.display} for ‘Add one specialist’, `
        + `${HIRE_BASIS}. Not yet checked: ‘Within budget’ — waits on ‘Specialist cost’.` });
    // Contrast: the same model with every limit checked names ‘Add one specialist’.
    expect(present(HIRE(95), SPEC_LABELS, {}, 2000).leader.goal_chance_leader).toBe('add');
  });

  it('B3: a Run known not to be current names no leader; the same Run, current, does', () => {
    const run = { run_id: 'r1', graph_hash_at_run: 'h1', computed_at: '2026-10-23T12:00:00Z' };
    const stale = present(HIRE(95), SPEC_LABELS, { run, current: false }, 2000), current = present(HIRE(95), SPEC_LABELS, { run, current: true }, 2000);
    expect([stale.staleness.stale, Object.hasOwn(stale, 'leader'), stale.leader_licence]).toEqual([true, false, 'withheld']);
    expect([current.staleness.stale, current.leader.goal_chance_leader, current.leader_licence]).toEqual([false, 'add', 'permitted']);
  });

  it('one option, or a chance not shown: no leader at all', () => {
    const both = present(HIRE(95), SPEC_LABELS, {}, 2000);
    const single = present({ ...HIRE(95), options: [option('add', 'Add one specialist', [{ quantity: 'added', to: 'one', from_period: 0 }])] }, SPEC_LABELS, {}, 2000);
    expect(Object.hasOwn(both, 'leader')).toBe(true); // contrast: the same model with both options names one
    expect(Object.hasOwn(single, 'leader')).toBe(false);
    expect(single.leader_licence).toBe('withheld');
    // A goal waiting on an answer withholds every chance: nothing to compare.
    const waiting = present(HIRE(95), SPEC_LABELS, { goals: [{ goal_id: 'g', label: 'Capacity', status: 'asks', reasons: ['It needs your answer.'], asks: ['c'] }] }, 2000);
    expect(cell(waiting, 'add').kind).toBe('withheld');
    expect(Object.hasOwn(waiting, 'leader')).toBe(false);
    expect(waiting.leader_licence).toBe('withheld');
  });

  it('the negative (science session, 26 Oct; SC2): the words say the simulation cannot tell options apart only where its shared draws cannot', () => {
    const gap = (m: ExecutableModel, draws: number) => simulate(m, { seed: 20261023, draws }).paired[0]!.joint_within_limits;
    // Positive control: drawn separately (INDEP), the shared draws do not separate the options, and the words say so.
    expect(separated(gap(INDEP(0.2), 200))).toBe(false);
    expect(present(INDEP(0.2), INDEP_LABELS).leader.words).toContain(', the simulation cannot tell them apart on its shared draws, ');
    // Every other form never says it: overlapping intervals that the shared draws separate (NUDGE 0.2 on 200 draws), a gap
    // under 10 points, under 1%, a limit not yet checked, and a named leader.
    expect(separated(gap(NUDGE(0.2), 200))).toBe(true);
    const views = [present(NUDGE(0.2), NUDGE_LABELS), present(NUDGE(0.5), NUDGE_LABELS, {}, 10_000), present(HIRE(120), SPEC_LABELS, {}, 10_000), present(HIRE(95), SPEC_LABELS, {}, 2000),
      present(HIRE(95), SPEC_LABELS, { limits: [{ limit_id: 'cost', label: 'Within budget', status: 'asks', reasons: ['It needs the cost.'], asks: ['price'] }],
        asks: [{ quantity_id: 'price', label: 'Specialist cost', unit: '£' }] }, 2000)];
    expect(views.filter((v) => typeof v.leader?.words === 'string')).toHaveLength(views.length);
    for (const v of views) expect(v.leader.words).not.toMatch(/cannot tell/i);
  });

  it('the negative: no words anywhere choose for the person, use a superlative or call a share a chance', () => {
    const views = [present(HIRE(95), SPEC_LABELS, {}, 2000), present(HIRE(105), SPEC_LABELS, {}, 2000),
      present(model(MRR_QUANTITIES(fixed('per_pound', -1.8, 'customers')), MRR_GOALS, MRR_OPTIONS), MRR_LABELS),
      present(model(MRR_QUANTITIES(range('per_pound', -2.2, -1.4, -1.8, 'customers', 'olumi_estimate')), MRR_GOALS, MRR_OPTIONS),
        { ...MRR_LABELS, per_pound: { label: 'Customers lost per £1 of price rise', author: 'olumi' } }),
      // W6 review: each withheld form (under 1%, too close to call, a limit not yet checked) is held to the same negative.
      present(HIRE(120), SPEC_LABELS, {}, 10_000), present(NUDGE(0.5), NUDGE_LABELS, {}, 10_000),
      present(HIRE(95), SPEC_LABELS, { limits: [{ limit_id: 'cost', label: 'Within budget', status: 'asks', reasons: ['It needs the cost.'], asks: ['price'] }],
        asks: [{ quantity_id: 'price', label: 'Specialist cost', unit: '£' }] }, 2000)];
    expect(views.filter((v) => v.leader !== undefined)).toHaveLength(views.length);
    for (const v of views) {
      expect(v.leader.words).not.toMatch(FORBIDDEN);
      expect(v.leader.words).not.toMatch(/\bwin share\b|\bon top\b|\bof runs\b/i);
      expect(JSON.stringify(v)).not.toMatch(FORBIDDEN);
    }
  });
});
