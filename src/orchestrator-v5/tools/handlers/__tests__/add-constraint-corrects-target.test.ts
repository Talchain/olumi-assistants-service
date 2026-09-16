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
  label?: string;
  graph?: GraphV3T;
  constraintType?: 'at_least' | 'at_most';
}) {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: opts.constraintType ?? 'at_most', source: 'user_explicit' },
    { name: 'value', value: opts.value, source: 'user_explicit' },
  ];
  if (opts.unit) parameters.push({ name: 'unit', value: opts.unit, source: 'user_explicit' });
  if (opts.label) parameters.push({ name: 'label', value: opts.label, source: 'user_explicit' });
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

  it('⭐ the RECEIPT says it MOVED, and names the node it left', async () => {
    // Before this the turn produced "Added constraint: …" with
    // fact.result.before = null — a row destroyed while BOTH channels narrated
    // a fresh add. Under-reporting a deletion is the same class as
    // over-claiming a write: the user cannot see what their model now says.
    // "Moved" with only one end named is as ambiguous as not saying it.
    const outcome = await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', corrects: 'r-overrun',
    });
    const text = outcome.assistant_text ?? '';
    expect(text).toMatch(/moved that limit off Budget Overrun Risk/i);
    expect(text).toMatch(/onto Hiring and Onboarding Cost/i);
    expect(text).not.toMatch(/^Added constraint/i);
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
    // `handler_facts[0]` is a union across every fact type, so `result` has no
    // common before/after. Narrow to the add_constraint shape explicitly.
    const result = (outcome.handler_facts[0] as {
      result?: { before?: unknown; after?: unknown };
    })?.result;
    expect(result?.before).not.toBeNull();
    expect(result?.before).toMatchObject({ constraint_id: 'gc-wrong', node_id: 'r-overrun' });
    expect(result?.after).toMatchObject({ node_id: 'f-hiring-cost' });
  });
});

/**
 * ⭐⭐ THE PAYOFF — the reason any of this exists.
 *
 * Every other test here proves the WRITE is correct. This one proves the
 * correction was WORTH MAKING: once the limit sits on a factor that records a
 * figure, the product must STOP saying it cannot be checked.
 *
 * ⚠ It is the outcome metric, not the symptom metric. "The row moved" is the
 * symptom; "the analysis can now test it, and the product no longer says
 * otherwise" is what the user experiences. A move that left the
 * not-checkable disclosure in place would be a correct write and a useless
 * capability — this estate's habit of converting a silent failure into an
 * honest failure and stopping there.
 */
describe('after the correction, the product stops saying the limit cannot be checked', () => {
  const graphWithMeasuredFactor = () => {
    const g = buildD1Fixture();
    g.nodes.push(
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' } as GraphV3T['nodes'][number],
      {
        id: 'f-hiring-cost', kind: 'factor', label: 'Hiring and Onboarding Cost',
        observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '\u00a3' },
      } as unknown as GraphV3T['nodes'][number],
    );
    (g as { goal_constraints?: unknown }).goal_constraints = [
      { constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' },
    ];
    return g;
  };

  it('⭐ the not-checkable disclosure is GONE once the limit sits on a measured factor', async () => {
    const outcome = await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP',
      corrects: 'r-overrun', graph: graphWithMeasuredFactor(),
    });
    const text = outcome.assistant_text ?? '';
    expect(text).not.toMatch(/no number recorded against it/i);
    expect(text).not.toMatch(/will not be part of the analysis/i);
  });

  it('⛔ CONTRAST: the SAME limit on the risk still says it cannot be checked', async () => {
    // Without this arm the test above could pass because the disclosure never
    // fires on this fixture at all, rather than because the correction fixed
    // anything. The pair is the discriminator.
    const g = graphWithMeasuredFactor();
    (g as { goal_constraints?: unknown }).goal_constraints = [];
    const outcome = await run({ targetId: 'r-overrun', value: 200000, unit: 'GBP', graph: g });
    expect(outcome.assistant_text ?? '').toMatch(/no number recorded against it/i);
  });
});

/**
 * ⭐⭐⭐ A CORRECTION RELOCATES ONE ROW — ITS ATTESTED PROPERTIES TRAVEL.
 *
 * ⚠ THIS SUITE EXISTS BECAUSE I FIXED THIS DEFECT FOUR TIMES ONE AT A TIME.
 * `existing` is undefined by construction on a move, so every chain reading it
 * falls through to DESTINATION metadata: the currency went, the before-state
 * went, the receipt said "added", then value_frame went. Each was returned as a
 * separate finding. These bind the RULE rather than the instances, so the next
 * reader of `existing` that forgets a move fails here instead of in review.
 */
describe('attested properties travel with the moved row', () => {
  const movable = (over: Record<string, unknown> = {}) => {
    const g = buildD1Fixture();
    g.nodes.push(
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' } as GraphV3T['nodes'][number],
      { id: 'f-hiring-cost', kind: 'factor', label: 'Hiring and Onboarding Cost' } as GraphV3T['nodes'][number],
    );
    (g as { goal_constraints?: unknown }).goal_constraints = [
      {
        constraint_id: 'gc-wrong', node_id: 'r-overrun', operator: '<=',
        value: 200000, unit: 'GBP', provenance: 'explicit',
        value_frame: 'level', label: 'Total hiring spend this year',
        ...over,
      },
    ];
    return g;
  };
  const move = async (graph: GraphV3T, over: Record<string, unknown> = {}) =>
    rowsOf(await run({
      targetId: 'f-hiring-cost', value: 200000, unit: 'GBP',
      corrects: 'r-overrun', graph, ...over,
    } as never));

  it('⭐ value_frame survives the move — its quantitative meaning', async () => {
    // Dropping it can reproduce the very unevaluated-limit outcome the
    // capability exists to repair.
    const rows = await move(movable());
    expect(rows[0]).toMatchObject({ node_id: 'f-hiring-cost', value_frame: 'level' });
  });

  it('⭐ the label survives the move — the user\u2019s own description', async () => {
    // Otherwise the limit is silently retitled with whatever the destination
    // node happens to be called, discarding what the user actually said.
    const rows = await move(movable());
    expect(rows[0]).toMatchObject({ label: 'Total hiring spend this year' });
  });

  it('⭐ \u00a3 and GBP still carry the frame — a spelling is not a change of quantity', async () => {
    // The source records the symbol, this turn restates the code. An EXACT
    // string compare would drop the frame on a move that preserved its meaning
    // exactly; the explicit unit on the turn still wins for the written row.
    const rows = await move(movable({ unit: '\u00a3' }));
    expect(rows[0]).toMatchObject({ value_frame: 'level', unit: 'GBP' });
  });

  it('⛔⛔ a move that CHANGES THE AMOUNT may not inherit the unit — the 700% case', async () => {
    // CEE stores a sub-1 percentage as {value: 0.07, unit: 'fraction'}, which
    // MEANS 7%. `normaliseConstraintUnits` only ever fires on unit === '%', so
    // a fraction-labelled row is never re-examined. Moving it while restating
    // the amount as 7 and silently inheriting 'fraction' writes SEVEN HUNDRED
    // PER CENT, and nothing downstream objects.
    const g = movable({ value: 0.07, unit: 'fraction' });
    const before = JSON.stringify((g as { goal_constraints?: unknown }).goal_constraints);
    await expect(run({
      targetId: 'f-hiring-cost', value: 7, corrects: 'r-overrun', graph: g,
    } as never)).rejects.toThrow();
    expect(JSON.stringify((g as { goal_constraints?: unknown }).goal_constraints)).toBe(before);
  });

  it('⭐ stating the units WITH the new amount is accepted — it is the silence that is refused', async () => {
    const rows = await move(movable({ value: 0.07, unit: 'fraction' }), { value: 7, unit: '%' });
    expect(rows[0]).toMatchObject({ value: 7, unit: '%' });
  });

  it('⭐ the frame key is spelled EXACTLY `value_frame` — a misspelling is silent', async () => {
    // ISL parses with extra:"ignore", so `value_frmae` is dropped at parse and
    // behaves identically to absence — with no error anywhere (captured arm D,
    // ISL c695feb7). And an ABSENT frame is worse than a wrong one: ISL fail-
    // closes by omitting the ENTIRE constraint_analysis block, deleting every
    // SIBLING constraint's verdict in that run.
    const rows = await move(movable());
    expect(Object.keys(rows[0]!)).toContain('value_frame');
  });

  it('⛔ NEVER INVENTS a frame the source did not attest', async () => {
    const rows = await move(movable({ value_frame: undefined }));
    expect(rows[0]?.value_frame).toBeUndefined();
  });

  it('⛔ an EXPLICIT label on this turn wins — restating is not preserving', async () => {
    expect((await move(movable()))[0]?.label).toBe('Total hiring spend this year');
    expect((await move(movable(), { label: 'Hiring budget' }))[0]?.label).toBe('Hiring budget');
  });

  it('⛔ an ordinary UPDATE is untouched — the destination row still governs', async () => {
    const g = buildD1Fixture();
    g.nodes.push({ id: 'f-hiring-cost', kind: 'factor', label: 'Hiring and Onboarding Cost' } as GraphV3T['nodes'][number]);
    (g as { goal_constraints?: unknown }).goal_constraints = [
      { constraint_id: 'gc-dest', node_id: 'f-hiring-cost', operator: '<=', value: 200000, unit: 'GBP', value_frame: 'level', label: 'Destination label' },
    ];
    const rows = await rowsOf(await run({ targetId: 'f-hiring-cost', value: 200000, unit: 'GBP', graph: g }));
    // The destination row governs its own frame, exactly as before. The LABEL
    // default (node label when the turn states none) is pre-existing behaviour
    // on the update path and this change does not touch it — asserting it here
    // would pin something I did not change and did not verify.
    expect(rows[0]).toMatchObject({ constraint_id: 'gc-dest', value_frame: 'level' });
  });
});

/**
 * ⭐⭐⭐ THE ANCHOR ROUTES, THROUGH THE REAL HANDLER — not the helper.
 *
 * ⚠ THIS SUITE EXISTS BECAUSE MY HELPER TESTS WERE NOT EVIDENCE ABOUT THE
 * PRODUCER. They injected `options` directly into the finder and passed. The
 * real handler parses its graph through `GraphV3`, which declares nodes, edges
 * and goal_constraints and NOTHING ELSE — so top-level options are STRIPPED at
 * the ingress parse, `graph.options` was always undefined, and the
 * every-option-pin route could never fire in production. A measured non-root
 * factor pinned by every real option was withheld even though PLoT's own
 * predicate accepts it.
 *
 * Codex found it on the real caller. A green helper test over an injected
 * fixture is exactly the shape that hides this, so these drive the handler.
 */
describe('anchor routes reach the REAL handler', () => {
  /** A measured factor that is NOT a root: another factor feeds it. */
  const nonRootGraph = (options: Array<Record<string, unknown>>) => {
    const g = buildD1Fixture();
    // ⚠ REPLACE the fixture's own option, do not add to it. It intervenes on
    // nothing here, so leaving it in makes "every option pins" false by
    // construction and the positive arm could never pass — the test would have
    // been measuring my fixture, not the route.
    g.nodes = g.nodes.filter((n) => (n as { kind?: unknown }).kind !== 'option') as never;
    // ⚠ AND STRIP THE FIXTURE'S OTHER £ FACTOR. `buildD1Fixture` ships
    // `f-budget` in £, so leaving it in gives TWO currency candidates and the
    // finder correctly refuses the ambiguity — the positive arm would then read
    // as "the anchor route is broken" when the refusal was right. A probe
    // showed exactly that before this line existed.
    for (const n of g.nodes as Array<Record<string, unknown>>) {
      if (n.id === 'f-budget') delete n.observed_state;
    }
    g.nodes.push(
      { id: 'r-overrun', kind: 'risk', label: 'Budget Overrun Risk' } as never,
      {
        id: 'f-hiring-cost', kind: 'factor', label: 'Hiring and Onboarding Cost',
        observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '£' },
      } as never,
      { id: 'f-upstream', kind: 'factor', label: 'Market Rates' } as never,
      ...(options as never[]),
    );
    // The directed edge that un-roots it — from a FACTOR, so PLoT keeps it.
    g.edges.push({
      id: 'e-unroot', from: 'f-upstream', to: 'f-hiring-cost',
      strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9,
      effect_direction: 'positive',
    } as never);
    return g;
  };
  const opt = (id: string, interventions?: Record<string, unknown>) =>
    ({ id, kind: 'option', label: id, ...(interventions ? { interventions } : {}) });

  const textFor = async (graph: GraphV3T) =>
    (await run({ targetId: 'r-overrun', value: 200000, unit: 'GBP', graph })).assistant_text ?? '';

  it('⭐⭐ PINNED BY EVERY OPTION: a measured NON-ROOT factor is offered', async () => {
    // Before the fix this said "has no number recorded against it" and named
    // nothing, because the pin route was unreachable through the parse.
    const text = await textFor(nonRootGraph([
      opt('opt_a', { 'f-hiring-cost': 0.4 }),
      opt('opt_b', { 'f-hiring-cost': 0.8 }),
    ]));
    expect(text).toMatch(/Hiring and Onboarding Cost/);
  });

  it('⛔⛔ PARTIAL TOP-LEVEL MIRROR: completed from the option NODES, not trusted wholesale', async () => {
    // Codex CX-303's counterexample. Option node A pins hiring cost; node B
    // pins something else; the top-level mirror lists ONLY A. Reading that
    // mirror wholesale sees one option, finds it pins, and concludes EVERY
    // option pins — while the real analysis retains A+B and concludes the
    // opposite. That OVER-ANCHORS, which is the worse direction: it names a
    // target PLoT will refuse to anchor.
    //
    // Canonical readiness completes a partial mirror from the option nodes
    // (a top-level array owns the population only when it is an exact
    // unique-id bijection with them), so B is retained and the offer is
    // correctly withheld.
    const g = nonRootGraph([
      opt('opt_a', { 'f-hiring-cost': 0.4 }),
      opt('opt_b', { 'f-upstream': 0.8 }),
    ]);
    (g as { options?: unknown }).options = [
      { id: 'opt_a', option_id: 'opt_a', label: 'opt_a', interventions: { 'f-hiring-cost': 0.4 } },
    ];
    expect(await textFor(g)).not.toMatch(/Hiring and Onboarding Cost/);
  });

  it('⛔ SOME options pin it — not every — so it is NOT offered', async () => {
    const text = await textFor(nonRootGraph([
      opt('opt_a', { 'f-hiring-cost': 0.4 }),
      opt('opt_b', { 'somewhere-else': 0.8 }),
    ]));
    expect(text).not.toMatch(/Hiring and Onboarding Cost/);
  });

  it('⛔ NO options pin it — a bare non-root is unanchored and NOT offered', async () => {
    const text = await textFor(nonRootGraph([opt('opt_a'), opt('opt_b')]));
    expect(text).not.toMatch(/Hiring and Onboarding Cost/);
  });
});
