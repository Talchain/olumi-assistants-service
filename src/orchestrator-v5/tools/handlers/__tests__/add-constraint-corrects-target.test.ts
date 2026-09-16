/**
 * ⭐⭐ CORRECTING A LIMIT'S TARGET — a MOVE, not a second row (Codex CX-171).
 *
 * THE DEFECT: the idempotency key is `(node_id, operator)`. A correction moves
 * the limit to a DIFFERENT node, so `existing` is undefined and the write
 * APPENDS. `add_constraint` is the only constraint handler in the estate and
 * `apply-graph-mutation.ts:195` states it does NOT prune, so the original —
 * wrong, un-evaluable — constraint survives and keeps blocking the very
 * journey the correction was meant to unblock. Codex's words: "adding a second
 * constraint leaves the original wrong/unevaluated constraint blocking the same
 * journey. Truthful 'as well' copy is not the recovery we need."
 *
 * ⚠ THE ROW IS NAMED, NEVER INFERRED. Matching an existing row by
 * operator+value+unit and calling that a correction was considered and
 * REJECTED: two genuine limits can share all three ("£200k on hiring", "£200k
 * on marketing") and replacing one would be SILENT DATA LOSS. Losing a limit
 * the user set is strictly worse than the duplicate this removes.
 *
 * Assertions bind by IDENTITY (node id), never by a value predicate another
 * row could satisfy (trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

/** Paul's 16 Sep shape: a money limit sitting on a risk, beside a real factor. */
function graphWithMisplacedLimit(rows?: unknown[]): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push(
    { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' } as GraphV3T['nodes'][number],
    { id: 'f-hiring-cost', kind: 'factor', label: 'Hiring and Onboarding Cost' } as GraphV3T['nodes'][number],
    { id: 'f-marketing', kind: 'factor', label: 'Marketing Spend' } as GraphV3T['nodes'][number],
  );
  (g as { goal_constraints?: unknown }).goal_constraints = rows ?? [
    { constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
    { constraint_id: 'gc-other', node_id: 'f-marketing', operator: '<=', value: 50000, unit: 'GBP', provenance: 'explicit' },
  ];
  return g;
}

function run(opts: {
  targetId: string;
  value: number;
  unit?: string;
  corrects?: string;
  graph?: GraphV3T;
  constraintType?: 'at_least' | 'at_most';
}) {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: opts.constraintType ?? 'at_most', source: 'user_explicit' },
    { name: 'value', value: opts.value, source: 'user_explicit' },
  ];
  if (opts.unit) parameters.push({ name: 'unit', value: opts.unit, source: 'user_explicit' });
  if (opts.corrects) parameters.push({ name: 'corrects_node_id', value: opts.corrects, source: 'user_explicit' });
  const proposal: ProposalAction = {
    handler_id: 'add_constraint',
    entity: { id: opts.targetId, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters,
    cited_context_fields: [],
  };
  const invocation: HandlerInvocation = {
    context: {
      session_id: 'scn-1', stage: 'frame', request_id: 'req-1',
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: 'scn-1', turn_id: 'turn-1', stage: 'frame',
      message: 'That budget belongs on hiring cost, not the risk.',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: opts.graph ?? graphWithMisplacedLimit(),
  };
  return createAddConstraintHandler()(invocation);
}

const rowsOf = async (o: Awaited<ReturnType<typeof run>>) =>
  ((o.mutated_graph as GraphV3T & { goal_constraints?: Array<Record<string, unknown>> })
    .goal_constraints ?? []);

describe('corrects_node_id — a MOVE through the existing atomic write', () => {
  it('⭐ REPLACES the named row: the limit lands on the factor and the risk row is GONE', async () => {
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun',
    }));
    expect(rows.map((r) => r.node_id).sort()).toEqual(['f-hiring-cost', 'f-marketing']);
    expect(rows.some((r) => r.node_id === 'r-overrun')).toBe(false);
  });

  it('⭐ an UNRELATED limit survives the correction untouched', async () => {
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun',
    }));
    const other = rows.find((r) => r.node_id === 'f-marketing');
    expect(other).toMatchObject({ constraint_id: 'gc-other', operator: '<=', value: 50000, unit: 'GBP' });
  });

  it('⭐ a correction that changes NO VALUE still applies — the move IS the change', async () => {
    // The unchanged-value skip exists to stop a no-op moving the analysis hash.
    // A re-target at the same amount is not a no-op, and ordering the correction
    // arm above that skip is what makes it survive.
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun',
    }));
    expect(rows.find((r) => r.node_id === 'f-hiring-cost')?.value).toBe(200000);
    expect(rows).toHaveLength(2);
  });

  it('⛔ WITHOUT the parameter it appends, exactly as before — no silent behaviour change', async () => {
    const rows = await rowsOf(await run({ targetId: 'f-hiring-cost', value: 200000, unit: 'GBP' }));
    expect(rows.map((r) => r.node_id).sort()).toEqual(['f-hiring-cost', 'f-marketing', 'r-overrun']);
  });

  it('⛔ REFUSES on a row that is not there — appends, loses nothing', async () => {
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-does-not-exist',
    }));
    expect(rows.some((r) => r.node_id === 'r-overrun')).toBe(true);
    expect(rows.some((r) => r.node_id === 'f-hiring-cost')).toBe(true);
  });

  it('⛔ REFUSES on AMBIGUOUS identity — two rows on that key, so neither is removed', async () => {
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-a', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
      { constraint_id: 'gc-b', node_id: 'r-overrun', operator: '<=', value: 300000, unit: 'GBP', provenance: 'explicit' },
    ]);
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun', graph,
    }));
    expect(rows.filter((r) => r.node_id === 'r-overrun')).toHaveLength(2);
    expect(rows.some((r) => r.node_id === 'f-hiring-cost')).toBe(true);
  });

  it('⛔ pointing at ITSELF is an ordinary update, not a correction', async () => {
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-self', node_id: 'f-hiring-cost', operator: '<=', value: 100000, unit: 'GBP', provenance: 'explicit' },
    ]);
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'f-hiring-cost', graph,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(200000);
  });
});

/**
 * ⭐⭐ THE ORDERING IS LOAD-BEARING, AND THIS IS THE CASE THAT PROVES IT.
 *
 * ⚠ I ASSERTED THIS IN A COMMENT BEFORE I COULD SHOW IT. A mutant that moved
 * the correction arm BELOW the `valueUnchanged` skip left all seven tests
 * GREEN — so the claim was untested, and a surviving mutant is a claim either
 * way (it must be demonstrated, never asserted). Derived instead:
 *
 *   valueUnchanged = rowValueUnchanged || nodeChannelUnchanged
 *   rowValueUnchanged requires `existing !== undefined` — and a correction
 *     targets a DIFFERENT node, so `existing` is always undefined there.
 *   nodeChannelUnchanged requires ownsGoalThresholdChannel, which is
 *     `targetNode.kind === 'goal' && operator === '>='`, plus the target
 *     already carrying a matching goal_threshold_raw and unit.
 *
 * So the ordering matters on exactly ONE reachable shape: correcting a success
 * target ONTO a goal that already records that threshold. Below the skip, the
 * whole correction is silently discarded and the wrong row survives.
 */
describe('the correction arm sits ABOVE the unchanged-value skip', () => {
  it('⭐ a correction onto a goal that ALREADY records the threshold still moves the row', async () => {
    const g = buildD1Fixture();
    g.nodes.push(
      { id: 'g-wrong', kind: 'goal', label: 'Wrong goal' } as GraphV3T['nodes'][number],
      {
        id: 'g-right', kind: 'goal', label: 'Right goal',
        goal_threshold_raw: 800, goal_threshold_unit: 'customers',
      } as unknown as GraphV3T['nodes'][number],
    );
    (g as { goal_constraints?: unknown }).goal_constraints = [
      { constraint_id: 'gc-misplaced', node_id: 'g-wrong', operator: '>=', value: 800, unit: 'customers', provenance: 'explicit' },
    ];
    const rows = await rowsOf(await run({
      targetId: 'g-right', value: 800, unit: 'customers',
      constraintType: 'at_least', corrects: 'g-wrong', graph: g,
    }));
    // Below the skip this returns the list UNCHANGED: the wrong row survives
    // and the correction vanishes without a trace.
    expect(rows.map((r) => r.node_id)).toEqual(['g-right']);
    expect(rows.some((r) => r.node_id === 'g-wrong')).toBe(false);
  });

  /**
   * ⭐⭐ A DESTRUCTIVE TURN MAY NOT BE NARRATED AS A NO-OP.
   *
   * ⚠ FOUND BY REVIEW, NOT BY ME, AND MY OWN SUITE WAS GREEN OVER IT. On this
   * exact shape `nodeChannelUnchanged` makes `valueUnchanged` true, so
   * `turnIsNoop` was true WHILE the correction arm deleted a row: the receipt
   * would have said "no need to change it" and `fact.result.before` would have
   * said null, over a mutation that destroyed a constraint.
   *
   * It is the same class the `mintedBaseline` conjunct beside `turnIsNoop`
   * already guards, arriving through a new door — which is why the fix is a
   * conjunct there and not a special case somewhere else.
   */
  it('⛔ a correction is NEVER a no-op, even when the value is identical', async () => {
    const g = buildD1Fixture();
    g.nodes.push(
      { id: 'g-wrong', kind: 'goal', label: 'Wrong goal' } as GraphV3T['nodes'][number],
      {
        id: 'g-right', kind: 'goal', label: 'Right goal',
        goal_threshold_raw: 800, goal_threshold_unit: 'customers',
      } as unknown as GraphV3T['nodes'][number],
    );
    (g as { goal_constraints?: unknown }).goal_constraints = [
      { constraint_id: 'gc-misplaced', node_id: 'g-wrong', operator: '>=', value: 800, unit: 'customers', provenance: 'explicit' },
    ];
    const outcome = await run({
      targetId: 'g-right', value: 800, unit: 'customers',
      constraintType: 'at_least', corrects: 'g-wrong', graph: g,
    });
    expect(outcome.handler_facts[0]?.noop).toBe(false);
    expect(outcome.assistant_text ?? '').not.toMatch(/no need to change/i);
  });
});
