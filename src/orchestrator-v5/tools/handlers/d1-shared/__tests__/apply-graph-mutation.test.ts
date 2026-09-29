import { describe, expect, it } from 'vitest';

import { applyAndValidateMutation } from '../apply-graph-mutation.js';
import { D1HandlerError } from '../errors.js';

import { buildD1Fixture } from './fixtures.js';

describe('applyAndValidateMutation', () => {
  it('applies a benign mutation and returns a validated graph', () => {
    const graph = buildD1Fixture();
    const { mutatedGraph, before, after } = applyAndValidateMutation(graph, (clone) => {
      const node = clone.nodes.find((n) => n.id === 'f-churn');
      if (!node || !node.observed_state) throw new Error('fixture broken');
      const beforeVal = node.observed_state.value;
      node.observed_state = { ...node.observed_state, value: 0.05, raw_value: 5 };
      return { before: { value: beforeVal }, after: { value: 0.05 } };
    });
    expect(before).toEqual({ value: 0.04 });
    expect(after).toEqual({ value: 0.05 });
    const churn = mutatedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.value).toBe(0.05);
    // Original graph is unchanged.
    expect(graph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.value).toBe(0.04);
  });

  it('rejects a mutation that produces an invalid graph', () => {
    const graph = buildD1Fixture();
    expect(() =>
      applyAndValidateMutation(graph, (clone) => {
        clone.edges.push({
          from: 'f-budget',
          to: 'g-revenue',
          // Missing required fields would fail the strict schema.
          // Negative exists_probability violates the [0,1] bound.
          strength: { mean: 0, std: 0.1 },
          exists_probability: -1,
          effect_direction: 'positive',
        });
        return { before: null, after: null };
      }),
    ).toThrow(D1HandlerError);
  });

  it('lets an inner mutator throw without parsing the (unknown) graph state', () => {
    const graph = buildD1Fixture();
    expect(() =>
      applyAndValidateMutation(graph, () => {
        throw new D1HandlerError('ENTITY_NOT_FOUND', 'simulated');
      }),
    ).toThrow(D1HandlerError);
  });
});
