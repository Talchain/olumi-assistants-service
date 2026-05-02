/**
 * V5 D1 golden-path closure (A3.1) — persisted graph shape regression
 * pin.
 *
 * Pre-fix `applyAndValidateMutation` returned the GraphV3-parsed
 * projection of the mutated graph, which strips top-level fields not
 * declared on GraphV3 (e.g. `options`, `goal_node_id`,
 * `schema_version`, `meta`, `coaching`, `causal_claims`,
 * `topology_plan`, `validation_warnings`). The persisted graph after
 * a D1 mutation therefore had FEWER top-level keys than the ingress.
 *
 * Post-fix the helper merges the validated structural fields
 * (`nodes`, `edges`, `goal_constraints`) onto the FULL ingress shape,
 * so every top-level key present in the ingress is present in the
 * mutated graph.
 *
 * Test strategy: drive each D1 handler against an ingress that
 * carries a wide assortment of top-level fields. Capture
 * `Object.keys` before and after mutation. Assert: every key in the
 * ingress survives. Only `nodes`, `edges`, `goal_constraints` may
 * differ in content (the asserted mutation).
 */

import { describe, it, expect } from 'vitest';

import { GraphV3 } from '../../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../../routing/types.js';
import type { HandlerInvocation } from '../../../registry.js';

import { createSetFactorValueHandler } from '../../set-factor-value.js';
import { createAddConstraintHandler } from '../../add-constraint.js';
import { createAdjustEdgeStrengthHandler } from '../../adjust-edge-strength.js';
import { buildD1Fixture } from './fixtures.js';

/**
 * Build an ingress graph carrying every top-level field a real
 * scenarios.graph row may have. The exact value shapes don't matter
 * for the persistence-shape test — we just need them to round-trip.
 */
function buildWideIngress(): Record<string, unknown> {
  const base = buildD1Fixture();
  return {
    ...base,
    schema_version: '3.0',
    options: [
      {
        id: 'o-launch',
        label: 'Launch now',
        status: 'ready',
        interventions: { 'f-churn': { value: 1, source: 'user_specified', target_match: { node_id: 'f-churn', match_type: 'exact_id', confidence: 'high' } } },
      },
    ],
    goal_node_id: 'g-revenue',
    meta: { source: 'user' as const },
    validation_warnings: [],
    coaching: { summary: 'baseline coaching', strengthen_items: [] },
    causal_claims: [],
    topology_plan: ['baseline'],
  };
}

function buildInvocation(
  ingress: unknown,
  proposal: ProposalAction,
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-shape',
      stage: 'frame',
      request_id: 'req-shape',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-shape',
      turn_id: 'turn-shape',
      stage: 'frame',
      message: 'mutate it',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-shape',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: ingress,
  };
}

const PRESERVED_TOP_LEVEL_KEYS = [
  'schema_version',
  'options',
  'goal_node_id',
  'meta',
  'validation_warnings',
  'coaching',
  'causal_claims',
  'topology_plan',
];

function assertEveryIngressKeySurvives(
  ingress: Record<string, unknown>,
  mutated: unknown,
): void {
  expect(mutated).not.toBeNull();
  expect(typeof mutated).toBe('object');
  const persistedKeys = Object.keys(mutated as Record<string, unknown>);
  for (const key of Object.keys(ingress)) {
    expect(persistedKeys).toContain(key);
  }
  // Specifically pin the named fields the brief calls out.
  for (const key of PRESERVED_TOP_LEVEL_KEYS) {
    expect(persistedKeys).toContain(key);
  }
  // The mutated graph must still parse as a GraphV3 (declared fields
  // are valid; passthrough fields are tolerated).
  const parsed = GraphV3.safeParse(mutated);
  expect(parsed.success).toBe(true);
}

describe('A3.1 Task 2 — persisted graph retains every ingress top-level key', () => {
  it('set_factor_value: mutated graph carries options, goal_node_id, meta, etc.', async () => {
    const ingress = buildWideIngress();
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
    assertEveryIngressKeySurvives(ingress, outcome.mutated_graph);

    // Pin specific top-level values pass through unchanged.
    const persisted = outcome.mutated_graph as Record<string, unknown>;
    expect(persisted.goal_node_id).toBe('g-revenue');
    expect(persisted.schema_version).toBe('3.0');
    expect(Array.isArray(persisted.options)).toBe(true);
    expect((persisted.options as unknown[]).length).toBe(1);

    // Mutation took effect on f-churn.
    const mutatedNodes = persisted.nodes as Array<{
      id: string;
      observed_state?: { value?: number; raw_value?: number };
    }>;
    const churn = mutatedNodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.raw_value).toBe(5);
    expect(churn?.observed_state?.value).toBe(0.05);
  });

  it('add_constraint: mutated graph carries options, goal_node_id, meta + new goal_constraints[]', async () => {
    const ingress = buildWideIngress();
    const proposal: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 5, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const handler = createAddConstraintHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    assertEveryIngressKeySurvives(ingress, outcome.mutated_graph);

    const persisted = outcome.mutated_graph as Record<string, unknown>;
    expect(persisted.goal_node_id).toBe('g-revenue');
    const constraints = persisted.goal_constraints as Array<{ node_id: string }>;
    expect(constraints).toHaveLength(1);
    expect(constraints[0].node_id).toBe('f-churn');
  });

  it('adjust_edge_strength: mutated graph carries options, goal_node_id, meta', async () => {
    const ingress = buildWideIngress();
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
    assertEveryIngressKeySurvives(ingress, outcome.mutated_graph);

    const persisted = outcome.mutated_graph as Record<string, unknown>;
    expect(persisted.goal_node_id).toBe('g-revenue');
    const edges = persisted.edges as Array<{
      from: string;
      to: string;
      strength: { mean: number };
    }>;
    const edge = edges.find((e) => e.from === 'f-budget' && e.to === 'g-revenue');
    expect(edge?.strength.mean).toBe(0.7);
  });
});
