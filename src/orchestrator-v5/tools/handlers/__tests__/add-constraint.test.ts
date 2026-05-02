import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { HandlerInvocation } from '../../registry.js';

import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
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
      message: 'add a constraint',
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
  readonly label?: string;
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  if (p.label) params.push({ name: 'label', value: p.label, source: 'user_explicit' });
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

describe('add_constraint handler', () => {
  it('appends a "churn at most 5%" constraint with user units (NOT 0.05)', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          constraintType: 'at_most',
          value: 5,
          unit: '%',
        }),
      ),
    );

    expect(outcome.assistant_text).toBe(
      'Added constraint: Customer churn must be at most 5%.',
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toBeDefined();
    expect(mutated.goal_constraints).toHaveLength(1);
    const constraint = mutated.goal_constraints![0];
    expect(constraint.node_id).toBe('f-churn');
    expect(constraint.operator).toBe('<=');
    expect(constraint.value).toBe(5); // user units
    expect(constraint.unit).toBe('%');
    expect(constraint.label).toBe('Customer churn');
    expect(constraint.constraint_id).toMatch(/^gc-/);
  });

  it('appends a "quality at least 80%" constraint', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-quality',
          constraintType: 'at_least',
          value: 80,
          unit: '%',
        }),
      ),
    );
    expect(outcome.assistant_text).toContain('at least 80%');
    const mutated = outcome.mutated_graph as GraphV3T;
    const c = mutated.goal_constraints![0];
    expect(c.operator).toBe('>=');
    expect(c.value).toBe(80);
  });

  it('handles currency without spaces and with thousands separators', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget',
          constraintType: 'at_most',
          value: 50000,
          unit: '£',
        }),
      ),
    );
    expect(outcome.assistant_text).toBe(
      'Added constraint: Marketing budget must be at most £50,000.',
    );
    expect(outcome.assistant_text).not.toMatch(/\d\s+%/);
  });

  it('updates an existing constraint on the same (node_id, operator) instead of duplicating', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const first = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
      ),
    );
    const afterFirst = first.mutated_graph as GraphV3T;
    const idAfterFirst = afterFirst.goal_constraints![0].constraint_id;

    const second = await handler(
      buildInvocation(
        afterFirst,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 3, unit: '%' }),
      ),
    );
    const afterSecond = second.mutated_graph as GraphV3T;

    expect(afterSecond.goal_constraints).toHaveLength(1);
    expect(afterSecond.goal_constraints![0].constraint_id).toBe(idAfterFirst);
    expect(afterSecond.goal_constraints![0].value).toBe(3);
    expect(second.assistant_text).toContain('Updated constraint');
  });

  it('emits noop when the value is unchanged', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const first = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
      ),
    );
    const second = await handler(
      buildInvocation(
        first.mutated_graph as GraphV3T,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
      ),
    );
    expect(second.handler_facts[0].noop).toBe(true);
    expect(second.handler_facts[0].result.status).toBe('noop');
  });

  it('rejects target with wrong kind', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'o-launch', // option, not allowed
            constraintType: 'at_least',
            value: 80,
          }),
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'entity_kind_mismatch_at_execute' });
  });

  it('rejects unknown target id', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-nonexistent',
            constraintType: 'at_most',
            value: 5,
          }),
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'entity_not_found_in_graph' });
  });

  it('changes graph hash so prior analysis is marked stale', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
      ),
    );
    expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphV3T),
    );
  });

  it('confirmation text never contains raw decimals or stray spaces before %', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
      ),
    );
    // Allow integer or formatted currency, but no x.y decimal in the prose.
    expect(outcome.assistant_text).not.toMatch(/[0-9]+\.[0-9]+/);
    expect(outcome.assistant_text).not.toMatch(/\d\s+%/);
  });
});
