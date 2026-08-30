/**
 * A LIMIT BOUND TO A NODE THAT CARRIES NO NUMBER MUST NOT DESTROY THE ANALYSIS.
 *
 * ⚠⚠ THE DEFECT, WIRE-WITNESSED (2026-08-30, 10 runs of one brief across two
 * deployed staging builds). The brief says "our support budget for the year is
 * £240,000". CEE's regex extractor mints the ceiling deterministically, and in
 * 2 of the 10 runs the shared matcher bound it to a `risk` node labelled
 * "Budget Overrun" — captured shape `{id, kind, label, provenance}` and nothing
 * else: no `observed_state`, no `scale_frame`, no `display_value`, no unit, and
 * no option intervening on it. The money sits on a DIFFERENT node ("Annual
 * Support Spend", `scale_frame: 200000`, `observed_state.value: 0.5`) that all
 * three options intervene on.
 *
 * On those two runs the wire read `leading_option_id: null`,
 * `withheld_reason: 'constraint_verdict_withheld'`, and the user was told "no
 * option can be put forward yet" and asked to restate a limit they had already
 * stated unambiguously. **The 8 runs that silently dropped the limit gave the
 * user a better product than the 2 that modelled it.** Producing the constraint
 * inverted the value of the whole turn.
 *
 * ⭐ THE FIX IS A PARTITION, NOT A NEW STATE, AND THAT IS FORCED.
 * `constraint-feasibility.ts` asserts BIDIRECTIONAL assignability between
 * `PersistedClaimSafety` and `@talchain/schemas`' `ConstraintVerdict`, so a
 * sixth `ConstraintVerdictState` is a `pnpm typecheck` failure at the pinned
 * 0.50.0 and the pin may not move. The narrowing therefore reuses ROADMAP
 * 2.349's shape: remove the row from `effective` BEFORE any precedence rule,
 * exactly as producer-filtered rows are removed, and carry it for the
 * disclosure.
 *
 * ⭐ FIXTURES ARE CAPTURED, NOT AUTHORED. Both node shapes below are
 * transcribed verbatim from real deployed `draft_graph` payloads.
 *
 * Assertions bind by constraint-id / node-id IDENTITY (trap 19).
 */
import { describe, it, expect } from 'vitest';

import {
  collectUnmeasuredConstraintTargetIds,
  deriveConstraintVerdict,
  readRatifiedConstraints,
  projectClaimSafety,
} from '../constraint-feasibility.js';
import { buildConstraintDisclosure } from '../../../orchestrator-v5/coaching/constraint-gap-disclosure.js';

/**
 * The bound target from run 54a08b, verbatim. Every field it has is here —
 * that is the point.
 */
const VALUE_LESS_RISK = {
  id: 'b87d004b',
  kind: 'risk',
  label: 'Budget Overrun',
  provenance: 'ai_inferred',
};

/** The value-bearing factor from the SAME captured graph, verbatim. */
const VALUE_BEARING_FACTOR = {
  id: '15bdc1c6',
  kind: 'factor',
  label: 'Annual Support Spend',
  observed_state: {
    value: 0.5,
    source: 'cee_inference',
    extractionType: 'inferred',
    factor_type: 'other',
    uncertainty_drivers: ['Not provided'],
  },
  category: 'controllable',
  scale_frame: 200000,
  display_value: 'Moderate (0.5)',
  provenance: 'ai_inferred',
};

/** The constraint row exactly as run 54a08b persisted it. */
function constraintRow(nodeId: string) {
  return {
    constraint_id: `constraint_${nodeId}_max`,
    node_id: nodeId,
    operator: '<=',
    value: 240000,
    label: 'Keep budget at or below £240,000',
    unit: '£',
    source_quote:
      'Our support budget for the year is £240,000 and each engineer costs about £65,000 fully loaded.',
    confidence: 0.75,
    provenance: 'explicit',
    value_frame: 'level',
  };
}

const GRAPH = { nodes: [VALUE_LESS_RISK, VALUE_BEARING_FACTOR] };

/**
 * A PLoT envelope that scored NOTHING — the shape both bound runs produced.
 * Without a score for the ratified id, rule 3 (`unevaluated`) fires and the
 * leader is withheld. That is the pre-fix behaviour under test.
 */
const NOTHING_SCORED: Record<string, unknown> = {
  option_comparison: [{ option_id: 'opt_hire', win_probability: 0.6 }],
};

function verdictFor(nodeId: string, opts: { withGate: boolean }) {
  const source = { goal_constraints: [constraintRow(nodeId)] };
  const ratified = readRatifiedConstraints(source);
  const unmeasured = opts.withGate
    ? collectUnmeasuredConstraintTargetIds(source, GRAPH)
    : undefined;
  return deriveConstraintVerdict(NOTHING_SCORED, ratified, 'opt_hire', unmeasured);
}

describe('a constraint on a node that carries no number does not withhold the leader', () => {
  it('CONTROL — the captured value-less node really is value-less, and its sibling really is not', () => {
    // Pins the precondition IN-TEST (trap 13b). If the fixtures ever stopped
    // reproducing the captured shapes, every assertion below would pass or fail
    // for a reason unrelated to this fix.
    const ids = collectUnmeasuredConstraintTargetIds(
      { goal_constraints: [constraintRow('b87d004b'), constraintRow('15bdc1c6')] },
      GRAPH,
    );
    expect([...ids]).toEqual(['constraint_b87d004b_max']);
  });

  it('CONTROL — pre-fix behaviour is reproduced when the gate is not supplied', () => {
    // The omitted-argument path must be byte-identical to the product before
    // this change, or the "unchanged" claims below prove nothing.
    const v = verdictFor('b87d004b', { withGate: false });
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(projectClaimSafety(v).may_name_leading_option).toBe(false);
  });

  it('ACCEPTANCE 2 — the analysis completes: the leading option is no longer nulled', () => {
    const v = verdictFor('b87d004b', { withGate: true });
    expect(v.mayNameLeadingOption).toBe(true);
    expect(projectClaimSafety(v).may_name_leading_option).toBe(true);
    // Bound by IDENTITY: it is THIS constraint that was partitioned off.
    expect((v.unmeasuredTargetConstraints ?? []).map((c) => c.constraint_id)).toEqual([
      'constraint_b87d004b_max',
    ]);
    // And it is NOT reported as something the engine failed to check.
    expect(v.constraints).toEqual([]);
  });

  it('ACCEPTANCE 2 — and the user is STILL told, and still asked', () => {
    const v = verdictFor('b87d004b', { withGate: true });
    const text = buildConstraintDisclosure(v, 'Our support budget for the year is £240,000.');
    expect(text.length, 'silence here would be the hiding this ruling forbids').toBeGreaterThan(0);
    expect(text).toContain('Keep budget at or below £240,000');
    // The QUESTION must be there — this is a repairable class, unlike the
    // producer-filtered `out_of_scope` voice, whose closer offers no repair.
    expect(text).toContain('Tell me which part of your model it applies to');
    // And it must NOT claim the analysis was withheld, because it was not.
    expect(text).not.toContain('no option can be put forward');
  });

  it('ACCEPTANCE 3 — POSITIVE CONTROL: a value-bearing target is UNCHANGED', () => {
    const withGate = verdictFor('15bdc1c6', { withGate: true });
    const withoutGate = verdictFor('15bdc1c6', { withGate: false });
    expect(withGate.state).toBe('unevaluated');
    expect(withGate.mayNameLeadingOption).toBe(false);
    expect(withGate.constraints.map((c) => c.constraint_id)).toEqual([
      'constraint_15bdc1c6_max',
    ]);
    expect(withGate.unmeasuredTargetConstraints ?? []).toEqual([]);
    // Byte-identical to the pre-fix verdict, field for field.
    expect(JSON.stringify(withGate)).toBe(
      JSON.stringify({ ...withoutGate, unmeasuredTargetConstraints: [] }),
    );
  });

  it('a target the graph does not contain keeps withholding — we could not look', () => {
    // An absence claim needs evidence. A constraint naming a node this graph
    // has never heard of establishes nothing about whether it carries a value,
    // so the gate must NOT fire and today's withholding stands.
    const source = { goal_constraints: [constraintRow('not_in_this_graph')] };
    expect([...collectUnmeasuredConstraintTargetIds(source, GRAPH)]).toEqual([]);
    const v = deriveConstraintVerdict(
      NOTHING_SCORED,
      readRatifiedConstraints(source),
      'opt_hire',
      collectUnmeasuredConstraintTargetIds(source, GRAPH),
    );
    expect(v.mayNameLeadingOption).toBe(false);
  });

  it('no graph, an empty graph and a malformed graph all keep withholding', () => {
    const source = { goal_constraints: [constraintRow('b87d004b')] };
    for (const graph of [undefined, null, {}, { nodes: [] }, { nodes: 'not-an-array' }, 42]) {
      expect(
        [...collectUnmeasuredConstraintTargetIds(source, graph)],
        `graph ${JSON.stringify(graph)} must not license the narrowing`,
      ).toEqual([]);
    }
  });

  it.each([
    ['observed_state', { observed_state: { value: 0.5 } }],
    ['prior', { prior: { mean: 1 } }],
    ['display_value', { display_value: 'Moderate (0.5)' }],
    ['intercept', { intercept: 0 }],
    ['goal_threshold', { goal_threshold: 0.9 }],
    ['goal_threshold_raw', { goal_threshold_raw: 90 }],
    ['goal_threshold_cap', { goal_threshold_cap: 100 }],
    ['scale_frame', { scale_frame: 200000 }],
    ['data', { data: { value: 0.5 } }],
  ])('ANY quantity field on the target stands the gate down: %s', (_name, extra) => {
    const source = { goal_constraints: [constraintRow('b87d004b')] };
    const graph = { nodes: [{ ...VALUE_LESS_RISK, ...extra }] };
    expect([...collectUnmeasuredConstraintTargetIds(source, graph)]).toEqual([]);
  });

  it('the producer’s own disclosure OUTRANKS this one on the same row', () => {
    // A row PLoT says it removed is reported as out-of-scope, not as
    // unmeasured — two disclosures must never speak about one constraint.
    const source = { goal_constraints: [constraintRow('b87d004b')] };
    const envelope = {
      ...NOTHING_SCORED,
      _meta: { filtered_constraints: [{ constraint_id: 'constraint_b87d004b_max' }] },
    };
    const v = deriveConstraintVerdict(
      envelope,
      readRatifiedConstraints(source),
      'opt_hire',
      collectUnmeasuredConstraintTargetIds(source, GRAPH),
    );
    expect(v.outOfScopeConstraints.map((c) => c.constraint_id)).toEqual([
      'constraint_b87d004b_max',
    ]);
    expect(v.unmeasuredTargetConstraints ?? []).toEqual([]);
  });
});
