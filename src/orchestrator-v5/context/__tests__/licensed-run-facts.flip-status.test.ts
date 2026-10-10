/**
 * The licensed Run facts admit flip data by what the PRODUCER said, not by a word one fixture happens to use.
 *
 * `@talchain/schemas` documents the producer vocabulary for `flip_thresholds_status` as
 * `computed | all_no_effect | partial_no_effect | unresolved | unavailable`. Only the explicit `unavailable` (or a Run that
 * is no longer current) withholds. `partial_no_effect` keeps its real pair, and `all_no_effect` keeps the honest
 * "no factor flips the decision" count, which a `=== 'computed'` gate would have thrown away. Bound by factor id.
 */
import { describe, it, expect } from 'vitest';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { buildLicensedRunFacts } from '../licensed-run-facts.js';

type Rec = Record<string, unknown>;
const SCENARIO = '8f5b0e4a-3c1d-4f6e-9a77-1b2c3d4e5f60';
const RUN = '0d9c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const graph = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'keep', kind: 'option', label: 'Keep price' },
    { id: 'raise', kind: 'option', label: 'Raise price' },
    { id: 'churn', kind: 'factor', label: 'Monthly churn' },
    { id: 'seats', kind: 'factor', label: 'Seats' },
  ],
  edges: [],
};
const PAIR: Rec = { factor_id: 'churn', factor_label: 'Monthly churn', current_value: 3, flip_value: 4.2, value_scale: 'display', unit: '%' };
const NO_EFFECT: Rec = { factor_id: 'seats', factor_label: 'Seats', current_value: 10, flip_value: null, flip_reason: 'no_effect_within_bounds' };

const factWith = (enrichment: Rec): Extract<HandlerFact, { fact_type: 'run_analysis' }> => {
  const parsed = HandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, summary: 'summary', leading_option_id: 'raise',
      graph_hash_at_run: HASH, computed_at: '2026-10-10T10:00:00.000Z', run_id: RUN,
      constraint_verdict: { constraint_verdict_state: 'not_applicable', may_name_leading_option: true },
      enrichment: {
        option_comparison: [
          { option_id: 'raise', option_label: 'Raise price', win_probability: 0.7 },
          { option_id: 'keep', option_label: 'Keep price', win_probability: 0.3 },
        ],
        ...enrichment,
      },
    },
  });
  if (parsed.fact_type !== 'run_analysis') throw new Error('fixture is not a run_analysis fact');
  return parsed;
};
const facts = (enrichment: Rec, currentHash: string = HASH) =>
  buildLicensedRunFacts(factWith(enrichment), SCENARIO, graph, undefined, currentHash);
const ids = (rows: readonly { factor_id: string }[]): string[] => rows.map(r => r.factor_id);

describe('flip admission follows the producer\'s own status word', () => {
  it('CONTRAST: computed, partial_no_effect, absent and the legacy "available" all keep the real pair', () => {
    for (const status of ['computed', 'partial_no_effect', 'available', undefined]) {
      const out = facts({ flip_thresholds: [PAIR, NO_EFFECT], ...(status === undefined ? {} : { flip_thresholds_status: status }) });
      expect(out.current, String(status)).toBe(true);
      expect(ids(out.flipRows), String(status)).toEqual(['churn']);
      expect(out.flipSource, String(status)).toBe('top_level');
    }
  });
  it('partial_no_effect also reports the attested no-effect count beside the pair', () => {
    const out = facts({ flip_thresholds: [PAIR, NO_EFFECT], flip_thresholds_status: 'partial_no_effect' });
    expect(out.flipNoEffectCount).toBe(1);
  });
  it('all_no_effect keeps the honest "no factor flips it" count and carries no pair', () => {
    const out = facts({ flip_thresholds: [NO_EFFECT], flip_thresholds_status: 'all_no_effect' });
    expect(out.flipRows).toEqual([]);
    expect(out.flipNoEffectCount).toBe(1);
  });
  it('unavailable withholds every row and the tipping point, even when rows are present', () => {
    const out = facts({ flip_thresholds: [PAIR, NO_EFFECT], flip_thresholds_status: 'unavailable' });
    expect(out.flipRows).toEqual([]);
    expect(out.flipNoEffectCount).toBe(0);
    expect(out.analysis).not.toHaveProperty('tipping_point');
  });
  it('a Run the graph has moved past withholds the same rows (computed status does not rescue it)', () => {
    const out = facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'computed' }, OTHER_HASH);
    expect(out.current).toBe(false);
    expect(out.flipRows).toEqual([]);
    expect(out.mayNameLeader).toBe(false);
  });
});
