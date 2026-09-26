/**
 * A LIMIT PLoT SCORED BUT DID NOT CERTIFY IS NOT A LIMIT THAT WAS MET.
 *
 * ⚠ WHY THIS FILE EXISTS (WIRE, engine-direct, #69 5840961137; the envelopes below are the SERVED engine's bytes,
 * `tests/fixtures/cross-service/c50-level-demo/README.md`): a churn limit of `10 "percent per month"` on a root factor
 * whose observed level is 0.07 was normalised against that factor's inferred range `[0, 0.14]` and CLAMPED to 1.0. PLoT
 * then delivered `constraint_probabilities {gc_u1: 1}` for BOTH options — "churn ≤ 100%" — and said so only in its own
 * typed marker: `constraint_results[].scale_provenance {decision_grade: false, threshold_clamped: 'high'}`. No
 * `CONSTRAINT_TARGET_UNRELIABLE` rode with it. `deriveConstraintVerdict` counted the presence of a probability as
 * "scored", so the verdict was `evaluated_feasible` and the leader was named as meeting the user's limit.
 *
 * PLoT's contract says the marker suppresses nothing and acting on it is the consumer's job (`engine-v3.ts:637-638`).
 * This is that consumer. Every row is bound by `constraint_id` and the leading option's id, never by a value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  deriveConstraintVerdict,
  projectClaimSafety,
  readRatifiedConstraints,
} from '../constraint-feasibility.js';

const DIR = 'tests/fixtures/cross-service/c50-level-demo';
function envelope(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${DIR}/${name}.plot-response.json`, 'utf-8')) as Record<string, unknown>;
}

/** The persisted row CEE would hold for the limit each capture scored (same id PLoT answered under). */
function ratified(constraintId: string, nodeId: string, unit: string) {
  return readRatifiedConstraints({
    goal_constraints: [{ constraint_id: constraintId, node_id: nodeId, operator: '<=', value: 10, unit, label: 'The limit' }],
  });
}

const LEADER = 'opt_raise'; // the captures' `robustness.recommended_option_id`

describe('a constraint PLoT did not certify is never read as a met limit (real engine envelopes)', () => {
  it('PRECONDITION: the U1 capture really is the wrong pass — scored 1 on both options, marked not decision-grade and clamped', () => {
    const env = envelope('U1');
    const results = env.constraint_results as Array<Record<string, unknown>>;
    const mine = results.find((r) => r.constraint_id === 'gc_u1') as Record<string, unknown>;
    expect(mine.scale_provenance).toMatchObject({ decision_grade: false, threshold_clamped: 'high' });
    const probs = (env.option_comparison as Array<Record<string, unknown>>).map((o) => (o.constraint_probabilities as Record<string, number>).gc_u1);
    expect(probs).toEqual([1, 1]);
  });

  it('U1 (clamped, not decision-grade): the verdict is NOT evaluated_feasible, and the leader may NOT be named', () => {
    const v = deriveConstraintVerdict(envelope('U1'), ratified('gc_u1', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('unevaluated');
    expect(v.state === 'unevaluated' ? v.constraints.map((c) => c.constraint_id) : []).toEqual(['gc_u1']);
    expect(projectClaimSafety(v).may_name_leading_option).toBe(false);
  });

  it('CONTROL U2 (the same limit as "%", decision-grade): evaluated_feasible, the leader may be named', () => {
    const v = deriveConstraintVerdict(envelope('U2'), ratified('gc_u2', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('evaluated_feasible');
    expect(projectClaimSafety(v).may_name_leading_option).toBe(true);
  });

  it('CONTROL U3b (a £ cap on an explicit-cap factor, decision-grade): evaluated_feasible', () => {
    const v = deriveConstraintVerdict(envelope('U3b'), ratified('gc_u3b', 'fac_cost', '£'), LEADER);
    expect(v.state).toBe('evaluated_feasible');
    expect(projectClaimSafety(v).may_name_leading_option).toBe(true);
  });

  it('L1 (not clamped, but PLoT could not prove the scale: source "default"): also unevaluated — any decision_grade:false, not only a clamp', () => {
    const env = envelope('L1');
    const mine = (env.constraint_results as Array<Record<string, unknown>>).find((r) => r.constraint_id === 'gc_l1') as Record<string, unknown>;
    expect(mine.scale_provenance).toMatchObject({ decision_grade: false, source: 'default' });
    expect((mine.scale_provenance as Record<string, unknown>).threshold_clamped).toBeUndefined();
    const v = deriveConstraintVerdict(env, ratified('gc_l1', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('unevaluated');
    expect(projectClaimSafety(v).may_name_leading_option).toBe(false);
  });

  it('IDENTITY: a not-decision-grade marker on a DIFFERENT constraint id does not withhold ours', () => {
    const env = envelope('U2');
    const results = (env.constraint_results as Array<Record<string, unknown>>).map((r) => ({ ...r }));
    results.push({ constraint_id: 'someone_else', scale_provenance: { decision_grade: false, threshold_clamped: 'high', source: 'inferred_value', range_unified: true } });
    const v = deriveConstraintVerdict({ ...env, constraint_results: results }, ratified('gc_u2', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('evaluated_feasible');
  });

  it('ONLY AN EXPLICIT false WITHHOLDS: a marker present but carrying no decision_grade keeps today\'s behaviour', () => {
    const env = envelope('U2');
    const results = (env.constraint_results as Array<Record<string, unknown>>).map((r) => {
      const { decision_grade: _dg, ...sp } = (r.scale_provenance ?? {}) as Record<string, unknown>;
      return { ...r, scale_provenance: sp };
    });
    expect((results.find((r) => r.constraint_id === 'gc_u2')!.scale_provenance as Record<string, unknown>).source).toBe('unit_percent');
    const v = deriveConstraintVerdict({ ...env, constraint_results: results }, ratified('gc_u2', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('evaluated_feasible');
  });

  it('ABSENCE is not a verdict here: a scored constraint with NO scale_provenance keeps today\'s behaviour', () => {
    const env = envelope('U2');
    const results = (env.constraint_results as Array<Record<string, unknown>>).map(({ scale_provenance: _sp, ...rest }) => rest);
    const v = deriveConstraintVerdict({ ...env, constraint_results: results }, ratified('gc_u2', 'fac_churn', '%'), LEADER);
    expect(v.state).toBe('evaluated_feasible');
  });
});
