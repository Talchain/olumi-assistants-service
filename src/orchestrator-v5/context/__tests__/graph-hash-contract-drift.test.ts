import {
  CANONICAL_GRAPH_HASH_NESTED_PROJECTION,
  CANONICAL_GRAPH_HASH_PROJECTION_VERSION,
} from '@talchain/schemas/boundary';
import { describe, expect, it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  ANALYSIS_GRAPH_HASH_PROJECTION_VERSION,
  computeAnalysisAffectingGraphHash,
} from '../graph-hash.js';

type MutableRecord = Record<string, unknown>;

function maximalAnalysisGraph(): GraphStateIngress {
  return {
    nodes: [
      {
        id: 'input',
        kind: 'factor',
        category: 'controllable',
        factor_type: 'continuous',
        is_baseline: false,
        goal_threshold: 0.5,
        goal_threshold_raw: '50%',
        goal_threshold_cap: 1,
        intercept: 0.1,
        encoding_map: { low: 0, high: 1 },
        observed_state: { value: 0.4, baseline: 0.2, cap: 1 },
        prior: { distribution: 'normal', range_min: 0, range_max: 1 },
        interventions: {
          input: {
            value: 0.6,
            value_type: 'number',
            encoding_map: { low: 0, high: 1 },
            target_match: { node_id: 'input' },
          },
        },
      },
      { id: 'outcome', kind: 'goal' },
    ],
    edges: [
      {
        from: 'input',
        to: 'outcome',
        edge_type: 'directed',
        exists_probability: 0.9,
        effect_direction: 'positive',
        strength: { mean: 0.7, std: 0.1 },
      },
    ],
    options: [
      {
        id: 'option-a',
        status: 'needs_user_mapping',
        is_baseline: false,
        interventions: {
          input: {
            value: 0.8,
            value_type: 'number',
            encoding_map: { low: 0, high: 1 },
            target_match: { node_id: 'input' },
          },
        },
        raw_interventions: { input: 'increase substantially' },
      },
    ],
    goal_node_id: 'outcome',
    goal_constraints: [],
  } as unknown as GraphStateIngress;
}

function cloneGraph(graph: GraphStateIngress): GraphStateIngress {
  return structuredClone(graph);
}

function changed(value: unknown): unknown {
  if (typeof value === 'number') return value + 0.123;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return `${value}:changed`;
  if (Array.isArray(value)) return [...value, 'changed'];
  if (value && typeof value === 'object') {
    return { ...(value as MutableRecord), drift_witness: true };
  }
  return 'changed';
}

function recordAt(value: unknown): MutableRecord {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  return value as MutableRecord;
}

function assertMutationMovesHash(
  label: string,
  mutate: (graph: GraphStateIngress) => void,
): void {
  const before = maximalAnalysisGraph();
  const after = cloneGraph(before);
  mutate(after);
  expect(
    computeAnalysisAffectingGraphHash(after),
    `${label} is declared by the shared projection manifest and must move the hash`,
  ).not.toBe(computeAnalysisAffectingGraphHash(before));
}

describe('analysis graph hash shared-manifest drift guard', () => {
  it('reports the exact schema-owned projection version', () => {
    expect(ANALYSIS_GRAPH_HASH_PROJECTION_VERSION).toBe(
      CANONICAL_GRAPH_HASH_PROJECTION_VERSION,
    );
  });

  it('hashes every node field declared by the shared manifest', () => {
    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.fields) {
      assertMutationMovesHash(`node.${field}`, (graph) => {
        const node = recordAt(graph.nodes[0]);
        node[field] = changed(node[field]);
      });
    }

    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.observed_state_fields) {
      assertMutationMovesHash(`node.observed_state.${field}`, (graph) => {
        const observed = recordAt(recordAt(graph.nodes[0]).observed_state);
        observed[field] = changed(observed[field]);
      });
    }

    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.prior_fields) {
      assertMutationMovesHash(`node.prior.${field}`, (graph) => {
        const prior = recordAt(recordAt(graph.nodes[0]).prior);
        prior[field] = changed(prior[field]);
      });
    }
  });

  it('hashes every edge field declared by the shared manifest', () => {
    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge.fields) {
      assertMutationMovesHash(`edge.${field}`, (graph) => {
        const edge = recordAt(graph.edges[0]);
        edge[field] = changed(edge[field]);
      });
    }

    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge.strength_fields) {
      assertMutationMovesHash(`edge.strength.${field}`, (graph) => {
        const strength = recordAt(recordAt(graph.edges[0]).strength);
        strength[field] = changed(strength[field]);
      });
    }
  });

  it('hashes every option and intervention field declared by the shared manifest', () => {
    for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.fields) {
      assertMutationMovesHash(`option.${field}`, (graph) => {
        const option = recordAt((graph.options as unknown[])[0]);
        option[field] = changed(option[field]);
      });
    }

    const carrierFields = [
      CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.interventions_field,
      CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.interventions_field,
    ] as const;

    for (const [carrierIndex, carrierField] of carrierFields.entries()) {
      const carrierName = carrierIndex === 0 ? 'node' : 'option';
      for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.intervention.fields) {
        assertMutationMovesHash(`${carrierName}.${carrierField}.input.${field}`, (graph) => {
          const carrier = carrierIndex === 0
            ? recordAt(graph.nodes[0])
            : recordAt((graph.options as unknown[])[0]);
          const intervention = recordAt(recordAt(carrier[carrierField]).input);
          intervention[field] = changed(intervention[field]);
        });
      }

      for (const field of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.intervention.target_match_fields) {
        assertMutationMovesHash(
          `${carrierName}.${carrierField}.input.${CANONICAL_GRAPH_HASH_NESTED_PROJECTION.intervention.target_match_field}.${field}`,
          (graph) => {
            const carrier = carrierIndex === 0
              ? recordAt(graph.nodes[0])
              : recordAt((graph.options as unknown[])[0]);
            const intervention = recordAt(recordAt(carrier[carrierField]).input);
            const targetMatch = recordAt(
              intervention[
                CANONICAL_GRAPH_HASH_NESTED_PROJECTION.intervention.target_match_field
              ],
            );
            targetMatch[field] = changed(targetMatch[field]);
          },
        );
      }
    }
  });

  it('applies the schema-owned raw-interventions condition exactly', () => {
    const conditional = CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.conditional_field;

    assertMutationMovesHash(`option.${conditional.field}`, (graph) => {
      const option = recordAt((graph.options as unknown[])[0]);
      option[conditional.field] = changed(option[conditional.field]);
    });

    const readyA = maximalAnalysisGraph();
    const readyB = cloneGraph(readyA);
    const optionA = recordAt((readyA.options as unknown[])[0]);
    const optionB = recordAt((readyB.options as unknown[])[0]);
    optionA[conditional.include_when.field] = conditional.include_when.not_equals;
    optionB[conditional.include_when.field] = conditional.include_when.not_equals;
    optionB[conditional.field] = changed(optionB[conditional.field]);

    expect(computeAnalysisAffectingGraphHash(readyB)).toBe(
      computeAnalysisAffectingGraphHash(readyA),
    );
  });
});
