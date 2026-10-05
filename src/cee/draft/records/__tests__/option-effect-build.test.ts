import { describe, expect, it } from 'vitest';
import type { DraftRecordSet, DraftStatedItem } from '../grammar.js';
import { replayRecordSet } from '../replay.js';
import { projectDraftRecords } from '../seam.js';
import { projectGraphAndOptionsToV3 } from '../../../transforms/schema-v3.js';

// BUILD rows: hand-authored controls, no provider calls or borrowed oracle records.
const GOAL = 'Reach at least 1,000 subscribers.';
const OPTION = 'launch the starter tier';
const OTHER_OPTION = 'keep the current plans';
const EFFECT = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const BRIEF = `${GOAL} We could ${OPTION} or ${OTHER_OPTION}. ${EFFECT}`;

function records(): DraftRecordSet {
  return {
    stated_items: [
      { kind: 'goal', source_quote: GOAL, value: 1000, value_literal: '1,000', unit: 'subscribers',
        unit_literals: ['subscribers'], quantity: 0, direction: 'floor', direction_literal: 'at least', role: 'target' },
      { kind: 'option', source_quote: OPTION },
      { kind: 'change_quantity', source_quote: EFFECT, quantity: 2, quantity_label: 'new subscribers',
        unit: 'subscribers', unit_literals: ['subscribers'], value_scale: 'raw_count' },
      { kind: 'option_effect', source_quote: EFFECT, option_effect: {
        option: 1, quantity: 2, sets_to: 150, value_literal: 'about 150',
        range: { low: 80, high: 250, low_literal: '80', high_literal: '250', meaning: 'min_max' },
      } },
      { kind: 'option', source_quote: OTHER_OPTION },
    ],
    claims: [
      { claim_kind: 'factor', label: 'New subscribers', quantity: 2 },
      { claim_kind: 'causal_link', label: 'Subscribers contribute to the goal', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  };
}

async function compile(r = records(), brief = BRIEF) {
  const result = await replayRecordSet(r, { brief });
  if (!result.ok) throw new Error(result.detail);
  const option = result.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === OPTION);
  const factor = result.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 2);
  if (option === undefined || factor === undefined) throw new Error('The control option or quantity is absent');
  const wire = projectGraphAndOptionsToV3(result.graph as never, { brief });
  return { result, option, factor, wire };
}

function rawFor(c: Awaited<ReturnType<typeof compile>>, option = c.option) {
  return (option.data as { raw_interventions?: Record<string, number> } | undefined)?.raw_interventions?.[c.factor.id];
}

describe('BUILD option→quantity effects through the records replay and V3 intervention consumer', () => {
  it('sets only its bound option to the stated effect, with a raw range and quoted brief authority', async () => {
    const c = await compile();
    expect(rawFor(c)).toBe(150);
    const other = c.result.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === OTHER_OPTION)!;
    expect(rawFor(c, other)).toBeUndefined();
    const starter = c.wire.options.find(o => o.id === c.option.id)!;
    const intervention = Object.values(starter.interventions).find(i => i.raw_value === 150);
    expect(intervention).toMatchObject({
      raw_value: 150, unit: 'subscribers', source: 'brief_extraction', value_confidence: 'high',
      range: { low: 80, high: 250, meaning: 'min_max', source: 'brief_extraction', source_quote: EFFECT },
    });
    expect(intervention?.reasoning).toContain(EFFECT);
    // The source option has no number; the quote cannot earn authority via an invented numeric source endpoint.
    expect(records().stated_items[3]!.relationship).toBeUndefined();
    expect(records().stated_items[3]!.option_effect).not.toHaveProperty('per_source_change');
  });

  it('adds neither a causal link nor an option→goal edge to compile an intervention', async () => {
    const control = records();
    delete control.stated_items[3]!.option_effect;
    const before = await compile(control);
    const after = await compile();
    const pairs = (c: Awaited<ReturnType<typeof compile>>) => c.result.projection.graph.edges.map(e => [e.from, e.to]).sort();
    expect(pairs(after)).toEqual(pairs(before));
    expect(after.result.projection.graph.edges.filter(e => e.from === after.option.id)).toEqual([]);
  });

  it('keeps a world figure as its factor level without turning it into an option intervention', async () => {
    const quote = 'The market has 150 prospects.';
    const r = records();
    r.stated_items[2] = { kind: 'figure', source_quote: quote, quantity: 2, value: 150, value_literal: '150',
      unit: 'prospects', unit_literals: ['prospects'], role: 'baseline' };
    delete r.stated_items[3]!.option_effect;
    r.stated_items[3]!.source_quote = quote;
    r.claims = [{ claim_kind: 'causal_link', label: 'Prospects contribute to the goal',
      from_stated: 2, to_stated: 0, effect: 'positive' }];
    const c = await compile(r, BRIEF.replace(EFFECT, quote));
    expect(c.factor.observed_state?.raw_value ?? c.factor.observed_state?.value ?? c.factor.data?.value).toBe(150);
    expect(rawFor(c)).toBeUndefined();
  });

  it('shifts a stated stock baseline and its range in raw units for change_by', async () => {
    const baseline = 'We have 20 subscribers.';
    const quote = 'The starter tier would win about 15 subscribers, between 12 and 18.';
    const r = records();
    r.stated_items[2] = { kind: 'figure', source_quote: baseline, quantity: 2, value: 20, value_literal: '20',
      unit: 'subscribers', unit_literals: ['subscribers'], role: 'baseline' };
    r.stated_items[3] = { kind: 'option_effect', source_quote: quote, option_effect: {
      option: 1, quantity: 2, change_by: 15, value_literal: 'about 15',
      range: { low: 12, high: 18, low_literal: '12', high_literal: '18', meaning: 'likely_range' },
    } };
    Object.assign(r.claims[0]!, { value: 20, basis: [2] });
    const c = await compile(r, `${baseline} ${BRIEF.replace(EFFECT, quote)}`);
    expect(rawFor(c)).toBe(35);
    const starter = c.wire.options.find(o => o.id === c.option.id)!;
    const intervention = Object.values(starter.interventions).find(i => i.raw_value === 35);
    expect(intervention).toMatchObject({ raw_value: 35, change_by: 15, source: 'brief_extraction',
      range: { low: 32, high: 38, meaning: 'likely_range', source: 'brief_extraction', source_quote: quote } });
    expect(intervention?.reasoning).toContain(quote);
  });

  it('asks for today when a stock change_by has no stated baseline', async () => {
    const r = records();
    r.stated_items[2] = { kind: 'figure', source_quote: EFFECT, quantity: 2, unit: 'subscribers', unit_literals: ['subscribers'] };
    delete r.stated_items[3]!.option_effect!.sets_to;
    r.stated_items[3]!.option_effect!.change_by = 150;
    const c = await compile(r);
    expect(rawFor(c)).toBeUndefined();
    expect(c.result.projection.dropped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'option_change_by_baseline_unknown' })]));
  });

  it('rejects dropping the explicit option binding rather than borrowing the world figure', () => {
    const r = records();
    delete (r.stated_items[3]!.option_effect as Partial<NonNullable<DraftStatedItem['option_effect']>>).option;
    const seam = projectDraftRecords(r, BRIEF);
    expect(seam.ok).toBe(false);
  });

  it.each([
    ['a quantity record used as the option', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.option = 2; }],
    ['an option reference outside the record set', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.option = 99; }],
    ['a goal used as the intervention quantity', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.quantity = 0; }],
    ['a missing intervention quantity', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.quantity = 99; }],
    ['a transcribed value absent from its quote', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.sets_to = 151; }],
    ['a unit contradicted by its own evidence', (r: DraftRecordSet) => { r.stated_items[2]!.unit = '%'; }],
    ['a unit declaration without its quoted evidence', (r: DraftRecordSet) => { r.stated_items[2]!.unit_literals = []; }],
    ['an unquoted low range bound', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.range!.low = 90; }],
    ['a reversed range', (r: DraftRecordSet) => { const range = r.stated_items[3]!.option_effect!.range!; range.low = 250; range.high = 80; }],
    ['both setting operators on one effect', (r: DraftRecordSet) => { r.stated_items[3]!.option_effect!.change_by = 150; }],
  ])('refuses %s', async (_name, mutate) => {
    const r = records();
    mutate(r);
    const c = await compile(r);
    expect(rawFor(c)).toBeUndefined();
  });

  it('withholds the intervention when its quote is not in the supplied brief', async () => {
    const c = await compile(records(), BRIEF.replace(EFFECT, 'The effect has not been specified.'));
    expect(rawFor(c)).toBeUndefined();
  });
});
