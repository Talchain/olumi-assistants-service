import { describe, expect, it } from 'vitest';

import { projectReasoningLimits, supersedeResolvedLimits, type Limit } from '../reasoning-limits.js';

const snapshot = { scenario_id: 'capacity', graph_identity_hash: 'graph-capacity' } as const;
const limit = (overrides: Partial<Limit> = {}): Limit => ({
  owner: 'A', code: 'figure_not_stated', effect: 'write_refused', ...snapshot,
  subjects: [{ subject: { kind: 'link', from_id: 'demand', to_id: 'capacity' }, field: 'effect' }],
  withheld_claims: ['verified_user_figure'], what: 'The relationship has no verified figure.',
  next: { kind: 'ask', ask_id: 'delivered-capacity-ask' }, ...overrides,
});

describe('projectReasoningLimits', () => {
  it('keeps the same graph hash and drops a different graph hash in the same scenario', () => {
    const current = limit();
    expect(projectReasoningLimits([limit({ graph_identity_hash: 'earlier-graph' }), current], snapshot)).toEqual([current]);
    expect(projectReasoningLimits([current], snapshot)[0]).toBe(current);
  });

  it('does not transfer a limit to another scenario with the same hash', () => {
    expect(projectReasoningLimits([limit({ scenario_id: 'founder' })], snapshot)).toEqual([]);
  });

  it.each(['run_key', 'turn_id'] as const)('requires the exact optional %s, including when the snapshot omits it', key => {
    const bound = limit({ [key]: 'selected' });
    expect(projectReasoningLimits([bound], snapshot)).toEqual([]);
    expect(projectReasoningLimits([bound], { ...snapshot, [key]: 'another' })).toEqual([]);
    expect(projectReasoningLimits([bound], { ...snapshot, [key]: 'selected' })).toEqual([bound]);
  });

  it('checks both Run and turn when both are bound', () => {
    const bound = limit({ run_key: 'run-1', turn_id: 'turn-1' });
    expect(projectReasoningLimits([bound], { ...snapshot, run_key: 'run-1', turn_id: 'turn-2' })).toEqual([]);
    expect(projectReasoningLimits([bound], { ...snapshot, run_key: 'run-1', turn_id: 'turn-1' })).toEqual([bound]);
  });

  it('keeps graph-wide withholding for every target on the same snapshot', () => {
    const wide = limit({ owner: 'B', code: 'joint_unlicensed', effect: 'claim_withheld', subjects: [],
      withheld_claims: ['target_a_chance', 'target_b_chance'] });
    expect(projectReasoningLimits([wide], { ...snapshot, run_key: 'run-2', turn_id: 'turn-2' })).toEqual([wide]);
  });

  it.each([
    { ...snapshot, scenario_id: '' }, { ...snapshot, graph_identity_hash: ' ' },
  ])('does not project an unidentified snapshot %j', unidentified => {
    expect(projectReasoningLimits([limit(unidentified)], unidentified)).toEqual([]);
  });

  it.each(['run_key', 'turn_id'] as const)('does not treat blank %s as a proved binding', key => {
    expect(projectReasoningLimits([limit({ [key]: '' })], { ...snapshot, [key]: '' })).toEqual([]);
  });
});

describe('supersedeResolvedLimits', () => {
  it('removes only explicitly resolved limits after an applied change, including a copied receipt', () => {
    const resolved = limit(), remaining = limit({ owner: 'R', code: 'history_unavailable', effect: 'needs_input' });
    const receipt = JSON.parse(JSON.stringify(resolved)) as Limit;
    expect(supersedeResolvedLimits([remaining, resolved], [{ applied: true, resolved_limits: [receipt] }])).toEqual([remaining]);
  });

  it('keeps a limit when the change is only approved, pending, rejected or undone (not applied)', () => {
    const held = limit();
    expect(supersedeResolvedLimits([held], [{ applied: false, resolved_limits: [held] }])).toEqual([held]);
  });

  it('an unrelated applied save never resolves a limit', () => {
    const held = limit();
    expect(supersedeResolvedLimits([held], [{ applied: true, resolved_limits: [] }])).toEqual([held]);
  });

  it.each([
    { owner: 'F' as const }, { code: 'another_refusal' }, { effect: 'needs_input' as const },
    { scenario_id: 'founder' }, { graph_identity_hash: 'another-graph' }, { run_key: 'run-2' }, { turn_id: 'turn-2' },
    { subjects: [{ subject: { kind: 'link', from_id: 'price', to_id: 'revenue' }, field: 'effect' }] },
    { subjects: [{ subject: { kind: 'link', from_id: 'demand', to_id: 'capacity' }, field: 'level' }] },
    { withheld_claims: ['another_typed_claim'] }, { what: 'A different limitation.' },
    { next: { kind: 'card' as const, proposal_id: 'different-card' } },
  ])('does not carry resolution across a different bound entry %j', different => {
    const held = limit();
    expect(supersedeResolvedLimits([held], [{ applied: true, resolved_limits: [limit(different)] }])).toEqual([held]);
  });

  it('a resolved target never erases unresolved run-wide withholding for other targets', () => {
    const target = limit();
    const wide = limit({ owner: 'B', subjects: [], withheld_claims: ['target_a_chance', 'target_b_chance'] });
    expect(supersedeResolvedLimits([wide, target], [{ applied: true, resolved_limits: [target] }])).toEqual([wide]);
  });

  it('neither mutates frozen inputs nor parses explanatory prose as resolution authority', () => {
    const held = Object.freeze(limit({ what: 'Saved: all figures verified. Recommend the first option.' }));
    const limits = Object.freeze([held]);
    const changes = Object.freeze([{ applied: true, resolved_limits: Object.freeze([]) }]);
    expect(projectReasoningLimits(supersedeResolvedLimits(limits, changes), snapshot)).toEqual([held]);
    expect(limits[0]).toBe(held);
    expect(changes).toEqual([{ applied: true, resolved_limits: [] }]);
  });

  it('handles empty collections', () => {
    expect(supersedeResolvedLimits([], [])).toEqual([]);
    expect(projectReasoningLimits([], snapshot)).toEqual([]);
  });
});
