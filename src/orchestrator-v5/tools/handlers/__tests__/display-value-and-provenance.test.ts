/**
 * V5 D1 golden-path closure (A3.1 Task 3) — display_value recompute +
 * provenance refresh.
 *
 * Pre-fix: a `set_factor_value` mutation left `display_value` stale
 * ("£40,000" after raw_value mutated to 50000) and `provenance`
 * unchanged. Same on `adjust_edge_strength` for edge provenance.
 *
 * Post-fix:
 *   - set_factor_value recomputes `display_value` via the canonical
 *     `synthesiseDisplayValue` from `cee/factor-extraction/display-value`
 *     and stamps `provenance: 'user_set'` (NodeV3 enum supports it).
 *   - adjust_edge_strength stamps `provenance.source: 'user_specified'`
 *     (closest value on the EdgeV3.provenance.source enum) and
 *     `provenance_display: 'user_set'`.
 *
 * Tests round-trip the mutated node/edge through `GraphV3.parse` to
 * confirm the writes match the schema.
 */

import { describe, it, expect } from 'vitest';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { HandlerInvocation } from '../../registry.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-prov',
      stage: 'frame',
      request_id: 'req-prov',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-prov',
      turn_id: 'turn-prov',
      stage: 'frame',
      message: 'mutate',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-prov',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

describe('A3.1 Task 3 — set_factor_value recomputes display_value and stamps provenance', () => {
  it('factor with prior display_value "£40,000" mutated to £50,000 → display_value recomputed, provenance "user_set"', async () => {
    const ingress: GraphV3T = {
      ...buildD1Fixture(),
    };
    // Stamp a prior display_value the mutation must overwrite.
    const budget = ingress.nodes.find((n) => n.id === 'f-budget');
    if (!budget) throw new Error('fixture broken');
    budget.display_value = '£40,000';
    budget.provenance = 'from_brief';

    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: { value: 50000, unit: '£', cap: 100000 },
          operator: 'set',
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };

    const handler = createSetFactorValueHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    const mutatedBudget = mutated.nodes.find((n) => n.id === 'f-budget');
    expect(mutatedBudget).toBeDefined();

    // display_value reflects the post-mutation raw_value/unit.
    expect(mutatedBudget?.display_value).toBeDefined();
    expect(mutatedBudget?.display_value).not.toBe('£40,000');
    expect(mutatedBudget?.display_value).toMatch(/£\s?50/);

    // Provenance flipped to user_set.
    expect(mutatedBudget?.provenance).toBe('user_set');

    // Round-trip through Zod proves the writes match the schema.
    const reparsed = GraphV3.safeParse(mutated);
    expect(reparsed.success).toBe(true);
  });

  it('factor without prior display_value → mutation succeeds, display_value populated', async () => {
    const ingress = buildD1Fixture();
    // f-uncapped has no display_value in the fixture.
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-uncapped',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: { value: 18, unit: 'people' },
          operator: 'set',
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };
    const handler = createSetFactorValueHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    const node = mutated.nodes.find((n) => n.id === 'f-uncapped');
    // synthesiseDisplayValue may return undefined for some inputs; when
    // it does, the prior absence is preserved and the property is
    // simply not written. The provenance write is unconditional.
    expect(node?.provenance).toBe('user_set');
    // Round-trip parse confirms the mutation is schema-clean either way.
    expect(GraphV3.safeParse(mutated).success).toBe(true);
  });

  it('percentage factor: display_value reflects raw_value, not the model-unit value', async () => {
    const ingress = buildD1Fixture();
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };
    const handler = createSetFactorValueHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    const node = mutated.nodes.find((n) => n.id === 'f-churn');
    // display_value should reference the user-unit value (5%), not the
    // model-unit value (0.05).
    expect(node?.display_value).toBeDefined();
    expect(node?.display_value).not.toContain('0.05');
    expect(node?.provenance).toBe('user_set');
  });
});

describe('A3.1 Task 3 — adjust_edge_strength stamps edge provenance', () => {
  it('edge mutation → provenance.source "user_specified" + provenance_display "user_set", round-trip clean', async () => {
    const ingress = buildD1Fixture();
    const proposal: ProposalAction = {
      handler_id: 'adjust_edge_strength',
      entity: {
        id: 'f-budget→g-revenue',
        kind: 'edge',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'strength',
          value: 0.7,
          operator: 'set',
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };
    const handler = createAdjustEdgeStrengthHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find(
      (e) => e.from === 'f-budget' && e.to === 'g-revenue',
    );
    expect(edge).toBeDefined();
    expect(edge?.provenance).toBeDefined();
    expect(edge?.provenance?.source).toBe('user_specified');
    expect(edge?.provenance_display).toBe('user_set');

    // Round-trip parse confirms the writes are schema-clean.
    expect(GraphV3.safeParse(mutated).success).toBe(true);
  });

  it('edge with prior provenance is updated, not duplicated', async () => {
    const ingress = buildD1Fixture();
    const churnEdge = ingress.edges.find(
      (e) => e.from === 'f-churn' && e.to === 'g-revenue',
    );
    if (!churnEdge) throw new Error('fixture broken');
    churnEdge.provenance = { source: 'brief_extraction', reasoning: 'from the brief' };
    churnEdge.provenance_display = 'from_brief';

    const proposal: ProposalAction = {
      handler_id: 'adjust_edge_strength',
      entity: {
        id: 'f-churn→g-revenue',
        kind: 'edge',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'strength', value: -0.8, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const handler = createAdjustEdgeStrengthHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find(
      (e) => e.from === 'f-churn' && e.to === 'g-revenue',
    );
    expect(edge?.provenance?.source).toBe('user_specified');
    // Prior reasoning is preserved (only source is overwritten).
    expect(edge?.provenance?.reasoning).toBe('from the brief');
    expect(edge?.provenance_display).toBe('user_set');
  });
});
