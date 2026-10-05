import { describe, expect, it } from 'vitest';
import type { DraftRecordSet, DraftStatedItem } from '../grammar.js';
import { replayRecordSet } from '../replay.js';
import { projectGraphAndOptionsToV3 } from '../../../transforms/schema-v3.js';

// Offline BUILD controls: the sentence is sealed; the two typed representations are deliberately distinct inputs.
const GOAL = 'Reach at least 2,000 subscribers.';
const OPTION = 'launch the starter tier at £49 a month';
const OTHER_OPTION = 'keep the current plans';
const BASELINE = 'Organic acquisition brings 50 new subscribers.';
const EFFECT = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const LOSS = 'The new plan would lose 150 of our 1,200 subscribers.';
const STOCK_BASELINE = 'We have 1,200 subscribers.';
type Door = 'option_effect' | 'cause';

function fixture(door: Door, mode: 'baseline' | 'zero' | 'loss' = 'baseline') {
  const quote = mode === 'loss' ? LOSS : EFFECT;
  const baseline = mode === 'loss' ? STOCK_BASELINE : BASELINE;
  const optionQuote = mode === 'loss' ? 'launch the new plan at £49 a month' : OPTION;
  const amount = mode === 'loss' ? -150 : 150;
  const range = mode === 'loss' ? undefined
    : { low: 80, high: 250, low_literal: '80', high_literal: '250', meaning: 'min_max' as const };
  const quantity: DraftStatedItem = mode === 'zero'
    ? { kind: 'change_quantity', source_quote: quote, quantity: 2, quantity_label: 'new subscribers',
      unit: 'subscribers', unit_literals: ['subscribers'], value_scale: 'raw_count' }
    : { kind: 'figure', source_quote: baseline, quantity: 2, value: mode === 'loss' ? 1200 : 50,
      value_literal: mode === 'loss' ? '1,200' : '50', unit: 'subscribers', unit_literals: ['subscribers'], role: 'baseline' };
  const records: DraftRecordSet = {
    stated_items: [
      { kind: 'goal', source_quote: GOAL, quantity: 0, value: 2000, value_literal: '2,000',
        unit: 'subscribers', unit_literals: ['subscribers'], direction: 'floor', direction_literal: 'at least', role: 'target' },
      { kind: 'option', source_quote: optionQuote, quantity: 1, value: 49, value_literal: '£49',
        unit: '£/month', unit_literals: ['£49', 'a month'] },
      quantity,
      door === 'option_effect'
        ? { kind: 'option_effect', source_quote: quote, option_effect: { option: 1, quantity: 2, change_by: amount,
          value_literal: mode === 'loss' ? '150' : 'about 150', ...(range === undefined ? {} : { range }) } }
        : { kind: 'cause', source_quote: quote, relationship: { from_quantity: 1, to_quantity: 2, amount,
          amount_literal: mode === 'loss' ? '150' : 'about 150', ...(range === undefined ? {} : { range }) } },
      { kind: 'option', source_quote: OTHER_OPTION },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Subscriber quantity', quantity: 2,
        ...(mode === 'zero' ? {} : { value: mode === 'loss' ? 1200 : 50, basis: [2] }) },
      { claim_kind: 'factor', label: 'Starter option price', quantity: 1 },
      { claim_kind: 'causal_link', label: 'Subscriber quantity contributes to the goal', from_claim: 0, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Price contributes to the goal', from_claim: 1, to_stated: 0, effect: 'positive' },
    ],
  };
  const brief = `${GOAL} ${mode === 'zero' ? '' : baseline} We could ${optionQuote} or ${OTHER_OPTION}. ${quote}`;
  return { records, brief, quote, optionQuote };
}

async function compile(input = fixture('cause')) {
  const result = await replayRecordSet(input.records, { brief: input.brief });
  if (!result.ok) throw new Error(result.detail);
  const option = result.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === input.optionQuote);
  const target = result.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 2);
  const source = result.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 1);
  if (option === undefined || target === undefined || source === undefined) throw new Error('Missing fixture identity');
  const wire = projectGraphAndOptionsToV3(result.graph as never, { brief: input.brief });
  return { result, option, target, source, wire, input };
}

function targetIntervention(c: Awaited<ReturnType<typeof compile>>, optionId = c.option.id) {
  return c.wire.options.find(o => o.id === optionId)?.interventions[c.target.id];
}

function rawTarget(c: Awaited<ReturnType<typeof compile>>, optionId = c.option.id) {
  const option = c.result.projection.graph.nodes.find(n => n.id === optionId);
  return (option?.data?.raw_interventions as Record<string, number> | undefined)?.[c.target.id];
}

describe('BUILD second door to the same option effect compile', () => {
  it.each<Door>(['option_effect', 'cause'])('%s door preserves organic baseline: 50 + 150 = 200, keyed by node ID', async door => {
    const c = await compile(fixture(door));
    expect(rawTarget(c)).toBe(200);
    expect(targetIntervention(c)).toMatchObject({ raw_value: 200, change_by: 150, unit: 'subscribers',
      source: 'brief_extraction', value_confidence: 'high',
      range: { low: 130, high: 300, meaning: 'min_max', source: 'brief_extraction', source_quote: EFFECT } });
    expect(targetIntervention(c)?.reasoning).toContain(EFFECT);
    expect(c.result.projection.stated_dispositions).toContainEqual(expect.objectContaining({ stated_index: 3,
      disposition: 'carried', location: { kind: 'node', node_id: c.option.id,
        path: ['data', 'intervention_details', c.target.id, 'change_by'] }, stored_value: 150 }));
    const other = c.wire.options.find(o => o.id !== c.option.id)!;
    expect(targetIntervention(c, other.id)).toBeUndefined();
    expect(c.target.observed_state?.raw_value ?? c.target.observed_state?.value ?? c.target.data?.value).toBe(50);
  });

  it('both doors give the same intervention on the same sealed sentence and identities', async () => {
    const typed = await compile(fixture('option_effect'));
    const cause = await compile(fixture('cause'));
    expect(cause.option.id).toBe(typed.option.id);
    expect(cause.target.id).toBe(typed.target.id);
    expect(targetIntervention(cause)).toEqual(targetIntervention(typed));
    const pairs = (c: Awaited<ReturnType<typeof compile>>) => c.result.projection.graph.edges.map(e => [e.from, e.to]).sort();
    expect(pairs(cause)).toEqual(pairs(typed));
    expect(cause.result.projection.graph.edges.some(e => e.from === cause.option.id && e.to === cause.target.id)).toBe(false);
    expect(cause.result.projection.graph.edges.some(e => e.from === cause.source.id && e.to === cause.target.id)).toBe(false);
  });

  it.each<Door>(['option_effect', 'cause'])('%s door uses only definitional-zero change_quantity: 0 + 150 = 150', async door => {
    const c = await compile(fixture(door, 'zero'));
    expect(rawTarget(c)).toBe(150);
    expect(targetIntervention(c)).toMatchObject({ raw_value: 150, change_by: 150,
      range: { low: 80, high: 250, source_quote: EFFECT } });
    expect(c.target.observed_state).toMatchObject({ raw_value: 0, source: 'cee_inference' });
  });

  it.each<Door>(['option_effect', 'cause'])('%s door loss is -150 on the 1,200 stock = 1,050, keyed by node ID', async door => {
    const c = await compile(fixture(door, 'loss'));
    expect(rawTarget(c)).toBe(1050);
    expect(targetIntervention(c)).toMatchObject({ raw_value: 1050, change_by: -150, source: 'brief_extraction', unit: 'subscribers' });
    expect(targetIntervention(c)?.raw_value).not.toBe(150);
    expect(targetIntervention(c)?.reasoning).toContain(LOSS);
    expect(c.target.observed_state?.raw_value ?? c.target.observed_state?.value ?? c.target.data?.value).toBe(1200);
  });

  it('two options setting the same source lever leave the rate-less cause unsized and asked', async () => {
    const input = fixture('cause');
    const otherQuote = 'launch the alternative tier at £59 a month';
    input.records.stated_items[4] = { kind: 'option', source_quote: otherQuote, quantity: 1, value: 59, value_literal: '£59' };
    input.brief = input.brief.replace(OTHER_OPTION, otherQuote);
    const c = await compile(input);
    expect(rawTarget(c)).toBeUndefined();
    for (const option of c.wire.options) expect(targetIntervention(c, option.id)).toBeUndefined();
    expect(c.result.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 3, reason: 'relationship_unsized' }));
    expect(c.result.projection.stated_dispositions).toContainEqual(expect.objectContaining({ stated_index: 3,
      disposition: 'rejected', reason: 'relationship_unsized' }));
    expect(c.result.records.stated_items[3]!.relationship).toMatchObject({ from_quantity: 1, to_quantity: 2, amount: 150 });
    expect(c.result.records.stated_items[3]!.kind).toBe('cause');
  });

  it('dropping the owning option lever binding closes door 2', async () => {
    const input = fixture('cause');
    delete input.records.stated_items[1]!.quantity;
    const c = await compile(input);
    expect(rawTarget(c)).toBeUndefined();
    expect(targetIntervention(c)).toBeUndefined();
    expect(c.result.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 3, reason: 'relationship_unsized' }));
  });

  it('a typed per-source rate remains a quantity relationship and never becomes the target intervention', async () => {
    const input = fixture('cause');
    const quote = 'Each 1% price rise adds £1,200 a month.';
    const baseline = 'Current monthly revenue is £50,000 a month.';
    const optionQuote = 'raise prices by 10%';
    input.optionQuote = optionQuote;
    input.quote = quote;
    input.brief = `Reach at least £100,000 a month. ${baseline} We could ${optionQuote} or ${OTHER_OPTION}. ${quote}`;
    input.records.stated_items[0] = { kind: 'goal', source_quote: 'Reach at least £100,000 a month.', quantity: 0,
      value: 100000, value_literal: '£100,000', unit: '£/month', unit_literals: ['£100,000', 'a month'],
      direction: 'floor', direction_literal: 'at least', role: 'target' };
    input.records.stated_items[1] = { kind: 'option', source_quote: optionQuote, quantity: 1, value: 10, value_literal: '10%',
      unit: '%', unit_literals: ['10%'], value_scale: 'percent_0_100' };
    input.records.stated_items[2] = { kind: 'figure', source_quote: baseline, quantity: 2, value: 50000, value_literal: '£50,000',
      unit: '£/month', unit_literals: ['£50,000', 'a month'], role: 'baseline' };
    input.records.stated_items[3] = { kind: 'cause', source_quote: quote, relationship: { from_quantity: 1, to_quantity: 2,
      amount: 1200, amount_literal: '£1,200', per_source_change: 1, per_source_literal: '1%' } };
    Object.assign(input.records.claims[0]!, { value: 50000, basis: [2] });
    const c = await compile(input);
    expect(rawTarget(c)).toBeUndefined();
    expect(targetIntervention(c)).toBeUndefined();
    const relationship = c.result.projection.graph.edges.find(e => e.from === c.source.id && e.to === c.target.id);
    expect(relationship?.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: quote,
      natural_effect: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' } });
    expect(c.result.records.stated_items[3]!.kind).toBe('cause');
    expect(c.result.records.stated_items[3]!.relationship).toMatchObject({ per_source_change: 1 });
  });

  it.each<Door>(['option_effect', 'cause'])('%s door asks for a stock baseline instead of inferring zero', async door => {
    const input = fixture(door);
    delete input.records.stated_items[2]!.value;
    delete input.records.stated_items[2]!.value_literal;
    delete input.records.claims[0]!.value;
    const c = await compile(input);
    expect(targetIntervention(c)).toBeUndefined();
    expect(c.result.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 3, reason: 'option_change_by_baseline_unknown' }));
  });

  it('an option-effect amount on its target cause is not a baseline: the live context shape must never read 150 + 150', async () => {
    const input = fixture('cause');
    input.brief = input.brief.replace(BASELINE, '');
    input.records.stated_items[2] = { kind: 'cause', source_quote: EFFECT, quantity: 2,
      value: 150, value_literal: 'about 150', unit: 'subscribers', unit_literals: ['subscribers'] };
    Object.assign(input.records.claims[0]!, { value: 150, basis: [2] });
    const c = await compile(input);
    expect(rawTarget(c)).toBeUndefined();
    expect(targetIntervention(c)).toBeUndefined();
    expect(rawTarget(c)).not.toBe(300);
    expect(c.result.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 3,
      reason: 'option_change_by_baseline_unknown' }));
  });

  it('a unit_interval percentage target converts the baseline and delta only once', async () => {
    const input = fixture('cause');
    const baseline = 'Current conversion rate is 20%.';
    const quote = 'The starter tier would increase conversion by 5%, between 3% and 8%.';
    input.brief = input.brief.replace(BASELINE, baseline).replace(EFFECT, quote);
    input.records.stated_items[2] = { kind: 'figure', source_quote: baseline, quantity: 2,
      value: 0.2, value_literal: '20%', unit: '%', unit_literals: ['20%'], value_scale: 'unit_interval', role: 'baseline' };
    input.records.stated_items[3] = { kind: 'cause', source_quote: quote, relationship: { from_quantity: 1, to_quantity: 2,
      amount: 0.05, amount_literal: '5%', range: { low: 0.03, high: 0.08,
        low_literal: '3%', high_literal: '8%', meaning: 'min_max' } } };
    Object.assign(input.records.claims[0]!, { value: 0.2, basis: [2], value_scale: 'unit_interval' });
    const c = await compile(input);
    expect(rawTarget(c)).toBe(25);
    expect(targetIntervention(c)).toMatchObject({ raw_value: 25, change_by: 5, unit: '%', source: 'brief_extraction',
      range: { low: 23, high: 28, source_quote: quote } });
  });

  it.each<Door>(['option_effect', 'cause'])('%s door refuses conflicting legacy spans and literals', async door => {
    const input = fixture(door);
    input.records.stated_items[3]!.evidence_conflicts = ['span_and_literal_both'];
    const c = await compile(input);
    expect(rawTarget(c)).toBeUndefined();
    expect(targetIntervention(c)).toBeUndefined();
    expect(c.result.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 3, reason: 'span_and_literal_both' }));
  });

  it.each<Door>(['option_effect', 'cause'])('%s door retains the same quote validator', async door => {
    const input = fixture(door);
    input.brief = input.brief.replace(EFFECT, 'No option effect is specified.');
    const c = await compile(input);
    expect(targetIntervention(c)).toBeUndefined();
  });

  it.each<Door>(['option_effect', 'cause'])('%s door retains the same unit validator', async door => {
    const input = fixture(door);
    input.records.stated_items[2]!.unit = '%';
    const c = await compile(input);
    expect(targetIntervention(c)).toBeUndefined();
  });

  it.each<Door>(['option_effect', 'cause'])('%s door refuses an effect amount absent from its quoted literal', async door => {
    const input = fixture(door);
    if (door === 'option_effect') input.records.stated_items[3]!.option_effect!.change_by = 151;
    else input.records.stated_items[3]!.relationship!.amount = 151;
    const c = await compile(input);
    expect(targetIntervention(c)).toBeUndefined();
  });

  it('keeps an explicitly typed, quoted stated level as sets_to', async () => {
    const input = fixture('option_effect');
    const quote = 'Staff the starter tier at 100 subscribers.';
    input.brief = input.brief.replace(EFFECT, quote);
    input.records.stated_items[3] = { kind: 'option_effect', source_quote: quote,
      option_effect: { option: 1, quantity: 2, sets_to: 100, value_literal: '100' } };
    const c = await compile(input);
    const intervention = targetIntervention(c);
    expect(intervention).toMatchObject({ raw_value: 100, unit: 'subscribers', source: 'brief_extraction' });
    expect(intervention).not.toHaveProperty('change_by');
    expect(intervention?.reasoning).toContain(quote);
  });
});
