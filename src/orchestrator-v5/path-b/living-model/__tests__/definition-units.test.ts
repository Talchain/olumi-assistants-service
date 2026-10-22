/**
 * DL 23 Oct (Track 2 served café step 0 on ed17ce15, synthetic brief "280 coffees a day at £3 each … daily coffee revenue of
 * at least £1,000"): the person's "yes" made the definition theirs, but the drafter wrote the units as written — goal "£",
 * parts "coffees a day" × "£ each" — which the one composition rule cannot prove, so the identity was held
 * (`identity_unit_mismatch`), its parts were cut off from the goal and the Run was refused. The fix is at the source the
 * drafter reads: the definition's schema description asks for units that compose in the person's meaning. Synthetic figures.
 */
import { tool } from '@openai/agents';
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { BuildModelParams } from '../../tools/draft-tool.js';
import { mapLivingModel } from '../mapper.js';

/** What the AI actually receives: the strict JSON schema the SDK sends for the draft tool. */
const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const level = (id: string, label: string, value: number, unit: string) =>
  ({ id, label, kind: 'factor' as const, estimate_by: null, value, low: null, high: null, unit, defined_as: null, limit: null, ...who(`${value}`) });
/** The served café's shape: its definition the person's, its units as the drafter wrote them or as the description asks. */
const cafe = (units: { goal: string; count: string; price: string }): LivingModelT => ({
  aims: [{ id: 'revenue', text: 'Daily coffee revenue of at least £1,000', status: 'current', ...who('daily coffee revenue of at least £1,000'),
    defined_as: { op: 'product', of: ['coffees', 'price'], ...who('revenue is just the coffees we sell each day times the £3 price') },
    target: { quantity: 'Daily coffee revenue', comparator: '>=', value: 1000, low: null, high: null, unit: units.goal, by_when: null, period_months: null, period_by: null, period_read_on: null,
      baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [
    { status: 'feasible', id: 'keep', label: 'Keep things as they are', settings: [], developed_from: null, ...who('keep things as they are') },
    { status: 'feasible', id: 'barista', label: 'A second barista', settings: [], developed_from: null, ...who('a second barista') },
  ],
  factors: [level('coffees', 'Coffees sold per day', 280, units.count), level('price', 'Price per coffee', 3, units.price)],
  links: [{ id: 'uplift', from: 'barista', to: 'coffees', ...who('adds about 40 coffees a day'),
    effect: { estimate_by: null, form: 'range', value: 40, sd: null, low: 20, high: 60, unit: units.count, sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);

describe('a definition\'s units are asked for so they compose, so the person\'s definition can be worked out', () => {
  it('the schema the drafter is sent asks for the quantity\'s period, a price per thing and a count of that thing', () => {
    expect(sent).toContain('Write the units so the parts\' units make the quantity\'s, in the person\'s meaning where the brief makes it plain');
    expect(sent).toContain('(\\"£ per day\\" for daily revenue, not \\"£\\")');
    expect(sent).toContain('(\\"£ per coffee\\", not \\"£ each\\")');
    expect(sent).toContain('the period sits on exactly one part, wherever the person put it (\\"coffees per day\\" × \\"£ per coffee\\"; \\"customers\\" × \\"£ per customer per month\\")');
    expect(sent).toContain('This never changes the unit of a factor outside a definition.');
  });

  it('the period sits on one part only: a monthly price × a count of customers composes; the period on both does not', () => {
    const monthly = (count: string) => reasons(cafe({ goal: '£ per month', count, price: '£ per customer per month' }));
    expect(monthly('customers').filter((r) => r.startsWith('revenue:identity'))).toEqual([]);
    expect(monthly('customers per month')).toContain('revenue:identity_unit_mismatch');
  });

  it('BEFORE (served ed17ce15): "£" from "coffees a day" × "£ each" cannot be proved, so the identity is held', () => {
    expect(reasons(cafe({ goal: '£', count: 'coffees a day', price: '£ each' }))).toContain('revenue:identity_unit_mismatch');
  });

  it('the units the description asks for compose: the identity holds and today\'s level is 280 × £3 = £840', () => {
    const m = cafe({ goal: '£ per day', count: 'coffees per day', price: '£ per coffee' });
    expect(reasons(m).filter((r) => r.startsWith('revenue:identity'))).toEqual([]);
    const goal = (mapLivingModel(m).graph.nodes as Record<string, any>[]).find((n) => n.id === 'revenue')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect(goal.observed_state).toMatchObject({ raw_value: 840 });
  });
});
