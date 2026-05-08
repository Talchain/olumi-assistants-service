/**
 * V5 G7/G8 — emitProposedChange unit tests.
 *
 * Asserts:
 *   - stable proposal id derivation (sha256 → `prop_<12-hex>`)
 *   - id varies on input changes (intent, params, scenario_id, hash)
 *   - chip and pending action both produced in one call (atomic-emit
 *     contract precondition — the commit layer joins them in one
 *     `append_turn_atomic` row)
 *   - proposal_ref === chip.id (locks Step 2 to Step 3 dependency)
 *   - chip passes the strict boundary `ActionSchema.parse`
 *   - safety-string filter rejects forbidden tokens in label / message
 *   - unknown intent rejected when the registry has no handler
 *   - TTL fields use existing PENDING_ACTION_DEFAULT_* constants
 */

import { describe, expect, it } from 'vitest';

import { ActionSchema } from '@talchain/schemas/boundary';

import { computeProposalId, emitProposedChange } from '../proposed-change.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  parsePendingAction,
} from '../../session/pending-action.js';
import { EMPTY_HANDLER_REGISTRY, getDefaultRegistry } from '../../tools/registry.js';
import type {
  ProposedChange,
  ProposedChangeContext,
} from '../../types/proposed-change.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const GRAPH_HASH = 'aaaaaaaaaaaa1234';
const EMITTED_AT_ISO = '2026-05-07T12:00:00.000Z';

function makeProposal(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    intent: 'add_constraint',
    label: 'Add the cost cap',
    message: 'Add the cost cap.',
    params: { value: 100, unit: 'GBP' },
    target_entity_ids: ['node_cost'],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ProposedChangeContext> = {}): ProposedChangeContext {
  return {
    scenario_id: SCENARIO_ID,
    graph_hash: GRAPH_HASH,
    emitted_at_iso: EMITTED_AT_ISO,
    registry: getDefaultRegistry(),
    ...overrides,
  };
}

describe('emitProposedChange — proposal id stability', () => {
  it('produces a stable id of the form prop_<12-hex> for the same inputs', () => {
    const a = emitProposedChange(makeProposal(), makeCtx());
    const b = emitProposedChange(makeProposal(), makeCtx());
    expect(a.status).toBe('success');
    expect(b.status).toBe('success');
    if (a.status !== 'success' || b.status !== 'success') return;
    expect(a.chip.id).toBe(b.chip.id);
    expect(a.chip.id).toMatch(/^prop_[0-9a-f]{12}$/);
  });

  it('id varies when intent changes', () => {
    const a = emitProposedChange(makeProposal({ intent: 'add_constraint' }), makeCtx());
    const b = emitProposedChange(makeProposal({ intent: 'set_factor_value' }), makeCtx());
    if (a.status !== 'success' || b.status !== 'success') throw new Error('both should succeed');
    expect(a.chip.id).not.toBe(b.chip.id);
  });

  it('id varies when params change', () => {
    const a = emitProposedChange(makeProposal({ params: { value: 100 } }), makeCtx());
    const b = emitProposedChange(makeProposal({ params: { value: 200 } }), makeCtx());
    if (a.status !== 'success' || b.status !== 'success') throw new Error('both should succeed');
    expect(a.chip.id).not.toBe(b.chip.id);
  });

  it('id varies when scenario_id changes', () => {
    const a = emitProposedChange(makeProposal(), makeCtx());
    const b = emitProposedChange(
      makeProposal(),
      makeCtx({ scenario_id: '22222222-2222-4222-8222-222222222222' }),
    );
    if (a.status !== 'success' || b.status !== 'success') throw new Error('both should succeed');
    expect(a.chip.id).not.toBe(b.chip.id);
  });

  it('id varies when graph_hash changes', () => {
    const a = emitProposedChange(makeProposal(), makeCtx());
    const b = emitProposedChange(makeProposal(), makeCtx({ graph_hash: 'bbbbbbbbbbbb1234' }));
    if (a.status !== 'success' || b.status !== 'success') throw new Error('both should succeed');
    expect(a.chip.id).not.toBe(b.chip.id);
  });

  it('id is independent of param key ordering (canonicalised)', () => {
    const a = emitProposedChange(
      makeProposal({ params: { value: 100, unit: 'GBP' } }),
      makeCtx(),
    );
    const b = emitProposedChange(
      makeProposal({ params: { unit: 'GBP', value: 100 } }),
      makeCtx(),
    );
    if (a.status !== 'success' || b.status !== 'success') throw new Error('both should succeed');
    expect(a.chip.id).toBe(b.chip.id);
  });
});

describe('emitProposedChange — chip / pending coupling', () => {
  it('produces both a chip and a pending action; proposal_ref === chip.id', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    expect(out.chip.id).toMatch(/^prop_[0-9a-f]{12}$/);
    expect(out.pending.action.kind).toBe('apply_proposed_change');
    if (out.pending.action.kind !== 'apply_proposed_change') return;
    expect(out.pending.action.proposal_ref).toBe(out.chip.id);
    expect(out.pending.chip_id).toBe(out.chip.id);
  });

  it('chip passes the strict boundary ActionSchema.parse', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    expect(() => ActionSchema.parse(out.chip)).not.toThrow();
  });

  it('uses an allowed wire ActionType literal mapped from intent', () => {
    const a = emitProposedChange(makeProposal({ intent: 'add_constraint' }), makeCtx());
    const b = emitProposedChange(makeProposal({ intent: 'set_factor_value' }), makeCtx());
    const c = emitProposedChange(makeProposal({ intent: 'adjust_edge_strength' }), makeCtx());
    if (a.status !== 'success' || b.status !== 'success' || c.status !== 'success') {
      throw new Error('all should succeed');
    }
    expect(a.chip.action_type).toBe('add_constraint');
    expect(b.chip.action_type).toBe('set_factor_value');
    expect(c.chip.action_type).toBe('adjust_edge_strength');
  });

  it('pending action carries inline_patch with handler_id, params, target_entity_ids', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    if (out.pending.action.kind !== 'apply_proposed_change') return;
    const ip = out.pending.action.inline_patch;
    expect(ip).toBeDefined();
    expect((ip as Record<string, unknown>).handler_id).toBe('add_constraint');
    expect((ip as Record<string, unknown>).params).toEqual({ value: 100, unit: 'GBP' });
    expect((ip as Record<string, unknown>).target_entity_ids).toEqual(['node_cost']);
  });

  it('preconditions carry the emit-time graph_hash and target_entity_ids', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    expect(out.pending.preconditions.graph_hash).toBe(GRAPH_HASH);
    expect(out.pending.preconditions.target_entity_ids).toEqual(['node_cost']);
  });

  it('uses default TTL constants', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    expect(out.pending.expires_at_turn_count).toBe(PENDING_ACTION_DEFAULT_TURN_TTL);
    const expectedIso = new Date(
      Date.parse(EMITTED_AT_ISO) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
    ).toISOString();
    expect(out.pending.expires_at_iso).toBe(expectedIso);
  });
});

describe('emitProposedChange — safety filter', () => {
  it('refuses to emit when label contains a forbidden token', () => {
    const out = emitProposedChange(
      makeProposal({ label: 'Trigger apply_proposed_change now' }),
      makeCtx(),
    );
    expect(out.status).toBe('unsafe_copy');
    if (out.status !== 'unsafe_copy') return;
    expect(out.field).toBe('label');
    expect(out.forbidden_token).toBe('apply_proposed_change');
  });

  it('refuses to emit when message contains an em dash', () => {
    const out = emitProposedChange(
      makeProposal({ message: 'Add the cap — like before' }),
      makeCtx(),
    );
    expect(out.status).toBe('unsafe_copy');
    if (out.status !== 'unsafe_copy') return;
    expect(out.field).toBe('message');
  });

  it('refuses to emit when label leaks pending_actions vocabulary', () => {
    const out = emitProposedChange(
      makeProposal({ label: 'Add to pending_actions' }),
      makeCtx(),
    );
    expect(out.status).toBe('unsafe_copy');
  });
});

describe('emitProposedChange — unknown intent gating', () => {
  it('returns unknown_intent when the registry has no handler', () => {
    const out = emitProposedChange(makeProposal(), makeCtx({ registry: EMPTY_HANDLER_REGISTRY }));
    expect(out.status).toBe('unknown_intent');
    if (out.status !== 'unknown_intent') return;
    expect(out.intent).toBe('add_constraint');
  });
});

describe('computeProposalId — target_entity_ids participate in the hash (P0-1)', () => {
  it('two proposals identical except for targets produce DIFFERENT ids', () => {
    const a = computeProposalId({
      scenario_id: SCENARIO_ID,
      intent: 'add_constraint',
      params: { value: 100 },
      graph_hash: GRAPH_HASH,
      target_entity_ids: ['node_x'],
    });
    const b = computeProposalId({
      scenario_id: SCENARIO_ID,
      intent: 'add_constraint',
      params: { value: 100 },
      graph_hash: GRAPH_HASH,
      target_entity_ids: ['node_y'],
    });
    expect(a).not.toBe(b);
  });

  it('target order does not affect the id (sorted before hashing)', () => {
    const a = computeProposalId({
      scenario_id: SCENARIO_ID,
      intent: 'add_constraint',
      params: { value: 100 },
      graph_hash: GRAPH_HASH,
      target_entity_ids: ['node_a', 'node_b'],
    });
    const b = computeProposalId({
      scenario_id: SCENARIO_ID,
      intent: 'add_constraint',
      params: { value: 100 },
      graph_hash: GRAPH_HASH,
      target_entity_ids: ['node_b', 'node_a'],
    });
    expect(a).toBe(b);
  });

  it('emit-time same-everything-but-targets produces distinct chip ids and pending actions', () => {
    const aOut = emitProposedChange(
      { ...makeProposal(), target_entity_ids: ['node_x'] },
      makeCtx(),
    );
    const bOut = emitProposedChange(
      { ...makeProposal(), target_entity_ids: ['node_y'] },
      makeCtx(),
    );
    if (aOut.status !== 'success' || bOut.status !== 'success') {
      throw new Error('both should succeed');
    }
    expect(aOut.chip.id).not.toBe(bOut.chip.id);
    expect(aOut.pending.chip_id).not.toBe(bOut.pending.chip_id);
    if (aOut.pending.action.kind !== 'apply_proposed_change') return;
    if (bOut.pending.action.kind !== 'apply_proposed_change') return;
    expect(aOut.pending.action.proposal_ref).not.toBe(bOut.pending.action.proposal_ref);
  });
});

describe('emitProposedChange — production invariant (always emits required fields)', () => {
  // Pins the production-path contract: every emitProposedChange success
  // produces an apply_proposed_change pending action with proposal_ref,
  // inline_patch, public_label, public_message, AND
  // preconditions.graph_hash. Independently of caller-supplied label
  // shapes, the invariant must hold.
  it.each([
    'add_constraint' as const,
    'set_factor_value' as const,
    'adjust_edge_strength' as const,
  ])('intent %s emits all required fields', (intent) => {
    const out = emitProposedChange(makeProposal({ intent }), makeCtx());
    expect(out.status).toBe('success');
    if (out.status !== 'success') return;
    expect(out.pending.action.kind).toBe('apply_proposed_change');
    if (out.pending.action.kind !== 'apply_proposed_change') return;
    // Required fields per the parser contract.
    expect(out.pending.action.proposal_ref).toBeDefined();
    expect(typeof out.pending.action.proposal_ref).toBe('string');
    expect(out.pending.action.proposal_ref!.length).toBeGreaterThanOrEqual(12);
    expect(out.pending.action.inline_patch).toBeDefined();
    expect(typeof out.pending.action.inline_patch).toBe('object');
    expect(out.pending.action.public_label).toBeDefined();
    expect(typeof out.pending.action.public_label).toBe('string');
    expect(out.pending.action.public_label!.length).toBeGreaterThan(0);
    expect(out.pending.action.public_message).toBeDefined();
    expect(typeof out.pending.action.public_message).toBe('string');
    expect(out.pending.action.public_message!.length).toBeGreaterThan(0);
    // graph_hash precondition is mandatory for the synthesis path.
    expect(out.pending.preconditions.graph_hash).toBeDefined();
    expect(typeof out.pending.preconditions.graph_hash).toBe('string');
    expect(out.pending.preconditions.graph_hash!.length).toBeGreaterThan(0);
  });

  it('NEVER emits __legacy_no_public_copy on the production path', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    // __legacy_no_public_copy is a read-time opt-out for legacy entries
    // only — emitProposedChange must not set it. Both deep checks.
    expect((out.pending.action as Record<string, unknown>).__legacy_no_public_copy).toBeUndefined();
    expect(JSON.stringify(out.pending)).not.toContain('__legacy_no_public_copy');
  });

  it('the emitted pending action round-trips through parsePendingAction without legacy opt-out', () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');
    // The parser is the boundary contract — it must accept what we
    // emit without falling back on the legacy flag.
    const cloned = JSON.parse(JSON.stringify(out.pending));
    expect(cloned.action.__legacy_no_public_copy).toBeUndefined();
    // parsePendingAction is the boundary contract — it must accept
    // the emitted pending action without falling back on the legacy
    // flag.
    expect(parsePendingAction(cloned)).not.toBeNull();
  });
});

describe('emitProposedChange — case-insensitive + handler-id safety filter (P1-2)', () => {
  it.each([
    'APPLY_PROPOSED_CHANGE',
    'Pending_Actions',
    'pending_actions',
    'add_constraint',
    'set_factor_value',
    'adjust_edge_strength',
    'run_analysis',
    'what_would_flip',
    'prop_abc',
    'chip_action',
  ])('rejects label containing forbidden token "%s"', (token) => {
    const out = emitProposedChange(
      { ...makeProposal(), label: `Trigger ${token} now` },
      makeCtx(),
    );
    expect(out.status).toBe('unsafe_copy');
  });
});
