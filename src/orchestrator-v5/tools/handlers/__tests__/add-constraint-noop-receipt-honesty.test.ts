/**
 * ROADMAP 1.19(a) — receipt claim-integrity: single-target re-registration
 * with an UNCHANGED value must not emit a false "updated" receipt.
 *
 * Defect: `add_constraint` already computes `valueUnchanged` (node_id +
 * operator match, same value/unit/label vs the persisted `existing`
 * constraint) and correctly stamps `fact.noop = true` for the FACT
 * channel — but the assistant_text channel ignored it entirely:
 *   - non-goal targets: `existing !== undefined` alone selected
 *     `formatConstraintUpdated` ("Updated constraint: …"), regardless of
 *     whether the restated value actually differed from what was already
 *     persisted.
 *   - goal targets: `isGoalTargetSet` alone selected `formatGoalTargetSet`
 *     ("Success target set: …"), an unconditional fresh-registration claim
 *     even when the target was already registered at the identical value.
 *
 * A user restating an already-correct target got a receipt implying a
 * fresh commit happened — a real diff-vs-persisted-state claim the code
 * never checked before speaking.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-noop',
      stage: 'frame',
      request_id: 'req-noop',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-noop',
      turn_id: 'turn-noop',
      stage: 'frame',
      message: 'restate the same constraint',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-noop',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function constraintProposal(p: {
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
  readonly entityId: string;
  readonly entityKind: 'node' | 'goal';
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
      kind: p.entityKind,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

describe('add_constraint: re-registration with an unchanged value must not claim "updated"', () => {
  it('non-goal target: restating the SAME constraint value twice does not claim "Updated" the second time', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const first = await handler(
      buildInvocation(
        graph,
        constraintProposal({
          constraintType: 'at_most',
          value: 5,
          unit: '%',
          entityId: 'f-churn',
          entityKind: 'node',
        }),
      ),
    );
    expect(first.assistant_text).toContain('Added constraint');

    const second = await handler(
      buildInvocation(
        first.mutated_graph as GraphV3T,
        constraintProposal({
          constraintType: 'at_most',
          value: 5,
          unit: '%',
          entityId: 'f-churn',
          entityKind: 'node',
        }),
      ),
    );

    // The fact channel already gets this right — pin it stays right.
    expect(second.handler_facts[0]?.result).toMatchObject({ status: 'noop' });

    // The text channel must agree with the fact: no "updated" claim for
    // an unchanged restatement.
    expect(second.assistant_text).not.toMatch(/\bupdated\b/i);
  });

  it('goal target: restating the SAME success target twice does not repeat a fresh "set" claim', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const first = await handler(
      buildInvocation(
        graph,
        constraintProposal({
          constraintType: 'at_least',
          value: 15,
          unit: '%',
          entityId: 'g-revenue',
          entityKind: 'goal',
        }),
      ),
    );
    expect(first.assistant_text).toContain('Success target set');

    const second = await handler(
      buildInvocation(
        first.mutated_graph as GraphV3T,
        constraintProposal({
          constraintType: 'at_least',
          value: 15,
          unit: '%',
          entityId: 'g-revenue',
          entityKind: 'goal',
        }),
      ),
    );

    expect(second.handler_facts[0]?.result).toMatchObject({ status: 'noop' });
    // Restating an already-registered, unchanged target must not read as
    // a fresh registration event.
    expect(second.assistant_text).not.toBe(first.assistant_text);
    expect(second.assistant_text).toMatch(/already/i);
  });
});
