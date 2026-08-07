/**
 * Unit tests for the FAITHFUL-OR-NULL graph → counterfactual model builder.
 *
 * Pins the two halves of the honesty contract:
 *   1. A parametric graph maps to a well-formed, graph-verbatim structural
 *      model (linear equations from strength.mean + intercept; exogenous roots
 *      pinned at observed values; intervention var never in context).
 *   2. Any graph that would require an INVENTED value yields null — no
 *      defaulting, no fabrication.
 */

import { describe, it, expect } from 'vitest';

import { buildCounterfactualModel } from '../build-counterfactual-model.js';
import type { CounterfactualProbe } from '../select-counterfactual-probe.js';

const PROBE: CounterfactualProbe = {
  factor_id: 'factor_capacity',
  factor_label: 'Engineering capacity',
  trigger: 'concrete_flip',
};

// Loosely typed so mutation cases below need no casts; the builder takes
// `unknown` and parses defensively anyway.
interface LooseGraph {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

/** A minimal, fully-parametric mappable graph. */
function mappableGraph(): LooseGraph {
  return {
    nodes: [
      { id: 'goal_fit', kind: 'goal', label: 'Goal fit', observed_state: { value: 0 } },
      {
        id: 'factor_capacity',
        kind: 'factor',
        label: 'Engineering capacity',
        observed_state: { value: 10, cap: 20, unit: 'engineers' },
      },
      { id: 'factor_cost', kind: 'factor', label: 'Hiring cost', observed_state: { value: 5 } },
    ],
    edges: [
      {
        from: 'factor_capacity',
        to: 'goal_fit',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'factor_cost',
        to: 'goal_fit',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'negative',
      },
    ],
  };
}

describe('buildCounterfactualModel — faithful mapping', () => {
  it('builds a linear SEM with the intervention at the factor cap', () => {
    const built = buildCounterfactualModel(mappableGraph(), PROBE);
    expect(built).not.toBeNull();
    const { request, meta } = built!;

    // Outcome is the goal; intervention is the probe factor at its cap (20).
    expect(request.outcome).toBe('goal_fit');
    expect(request.intervention).toEqual({ factor_capacity: 20 });

    // Endogenous goal equation is the intercept-plus-linear form, verbatim.
    expect(request.model.equations).toEqual({
      goal_fit: '0 + 0.6 * factor_capacity + -0.4 * factor_cost',
    });
    expect(new Set(request.model.variables)).toEqual(
      new Set(['goal_fit', 'factor_capacity', 'factor_cost']),
    );

    // Both roots carry a (degenerate) distribution at their pinned value.
    expect(request.model.distributions.factor_capacity).toEqual({
      type: 'uniform',
      parameters: { min: 20, max: 20 },
    });
    expect(request.model.distributions.factor_cost).toEqual({
      type: 'uniform',
      parameters: { min: 5, max: 5 },
    });

    // The intervention variable is NEVER placed in context (do∩observe → 422).
    expect(request.context).toEqual({ factor_cost: 5 });

    // Card metadata is graph-verbatim.
    expect(meta).toEqual({
      goalLabel: 'Goal fit',
      factorLabel: 'Engineering capacity',
      factorUnit: 'engineers',
      factorCurrentValue: 10,
      interventionValue: 20,
    });
  });

  it('excludes bidirected (confounder) edges from the structural model', () => {
    const g = mappableGraph();
    // A bidirected edge must not become a structural equation term.
    g.edges.push({
      from: 'factor_cost',
      to: 'factor_capacity',
      strength: { mean: 0.9, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
      edge_type: 'bidirected',
    });
    const built = buildCounterfactualModel(g, PROBE);
    expect(built).not.toBeNull();
    // factor_capacity stays a root (the bidirected edge gave it no parent).
    expect(built!.request.model.equations.factor_capacity).toBeUndefined();
    expect(built!.request.model.distributions.factor_capacity).toBeDefined();
  });
});

describe('buildCounterfactualModel — fail loud (null, never invent)', () => {
  it('returns null on an unparsable graph', () => {
    expect(buildCounterfactualModel({ not: 'a graph' }, PROBE)).toBeNull();
    expect(buildCounterfactualModel(null, PROBE)).toBeNull();
  });

  it('returns null when the probe factor is absent from the graph', () => {
    const built = buildCounterfactualModel(mappableGraph(), {
      ...PROBE,
      factor_id: 'factor_missing',
    });
    expect(built).toBeNull();
  });

  it('returns null when there is no single goal node', () => {
    const g = mappableGraph();
    g.nodes[0]!.kind = 'factor'; // remove the goal
    expect(buildCounterfactualModel(g, PROBE)).toBeNull();
  });

  it('returns null when the probe factor has no cap or distinct baseline (no faithful target)', () => {
    const g = mappableGraph();
    g.nodes[1]!.observed_state = { value: 10, unit: 'engineers' }; // no cap, no baseline
    expect(buildCounterfactualModel(g, PROBE)).toBeNull();
  });

  it('returns null when there is no causal structure (no edges)', () => {
    const g = mappableGraph();
    g.edges = [];
    expect(buildCounterfactualModel(g, PROBE)).toBeNull();
  });

  it('returns null when the goal has no drivers (goal is a root)', () => {
    const g = mappableGraph();
    // Rewire the only edges so the goal has no incoming edge but structure exists.
    g.edges = [
      {
        from: 'factor_capacity',
        to: 'factor_cost',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ];
    expect(buildCounterfactualModel(g, PROBE)).toBeNull();
  });
});
