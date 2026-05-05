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

import { tryShortConfirmResume } from '../deterministic-short-confirm.js';
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
    ['yes!', true],
    ['  yes.  ', true],
    ['yes please', false], // not in the canonical pattern; users can extend later
    ['no', false],
    ['', false],
    [' ', false],
    ['kinda', false],
    // edit-verb gate
    ['yes increase the budget', false],
    ['set the value to 5', false],
    ['ok update factor X', false],
    ['confirm 30%', false], // numeric content gate
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
  it('returns all_expired when wall TTL has passed', () => {
    const expired = makeRunAnalysisPending({
      expires_at_iso: '2026-05-05T11:50:00.000Z', // 10 min before NOW_MS
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [expired],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_expired' });
  });

  it('returns all_expired when turn-count TTL is zero', () => {
    const expired = makeRunAnalysisPending({ expires_at_turn_count: 0 });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [expired],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_expired' });
  });

  it('treats malformed expires_at_iso as expired (defence-in-depth)', () => {
    const malformed = makeRunAnalysisPending({ expires_at_iso: 'not-a-date' });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [malformed],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_expired' });
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

  it('falls through to LLM when the only pending action is a kind not yet wired (e.g. what_would_flip)', () => {
    // Wave 2 wires only run_analysis. Other kinds are persisted but
    // don't yet have a synthesis path; the resumer must NOT misfire
    // them.
    const wwf = makeRunAnalysisPending({
      action: { kind: 'what_would_flip' },
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [wwf],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'kind_not_yet_resumable' });
  });

  it('returns multiple_ambiguous when more than one resumable pending action is live', () => {
    const a = makeRunAnalysisPending({ id: 'pa-1', chip_id: 'c1' });
    const b = makeRunAnalysisPending({ id: 'pa-2', chip_id: 'c2' });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [a, b],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'multiple_ambiguous' });
  });

  it('picks the resumable kind when only one of multiple pending actions is wave-2 resumable', () => {
    const wwf = makeRunAnalysisPending({
      id: 'pa-wwf',
      action: { kind: 'what_would_flip' },
    });
    const ra = makeRunAnalysisPending({ id: 'pa-ra' });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [wwf, ra],
      currentTurnIndex: 1,
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.pending.id).toBe('pa-ra');
      expect(r.pending.action.kind).toBe('run_analysis');
    }
  });
});
