/**
 * HIGH: the goal card gets today's exact level, not an option's future result or a range's centre.
 * Hand calculation: 125 + [0,35] × 0 + [0,3] × 0 = 125 orders/week today, without choosing either uncertain effect.
 * A fixed 25 × 1 would give 150; a ranged effect × 1 has no exact initial point. Reverting the zero rule makes 125 RED.
 * Mutants: use the first option; substitute a ranged input's centre; stamp the derived value as a person's;
 * forget the % conversion; use the stock's first update; default an unanswered window; flatten an event's window.
 * These are synthetic production-path rows, not provider/held-out briefs. DL owns their execution.
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalModelT, CanonicalQuantityT } from '../canonical.js';
import { compile } from '../compile.js';
import { project } from '../project.js';
import { exactInitialValues } from '../simulate/simulate.js';

const record = { party: null, approval: 'approved' as const, author_id: null };
const bounds = { floor: null, ceiling: null };
const quantity = (id: string, unit: string, value: number | null, patch: Partial<CanonicalQuantityT> = {}): CanonicalQuantityT => ({
  id, label: id, unit, value, kind: 'fact', status: 'known', low: null, high: null, range_kind: null,
  question: null, basis: null, direction: null, author: 'person', quote: `${id}: ${value} ${unit}`,
  ...record, ...bounds, ...patch,
});
function scenario(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'How could we reach 150 orders a week?', period: 'month',
    quantities: [
      quantity('base', 'order/week', 125), quantity('gain', 'order/week', 25, { kind: 'coefficient' }),
      quantity('switch', '1', 0, { author: 'structure', quote: null, basis: 'No change before an option.' }),
      quantity('one', '1', 1, { author: 'structure', quote: null, basis: 'The option is on.' }),
      quantity('orders', 'order/week', null, { status: 'derived', kind: 'derived', author: 'olumi', quote: null }),
      quantity('target', 'order/week', 150), quantity('window', 'month', 3),
    ],
    relations: [{ id: 'orders_from_change', form: 'effect', defines: 'orders', base: 'base',
      terms: [{ driver: 'switch', coefficient: 'gain', ...record, author: 'person', quote: 'Each change adds 25 orders a week.' }],
      ...record, author: 'person', quote: 'Orders are the base plus the change.' }],
    goals: [{ id: 'goal', label: 'Reach 150 orders a week', question: null, ...record, author: 'person', quote: 'Reach 150 orders a week in 3 months.',
      measure: { quantity: 'orders', per: null, cmp: '>=', target: 'target', frame: 'level', reference: null, aggregation: 'end',
        window: { origin_event: null, origin_offset: null, start: 0, periods: 'window' }, measure_by: 'person', assumptions: [], exclusions: [] } }],
    options: [{ id: 'increase', label: 'Make the change', status: 'live', developed_from: null, ...record, author: 'person', quote: 'Make the change.',
      sets: [{ quantity: 'switch', to: 'one', value: null, low: null, high: null, range_kind: null, question: null,
        starts_after_periods: 0, author: 'person', quote: 'Make the change.' }] }],
    limits: [], preferences: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
  };
}
function projected(model: CanonicalModelT) {
  const compiled = compile(model);
  expect(compiled.errors).toEqual([]);
  return { compiled, graph: project(model, compiled).graph };
}
const node = (graph: ReturnType<typeof project>['graph'], id: string) => graph.nodes.find((n) => n.id === id)!;

describe('exact current levels on the canonical projection', () => {
  it('carries 125 on both the quantity and goal, source-less and worked out; never the option’s 150', () => {
    const model = scenario(), before = JSON.stringify(model), { compiled, graph } = projected(model);
    expect(compiled.executable!.options[0]!.sets[0]).toMatchObject({ quantity: 'switch', to: 'one' });
    expect(exactInitialValues(compiled.executable!).get('orders')).toBe(125);
    for (const id of ['orders', 'goal']) {
      expect(node(graph, id).observed_state).toEqual({ value: 125, raw_value: 125, unit: 'order/week' });
      expect(node(graph, id).value_basis).toMatchObject({ kind: 'worked_out', from: ['base', 'switch'] });
    }
    expect(node(graph, 'goal').nonlinear_identity).toBeUndefined(); // no invented legacy equation to bypass the reader
    expect(JSON.stringify(model)).toBe(before);
  });

  it('shows the exact 125 baseline when both uncertain effects have zero drivers; a nonzero driver stays uncertain', () => {
    const model = scenario();
    Object.assign(model.quantities.find((q) => q.id === 'gain')!, {
      author: 'olumi', quote: null, status: 'estimated', value: null, low: 0, high: 35, range_kind: 'plausible', basis: 'Provisional referral effect.',
    });
    model.quantities.push(
      quantity('price_response', 'order/week', null, { kind: 'coefficient', author: 'olumi', quote: null,
        status: 'estimated', low: 0, high: 3, range_kind: 'plausible', basis: 'Provisional response to a price reduction.' }),
      quantity('price_cut', '1', 0),
    );
    const effect = model.relations[0]!;
    if (effect.form !== 'effect') throw new Error('the fixture must be an effect');
    effect.terms.push({ driver: 'price_cut', coefficient: 'price_response', author: 'olumi', quote: null, ...record });
    const { compiled, graph } = projected(model);
    expect(compiled.executable).not.toBeNull();
    expect(exactInitialValues(compiled.executable!).get('orders')).toBe(125);
    for (const id of ['orders', 'goal']) expect(node(graph, id).observed_state).toEqual({ value: 125, raw_value: 125, unit: 'order/week' });
    expect(exactInitialValues(compiled.executable!).has('gain')).toBe(false); // the effect itself is still uncertain
    expect(exactInitialValues(compiled.executable!).get('base')).toBe(125);
    model.quantities.find((q) => q.id === 'switch')!.value = 1;
    const changed = projected(model);
    expect(node(changed.graph, 'goal').observed_state).toBeUndefined();
    expect(exactInitialValues(changed.compiled.executable!).has('orders')).toBe(false);
  });

  it('also cancels a finite uncertain driver when its coefficient is exactly zero', () => {
    const model = scenario();
    model.quantities.find((q) => q.id === 'gain')!.value = 0;
    Object.assign(model.quantities.find((q) => q.id === 'switch')!, {
      author: 'person', quote: 'Between 1 and 3 changes.', value: null, low: 1, high: 3, range_kind: 'bounds',
    });
    expect(node(projected(model).graph, 'goal').observed_state).toEqual({ value: 125, raw_value: 125, unit: 'order/week' });
  });

  it('an exact zero numerator part cancels a finite range; a zero denominator never does', () => {
    const model = scenario();
    Object.assign(model.quantities.find((q) => q.id === 'gain')!, { value: null, low: 10, high: 40, range_kind: 'bounds' });
    model.relations = [{ id: 'orders_product', form: 'definition', defines: 'orders', op: 'product',
      parts: [{ id: 'gain', power: 1 }, { id: 'switch', power: 1 }], author: 'olumi', quote: null, ...record }];
    expect(node(projected(model).graph, 'goal').observed_state).toEqual({ value: 0, raw_value: 0, unit: 'order/week' });
    const relation = model.relations[0]!;
    if (relation.form !== 'definition' || relation.op !== 'product') throw new Error('the fixture must be a product');
    relation.parts[1]!.power = -1;
    expect(node(projected(model).graph, 'goal').observed_state).toBeUndefined();
  });

  it('zero never conceals an invalid intermediate or a risk-dependent input', () => {
    const { compiled } = projected(scenario()), x = structuredClone(compiled.executable!);
    x.quantities.push(
      { id: 'invalid', label: 'invalid', unit: '1', reading: 'state', equation: { form: 'definition', op: 'ratio', parts: ['one', 'switch'] } },
      { id: 'zero_invalid', label: 'zero_invalid', unit: '1', reading: 'state', equation: { form: 'definition', op: 'product', parts: ['switch', 'invalid'] } },
    );
    expect(exactInitialValues(x).has('zero_invalid')).toBe(false);
    const gain = x.quantities.find((q) => q.id === 'gain')!;
    gain.dist = { kind: 'range', low: 10, high: 40, range_kind: 'bounds', basis: 'person_range' };
    x.risks.push({ id: 'risk', occurrence: 'one', severity: 'base', effect_on: 'gain', mode: 'add', from_period: 0 });
    expect(exactInitialValues(x).has('orders')).toBe(false);
  });

  it.each(['asked', 'unknown', 'unsupported'] as const)('has no fallback to the base when a dependency is %s', (status) => {
    const model = scenario();
    Object.assign(model.quantities.find((q) => q.id === 'gain')!, { status, value: null, question: status === 'asked' ? 'How much?' : null, basis: 'Not known.' });
    const { graph } = projected(model);
    expect(node(graph, 'orders').observed_state).toBeUndefined();
    expect(node(graph, 'goal').observed_state).toBeUndefined();
  });

  it('returns the displayed percent scale, not the engine’s fraction', () => {
    const model = scenario();
    for (const q of model.quantities) if (['base', 'gain', 'orders', 'target'].includes(q.id)) q.unit = '%';
    model.quantities.find((q) => q.id === 'base')!.value = 75;
    model.quantities.find((q) => q.id === 'target')!.value = 85;
    const { compiled, graph } = projected(model);
    expect(exactInitialValues(compiled.executable!).get('orders')).toBe(0.75);
    expect(node(graph, 'goal').observed_state).toEqual({ value: 75, raw_value: 75, unit: '%' });
  });

  it('uses a stock’s start (100), not its first update (110), and withholds a risk-dependent level', () => {
    const { compiled } = projected(scenario()), x = structuredClone(compiled.executable!);
    x.quantities.push(
      { id: 'start', label: 'start', unit: 'GBP', reading: 'state', dist: { kind: 'fixed', value: 100, author: 'person' } },
      { id: 'flow', label: 'flow', unit: 'GBP/month', reading: 'flow', dist: { kind: 'fixed', value: 10, author: 'person' } },
      { id: 'stock', label: 'stock', unit: 'GBP', reading: 'state', stock: { start: 'start', inflows: ['flow'], outflows: [] } },
    );
    expect(exactInitialValues(x).get('stock')).toBe(100);
    x.risks.push({ id: 'risk', occurrence: 'one', severity: 'gain', effect_on: 'base', mode: 'add', from_period: 0 });
    expect(exactInitialValues(x).has('orders')).toBe(false);
    expect(exactInitialValues(x).get('stock')).toBe(100);
  });

  it('does not let an invalid intermediate become a valid downstream zero', () => {
    const { compiled } = projected(scenario()), x = structuredClone(compiled.executable!);
    x.quantities.push(
      { id: 'huge', label: 'huge', unit: '1', reading: 'state', dist: { kind: 'fixed', value: 1e300, author: 'person' } },
      { id: 'overflow', label: 'overflow', unit: '1', reading: 'state', equation: { form: 'definition', op: 'product', parts: ['huge', 'huge'] } },
      { id: 'inverse', label: 'inverse', unit: '1', reading: 'state', equation: { form: 'definition', op: 'ratio', parts: ['one', 'overflow'] } },
      { id: 'zero_after_overflow', label: 'zero after overflow', unit: '1', reading: 'state', equation: { form: 'definition', op: 'product', parts: ['huge', 'huge', 'switch'] } },
    );
    expect(exactInitialValues(x).has('overflow')).toBe(false);
    expect(exactInitialValues(x).has('inverse')).toBe(false);
    expect(exactInitialValues(x).has('zero_after_overflow')).toBe(false);
  });
});

describe('integrated review 26 Oct: “today” only beside a goal measured from today', () => {
  /** "Grow orders by 20 %" from `reference`, the target in %. */
  const growth = (reference: NonNullable<CanonicalModelT['goals'][number]['measure']>['reference']) => {
    const model = scenario();
    Object.assign(model.quantities.find((q) => q.id === 'target')!, { unit: '%', value: 20, quote: 'target: 20 %' });
    model.quantities.push(quantity('last_year', 'order/week', 120));
    model.options.push({ id: 'carry_on', label: 'Carry on as now', status: 'live', developed_from: null, ...record, author: 'person', quote: 'Carry on as now.', sets: [] });
    Object.assign(model.goals[0]!.measure!, { frame: 'change_rel', reference });
    return node(projected(model).graph, 'goal');
  };
  it('a change from today carries today’s 125; a change from a stated value or from an option carries no “today”', () => {
    expect(growth({ kind: 'now', option: null, quantity: null })).toMatchObject({ observed_state: { value: 125, raw_value: 125, unit: 'order/week' }, value_basis: { kind: 'worked_out' } });
    for (const reference of [{ kind: 'value' as const, option: null, quantity: 'last_year' }, { kind: 'option' as const, option: 'carry_on', quantity: null }]) {
      const goal = growth(reference);
      expect([reference.kind, goal.observed_state, goal.value_basis]).toEqual([reference.kind, undefined, undefined]);
    }
  });
});

describe('the goal’s horizon comes from its own stated window', () => {
  /** The aim reached by the end of its stated window (max): the only goal the legacy “within N months” reader can describe. */
  const reached = () => { const model = scenario(); model.goals[0]!.measure!.aggregation = 'max'; return model; };
  it('carries the stated 3 months, and exactly converts a stated year to 12 months', () => {
    const model = reached();
    expect(node(projected(model).graph, 'goal')).toMatchObject({ goal_horizon: { months: 3 }, goal_horizon_months: 3 });
    model.period = 'year';
    Object.assign(model.quantities.find((q) => q.id === 'window')!, { unit: 'year', value: 1 });
    expect(node(projected(model).graph, 'goal').goal_horizon_months).toBe(12);
  });

  it.each(['asked', 'unknown', 'unsupported'] as const)('does not default a %s window, even if its old figure remains', (status) => {
    const model = reached();
    Object.assign(model.quantities.find((q) => q.id === 'window')!, { status, question: status === 'asked' ? 'By when?' : null, basis: 'Not known.' });
    const graph = project(model).graph;
    expect(node(graph, 'goal').goal_horizon).toBeUndefined();
    expect(node(graph, 'goal').goal_horizon_months).toBeUndefined();
  });

  it('does not turn a range or weeks into an exact month count', () => {
    const model = reached();
    Object.assign(model.quantities.find((q) => q.id === 'window')!, { low: 2, high: 4, range_kind: 'bounds' });
    expect(node(project(model).graph, 'goal').goal_horizon).toBeUndefined();
    model.period = 'week';
    Object.assign(model.quantities.find((q) => q.id === 'window')!, { value: 13, low: null, high: null, range_kind: null, unit: 'week' });
    expect(node(projected(model).graph, 'goal').goal_horizon).toBeUndefined();
  });

  it('integrated review 26 Oct: “within N months” only for a goal reached by then (max), on a window the person stated', () => {
    const measured = (aggregation: 'end' | 'max' | 'min' | 'every' | 'mean') => {
      const model = reached();
      model.goals[0]!.measure!.aggregation = aggregation;
      return node(projected(model).graph, 'goal');
    };
    // Contrast: reached by the end of the window.
    expect(measured('max')).toMatchObject({ goal_horizon: { months: 3 }, goal_horizon_months: 3 });
    // Its level AT the window's end (buddy BLOCK 26 Oct: a level reached at month 2 and lost by month 3 is "within 3 months" but
    // fails the goal), held at its lowest, in every month, or on average: never a deadline.
    for (const aggregation of ['end', 'min', 'every', 'mean'] as const) {
      const goal = measured(aggregation);
      expect([aggregation, goal.goal_horizon, goal.goal_horizon_months]).toEqual([aggregation, undefined, undefined]);
    }
    // Olumi's reading of a date they gave ("by the end of March") is never shown as their own stated window.
    const read = reached();
    Object.assign(read.quantities.find((q) => q.id === 'window')!, { author: 'olumi', quote: null, basis: 'The end of March is 3 whole months from today.' });
    const goal = node(projected(read).graph, 'goal');
    expect([goal.goal_horizon, goal.goal_horizon_months]).toEqual([undefined, undefined]);
  });

  it('never calls an event-relative or later observation window “within 3 months” from now', () => {
    const model = reached(), window = model.goals[0]!.measure!.window!;
    window.start = 2;
    expect(node(projected(model).graph, 'goal').goal_horizon).toBeUndefined();
    window.start = 0; window.origin_event = 'Opening'; window.origin_offset = 'opening';
    model.quantities.push(quantity('opening', 'month', null, { status: 'asked', question: 'When is opening?' }));
    expect(node(project(model).graph, 'goal').goal_horizon).toBeUndefined();
  });
});
