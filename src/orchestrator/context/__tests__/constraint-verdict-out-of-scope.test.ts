/**
 * ROADMAP 2.349 — the producer's OWN disclosure that it removed a constraint,
 * and why CEE not reading it cost the user a leading option on every brief
 * carrying a time phrase.
 *
 * THE DEFECT, end to end (diagnosis-gap5-leader-null.md, mechanism traced at
 * the bytes and confirmed by a one-variable control run on staging):
 *
 *   1. CEE mints a "Delivery deadline" constraint from any time phrase in the
 *      brief, `provenance: "inferred"`, and force-binds it to the goal node.
 *   2. It forwards it to PLoT on every analysis run.
 *   3. PLoT DELETES it before ISL — deliberately, because time is not a
 *      modelled dimension — and SAYS SO, in `_meta.filtered_constraints`, with
 *      `reason: 'temporal_deadline'`.
 *   4. CEE had ZERO readers of that channel (repo-wide `rg -a`, scope `src/`
 *      minus tests: 0 hits at `1ba181e`). So the guaranteed absence of a score
 *      was read as "the engine did not check your condition" → `unevaluated` →
 *      `MAY_NAME_LEADING_OPTION.unevaluated === false` → the leading option was
 *      nulled on the wire and the user was told to "re-state that limit
 *      against a measure recorded in the same units" — an instruction that can
 *      never change the outcome, because the dimension is not modelled at all.
 *
 * Three of the four failing walk runs had a clear computable winner (top-2 gap
 * ≈ 3× the tie threshold). This was not an honest withhold.
 *
 * WHAT THIS FILE PINS, in both directions — the pair is the point:
 *
 *   R1  a constraint the producer DISCLOSED it removed no longer withholds.
 *   P1  a constraint that is genuinely unscored STILL withholds (trap 13: the
 *       fix must not lobotomise the real 2.149 withhold, and an absence
 *       assertion is worthless unless something proves a presence).
 *
 * Every `filtered_constraints` fixture below is shaped from PLoT's own
 * `FilteredConstraintRecord` at the pinned deployed SHA
 * `eb73c6a9` (`plot-lite-service/src/types/engine-v3.ts:348`), and the
 * constraint under test is the VERBATIM entry from the walk's draft wire
 * (`journey-witness-2026-08-04b-raw/p3b/wire-run1-0-res.txt`).
 */
import { describe, it, expect } from 'vitest';

import {
  deriveConstraintVerdict,
  MAY_NAME_LEADING_OPTION,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

/**
 * The walk's real minted constraint, id verbatim from the captured draft wire:
 *
 *   {"constraint_id":"constraint_goal_arr_max","node_id":"goal_arr",
 *    "operator":"<=","value":18,"label":"Delivery deadline","unit":"months",
 *    "source_quote":"within 18 months","confidence":0.95,
 *    "provenance":"inferred","deadline_metadata":{…}}
 */
const DEADLINE: RatifiedConstraint = {
  constraint_id: 'constraint_goal_arr_max',
  label: 'Delivery deadline',
};

/** A second, ordinary ratified constraint — the P1 instrument. */
const BUDGET: RatifiedConstraint = {
  constraint_id: 'constraint_out_total_cost_max',
  label: 'Total three-year cost',
};

/**
 * PLoT's disclosure record, member-for-member from `FilteredConstraintRecord`
 * (`{constraint_id, node_id, reason}`) as populated at `routes/v2/run.ts:3808`.
 */
function filteredRecord(constraintId: string, reason = 'temporal_deadline') {
  return { constraint_id: constraintId, node_id: 'goal_arr', reason };
}

/**
 * A doctrine-B envelope carrying NO constraint evaluations — which is what
 * PLoT necessarily returns once the only constraint has been filtered out
 * before ISL (`run.ts:5491-5493`: `activeGoalConstraints` is set only when the
 * POST-filter list is non-empty, so `buildConstraintFields` omits every
 * constraint field).
 */
function envelope(opts: {
  filtered?: ReadonlyArray<Record<string, unknown>>;
  /** Per-option `constraint_probabilities`, keyed as PLoT keys them. */
  constraintProbs?: Record<string, number>;
  constraintsStatus?: string;
  warningCodes?: readonly string[];
  /** Force `_meta` to a garbled value, for the fail-closed controls. */
  metaOverride?: unknown;
}): Record<string, unknown> {
  const option = (id: string, win: number) => ({
    option_id: id,
    option_label: id,
    win_probability: win,
    ...(opts.constraintProbs ? { constraint_probabilities: opts.constraintProbs } : {}),
  });
  return {
    analysis_status: 'completed',
    constraints_status: opts.constraintsStatus ?? 'computed',
    option_comparison: [option('opt_sales', 0.524), option('opt_content', 0.25)],
    ...(opts.warningCodes && opts.warningCodes.length > 0
      ? { inference_warnings: opts.warningCodes.map((code) => ({ code })) }
      : {}),
    ...('metaOverride' in opts
      ? { _meta: opts.metaOverride }
      : opts.filtered
        ? { _meta: { source_path: 'v3', filtered_constraints: opts.filtered } }
        : {}),
    response_hash: 'sha256:fixture',
  };
}

describe('2.349 R1 — a constraint the producer disclosed it removed does not withhold the leader', () => {
  it('the walk case: the ONLY ratified constraint is filtered ⇒ not_applicable, leader may be named', () => {
    const verdict = deriveConstraintVerdict(
      envelope({ filtered: [filteredRecord(DEADLINE.constraint_id)] }),
      [DEADLINE],
      'opt_sales',
    );

    // The three things gap 5 got wrong, pinned as one triple.
    expect(verdict.state).toBe('not_applicable');
    expect(verdict.mayNameLeadingOption).toBe(true);
    // It is NOT filed as a condition the engine failed to check…
    expect(verdict.constraints).toEqual([]);
    // …it is filed as a condition the analysis does not test.
    expect(verdict.outOfScopeConstraints).toEqual([DEADLINE]);
  });

  it("the reason text is NOT allowlisted — PRESENCE in the channel is the signal (trap 12)", () => {
    // PLoT types `reason` as an open `string` and emits two values today. A
    // hand-listed set in CEE would go silently short the day a third appears,
    // and the shortfall would fail in the WITHHOLDING direction — straight back
    // into this defect. Both live reasons, and an invented future one, behave
    // identically.
    for (const reason of [
      'temporal_deadline',
      'temporal_against_normalised_goal',
      'a_reason_that_does_not_exist_yet',
    ]) {
      const verdict = deriveConstraintVerdict(
        envelope({ filtered: [filteredRecord(DEADLINE.constraint_id, reason)] }),
        [DEADLINE],
        'opt_sales',
      );
      expect(verdict.state, reason).toBe('not_applicable');
      expect(verdict.mayNameLeadingOption, reason).toBe(true);
    }
  });

  it('outranks the block-level producer verdict — a code cannot re-withhold a removed constraint', () => {
    // Rule 1 (`codes` / `constraints_status: unavailable`) condemns the whole
    // constraint block. If the partition ran AFTER it, a warning code on a turn
    // whose only constraint was removed would still null the leader — the same
    // defect through a different door.
    const verdict = deriveConstraintVerdict(
      envelope({
        filtered: [filteredRecord(DEADLINE.constraint_id)],
        constraintsStatus: 'unavailable',
        warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'],
      }),
      [DEADLINE],
      'opt_sales',
    );
    expect(verdict.state).toBe('not_applicable');
    expect(verdict.mayNameLeadingOption).toBe(true);
    expect(verdict.outOfScopeConstraints).toEqual([DEADLINE]);
  });
});

describe('2.349 P1 — POSITIVE CONTROL: the real 2.149 withhold still fires (trap 13)', () => {
  it('a ratified constraint that is genuinely unscored still yields unevaluated + no leader', () => {
    // No `_meta` at all: the producer disclosed no removal, and scored nothing.
    // This is the state gap 5's copy was WRITTEN for, and it must survive the
    // fix intact — an absence assertion above is worth nothing unless this
    // presence assertion holds.
    const verdict = deriveConstraintVerdict(envelope({}), [BUDGET], 'opt_sales');
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.mayNameLeadingOption).toBe(false);
    expect(verdict.constraints).toEqual([BUDGET]);
    expect(verdict.outOfScopeConstraints).toEqual([]);
  });

  it('MIXED: one removed + one genuinely unscored ⇒ still withheld, and each is filed correctly', () => {
    const verdict = deriveConstraintVerdict(
      envelope({ filtered: [filteredRecord(DEADLINE.constraint_id)] }),
      [DEADLINE, BUDGET],
      'opt_sales',
    );
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.mayNameLeadingOption).toBe(false);
    // The withhold is about the BUDGET only. Naming the deadline here would
    // re-assert the untruth ("a condition you set was not checked") about a
    // constraint the producer announced it deleted.
    expect(verdict.constraints).toEqual([BUDGET]);
    expect(verdict.outOfScopeConstraints).toEqual([DEADLINE]);
  });

  it('IDENTITY-BOUND: a filtered record naming something we never ratified excludes nothing', () => {
    // The exclusion is by constraint_id, matched exactly. A producer record for
    // an unrelated id must not blanket-clear the withhold — otherwise ANY
    // filtered constraint anywhere in the response would name a leader.
    const verdict = deriveConstraintVerdict(
      envelope({ filtered: [filteredRecord('constraint_something_else_entirely')] }),
      [BUDGET],
      'opt_sales',
    );
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.mayNameLeadingOption).toBe(false);
    expect(verdict.constraints).toEqual([BUDGET]);
    expect(verdict.outOfScopeConstraints).toEqual([]);
  });

  it('identity_unresolved still fires when the surviving constraint cannot be reconciled', () => {
    // PLoT scored something, keyed by its `${node_id}_${operator}` fallback, so
    // nothing reconciles with BUDGET. The deadline is removed; the seam failure
    // on the remaining constraint is still reported honestly.
    const verdict = deriveConstraintVerdict(
      envelope({
        filtered: [filteredRecord(DEADLINE.constraint_id)],
        constraintProbs: { 'out_total_cost_<=': 0.9 },
      }),
      [DEADLINE, BUDGET],
      'opt_sales',
    );
    expect(verdict.state).toBe('identity_unresolved');
    expect(verdict.mayNameLeadingOption).toBe(false);
    expect(verdict.constraints).toEqual([BUDGET]);
    expect(verdict.outOfScopeConstraints).toEqual([DEADLINE]);
  });

  it('evaluated_feasible when the surviving constraint IS scored — the recommendation survives', () => {
    const verdict = deriveConstraintVerdict(
      envelope({
        filtered: [filteredRecord(DEADLINE.constraint_id)],
        constraintProbs: { [BUDGET.constraint_id]: 0.94 },
      }),
      [DEADLINE, BUDGET],
      'opt_sales',
    );
    expect(verdict.state).toBe('evaluated_feasible');
    expect(verdict.mayNameLeadingOption).toBe(true);
    expect(verdict.outOfScopeConstraints).toEqual([DEADLINE]);
  });
});

describe('2.349 — the reader fails CLOSED on every malformed shape', () => {
  // A garbled `_meta` must withhold EXACTLY as it does today. Failing open here
  // would let a malformed producer response name a leader CEE cannot stand
  // behind — the opposite error to the one being fixed, and the worse one.
  const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
    ['_meta absent', undefined],
    ['_meta null', null],
    ['_meta a string', 'nope'],
    ['_meta an array', [{ constraint_id: 'constraint_goal_arr_max' }]],
    ['filtered_constraints not an array', { filtered_constraints: { constraint_id: 'x' } }],
    ['filtered_constraints entries not objects', { filtered_constraints: ['constraint_goal_arr_max'] }],
    ['entry without constraint_id', { filtered_constraints: [{ node_id: 'goal_arr', reason: 'temporal_deadline' }] }],
    ['constraint_id not a string', { filtered_constraints: [{ constraint_id: 18, reason: 'temporal_deadline' }] }],
  ];

  it.each(MALFORMED)('%s ⇒ withheld, byte-identical to the pre-2.349 answer', (_name, metaOverride) => {
    const verdict = deriveConstraintVerdict(
      envelope({ metaOverride }),
      [DEADLINE],
      'opt_sales',
    );
    expect(verdict.state).toBe('unevaluated');
    expect(verdict.mayNameLeadingOption).toBe(false);
    expect(verdict.outOfScopeConstraints).toEqual([]);
  });
});

describe('2.349 — the 2.149 enforcement table is UNTOUCHED', () => {
  it('MAY_NAME_LEADING_OPTION still declares exactly two permitting states', () => {
    // The fix must change what reaches this table, never the table itself.
    // Weakening `unevaluated` to `true` would remove the null AND the honest
    // withhold — the wrong half of the diagnosis's split.
    expect(MAY_NAME_LEADING_OPTION).toEqual({
      not_applicable: true,
      evaluated_feasible: true,
      evaluated_infeasible: false,
      unevaluated: false,
      identity_unresolved: false,
    });
  });
});
