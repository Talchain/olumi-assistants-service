/**
 * ⭐⭐ GATE-1b — A MONEY LIMIT MUST NOT BIND TO A NODE THAT CANNOT CARRY MONEY.
 *
 * ── THE MEASURED P0 ───────────────────────────────────────────────────────
 * Debug export `olumi-debug-1dd2133d-20260916.json`, staging, 16 Sep 2026.
 * `add_constraint` persisted
 *
 *   {constraint_id: 'constraint_dac3fdc3_max', node_id: 'dac3fdc3',
 *    operator: '<=', value: 200000, unit: '£', provenance: 'explicit',
 *    label: 'Total hiring spend this year must not exceed £200,000'}
 *
 * onto `dac3fdc3` "Budget Overrun Risk", `kind: 'risk'`. The next analysis
 * returned `CONSTRAINT_OUT_OF_DOMAIN` ("targets risk node \"dac3fdc3\" with
 * threshold 200000 outside [0,1] range"), `CONSTRAINT_TARGET_UNRELIABLE` and
 * `EVPI_UNAVAILABLE`; the verdict read unevaluated, the leader was withheld,
 * and the coaching answers on the turns that followed collapsed from 1186 and
 * 1001 characters to 452. One mis-bound row cost the rest of the conversation.
 *
 * ⚠⚠ THE DISCLOSURE WAS ALREADY THERE AND ALREADY CORRECT. The same export's
 * write turn says "…Your model records no value to test this limit: Budget
 * Overrun Risk has no number recorded against it, so it will not be part of the
 * analysis…". `constraint-write-admissibility.ts` did its job. THE DEFECT IS
 * THAT THE ROW BINDS ANYWAY. This suite pins the refusal, not the wording.
 *
 * ── BOTH DIRECTIONS, WHICH IS THE POINT ───────────────────────────────────
 * A predicate guarding against two opposite harms needs a corpus pointing in
 * both directions (CLAUDE.md trap 22b — the estate has twice shipped a fix and
 * then its exact inverse, each under a fully green suite):
 *
 *   ARM A  £ limit → `kind: 'risk'`     MUST NOT BIND   (the lie being closed)
 *   ARM B  £ limit → `kind: 'factor'`   MUST BIND, UNCHANGED  (the false
 *                                        refusal that would be worse than the
 *                                        defect)
 *
 * and two controls that discriminate WHICH conjunct is doing the work, because
 * a gate that fired on the kind alone, or on the magnitude alone, would pass
 * ARM A and ARM B while being wrong:
 *
 *   ARM C  '%' limit → the SAME risk node        MUST BIND  (unit conjunct)
 *   ARM D  in-domain £ limit → the same risk node MUST BIND (domain conjunct)
 *
 * ARM C is not hypothetical. The 14 Sep `44e349fa` capture bound
 * `{value: 7, unit: '%'}` to a risk node and ISL answered
 * `missing_observed_state`, NOT `CONSTRAINT_OUT_OF_DOMAIN` — so the producer
 * reads the '%' and converts, and a magnitude-only gate would refuse a limit
 * the analysis can handle.
 */

import { describe, expect, it } from 'vitest';

import type { StageType } from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';

import { composeHandlerFailure } from '../../../compose/handler-failure-responses.js';
import type { ComposeContext } from '../../../compose/types.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { createRegistry } from '../../registry.js';
import {
  createAddConstraintHandler,
  OUT_OF_DOMAIN_UNIT_GUARDED_KIND_SET,
  PROBABILITY_DOMAIN_KIND_SET,
} from '../add-constraint.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

/**
 * The P0's target, reproduced at its measured shape: a `risk` node carrying
 * NOTHING. Every quantity field read back from the export's `full_graph` entry
 * for `dac3fdc3` was null, so the fixture declares none.
 */
function withBudgetOverrunRisk(): GraphV3T {
  const base = buildD1Fixture();
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' },
    ],
  };
}

function makeProposal(p: {
  readonly entityId: string;
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
      kind: 'node',
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
    scenarioId: 'scn-out-of-domain',
    turnId: 'turn-out-of-domain',
    requestId: 'req-out-of-domain',
    message: 'add that limit to my model',
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

/** Leak panel — the local subset the sibling Gate-1 suite already uses. */
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
  'probability-domain',
  'CONSTRAINT_OUT_OF_DOMAIN',
  'r-overrun',
];

// ---------------------------------------------------------------------------
// ARM A — the £ limit on a risk node must NOT bind
// ---------------------------------------------------------------------------

describe('ARM A — a £ limit on a kind:risk node must not bind (the measured P0)', () => {
  it('refuses, dispatched through the PRODUCTION registry', async () => {
    // Wiring proof: resolve off createRegistry(), the map the turn-executor
    // dispatches, not the factory import.
    const handler = createRegistry().get('add_constraint');
    expect(handler).toBeDefined();
    let caught: unknown;
    try {
      await handler!(
        invoke(
          withBudgetOverrunRisk(),
          makeProposal({
            entityId: 'r-overrun',
            constraintType: 'at_most',
            value: 200000,
            unit: '£',
            label: 'Total hiring spend this year must not exceed £200,000',
          }),
        ),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = caught as HandlerInvocationFailedError;
    expect(failure.cause_kind).toBe('parameter_invalid_at_execute');
    // Bound to THIS decision by its own reason token — a different refusal
    // (the unit-ambiguity sibling, the kind allowlist) would satisfy a bare
    // "it threw" and prove nothing (CLAUDE.md trap 19).
    expect(failure.details['rejection_reason']).toBe('out_of_domain_unit_probability_domain');
    expect(failure.details['target_kind']).toBe('risk');
    expect(failure.details['target_id']).toBe('r-overrun');
  });

  it('persists nothing — the refusal precedes the mutation', async () => {
    const failure = await captureFailure(
      withBudgetOverrunRisk(),
      makeProposal({ entityId: 'r-overrun', constraintType: 'at_most', value: 200000, unit: '£' }),
    );
    // The handler throws before applyAndValidateMutation, so there is no
    // mutated_graph for the executor's commit ladder to persist.
    expect(failure).toBeInstanceOf(HandlerInvocationFailedError);
    expect((failure as unknown as { mutated_graph?: unknown }).mutated_graph).toBeUndefined();
  });

  it('the user sees a question that asks for the referent and never claims the limit was kept', async () => {
    const failure = await captureFailure(
      withBudgetOverrunRisk(),
      makeProposal({ entityId: 'r-overrun', constraintType: 'at_most', value: 200000, unit: '£' }),
    );
    const issue = failure.details['specific_issue'];
    expect(typeof issue).toBe('string');
    const clarify = issue as string;

    // It names the amount the user stated, rendered by the shared formatter.
    expect(clarify).toContain('£200,000');
    // It asks the repair question.
    expect(clarify.toLowerCase()).toContain('which part of your model');
    // ⭐ AND IT MUST NOT BORROW THE DISCLOSURE'S CLOSER. The ratified
    // `unmeasuredTargetRepairAsk` ends "this one stays on the model", which is
    // TRUE beside a written row and FALSE beside a refusal. Correct-sounding
    // shared copy attached to the opposite outcome is the cheapest lie
    // available here, so it is pinned closed rather than left to review.
    expect(clarify.toLowerCase()).not.toContain('stays on the model');

    // The composer's sanitiseForUser truncates at MAX_USER_STRING = 100, so a
    // sentence over budget would reach the user with its question cut off.
    expect(clarify.length).toBeLessThanOrEqual(100);

    const lower = clarify.toLowerCase();
    for (const forbidden of FORBIDDEN_IN_USER_COPY) {
      expect(
        lower.includes(forbidden.toLowerCase()),
        `clarify must not contain "${forbidden}" — got: ${clarify}`,
      ).toBe(false);
    }
  });

  it('reaches the user through the production failure composer with a recovery chip', async () => {
    const failure = await captureFailure(
      withBudgetOverrunRisk(),
      makeProposal({ entityId: 'r-overrun', constraintType: 'at_most', value: 200000, unit: '£' }),
    );
    const composed = composeHandlerFailure(failure, {} as ComposeContext, 'frame' as StageType);
    expect(composed.response.assistant_text).toBe(failure.details['specific_issue']);
    expect(composed.chip_type).toBe('text_prompt');
    expect(composed.template_id).toBe('parameter_invalid_at_execute');
  });

  it('drops the amount rather than the question when the rendered amount would overflow the 100-char budget', async () => {
    const failure = await captureFailure(
      withBudgetOverrunRisk(),
      makeProposal({
        entityId: 'r-overrun',
        constraintType: 'at_most',
        value: 1234567890,
        unit: 'widget-hours of engineering capacity',
      }),
    );
    const clarify = failure.details['specific_issue'] as string;
    expect(clarify.length).toBeLessThanOrEqual(100);
    // The ask is the load-bearing half and survives.
    expect(clarify.toLowerCase()).toContain('which part of your model');
  });
});

// ---------------------------------------------------------------------------
// ARM B — the £ limit on a factor carrying a native cost must bind UNCHANGED
// ---------------------------------------------------------------------------

describe('ARM B — a £ limit on a factor that carries a native cost binds unchanged', () => {
  it('persists the row byte-for-byte as it did before the gate existed', async () => {
    // `f-budget` is the shared fixture's currency factor:
    // observed_state {value: 0.4, raw_value: 40000, unit: '£', cap: 100000}.
    // ⚠ Its cap (100000) is BELOW the threshold (200000), so `declaredCap` is
    // FALSE here — this arm passes on the KIND conjunct alone, which is
    // exactly the discrimination it is meant to make. A gate that keyed on the
    // unit and the magnitude without the kind would refuse this row.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        makeProposal({
          entityId: 'f-budget',
          constraintType: 'at_most',
          value: 200000,
          unit: '£',
          label: 'Total hiring spend this year must not exceed £200,000',
        }),
      ),
    );
    const rows = (outcome.mutated_graph as GraphV3T).goal_constraints!;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.node_id).toBe('f-budget');
    expect(row.operator).toBe('<=');
    expect(row.value).toBe(200000);
    expect(row.unit).toBe('£');
    expect(row.provenance).toBe('explicit');
    expect(row.label).toBe('Total hiring spend this year must not exceed £200,000');
    // And the receipt confirms it plainly — no "cannot be checked" disclosure,
    // because this target records a value.
    expect(outcome.assistant_text).toContain('£200,000');
    expect(outcome.assistant_text.toLowerCase()).not.toContain('no number recorded');
  });
});

// ---------------------------------------------------------------------------
// ARMS C + D — which conjunct is doing the work
// ---------------------------------------------------------------------------

describe('the gate keys on BOTH the unit and the producer domain, not on the kind alone', () => {
  it('ARM C — a % limit on the same risk node still binds (a magnitude-only gate would have refused it)', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        withBudgetOverrunRisk(),
        makeProposal({ entityId: 'r-overrun', constraintType: 'at_most', value: 7, unit: '%' }),
      ),
    );
    const rows = (outcome.mutated_graph as GraphV3T).goal_constraints!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.node_id).toBe('r-overrun');
    expect(rows[0]!.value).toBe(7);
    expect(rows[0]!.unit).toBe('%');
  });

  it('ARM D — an IN-DOMAIN £ threshold on the same risk node still binds (a unit-only gate would have refused it)', async () => {
    // 0.3 sits inside ISL's [0,1] evaluation domain, so the producer would not
    // report it out of domain and this gate must stay silent about it.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        withBudgetOverrunRisk(),
        makeProposal({ entityId: 'r-overrun', constraintType: 'at_most', value: 0.3, unit: '£' }),
      ),
    );
    const rows = (outcome.mutated_graph as GraphV3T).goal_constraints!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(0.3);
    expect(rows[0]!.unit).toBe('£');
  });
});

// ---------------------------------------------------------------------------
// The seam this unblocks, stated as an executable fact rather than a claim
// ---------------------------------------------------------------------------

describe("what the refusal unblocks — Core's repair ask, pinned honestly", () => {
  it("decideOptionCostAsk cannot see a constraint bound to a risk node, and can see the same one bound to a factor", async () => {
    const { decideOptionCostAsk } = await import('../../../coaching/decide-option-cost-ask.js');
    const nodes = [
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' },
      { id: 'f-budget', kind: 'factor', label: 'Marketing budget' },
    ];
    const options = [
      { id: 'o-1', label: 'Hire two mid-level developers', interventions: { 'f-budget': { value: 0.6 }, 'r-overrun': { value: 0.6 } } },
    ];
    // Bound to the risk node — the shape the P0 persisted. Structurally
    // invisible to the ask (`n.kind === 'factor'`), so the repair is disarmed.
    expect(
      decideOptionCostAsk({
        notDecisionGrade: true,
        ratified: [{ node_id: 'r-overrun', unit: '£', label: 'Total hiring spend…' }],
        nodes,
        options,
      }),
    ).toBeNull();
    // Bound to a factor — the ask names the cell to collect.
    const target = decideOptionCostAsk({
      notDecisionGrade: true,
      ratified: [{ node_id: 'f-budget', unit: '£', label: 'Total hiring spend…' }],
      nodes,
      options,
    });
    expect(target).not.toBeNull();
    expect(target!.factor_id).toBe('f-budget');
    expect(target!.unit).toBe('£');

    // ⚠ STATED SO NOBODY READS MORE INTO THIS SUITE THAN IT PROVES: the gate
    // under test does NOT itself move the row from the risk node to a factor,
    // and it does not make the ask fire on the refused turn. It removes the
    // mis-bind that makes the ask unreachable and asks the user for the
    // referent. Re-binding is the user's next turn, through Core's own
    // edit/save path.
  });
});

// ---------------------------------------------------------------------------
// THE POPULATION — and the two exclusions that a first, wider version got wrong
// ---------------------------------------------------------------------------

describe('the guarded population is a deliberate PROPER SUBSET, and the exclusions bind', () => {
  it('is contained in the probability-domain kinds, and is strictly smaller', () => {
    // Containment, so the gate can never start speaking about a kind PLoT no
    // longer treats as probability-domain. Derived from the two exports rather
    // than restated (CLAUDE.md trap 12).
    for (const kind of OUT_OF_DOMAIN_UNIT_GUARDED_KIND_SET) {
      expect(PROBABILITY_DOMAIN_KIND_SET.has(kind)).toBe(true);
    }
    // Strictly smaller: the narrowing is the point, and a future widening
    // should have to change this line on purpose.
    expect(OUT_OF_DOMAIN_UNIT_GUARDED_KIND_SET.size).toBeLessThan(
      PROBABILITY_DOMAIN_KIND_SET.size,
    );
    expect([...OUT_OF_DOMAIN_UNIT_GUARDED_KIND_SET]).toEqual(['risk']);
  });

  it('EXCLUSION 1 — "keep revenue below £20k" on the GOAL node still binds', async () => {
    // ⚠ THIS IS A REGRESSION THE FIRST VERSION OF THE GATE ACTUALLY SHIPPED
    // into a local run, and `goal-answer-subject-safety.test.ts` caught it.
    // ISL computes the goal node's own outcome distribution, so the constraint
    // IS evaluated — in the goal's units, not on [0,1]. Refusing it would tell
    // a user their perfectly good money target will be ignored, which is the
    // one error this whole family must never make.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        makeProposal({ entityId: 'g-revenue', constraintType: 'at_most', value: 20000, unit: '£' }),
      ),
    );
    const rows = (outcome.mutated_graph as GraphV3T).goal_constraints!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.node_id).toBe('g-revenue');
    expect(rows[0]!.value).toBe(20000);
    expect(rows[0]!.unit).toBe('£');
  });

  it('EXCLUSION 2 — a £ limit on an OUTCOME node still binds (the recorded, unclosed gap)', async () => {
    // Honest, not aspirational: this is TODAY'S behaviour and the gate is
    // deliberately silent about it, because no capture establishes the class
    // and a false refusal costs more than the silence we already ship. Pinned
    // so that widening the gate to `outcome` REDs here and is taken as a
    // decision rather than arrived at by a tidy-up.
    const base = buildD1Fixture();
    const graph: GraphV3T = {
      ...base,
      nodes: [...base.nodes, { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' }],
    };
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        graph,
        makeProposal({ entityId: 'o-churn-rate', constraintType: 'at_most', value: 10, unit: '£' }),
      ),
    );
    const rows = (outcome.mutated_graph as GraphV3T).goal_constraints!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.node_id).toBe('o-churn-rate');
    expect(rows[0]!.unit).toBe('£');
  });
});
