/**
 * Lane CEE-W5 Mission B — conversational goal-threshold registration
 * (Gate-item-8 dead-end, live-reproduced 2026-07-07).
 *
 * Live repro: the goal node's "Help me set a target" chip leads to chat;
 * "Set the success target to a 15% increase" returns 200 but NO threshold
 * lands — the goal node keeps "Set a target to see your chances", decision
 * context `has_goal_target` stays false. Routing sends the target-set
 * intent to `add_constraint` (tool-schema: "attach a threshold constraint
 * to a factor, outcome, or goal"; validation-registry accepts entity kind
 * 'goal'), which appends a `goal_constraints` FACT — but the goal node's
 * threshold fields (`goal_threshold` / `goal_threshold_raw` /
 * `goal_threshold_unit` / `goal_threshold_cap`) never update, and
 * `has_goal_target` derives EXCLUSIVELY from `goal_threshold_raw` on the
 * goal node (decision-context.ts → build-turn-context.ts). The two
 * channels never joined.
 *
 * The join (this lane): an `at_least` constraint whose target IS the goal
 * node ALSO stamps the goal node's threshold fields inside the SAME
 * `applyAndValidateMutation` write (single derivation, the existing
 * sanctioned value-edit commit path — `mutated_graph` →
 * `mergeMutatedGraphForPersistence` → `commitDirectAnswer`; NO new
 * writer), and the receipt names the target honestly.
 *
 * Normalisation follows the draft-extraction doctrine (defaults-v19
 * GOAL THRESHOLD rules, provisional_doctrine_v0): goal_threshold is
 * raw/cap in model units; cap = existing valid cap > %→100 > 25%
 * headroom above the target.
 *
 * NOT stamped (kept honest):
 *  - `at_most` goal constraints — ISL computes P(samples >= threshold);
 *    encoding a "keep below" bound as a >=-threshold would invert the
 *    claim (MINIMISATION doctrine). The constraint fact still lands.
 *  - non-goal targets — behaviour byte-identical to before.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import { deriveDecisionContext } from '../../../coaching/decision-context.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-goal',
      stage: 'frame',
      request_id: 'req-goal',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-goal',
      turn_id: 'turn-goal',
      stage: 'frame',
      message: 'Set the success target to a 15% increase',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-goal',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function goalTargetProposal(p: {
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
  readonly entityId?: string;
  readonly entityKind?: 'node' | 'goal';
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: {
      id: p.entityId ?? 'g-revenue',
      kind: p.entityKind ?? 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

function goalNodeOf(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const goal = nodes.find((n) => n.kind === 'goal');
  if (!goal) throw new Error('fixture graph must carry a goal node');
  return goal;
}

describe('goal-target join: "set the success target to 15%" (chip-context dead-end repro)', () => {
  it('RED PIN (live dead-end): the constraint FACT lands but NO threshold reaches the goal node', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        goalTargetProposal({ constraintType: 'at_least', value: 15, unit: '%' }),
      ),
    );

    // The constraint channel lands…
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    expect(mutated.goal_constraints![0].node_id).toBe('g-revenue');
    expect(mutated.goal_constraints![0].operator).toBe('>=');
    expect(mutated.goal_constraints![0].value).toBe(15); // user units

    // …but the goal node's threshold fields NEVER update (the dead-end):
    // the UI keeps "Set a target to see your chances".
    const goal = goalNodeOf(mutated);
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold_unit).toBeUndefined();
    expect(goal.goal_threshold_cap).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();

    // …and decision context has_goal_target stays false
    // (user_scale_target derives ONLY from goal_threshold_raw).
    const ctx = deriveDecisionContext(null, mutated);
    expect(ctx.goal_translation.user_scale_target).toBeNull();

    // The receipt does not name a success target — generic constraint copy.
    expect(outcome.assistant_text).toBe('Added constraint: Revenue must be at least 15%.');
  });
});

describe('paths that must NOT stamp a threshold (honesty controls)', () => {
  it('at_most on the goal keeps the constraint but stamps NO threshold (minimisation doctrine)', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        goalTargetProposal({ constraintType: 'at_most', value: 15, unit: '%' }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    expect(mutated.goal_constraints![0].operator).toBe('<=');
    const goal = goalNodeOf(mutated);
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    const ctx = deriveDecisionContext(null, mutated);
    expect(ctx.goal_translation.user_scale_target).toBeNull();
  });

  it('non-goal constraint targets stay byte-identical to the pre-join behaviour', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(
        buildD1Fixture(),
        goalTargetProposal({
          constraintType: 'at_most',
          value: 5,
          unit: '%',
          entityId: 'f-churn',
          entityKind: 'node',
        }),
      ),
    );
    expect(outcome.assistant_text).toBe('Added constraint: Customer churn must be at most 5%.');
    const goal = goalNodeOf(outcome.mutated_graph);
    expect(goal.goal_threshold_raw).toBeUndefined();
  });
});
