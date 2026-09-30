/**
 * SC-24 — the input a Run was SENT, captured from the request (schemas 0.67.0 `input_snapshot`).
 * P0 SHARED DATA 5914750268: the goal unit is the SAME authored unit as the goal's `goal_threshold_unit`; a missing
 * unit stays absent (never GBP). AIQ 5914731075: fields copy what the Run was sent — nothing inferred.
 */
import { describe, expect, it } from 'vitest';

import { buildRunInputSnapshot, runIdFor, sentDigest } from '../run-input-snapshot.js';

const graph = {
  nodes: [
    { id: 'goal_mrr', kind: 'goal', label: 'Pro MRR', goal_threshold: 0.55, goal_threshold_raw: 55000,
      goal_threshold_unit: 'GBP per month', goal_direction: '>=', goal_threshold_frame: 'level' },
    { id: 'fac_price', kind: 'factor', label: 'Pro price', observed_state: { value: 49, raw_value: 49, unit: 'GBP', source: 'user_override' } },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.037, raw_value: 3.7, unit: '%', source: 'cee_inference' } },
    { id: 'opt_raise', kind: 'option', label: 'Raise to £60' },
  ],
  edges: [{ from: 'fac_price', to: 'fac_churn', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9 }],
};

const payload = (over: Record<string, unknown> = {}) => ({
  graph,
  options: [],
  goal_node_id: 'goal_mrr',
  request_id: 'req-1',
  goal_constraints: [{ constraint_id: 'c1', node_id: 'fac_churn', operator: '<=', value: 5, unit: '%', label: 'Churn cap' }],
  ...over,
});

const input = (over: Partial<Parameters<typeof buildRunInputSnapshot>[0]> = {}) => ({
  submittedOptions: [
    { option_id: 'opt_raise', label: 'Raise to £60' },
    { option_id: 'opt_hold', label: 'Hold', is_baseline: true },
  ],
  rawObjectsPerOption: [
    { fac_price: { value: 60, raw_value: 60, unit: 'GBP', source: 'user_override' } },
    { fac_price: { value: 49, raw_value: 49, unit: 'GBP', source: 'cee_default' } },
  ],
  wirePerOption: [{ fac_price: 60 }, { fac_price: 49 }],
  heldFactorIdsByOptionId: new Map([['opt_hold', new Set(['fac_price'])]]),
  optionsNotSent: [{ option_id: 'opt_olumi', label: 'Moderate rise', reason: 'olumi_proposed' as const }],
  wireGraph: graph,
  plotPayload: payload(),
  ...over,
});

describe('buildRunInputSnapshot — what the Run was sent', () => {
  it('the goal unit is the goal node\'s own goal_threshold_unit, as authored (P0 SHARED DATA 5914750268)', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.goal).toEqual({ node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'GBP per month', operator: '>=', frame: 'level' });
  });

  it('a goal field the Run was not sent stays ABSENT — a missing unit never becomes GBP (AIQ 5914731075)', () => {
    const bare = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'goal_mrr' ? { id: 'goal_mrr', kind: 'goal', label: 'Pro MRR' } : n)) };
    const s = buildRunInputSnapshot(input({ wireGraph: bare, plotPayload: payload({ graph: bare }) }));
    expect(s?.goal).toEqual({ node_id: 'goal_mrr', label: 'Pro MRR' });
  });

  it('a Run sent no goal records goal: null', () => {
    const { goal_node_id: _g, ...noGoal } = payload();
    expect(buildRunInputSnapshot(input({ plotPayload: noGoal }))?.goal).toBeNull();
  });

  it('option settings carry the authored figure AND the number PLoT got; a held status-quo value is marked', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.options).toEqual([
      { option_id: 'opt_raise', label: 'Raise to £60', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 60, unit: 'GBP', encoded: 60 }] },
      { option_id: 'opt_hold', label: 'Hold', is_baseline: true,
        settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
    ]);
    expect(s?.options_not_sent).toEqual([{ option_id: 'opt_olumi', label: 'Moderate rise', reason: 'olumi_proposed' }]);
  });

  it('factor values, limits and links are recorded as sent', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.factors).toEqual([
      { factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, source: 'user_override' },
      { factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: 0.037, source: 'cee_inference' },
    ]);
    expect(s?.constraints).toEqual([{ constraint_id: 'c1', node_id: 'fac_churn', label: 'Churn cap', operator: '<=', raw: 5, unit: '%' }]);
    expect(s?.links).toEqual([{ from: 'fac_price', to: 'fac_churn', mean: 0.4, std: 0.1, exists_probability: 0.9 }]);
  });

  it('the digest ignores request_id and key order, and moves with any input', () => {
    expect(sentDigest(payload({ request_id: 'req-2' }))).toBe(sentDigest(payload()));
    const reordered = Object.fromEntries(Object.entries(payload()).reverse());
    expect(sentDigest(reordered)).toBe(sentDigest(payload()));
    expect(sentDigest(payload({ goal_direction: 'minimise' }))).not.toBe(sentDigest(payload()));
  });

  it('over a contract bound, NO snapshot is recorded (never a truncated one that reads as complete)', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ option_id: `o${i}`, label: `O${i}` }));
    expect(buildRunInputSnapshot(input({
      submittedOptions: many,
      rawObjectsPerOption: many.map(() => ({})),
      wirePerOption: many.map(() => ({})),
    }))).toBeNull();
  });
});

describe('runIdFor — one id per turn that ran, the same on a replay', () => {
  it('a replay of the same turn gets the same id; another turn gets another', () => {
    const a = runIdFor({ scenarioId: 's', turnId: 't1', graphHashAtRun: 'h' });
    expect(runIdFor({ scenarioId: 's', turnId: 't1', graphHashAtRun: 'h' })).toBe(a);
    expect(runIdFor({ scenarioId: 's', turnId: 't2', graphHashAtRun: 'h' })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
