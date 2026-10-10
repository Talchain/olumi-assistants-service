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

const factWith = (enrichment: Rec, mayNameLeader = true): Extract<HandlerFact, { fact_type: 'run_analysis' }> => {
  const parsed = HandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, summary: 'summary', leading_option_id: 'raise',
      graph_hash_at_run: HASH, computed_at: '2026-10-10T10:00:00.000Z', run_id: RUN,
      constraint_verdict: { constraint_verdict_state: mayNameLeader ? 'not_applicable' : 'unevaluated', may_name_leading_option: mayNameLeader },
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
const facts = (enrichment: Rec, currentHash: string = HASH, mayNameLeader = true) =>
  buildLicensedRunFacts(factWith(enrichment, mayNameLeader), SCENARIO, graph, undefined, currentHash);
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
  it('a trimmed-empty scale token is an absent scale, exactly as before (the pair is admitted)', () => {
    const unitless = { ...PAIR, unit: null, value_scale: '', current_value: 0.35, flip_value: 0.62 };
    const out = facts({ flip_thresholds: [unitless], flip_thresholds_status: 'computed' });
    expect(ids(out.flipRows)).toEqual(['churn']);
    expect(out.flipScaleRefusedCount).toBe(0);
  });
  it('LEADER PERMISSION IS NOT FLIP AVAILABILITY: a withheld leader keeps the pair, without who would take over', () => {
    const named = { ...PAIR, alternative_winner_id: 'keep', alternative_winner_label: 'Keep price' };
    const licensed = facts({ flip_thresholds: [named], flip_thresholds_status: 'computed' });
    expect(licensed.flipRows[0]).toMatchObject({ factor_id: 'churn', alternative_winner_id: 'keep' });
    const withheld = facts({ flip_thresholds: [named], flip_thresholds_status: 'computed' }, HASH, false);
    expect(withheld.mayNameLeader).toBe(false);
    expect(ids(withheld.flipRows)).toEqual(['churn']);
    expect(withheld.flipRows[0]).not.toHaveProperty('alternative_winner_id');
    expect(withheld.flipRows[0]).not.toHaveProperty('alternative_winner_label');
  });
  it('unavailable flips withhold flip DATA only: an ordinary producer critique survives a licensed leader, not a withheld one', () => {
    const critique = { m1_coaching: { model_critiques: [{ type: 'anchoring', severity: 'warning', message: 'Check vendor reliability' }] } };
    const kept = facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'unavailable', ...critique });
    expect(kept.flipRows).toEqual([]);
    expect(JSON.stringify(kept.enrichment)).toContain('Check vendor reliability');
    const withheld = facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'unavailable', ...critique }, HASH, false);
    expect(JSON.stringify(withheld.enrichment)).not.toContain('Check vendor reliability');
  });
  it('a prose string that restates a WITHHELD threshold is dropped by figure, ordinary prose and other numbers are kept', () => {
    const critiques = { m1_coaching: { model_critiques: [
      { type: 'anchoring', severity: 'warning', message: 'Churn could flip at 4.2%.' },
      { type: 'anchoring', severity: 'warning', message: 'Check vendor reliability' },
      { type: 'anchoring', severity: 'warning', message: 'Churn of 14.2% would be unusual' },
    ] } };
    const out = JSON.stringify(facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'unavailable', ...critiques }).enrichment);
    expect(out).not.toContain('could flip at 4.2%');
    expect(out).toContain('Check vendor reliability');
    expect(out).toContain('14.2%');
    // CONTRAST: the same strings pass untouched when the producer's flip data is available.
    const available = JSON.stringify(facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'computed', ...critiques }).enrichment);
    expect(available).toContain('could flip at 4.2%');
  });
  describe('a supplied current graph that cannot be read fails CLOSED; no graph at all does not', () => {
    const readable = { nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' }, { id: 'keep', kind: 'option', label: 'Keep price' },
      { id: 'raise', kind: 'option', label: 'Raise price' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }], edges: [] };
    const enrichment = { flip_thresholds: [PAIR], flip_thresholds_status: 'computed' };
    it('CONTRAST: no graph supplied anywhere keeps the Run current (the review fires in its own request)', () => {
      const out = buildLicensedRunFacts(factWith(enrichment), SCENARIO, undefined);
      expect(out.current).toBe(true);
      expect(ids(out.flipRows)).toEqual(['churn']);
    });
    it('a supplied but unreadable current graph withholds the staleness-sensitive findings', () => {
      const out = buildLicensedRunFacts(factWith(enrichment), SCENARIO, readable, { nodes: 'garbage', edges: 7 });
      expect(out.current).toBe(false);
      expect(out.mayNameLeader).toBe(false);
      expect(out.flipRows).toEqual([]);
    });
    it('an unreadable GROUNDING graph used as the current graph fails closed the same way', () => {
      const out = buildLicensedRunFacts(factWith(enrichment), SCENARIO, { nodes: 'garbage' });
      expect(out.current).toBe(false);
      expect(out.flipRows).toEqual([]);
    });
  });
  it('a Run the graph has moved past withholds the same rows (computed status does not rescue it)', () => {
    const out = facts({ flip_thresholds: [PAIR], flip_thresholds_status: 'computed' }, OTHER_HASH);
    expect(out.current).toBe(false);
    expect(out.flipRows).toEqual([]);
    expect(out.mayNameLeader).toBe(false);
  });
});
