import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../grammar.js';
import { projectDraftRecords } from '../seam.js';
import { projectGraphAndOptionsToV3 } from '../../../transforms/schema-v3.js';
const CHANGE = 'raise prices by 10%';
const RATE = 'Each 1% price rise adds £4 a month.';
const BRIEF = `We could ${CHANGE} or retain our prices. Reach at least £500 a month. ${RATE}`;
function records(): DraftRecordSet {
  return { stated_items: [
    { kind: 'goal', source_quote: 'Reach at least £500 a month.', value: 500, value_literal: '£500', unit: '£/month',
      unit_literals: ['a month'], quantity: 0, role: 'target', direction: 'floor', direction_literal: 'at least' },
    { kind: 'option', source_quote: CHANGE, value: 10, value_literal: '10%', quantity: 1, setting: 'change_by', unit: '%', unit_literals: ['%'] },
    { kind: 'cause', source_quote: RATE, relationship: { from_quantity: 1, to_quantity: 0,
      per_source_change: 1, per_source_literal: '1%', amount: 4, amount_literal: '£4' } },
    { kind: 'option', source_quote: 'retain our prices' },
  ], claims: [{ claim_kind: 'factor', label: 'Price rise', quantity: 1 }] };
}
function compile(r = records(), brief = BRIEF) {
  const p = projectDraftRecords(r, brief); if (!p.ok) throw Error(p.detail);
  const projection = p.projection;
  const lever = projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 1)!;
  const option = projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === CHANGE)!;
  return { projection, lever, option, raw: (option?.data?.raw_interventions as Record<string, number> | undefined)?.[lever?.id] };
}
describe('MC R2 option-own quantity is a change from today only under all three conditions', () => {
  it('RED: the own change_by rate lever is zero, inferred and disclosed through V3', () => {
    const c = compile(); expect(c.raw).toBe(10);
    expect(c.lever.observed_state).toMatchObject({ raw_value: 0, source: 'cee_inference' });
    expect(c.lever.data?.extractionType).toBe('inferred');
    const wire = projectGraphAndOptionsToV3(c.projection.graph as never, { brief: BRIEF });
    expect(wire.graph.nodes.find(n => n.id === c.lever.id)?.description).toBe('a change from today, so today = 0');
    expect(wire.graph.nodes.find(n => n.id === c.lever.id)?.observed_state?.source).toBe('cee_inference');
  });
  it('CONTRAST (i): a figure declaring the quantity prevents zero', () => {
    const r = records(); const quote = 'The price rise is 5% today.';
    r.stated_items.push({ kind: 'figure', source_quote: quote, quantity: 1, value: 5, value_literal: '5%', unit: '%', unit_literals: ['%'], role: 'baseline' });
    const c = compile(r, `${BRIEF} ${quote}`);
    expect(c.lever?.observed_state?.raw_value).not.toBe(0); expect(c.raw).toBe(15);
  });
  it('CONTRAST (i): a target figure prevents zero but cannot supply today’s level', () => {
    const r = records(); const quote = 'The target price rise is 5%.';
    r.stated_items.push({ kind: 'figure', source_quote: quote, quantity: 1, value: 5, value_literal: '5%', unit: '%', unit_literals: ['%'], role: 'target' });
    const c = compile(r, `${BRIEF} ${quote}`);
    expect(c.raw).toBeUndefined();
    expect(c.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 1, reason: 'option_change_by_baseline_unknown' }));
  });
  it('CONTRAST (ii): an identity operand prevents zero', () => {
    const id = compile().lever.id; const r = records();
    r.claims.push({ claim_kind: 'outcome', label: 'Identity result', nonlinear_identity: { operation: 'product', factor_ids: [id], stated_in_brief: true } });
    const c = compile(r); expect(c.raw).toBeUndefined(); expect(c.lever?.observed_state?.raw_value).not.toBe(0);
    expect(c.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 1, reason: 'option_change_by_baseline_unknown' }));
  });
  it('CONTRAST (iii): a rate-less outgoing link prevents zero and keeps the existing ask', () => {
    const r = records(); delete r.stated_items[2]!.relationship!.per_source_change; delete r.stated_items[2]!.relationship!.per_source_literal;
    const c = compile(r); expect(c.raw).toBeUndefined(); expect(c.lever?.observed_state?.raw_value).not.toBe(0);
    expect(c.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 1, reason: 'option_change_by_baseline_unknown' }));
  });
  it('CONTRAST STOCK: £49 today remains the stated level for a £10 change', () => {
    const r = records(); const quote = 'Price is £49 a month today.';
    r.stated_items[1] = { kind: 'option', source_quote: 'raise the price by £10 a month', value: 10, value_literal: '£10', quantity: 4, setting: 'change_by' };
    r.stated_items.push({ kind: 'figure', source_quote: quote, quantity: 4, value: 49, value_literal: '£49', unit: '£/month', unit_literals: ['a month'], role: 'baseline' });
    r.claims[0]!.quantity = 4; r.claims[0]!.value = 49; r.stated_items[2]!.relationship!.from_quantity = 4;
    r.stated_items[2]!.source_quote = 'Each £1 a month price rise adds £4 a month.';
    r.stated_items[2]!.relationship!.per_source_literal = '£1 a month';
    const brief = `${BRIEF} ${quote} raise the price by £10 a month ${r.stated_items[2]!.source_quote}`;
    const p = projectDraftRecords(r, brief); if (!p.ok) throw Error(p.detail);
    const lever = p.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 4)!;
    const option = p.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === r.stated_items[1]!.source_quote)!;
    expect(lever.observed_state?.raw_value).toBe(49);
    expect((option.data?.raw_interventions as Record<string, number>)[lever.id]).toBe(59);
  });
});
