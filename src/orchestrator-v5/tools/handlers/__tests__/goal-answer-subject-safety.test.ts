/**
 * ⭐⭐ AN ANSWER TO THE TARGET QUESTION LANDS ON THE GOAL — AND NOTHING ELSE DOES.
 *
 * The goal-answer capability's writer hop. The join itself already exists and is
 * covered (`add-constraint-goal-target-join.test.ts`): a goal-targeted
 * `at_least` stamps `goal_threshold_raw/_unit/_cap/_threshold` inside the one
 * sanctioned write. This file does not re-prove that. It pins the property that
 * makes the clarification → answer → writer chain SAFE to enter, which is the
 * one the native pricing brief makes concrete:
 *
 *   "£20k MRR within 12 months, keeping monthly churn under 4%, should we raise
 *    the Pro plan price from £49 to £59"
 *
 * Four numbers, one goal target. A user answering the product's target question
 * must set the GOAL's target — and an option price, a churn guardrail or a
 * baseline amount arriving through the same handler must NOT become it.
 *
 * ⚠ This is the writer boundary, not the native producer. It does not claim the
 *   native run asked a target question, and it locates no first loss — the raw
 *   preimage is still absent and the native sweep made zero repairs.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction, message: string): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-goal-answer',
      stage: 'frame',
      request_id: 'req-goal-answer',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-goal-answer',
      turn_id: 'turn-goal-answer',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-goal-answer',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function proposal(p: {
  readonly entityId: string;
  readonly entityKind: 'node' | 'goal';
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
}): ProposalAction {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit !== undefined) {
    parameters.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  }
  return {
    handler_id: 'add_constraint',
    entity: {
      id: p.entityId,
      kind: p.entityKind,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters,
    cited_context_fields: [],
  };
}

function goalOf(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const goal = nodes.find((n) => n.kind === 'goal');
  if (!goal) throw new Error('fixture graph must carry a goal node');
  return goal;
}

describe('the answer to a target question sets the goal target, and only that', () => {
  it('⭐ POSITIVE — an explicit goal-target answer is saved with its value AND unit', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        proposal({ entityId: 'g-revenue', entityKind: 'goal', constraintType: 'at_least', value: 20000, unit: '£' }),
        'Set the target to £20k MRR',
      ),
    );
    const goal = goalOf(outcome.mutated_graph);
    expect(goal.goal_threshold_raw).toBe(20000);
    expect(goal.goal_threshold_unit).toBe('£');
    // The five fields agree, or ISL scores a threshold against the wrong
    // denominator and returns a wrong probability silently.
    const cap = goal.goal_threshold_cap as number;
    expect(typeof cap).toBe('number');
    expect(goal.goal_threshold as number).toBeCloseTo(20000 / cap, 12);
  });

  it('NEGATIVE — a churn guardrail on its own factor never becomes the goal target', async () => {
    // The brief's second statement. It is a constraint on `f-churn`, and it must
    // stay one: 4 must not land on the goal as a success threshold.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        proposal({ entityId: 'f-churn', entityKind: 'node', constraintType: 'at_most', value: 4, unit: '%' }),
        'Keep monthly churn under 4%',
      ),
    );
    const goal = goalOf(outcome.mutated_graph);
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
  });

  it('NEGATIVE — an option price answer never becomes the goal target', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        proposal({ entityId: 'o-launch', entityKind: 'node', constraintType: 'at_least', value: 59, unit: '£' }),
        'Raise the Pro plan price to £59',
      ),
    );
    const goal = goalOf(outcome.mutated_graph);
    expect(goal.goal_threshold_raw).toBeUndefined();
  });

  it('NEGATIVE — a "keep below" answer on the goal stamps no target (minimisation doctrine)', async () => {
    // Kept because it is the shape a baseline-or-ceiling answer arrives in: ISL
    // computes P(samples >= threshold), so encoding a ceiling as a >= threshold
    // would invert the claim. The constraint may land; the target must not.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        proposal({ entityId: 'g-revenue', entityKind: 'goal', constraintType: 'at_most', value: 20000, unit: '£' }),
        'Keep revenue below £20k',
      ),
    );
    const goal = goalOf(outcome.mutated_graph);
    expect(goal.goal_threshold_raw).toBeUndefined();
  });
});
