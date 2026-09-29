/**
 * V5 Signature Loop — unit tests for the route-level predicates and the
 * extended confirmation / dismissal logic introduced by Fix A + Fix B3.
 *
 *   - `isStateQueryQuestionShape` (behaviour #3 route suppression)
 *   - `PROPOSAL_CONFIRM_PATTERN` additions: try that / test that / update the
 *     model (behaviour #1) and `tryShortConfirmResume` resolving them
 *   - `tryProposalDismissal.dismissed_refs` (Fix B3 — rejected proposals are
 *     excluded from carry-forward so they cannot become zombies)
 */
import { describe, it, expect } from 'vitest';

import { isStateQueryQuestionShape } from '../state-query-guard.js';
import {
  PROPOSAL_CONFIRM_PATTERN,
  tryShortConfirmResume,
} from '../deterministic-short-confirm.js';
import { tryProposalDismissal } from '../proposal-dismissal.js';
import type { PendingAction } from '../../session/pending-action.js';

function liveProposal(ref: string): PendingAction {
  return {
    id: `pa-${ref}`,
    scenario_id: 'sc-pred',
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: 20 },
        target_entity_ids: ['fac-1'],
      },
      public_label: 'Apply the change',
      public_message: 'Apply the change.',
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-06-10T11:59:00.000Z',
  } as PendingAction;
}

describe('isStateQueryQuestionShape — behaviour #3 route suppression', () => {
  it.each([
    'what changed?',
    'What did you just change?',
    'what was updated?',
    'what did that update do?',
    'what update did you make?',
    'did you change it?',
  ])('recognises state-query question "%s"', (m) => {
    expect(isStateQueryQuestionShape(m)).toBe(true);
  });

  it.each([
    'update market demand to 20', // concrete value edit — NOT a question
    'set Revenue to 20',
    'add a constraint below 50000',
    'increase the budget',
    'make that update', // a confirmation, owned by the proposal-confirm path
    'hello',
    'what should I do next?',
  ])('does NOT treat "%s" as a state-query question', (m) => {
    expect(isStateQueryQuestionShape(m)).toBe(false);
  });
});

describe('PROPOSAL_CONFIRM_PATTERN — Signature Loop additions (behaviour #1)', () => {
  it.each([
    'try that',
    'test that',
    'update the model',
    'try the model',
    'test the model',
    'make that update',
    'make that change',
    'apply that',
  ])('matches anchored confirmation phrase "%s"', (m) => {
    expect(PROPOSAL_CONFIRM_PATTERN.test(m)).toBe(true);
  });

  it.each([
    'update the model to include churn', // content after → real edit
    'make that change to pricing',
    'set Revenue to 20',
    'try a different option', // not a proposal confirmation
  ])('does NOT match content-bearing message "%s"', (m) => {
    expect(PROPOSAL_CONFIRM_PATTERN.test(m)).toBe(false);
  });
});

describe('tryShortConfirmResume — new phrases resolve a live proposal', () => {
  it.each(['try that', 'test that', 'update the model'])(
    'resolves "%s" to the pending proposal when one is live',
    (m) => {
      const res = tryShortConfirmResume({
        message: m,
        pendingActions: [liveProposal('prop_a')],
        currentTurnIndex: 1,
        nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      });
      expect(res.matched).toBe(true);
      if (res.matched) {
        expect(res.dispatch).toBe('pending_action');
      }
    },
  );

  it('does NOT resolve "update the model" when no live proposal exists', () => {
    const res = tryShortConfirmResume({
      message: 'update the model',
      pendingActions: [],
      currentTurnIndex: 1,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
    });
    expect(res.matched).toBe(false);
  });
});

describe('tryProposalDismissal — dismissed_refs (Fix B3)', () => {
  it('returns the dismissed proposal refs so carry-forward excludes them', () => {
    const res = tryProposalDismissal({
      message: 'no thanks',
      livePendingActions: [liveProposal('prop_a'), liveProposal('prop_b')],
    });
    expect(res.matched).toBe(true);
    if (res.matched) {
      expect(res.dismissed_count).toBe(2);
      expect([...res.dismissed_refs].sort()).toEqual(['prop_a', 'prop_b']);
    }
  });

  it('does NOT dismiss when a positive token is mixed in ("no, but apply it")', () => {
    const res = tryProposalDismissal({
      message: 'no, but apply it',
      livePendingActions: [liveProposal('prop_a')],
    });
    expect(res.matched).toBe(false);
  });
});
