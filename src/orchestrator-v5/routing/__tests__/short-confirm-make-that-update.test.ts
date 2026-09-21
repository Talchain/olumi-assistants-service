import { describe, it, expect } from 'vitest';
import type { PendingAction } from '../../session/pending-action.js';
import { tryShortConfirmResume } from '../deterministic-short-confirm.js';

// Self-contained apply_proposed_change pending fixture (no shared mocks).
const NOW = Date.parse('2026-06-06T00:00:00.000Z');

function applyProposedPending(overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'pa-1',
    scenario_id: 's1',
    chip_id: 'prop_abc123def456',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'prop_abc123def456',
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: '5%' },
        target_entity_ids: ['factor-churn'],
      },
      public_label: 'Lower churn to 5%',
      public_message: 'Lower the churn factor to 5%.',
    },
    preconditions: { graph_hash: 'h1', target_entity_ids: ['factor-churn'] },
    expires_at_turn_count: 2,
    expires_at_iso: '2026-06-06T00:10:00.000Z',
    emitted_at_iso: '2026-06-06T00:00:00.000Z',
    ...overrides,
  } as PendingAction;
}

describe('short-confirm resume — "make that update" grammar (V5 P0.2 Test 2)', () => {
  it('resumes a live proposal on "make that update" / "make that change" / "do it" / "yes"', () => {
    for (const message of ['make that update', 'Make that change', 'do it', 'go ahead', 'yes', 'apply that update']) {
      const out = tryShortConfirmResume({
        message,
        pendingActions: [applyProposedPending()],
        currentTurnIndex: 1,
        nowMs: NOW,
      });
      expect(out.matched, message).toBe(true);
      if (!out.matched) continue;
      expect(out.dispatch).toBe('pending_action');
      if (out.dispatch !== 'pending_action') continue;
      expect(out.pending.action.kind).toBe('apply_proposed_change');
    }
  });

  it('does NOT hijack a concrete edit / value update even with a live proposal', () => {
    for (const message of ['set pricing to 0.7', 'increase budget to 100k', 'make the budget bigger']) {
      const out = tryShortConfirmResume({
        message,
        pendingActions: [applyProposedPending()],
        currentTurnIndex: 1,
        nowMs: NOW,
      });
      expect(out.matched, message).toBe(false);
    }
  });

  it('does NOT fire "make that update" when there is no live proposal (anti-hijack)', () => {
    const out = tryShortConfirmResume({
      message: 'make that update',
      pendingActions: [],
      currentTurnIndex: 1,
      nowMs: NOW,
    });
    expect(out.matched).toBe(false);
  });

  it('declines an expired proposal rather than resuming it', () => {
    const out = tryShortConfirmResume({
      message: 'make that update',
      pendingActions: [applyProposedPending({ expires_at_iso: '2026-06-06T00:00:00.000Z' })],
      currentTurnIndex: 1,
      nowMs: NOW + 60_000, // one minute past expiry
    });
    // Either recovery_expired or no match — never a silent resume of a stale offer.
    if (out.matched) {
      expect(out.dispatch).toBe('recovery_expired');
    }
  });
});
