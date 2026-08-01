/**
 * ROADMAP 2.273 (prerequisite) — increase-verb "by" backstop, symmetric with
 * the ROADMAP 1.52 reduction backstop.
 *
 * THE BUG THIS PREVENTS. `reduction-framing.ts`'s verb list is decrease-only,
 * so "grow revenue BY 2M" was invisible to the 1.52 backstop and encoded
 * naively as `{operator: '>=', value: +2_000_000}`. The goal-threshold stamp
 * then attests that number as `goal_threshold_frame: 'level'` — an ABSOLUTE
 * level on the metric's own scale. But the user stated a CHANGE amount: their
 * real target is `baseline + 2M`, i.e. 6M against a 4M baseline.
 *
 * Before this PR that misencoding was merely wrong-ish and unusable, because a
 * goal node carried no `observed_state.baseline` and ISL therefore refused to
 * convert at all (`missing_goal_baseline` — the honest absence pinned by
 * `goal-baseline-absent-characterisation.test.ts`). THIS PR POPULATES THE
 * BASELINE, which turns the same misencoding into a REAL FABRICATION: ISL
 * would compute `delta_threshold = 2_000_000/cap − baseline/cap + intercept`
 * and return a confident `probability_of_goal` answering
 * "P(revenue >= 2M)" when the user asked "P(revenue >= 6M)". A wrong number
 * is strictly worse than no number, so this backstop ships BEFORE/WITH the
 * extraction, never after it.
 *
 * THE FINGERPRINT IS SHARPER THAN 1.52's. The reduction backstop can afford a
 * coarse whole-message scan because a reduction verb + "by" is unambiguous.
 * An increase verb is NOT: "increase conversion to 5% BY December" is a LEVEL
 * statement with a temporal "by", and blocking it would be a product
 * regression. So this detector requires all three of:
 *   1. an increase verb,
 *   2. "by" followed by a NUMBER (not "by December"),
 *   3. NO intervening "to <number>" level statement between the two,
 * and the handler refuses only when the RESOLVED constraint value EQUALS the
 * stated delta — i.e. only when the persisted number provably IS the change
 * amount. If Sonnet already did the arithmetic and resolved "grow by 2M" to
 * `at_least 6M`, that is CORRECT and must sail through untouched.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  message: string,
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(p: {
  readonly entityId: string;
  readonly entityKind?: 'node' | 'goal';
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
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

describe('add_constraint increase-by backstop — ROADMAP 2.273 prerequisite', () => {
  it('REFUSES "grow revenue by 2M" persisted as at_least 2M (the delta-as-level fingerprint)', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'g-revenue',
            entityKind: 'goal',
            constraintType: 'at_least',
            value: 2_000_000,
            unit: '£',
          }),
          'Grow revenue by 2M this year.',
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });

    // A refusal must not mutate the graph — no delta must land as a level,
    // even transiently.
    expect(graph.goal_constraints ?? []).toHaveLength(0);
  });

  it('REFUSES the same fingerprint with a percentage delta ("increase retention by 10%")', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-quality',
            constraintType: 'at_least',
            value: 10,
            unit: '%',
          }),
          'Increase retention by 10% over the year.',
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it('does NOT trip on a LEVEL-intent "to" framing ("grow revenue to 6M")', async () => {
    // The load-bearing negative case named in the brief: a "to" target is an
    // absolute level and is exactly what the goal-threshold stamp is FOR.
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'g-revenue',
          entityKind: 'goal',
          constraintType: 'at_least',
          value: 6_000_000,
          unit: '£',
        }),
        'Grow revenue to 6M this year.',
      ),
    );

    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    expect(mutated.goal_constraints![0].value).toBe(6_000_000);
  });

  it('does NOT trip on a TEMPORAL "by" after a "to" level ("increase conversion to 5% by December")', async () => {
    // The false-positive this detector is shaped to avoid: an increase verb
    // AND the literal word "by" both present, but "by" introduces a DATE, and
    // a "to <number>" level statement sits between them.
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-quality',
          constraintType: 'at_least',
          value: 5,
          unit: '%',
        }),
        'Increase conversion to 5% by December.',
      ),
    );

    expect(outcome.mutated_graph).toBeDefined();
  });

  it('does NOT trip when Sonnet ALREADY resolved the delta correctly (by 2M → at_least 6M)', async () => {
    // The value is not the stated delta, so the naive-misencoding fingerprint
    // is absent: the arithmetic was done. Blocking here would punish the
    // correct behaviour.
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'g-revenue',
          entityKind: 'goal',
          constraintType: 'at_least',
          value: 6_000_000,
          unit: '£',
        }),
        'Grow revenue by 2M this year (we are at 4M today).',
      ),
    );

    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints![0].value).toBe(6_000_000);
  });

  it('does NOT trip on an at_most registration (the backstop is scoped to >= like 1.52)', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
        'Grow the team by 5 people but keep churn under 5%.',
      ),
    );

    expect(outcome.mutated_graph).toBeDefined();
  });
});
