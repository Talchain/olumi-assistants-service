import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
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
      message: 'set churn to 5%',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(params: {
  readonly entityId: string;
  readonly value: unknown;
  readonly operator?: 'set' | 'increase' | 'decrease' | 'multiply';
}): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: params.entityId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: params.value,
        ...(params.operator !== undefined ? { operator: params.operator } : {}),
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

describe('set_factor_value handler', () => {
  it('sets a percentage value with structured input on a capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );

    expect(outcome.assistant_text).toBe('Updated Customer churn from 4% to 5%.');
    expect(outcome.handler_facts).toHaveLength(1);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('set_factor_value');
    expect(fact.result.target_id).toBe('f-churn');
    expect(fact.result.status).toBe('applied');
    expect(fact.result.after).toMatchObject({ value: 0.05, raw_value: 5, unit: '%' });

    const mutated = outcome.mutated_graph as GraphV3T;
    const churn = mutated.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.value).toBe(0.05);
    expect(churn?.observed_state?.raw_value).toBe(5);

    // Hash divergence proves freshness will go stale on the next turn.
    expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(
      computeAnalysisAffectingGraphHash(mutated),
    );
  });

  it('handles increase on a currency-capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget',
          value: { value: 10000, unit: '£', cap: 100000 },
          operator: 'increase',
        }),
      ),
    );

    expect(outcome.assistant_text).toBe('Updated Marketing budget from £40,000 to £50,000.');
    const mutated = outcome.mutated_graph as GraphV3T;
    const budget = mutated.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(50000);
    expect(budget?.observed_state?.value).toBe(0.5);
  });

  it('handles decrease', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 1, unit: '%', cap: 100 },
          operator: 'decrease',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.result.after).toMatchObject({ raw_value: 3, value: 0.03 });
  });

  it('handles multiply', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget',
          value: { value: 1.5, cap: 100000, unit: '£' },
          operator: 'multiply',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.result.after).toMatchObject({ raw_value: 60000 });
  });

  it('rejects ambiguous bare-number on a capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    // Bare number 5 against cap=100 (churn factor): without a unit, "5"
    // could mean 5% or 0.05. Refuse rather than guess.
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'f-churn', value: 200, operator: 'set' }),
        ),
      ),
    ).rejects.toBeInstanceOf(HandlerInvocationFailedError);
  });

  it('rejects target with wrong kind', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'g-revenue', // goal, not factor
            value: { value: 5, unit: '%', cap: 100 },
            operator: 'set',
          }),
        ),
      ),
    ).rejects.toMatchObject({
      cause_kind: 'entity_kind_mismatch_at_execute',
    });
  });

  it('rejects unknown target id', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-nonexistent',
            value: { value: 5, unit: '%', cap: 100 },
            operator: 'set',
          }),
        ),
      ),
    ).rejects.toMatchObject({
      cause_kind: 'entity_not_found_in_graph',
    });
  });

  it('emits noop status when the value does not change', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 4, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.noop).toBe(true);
    expect(fact.result.status).toBe('noop');
  });

  it('confirmation text contains no raw decimals or stray spaces before %', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );
    expect(outcome.assistant_text).not.toMatch(/\d\s+%/);
    // The handler emits "5%" not "0.05" — model unit never leaks into prose.
    expect(outcome.assistant_text).not.toContain('0.05');
  });
});
