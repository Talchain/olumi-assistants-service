/**
 * V5 G7/G8 — proposal dismissal unit tests.
 *
 * Negative-control tests are critical: any message that mixes a
 * dismissal token with a positive intent or edit verb MUST fall
 * through rather than silently dismiss.
 */

import { describe, expect, it } from 'vitest';

import {
  PROPOSAL_DISMISSAL_RESPONSE,
  tryProposalDismissal,
} from '../proposal-dismissal.js';
import type { PendingAction } from '../../session/pending-action.js';

function applyProposed(): PendingAction {
  return {
    id: 'pa1',
    scenario_id: 'scn',
    chip_id: 'prop_aaaaaaaaaaaa',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'prop_aaaaaaaaaaaa',
      inline_patch: { handler_id: 'add_constraint', params: {}, target_entity_ids: [] },
      // Pass-10 P2-1: standard-variant required render copy.
      public_label: 'Label for proposal',
      public_message: 'Message for proposal.',
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-05-07T12:00:00.000Z',
  };
}

function runAnalysis(): PendingAction {
  return {
    id: 'pa2',
    scenario_id: 'scn',
    chip_id: 'chip_run',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-05-07T12:00:00.000Z',
  };
}

describe('tryProposalDismissal — happy path', () => {
  it.each([
    'no',
    'No.',
    'no thanks',
    'nope',
    'cancel',
    'not now',
    'dismiss',
    'skip',
    'not yet',
    'leave it',
  ])('%s dismisses when a live apply_proposed_change exists', (msg) => {
    const out = tryProposalDismissal({
      message: msg,
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(true);
  });

  it('exposes the deterministic response string for the call site', () => {
    expect(PROPOSAL_DISMISSAL_RESPONSE).toBe('OK, no change made.');
  });
});

describe('tryProposalDismissal — negative-control gate', () => {
  it('does NOT dismiss "not now, but add it anyway"', () => {
    const out = tryProposalDismissal({
      message: 'not now, but add it anyway',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });

  it('does NOT dismiss "no, change the value to 200 instead"', () => {
    const out = tryProposalDismissal({
      message: 'no, change the value to 200 instead',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });

  it('does NOT dismiss "cancel that and apply the second one"', () => {
    const out = tryProposalDismissal({
      message: 'cancel that and apply the second one',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });

  it('does NOT dismiss "skip 3" (numeric quantity)', () => {
    const out = tryProposalDismissal({
      message: 'skip 3',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });

  it('does NOT dismiss "no yes"', () => {
    const out = tryProposalDismissal({
      message: 'no yes',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });
});

describe('tryProposalDismissal — gating', () => {
  it('does not match when there is no live apply_proposed_change', () => {
    const out = tryProposalDismissal({
      message: 'no',
      livePendingActions: [runAnalysis()],
    });
    expect(out.matched).toBe(false);
  });

  it('does not match when there are no pending actions', () => {
    const out = tryProposalDismissal({
      message: 'cancel',
      livePendingActions: [],
    });
    expect(out.matched).toBe(false);
  });

  it('does not match a non-dismissal message', () => {
    const out = tryProposalDismissal({
      message: 'tell me more',
      livePendingActions: [applyProposed()],
    });
    expect(out.matched).toBe(false);
  });
});

describe('tryProposalDismissal — response copy safety', () => {
  it('the response string contains no internal vocabulary', () => {
    const forbidden = [
      'apply_proposed_change',
      'pending_actions',
      'proposal_ref',
      'chip_metadata',
      'zod',
      'STRUCTURAL_VALIDATION_FAILED',
      '—', // em dash
      '&',
    ];
    for (const token of forbidden) {
      expect(PROPOSAL_DISMISSAL_RESPONSE).not.toContain(token);
    }
  });
});
