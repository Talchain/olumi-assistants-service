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
  correctsRaw?: unknown;
  graph?: GraphV3T;
  constraintType?: 'at_least' | 'at_most';
}) {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: opts.constraintType ?? 'at_most', source: 'user_explicit' },
    { name: 'value', value: opts.value, source: 'user_explicit' },
  ];
  if (opts.unit) parameters.push({ name: 'unit', value: opts.unit, source: 'user_explicit' });
  if (opts.corrects) parameters.push({ name: 'corrects_node_id', value: opts.corrects, source: 'user_explicit' });
  if (opts.correctsRaw !== undefined) {
    parameters.push({ name: 'corrects_node_id', value: opts.correctsRaw, source: 'user_explicit' } as never);
  }
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

  /**
   * ⛔⛔ AN UNRESOLVABLE CORRECTION FAILS CLOSED — IT DOES NOT APPEND.
   *
   * ⚠ MY FIRST CUT GOT THIS BACKWARDS AND CODEX (CX-183) CORRECTED IT. I had
   * 0 or 2+ matches "refuse the correction and behave exactly as today", i.e.
   * append — which reads like the conservative default and is the opposite of
   * one. The user asked for a limit to be MOVED; appending silently
   * substitutes an ADDITIONAL limit for the move, leaves the original
   * un-evaluable row in place, and recreates the exact poisoned-old-row loop
   * this parameter exists to break.
   *
   * A silent substitution of one intent for a different one is worse than a
   * visible refusal. These bind to BOTH halves: the call rejects, AND the
   * caller's graph is untouched.
   */
  const unchangedRows = (g: GraphV3T) =>
    JSON.stringify((g as { goal_constraints?: unknown }).goal_constraints);

  it('⛔ MISSING SOURCE: refuses and changes nothing — never appends a second limit', async () => {
    const graph = graphWithMisplacedLimit();
    const before = unchangedRows(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-does-not-exist', graph,
    })).rejects.toThrow();
    expect(unchangedRows(graph)).toBe(before);
  });

  it('⛔ AMBIGUOUS SOURCE: two rows on that key — refuses, removes neither, adds none', async () => {
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-a', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
      { constraint_id: 'gc-b', node_id: 'r-overrun', operator: '<=', value: 300000, unit: 'GBP', provenance: 'explicit' },
    ]);
    const before = unchangedRows(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun', graph,
    })).rejects.toThrow();
    expect(unchangedRows(graph)).toBe(before);
  });

  it('⛔ DESTINATION COLLISION: a limit already on the target — refuses rather than merging by inference', async () => {
    // Two plausible readings (update the destination and drop the source, or
    // leave the source alone). Picking one is inference, so it asks instead.
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
      { constraint_id: 'gc-dest', node_id: 'f-hiring-cost', operator: '<=', value: 90000, unit: 'GBP', provenance: 'explicit' },
    ]);
    const before = unchangedRows(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun', graph,
    })).rejects.toThrow();
    expect(unchangedRows(graph)).toBe(before);
  });

  it('⛔ a STALE confirmation — the source was already corrected — refuses, not silently re-adds', async () => {
    // The move already happened on an earlier turn, so the source row is gone.
    // Re-confirming must not quietly append the limit a second time.
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-already-moved', node_id: 'f-hiring-cost', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
    ]);
    const before = unchangedRows(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun', graph,
    })).rejects.toThrow();
    expect(unchangedRows(graph)).toBe(before);
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

/**
 * ⭐⭐ THE THREE DEFECTS CODEX FOUND BY EXECUTION (CX-195), each pinned by the
 * contrast that exposed it rather than by an assertion that the fix is present.
 *
 * All three share one shape: the MOVE quietly became something else — an
 * append, a re-denomination, or an add with no record of what was destroyed —
 * and every one of them left a green suite behind.
 */
describe('CX-195 — a move must not quietly become something else', () => {
  const rowsJson = (g: GraphV3T) =>
    JSON.stringify((g as { goal_constraints?: unknown }).goal_constraints);

  it('⛔ (a) a PRESENT but INVALID id REJECTS — it must not degrade to an append', async () => {
    // `corrects_node_id: 42` parsed leniently to undefined, which reads as "no
    // correction requested" and APPENDS: a malformed id silently substituted a
    // second limit for the requested move. Absence still means no correction;
    // it is PRESENCE that carries the obligation.
    const graph = graphWithMisplacedLimit();
    const before = rowsJson(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', correctsRaw: 42, graph,
    })).rejects.toThrow();
    expect(rowsJson(graph)).toBe(before);
  });

  it.each([['an empty string', '   '], ['null', null], ['an object', { id: 'x' }]])(
    '⛔ (a) %s is also a present-but-invalid id, and also rejects',
    async (_n, raw) => {
      const graph = graphWithMisplacedLimit();
      const before = rowsJson(graph);
      await expect(run({
        targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', correctsRaw: raw, graph,
      })).rejects.toThrow();
      expect(rowsJson(graph)).toBe(before);
    },
  );

  it('⭐ (b) a move onto a UNITLESS factor KEEPS the limit\u2019s own currency', async () => {
    // `existing` is undefined by construction on a move, so the unit chain fell
    // through to the DESTINATION's observed unit — none here — and produced a
    // limit denominated in nothing. Same number, meaning erased.
    const g = buildD1Fixture();
    g.nodes.push(
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' } as GraphV3T['nodes'][number],
      { id: 'f-unitless', kind: 'factor', label: 'Hiring Cost' } as GraphV3T['nodes'][number],
    );
    (g as { goal_constraints?: unknown }).goal_constraints = [
      { constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
    ];
    // NO unit supplied on the move — the row's own unit must travel with it.
    const rows = await rowsOf(await run({
      targetId: 'f-unitless', value: 200000, corrects: 'r-overrun', graph: g,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ node_id: 'f-unitless', value: 200000, unit: 'GBP' });
  });

  it('⛔ (b) an explicit unit that CONTRADICTS the moved row refuses — two intents, one call', async () => {
    const graph = graphWithMisplacedLimit();
    const before = rowsJson(graph);
    await expect(run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'USD', corrects: 'r-overrun', graph,
    })).rejects.toThrow();
    expect(rowsJson(graph)).toBe(before);
  });

  it('\u2b50 (b) \u00a3 and GBP are ONE unit spelled twice — not a conflict', async () => {
    const graph = graphWithMisplacedLimit([
      { constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=', value: 200000, unit: '\u00a3', provenance: 'explicit' },
    ]);
    const rows = await rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun', graph,
    }));
    expect(rows.map((r) => r.node_id)).toEqual(['f-hiring-cost']);
  });

  it('⭐ (c) the FACT records the row that was DESTROYED, not null', async () => {
    // `before` was null because `existing` is undefined on a move, so the fact
    // channel recorded a destroyed limit as a fresh add and nothing downstream
    // could see what was removed.
    const outcome = await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun',
    });
    const before = outcome.handler_facts[0]?.result?.before as Record<string, unknown> | null;
    expect(before).not.toBeNull();
    expect(before).toMatchObject({ constraint_id: 'gc-wrong', node_id: 'r-overrun' });
    const after = outcome.handler_facts[0]?.result?.after as Record<string, unknown>;
    expect(after).toMatchObject({ node_id: 'f-hiring-cost' });
  });
});
