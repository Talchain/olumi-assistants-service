/**
 * Unit tests for the deterministic short-confirm pre-route.
 *
 * Covers:
 *   - regex matrix (positive + negative edit-verb gate)
 *   - empty / non-matching / expired / kind-not-yet-resumable / ambiguous fall-through
 *   - exactly-one valid pending action returns the matched dispatch
 *   - older orphan pending actions are ignored (input scope: the
 *     resumer only sees the most recent prior turn's pending_actions —
 *     the read-side narrowing happens in
 *     `SessionStore.readMostRecentPendingActions`)
 */

import { describe, expect, it } from 'vitest';

import {
  scopePendingsToChipClickIntent,
  tryShortConfirmResume,
} from '../deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_MS = Date.parse('2026-05-05T12:00:00.000Z');

function makeRunAnalysisPending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 'pa-run-analysis-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-run-analysis-1',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2026-05-05T12:10:00.000Z', // 10 min after NOW_MS
    emitted_at_iso: '2026-05-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('tryShortConfirmResume — regex matrix', () => {
  const livePending = [makeRunAnalysisPending()];
  const baseInput = {
    pendingActions: livePending,
    currentTurnIndex: 1,
    nowMs: NOW_MS,
  };

  it.each([
    ['yes', true],
    ['Yes', true],
    ['YES', true],
    ['yep', true],
    ['yeah', true],
    ['sure', true],
    ['ok', true],
    ['okay', true],
    ['do it', true],
    ['do that', true],
    ['go ahead', true],
    ['apply', true],
    ['apply it', true],
    ['confirmed', true],
    ['please do', true],
    ['yes please', true],
    ['yes thanks', true],
    ['ok thanks', true],
    ['yeah ok', true],
    ['sure now', true],
    ['yes do it', true],
    ['yes!', true],
    ['  yes.  ', true],
    ['no', false],
    ['', false],
    [' ', false],
    ['kinda', false],
    // edit-verb gate
    ['yes increase the budget', false],
    ['set the value to 5', false],
    ['ok update factor X', false],
    ['confirm 30%', false],
    ['yeah and lower the bar', false],
  ])('message=%j → matched=%j', (msg, expected) => {
    const r = tryShortConfirmResume({ message: msg, ...baseInput });
    expect(r.matched).toBe(expected);
  });
});

describe('tryShortConfirmResume — empty / fall-through cases', () => {
  it('returns no_pending when pending_actions is empty', () => {
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending' });
  });

  it('returns no_short_confirm for non-confirmation messages', () => {
    const r = tryShortConfirmResume({
      message: 'why is this close?',
      pendingActions: [makeRunAnalysisPending()],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_short_confirm' });
  });

  it('returns no_short_confirm when the message has an edit verb', () => {
    const r = tryShortConfirmResume({
      message: 'yes please increase it',
      pendingActions: [makeRunAnalysisPending()],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_short_confirm' });
  });
});

describe('tryShortConfirmResume — invalidation', () => {
  it('returns recovery_expired when wall TTL has passed', () => {
    const expired = makeRunAnalysisPending({
      expires_at_iso: '2026-05-05T11:50:00.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [expired],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_expired', expired_count: 1 });
  });

  it('returns recovery_expired when turn-count TTL is zero', () => {
    const expired = makeRunAnalysisPending({ expires_at_turn_count: 0 });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [expired],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_expired', expired_count: 1 });
  });

  it('treats malformed expires_at_iso as expired (defence-in-depth)', () => {
    const malformed = makeRunAnalysisPending({ expires_at_iso: 'not-a-date' });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [malformed],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_expired', expired_count: 1 });
  });
});

describe('tryShortConfirmResume — dispatch', () => {
  it('returns the matched pending action when exactly one is live and resumable', () => {
    const pa = makeRunAnalysisPending();
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [pa],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: true, dispatch: 'pending_action', pending: pa });
  });

  it('falls through to LLM when the only pending action is a kind without a synthesis path (e.g. set_factor_value)', () => {
    const sfv = makeRunAnalysisPending({
      action: {
        kind: 'set_factor_value',
        factor_id: 'f1',
        value: 0.3,
        operator: 'set',
      },
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [sfv],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'kind_not_yet_resumable' });
  });

  it('picks the MOST RECENTLY EMITTED resumable pending action when more than one is live (V5 P0.2 most-recent-wins)', () => {
    // V5 P0.2 — deliberate behaviour change: most-recent-wins REPLACES
    // the prior `recovery_ambiguous` clarification round-trip. A bare
    // "yes" against multiple live resumable pendings resumes the LATEST
    // offer rather than asking which one. The turn-executor echoes the
    // chosen proposal's label so a wrong-target resume stays visible.
    const older = makeRunAnalysisPending({
      id: 'pa-1',
      chip_id: 'c1',
      emitted_at_iso: '2026-05-05T11:58:00.000Z',
    });
    const newer = makeRunAnalysisPending({
      id: 'pa-2',
      chip_id: 'c2',
      emitted_at_iso: '2026-05-05T11:59:30.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [older, newer],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-2');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('most-recent-wins is order-independent: the newest wins even when listed first', () => {
    // Defence-in-depth: the selection must depend on emitted_at_iso, not
    // on array position (the read-side order is not guaranteed).
    const newer = makeRunAnalysisPending({
      id: 'pa-new',
      chip_id: 'c-new',
      emitted_at_iso: '2026-05-05T11:59:30.000Z',
    });
    const older = makeRunAnalysisPending({
      id: 'pa-old',
      chip_id: 'c-old',
      emitted_at_iso: '2026-05-05T11:58:00.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [newer, older],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-new');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('picks the resumable kind when only one of multiple pending actions has a synthesis path', () => {
    const sfv = makeRunAnalysisPending({
      id: 'pa-sfv',
      action: {
        kind: 'set_factor_value',
        factor_id: 'f1',
        value: 0.3,
        operator: 'set',
      },
    });
    const ra = makeRunAnalysisPending({ id: 'pa-ra' });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [sfv, ra],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-ra');
      expect(r.pending.action.kind).toBe('run_analysis');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('what_would_flip with fresh analysis dispatches as pending_action', () => {
    const wwf = makeRunAnalysisPending({
      id: 'pa-wwf',
      action: { kind: 'what_would_flip' },
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [wwf],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
      analysisFreshness: 'fresh',
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.action.kind).toBe('what_would_flip');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('what_would_flip with stale analysis downgrades to rerun_analysis_required', () => {
    const wwf = makeRunAnalysisPending({
      id: 'pa-wwf',
      action: { kind: 'what_would_flip' },
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [wwf],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
      analysisFreshness: 'stale',
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'rerun_analysis_required') {
      expect(r.pending.action.kind).toBe('what_would_flip');
    } else {
      throw new Error(`expected rerun_analysis_required dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('returns no_pending skip_reason when pendingActions is empty (chip-click no-pending recovery prerequisite)', () => {
    // Wave 5d safety net: TurnExecutor's no-pending recovery for
    // chip-click ingresses depends on tryShortConfirmResume returning
    // skip_reason='no_pending' when the most-recent pending list is
    // empty. The recovery synthesises a focused rerun-analysis chip
    // instead of letting "yes" reach the LLM. Pin the contract here
    // so a future change to the resumer cannot silently flip the
    // skip_reason and break the no-pending branch.
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending' });
  });

  it('what_would_flip with unknown analysis freshness also downgrades (defence-in-depth)', () => {
    const wwf = makeRunAnalysisPending({
      id: 'pa-wwf',
      action: { kind: 'what_would_flip' },
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [wwf],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
      // analysisFreshness omitted — defaults to 'unknown'
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.dispatch).toBe('rerun_analysis_required');
    }
  });
});

// ---------------------------------------------------------------------------
// F-HELD consent-priority (2026-07-11 wire finding; orchestrator ruling:
// consent-first, orchestrator-default pending Paul ratification). A bare
// confirm answers the live CONSENT-EXPECTING pending (apply_proposed_change),
// not the newest chip suggestion — wire captures 13c→14c show "yes" binding
// to a freshly-minted run_analysis offer while a GM hold was still live, so
// the held factor was never applied.
// ---------------------------------------------------------------------------

describe('tryShortConfirmResume — F-HELD consent-priority', () => {
  function makeHoldPending(overrides: Partial<PendingAction> = {}): PendingAction {
    return {
      id: 'pa-hold-1',
      scenario_id: SCENARIO_ID,
      chip_id: 'gmh_abcdef123456',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'gmh_abcdef123456',
        inline_patch: {
          handler_id: 'graph_management_held_v1',
          params: {},
          target_entity_ids: [],
        },
        public_label: 'Continue with this change',
        public_message: 'Yes',
      },
      preconditions: { graph_hash: 'hash_a' },
      expires_at_turn_count: 4,
      expires_at_iso: '2026-05-05T12:10:00.000Z', // 10 min after NOW_MS
      emitted_at_iso: '2026-05-05T11:58:00.000Z',
      ...overrides,
    };
  }

  it('bare "yes" resumes the LIVE HOLD even when a NEWER run_analysis chip pending is live (wire 13c→14c shape)', () => {
    const hold = makeHoldPending();
    const newerChip = makeRunAnalysisPending({
      id: 'pa-ra-newer',
      chip_id: 'chip_action_rerun_analysis',
      emitted_at_iso: '2026-05-05T11:59:30.000Z', // newer than the hold
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [newerChip, hold],
      currentTurnIndex: 3,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-hold-1');
      expect(r.pending.action.kind).toBe('apply_proposed_change');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('consent-priority is order-independent (hold listed first)', () => {
    const hold = makeHoldPending();
    const newerChip = makeRunAnalysisPending({
      id: 'pa-ra-newer',
      chip_id: 'chip_action_rerun_analysis',
      emitted_at_iso: '2026-05-05T11:59:30.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [hold, newerChip],
      currentTurnIndex: 3,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-hold-1');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('CONSENT-CLARITY AMENDMENT: two live holds + bare "yes" → recovery_ambiguous listing BOTH (supersedes most-recent-wins within the consent class)', () => {
    const olderHold = makeHoldPending({
      id: 'pa-hold-old',
      chip_id: 'gmh_older0000001',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'gmh_older0000001',
        inline_patch: { handler_id: 'graph_management_held_v1', params: {}, target_entity_ids: [] },
        public_label: 'Continue with this change',
        public_message: 'Yes',
      },
      emitted_at_iso: '2026-05-05T11:57:00.000Z',
    });
    const newerHold = makeHoldPending({
      id: 'pa-hold-new',
      chip_id: 'gmh_newer0000001',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'gmh_newer0000001',
        inline_patch: { handler_id: 'graph_management_held_v1', params: {}, target_entity_ids: [] },
        public_label: 'Continue with this change',
        public_message: 'Yes',
      },
      emitted_at_iso: '2026-05-05T11:59:00.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [olderHold, newerHold],
      currentTurnIndex: 3,
      nowMs: NOW_MS,
    });
    // Ratified doctrine (Paul, 2026-07-11): a bare confirm with MULTIPLE
    // live consent-expecting pendings must never silently pick one — the
    // executor lists them and the user resolves by number / chip / "all".
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'recovery_ambiguous') {
      expect(r.candidates.map((c) => c.id)).toEqual(['pa-hold-old', 'pa-hold-new']);
    } else {
      throw new Error(`expected recovery_ambiguous dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('an EXPIRED hold does not outrank a live chip suggestion (liveness first, then class)', () => {
    const expiredHold = makeHoldPending({
      expires_at_iso: '2026-05-05T11:50:00.000Z', // wall-expired at NOW_MS
    });
    const liveChip = makeRunAnalysisPending({
      id: 'pa-ra-live',
      emitted_at_iso: '2026-05-05T11:59:30.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [expiredHold, liveChip],
      currentTurnIndex: 3,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-ra-live');
      expect(r.pending.action.kind).toBe('run_analysis');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// F-HELD round 2, FIXUP 1 — intent-vs-kind guard for chip-click resumes.
// A chip click carries an EXPLICIT intent (route-v2 detectChipClickResumeIntent
// → TurnExecutor synthesises "yes"); without scoping, consent-priority would
// resolve that synthetic "yes" to a live hold and EXECUTE a held mutation off
// an explanation click. The scope helper narrows the candidate set to the
// clicked kind BEFORE the resumer runs; typed "yes" (no intent) is unscoped.
// ---------------------------------------------------------------------------

describe('scopePendingsToChipClickIntent — chip-click intent-vs-kind guard (F-HELD round 2)', () => {
  function hold(): PendingAction {
    return {
      id: 'pa-hold-guard',
      scenario_id: SCENARIO_ID,
      chip_id: 'gmh_guard00000001',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'gmh_guard00000001',
        inline_patch: { handler_id: 'graph_management_held_v1', params: {}, target_entity_ids: [] },
        public_label: 'Continue with this change',
        public_message: 'Yes',
      },
      preconditions: { graph_hash: 'hash_a' },
      expires_at_turn_count: 4,
      expires_at_iso: '2026-05-05T12:10:00.000Z',
      emitted_at_iso: '2026-05-05T11:58:00.000Z',
    };
  }
  function wwf(): PendingAction {
    return makeRunAnalysisPending({
      id: 'pa-wwf-guard',
      chip_id: 'chip_action_wwf_guard',
      action: { kind: 'what_would_flip' },
      emitted_at_iso: '2026-05-05T11:57:00.000Z', // OLDER than the hold
    });
  }

  it('scopes to what_would_flip pendings when the chip-click intent is what_would_flip', () => {
    const scoped = scopePendingsToChipClickIntent([hold(), wwf()], 'what_would_flip');
    expect(scoped.map((pa) => pa.action.kind)).toEqual(['what_would_flip']);
  });

  it('is the identity for typed confirmations (no intent) — consent-priority untouched', () => {
    const all = [hold(), wwf()];
    expect(scopePendingsToChipClickIntent(all, undefined)).toBe(all);
  });

  it('RED F-HELD regression: a wwf CHIP CLICK with a live hold resumes the WWF pending, never the hold', () => {
    // The exact hijack chain: synthetic "yes" + unscoped pendings would let
    // consent-priority pick the hold. With the scope applied first, the
    // resumer only ever sees the clicked kind.
    const scoped = scopePendingsToChipClickIntent([hold(), wwf()], 'what_would_flip');
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: scoped,
      currentTurnIndex: 3,
      nowMs: NOW_MS,
      analysisFreshness: 'fresh',
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'pending_action') {
      expect(r.pending.id).toBe('pa-wwf-guard');
      expect(r.pending.action.kind).toBe('what_would_flip');
    } else {
      throw new Error(`expected pending_action dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('wwf chip click with ONLY a hold live scopes to empty → no_pending (the chip-click no-pending recovery owns it)', () => {
    const scoped = scopePendingsToChipClickIntent([hold()], 'what_would_flip');
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: scoped,
      currentTurnIndex: 3,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending' });
  });
});
