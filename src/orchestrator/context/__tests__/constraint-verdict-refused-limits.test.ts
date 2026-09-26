/**
 * ⛔ A LIMIT THE PRODUCER REFUSED IS "NOT CHECKED", NOT "OUTSIDE THE ANALYSIS" (AI Quality claim-permission
 * ruling, #70 5844891057; found reviewing PLoT #370, 5844876555).
 *
 * `_meta.filtered_constraints` carries two kinds of removal. A deadline the model CANNOT test (PLoT
 * `normalisation/constraint-filter.ts`: `temporal_deadline`, `temporal_against_normalised_goal`) is out of
 * scope, and the leader may be named on what the model does test. A limit PLoT REFUSED because its frame or
 * units could not be read faithfully (ROADMAP 2.878 `delta_frame_value_altered_by_normalisation`; PLoT #370
 * `percent_unit_disagrees_with_target_frame`) could be tested once the frame is stated: it is `unevaluated`,
 * and the leader stays withheld. A reason CEE has never seen, or none, fails CLOSED the same way.
 *
 * Envelope shaped like PLoT's `FilteredConstraintRecord` (`{constraint_id, node_id, reason}`) and its
 * doctrine-B body with no constraint evaluations — what PLoT returns once the only limit was removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  deriveConstraintVerdict,
  OUT_OF_SCOPE_FILTER_REASONS,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

const CHURN: RatifiedConstraint = { constraint_id: 'gc_churn', label: 'Monthly churn' };

function envelope(opts: {
  filtered: ReadonlyArray<Record<string, unknown>>;
  /** `constraint_results` ids the producer scored (certified), and each option's per-constraint P. */
  scored?: readonly string[];
}): Record<string, unknown> {
  const probs = Object.fromEntries((opts.scored ?? []).map((id) => [id, 0.9]));
  const option = (id: string, win: number) => ({
    option_id: id,
    option_label: id,
    win_probability: win,
    ...(opts.scored ? { constraint_probabilities: probs } : {}),
  });
  return {
    analysis_status: 'completed',
    constraints_status: 'computed',
    option_comparison: [option('opt_a', 0.7), option('opt_b', 0.3)],
    ...(opts.scored
      ? {
          constraint_results: opts.scored.map((id) => ({
            constraint_id: id,
            node_id: 'n',
            probability: 0.9,
            scale_provenance: { decision_grade: true },
          })),
        }
      : {}),
    _meta: { source_path: 'v3', filtered_constraints: opts.filtered },
    response_hash: 'sha256:fixture',
  };
}
const refused = (id: string, reason?: string) => ({ constraint_id: id, node_id: 'n', ...(reason === undefined ? {} : { reason }) });

describe('a limit PLoT REFUSED for fidelity withholds the leader (unevaluated)', () => {
  it.each([
    ['#370 percent frame', 'percent_unit_disagrees_with_target_frame'],
    ['2.878 delta altered by normalisation', 'delta_frame_value_altered_by_normalisation'],
    ['a reason CEE has never seen (fails closed)', 'a_reason_that_does_not_exist_yet'],
    ['no reason at all (fails closed)', undefined],
  ])('RED: %s → unevaluated, the limit named, leader withheld', (_n, reason) => {
    const v = deriveConstraintVerdict(envelope({ filtered: [refused(CHURN.constraint_id, reason)] }), [CHURN], 'opt_a');
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([CHURN.constraint_id]);
    expect(v.outOfScopeConstraints).toEqual([]);
  });

  it('CONTROL: the same limit removed as a DEADLINE is out of scope, and the leader may be named', () => {
    const v = deriveConstraintVerdict(envelope({ filtered: [refused(CHURN.constraint_id, 'temporal_deadline')] }), [CHURN], 'opt_a');
    expect(v.state).toBe('not_applicable');
    expect(v.mayNameLeadingOption).toBe(true);
    expect(v.outOfScopeConstraints).toEqual([CHURN]);
  });

  it('RED: a refused limit whose target carries no number still withholds — the refusal outranks "unmeasured"', () => {
    const v = deriveConstraintVerdict(
      envelope({ filtered: [refused(CHURN.constraint_id, 'percent_unit_disagrees_with_target_frame')] }),
      [CHURN],
      'opt_a',
      new Set([CHURN.constraint_id]),
    );
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.unmeasuredTargetConstraints ?? []).toEqual([]);
  });

  it('the permissive list is exactly the two temporal reasons PLoT emits', () => {
    expect([...OUT_OF_SCOPE_FILTER_REASONS].sort()).toEqual(['temporal_against_normalised_goal', 'temporal_deadline']);
  });
});

describe('a refusal is never read as an identity mismatch (rule 2)', () => {
  it('RED: the only ratified limit is refused while PLoT scored something else → unevaluated, not identity_unresolved', () => {
    const v = deriveConstraintVerdict(
      envelope({ filtered: [refused(CHURN.constraint_id, 'percent_unit_disagrees_with_target_frame')], scored: ['compiled:goal'] }),
      [CHURN],
      'opt_a',
    );
    expect(v.state).toBe('unevaluated');
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([CHURN.constraint_id]);
  });

  it('CONTROL: an unrefused limit nothing reconciles with is still identity_unresolved', () => {
    const v = deriveConstraintVerdict(envelope({ filtered: [], scored: ['compiled:goal'] }), [CHURN], 'opt_a');
    expect(v.state).toBe('identity_unresolved');
  });

  it('beside a scored, CERTIFIED limit (verbatim C50 U2 capture), only the refused one is unevaluated', () => {
    // U2: `gc_u2` on root `fac_churn`, `decision_grade: true`, leader `opt_raise`. The refused limit is added.
    const u2 = JSON.parse(readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8')) as Record<string, unknown>;
    const meta = (u2._meta ?? {}) as Record<string, unknown>;
    const env = { ...u2, _meta: { ...meta, filtered_constraints: [refused(CHURN.constraint_id, 'percent_unit_disagrees_with_target_frame')] } };
    const U2_LIMIT: RatifiedConstraint = { constraint_id: 'gc_u2', label: 'Monthly churn', node_id: 'fac_churn' };

    const control = deriveConstraintVerdict({ ...u2 }, [U2_LIMIT], 'opt_raise');
    expect(control.state).toBe('evaluated_feasible');

    const v = deriveConstraintVerdict(env, [CHURN, U2_LIMIT], 'opt_raise');
    expect(v.state).toBe('unevaluated');
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([CHURN.constraint_id]);
  });
});
