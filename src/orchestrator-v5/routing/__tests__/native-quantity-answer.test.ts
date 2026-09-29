/**
 * GO(A) answer half — reading the option cost the user gave.
 *
 * Bound to the real capture (session `82f31082`): a `Hiring Cost <= 200000 GBP`
 * limit the engine refused to score, beside three unitless interventions.
 */
import { describe, expect, it } from 'vitest';

import { decideNativeQuantityAnswer } from '../native-quantity-answer.js';
import type { PendingAction } from '../../session/pending-action.js';

const HASH = 'gh-abc123';
const NOW = 1_700_000_000_000;

const GRAPH = {
  nodes: [
    { id: '85dd1a1d', kind: 'factor', label: 'Hiring Cost' },
    { id: 'opt_tech_lead', kind: 'option', label: 'Hire a Tech Lead' },
  ],
};

const askPending = (over: Record<string, unknown> = {}): PendingAction =>
  ({
    id: 'pa-1',
    scenario_id: 's-1',
    chip_id: 'chip_elicit_option_native_quantity',
    action: {
      kind: 'elicit_option_native_quantity',
      option_id: 'opt_tech_lead',
      option_label: 'Hire a Tech Lead',
      factor_id: '85dd1a1d',
      factor_label: 'Hiring Cost',
      unit: 'GBP',
      constraint_label: 'Budget limit',
    },
    preconditions: { graph_hash: HASH },
    expires_at_turn_count: 2,
    expires_at_iso: new Date(NOW + 600_000).toISOString(),
    emitted_at_iso: new Date(NOW - 1_000).toISOString(),
    ...over,
  }) as PendingAction;

const read = (message: string, over: Record<string, unknown> = {}) =>
  decideNativeQuantityAnswer({
    message,
    pendings: [askPending()],
    graph: GRAPH,
    currentGraphHash: HASH,
    nowMs: NOW,
    ...over,
  });

describe('decideNativeQuantityAnswer — binds the user’s own figure', () => {
  it.each([
    ['symbol', '£95,000'],
    ['symbol, no separator', '£95000'],
    ['in a sentence', 'It costs about £95,000 all in.'],
    ['with a magnitude word', '£95k'],
  ])('binds a GBP amount (%s)', (_name, message) => {
    const out = read(message);
    expect(out.kind).toBe('bind');
    if (out.kind !== 'bind') return;
    expect(out.optionId).toBe('opt_tech_lead');
    expect(out.factorId).toBe('85dd1a1d');
    expect(out.unit).toBe('GBP');
    expect(out.nativeValue).toBe(95000);
  });

  it('never converts and never scales — the number returned is the number given', () => {
    const out = read('£200,000');
    expect(out.kind === 'bind' && out.nativeValue).toBe(200000);
  });
});

describe('decideNativeQuantityAnswer — says ASK rather than falling silent', () => {
  it('a different currency is REFUSED, not converted', () => {
    // Converting invents a rate; recording it under GBP attaches a number to a
    // unit it was never given in. The encoder refuses a unit mismatch too.
    const out = read('$95,000');
    expect(out).toEqual({ kind: 'ask', reason: 'unit_mismatch' });
  });

  it('two amounts are ambiguous — which one is the cost is a guess', () => {
    expect(read('between £80,000 and £120,000')).toEqual({
      kind: 'ask',
      reason: 'several_amounts',
    });
  });

  it('a reply with no amount asks again rather than binding nothing', () => {
    expect(read('not sure yet')).toEqual({ kind: 'ask', reason: 'no_amount' });
  });
});

describe('decideNativeQuantityAnswer — leaves the turn alone when it must', () => {
  it('UNRELATED when the graph moved under the question', () => {
    // The cell the answer would land in is not the cell the user was shown.
    expect(read('£95,000', { currentGraphHash: 'gh-moved' }).kind).toBe('unrelated');
  });

  it('UNRELATED when TWO asks are live — it must not pick one', () => {
    const second = askPending({ id: 'pa-2', action: { ...askPending().action, option_id: 'opt_two' } });
    expect(read('£95,000', { pendings: [askPending(), second] }).kind).toBe('unrelated');
  });

  it('UNRELATED when the named option no longer resolves by identity', () => {
    const graph = { nodes: [{ id: '85dd1a1d', kind: 'factor' }] };
    expect(read('£95,000', { graph }).kind).toBe('unrelated');
  });

  it('UNRELATED when the id resolves to a node of the WRONG KIND', () => {
    // A duplicate or foreign id is not a referent (trap 19).
    const graph = {
      nodes: [
        { id: '85dd1a1d', kind: 'factor' },
        { id: 'opt_tech_lead', kind: 'factor' },
      ],
    };
    expect(read('£95,000', { graph }).kind).toBe('unrelated');
  });

  it('UNRELATED when the ask has expired', () => {
    const expired = askPending({ expires_at_iso: new Date(NOW - 1).toISOString() });
    expect(read('£95,000', { pendings: [expired] }).kind).toBe('unrelated');
  });

  it('UNRELATED when no pending of this kind is live at all', () => {
    expect(read('£95,000', { pendings: [] }).kind).toBe('unrelated');
  });
});
