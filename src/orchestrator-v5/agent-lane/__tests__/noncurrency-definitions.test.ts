import { describe, expect, it } from 'vitest';
import { LivingModel, type LivingModelT } from '../../../schemas/living-model.js';
import { mapLivingModel } from '../../path-b/living-model/mapper.js';
import { quantityUnitsCompose, unitsCompose } from '../same-unit.js';

const compose = (whole: unknown, rate: unknown, count: unknown) =>
  quantityUnitsCompose(whole, { unit: rate, label: 'rate' }, { unit: count, label: 'count' });
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const factor = (id: string, value: number, unit: string, quote: string): LivingModelT['factors'][number] =>
  ({ id, label: id, kind: 'factor', estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(quote) });
const delivery = (): LivingModelT => ({
  aims: [{ id: 'delivered', text: 'Deliver at least 60 developer-days', status: 'current', ...who('deliver at least 60 developer-days'),
    defined_as: { op: 'product', of: ['pace', 'days'], ...who('developer-days delivered equals developer-days per working day times working days') },
    target: { quantity: 'developer-days delivered', comparator: '>=', value: 60, low: null, high: null, unit: 'developer-days', by_when: null,
      period_months: null, baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [], factors: [factor('pace', 3, 'developer-days per working day', 'we deliver 3 developer-days per working day'),
    factor('days', 12, 'working days', 'we have 12 working days')],
  links: [], risks: [], conditions: [], views: [], history: [],
});

describe('explicit non-currency rate times its own count or duration', () => {
  it.each([
    ['row 1: developer-days', 'developer-days', 'developer-days per working day', 'working days'],
    ['row 2: sites', 'sites', 'sites per team', 'teams'],
    ['bare duration', 'sites', 'sites per month', 'months'],
    ['bare duration (year)', 'sites', 'sites per year', 'years'],
    ['slash and normalisation', 'sites', 'site/team', 'TEAMS'],
    ['qualified count', 'sites', 'sites per regional team', 'regional teams'],
    ['period retained', 'sites per month', 'sites per team per month', 'teams'],
  ])('%s composes in either operand order', (_row, whole, rate, count) => {
    expect(compose(whole, rate, count)).toEqual({ kind: 'proof', rate: 'rate', count: 'count', code: '' });
    expect(compose(whole, count, rate)).toEqual({ kind: 'proof', rate: 'count', count: 'rate', code: '' });
  });

  it.each([
    ['row 3: mismatched denominator', 'sites', 'sites per team', 'working days'],
    ['row 4: unitless part', 'sites', 'sites per team', null],
    ['row 4: unreadable part', 'sites', 'sites per team', '?'],
    ['unreadable rate', 'sites', '? per team', 'teams'],
    ['unitless whole', null, 'sites per team', 'teams'],
    ['different numerator', 'developer-days', 'sites per team', 'teams'],
    ['missing qualifier', 'sites', 'sites per regional team', 'teams'],
    ['wrong duration qualifier', 'developer-days', 'developer-days per working day', 'calendar days'],
    ['count has another dimension', 'sites', 'sites per team', 'teams per office'],
    ['missing denominator', 'sites', 'sites', 'teams'],
    ['unmatched period', 'sites per year', 'sites per team per month', 'teams'],
    ['unmatched share base', '% of output', '% of revenue per team', 'teams'],
    ['scale cannot disappear', 'users', 'k users per team', 'teams'],
    ['a share whole is refused (a rate of change compounds)', '% of output', '% of output per team', 'teams'],
    ['a percent rate over time is refused', '%', '% per month', 'months'],
    ['a points whole is refused', 'pp', 'pp per year', 'years'],
    ['unrelated dimension elsewhere in the rate', 'sites', 'sites per team per office', 'teams'],
  ])('%s is refused', (_row, whole, rate, count) => {
    expect(compose(whole, rate, count)).toEqual({ kind: 'no' });
  });

  it('the money rule (unitsCompose, 13 legacy callers) is unchanged: a non-currency whole is still refused there', () => {
    expect(unitsCompose('developer-days', 'Delivered', { unit: 'developer-days per working day', label: 'rate' }, { unit: 'working days', label: 'count' })).toEqual({ kind: 'no' });
  });

  it('row 6: definitionCheck gives today\'s level from the person\'s own figures', () => {
    const model = LivingModel.parse(delivery());
    const mapped = mapLivingModel(model);
    const goal = mapped.graph.nodes.find((n) => n.id === 'delivered')!;
    expect(goal.observed_state).toMatchObject({ raw_value: 36, unit: 'developer-days' });
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pace', 'days'], stated_in_brief: true });
    expect(mapped.withheld.filter((w) => w.id === 'delivered')).toEqual([]);
  });

  it('definitionCheck still withholds when the matching part is unknown or not the person\'s figure', () => {
    for (const patch of [{ value: null }, { estimate_by: 'olumi' as const }, { source: 'unverified' as const, quote: null }]) {
      const model = delivery();
      Object.assign(model.factors[0]!, patch);
      const mapped = mapLivingModel(model);
      expect(mapped.graph.nodes.find((n) => n.id === 'delivered')!.observed_state).toBeUndefined();
      expect(mapped.withheld).toContainEqual({ id: 'delivered', reason: 'goal_level_unknown' });
    }
  });
});
