import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../grammar.js';
import { replayRecordSet } from '../replay.js';
import { mergeSentenceLinks } from '../sentence-links.js';
import { buildSentenceInventory } from '../sentence-pass.js';
import { projectGraphAndOptionsToV3 } from '../../../transforms/schema-v3.js';

const CHANGE = 'raise prices by 10%';
const BRIEF = `We could ${CHANGE} or retain our prices. Reach at least £500 a month. Each 1% price rise adds £4 a month.`;
function records(): DraftRecordSet {
  return { stated_items: [
    { kind: 'goal', source_quote: 'Reach at least £500 a month.', value: 500, value_literal: '£500', unit: '£/month',
      unit_literals: ['a month'], quantity: 0, role: 'target', direction: 'floor', direction_literal: 'at least' },
    { kind: 'option', source_quote: CHANGE, value: 10, value_literal: '10%', quantity: 2, setting: 'change_by' },
    { kind: 'change_quantity', source_quote: CHANGE, quantity: 2, quantity_label: 'price rise', unit: '%', unit_literals: ['%'], value_literal: '10%', value_scale: 'raw_count' },
    { kind: 'cause', source_quote: 'Each 1% price rise adds £4 a month.', relationship: {
      from_quantity: 2, to_quantity: 0, per_source_change: 1, per_source_literal: '1%', amount: 4, amount_literal: '£4' } },
    { kind: 'option', source_quote: 'retain our prices' },
  ], claims: [ { claim_kind: 'factor', label: 'Price rise', quantity: 2 } ] };
}
async function compile(r = records(), brief = BRIEF) {
  const c = await replayRecordSet(r, { brief });
  if (!c.ok) throw new Error(`${c.reason}: ${c.detail}`);
  return c;
}
const level = (c: Awaited<ReturnType<typeof compile>>) => c.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 2);
const reasons = (c: Awaited<ReturnType<typeof compile>>) => c.projection.dropped.map(d => d.reason);
const setting = (c: Awaited<ReturnType<typeof compile>>) => c.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === CHANGE)?.data?.raw_interventions;

describe('BUILD science definitional zero, typed increments only', () => {
  it('sizes a typed price-rise change_by from zero and discloses the increment baseline in V3', async () => {
    const c = await compile();
    expect(reasons(c)).not.toContain('option_change_by_baseline_unknown');
    expect(level(c)?.label).toBe('price rise');
    expect(level(c)?.observed_state?.raw_value).toBe(0);
    expect(Object.values(setting(c) as Record<string, number>)).toContain(10);
    const wire = projectGraphAndOptionsToV3(c.graph as never, { brief: BRIEF });
    const factor = wire.graph.nodes.find(n => n.id === level(c)?.id);
    expect(factor?.description).toBe('a change from today, so today = 0');
    expect(factor?.observed_state?.source).toBe('cee_inference');
  });
  it('the sentence pass keeps a corrected percent value and its declared convention together', async () => {
    const r = records();
    r.stated_items[2]!.kind = 'figure';
    r.stated_items[2]!.value_scale = 'unit_interval';
    r.stated_items[1]!.value = 0.1;
    r.stated_items[1]!.value_scale = 'unit_interval';
    const before = await compile(r);
    const inventory = buildSentenceInventory(BRIEF);
    const figure = inventory.figures.find(f => f.literal === '10%')!;
    const merge = mergeSentenceLinks({ brief: BRIEF, main: r, inventory,
      facts: { dropped: before.projection.dropped, dispositions: before.projection.stated_dispositions ?? [] },
      pass: [{ sentence: figure.sentence, role: 'option_setting', kind: 'change_quantity', quantity_label: 'price rise',
        figure: figure.id, quantity_of: figure.id, value: 10, value_literal: '10%', unit: '%', unit_literals: ['%'], value_scale: 'raw_count', setting: 'change_by' }] });
    const after = await compile(merge.records);
    expect(merge.records.stated_items[1]).toMatchObject({ value: 10, value_scale: 'raw_count' });
    expect(reasons(after)).not.toContain('value_scale_restated_conflict');
    expect(reasons(after)).not.toContain('option_change_by_baseline_unknown');
    const option = after.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === CHANGE)!;
    expect(Object.values(option.data?.raw_interventions as Record<string, number>)).toContain(10);
  });
  it('a stock with the same words and quote stays unknown; wording cannot infer the kind', async () => {
    const r = records();
    r.stated_items[2]!.kind = 'figure';
    const c = await compile(r);
    expect(reasons(c)).toContain('option_change_by_baseline_unknown');
    expect(setting(c)).toBeUndefined();
    expect(level(c)?.observed_state?.raw_value).not.toBe(0);
  });
  it('a subscriber stock is not assigned zero', async () => {
    const r = records();
    r.stated_items[2] = { kind: 'figure', source_quote: 'Subscribers may change.', quantity: 2, unit: 'subscribers', unit_literals: ['Subscribers'] };
    r.stated_items[1]!.value = 10; r.stated_items[1]!.value_literal = '10';
    const c = await compile(r, BRIEF + ' Subscribers may change.');
    expect(level(c)?.observed_state?.raw_value).not.toBe(0);
    expect(setting(c)).toBeUndefined();
  });
  it.each(['product', 'ratio'] as const)('a typed %s identity operand stays unknown and the option asks', async operation => {
    const control = await compile();
    const r = records();
    // An option size on the declaring quote is never an identity operand's stock level.
    r.stated_items[2]!.value = 10;
    r.claims.push({ claim_kind: 'outcome', label: 'Identity result', nonlinear_identity: {
      operation, factor_ids: [level(control)!.id], stated_in_brief: true }, quantity: 0 });
    const c = await compile(r);
    expect(reasons(c)).toContain('option_change_by_baseline_unknown');
    expect(setting(c)).toBeUndefined();
    expect(level(c)?.observed_state?.raw_value).not.toBe(0);
    expect(level(c)?.body).toBeUndefined();
  });
  it('an absent or fabricated quote cannot license zero', async () => {
    const r = records(); r.stated_items[2]!.source_quote = 'A made up increment.';
    const c = await compile(r);
    expect(reasons(c)).toContain('literal_absent');
    expect(setting(c)).toBeUndefined();
    expect(level(c)?.observed_state?.raw_value).not.toBe(0);
  });
});
