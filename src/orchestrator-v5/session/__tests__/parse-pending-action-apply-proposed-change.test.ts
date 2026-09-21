/**
 * V5 G7/G8 — parsePendingAction tightening for apply_proposed_change.
 *
 * Pins the new contract:
 *   - BOTH proposal_ref (≥12 chars) AND inline_patch (plain object)
 *     must be present
 *   - proposal_ref MUST equal the top-level chip_id
 *   - preconditions.graph_hash MUST be a non-empty string
 *   - public_label and public_message MUST be present (legacy entries
 *     may opt out via __legacy_no_public_copy: true)
 *
 * Confirms back-compat:
 *   - run_analysis / what_would_flip / set_factor_value / edit_graph_add_risk
 *     parse unchanged.
 */

import { describe, expect, it } from 'vitest';

import { parsePendingAction } from '../pending-action.js';

const BASE = {
  id: 'pa1',
  scenario_id: 'scn',
  chip_id: 'prop_aaaaaaaaaaaa',
  expires_at_turn_count: 2,
  expires_at_iso: '2099-01-01T00:00:00.000Z',
  emitted_at_iso: '2026-05-07T12:00:00.000Z',
};

describe('parsePendingAction — apply_proposed_change strict contract', () => {
  it('accepts a well-formed apply_proposed_change with both proposal_ref and inline_patch', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: 'Add the cost cap',
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(ok).not.toBeNull();
  });

  it('rejects when proposal_ref is missing (inline_patch alone is not enough)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        inline_patch: { handler_id: 'add_constraint', params: {} },
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when inline_patch is missing (proposal_ref alone is not enough)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when both proposal_ref and inline_patch are absent', () => {
    const out = parsePendingAction({
      ...BASE,
      action: { kind: 'apply_proposed_change' },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when proposal_ref does NOT equal chip_id', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_DIFFERENT_id',
        inline_patch: { handler_id: 'add_constraint', params: {} },
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when proposal_ref is shorter than 12 chars', () => {
    const out = parsePendingAction({
      ...BASE,
      chip_id: 'short',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'short',
        inline_patch: { handler_id: 'add_constraint', params: {} },
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when graph_hash is missing', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: 'Add the cost cap',
        public_message: 'Add the cost cap.',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects when graph_hash is empty', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: 'Add the cost cap',
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: '' },
    });
    expect(out).toBeNull();
  });

  it('rejects when inline_patch is an array (must be a plain object)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: ['handler_id'],
        public_label: 'Add the cost cap',
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when public_label is missing (no legacy opt-out)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when public_message is missing (no legacy opt-out)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: 'Add the cost cap',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('rejects when public_label is an empty string', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: '',
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).toBeNull();
  });

  it('accepts a legacy entry that opts out of public copy with __legacy_no_public_copy: true', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        __legacy_no_public_copy: true,
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(ok).not.toBeNull();
  });
});

describe('parsePendingAction — back-compat', () => {
  it('accepts run_analysis pending action unchanged', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: { kind: 'run_analysis' },
      preconditions: {},
    });
    expect(ok).not.toBeNull();
  });

  it('accepts what_would_flip pending action unchanged', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: { kind: 'what_would_flip' },
      preconditions: { required_freshness: 'fresh' },
    });
    expect(ok).not.toBeNull();
  });

  it('accepts set_factor_value pending action unchanged', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: {
        kind: 'set_factor_value',
        factor_id: 'f1',
        value: 42,
        operator: 'set',
      },
      preconditions: {},
    });
    expect(ok).not.toBeNull();
  });

  it('accepts edit_graph_add_risk pending action unchanged', () => {
    const ok = parsePendingAction({
      ...BASE,
      action: { kind: 'edit_graph_add_risk', label: 'Risk A' },
      preconditions: {},
    });
    expect(ok).not.toBeNull();
  });
});
