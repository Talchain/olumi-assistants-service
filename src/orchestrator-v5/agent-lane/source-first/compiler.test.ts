import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import { bindSource, readNumber } from './source-binding.js';
import { buildSourceFirstModel } from './index.js';
import { buildSourceMeaningSchema, type SourceMeaning, type SourceQuantity, type SourceSpan, type SourceUnit } from './meaning.js';

const source = (quote: string): SourceSpan => ({ quote, start: null, end: null });
const money = (counted_object: string | null = null): SourceUnit => ({ kind: 'currency', currency: 'GBP', period: 'month', counted_object, as_stated: '£ a month' });
const count: SourceUnit = { kind: 'count', currency: null, period: null, counted_object: 'subscribers', as_stated: 'subscribers' };
const empty = (): SourceMeaning => ({ entities: [], quantities: [], options: [], definitions: [], causal_claims: [], unknowns: [], proposals: [] });
function quantity(ref: string, entity_ref: string, role: SourceQuantity['role'], literal: string, value: string, quote: string, unit: SourceUnit): SourceQuantity {
  return { ref, entity_ref, role, number: { literal, value, source: source(quote) }, unit,
    frame: 'level', direction: 'none', comparator: null, horizon_months: null };
}
function pricing() {
  const brief = 'Current price is £49 per subscriber a month. We have 1,500 subscribers. Current MRR is £73,500 a month. MRR is price times subscribers. Our target MRR is above £85k a month within a year. Option: raise price to £59 per subscriber a month.';
  const meaning = empty();
  meaning.entities = [
    { ref: 'price', kind: 'factor', label: 'Price', source: source('Current price is £49 per subscriber a month.') },
    { ref: 'subscribers', kind: 'factor', label: 'Subscribers', source: source('We have 1,500 subscribers.') },
    { ref: 'mrr', kind: 'goal', label: 'MRR', source: source('Current MRR is £73,500 a month.') },
    { ref: 'raise', kind: 'option', label: 'Raise price', source: source('Option: raise price to £59 per subscriber a month.') },
  ];
  meaning.quantities = [
    quantity('current_price', 'price', 'current', '£49', '49', 'Current price is £49 per subscriber a month.', money('subscriber')),
    quantity('current_subscribers', 'subscribers', 'current', '1,500', '1500', 'We have 1,500 subscribers.', count),
    quantity('current_mrr', 'mrr', 'current', '£73,500', '73500', 'Current MRR is £73,500 a month.', money()),
    { ...quantity('target_mrr', 'mrr', 'target', '£85k', '85000', 'Our target MRR is above £85k a month within a year.', money()), comparator: '>', horizon_months: 12 },
    quantity('raised_price', 'price', 'proposed_level', '£59', '59', 'Option: raise price to £59 per subscriber a month.', money('subscriber')),
  ];
  meaning.options = [{ entity_ref: 'raise', is_status_quo: false, interventions: [{ entity_ref: 'price', quantity_ref: 'raised_price', source: source('Option: raise price to £59 per subscriber a month.') }] }];
  meaning.definitions = [{ ref: 'mrr_definition', target_ref: 'mrr', operation: 'product', operand_refs: ['price', 'subscribers'], authorship: 'explicit', source: source('MRR is price times subscribers.') }];
  return { brief, meaning };
}

describe('source-first compiler', () => {
  it('compiles stated identity onto the measured goal, retaining exact values, units, target and provenance', () => {
    const { brief, meaning } = pricing();
    const result = compileSourceMeaning(brief, meaning);
    expect(GraphV3.safeParse(result.graph).success).toBe(true);
    expect(result.unresolved).toEqual([]);
    const goal = result.graph.nodes.find((node) => node.kind === 'goal')!;
    expect(goal.observed_state?.raw_value).toBe(73500);
    expect(goal.goal_threshold_raw).toBe(85000);
    expect(goal.goal_direction).toBe('>');
    expect(goal.goal_horizon_months).toBe(12);
    expect(goal.nonlinear_identity).toEqual({ operation: 'product', factor_ids: [sourceEntityId('price'), sourceEntityId('subscribers')], stated_in_brief: true });
    const option = result.graph.nodes.find((node) => node.kind === 'option')!;
    expect(option.interventions?.[sourceEntityId('price')]).toMatchObject({ raw_value: 59, unit: 'GBP per subscriber per month', source: 'brief_extraction' });
    expect(result.source_bindings.current_price.quote).toBe(meaning.quantities[0].number.source.quote);
    expect(result.trace).toMatchObject({ architecture: 'source_first', transforms: 1, repairs: 0, retries: 0 });
  });

  it('retains contradictory stated revenue and asks scope instead of inventing a reconciliation', () => {
    const fixture = pricing();
    const brief = fixture.brief.replaceAll('£73,500', '£75k');
    const meaning = JSON.parse(JSON.stringify(fixture.meaning).replaceAll('£73,500', '£75k').replaceAll('73500', '75000'));
    const result = compileSourceMeaning(brief, meaning);
    const goal = result.graph.nodes.find((node) => node.kind === 'goal')!;
    expect(goal.observed_state?.raw_value).toBe(75000);
    expect(goal.nonlinear_identity).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'definition_current_values_disagree' }));
    expect(result.open_questions.join(' ')).toContain('73500');
    expect(result.graph.nodes).toHaveLength(4);
  });

  it('roundtrips exact per-claim numeric lineage on current, target and intervention fields', () => {
    const { brief, meaning } = pricing();
    const result = compileSourceMeaning(brief, meaning);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(GraphV3.parse(result.graph))));
    const goal = graph.nodes.find((node) => node.kind === 'goal')!;
    const price = graph.nodes.find((node) => node.id === sourceEntityId('price'))!;
    const option = graph.nodes.find((node) => node.kind === 'option')!;
    expect(price.observed_state?.source_quote).toBe(result.source_bindings.current_price.quote);
    expect(goal.observed_state?.source_quote).toBe(result.source_bindings.current_mrr.quote);
    expect(goal.source_quote).toBe(result.source_bindings.target_mrr.quote);
    expect(goal.description).toContain(meaning.entities[2].source.quote);
    expect(option.interventions?.[price.id].source_quote).toBe(result.source_bindings.raised_price.quote);
    for (const quote of [price.observed_state?.source_quote, goal.observed_state?.source_quote, goal.source_quote, option.interventions?.[price.id].source_quote]) {
      expect(typeof quote).toBe('string');
      expect(brief).toContain(quote);
    }
  });

  it('does not make matching target text a current level', () => {
    const brief = 'Our target MRR is £75k a month.';
    const meaning = empty();
    meaning.entities = [{ ref: 'mrr', kind: 'goal', label: 'MRR', source: source(brief) }];
    meaning.quantities = [quantity('wrong_current', 'mrr', 'current', '£75k', '75000', brief, money())];
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes[0].observed_state).toBeUndefined();
    expect(result.unresolved[0].code).toBe('current_value_is_target_or_limit');
  });

  it('keeps an option and factor with the same label as distinct identities', () => {
    const { brief, meaning } = pricing();
    meaning.entities[0].label = 'Price';
    meaning.entities[3].label = 'Price';
    const result = compileSourceMeaning(brief, meaning);
    const matches = result.graph.nodes.filter((node) => node.label === 'Price');
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((node) => node.id)).size).toBe(2);
    expect(matches.find((node) => node.kind === 'option')?.interventions).toHaveProperty(sourceEntityId('price'));
  });

  it('retains a real zero and keeps an unknown baseline absent', () => {
    const brief = 'We have 0 subscribers. We do not know current monthly MRR.';
    const meaning = empty();
    meaning.entities = [
      { ref: 'subscribers', kind: 'factor', label: 'Subscribers', source: source('We have 0 subscribers.') },
      { ref: 'mrr', kind: 'outcome', label: 'MRR', source: source('We do not know current monthly MRR.') },
    ];
    meaning.quantities = [quantity('zero', 'subscribers', 'current', '0', '0', 'We have 0 subscribers.', count)];
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes[0].observed_state?.raw_value).toBe(0);
    expect(result.graph.nodes[1].observed_state).toBeUndefined();
    expect(result.graph.nodes.some((node) => node.kind === 'goal' || node.kind === 'decision')).toBe(false);
  });

  it('holds a strict percent limit without treating the limit as current churn', () => {
    const brief = 'Monthly churn must stay below 5%.';
    const meaning = empty();
    meaning.entities = [{ ref: 'churn', kind: 'factor', label: 'Monthly churn', source: source(brief) }];
    meaning.quantities = [{ ...quantity('churn_limit', 'churn', 'limit', '5%', '5', brief,
      { kind: 'percent', currency: null, period: 'month', counted_object: null, as_stated: '%' }), comparator: '<' }];
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes[0].observed_state).toBeUndefined();
    expect(result.graph.goal_constraints?.[0]).toMatchObject({ value: 5, operator: '<=', operator_as_stated: '<', value_frame: 'level', unit: '% per month', source_quote: brief });
  });

  it('preserves a stated causal claim as unresolved without inventing effect sizes', () => {
    const { brief: original, meaning } = pricing();
    const quote = 'Raising price may reduce subscribers.';
    meaning.causal_claims = [{ ref: 'churn_effect', from_ref: 'price', to_ref: 'subscribers', direction: 'negative', source: source(quote), coefficient: null, natural_effect: null, standard_deviation: null, existence_probability: null }];
    const result = compileSourceMeaning(`${original} ${quote}`, meaning);
    expect(result.graph.edges.find((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'causal_size_unresolved' }));
  });

  it.each(['-0.4', '-4'])('withholds an untyped natural-unit causal coefficient %s', (amount) => {
    const { brief: original, meaning } = pricing();
    const quote = `The causal coefficient β is ${amount} subscribers per £1 increase in price, standard deviation 0.1, existence probability 0.8.`;
    meaning.causal_claims = [{ ref: 'price_effect', from_ref: 'price', to_ref: 'subscribers', direction: 'negative',
      source: source(quote), coefficient: { literal: amount, value: amount, source: source(quote) }, natural_effect: null,
      standard_deviation: { literal: '0.1', value: '0.1', source: source(quote) },
      existence_probability: { literal: '0.8', value: '0.8', source: source(quote) } }];
    const result = compileSourceMeaning(`${original} ${quote}`, meaning);
    expect(result.graph.edges.some((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBe(false);
    expect(result.source_bindings.price_effect.quote).toBe(quote);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'price_effect', code: 'causal_unit_frame_unverified' }));
    expect(result.open_questions.some((question) => question.includes('per-unit') && question.includes('uncertainty'))).toBe(true);
  });

  it.each([['4', -0.04], ['0.4', -0.004]])('normalises a source-bound natural effect of %s subscribers per £1', (amount, beta) => {
    const { brief: original, meaning } = pricing();
    const quote = `A £1 increase in price loses ${amount} subscribers.`;
    meaning.causal_claims = [{ ref: 'price_effect', from_ref: 'price', to_ref: 'subscribers', direction: 'negative',
      source: source(quote), coefficient: null,
      natural_effect: { amount: { literal: amount, value: amount, source: source(quote) }, amount_unit: count,
        per_source_change: { literal: '£1', value: '1', source: source(quote) },
        per_source_change_unit: { ...money('subscriber'), as_stated: '£' } },
      standard_deviation: null, existence_probability: null }];
    const result = compileSourceMeaning(`${original} ${quote}`, meaning);
    const edge = result.graph.edges.find((item) => item.from === sourceEntityId('price') && item.to === sourceEntityId('subscribers'));
    expect(edge?.strength.mean).toBeCloseTo(beta);
    expect(edge?.provenance).toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated',
      natural_effect: { amount: -Number(amount), amount_unit: 'subscribers', per_source_change: 1,
        per_source_change_unit: 'GBP per subscriber per month', strength_mean: beta, strength_mean_frame: 'edge_strength' } });
    expect(edge?.defaulted).toBeUndefined();
    expect(edge?.std_defaulted).toBe(true);
    expect(edge?.exists_defaulted).toBe(true);
    expect(edgeStrengthProvenance(edge)).toBe('user_stated');
    expect(result.unresolved).toEqual([]);
    expect(GraphV3.safeParse(result.graph).success).toBe(true);
  });

  it('reads monthly churn effects in percentage points, never as a relative percent', () => {
    const price = 'Current Pro plan price is £49 per subscriber a month.';
    const churn = 'Current Monthly churn is 6% per month.';
    const points = 'A £1 increase in Pro plan price reduces Monthly churn by 1 percentage point.';
    const percent = 'A £1 increase in Pro plan price reduces Monthly churn by 1%.';
    const model = (quote: string, literal: string, amountUnit: SourceUnit): SourceMeaning => {
      const meaning = empty();
      meaning.entities = [
        { ref: 'price', kind: 'factor', label: 'Pro plan price', source: source(price) },
        { ref: 'churn', kind: 'factor', label: 'Monthly churn', source: source(churn) },
      ];
      meaning.quantities = [
        quantity('price_today', 'price', 'current', '£49', '49', price, money('subscriber')),
        quantity('churn_today', 'churn', 'current', '6%', '6', churn,
          { kind: 'percent', currency: null, period: 'month', counted_object: null, as_stated: '%' }),
      ];
      meaning.causal_claims = [{ ref: 'effect', from_ref: 'price', to_ref: 'churn', direction: 'negative',
        source: source(quote), coefficient: null,
        natural_effect: { amount: { literal, value: '1', source: source(literal === '1' ? 'by 1 percentage point' : 'by 1%') },
          amount_unit: amountUnit,
          per_source_change: { literal: '£1', value: '1', source: source('£1 increase in Pro plan price') },
          per_source_change_unit: { ...money('subscriber'), as_stated: '£' } },
        standard_deviation: null, existence_probability: null }];
      return meaning;
    };
    const pointsResult = compileSourceMeaning(`${price} ${churn} ${points}`, model(points, '1',
      { kind: 'percentage_points', currency: null, period: 'month', counted_object: null, as_stated: 'percentage point' }));
    const edge = pointsResult.graph.edges.find((item) => item.from === sourceEntityId('price') && item.to === sourceEntityId('churn'));
    expect(edge?.strength.mean).toBe(-1);
    expect(edge?.provenance?.natural_effect?.amount_unit).toBe('percentage points');
    expect(edgeStrengthProvenance(edge)).toBe('user_stated');
    expect(pointsResult.unresolved).toEqual([]);

    const percentResult = compileSourceMeaning(`${price} ${churn} ${percent}`, model(percent, '1%',
      { kind: 'percent', currency: null, period: 'month', counted_object: null, as_stated: '%' }));
    expect(percentResult.graph.edges).toEqual([]);
    expect(percentResult.unresolved).toContainEqual(expect.objectContaining({ ref: 'effect', code: 'causal_natural_effect_unverified' }));
  });

  it('withholds a natural effect with mismatched units, absent frame or unframed stated uncertainty', () => {
    const { brief: original, meaning } = pricing();
    const quote = 'A £1 increase in price loses 4 subscribers; standard deviation is 0.1.';
    const effect = { amount: { literal: '4', value: '4', source: source(quote) }, amount_unit: count,
      per_source_change: { literal: '£1', value: '1', source: source(quote) },
      per_source_change_unit: { ...money('subscriber'), as_stated: '£' } };
    meaning.causal_claims = [{ ref: 'price_effect', from_ref: 'price', to_ref: 'subscribers', direction: 'negative',
      source: source(quote), coefficient: null, natural_effect: effect,
      standard_deviation: { literal: '0.1', value: '0.1', source: source(quote) }, existence_probability: null }];
    const brief = `${original} ${quote}`;
    const statedSpread = compileSourceMeaning(brief, meaning);
    expect(statedSpread.graph.edges.some((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBe(false);
    expect(statedSpread.unresolved).toContainEqual(expect.objectContaining({ code: 'causal_unit_frame_unverified' }));

    meaning.causal_claims[0].standard_deviation = null;
    meaning.causal_claims[0].natural_effect!.amount_unit = { ...count, counted_object: 'tickets', as_stated: 'subscribers' };
    const wrongUnit = compileSourceMeaning(brief, meaning);
    expect(wrongUnit.graph.edges.some((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBe(false);
    expect(wrongUnit.unresolved).toContainEqual(expect.objectContaining({ code: 'causal_natural_effect_unverified' }));

    meaning.causal_claims[0].natural_effect!.amount_unit = count;
    meaning.quantities = meaning.quantities.filter((claim) => claim.ref !== 'current_subscribers');
    const missingFrame = compileSourceMeaning(brief, meaning);
    expect(missingFrame.graph.edges.some((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBe(false);
    expect(missingFrame.unresolved).toContainEqual(expect.objectContaining({ code: 'causal_unit_frame_unverified' }));
  });

  it('holds a user effect beyond the engine range with its exact statement and a question', () => {
    const { brief: original, meaning } = pricing();
    const quote = 'A £1 increase in price loses 4000 subscribers.';
    meaning.causal_claims = [{ ref: 'price_effect', from_ref: 'price', to_ref: 'subscribers', direction: 'negative',
      source: source(quote), coefficient: null,
      natural_effect: { amount: { literal: '4000', value: '4000', source: source(quote) }, amount_unit: count,
        per_source_change: { literal: '£1', value: '1', source: source(quote) },
        per_source_change_unit: { ...money('subscriber'), as_stated: '£' } },
      standard_deviation: null, existence_probability: null }];
    const result = compileSourceMeaning(`${original} ${quote}`, meaning);
    expect(result.graph.edges.some((edge) => edge.from === sourceEntityId('price') && edge.to === sourceEntityId('subscribers'))).toBe(false);
    expect(result.source_bindings.price_effect.quote).toBe(quote);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'not_representable', question: expect.stringContaining('4000 subscribers') }));
  });

  it('does not silently stamp an explicit sum as an inferred sum', () => {
    const { brief, meaning } = pricing();
    meaning.definitions[0].operation = 'sum';
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes.find((node) => node.kind === 'goal')?.nonlinear_identity).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'explicit_sum_carrier_unsupported' }));
  });

  it('keeps an interpreted definition visibly distinct from a user-stated definition', () => {
    const { brief, meaning } = pricing();
    meaning.definitions[0].authorship = 'interpretation';
    const result = compileSourceMeaning(brief, meaning);
    const goal = result.graph.nodes.find((node) => node.kind === 'goal')!;
    expect(goal.nonlinear_identity?.stated_in_brief).toBe(false);
    expect(result.graph.edges.filter((edge) => edge.to === goal.id).every((edge) => edge.provenance?.source === 'domain_knowledge')).toBe(true);
  });

  it('returns proposals outside the canonical graph', () => {
    const { brief, meaning } = pricing();
    meaning.proposals = [{ ref: 'test_price', kind: 'option', label: 'Run a price experiment', reason: 'Test demand before rollout.' }];
    const result = compileSourceMeaning(brief, meaning);
    expect(result.proposals).toEqual(meaning.proposals);
    expect(result.graph.nodes.some((node) => node.label === 'Run a price experiment')).toBe(false);
  });

  it('refuses annual/monthly confusion on the same quantity', () => {
    const { brief, meaning } = pricing();
    meaning.quantities[4].unit.period = 'year';
    const result = compileSourceMeaning(brief, meaning);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'raised_price', code: 'period_not_grounded' }));
    expect(result.graph.nodes.find((node) => node.kind === 'option')?.interventions).toEqual({});
  });

  it('keeps graph identity stable across label correction and additional evidence', () => {
    const { brief, meaning } = pricing();
    const before = compileSourceMeaning(brief, meaning);
    meaning.entities[0].label = 'Monthly Pro price';
    const after = compileSourceMeaning(brief, meaning);
    expect(after.reference_ids).toEqual(before.reference_ids);
    expect(after.graph.nodes.map((node) => node.id)).toEqual(before.graph.nodes.map((node) => node.id));
  });

  it('applies a relative change to the stated current level, never stores the change as today', () => {
    const { brief: original, meaning } = pricing();
    const before = 'Option: raise price to £59 per subscriber a month.';
    const after = 'Option: increase the price by 20%.';
    const brief = original.replace(before, after);
    meaning.entities[3].source = source(after);
    meaning.options[0].interventions[0].source = source(after);
    meaning.quantities[4] = { ...quantity('raised_price', 'price', 'relative_change', '20%', '20', after,
      { kind: 'percent', currency: null, period: null, counted_object: null, as_stated: '%' }), frame: 'change_rel', direction: 'increase' };
    const result = compileSourceMeaning(brief, meaning);
    const price = result.graph.nodes.find((node) => node.id === sourceEntityId('price'))!;
    const option = result.graph.nodes.find((node) => node.kind === 'option')!;
    expect(price.observed_state?.raw_value).toBe(49);
    expect(option.interventions?.[price.id]).toMatchObject({ raw_value: 58.8, unit: 'GBP per subscriber per month', source: 'cee_hypothesis' });
    expect(result.unresolved).toEqual([]);
  });

  it('asks for a missing baseline once and retains the rest of the model', () => {
    const { brief: original, meaning } = pricing();
    const before = 'Option: raise price to £59 per subscriber a month.';
    const after = 'Option: increase the price by 20%.';
    const brief = original.replace(before, after);
    meaning.entities[3].source = source(after);
    meaning.options[0].interventions[0].source = source(after);
    meaning.quantities = meaning.quantities.filter((claim) => claim.ref !== 'current_price');
    meaning.quantities[3] = { ...quantity('raised_price', 'price', 'relative_change', '20%', '20', after,
      { kind: 'percent', currency: null, period: null, counted_object: null, as_stated: '%' }), frame: 'change_rel', direction: 'increase' };
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes).toHaveLength(4);
    expect(result.graph.nodes.find((node) => node.kind === 'option')?.interventions).toEqual({});
    expect(result.unresolved.filter((finding) => finding.code === 'change_needs_current_level')).toHaveLength(1);
    expect(result.graph.nodes.find((node) => node.kind === 'goal')?.goal_threshold_raw).toBe(85000);
  });

  it('distinguishes a percentage-point decrease from a relative decrease', () => {
    const brief = 'Current monthly churn is 5%. Option: reduce monthly churn by 2 percentage points.';
    const current = 'Current monthly churn is 5%.';
    const change = 'Option: reduce monthly churn by 2 percentage points.';
    const meaning = empty();
    const percent: SourceUnit = { kind: 'percent', currency: null, period: 'month', counted_object: null, as_stated: '%' };
    meaning.entities = [
      { ref: 'churn', kind: 'factor', label: 'Churn', source: source(current) },
      { ref: 'reduce', kind: 'option', label: 'Reduce churn', source: source(change) },
    ];
    meaning.quantities = [quantity('current_churn', 'churn', 'current', '5%', '5', current, percent),
      { ...quantity('change', 'churn', 'absolute_change', '2', '2', change, { ...percent, kind: 'percentage_points', as_stated: 'percentage points' }), frame: 'change_abs', direction: 'decrease' }];
    meaning.options = [{ entity_ref: 'reduce', is_status_quo: false, interventions: [{ entity_ref: 'churn', quantity_ref: 'change', source: source(change) }] }];
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes.find((node) => node.kind === 'option')?.interventions?.[sourceEntityId('churn')]).toMatchObject({ raw_value: 3, value: 0.03, unit: '% per month' });
    expect(result.unresolved).toEqual([]);
  });

  it('does not add an annual absolute change to a monthly current level', () => {
    const { brief: original, meaning } = pricing();
    const before = 'Option: raise price to £59 per subscriber a month.';
    const after = 'Option: increase the price by £10 per subscriber per year.';
    const brief = original.replace(before, after);
    meaning.entities[3].source = source(after);
    meaning.options[0].interventions[0].source = source(after);
    meaning.quantities[4] = { ...quantity('raised_price', 'price', 'absolute_change', '£10', '10', after,
      { ...money('subscriber'), period: 'year' }), frame: 'change_abs', direction: 'increase' };
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes.find((node) => node.kind === 'option')?.interventions).toEqual({});
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'change_unit_mismatch' }));
  });

  it('does not borrow a figure from another option source', () => {
    const { brief: original, meaning } = pricing();
    const quote = 'Option: keep the price at £49 per subscriber a month.';
    meaning.entities.push({ ref: 'keep', kind: 'option', label: 'Keep price', source: source(quote) });
    meaning.options.push({ entity_ref: 'keep', is_status_quo: true, interventions: [{ entity_ref: 'price', quantity_ref: 'raised_price', source: source(quote) }] });
    const result = compileSourceMeaning(`${original} ${quote}`, meaning);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('keep'))?.interventions).toEqual({});
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'intervention_quantity_source_mismatch' }));
    expect(result.graph.nodes.filter((node) => node.kind === 'option')).toHaveLength(2);
  });

  it('rejects a dangling numeric entity reference without losing valid entities', () => {
    const { brief, meaning } = pricing();
    meaning.quantities[0].entity_ref = 'missing_price';
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes).toHaveLength(4);
    expect(result.graph.nodes.find((node) => node.id === sourceEntityId('price'))?.observed_state).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'unknown_entity_reference' }));
  });
});

describe('source binding', () => {
  it('corrects inaccurate offsets only when the exact unchanged quote is unique', () => {
    expect(bindSource('Current £75k.', { quote: 'Current £75k.', start: 1, end: 14 })).toEqual({ ok: true,
      source: { quote: 'Current £75k.', start: 0, end: 13, offset_corrected: true } });
    expect(bindSource('£75k now. £75k later.', { quote: '£75k', start: 1, end: 5 })).toEqual({ ok: false, reason: 'source_quote_ambiguous' });
  });
  it('refuses repeated quotes unless exact offsets resolve the source', () => {
    const brief = '£75k now. £75k later.';
    expect(bindSource(brief, source('£75k'))).toEqual({ ok: false, reason: 'source_quote_ambiguous' });
    expect(bindSource(brief, { quote: '£75k', start: 10, end: 14 })).toEqual({ ok: true, source: { quote: '£75k', start: 10, end: 14 } });
    expect(bindSource(brief, { quote: '£75k', start: 1, end: 5 }).ok).toBe(false);
  });
  it('refuses numeric substring laundering and unsupported arithmetic', () => {
    expect(readNumber('Current £75k.', { literal: '75', value: '75', source: source('Current £75k.') })).toBeNull();
    expect(readNumber('Current £75k.', { literal: '£75k', value: '75000', source: source('Current £75k.') })?.value).toBe(75000);
    expect(readNumber('Current £75k.', { literal: '£75k', value: '75001', source: source('Current £75k.') })).toBeNull();
  });
});

describe('first live source-meaning regression captures', () => {
  const captures = JSON.parse(readFileSync(new URL('./fixtures/first-live-source-meaning.json', import.meta.url), 'utf8')) as Array<{ case: string; brief: string; meaning: SourceMeaning }>;
  it.each(captures)('$case produces a nonempty valid graph from unique quotes despite inaccurate offsets', ({ brief, meaning }) => {
    const result = compileSourceMeaning(brief, meaning);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(GraphV3.safeParse(result.graph).success).toBe(true);
    for (const binding of Object.values(result.source_bindings)) expect(brief.slice(binding.start, binding.end)).toBe(binding.quote);
  });
  it('retains Pauls six supplied values while disclosing provider option and metric-role errors', () => {
    const captured = captures.find((item) => item.case === 'paul-mrr')!;
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.nodes).toHaveLength(6);
    expect(result.graph.nodes.filter((node) => node.observed_state).map((node) => node.observed_state!.raw_value).sort((a, b) => a! - b!)).toEqual([49, 1500, 75000]);
    expect(result.graph.nodes.find((node) => node.kind === 'goal')?.goal_threshold_raw).toBe(85000);
    expect(result.graph.goal_constraints?.[0].value).toBe(5);
    expect(result.source_bindings.q2.quote).toBe('£59');
    expect(result.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'option_reference_invalid' }), expect.objectContaining({ code: 'metric_scope_split' }), expect.objectContaining({ ref: 'q2', code: 'unassigned_change' }),
    ]));
    expect(result.trace.source_offset_corrections).toBeGreaterThan(0);
    expect(result.trace.level_direction_annotations_ignored).toBe(2);
  });
});

describe('saved source-first graph reaches product lineage and option readers', () => {
  const captures = JSON.parse(readFileSync(new URL('./fixtures/repaired-live-source-meaning.json', import.meta.url), 'utf8')) as Array<{ case: string; brief: string; meaning: SourceMeaning }>;
  it('marks the exact validated Paul target on the goal, but never an ungrounded target', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(compileSourceMeaning(captured.brief, captured.meaning).graph)));
    expect(graph.nodes.find((node) => node.id === sourceEntityId('g1'))).toMatchObject({
      goal_threshold_raw: 85000, threshold_source: 'brief_extraction', source_quote: 'we want MRR above £85k within a year',
    });
    captured.meaning.quantities.find((claim) => claim.ref === 'q6')!.number.source = source('£75k MRR');
    const ungrounded = compileSourceMeaning(captured.brief, captured.meaning);
    expect(ungrounded.graph.nodes.find((node) => node.id === sourceEntityId('g1'))?.threshold_source).toBeUndefined();
    expect(ungrounded.graph.nodes.find((node) => node.id === sourceEntityId('g1'))?.goal_threshold_raw).toBeUndefined();
  });
  it.each([['paul-mrr', ['o1']], ['E', ['o1', 'o2']]] as const)(
    'links the single stated decision to the explicit %s options', (caseId, refs) => {
      const captured = captures.find((item) => item.case === caseId)!;
      const result = compileSourceMeaning(captured.brief, captured.meaning);
      const graph = GraphV3.parse(JSON.parse(JSON.stringify(result.graph)));
      const links = graph.edges.filter((edge) => edge.from === sourceEntityId('d1') && refs.some((ref) => edge.to === sourceEntityId(ref)));
      expect(links.map((edge) => edge.to).sort()).toEqual(refs.map(sourceEntityId).sort());
      expect(links.every((edge) => edge.origin === 'structural' && edge.provenance?.source === 'brief_extraction')).toBe(true);
    },
  );
  it('leaves option ownership unresolved when two decisions were extracted', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    captured.meaning.entities.push({ ...captured.meaning.entities.find((entity) => entity.ref === 'd1')!, ref: 'd2' });
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    expect(result.graph.edges.some((edge) => edge.to === sourceEntityId('o1')
      && [sourceEntityId('d1'), sourceEntityId('d2')].includes(edge.from))).toBe(false);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'o1', code: 'decision_option_scope_ambiguous' }));
  });
  it('refuses a price-only option linked to churn before writing an edge or setting', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    captured.meaning.entities.push({ ref: 'f3', kind: 'factor', label: 'Monthly churn',
      source: source('Monthly churn must stay below 5%') });
    captured.meaning.options[0].interventions[0].entity_ref = 'f3';
    const churnId = sourceEntityId('f3');
    const optionId = sourceEntityId('o1');
    const wrongRef = compileSourceMeaning(captured.brief, captured.meaning);
    expect(wrongRef.graph.edges.some((edge) => edge.from === optionId && edge.to === churnId)).toBe(false);
    expect(wrongRef.graph.nodes.find((node) => node.id === optionId)?.interventions).toEqual({});
    expect(wrongRef.unresolved).toContainEqual(expect.objectContaining({ code: 'intervention_role_mismatch' }));

    // Even changing the quantity's typed ref cannot turn a price clause into
    // evidence that the option changes churn.
    captured.meaning.quantities.find((claim) => claim.ref === 'q2')!.entity_ref = 'f3';
    const borrowedQuote = compileSourceMeaning(captured.brief, captured.meaning);
    expect(borrowedQuote.graph.edges.some((edge) => edge.from === optionId && edge.to === churnId)).toBe(false);
    expect(borrowedQuote.graph.nodes.find((node) => node.id === optionId)?.interventions).toEqual({});
    expect(borrowedQuote.unresolved).toContainEqual(expect.objectContaining({ ref: 'f3', code: 'intervention_target_source_mismatch' }));
  });
  it('does not turn a separately stated churn limit into an option action through a broad option quote', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    const limit = 'Monthly churn must stay below 5%';
    captured.meaning.entities.push({ ref: 'f3', kind: 'factor', label: 'Monthly churn', source: source(limit) });
    captured.meaning.quantities.find((claim) => claim.ref === 'q5')!.entity_ref = 'f3';
    captured.meaning.entities.find((entity) => entity.ref === 'o1')!.source =
      source(captured.brief.slice(0, captured.brief.indexOf(', and we want')));
    captured.meaning.options[0].interventions[0] = { entity_ref: 'f3', quantity_ref: null, source: source(limit) };

    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const churn = sourceEntityId('f3');
    const option = result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))!;
    expect(result.graph.edges.some((edge) => edge.from === option.id && edge.to === churn)).toBe(false);
    expect(option.interventions).toEqual({});
    expect(result.graph.nodes.find((node) => node.id === churn)?.category).toBe('external');
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'f3', code: 'intervention_source_is_limit' }));
  });
  it('rejects a limit clause even when the limit belongs to another typed ref', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    const limit = 'Monthly churn must stay below 5%';
    captured.meaning.entities.push({ ref: 'f3', kind: 'factor', label: 'Monthly churn', source: source(limit) });
    captured.meaning.entities.find((entity) => entity.ref === 'o1')!.source =
      source(captured.brief.slice(0, captured.brief.indexOf(', and we want')));
    captured.meaning.options[0].interventions[0] = { entity_ref: 'f3', quantity_ref: null, source: source(limit) };

    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const churn = sourceEntityId('f3');
    const option = result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))!;
    expect(result.graph.edges.some((edge) => edge.from === option.id && edge.to === churn)).toBe(false);
    expect(option.interventions).toEqual({});
    expect(result.graph.nodes.find((node) => node.id === churn)?.category).toBe('external');
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'f3', code: 'intervention_source_is_limit' }));
  });
  it('rejects a qualitative intervention that borrows an action across a sentence boundary', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'paul-mrr')!);
    const limit = 'Monthly churn must stay below 5%';
    const broad = captured.brief.slice(0, captured.brief.indexOf(', and we want'));
    captured.meaning.entities.push({ ref: 'f3', kind: 'factor', label: 'Monthly churn', source: source(limit) });
    captured.meaning.quantities.find((claim) => claim.ref === 'q5')!.role = 'evidence';
    captured.meaning.entities.find((entity) => entity.ref === 'o1')!.source = source(broad);
    captured.meaning.options[0].interventions[0] = { entity_ref: 'f3', quantity_ref: null, source: source(broad) };

    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const churn = sourceEntityId('f3');
    const option = result.graph.nodes.find((node) => node.id === sourceEntityId('o1'))!;
    expect(result.graph.edges.some((edge) => edge.from === option.id && edge.to === churn)).toBe(false);
    expect(option.interventions).toEqual({});
    expect(result.graph.nodes.find((node) => node.id === churn)?.category).toBe('external');
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'f3', code: 'intervention_clause_ambiguous' }));
  });
  it('refuses a qualitative action attached to the wrong factor', () => {
    const captured = structuredClone(captures.find((item) => item.case === 'support')!);
    const optionId = sourceEntityId('o1');
    const channelId = sourceEntityId('f1');
    const agentsId = sourceEntityId('f2');
    const supported = compileSourceMeaning(captured.brief, captured.meaning);
    expect(supported.graph.edges).toContainEqual(expect.objectContaining({ from: optionId, to: channelId, origin: 'structural' }));
    captured.meaning.options[0].interventions[0].entity_ref = 'f2';
    const wrong = compileSourceMeaning(captured.brief, captured.meaning);
    expect(wrong.graph.edges.some((edge) => edge.from === optionId && edge.to === agentsId)).toBe(false);
    expect(wrong.graph.nodes.find((node) => node.id === optionId)?.interventions).toEqual({});
    expect(wrong.unresolved).toContainEqual(expect.objectContaining({ ref: 'f2', code: 'intervention_target_source_mismatch' }));
  });
});

describe('source-first provider seam', () => {
  it('uses existing architecture-comparison settings and performs one call with no registration', async () => {
    const { brief, meaning } = pricing();
    const call = vi.fn<CallStructuredModel>(async () => ({ text: JSON.stringify(meaning), usage: { output_tokens: 100 } }));
    const result = await buildSourceFirstModel(brief, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.6-terra', reasoning_effort: 'medium', max_output_tokens: 12000, input: brief });
    expect(result.graph.nodes).toHaveLength(4);
    expect(result.usage).toEqual({ output_tokens: 100 });
  });
  it('refuses a truncated provider result even when its text parses', async () => {
    const { brief, meaning } = pricing();
    await expect(buildSourceFirstModel(brief, async () => ({ text: JSON.stringify(meaning), status: 'incomplete', incomplete_reason: 'max_output_tokens' }))).rejects.toThrow('source_first_incomplete:max_output_tokens');
  });
  it('makes every extraction object strict and every field required', () => {
    const walk = (schema: any): void => {
      if (!schema || typeof schema !== 'object') return;
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties)));
      }
      for (const value of Object.values(schema)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(buildSourceMeaningSchema());
  });
});
