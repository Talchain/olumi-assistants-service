/**
 * A SCORE IS A CHECK ONLY WHEN THE PRODUCER CERTIFIES IT FOR THE LEADER.
 *
 * Defect (C50 U1, PLoT staging b09c0f2 / ISL 3c4ab84d, WIRE): "<= 10 percent per
 * month" was clamped to 1.0, every option scored P = 1, PLoT marked the row
 * `scale_provenance {inferred_value, threshold_clamped:'high', decision_grade:false}`
 * and the crown 'unverified'; CEE returned `evaluated_feasible` and named the leader.
 *
 * Envelopes are VERBATIM PLoT response bodies; each mutant is a structuredClone
 * that changes the one field its row names.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { deriveConstraintVerdict, projectClaimSafety, type RatifiedConstraint } from '../constraint-feasibility.js';
import {
  buildConstraintDisclosure,
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
} from '../../../orchestrator-v5/coaching/constraint-gap-disclosure.js';

type Json = Record<string, any>;
type Case = 'U1' | 'U2' | 'U3b' | 'L1' | 'D2b' | 'L5b';
const capture = (name: Case): Json =>
  JSON.parse(readFileSync(`tests/fixtures/cross-service/c50-level-demo/${name}.plot-response.json`, 'utf8')) as Json;
const LEADER = 'opt_raise';
const rat = (...ids: string[]): RatifiedConstraint[] => ids.map((constraint_id) => ({ constraint_id, label: null }));
const ids = (v: { constraints: readonly RatifiedConstraint[] }) => v.constraints.map((c) => c.constraint_id);
const opt = (env: Json, id: string) => (env.option_comparison as Json[]).find((o) => o.option_id === id)!;
const withheld = (v: ReturnType<typeof deriveConstraintVerdict>, expected: string[]) => {
  expect(v.state).toBe('unevaluated');
  expect(v.mayNameLeadingOption).toBe(false);
  expect(ids(v)).toEqual(expected);
  expect(v.codes).toEqual([]);
};
const named = (v: ReturnType<typeof deriveConstraintVerdict>) => {
  expect(v.state).toBe('evaluated_feasible');
  expect(v.mayNameLeadingOption).toBe(true);
  expect(v.constraints).toEqual([]);
};

describe('preconditions (bound by identity to the captures)', () => {
  it('each capture carries the marker the rows below rely on', () => {
    for (const [c, id, dg] of [['U1','gc_u1',false],['U2','gc_u2',true],['U3b','gc_u3b',true],['L1','gc_l1',false],['D2b','gc_d2b',false],['L5b','gc_l5b',false]] as const) {
      const env = capture(c);
      expect(env.constraints_status).toBe('computed');
      expect(env.constraint_results.map((r: Json) => r.constraint_id)).toEqual([id]);
      expect(env.constraint_results[0].scale_provenance.decision_grade).toBe(dg);
      expect(typeof opt(env, LEADER).constraint_probabilities[id]).toBe('number');
      const top = [...env.option_comparison].sort((a: Json, b: Json) => b.win_probability - a.win_probability)[0];
      expect(top.option_id).toBe(LEADER);
    }
    expect(capture('U1').constraint_results[0].scale_provenance.threshold_clamped).toBe('high');
    expect(opt(capture('U1'), LEADER).constraint_probabilities.gc_u1).toBe(1);
  });
});

describe('RED at 647caa61: an uncertified or leader-less score is not a check', () => {
  it('R1 U1 (clamped) withholds exactly gc_u1', () => {
    const v = deriveConstraintVerdict(capture('U1'), rat('gc_u1'), LEADER);
    withheld(v, ['gc_u1']);
    expect(v.leaderInfeasibility).toBeNull();
    // …and the PERSISTED permission every later turn reads says the same.
    expect(projectClaimSafety(v)).toMatchObject({ may_name_leading_option: false, constraint_verdict_state: 'unevaluated' });
  });
  it('R2 U1 speaks the existing unevaluated voice, inside the grammar', () => {
    const v = deriveConstraintVerdict(capture('U1'), [{ constraint_id: 'gc_u1', label: 'Monthly churn at most 10 percent per month' }], LEADER);
    const d = buildConstraintDisclosure(v, null);
    expect(d).toContain('could not be checked: “Monthly churn at most 10 percent per month”');
    expect(new RegExp('^(?:' + CONSTRAINT_GAP_DISCLOSURE_RE_SRC + ')$').test(d)).toBe(true);
  });
  it.each([['L1','gc_l1'],['D2b','gc_d2b'],['L5b','gc_l5b']] as const)('R3 %s (source default, decision_grade false) withholds %s', (c, id) => {
    withheld(deriveConstraintVerdict(capture(c), rat(id), LEADER), [id]);
  });
  it('R4 leader partial: U2 with ONLY the leader\'s gc_u2 probability removed', () => {
    const env = structuredClone(capture('U2'));
    delete opt(env, LEADER).constraint_probabilities.gc_u2;
    withheld(deriveConstraintVerdict(env, rat('gc_u2'), LEADER), ['gc_u2']);
  });
  it('R5 a leader id no option entry carries withholds', () => {
    withheld(deriveConstraintVerdict(capture('U2'), rat('gc_u2'), 'opt_absent'), ['gc_u2']);
  });
  it("R6 constraints_status 'error' with per-option probabilities and no rows", () => {
    const env = structuredClone(capture('U1'));
    env.constraints_status = 'error';
    delete env.constraint_results;
    withheld(deriveConstraintVerdict(env, rat('gc_u1'), LEADER), ['gc_u1']);
  });
  it('R7 a clamped BREACH is not a checked breach: unevaluated, breach carried', () => {
    const env = structuredClone(capture('U1'));
    env.constraint_results[0].scale_provenance.threshold_clamped = 'low';
    env.constraint_results[0].probability = 0;
    for (const o of env.option_comparison) { o.constraint_probabilities.gc_u1 = 0; o.probability_of_joint_goal = 0; }
    const v = deriveConstraintVerdict(env, rat('gc_u1'), LEADER);
    withheld(v, ['gc_u1']);
    expect(v.leaderInfeasibility).toMatchObject({ infeasible: true, constraintId: 'gc_u1', kind: 'hard_violation' });
  });
});

describe('controls — green before and after', () => {
  it.each([['U2','gc_u2'],['U3b','gc_u3b']] as const)('C1 %s (decision_grade true, leader scored) names the leader', (c, id) => {
    named(deriveConstraintVerdict(capture(c), rat(id), LEADER));
    expect(buildConstraintDisclosure(deriveConstraintVerdict(capture(c), rat(id), LEADER), null)).toBe('');
  });
  it('C2 identity: an UNRATIFIED uncertified row does not withhold', () => {
    const env = structuredClone(capture('U2'));
    env.constraint_results.push({ constraint_id: 'plot_other', node_id: 'x', operator: '>=', value: 0.1, probability: 0.5, scale_provenance: { source: 'default', range_unified: true, decision_grade: false } });
    for (const o of env.option_comparison) o.constraint_probabilities.plot_other = 0.5;
    named(deriveConstraintVerdict(env, rat('gc_u2'), LEADER));
  });
  it('C3 no leader to name ⇒ the leader conjunct is not applied', () => {
    named(deriveConstraintVerdict(capture('U2'), rat('gc_u2'), null));
  });
  it('C4 BOUNDARY (pinned on purpose): per-option score with no constraint_results row keeps today\'s answer', () => {
    const env = structuredClone(capture('U2'));
    delete env.constraint_results;
    named(deriveConstraintVerdict(env, rat('gc_u2'), LEADER));
  });
});

describe('data mutants — one field each', () => {
  it('Ma U1 with ONLY decision_grade → true names the leader (the predicate reads decision_grade, not the clamp)', () => {
    const env = structuredClone(capture('U1'));
    env.constraint_results[0].scale_provenance.decision_grade = true;
    named(deriveConstraintVerdict(env, rat('gc_u1'), LEADER));
  });
  it.each([
    ['decision_grade false', (m: Json) => { m.decision_grade = false; }],
    ["decision_grade 'true' (string)", (m: Json) => { m.decision_grade = 'true'; }],
    ["threshold_clamped 'mid' (unknown)", (m: Json) => { m.threshold_clamped = 'mid'; }],
  ] as const)('Mb U2 marker %s withholds', (_n, f) => {
    const env = structuredClone(capture('U2'));
    f(env.constraint_results[0].scale_provenance);
    withheld(deriveConstraintVerdict(env, rat('gc_u2'), LEADER), ['gc_u2']);
  });
  it('Mc U2 marker deleted (contract: absence is fail-closed) withholds', () => {
    const env = structuredClone(capture('U2'));
    delete env.constraint_results[0].scale_provenance;
    withheld(deriveConstraintVerdict(env, rat('gc_u2'), LEADER), ['gc_u2']);
  });
  it('Md two ratified, one uncertified: names exactly the uncertified one', () => {
    const env = structuredClone(capture('U2'));
    env.constraint_results.push(structuredClone(capture('U1').constraint_results[0]));
    for (const o of env.option_comparison) o.constraint_probabilities.gc_u1 = 1;
    withheld(deriveConstraintVerdict(env, rat('gc_u2', 'gc_u1'), LEADER), ['gc_u1']);
  });
});
