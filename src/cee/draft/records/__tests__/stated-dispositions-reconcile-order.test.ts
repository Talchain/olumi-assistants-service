/**
 * R2 (Codex P2 @7d2dc3cf): reconciliation compared a carried value with its carrier by `JSON.stringify`, so a carrier
 * equal in every field but rebuilt in a different KEY ORDER (a GraphV3 parse rebuilds objects in schema order — a
 * `natural_effect` came back reordered) read as `rejected: carrier_removed`. Equality is structural now.
 */
import { describe, expect, it } from 'vitest';

import { reconcileStatedDispositions, type StatedDisposition } from '../stated-dispositions.js';

const ITEM = { kind: 'cause', source_quote: 'each extra rep adds about £2,000 a month' } as StatedDisposition['stated_item'];
const carried = (stored_value: unknown): StatedDisposition => ({
  stated_index: 0, stated_item: ITEM, disposition: 'carried',
  location: { kind: 'edge', from: 'fac_reps', to: 'out_mrr', path: ['provenance', 'natural_effect'] }, stored_value,
});
const graphWith = (natural_effect: unknown) => ({
  nodes: [{ id: 'fac_reps' }, { id: 'out_mrr' }],
  edges: [{ from: 'fac_reps', to: 'out_mrr', provenance: { magnitude: 'user_stated', natural_effect } }],
});
// the projector's write order …
const WRITTEN = { amount: 2000, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'rep', direction: 'increase' };
// … and the same fields as a schema-ordered parse hands them back
const REORDERED = { direction: 'increase', per_source_change_unit: 'rep', per_source_change: 1, amount_unit: '£/month', amount: 2000 };

describe('reconcileStatedDispositions compares carriers structurally', () => {
  it('⭐ RED: a natural_effect equal up to key order stays CARRIED', () => {
    const [row] = reconcileStatedDispositions([carried(WRITTEN)], graphWith(REORDERED));
    expect(row!.disposition).toBe('carried');
  });

  it('CONTROL: a changed value is still withdrawn as carrier_removed', () => {
    const [row] = reconcileStatedDispositions([carried(WRITTEN)], graphWith({ ...REORDERED, amount: 2500 }));
    expect(row).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });

  it('CONTROL: an extra field on the carrier is a different value, not an equal one', () => {
    const [row] = reconcileStatedDispositions([carried(WRITTEN)], graphWith({ ...REORDERED, amount_low: 1500 }));
    expect(row).toMatchObject({ disposition: 'rejected', reason: 'carrier_removed' });
  });
});
