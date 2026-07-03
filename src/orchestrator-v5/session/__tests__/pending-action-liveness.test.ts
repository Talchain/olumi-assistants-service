/**
 * Track 2 — single liveness authority for pending actions.
 *
 * These tests pin the shared read-time expiry predicate the ContextPack /
 * canonical-frame `pending_confirmation` derivation, the short-confirm
 * resumer, and the route-level proposal-confirm suppressor all rely on.
 * They are deliberately discriminating: a naive "any persisted entry is
 * pending" implementation (`length > 0`) fails the expired cases.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  filterLivePendingActions,
  isPendingActionExpired,
  RESUMABLE_ACTION_TYPES,
  type PendingAction,
} from '../pending-action.js';

const NOW_MS = Date.parse('2026-07-03T12:00:00.000Z');

function makePending(overrides: {
  expires_at_iso?: string;
  expires_at_turn_count?: number;
  kind?: 'run_analysis' | 'what_would_flip';
}): PendingAction {
  return {
    id: 'pa_test_1',
    scenario_id: 'scn_test',
    chip_id: 'chip_test_1',
    action: { kind: overrides.kind ?? 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: overrides.expires_at_turn_count ?? 2,
    expires_at_iso: overrides.expires_at_iso ?? '2026-07-03T12:10:00.000Z',
    emitted_at_iso: '2026-07-03T11:59:00.000Z',
  };
}

describe('isPendingActionExpired — single read-time liveness authority', () => {
  it('a pending action inside both TTLs is live', () => {
    expect(isPendingActionExpired(makePending({}), NOW_MS)).toBe(false);
  });

  it('wall-clock past expires_at_iso → expired', () => {
    const pa = makePending({ expires_at_iso: '2026-07-03T11:59:59.999Z' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('exactly at expires_at_iso → still live (nowMs > expiresMs is the cut)', () => {
    const pa = makePending({ expires_at_iso: '2026-07-03T12:00:00.000Z' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(false);
  });

  it('malformed expires_at_iso → expired (fail-closed)', () => {
    const pa = makePending({ expires_at_iso: 'not-a-timestamp' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('expires_at_turn_count of 0 → expired (defence-in-depth against carry-forward bypass)', () => {
    const pa = makePending({ expires_at_turn_count: 0 });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('negative expires_at_turn_count → expired', () => {
    const pa = makePending({ expires_at_turn_count: -1 });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });
});

describe('filterLivePendingActions', () => {
  it('keeps live entries, drops expired ones, preserves order', () => {
    const live1 = makePending({ kind: 'run_analysis' });
    const wallExpired = makePending({ expires_at_iso: '2026-07-03T11:00:00.000Z' });
    const live2 = makePending({ kind: 'what_would_flip' });
    const turnExpired = makePending({ expires_at_turn_count: 0 });
    const out = filterLivePendingActions([live1, wallExpired, live2, turnExpired], NOW_MS);
    expect(out).toEqual([live1, live2]);
  });

  it('empty input → empty output', () => {
    expect(filterLivePendingActions([], NOW_MS)).toEqual([]);
  });
});

describe('CONFIRMATION_EXPECTING_ACTION_TYPES — propose-then-decide kinds only', () => {
  it('contains exactly the two propose-then-decide kinds', () => {
    expect([...CONFIRMATION_EXPECTING_ACTION_TYPES].sort()).toEqual([
      'apply_proposed_change',
      'proposed_concept',
    ]);
  });

  it('excludes the clarification-continuation kinds (change already decided; target-disambiguation pending)', () => {
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('set_factor_value')).toBe(false);
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('edit_graph_add_risk')).toBe(false);
  });

  it('excludes the chip suggestion offers', () => {
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('run_analysis')).toBe(false);
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('what_would_flip')).toBe(false);
  });

  it('is a strict subset of the resumable kinds', () => {
    for (const kind of CONFIRMATION_EXPECTING_ACTION_TYPES) {
      expect(RESUMABLE_ACTION_TYPES.has(kind)).toBe(true);
    }
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.size).toBeLessThan(RESUMABLE_ACTION_TYPES.size);
  });
});
