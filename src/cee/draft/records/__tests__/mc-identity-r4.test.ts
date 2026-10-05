import { describe, expect, it } from 'vitest';
import { reconcileStatedDispositions, type StatedDisposition } from '../stated-dispositions.js';
import { deriveNotModelledManifest } from '../../../context-integrity/not-modelled-manifest.js';
const QUOTE = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const natural = { amount: -2, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: '%', strength_mean: -0.2, strength_mean_frame: 'edge_strength' };
const relation = { from_quantity: 3, to_quantity: 1, amount: -2, amount_unit: 'customers', amount_literal: 'about 2',
  per_source_change: 1, per_source_change_unit: '%', per_source_literal: '1%',
  amount_span: { start: QUOTE.indexOf('about 2'), end: QUOTE.indexOf('about 2') + 7 },
  source_span: { start: QUOTE.indexOf('1%'), end: QUOTE.indexOf('1%') + 2 },
  range: { low: -4, high: -1, low_literal: '4', high_literal: 'between 1', meaning: 'likely_range' }, from_node: 'price', to_node: 'customers' };
const row: StatedDisposition = { stated_index: 9, stated_item: { kind: 'cause', source_quote: QUOTE, relationship: relation as never }, disposition: 'carried',
  location: { kind: 'edge', from: 'price', to: 'customers', path: ['provenance', 'natural_effect'] }, stored_value: natural };
function graph() {
  return { nodes: [{ id: 'price', kind: 'factor', label: 'Price rise', scale_frame: 100, quantity_ref: 3 }, { id: 'customers', kind: 'factor', label: 'Customers', scale_frame: 1000, quantity_ref: 1 }],
    edges: [{ from: 'price', to: 'customers', effect_direction: 'negative', strength: { mean: -0.1, std: 0.05 }, provenance: {
      source: 'brief_extraction', magnitude: 'user_stated', source_quote: QUOTE, stated_relationship: { ...relation, range: { ...relation.range } },
      natural_effect: { ...natural, strength_mean: -0.1 } } }] };
}
describe('MC R4 executable cause identity after registration', () => {
  it('RED R4a: frame refitting keeps the stated rate carried and updates the stored receipt', () => {
    const g = graph(); const [got] = reconcileStatedDispositions([row], g);
    expect(got).toMatchObject({ disposition: 'carried', stored_value: g.edges[0]!.provenance.natural_effect });
  });
  it('CONTRAST R4a: endpoint retargeting removes the recorded carrier', () => {
    const g = graph(); g.nodes[1]!.id = 'customer-level'; g.edges[0]!.to = 'customer-level';
    g.edges[0]!.provenance.stated_relationship = { ...relation, to_node: 'customer-level' };
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('CONTRAST: equal amounts on a different quantity are not this carrier', () => {
    const g = graph(); g.edges[0]!.to = 'other'; g.edges[0]!.provenance.stated_relationship = { ...relation, to_quantity: 10, to_node: 'other' };
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('CONTRAST: a changed amount really is withdrawn', () => {
    const g = graph(); g.edges[0]!.provenance.natural_effect.amount = -3;
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('CONTRAST: a changed per-unit rate removes the stated carrier', () => {
    const g = graph(); g.edges[0]!.provenance.natural_effect.per_source_change = 2;
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('CONTRAST: a changed stated range removes the stated carrier', () => {
    const g = graph(); g.edges[0]!.provenance.stated_relationship.range.high = -0.5;
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('CONTRAST: a withdrawn edge stays carrier_removed', () => {
    const g = graph(); g.edges = [];
    expect(reconcileStatedDispositions([row], g)[0]).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
  it('RED R4b: persisted unitless endpoints still carry the literal-backed signed rate', () => {
    const m = deriveNotModelledManifest(QUOTE, graph());
    expect(m.quantities?.items.find(x => x.literal.includes('2') && x.char_offset === QUOTE.indexOf('2'))).toMatchObject({ verdict: 'in_model', matched_node_id: 'customers' });
    expect(m.quantities?.items.find(x => x.literal === '1%')).toMatchObject({ verdict: 'in_model', matched_node_id: 'price' });
  });
  it('CONTRAST R4b: malformed persisted range evidence earns no carrier and does not throw', () => {
    const g = graph(); (g.edges[0]!.provenance.stated_relationship as Record<string, unknown>).range = null;
    expect(deriveNotModelledManifest(QUOTE, g).quantities?.items.find(x => x.literal.includes('2'))?.verdict).not.toBe('in_model');
  });
  it('CONTRAST R4b: the withdrawn edge does not model its rate', () => {
    const g = graph(); g.edges = [];
    const m = deriveNotModelledManifest(QUOTE, g);
    expect(m.quantities?.items.find(x => x.literal.includes('2'))?.verdict).not.toBe('in_model');
  });
  it('CONTRAST R4b: a rate elsewhere with the same amount does not model this occurrence', () => {
    const other = 'Each 1% price rise loses about 2 customers, between 1 and 4 on a different plan.';
    const m = deriveNotModelledManifest(`${QUOTE} ${other}`, graph());
    expect(m.quantities?.items.find(x => x.char_offset === QUOTE.length + 1 + other.indexOf('2'))?.verdict).not.toBe('in_model');
  });
});
