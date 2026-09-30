import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import { buildSourceMeaningSchema, SourceMeaningSchema, type SourceMeaning, type SourceSpan, type SourceUnit } from './meaning.js';

// Exact 506-character brief recovered from R3 accept-paul/paul-scenario-read.json.
const BRIEF = "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide whether the overhead would be worth it.";
const GOAL = 'I need to accelerate securing funding within the next 2 months.';
const DEALS = "We've been focused on investment firms that do deals between £1-2 million, mostly based in the UK.";
const source = (quote: string): SourceSpan => ({ quote, start: null, end: null });
const GBP: SourceUnit = { kind: 'currency', currency: 'GBP', period: null, counted_object: null, as_stated: '£' };
function funding(): SourceMeaning {
  return {
    entities: [
      { ref: 'funding', kind: 'goal', label: 'securing funding', source: source(GOAL) },
      { ref: 'firm_deal_size', kind: 'factor', label: 'Investment-firm deal size', source: source(DEALS) },
    ],
    entity_metadata: [{
      entity_ref: 'funding', unit: null,
      deadline: { as_stated: 'within the next 2 months', horizon_months: 2, source: source(GOAL) },
    }],
    evidence_ranges: [{ ref: 'firm_deal_range', entity_ref: 'firm_deal_size', literal: '£1-2 million',
      lower_value: '1000000', upper_value: '2000000', unit: GBP, source: source(DEALS) }],
    quantities: [], options: [], definitions: [], causal_claims: [], proposals: [],
    unknowns: [
      { ref: 'funding_target_unknown', entity_refs: ['funding'], question: 'What minimum total funding do you need to secure?', source: source(GOAL) },
      { ref: 'funding_current_unknown', entity_refs: ['funding'], question: 'How much funding have you secured so far?', source: source(GOAL) },
    ],
  };
}
const goal = (result: ReturnType<typeof compileSourceMeaning>) => result.graph.nodes.find((node) => node.id === sourceEntityId('funding'))!;

describe('source-first funding metadata without invented funding numbers', () => {
  it('retains the exact deadline and scoped deal range with no scalar target, baseline, cap or effect', () => {
    expect(BRIEF).toHaveLength(506);
    const result = compileSourceMeaning(BRIEF, funding());
    expect(goal(result)).toMatchObject({ goal_horizon_months: 2, goal_deadline_as_stated: 'within the next 2 months' });
    expect(result.evidence_ranges).toEqual([expect.objectContaining({
      entity_ref: 'firm_deal_size', literal: '£1-2 million', lower_value: 1000000, upper_value: 2000000,
      source: expect.objectContaining({ quote: DEALS }),
    })]);
    const deal = result.graph.nodes.find((node) => node.id === sourceEntityId('firm_deal_size'))!;
    expect(deal.description).toBe(DEALS);
    expect(result.source_bindings.firm_deal_range.quote).toBe(DEALS);
    for (const node of result.graph.nodes) {
      expect(node.observed_state).toBeUndefined();
      expect(node.scale_frame).toBeUndefined();
      expect(node.goal_threshold_raw).toBeUndefined();
      expect(node.goal_threshold_cap).toBeUndefined();
      expect(node.nonlinear_identity).toBeUndefined();
    }
    expect(goal(result).goal_threshold_unit).toBeUndefined();
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.goal_constraints).toBeUndefined();
    expect(result.open_questions).toEqual([
      'What minimum total funding do you need to secure?',
      'How much funding have you secured so far?',
    ]);
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(result.graph)));
    expect(cold.nodes.find((node) => node.id === deal.id)?.description).toBe(DEALS);
    expect(cold.nodes.find((node) => node.id === goal(result).id)?.goal_horizon_months).toBe(2);
  });

  it('retains contextual GBP as a private Olumi reading pending the shared unit-source contract', () => {
    const meaning = funding();
    meaning.entity_metadata![0].unit = { value: GBP, authorship: 'interpretation', source: source(DEALS) };
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(result.contextual_unit_readings).toEqual([expect.objectContaining({
      entity_ref: 'funding', authorship: 'olumi_reading', unit: GBP, source: expect.objectContaining({ quote: DEALS }),
    })]);
    expect(goal(result).goal_threshold_unit).toBeUndefined();
    expect(goal(result).goal_horizon_months).toBe(2);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'contextual_unit_pending_contract' }));
  });

  it('does not promote the deal-size currency into an explicitly authored total-funding unit', () => {
    const meaning = funding();
    meaning.entity_metadata![0].unit = { value: GBP, authorship: 'explicit', source: source(DEALS) };
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(goal(result).goal_threshold_unit).toBeUndefined();
    expect(result.contextual_unit_readings).toEqual([]);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'entity_unit_scope_unverified' }));
  });

  it('can retain an explicitly stated goal unit without a numeric target or current level', () => {
    const brief = 'We measure total funding in GBP within the next 2 months.';
    const meaning = funding();
    meaning.entities = [{ ref: 'funding', kind: 'goal', label: 'Total funding', source: source(brief) }];
    meaning.entity_metadata![0] = { entity_ref: 'funding',
      unit: { value: { ...GBP, as_stated: 'GBP' }, authorship: 'explicit', source: source(brief) },
      deadline: { as_stated: 'within the next 2 months', horizon_months: 2, source: source(brief) } };
    meaning.evidence_ranges = [];
    meaning.unknowns = [];
    const result = compileSourceMeaning(brief, meaning);
    expect(goal(result)).toMatchObject({ goal_threshold_unit: 'GBP', goal_horizon_months: 2 });
    expect(goal(result).goal_threshold_raw).toBeUndefined();
    expect(goal(result).observed_state).toBeUndefined();
    expect(result.unresolved).toEqual([]);
  });

  it.each(['1', '1500000', '2000000'])('rejects a wrong lower endpoint %s instead of repairing the range', (lower_value) => {
    const meaning = funding();
    meaning.evidence_ranges![0].lower_value = lower_value;
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(result.evidence_ranges).toEqual([]);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'evidence_range_not_grounded' }));
  });

  it('does not reassign the firm deal range to the total-funding goal', () => {
    const meaning = funding();
    meaning.evidence_ranges![0].entity_ref = 'funding';
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(result.evidence_ranges).toEqual([]);
    expect(goal(result).description).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'evidence_range_not_grounded' }));
  });

  it('does not read the lower token of a shared-scale range as a scalar funding target', () => {
    const meaning = funding();
    meaning.quantities = [{ ref: 'false_target', entity_ref: 'funding', role: 'target',
      frame: 'level', direction: 'none', number: { literal: '£1', value: '1', source: source(DEALS) },
      unit: GBP, comparator: '>=', horizon_months: null }];
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(goal(result).goal_threshold_raw).toBeUndefined();
    expect(goal(result).goal_threshold_cap).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'false_target', code: 'number_not_grounded' }));
  });

  it('does not convert zero months into an invented one-month deadline', () => {
    const brief = 'We need funding within 0 months.';
    const meaning = funding();
    meaning.entities = [{ ref: 'funding', kind: 'goal', label: 'Funding', source: source(brief) }];
    meaning.entity_metadata![0].deadline = { as_stated: 'within 0 months', horizon_months: 1, source: source(brief) };
    meaning.evidence_ranges = [];
    expect(goal(compileSourceMeaning(brief, meaning)).goal_horizon_months).toBeUndefined();
  });

  it.each([3, 24])('rejects an invented %s-month horizon while retaining the funding entity', (horizon_months) => {
    const meaning = funding();
    meaning.entity_metadata![0].deadline!.horizon_months = horizon_months;
    const result = compileSourceMeaning(BRIEF, meaning);
    expect(goal(result).goal_horizon_months).toBeUndefined();
    expect(goal(result).goal_deadline_as_stated).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ code: 'entity_deadline_not_grounded' }));
  });

  it('rejects a deadline bound to a different entity clause', () => {
    const meaning = funding();
    meaning.entity_metadata![0].deadline!.source = source(DEALS);
    expect(goal(compileSourceMeaning(BRIEF, meaning)).goal_horizon_months).toBeUndefined();
  });

  it('keeps old frozen meaning parseable and requires both new channels on new structured output', () => {
    const old = funding();
    delete old.entity_metadata;
    delete old.evidence_ranges;
    expect(SourceMeaningSchema.safeParse(old).success).toBe(true);
    const schema = buildSourceMeaningSchema();
    expect(schema.required).toEqual(expect.arrayContaining(['entity_metadata', 'evidence_ranges']));
  });
});
