import { describe, expect, it } from 'vitest';
import { emitProposedChange } from '../../compose/proposed-change.js';
import { PENDING_ACTION_DEFAULT_WALL_TTL_MS, type PendingAction } from '../../session/pending-action.js';
import { getDefaultRegistry } from '../../tools/registry.js';
import type { HandlerFactWithTurn } from '../../types/handler-fact.js';
import type { ProposedChange } from '../../types/proposed-change.js';
import { buildExpiredConstraintRenewal, type ExpiredConstraintRenewalInput } from '../expired-constraint-renewal.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const HASH = 'unchanged-persisted-graph';
const OLD_TIME = '2026-09-19T18:26:52.667Z';
const NOW = '2026-09-19T18:36:55.825Z';
const registry = getDefaultRegistry();

function offer(overrides: Partial<ProposedChange> = {}): PendingAction {
  const result = emitProposedChange({
    intent: 'add_constraint', label: 'Add this limit', message: 'Add that limit to my model.',
    params: { constraint_type: 'at_least', value: 1_300_000, unit: '£', label: 'Minimum funding' },
    target_entity_ids: ['funding'], constraint_value_frame: 'level', ...overrides,
  }, { scenario_id: SCENARIO, graph_hash: HASH, emitted_at_iso: OLD_TIME, registry });
  if (result.status !== 'success') throw new Error('fixture offer rejected');
  return result.pending;
}

function input(overrides: Partial<ExpiredConstraintRenewalInput> = {}): ExpiredConstraintRenewalInput {
  return {
    message: 'Add that limit to my model.', pendingActions: [offer()], scenarioId: SCENARIO,
    currentGraphHash: HASH, graphNodes: [{ id: 'funding', kind: 'factor', label: 'Funding Amount Secured' }],
    existingConstraints: [], priorFactsWithTurn: [], emittedAtIso: NOW, registry, ...overrides,
  };
}

describe('expired typed constraint renewal', () => {
  it('re-offers the exact funding floor with fresh lifetime and no execution authority', () => {
    const old = offer();
    const snapshot = structuredClone(old);
    const result = buildExpiredConstraintRenewal(input({ pendingActions: [old] }));
    expect(result.status).toBe('renewed');
    if (result.status !== 'renewed') throw new Error('expected renewed offer');
    expect(result.previousPendingId).toBe(old.id);
    expect(result.pending.id).not.toBe(old.id);
    expect(result.chip.id).toBe(old.chip_id);
    expect(result.pending.action).toEqual(old.action);
    expect(result.pending.preconditions).toEqual(old.preconditions);
    expect(result.pending.emitted_at_iso).toBe(NOW);
    expect(Date.parse(result.pending.expires_at_iso)).toBe(Date.parse(NOW) + PENDING_ACTION_DEFAULT_WALL_TTL_MS);
    expect(result.changeDescription).toContain('Funding Amount Secured');
    expect(result.changeDescription).toContain('at or above');
    expect(result.constraintValueFrame).toBe('level');
    expect(result).not.toHaveProperty('handler_id');
    expect(old).toEqual(snapshot);
  });

  it.each(['yes', 'make that update'])('renews a sole expired offer for %s', (message) => {
    expect(buildExpiredConstraintRenewal(input({ message })).status).toBe('renewed');
  });

  it.each(['level', 'delta', undefined] as const)('preserves %s frame without deriving authority from confirmation', (frame) => {
    const old = offer({ params: { constraint_type: 'at_most', value: 25, unit: '%' }, constraint_value_frame: frame });
    const result = buildExpiredConstraintRenewal(input({ pendingActions: [old] }));
    expect(result.status).toBe('renewed');
    if (result.status !== 'renewed' || result.pending.action.kind !== 'apply_proposed_change') throw new Error('expected offer');
    expect(result.pending.action.inline_patch?.constraint_value_frame).toBe(frame);
    expect(result.pending.action.inline_patch?.params).toEqual({ constraint_type: 'at_most', value: 25, unit: '%' });
    expect(result.chip.id).toBe(old.chip_id);
  });

  it('does not pick between identical rendered copies with different bounds', () => {
    const second = offer({ params: { constraint_type: 'at_least', value: 2_000_000, unit: '£' } });
    expect(buildExpiredConstraintRenewal(input({ pendingActions: [offer(), second] }))).toEqual({ status: 'not_renewed', reason: 'no_unique_offer', matchedExpiredConstraint: false });
  });

  it('does not pick a bare confirmation over another pending kind', () => {
    const other = { ...offer(), id: 'other', action: { kind: 'run_analysis' } } as PendingAction;
    expect(buildExpiredConstraintRenewal(input({ message: 'yes', pendingActions: [offer(), other] })).status).toBe('not_renewed');
  });

  it('allows a unique exact copy among differently labelled proposals', () => {
    const other = offer({ label: 'Add another limit', message: 'Add that other limit.', params: { constraint_type: 'at_least', value: 2_000_000 } });
    expect(buildExpiredConstraintRenewal(input({ pendingActions: [offer(), other] })).status).toBe('renewed');
  });

  it.each(['different', null, undefined])('refuses stale or absent graph hash %s', (currentGraphHash) => {
    expect(buildExpiredConstraintRenewal(input({ currentGraphHash }))).toEqual({ status: 'not_renewed', reason: 'superseded', matchedExpiredConstraint: true });
  });

  it('refuses missing and unsupported targets', () => {
    expect(buildExpiredConstraintRenewal(input({ graphNodes: [] }))).toEqual({ status: 'not_renewed', reason: 'target_missing', matchedExpiredConstraint: true });
    expect(buildExpiredConstraintRenewal(input({ graphNodes: [{ id: 'funding', kind: 'option', label: 'Funding' }] })).status).toBe('not_renewed');
  });

  it.each([
    { constraint_type: 'at_least' },
    { constraint_type: 'at_least', value: Infinity },
    { constraint_type: 'exactly', value: 100 },
    { constraint_type: 'at_least', value: 100, unit: 4 },
    { constraint_type: 'at_least', value: 100, label: '' },
    { constraint_type: 'at_least', value: 100, raw_value: 100 },
  ])('refuses invalid or incomplete tuples %j', (params) => {
    expect(buildExpiredConstraintRenewal(input({ pendingActions: [offer({ params })] })).status).toBe('not_renewed');
  });

  it('refuses invalid frame, mismatched precondition target and another scenario', () => {
    const malformed = offer();
    if (malformed.action.kind !== 'apply_proposed_change') throw new Error('expected proposal');
    const badFrame = { ...malformed, action: { ...malformed.action, inline_patch: { ...malformed.action.inline_patch, constraint_value_frame: 'invented' } } } as PendingAction;
    const wrongTarget = { ...malformed, preconditions: { ...malformed.preconditions, target_entity_ids: ['other'] } };
    for (const pending of [badFrame, wrongTarget, { ...malformed, scenario_id: 'another-scenario' }]) {
      expect(buildExpiredConstraintRenewal(input({ pendingActions: [pending] })).status).toBe('not_renewed');
    }
  });

  it('refuses other handlers, still-live offers and independent edits', () => {
    const otherHandler = offer({ intent: 'set_factor_value', params: { value: 10 } });
    expect(buildExpiredConstraintRenewal(input({ pendingActions: [otherHandler] })).status).toBe('not_renewed');
    expect(buildExpiredConstraintRenewal(input({ emittedAtIso: OLD_TIME }))).toEqual({ status: 'not_renewed', reason: 'not_expired', matchedExpiredConstraint: false });
    expect(buildExpiredConstraintRenewal(input({ message: 'Set funding to £200,000.' })).status).toBe('not_renewed');
  });

  it('refuses a matching post-offer applied fact', () => {
    const fact = { fact: { fact_type: 'add_constraint', fact_version: 1, noop: false,
      result: { status: 'applied', target_id: 'constraint-id', before: null,
        after: { node_id: 'funding', operator: '>=', value: 1_300_000, unit: '£', label: 'Minimum funding' } } },
      turn_id: 'applied-turn', fact_created_at: '2026-09-19T18:30:00.000Z',
    } as unknown as HandlerFactWithTurn;
    expect(buildExpiredConstraintRenewal(input({ priorFactsWithTurn: [fact] }))).toEqual({ status: 'not_renewed', reason: 'already_applied', matchedExpiredConstraint: true });
  });
});
