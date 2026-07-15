/**
 * Gate-1 constraint unit-integrity — unit preservation on update + the
 * unit-ambiguity emit guard.
 *
 * The live defect (2026-07-15, scenario 906d6aff…, row gc-cdd6eb74…):
 * a conversational constraint UPDATE that omitted the unit REPLACED the
 * whole persisted row, dropping its `%`. The unit-less `{value: 30}` on
 * a risk node then fell through PLoT's range-priority to the default
 * [0,1] range, was clamped to 1.0, and ISL evaluated "attrition <= 30%"
 * as `<= 1.0` — trivially satisfied. The analysis reported the guardrail
 * as checked-and-passed while it was never evaluated (silent guardrail
 * nullification). Diagnosis: acceptance-evidence/constraint-unit-drop/.
 *
 * Two fixes under test, both in add-constraint.ts:
 *
 *   1. UNIT PRESERVATION (Paul-ruled doctrine: omission means UNCHANGED).
 *      The unit fallback chain gains `existing?.unit` between the explicit
 *      parameter and the node's observed unit: an update turn that does
 *      not mention a unit keeps the persisted constraint's unit ("keep it
 *      at most 30" means 30 of the same kind). Never silently clear.
 *
 *   2. UNIT-AMBIGUITY EMIT GUARD (the boundary bar: a constraint must not
 *      reach the wire unit-ambiguous). A constraint that is unit-less
 *      with a value outside [0,1], targeting a probability-domain node
 *      (goal / outcome / risk) with no declared cap, is KNOWN to be
 *      heuristically normalised downstream (clamped to a trivially-true —
 *      or, for negatives, trivially-false — threshold). Refuse to persist
 *      it and ask the user for the unit, via the same wired
 *      D1HandlerError(PARAMETER_INVALID) + userGuidance mechanic the
 *      reduction-sign backstop uses (userGuidance → details.specific_issue
 *      → the recoverable composer's full assistant_text).
 *
 * Wiring over purity: assertions target the PERSISTED constraint object
 * on `mutated_graph` (the object `mergeMutatedGraphForPersistence`
 * commits), the handler-fact `result.after`, the registry-dispatched
 * handler (production dispatch surface, not just the factory), and the
 * USER-VISIBLE refusal text through the production failure composer.
 */

import { describe, expect, it } from 'vitest';

import type { AddConstraintHandlerFact } from '@talchain/schemas/orchestrator';

import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { StageType } from '@talchain/schemas/boundary';

import { composeHandlerFailure } from '../../../compose/handler-failure-responses.js';
import type { ComposeContext } from '../../../compose/types.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { createRegistry } from '../../registry.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Base fixture + a risk node shaped like the live defect's target:
 * `risk_talent_loss` had `observed_state: null`, `state_space: null`,
 * no goal_threshold fields — nothing downstream deriveRange can read.
 */
function withBareRiskNode(): GraphV3T {
  const base = buildD1Fixture();
  return {
    ...base,
    nodes: [
      ...base.nodes,
      {
        id: 'r-attrition',
        kind: 'risk',
        label: 'Key Talent Attrition',
      },
    ],
  };
}

/**
 * Risk node WITH a declared cap but NO unit anywhere — the cap is the
 * ONLY exemption in play, so the test discriminates the declared-cap
 * condition specifically (a `%` in observed_state would be inherited by
 * the fallback chain and exempt via the unit instead).
 */
function withCappedRiskNode(): GraphV3T {
  const base = buildD1Fixture();
  return {
    ...base,
    nodes: [
      ...base.nodes,
      {
        id: 'r-capped',
        kind: 'risk',
        label: 'Churn Risk',
        observed_state: { value: 5, cap: 100 },
      },
    ],
  };
}

function seedConstraint(
  graph: GraphV3T,
  row: NonNullable<GraphV3T['goal_constraints']>[number],
): GraphV3T {
  return { ...graph, goal_constraints: [row] };
}

function makeProposal(p: {
  readonly entityId: string;
  readonly entityKind?: 'node' | 'goal';
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
  readonly label?: string;
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit !== undefined) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  if (p.label !== undefined) params.push({ name: 'label', value: p.label, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: {
      id: p.entityId,
      kind: p.entityKind ?? 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

function invoke(graph: GraphV3T, proposal: ProposalAction) {
  return buildHandlerInvocation({
    graph,
    proposal,
    scenarioId: 'scn-unit-integrity',
    turnId: 'turn-unit-integrity',
    requestId: 'req-unit-integrity',
    message: 'constrain it',
  });
}

async function captureFailure(
  graph: GraphV3T,
  proposal: ProposalAction,
): Promise<HandlerInvocationFailedError> {
  const handler = createAddConstraintHandler();
  try {
    await handler(invoke(graph, proposal));
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) return err;
    throw err;
  }
  throw new Error('expected the handler to refuse, but it persisted the constraint');
}

/**
 * Leak-panel subset for the NEW user-facing clarify string (mirrors
 * d1-user-guidance-leak.test.ts's forbidden list; kept local so this
 * lane's file does not collide with sibling-lane edits to the shared
 * panel).
 */
const FORBIDDEN_IN_USER_COPY: readonly string[] = [
  'add_constraint',
  'constraint_type',
  '"value"',
  '"unit"',
  'at_least',
  'at_most',
  ' >= ',
  ' <= ',
  'parameter_invalid',
  'cause_kind',
  'handler_id',
  'd1_code',
  'specific_issue',
];

// ---------------------------------------------------------------------------
// Part 1 — unit preservation on update (omission means UNCHANGED)
// ---------------------------------------------------------------------------

describe('add_constraint unit preservation — omission means UNCHANGED (Gate-1)', () => {
  it('live-defect replay: an update omitting the unit keeps the persisted "%" (gc-cdd6eb74 class)', async () => {
    // The exact live shape: risk node with no observed_state, existing
    // row {value: 30, unit: '%'}, update turn restates 30 with no unit.
    const graph = seedConstraint(withBareRiskNode(), {
      constraint_id: 'gc-live-defect',
      node_id: 'r-attrition',
      operator: '<=',
      value: 30,
      unit: '%',
      label: 'Key Talent Attrition',
      provenance: 'explicit',
    });
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(graph, makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30 })),
    );

    // The PERSISTED object — this is what mergeMutatedGraphForPersistence
    // commits and build-turn-context forwards to PLoT verbatim.
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    const row = mutated.goal_constraints![0];
    expect(row.constraint_id).toBe('gc-live-defect');
    expect(row.value).toBe(30);
    expect(row.unit).toBe('%'); // pre-fix: undefined (the defect)

    // The fact channel agrees.
    const fact = outcome.handler_facts[0] as AddConstraintHandlerFact;
    const after = fact.result.after as Record<string, unknown>;
    expect(after.unit).toBe('%');

    // With the unit preserved, a same-value restatement is genuinely
    // unchanged — the honest noop receipt, not a false "Updated" claim.
    expect(outcome.handler_facts[0]?.noop).toBe(true);
    expect(outcome.assistant_text).toBe(
      'Key Talent Attrition is already constrained to be at most 30%.',
    );
  });

  it('update with a NEW value and no unit: value moves, unit is preserved', async () => {
    const graph = seedConstraint(withBareRiskNode(), {
      constraint_id: 'gc-live-defect',
      node_id: 'r-attrition',
      operator: '<=',
      value: 30,
      unit: '%',
      label: 'Key Talent Attrition',
      provenance: 'explicit',
    });
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(graph, makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 25 })),
    );
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints![0];
    expect(row.value).toBe(25);
    expect(row.unit).toBe('%');
    expect(outcome.handler_facts[0]?.noop).toBe(false);
    // The user-visible receipt carries the preserved unit.
    expect(outcome.assistant_text).toBe(
      'Updated constraint: Key Talent Attrition must be at most 25%.',
    );
  });

  it('an explicit unit on the update outranks the persisted unit', async () => {
    const graph = seedConstraint(buildD1Fixture(), {
      constraint_id: 'gc-budget',
      node_id: 'f-budget',
      operator: '<=',
      value: 50000,
      unit: '£',
      label: 'Marketing budget',
      provenance: 'explicit',
    });
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        graph,
        makeProposal({ entityId: 'f-budget', constraintType: 'at_most', value: 40, unit: '%' }),
      ),
    );
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].unit).toBe('%');
  });

  it('ordering pin: the existing row unit outranks the node observed unit on update ("30 of the same kind")', async () => {
    // f-budget's observed_state.unit is '£'; the persisted row carries
    // '%'. Under "omission means UNCHANGED" the update keeps the ROW's
    // unit — the prior state of the thing being updated — not the node's
    // display unit.
    const graph = seedConstraint(buildD1Fixture(), {
      constraint_id: 'gc-budget-pct',
      node_id: 'f-budget',
      operator: '<=',
      value: 50,
      unit: '%',
      label: 'Marketing budget',
      provenance: 'explicit',
    });
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(graph, makeProposal({ entityId: 'f-budget', constraintType: 'at_most', value: 40 })),
    );
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].unit).toBe('%');
  });

  it('fresh add still falls back to the node observed unit (pre-existing behaviour unchanged)', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        makeProposal({ entityId: 'f-uncapped', constraintType: 'at_most', value: 30 }),
      ),
    );
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].unit).toBe('people');
  });

  it('repair path: an update that STATES the unit resolves a previously unit-less row', async () => {
    // The live-repair mechanism: the poisoned row {value: 30, no unit}
    // is repaired through the front door by restating "at most 30%".
    const graph = seedConstraint(withBareRiskNode(), {
      constraint_id: 'gc-poisoned',
      node_id: 'r-attrition',
      operator: '<=',
      value: 30,
      label: 'Key Talent Attrition',
      provenance: 'explicit',
    });
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        graph,
        makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30, unit: '%' }),
      ),
    );
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints![0];
    expect(row.constraint_id).toBe('gc-poisoned');
    expect(row.value).toBe(30);
    expect(row.unit).toBe('%');
    // Unit changed (undefined → '%') so this is a genuine update, and the
    // receipt confirms the repair user-visibly.
    expect(outcome.handler_facts[0]?.noop).toBe(false);
    expect(outcome.assistant_text).toBe(
      'Updated constraint: Key Talent Attrition must be at most 30%.',
    );
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the unit-ambiguity emit guard
// ---------------------------------------------------------------------------

describe('add_constraint unit-ambiguity emit guard — a constraint must not reach the wire unit-ambiguous (Gate-1)', () => {
  it('refuses a unit-less value > 1 on a bare probability-domain (risk) node — dispatched through the PRODUCTION registry', async () => {
    // Wiring proof: resolve the handler off createRegistry() — the same
    // map the turn-executor dispatches — not the factory import.
    const handler = createRegistry().get('add_constraint');
    expect(handler).toBeDefined();
    let caught: unknown;
    try {
      await handler!(
        invoke(
          withBareRiskNode(),
          makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30 }),
        ),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = caught as HandlerInvocationFailedError;
    expect(failure.cause_kind).toBe('parameter_invalid_at_execute');
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });

  it('the refusal is a user-visible clarify through the production failure composer, and it leaks no internals', async () => {
    const failure = await captureFailure(
      withBareRiskNode(),
      makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30 }),
    );

    const issue = failure.details['specific_issue'];
    expect(typeof issue).toBe('string');
    const clarify = issue as string;
    // The clarify names the ambiguous number and asks percent-vs-absolute.
    expect(clarify).toContain('30%');
    expect(clarify.toLowerCase()).toContain('absolute');
    // Leak panel (local subset of d1-user-guidance-leak.test.ts).
    const lower = clarify.toLowerCase();
    for (const forbidden of FORBIDDEN_IN_USER_COPY) {
      expect(
        lower.includes(forbidden.toLowerCase()),
        `clarify must not contain "${forbidden}" — got: ${clarify}`,
      ).toBe(false);
    }

    // USER-VISIBLE surface: the production composer renders the clarify
    // as the full assistant_text with a text-prompt recovery chip (the
    // same recoverable route the reduction-sign backstop rides).
    const composed = composeHandlerFailure(
      failure,
      {} as ComposeContext,
      'frame' as StageType,
    );
    expect(composed.response.assistant_text).toBe(clarify);
    expect(composed.chip_type).toBe('text_prompt');
    expect(composed.template_id).toBe('parameter_invalid_at_execute');
  });

  it('nothing is persisted when the guard fires', async () => {
    // The guard throws before applyAndValidateMutation — there is no
    // mutated_graph on the failure path (the turn-executor's catch
    // ladder never commits). Assert the throw carries no outcome.
    const failure = await captureFailure(
      withBareRiskNode(),
      makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30 }),
    );
    expect(failure).toBeInstanceOf(HandlerInvocationFailedError);
  });

  it('the SAME constraint with "%" persists — the unit is the deciding variable', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        withBareRiskNode(),
        makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30, unit: '%' }),
      ),
    );
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints![0];
    expect(row.value).toBe(30);
    expect(row.unit).toBe('%');
  });

  it('a unit-less value INSIDE [0,1] is unambiguous in the probability domain and persists', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        withBareRiskNode(),
        makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 0.3 }),
      ),
    );
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].value).toBe(0.3);
  });

  it('a declared cap on the node exempts — downstream normalisation is explicit, not heuristic', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        withCappedRiskNode(),
        makeProposal({ entityId: 'r-capped', constraintType: 'at_most', value: 30 }),
      ),
    );
    // The fixture has no unit anywhere, so the persisted row is unit-less
    // — legal ONLY because the declared cap gives PLoT an explicit range.
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints![0];
    expect(row.value).toBe(30);
    expect(row.unit).toBeUndefined();
  });

  it('factor targets are exempt (not probability-domain): unit-less absolute counts stay legal', async () => {
    // f-quality: factor, no unit, no cap. "at most 30" on a factor is a
    // plain absolute threshold; refusing it would break real usage.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        makeProposal({ entityId: 'f-quality', constraintType: 'at_most', value: 30 }),
      ),
    );
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].value).toBe(30);
    expect((outcome.mutated_graph as GraphV3T).goal_constraints![0].unit).toBeUndefined();
  });

  it('goal at_least target-set is exempt: the same write co-stamps goal_threshold_cap (PLoT P0 tier)', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        makeProposal({
          entityId: 'g-revenue',
          entityKind: 'goal',
          constraintType: 'at_least',
          value: 800,
        }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    const goal = mutated.nodes.find((n) => n.id === 'g-revenue')!;
    // The cap stamped in the SAME committed write is what makes this
    // unit-less registration downstream-explicit (25% headroom doctrine).
    expect(goal.goal_threshold_cap).toBe(1000);
  });

  it('goal at_most (no threshold stamp) with a unit-less value > 1 and no cap is refused', async () => {
    const failure = await captureFailure(
      buildD1Fixture(),
      makeProposal({
        entityId: 'g-revenue',
        entityKind: 'goal',
        constraintType: 'at_most',
        value: 30,
      }),
    );
    expect(failure.cause_kind).toBe('parameter_invalid_at_execute');
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });

  it('restating an ALREADY-ambiguous persisted row gets the clarify, not a false "unchanged" confirmation', async () => {
    // Poisoned-data repair driver: the row {value: 30, no unit} is already
    // persisted (the live gc-cdd6eb74 state). Confirming "already
    // constrained at 30 ✓" would re-affirm a guardrail that is not being
    // evaluated. The guard fires and asks for the unit instead.
    const graph = seedConstraint(withBareRiskNode(), {
      constraint_id: 'gc-poisoned',
      node_id: 'r-attrition',
      operator: '<=',
      value: 30,
      label: 'Key Talent Attrition',
      provenance: 'explicit',
    });
    const failure = await captureFailure(
      graph,
      makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: 30 }),
    );
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });

  it('a unit-less NEGATIVE value on a probability-domain node is refused (trivially-FALSE mirror of the class)', async () => {
    // {value: -15, no unit} on a risk node clamps to 0 downstream —
    // a "<= 0" threshold that is trivially false: the guardrail reports
    // permanently violated instead of permanently satisfied. Same class,
    // mirrored sign.
    const failure = await captureFailure(
      withBareRiskNode(),
      makeProposal({ entityId: 'r-attrition', constraintType: 'at_most', value: -15 }),
    );
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });
});
