/**
 * THE LEADER MAY BE NAMED, BUT IT PROBABLY BREAKS THE USER'S LIMIT — the one predicate the reply and the card consume
 * (AI Quality ruling #70 5842498806, accepted by Delivery Lead 5842513799; contract 5842539827).
 *
 * Defect class: `deriveConstraintVerdict` is `evaluated_infeasible` only at P ≤ 0.05; from there to 0.99 the leader is
 * named and nothing speaks, so a leader that meets "monthly churn ≤ 10%" with P = 0.3 was named in silence.
 *
 * Envelopes are VERBATIM PLoT response bodies (C50 captures, PLoT b09c0f2 / ISL 3c4ab84d); each row structuredClones
 * one and changes the one field it names. U3b is producer-certified (`decision_grade: true`); U1 is clamped (`false`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  deriveConstraintVerdict,
  deriveLeaderLimitRisks,
  LEADER_LIMIT_RISK_THRESHOLD,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

type Json = Record<string, any>;
const capture = (name: 'U1' | 'U3b'): Json =>
  JSON.parse(readFileSync(`tests/fixtures/cross-service/c50-level-demo/${name}.plot-response.json`, 'utf8')) as Json;
const LEADER = 'opt_raise';
const opt = (env: Json, id: string) => (env.option_comparison as Json[]).find((o) => o.option_id === id)!;
const RATIFIED: RatifiedConstraint[] = [{ constraint_id: 'gc_u3b', label: 'First-year cost at most £250k', source_quote: 'keep first-year cost under £250k' }];
/** U3b with the LEADER's own score for gc_u3b set to `p` — the only field changed. */
const u3bLeaderAt = (p: number): Json => {
  const env = structuredClone(capture('U3b'));
  opt(env, LEADER).constraint_probabilities.gc_u3b = p;
  return env;
};

describe('preconditions (bound by identity to the captures)', () => {
  it('U3b is certified and scored for the leader; U1 is clamped', () => {
    const u3b = capture('U3b');
    expect(u3b.constraint_results.map((r: Json) => r.constraint_id)).toEqual(['gc_u3b']);
    expect(u3b.constraint_results[0].scale_provenance.decision_grade).toBe(true);
    expect(opt(u3b, LEADER).constraint_probabilities.gc_u3b).toBeCloseTo(0.981, 3);
    expect(capture('U1').constraint_results[0].scale_provenance.decision_grade).toBe(false);
    expect(LEADER_LIMIT_RISK_THRESHOLD).toBe(0.5);
  });
});

describe('a certified, ratified limit the leader is more likely than not to break is RETURNED', () => {
  it('RED core: leader P = 0.3 on gc_u3b → one risk, identity and words carried from the ratified row', () => {
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.3), LEADER, RATIFIED)).toEqual([
      { constraint_id: 'gc_u3b', label: 'First-year cost at most £250k', source_quote: 'keep first-year cost under £250k', probability: 0.3 },
    ]);
  });

  it('it is exactly the silent case: the verdict for the same envelope is evaluated_feasible and names the leader', () => {
    const v = deriveConstraintVerdict(u3bLeaderAt(0.3), RATIFIED, LEADER);
    expect(v.state).toBe('evaluated_feasible');
    expect(v.mayNameLeadingOption).toBe(true);
  });

  it('just under the threshold (0.4999) is returned; a ratified row with no quote carries null', () => {
    const risks = deriveLeaderLimitRisks(u3bLeaderAt(0.4999), LEADER, [{ constraint_id: 'gc_u3b', label: null }]);
    expect(risks).toEqual([{ constraint_id: 'gc_u3b', label: null, source_quote: null, probability: 0.4999 }]);
  });
});

describe('CONTROLS — never a risk without evidence', () => {
  it('PRESENT control: the capture as served (P 0.981) returns nothing', () => {
    expect(deriveLeaderLimitRisks(capture('U3b'), LEADER, RATIFIED)).toEqual([]);
  });

  it('exactly 0.5 is not "more likely than not" broken — nothing', () => {
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.5), LEADER, RATIFIED)).toEqual([]);
  });

  it('an UNCERTIFIED score (U1, clamped, decision_grade false) returns nothing even at a low P', () => {
    const env = structuredClone(capture('U1'));
    opt(env, LEADER).constraint_probabilities.gc_u1 = 0.1;
    expect(deriveLeaderLimitRisks(env, LEADER, [{ constraint_id: 'gc_u1', label: null }])).toEqual([]);
  });

  it('a certified marker REMOVED from the row returns nothing (absence is not certification)', () => {
    const env = u3bLeaderAt(0.3);
    delete env.constraint_results[0].scale_provenance;
    expect(deriveLeaderLimitRisks(env, LEADER, RATIFIED)).toEqual([]);
  });

  it('a row with no constraint_results entry at all returns nothing', () => {
    const env = u3bLeaderAt(0.3);
    env.constraint_results = [];
    expect(deriveLeaderLimitRisks(env, LEADER, RATIFIED)).toEqual([]);
  });

  it('a limit that is NOT ratified returns nothing (only the user\'s limits are spoken for)', () => {
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.3), LEADER, [{ constraint_id: 'gc_other', label: null }])).toEqual([]);
  });

  it('a low score on ANOTHER option, with the leader\'s own score removed, returns nothing', () => {
    const env = u3bLeaderAt(0.9);
    const other = (env.option_comparison as Json[]).find((o) => o.option_id !== LEADER)!;
    other.constraint_probabilities.gc_u3b = 0.1;
    delete opt(env, LEADER).constraint_probabilities.gc_u3b;
    expect(deriveLeaderLimitRisks(env, LEADER, RATIFIED)).toEqual([]);
  });

  it('a low score on another option does not condemn a leader that meets the limit', () => {
    const env = u3bLeaderAt(0.9);
    const other = (env.option_comparison as Json[]).find((o) => o.option_id !== LEADER)!;
    other.constraint_probabilities.gc_u3b = 0.1;
    expect(deriveLeaderLimitRisks(env, LEADER, RATIFIED)).toEqual([]);
  });

  it('no leader, or a leader id no option carries, returns nothing', () => {
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.3), null, RATIFIED)).toEqual([]);
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.3), '', RATIFIED)).toEqual([]);
    expect(deriveLeaderLimitRisks(u3bLeaderAt(0.3), 'opt_absent', RATIFIED)).toEqual([]);
  });
});
