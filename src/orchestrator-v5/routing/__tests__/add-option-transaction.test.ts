/**
 * Lane C3 — pure add-option transaction builder.
 *
 * Pins:
 *  - a valid typed spec → the atomic batch (option node carrying CANONICAL
 *    top-level interventions + parent edge + one option→factor edge per value);
 *  - referential integrity + kind checks (parent is a decision, targets are
 *    factors, no duplicate factor, id collision / invalid id);
 *  - STRICT VALUES (orchestrator directive): a coercible string, NaN, or
 *    Infinity where a number is expected is a classified skip — never coerced;
 *  - unconfigured (no values) → option + parent edge only, `configured:false`;
 *  - id derivation (opt_<slug>, collision-suffixed).
 */
import { describe, expect, it } from 'vitest';

import {
  buildAddOptionTransaction,
  type AddOptionGraphView,
} from '../add-option-transaction.js';

const GRAPH: AddOptionGraphView = {
  nodes: [
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort' },
    { id: 'fac_uplift', kind: 'factor', label: 'Capability uplift' },
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'opt_existing', kind: 'option', label: 'Stay put' },
  ],
  edges: [{ from: 'fac_effort', to: 'g_profit' }],
};

const validParams = () => ({
  parent_decision_id: 'dec_choice',
  label: 'Outsource to a BPO vendor',
  interventions: [
    { factor_id: 'fac_effort', value: 0.55 },
    { factor_id: 'fac_uplift', value: 0.7, unit: '%' },
  ],
});

function findAddNode(ops: readonly { op: string; path: string; value?: unknown }[]) {
  return ops.find((o) => o.op === 'add_node');
}

describe('buildAddOptionTransaction — happy path (the atomic batch)', () => {
  it('emits add_node(option) FIRST, then parent edge, then one factor edge per value', () => {
    const r = buildAddOptionTransaction(validParams(), GRAPH);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const { operations } = r.proposal;
    expect(operations.map((o) => o.op)).toEqual(['add_node', 'add_edge', 'add_edge', 'add_edge']);
    // add_node is first so the referee's intra-batch sequencing sees the option
    // node when it referees the edges.
    expect(operations[0]!.op).toBe('add_node');
  });

  it('the option node carries CANONICAL top-level interventions (debit a — lands with values)', () => {
    const r = buildAddOptionTransaction(validParams(), GRAPH);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const addNode = findAddNode(r.proposal.operations)!;
    const value = addNode.value as { kind: string; interventions: Record<string, unknown> };
    expect(value.kind).toBe('option');
    // Interventions ride INSIDE the add_node value (not a separate slash-path
    // update_node) so they survive the confirm-side GraphV3 re-parse.
    expect(value.interventions.fac_effort).toEqual({
      value: 0.55,
      source: 'user_specified',
      target_match: { node_id: 'fac_effort', match_type: 'exact_id', confidence: 'high' },
    });
    expect(value.interventions.fac_uplift).toEqual({
      value: 0.7,
      source: 'user_specified',
      target_match: { node_id: 'fac_uplift', match_type: 'exact_id', confidence: 'high' },
      unit: '%',
    });
    expect(r.proposal.configured).toBe(true);
    expect(r.proposal.configuredFactorIds).toEqual(['fac_effort', 'fac_uplift']);
  });

  it('structural edges carry the shared STRUCTURAL_EDGE_DEFAULTS (topology, not a belief)', () => {
    const r = buildAddOptionTransaction(validParams(), GRAPH);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    for (const op of r.proposal.operations.filter((o) => o.op === 'add_edge')) {
      const v = op.value as Record<string, unknown>;
      expect(v.strength).toEqual({ mean: 1.0, std: 0.01 });
      expect(v.exists_probability).toBe(1.0);
      expect(v.effect_direction).toBe('positive');
      expect(v.provenance).toEqual({ source: 'user_specified' });
    }
    // parent decision → option, and option → each factor
    const edges = r.proposal.operations
      .filter((o) => o.op === 'add_edge')
      .map((o) => o.value as { from: string; to: string });
    expect(edges[0]).toMatchObject({ from: 'dec_choice', to: r.proposal.optionId });
    expect(edges.slice(1).map((e) => e.to).sort()).toEqual(['fac_effort', 'fac_uplift']);
  });

  it('derives a canonical opt_<slug> id, collision-suffixed', () => {
    const r = buildAddOptionTransaction(validParams(), GRAPH);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.optionId).toBe('opt_outsource_to_a_bpo_vendor');

    // collision → suffixed
    const collidingGraph: AddOptionGraphView = {
      ...GRAPH,
      nodes: [...GRAPH.nodes, { id: 'opt_outsource_to_a_bpo_vendor', kind: 'option', label: 'x' }],
    };
    const r2 = buildAddOptionTransaction(validParams(), collidingGraph);
    expect(r2.matched).toBe(true);
    if (!r2.matched) return;
    expect(r2.proposal.optionId).toBe('opt_outsource_to_a_bpo_vendor_2');
  });

  it('a producer-supplied option_id is honoured when canonical and free', () => {
    const r = buildAddOptionTransaction({ ...validParams(), option_id: 'opt_bpo' }, GRAPH);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.optionId).toBe('opt_bpo');
  });
});

describe('buildAddOptionTransaction — unconfigured option (proposal-time disclosure branch)', () => {
  it('no interventions → option + parent edge only, configured:false', () => {
    const r = buildAddOptionTransaction(
      { parent_decision_id: 'dec_choice', label: 'Bare option', interventions: [] },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.operations.map((o) => o.op)).toEqual(['add_node', 'add_edge']);
    expect(r.proposal.configured).toBe(false);
    const value = findAddNode(r.proposal.operations)!.value as { interventions: Record<string, unknown> };
    expect(value.interventions).toEqual({});
  });

  it('interventions absent entirely (undefined) → still builds unconfigured', () => {
    const r = buildAddOptionTransaction(
      { parent_decision_id: 'dec_choice', label: 'Bare option' },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.configured).toBe(false);
  });
});

describe('buildAddOptionTransaction — referential integrity + positive controls', () => {
  it.each([
    ['no_parameters', null, GRAPH],
    ['no_graph', validParams(), null],
  ] as const)('%s → classified skip', (reason, params, graph) => {
    const r = buildAddOptionTransaction(params, graph);
    expect(r).toEqual({ matched: false, reason });
  });

  it('parent that does not exist → parent_not_found', () => {
    const r = buildAddOptionTransaction({ ...validParams(), parent_decision_id: 'dec_ghost' }, GRAPH);
    expect(r).toEqual({ matched: false, reason: 'parent_not_found' });
  });

  it('parent that is not a decision → parent_not_decision', () => {
    const r = buildAddOptionTransaction({ ...validParams(), parent_decision_id: 'g_profit' }, GRAPH);
    expect(r).toEqual({ matched: false, reason: 'parent_not_decision' });
  });

  it('a target that is not a factor → factor_not_factor', () => {
    const r = buildAddOptionTransaction(
      { ...validParams(), interventions: [{ factor_id: 'g_profit', value: 0.5 }] },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'factor_not_factor' });
  });

  it('a target that does not exist → factor_not_found', () => {
    const r = buildAddOptionTransaction(
      { ...validParams(), interventions: [{ factor_id: 'fac_ghost', value: 0.5 }] },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'factor_not_found' });
  });

  it('a repeated factor → duplicate_factor', () => {
    const r = buildAddOptionTransaction(
      {
        ...validParams(),
        interventions: [
          { factor_id: 'fac_effort', value: 0.5 },
          { factor_id: 'fac_effort', value: 0.6 },
        ],
      },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'duplicate_factor' });
  });

  it('a producer-supplied id that collides with an existing node → option_id_collision', () => {
    const r = buildAddOptionTransaction({ ...validParams(), option_id: 'opt_existing' }, GRAPH);
    expect(r).toEqual({ matched: false, reason: 'option_id_collision' });
  });

  it('a non-canonical producer-supplied id → option_id_invalid', () => {
    const r = buildAddOptionTransaction({ ...validParams(), option_id: 'Opt With Spaces!' }, GRAPH);
    expect(r).toEqual({ matched: false, reason: 'option_id_invalid' });
  });

  it('missing required fields → parameters_invalid', () => {
    expect(buildAddOptionTransaction({ label: 'x' }, GRAPH)).toEqual({
      matched: false,
      reason: 'parameters_invalid',
    });
    expect(buildAddOptionTransaction({ parent_decision_id: 'dec_choice' }, GRAPH)).toEqual({
      matched: false,
      reason: 'parameters_invalid',
    });
  });
});

describe('buildAddOptionTransaction — STRICT VALUES (no silent coercion)', () => {
  it.each([
    ['coercible string', '0.55'],
    ['word number', 'one hundred and forty'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['boolean', true],
    ['null', null],
  ])('a %s intervention value is rejected (parameters_invalid), never coerced', (_label, value) => {
    const r = buildAddOptionTransaction(
      {
        parent_decision_id: 'dec_choice',
        label: 'Coercion probe',
        interventions: [{ factor_id: 'fac_effort', value }],
      },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });

  it('a non-finite raw_value number is rejected too', () => {
    const r = buildAddOptionTransaction(
      {
        parent_decision_id: 'dec_choice',
        label: 'Raw probe',
        interventions: [{ factor_id: 'fac_effort', value: 0.5, raw_value: Number.NaN }],
      },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });

  it('a legitimate STRING raw_value (categorical) with a finite value IS accepted', () => {
    const r = buildAddOptionTransaction(
      {
        parent_decision_id: 'dec_choice',
        label: 'Categorical',
        interventions: [{ factor_id: 'fac_effort', value: 1, raw_value: 'UK' }],
      },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const value = findAddNode(r.proposal.operations)!.value as { interventions: Record<string, { raw_value?: unknown }> };
    expect(value.interventions.fac_effort!.raw_value).toBe('UK');
  });

  it('never throws on hostile input', () => {
    for (const hostile of [undefined, 42, 'str', [], { interventions: 'nope' }]) {
      expect(() => buildAddOptionTransaction(hostile, GRAPH)).not.toThrow();
    }
  });
});
