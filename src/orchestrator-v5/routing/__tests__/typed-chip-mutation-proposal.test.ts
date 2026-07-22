/**
 * S2-L3 — typed-chip mutation proposal reader unit pins.
 *
 * POSITIVE-CONTROL DOCTRINE (R-4 / trap-10/13): every parameter the reader
 * CLAIMS to read carries a test proving the read CHANGES the produced proposal
 * — feed value X, get X back; feed Y, get Y. A write-only (ignored) read would
 * pass a bare "matched" assertion, so each field is discriminated against a
 * different input. The fall-through cases prove an un-routable chip resolves to
 * a classified skip (never a throw, never a guess) — the caller's benign
 * fall-through (the #634 un-routed-intent contract) depends on it.
 */
import { describe, expect, it } from 'vitest';

import {
  buildTypedChipMutationProposal,
  isTypedChipMutationActionType,
  TYPED_CHIP_MUTATION_ACTION_TYPES,
  type TypedChipGraphView,
} from '../typed-chip-mutation-proposal.js';

const GRAPH: TypedChipGraphView = {
  nodes: [
    { id: 'g-rev', kind: 'goal', label: 'Revenue' },
    { id: 'd-choice', kind: 'decision', label: 'Which launch' },
    { id: 'f-budget', kind: 'factor', label: 'Budget' },
    { id: 'f-time', kind: 'factor', label: 'Time' },
    { id: 'o-launch', kind: 'option', label: 'Launch now' },
  ],
  edges: [{ from: 'f-budget', to: 'g-rev' }],
};

describe('isTypedChipMutationActionType', () => {
  it('recognises exactly the three mutation action_types', () => {
    expect(TYPED_CHIP_MUTATION_ACTION_TYPES).toEqual([
      'set_factor_value',
      'adjust_edge_strength',
      'add_constraint',
    ]);
    for (const a of TYPED_CHIP_MUTATION_ACTION_TYPES) {
      expect(isTypedChipMutationActionType(a)).toBe(true);
    }
    // add_option is an Intent, not routed here; explanation/coaching excluded.
    expect(isTypedChipMutationActionType('add_option')).toBe(false);
    expect(isTypedChipMutationActionType('analysis_readiness')).toBe(false);
    expect(isTypedChipMutationActionType('run_analysis')).toBe(false);
    expect(isTypedChipMutationActionType(undefined)).toBe(false);
  });
});

describe('set_factor_value — reads chip.parameters into the proposal', () => {
  it('builds a resolved id_match proposal carrying the exact target and value', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-budget', value: 42000 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.handler_id).toBe('set_factor_value');
    expect(r.proposal.entity).toMatchObject({
      id: 'f-budget',
      kind: 'node',
      label: 'Budget',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    });
    const p = r.proposal.parameters[0]!;
    expect(p.name).toBe('value');
    expect(p.value).toBe(42000);
    expect(p.operator).toBe('set');
    expect(p.source).toBe('user_explicit');
  });

  // POSITIVE CONTROL — value is READ, not hardcoded: a different input yields a
  // different proposal value.
  it('carries a DIFFERENT value when a different value is sent', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-time', value: 7 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.entity.id).toBe('f-time');
    expect(r.proposal.parameters[0]!.value).toBe(7);
  });

  // POSITIVE CONTROL — unit changes the proposal SHAPE (flat number vs
  // structured {value,unit}) and is echoed on the parameter.
  it('structures the value with a unit when a unit is sent', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-budget', value: 40000, unit: '£' },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const p = r.proposal.parameters[0]!;
    expect(p.value).toEqual({ value: 40000, unit: '£' });
    expect(p.unit).toBe('£');
  });

  // POSITIVE CONTROL — operator is READ, not defaulted, when supplied.
  it('carries the supplied operator instead of the default', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-budget', value: 5000, operator: 'increase' },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.parameters[0]!.operator).toBe('increase');
  });

  it('refuses a non-factor target (kind mismatch) fail-closed', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'g-rev', value: 1 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'target_kind_mismatch' });
  });

  it('refuses a target that is not in the graph', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-nope', value: 1 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'target_not_found' });
  });

  it('refuses malformed parameters (missing value)', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-budget' },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });

  it('refuses a string value (contract requires a resolved number)', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { target_id: 'f-budget', value: '42000' },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });

  it('strips producer-side keys (chip_id) without rejecting', () => {
    const r = buildTypedChipMutationProposal(
      'set_factor_value',
      { chip_id: 'chip-xyz', spark_id: 's-1', target_id: 'f-budget', value: 3 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.parameters[0]!.value).toBe(3);
  });
});

describe('adjust_edge_strength — reads chip.parameters into the proposal', () => {
  it('builds an edge proposal from a composed target_id', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-budget→g-rev', value: 0.6 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.handler_id).toBe('adjust_edge_strength');
    expect(r.proposal.entity).toMatchObject({ id: 'f-budget→g-rev', kind: 'edge' });
    const p = r.proposal.parameters[0]!;
    expect(p.name).toBe('strength');
    expect(p.value).toBe(0.6);
  });

  // POSITIVE CONTROL — value is READ.
  it('carries a DIFFERENT strength when a different value is sent', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-budget→g-rev', value: -0.3 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.parameters[0]!.value).toBe(-0.3);
  });

  it('accepts an explicit from/to pair and composes the canonical id', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { from: 'f-budget', to: 'g-rev', value: 0.2 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.entity.id).toBe('f-budget→g-rev');
  });

  // POSITIVE CONTROL — optional std adds a second parameter only when sent.
  it('adds a std parameter only when std is supplied', () => {
    const without = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-budget→g-rev', value: 0.5 },
      GRAPH,
    );
    const withStd = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-budget→g-rev', value: 0.5, std: 0.1 },
      GRAPH,
    );
    expect(without.matched && without.proposal.parameters).toHaveLength(1);
    expect(withStd.matched && withStd.proposal.parameters).toHaveLength(2);
    if (withStd.matched) {
      expect(withStd.proposal.parameters[1]).toMatchObject({ name: 'std', value: 0.1 });
    }
  });

  it('refuses an edge whose endpoints are not connected in the graph', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-time→g-rev', value: 0.5 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'target_not_found' });
  });

  it('refuses a strength out of [-1,1]', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { target_id: 'f-budget→g-rev', value: 5 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });

  it('refuses when neither target_id nor a from/to pair is present', () => {
    const r = buildTypedChipMutationProposal(
      'adjust_edge_strength',
      { value: 0.5 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });
});

describe('add_constraint — reads chip.parameters into the proposal', () => {
  it('builds a goal-target constraint proposal carrying type + value', () => {
    const r = buildTypedChipMutationProposal(
      'add_constraint',
      { target_id: 'g-rev', constraint_type: 'at_least', value: 1000000, unit: '£' },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.handler_id).toBe('add_constraint');
    expect(r.proposal.entity).toMatchObject({ id: 'g-rev', kind: 'goal' });
    const byName = Object.fromEntries(r.proposal.parameters.map((p) => [p.name, p]));
    expect(byName.constraint_type!.value).toBe('at_least');
    expect(byName.value!.value).toBe(1000000);
    expect(byName.value!.unit).toBe('£');
  });

  // POSITIVE CONTROL — constraint_type is READ.
  it('carries a DIFFERENT constraint_type when a different one is sent', () => {
    const r = buildTypedChipMutationProposal(
      'add_constraint',
      { target_id: 'g-rev', constraint_type: 'at_most', value: 5 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const ct = r.proposal.parameters.find((p) => p.name === 'constraint_type')!;
    expect(ct.value).toBe('at_most');
  });

  it('maps a non-goal, non-option node target to entity kind node', () => {
    const r = buildTypedChipMutationProposal(
      'add_constraint',
      { target_id: 'd-choice', constraint_type: 'at_least', value: 3 },
      GRAPH,
    );
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.proposal.entity.kind).toBe('node');
  });

  it('refuses an option target (not an accepted constraint entity kind)', () => {
    const r = buildTypedChipMutationProposal(
      'add_constraint',
      { target_id: 'o-launch', constraint_type: 'at_least', value: 3 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'target_kind_mismatch' });
  });

  it('refuses an out-of-vocabulary constraint_type', () => {
    const r = buildTypedChipMutationProposal(
      'add_constraint',
      { target_id: 'g-rev', constraint_type: 'exactly', value: 3 },
      GRAPH,
    );
    expect(r).toEqual({ matched: false, reason: 'parameters_invalid' });
  });
});

describe('totality / fall-through classification', () => {
  it('skips a non-mutation action_type', () => {
    expect(
      buildTypedChipMutationProposal('run_analysis', { target_id: 'f-budget', value: 1 }, GRAPH),
    ).toEqual({ matched: false, reason: 'not_mutation_action_type' });
  });

  it('skips when parameters are absent', () => {
    expect(buildTypedChipMutationProposal('set_factor_value', undefined, GRAPH)).toEqual({
      matched: false,
      reason: 'no_parameters',
    });
  });

  it('skips when the graph is absent (cannot validate the target)', () => {
    expect(
      buildTypedChipMutationProposal('set_factor_value', { target_id: 'f-budget', value: 1 }, null),
    ).toEqual({ matched: false, reason: 'no_graph' });
  });

  it('never throws on hostile parameters', () => {
    expect(() =>
      buildTypedChipMutationProposal('set_factor_value', 42, GRAPH),
    ).not.toThrow();
    expect(
      buildTypedChipMutationProposal('set_factor_value', 42, GRAPH),
    ).toEqual({ matched: false, reason: 'no_parameters' });
  });
});
