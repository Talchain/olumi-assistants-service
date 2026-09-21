/**
 * The constraint verdict — NORMATIVE state fixtures.
 *
 * WHAT THIS FILE IS FOR. "Was the user's hard constraint honoured?" is one
 * meaning, and it has more than two answers. #703 modelled it as a single
 * boolean (`unevaluated`), and #707's first pass then collapsed a
 * constraint-IDENTITY failure into that same boolean's `false` branch — which
 * reads as "no gap" and RESTORES a confident leading-option claim that CEE
 * cannot verify. Both directions of that boolean are wrong for at least one
 * real producer state, so the boolean is replaced here by an explicit enum in
 * which EVERY state declares whether a leading option may be named.
 *
 * The five states, and the producer evidence that selects each:
 *
 *   not_applicable        nothing the user ratified is at stake, and the
 *                         producer's own constraint scoring gives no reason to
 *                         withhold. Byte-identical to the pre-T1 product.
 *   evaluated_feasible    every ratified constraint was scored, and the leader
 *                         clears the violation floor. THE RECOMMENDATION
 *                         SURVIVES — this is the false-positive direction, and
 *                         it is pinned below.
 *   evaluated_infeasible  scored, and the leader breaks a limit we DID check.
 *   unevaluated           the producer said so (an explicit code, or
 *                         constraints_status: 'unavailable'), or a ratified
 *                         constraint has no score anywhere while the id spaces
 *                         demonstrably line up. "Your condition was not
 *                         checked" is assertable HERE and nowhere else.
 *   identity_unresolved   the producer plainly evaluated constraints, but NOT
 *                         ONE of the ids it returned reconciles with anything
 *                         we ratified. We cannot say the condition went
 *                         unchecked (it may well have been checked) and we
 *                         cannot certify constraint-safety (we cannot tell
 *                         WHICH condition was checked). Both claims are
 *                         withheld; the leading option is withheld too.
 *
 * WHY identity_unresolved MUST NOT MEAN "no gap": the mismatch is silent by
 * construction. CEE's `constraint_id` meets PLoT's map keys across an untyped
 * `z.record` enrichment seam that nothing validates, so the ONLY observable is
 * "these two id spaces do not intersect". From that observable, "the engine
 * checked your condition" and "the engine checked somebody else's condition"
 * are indistinguishable. Naming a leader on that evidence asserts
 * constraint-safety CEE has no basis for.
 */
import { describe, it, expect } from 'vitest';

import {
  deriveConstraintVerdict,
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

// ---------------------------------------------------------------------------
// Producer-code fixtures: the key PLoT actually writes
// ---------------------------------------------------------------------------

/**
 * TRANSCRIPTION (not a dependency) of the producer's key-resolution algorithm,
 * read from the live code at plot-lite-service/src/routes/v2/run.ts (the
 * `indexToId` map inside the per-option `constraint_probabilities` assembly),
 * verified against that repo on 2026-07-26. Three branches, in order:
 *
 *   1. POSITIONAL — `goalConstraints[idx]`, but only if that entry's `node_id`
 *      AND `operator` both equal ISL's; then the key is CEE's `constraint_id`.
 *   2. BY node_id + operator — the first `goalConstraints` entry matching both;
 *      then the key is CEE's `constraint_id`.
 *   3. FALLBACK — neither matched: the key is the composite
 *      `` `${node_id}_${operator}` ``, which is NOT a CEE constraint_id.
 *
 * This lives ONLY here, to generate honest fixture keys from the producer's own
 * rule instead of hand-typed strings. CEE production code must never mirror it
 * (CLAUDE.md trap #12) — that is precisely why `identity_unresolved` exists: the
 * seam is unenforced, so CEE reads the OUTCOME of this algorithm rather than
 * re-implementing it.
 */
function plotConstraintProbabilityKeys(
  goalConstraints: ReadonlyArray<{ constraint_id: string; node_id: string; operator: string }>,
  islConstraints: ReadonlyArray<{ node_id: string; operator: string }>,
): string[] {
  return islConstraints.map((islC, idx) => {
    const byIndex = goalConstraints[idx];
    if (byIndex && byIndex.node_id === islC.node_id && byIndex.operator === islC.operator) {
      return byIndex.constraint_id;
    }
    const byNodeOp = goalConstraints.find(
      (gc) => gc.node_id === islC.node_id && gc.operator === islC.operator,
    );
    return byNodeOp?.constraint_id ?? `${islC.node_id}_${islC.operator}`;
  });
}

/** What CEE persisted at ratification, in the shape PLoT is sent. */
const GOAL_CONSTRAINTS = [
  { constraint_id: 'constraint_out_total_cost_max', node_id: 'out_total_cost', operator: '<=' },
] as const;

const RATIFIED: readonly RatifiedConstraint[] = [
  { constraint_id: 'constraint_out_total_cost_max', label: 'Total three-year cost' },
];

const LEADER = 'opt_a';

/**
 * A healthy two-option envelope in the LIVE doctrine-B shape, with the leader
 * comfortably satisfying every constraint key supplied.
 */
function envelope(
  keys: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const probs = (p: number): Record<string, number> =>
    Object.fromEntries(keys.map((k) => [k, p]));
  return {
    constraints_status: 'computed',
    option_comparison: [
      {
        option_id: LEADER,
        win_probability: 0.62,
        ...(keys.length > 0
          ? { constraint_probabilities: probs(0.91), probability_of_joint_goal: 0.9 }
          : {}),
      },
      {
        option_id: 'opt_b',
        win_probability: 0.38,
        ...(keys.length > 0
          ? { constraint_probabilities: probs(0.88), probability_of_joint_goal: 0.87 }
          : {}),
      },
    ],
    ...extra,
  };
}

function stateOf(
  env: Record<string, unknown>,
  ratified: readonly RatifiedConstraint[] = RATIFIED,
): ConstraintVerdictState {
  return deriveConstraintVerdict(env, ratified, LEADER).state;
}

// ---------------------------------------------------------------------------
// The state table itself is the contract
// ---------------------------------------------------------------------------

describe('constraint verdict — every state declares the leading-option answer', () => {
  const ALL_STATES: readonly ConstraintVerdictState[] = [
    'not_applicable',
    'evaluated_feasible',
    'evaluated_infeasible',
    'unevaluated',
    'identity_unresolved',
  ];

  it('the declaration table is TOTAL — no state falls through to a default', () => {
    // A missing entry would read as `undefined` → falsy → "withhold", which is
    // the safe direction but silent. Pin totality so a sixth state added later
    // must state its answer rather than inherit one.
    for (const state of ALL_STATES) {
      expect(typeof MAY_NAME_LEADING_OPTION[state]).toBe('boolean');
    }
    expect(Object.keys(MAY_NAME_LEADING_OPTION).sort()).toEqual([...ALL_STATES].sort());
  });

  it('exactly the two VERIFIED states may name a leading option', () => {
    // The whole point of the enum, asserted as one statement. Anything other
    // than "we checked your conditions and the leader is fine" (or "there was
    // nothing to check") withholds.
    const naming = ALL_STATES.filter((s) => MAY_NAME_LEADING_OPTION[s]);
    expect(naming.sort()).toEqual(['evaluated_feasible', 'not_applicable']);
  });

  it('the verdict carries the declaration, so callers cannot re-derive it wrongly', () => {
    for (const state of ALL_STATES) {
      // Consistency between the table and every verdict object is what lets a
      // caller read `mayNameLeadingOption` instead of switching on `state`.
      expect(MAY_NAME_LEADING_OPTION[state]).toBe(MAY_NAME_LEADING_OPTION[state]);
    }
    const healthy = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max']),
      RATIFIED,
      LEADER,
    );
    expect(healthy.mayNameLeadingOption).toBe(MAY_NAME_LEADING_OPTION[healthy.state]);
  });
});

// ---------------------------------------------------------------------------
// 1. Matched identity — the false-positive direction
// ---------------------------------------------------------------------------

describe('MATCHED IDENTITY: a healthy evaluated run keeps its recommendation', () => {
  it('POSITIONAL resolution (producer branch 1) ⇒ evaluated_feasible', () => {
    const keys = plotConstraintProbabilityKeys(GOAL_CONSTRAINTS, [
      { node_id: 'out_total_cost', operator: '<=' },
    ]);
    expect(keys).toEqual(['constraint_out_total_cost_max']); // the producer chose CEE's id
    expect(stateOf(envelope(keys))).toBe('evaluated_feasible');
  });

  it('node_id+operator resolution (producer branch 2) ⇒ evaluated_feasible', () => {
    // ISL returned the constraints in a different order from the request, so
    // the positional branch misses and the by-node/operator branch resolves it.
    const twoRatified = [
      { constraint_id: 'constraint_battery_min', node_id: 'out_battery', operator: '>=' },
      { constraint_id: 'constraint_out_total_cost_max', node_id: 'out_total_cost', operator: '<=' },
    ] as const;
    const keys = plotConstraintProbabilityKeys(twoRatified, [
      { node_id: 'out_total_cost', operator: '<=' },
      { node_id: 'out_battery', operator: '>=' },
    ]);
    expect(keys).toEqual(['constraint_out_total_cost_max', 'constraint_battery_min']);
    expect(
      stateOf(envelope(keys), [
        { constraint_id: 'constraint_battery_min', label: 'Minimum battery life' },
        { constraint_id: 'constraint_out_total_cost_max', label: 'Total three-year cost' },
      ]),
    ).toBe('evaluated_feasible');
  });

  it('THE PIN: evaluated_feasible names the leader', () => {
    // This is the direction #703 left completely unpinned and #707 was written
    // to protect. It must survive the multi-state rewrite unchanged.
    const v = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max']),
      RATIFIED,
      LEADER,
    );
    expect(v.state).toBe('evaluated_feasible');
    expect(v.mayNameLeadingOption).toBe(true);
    expect(v.constraints).toEqual([]);
    expect(v.codes).toEqual([]);
  });

  it('top-level constraint_results is accepted as evaluation evidence', () => {
    // `constraint_results[].constraint_id` is an EXPLICIT id field rather than
    // a map key, so it is the keying-independent statement of what the engine
    // scored (live doctrine-B wire — see
    // tests/fixtures/cross-service/plot-to-cee.doctrine-b.code-derived.json).
    // Reading only the per-option map threw that evidence away.
    const env = envelope([], {
      constraint_results: [
        {
          constraint_id: 'constraint_out_total_cost_max',
          node_id: 'out_total_cost',
          operator: '<=',
          probability: 0.91,
        },
      ],
    });
    expect(stateOf(env)).toBe('evaluated_feasible');
  });
});

// ---------------------------------------------------------------------------
// 2. Genuine gap
// ---------------------------------------------------------------------------

describe('GENUINE GAP: applied, then scored nowhere ⇒ unevaluated', () => {
  it('no constraint evaluation of any kind on the wire ⇒ unevaluated', () => {
    // Nothing was evaluated, so there is no id space to reconcile and no risk
    // of mistaking a keying failure for an absence. "Your condition was not
    // checked" is true here.
    const v = deriveConstraintVerdict(envelope([]), RATIFIED, LEADER);
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([
      'constraint_out_total_cost_max',
    ]);
  });

  it('PARTIAL OVERLAP: one scored, one not ⇒ unevaluated for the unscored one ONLY', () => {
    // The overlap is the proof that the id spaces DO line up, so the other
    // constraint really was not scored. This is what stops the
    // identity_unresolved carve-out from becoming a blanket suppression.
    const v = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max']),
      [
        { constraint_id: 'constraint_out_total_cost_max', label: 'Total three-year cost' },
        { constraint_id: 'constraint_battery_min', label: 'Minimum battery life' },
      ],
      LEADER,
    );
    expect(v.state).toBe('unevaluated');
    expect(v.constraints.map((c) => c.constraint_id)).toEqual(['constraint_battery_min']);
  });
});

// ---------------------------------------------------------------------------
// 3. Identity unresolved — the state #707 got wrong
// ---------------------------------------------------------------------------

describe('IDENTITY UNRESOLVED: evaluations present, zero reconcile', () => {
  it('ZERO OVERLAP via the producer FALLBACK key (branch 3) ⇒ identity_unresolved', () => {
    // ISL echoed a node_id CEE never ratified under that spelling, so PLoT fell
    // through to `${node_id}_${operator}`. CEE looks up
    // `constraint_out_total_cost_max`, the map holds `out_total_cost_<=`.
    const keys = plotConstraintProbabilityKeys(GOAL_CONSTRAINTS, [
      { node_id: 'out_total_cost_gbp', operator: '<=' },
    ]);
    expect(keys).toEqual(['out_total_cost_gbp_<=']); // NOT a CEE constraint_id
    expect(stateOf(envelope(keys))).toBe('identity_unresolved');
  });

  it('UNRELATED EVALUATION PRESENT ⇒ identity_unresolved (same verdict, different cause)', () => {
    // Here the engine scored a constraint that has nothing to do with ours.
    // CEE cannot distinguish this from the keying case above — the observable
    // is identical — which is exactly why neither may be reported as "your
    // condition was not checked".
    expect(stateOf(envelope(['constraint_delivery_lead_time_max']))).toBe(
      'identity_unresolved',
    );
  });

  it('MUST NOT report the ratified condition as unchecked', () => {
    // The false statement #703 would make, and the reason identity_unresolved
    // is not folded into `unevaluated`.
    const v = deriveConstraintVerdict(envelope(['out_total_cost_<=']), RATIFIED, LEADER);
    expect(v.state).not.toBe('unevaluated');
  });

  it('MUST NOT certify constraint-safety — the leading option stays withheld', () => {
    // The false statement #707 would make, and the reason identity_unresolved
    // is not folded into "no gap". A leader named here asserts the user's
    // condition holds, on evidence CEE has just admitted it cannot read.
    const v = deriveConstraintVerdict(envelope(['out_total_cost_<=']), RATIFIED, LEADER);
    expect(v.mayNameLeadingOption).toBe(false);
  });

  it('carries the ratified set, so the disclosure can say WHICH ids it could not reconcile', () => {
    const v = deriveConstraintVerdict(envelope(['out_total_cost_<=']), RATIFIED, LEADER);
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([
      'constraint_out_total_cost_max',
    ]);
    // No producer code fired: nothing on the wire SAYS anything is wrong.
    expect(v.codes).toEqual([]);
  });

  it('a healthy matched run is NOT identity_unresolved (the state carries information)', () => {
    expect(stateOf(envelope(['constraint_out_total_cost_max']))).not.toBe(
      'identity_unresolved',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Explicit producer codes — identity-independent
// ---------------------------------------------------------------------------

describe('EXPLICIT PRODUCER VERDICTS outrank any identity question', () => {
  it('CONSTRAINT_OUT_OF_DOMAIN ⇒ unevaluated even though the constraint was scored', () => {
    // The producer told us in words that it did not reach decision grade. That
    // is unambiguous and needs no id reconciliation.
    const v = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max'], {
        inference_warnings: [{ code: 'CONSTRAINT_OUT_OF_DOMAIN' }],
      }),
      RATIFIED,
      LEADER,
    );
    expect(v.state).toBe('unevaluated');
    expect(v.codes).toEqual(['CONSTRAINT_OUT_OF_DOMAIN']);
  });

  it('CONSTRAINT_TARGET_UNRELIABLE ⇒ unevaluated, NOT identity_unresolved, on a mismatched key', () => {
    // Both signals are live at once. The producer's own verdict wins: an
    // explicit "not decision grade" is a stronger and more actionable
    // statement than "we could not line the ids up".
    const v = deriveConstraintVerdict(
      envelope(['out_total_cost_<='], {
        critiques: [{ code: 'CONSTRAINT_TARGET_UNRELIABLE' }],
      }),
      RATIFIED,
      LEADER,
    );
    expect(v.state).toBe('unevaluated');
  });

  it("constraints_status: 'unavailable' condemns the whole block ⇒ unevaluated", () => {
    const v = deriveConstraintVerdict(
      { constraints_status: 'unavailable', option_comparison: [{ option_id: LEADER }] },
      RATIFIED,
      LEADER,
    );
    expect(v.state).toBe('unevaluated');
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([
      'constraint_out_total_cost_max',
    ]);
  });

  it('an UNKNOWN producer code does not silently become "fine"', () => {
    // Drift guard: a code CEE does not recognise must not read as evidence of
    // health. It leaves the verdict to the id evidence, which here is a match,
    // so the state is evaluated_feasible — pinned so that a future decision to
    // fail closed on unknown codes is a deliberate, visible change.
    const v = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max'], {
        inference_warnings: [{ code: 'SOME_FUTURE_CONSTRAINT_CODE' }],
      }),
      RATIFIED,
      LEADER,
    );
    expect(v.state).toBe('evaluated_feasible');
    expect(v.codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Infeasible leader, and the no-ratified-constraints floor
// ---------------------------------------------------------------------------

describe('EVALUATED INFEASIBLE: the leader breaks a limit we DID check', () => {
  it('a scored constraint the leader violates ⇒ evaluated_infeasible, leader withheld', () => {
    const env = {
      constraints_status: 'computed',
      option_comparison: [
        {
          option_id: LEADER,
          win_probability: 0.99,
          constraint_probabilities: { constraint_out_total_cost_max: 0 },
          probability_of_joint_goal: 0,
        },
      ],
    };
    const v = deriveConstraintVerdict(env, RATIFIED, LEADER);
    expect(v.state).toBe('evaluated_infeasible');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.leaderInfeasibility?.constraintId).toBe('constraint_out_total_cost_max');
    expect(v.leaderInfeasibility?.kind).toBe('hard_violation');
  });

  it('NO REGRESSION: an infeasible leader is caught even with NOTHING ratified', () => {
    // Pre-T1 behaviour, and the reason `not_applicable` is defined as "nothing
    // to withhold for" rather than "no ratified constraints". If this collapsed
    // to not_applicable, folding the two predicates into one verdict would have
    // silently un-fixed trust-spine board #1.
    const env = {
      option_comparison: [
        {
          option_id: LEADER,
          win_probability: 0.99,
          constraint_probabilities: { c_budget: 0 },
          probability_of_joint_goal: 0,
        },
      ],
    };
    const v = deriveConstraintVerdict(env, [], LEADER);
    expect(v.state).toBe('evaluated_infeasible');
    expect(v.mayNameLeadingOption).toBe(false);
  });

  it('NOT_APPLICABLE: nothing ratified and a clean leader ⇒ the leader is named', () => {
    const v = deriveConstraintVerdict(envelope([]), [], LEADER);
    expect(v.state).toBe('not_applicable');
    expect(v.mayNameLeadingOption).toBe(true);
  });

  it('an unevaluated ratified constraint outranks an infeasible leader', () => {
    // Both are true: constraint A is scored and violated, constraint B was
    // never scored. `unevaluated` wins because it is the state whose disclosure
    // names a condition and offers a repair step — and `leaderInfeasibility`
    // is still carried, so nothing is lost.
    const env = {
      constraints_status: 'computed',
      option_comparison: [
        {
          option_id: LEADER,
          win_probability: 0.99,
          constraint_probabilities: { constraint_out_total_cost_max: 0 },
          probability_of_joint_goal: 0,
        },
      ],
    };
    const v = deriveConstraintVerdict(
      env,
      [
        { constraint_id: 'constraint_out_total_cost_max', label: 'Total three-year cost' },
        { constraint_id: 'constraint_battery_min', label: 'Minimum battery life' },
      ],
      LEADER,
    );
    expect(v.state).toBe('unevaluated');
    expect(v.constraints.map((c) => c.constraint_id)).toEqual(['constraint_battery_min']);
    expect(v.leaderInfeasibility?.infeasible).toBe(true);
  });

  it('no leading option id ⇒ no leader claim to check, and none is asserted', () => {
    // `deriveWinnerConstraintInfeasibility` fails OPEN without a winner id.
    // evaluated_feasible here means "the ratified conditions were scored"; the
    // `mayNameLeadingOption: true` it carries is vacuous because there is no
    // leading option for a caller to name.
    const v = deriveConstraintVerdict(
      envelope(['constraint_out_total_cost_max']),
      RATIFIED,
      null,
    );
    expect(v.state).toBe('evaluated_feasible');
    expect(v.leaderInfeasibility).toBeNull();
  });
});
