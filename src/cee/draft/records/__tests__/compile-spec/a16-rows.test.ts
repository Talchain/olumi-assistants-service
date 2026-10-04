import { describe, expect, it } from 'vitest';
import { projectDraftRecords } from '../../seam.js';
import { projectRecordsToGraph, sha8, type RecordProjection } from '../../projector.js';
import { statedEffectQuoteMatches } from '../../../../provenance/stated-effect.js';
import { BRIEF, sealedRecords } from './sealed-fixture.js';
import { deriveNotModelledManifest } from '../../../../context-integrity/not-modelled-manifest.js';

function project(records = sealedRecords()): RecordProjection {
  const result = projectDraftRecords(records, BRIEF);
  if (!result.ok) throw new Error(result.detail);
  return result.projection;
}

describe('A16 structural compile rows', () => {
  it('A1 gives every stated index one disposition and rejects an option value without a carrier', () => {
    const p = project();
    const rows = (p as RecordProjection & { stated_dispositions?: readonly { stated_index: number; disposition: string; reason?: string }[] }).stated_dispositions;
    expect(rows).toHaveLength(16);
    expect(rows!.map(row => row.stated_index)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(rows![4]).toMatchObject({ stated_index: 4, disposition: 'rejected', reason: 'stated_value_not_carried' });
  });
  it('A1 never reports a carried goal threshold as dropped', () => {
    const goalId = sha8('goal', sealedRecords().stated_items[6]!.source_quote);
    expect(project().dropped.filter(row => row.node_id === goalId && row.reason === 'stated_target_value_dropped')).toEqual([]);
  });
  it('A1 a numeric label echo does not admit a quantity', () => {
    const manifest = deriveNotModelledManifest('Budget is £17.', { nodes: [{ id: 'f_budget', kind: 'factor', label: 'Budget is £17.' }], edges: [] });
    expect(manifest.quantities?.items.find(row => row.literal === '£17')?.verdict).toBe('prose_only');
  });
  it('A2 keeps a typed quantity factor separate from its cited cause', () => {
    const r = sealedRecords(); r.claims[0]!.basis = [8];
    const factor = project(r).graph.nodes.find(node => node.id === sha8('factor', 'Price rise'));
    expect(factor).toMatchObject({ kind: 'factor', quantity_ref: 8, data: { value: 0, unit: '%' } });
  });
  it('A3 takes the unit from the referenced quantity rather than the claim', () => {
    const r = sealedRecords(); r.claims[3]!.unit = 'USD/month';
    expect(project(r).graph.nodes.find(node => node.id === sha8('outcome', 'Monthly recurring revenue'))?.data?.unit).toBe('£/month');
  });
  it('A3 a stated goal also uses the unit of its typed quantity', () => {
    const r = sealedRecords(); r.stated_items[6]!.unit = 'USD/month';
    expect(project(r).graph.nodes.find(node => node.kind === 'goal')?.goal_threshold_unit).toBe('£/month');
  });
  it('A4 unifies a goal quantity with its explicit baseline reference', () => {
    const r = sealedRecords(); r.stated_items[6]!.quantity = 6;
    const goal = project(r).graph.nodes.find(node => node.kind === 'goal');
    expect(goal).toMatchObject({ quantity_ref: 0, goal_baseline_raw: 120000, goal_threshold_raw: 150000 });
    expect(project(r).graph.nodes.find(node => node.id === sha8('outcome', 'Monthly recurring revenue'))?.scale_frame).toBe(187500);
  });
  it('A4 does not select a last-writer identity when two goals give conflicting aliases', () => {
    const r = {
      stated_items: [
        { kind: 'figure', source_quote: 'Alpha is £10.', value: 10, unit: '£', role: 'baseline' },
        { kind: 'figure', source_quote: 'Beta is £11.', value: 11, unit: '£', role: 'baseline' },
        { kind: 'goal', source_quote: 'Reach £20.', value: 20, unit: '£', role: 'target', quantity: 2, baseline_ref: 0 },
        { kind: 'goal', source_quote: 'Reach £30.', value: 30, unit: '£', role: 'target', quantity: 2, baseline_ref: 1 },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Ambiguous measurement', quantity: 2, value: 0, unit: '£' },
        { claim_kind: 'causal_link', label: 'Measurement to first goal', from_claim: 0, to_stated: 2, effect: 'positive' },
      ],
    } satisfies import('../../grammar.js').DraftRecordSet;
    const p = projectRecordsToGraph(r);
    expect(p.graph.nodes.find(n => n.id === sha8('factor', 'Ambiguous measurement'))?.quantity_ref).toBe(2);
    expect(p.graph.nodes.find(n => n.id === sha8('goal', 'Reach £20.'))?.quantity_ref).toBe(0);
    expect(p.graph.nodes.find(n => n.id === sha8('goal', 'Reach £30.'))?.quantity_ref).toBe(1);
  });
  it('A5 retains the independently bound horizon without a target value', () => {
    const r = sealedRecords(); delete r.stated_items[6]!.value;
    expect(project(r).graph.nodes.find(node => node.kind === 'goal')?.goal_horizon_months).toBe(9);
  });
  it('A5 keeps horizon evidence in months when a quantity alias controls the emitted node unit', () => {
    const r = sealedRecords(); r.stated_items[7]!.quantity = 6;
    expect(project(r).graph.nodes.find(node => node.kind === 'goal')?.goal_horizon_months).toBe(9);
  });
  it('A6 admits a signed negative unit change located by Each', () => {
    const quote = 'Each lost customer reduces revenue by £300 a month.';
    const detail = { amount: -300, amount_unit: '£/month', per_source_change: -1, per_source_change_unit: 'customers' };
    const amount = quote.indexOf('£300');
    expect(statedEffectQuoteMatches(quote, detail, { ...detail, from_quantity: 0, to_quantity: 1, amount_span: { start: amount, end: amount + 4 }, source_span: { start: 0, end: 4 } })).toBe(true);
    expect(statedEffectQuoteMatches(quote, { ...detail, per_source_change: -2 }, { ...detail, per_source_change: -2, from_quantity: 0, to_quantity: 1, amount_span: { start: amount, end: amount + 4 }, source_span: { start: 0, end: 4 } })).toBe(false);
  });
  it('A6 includes the noun suffix after two qualifiers', () => {
    const quote = 'Each newly lost customer removes £300 a month.';
    const detail = { amount: -300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'customers' };
    const amount = quote.indexOf('£300');
    expect(statedEffectQuoteMatches(quote, detail, { ...detail, from_quantity: 0, to_quantity: 1, amount_span: { start: amount, end: amount + 4 }, source_span: { start: 0, end: 4 } })).toBe(true);
  });
});
