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
  derivePendingActivity,
  filterLivePendingActions,
  isPendingActionExpired,
  RESUMABLE_ACTION_TYPES,
  type PendingAction,
  type PendingActionKind,
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

/** A minimal valid live PendingAction for any kind (each kind's required fields). */
function pendingOfKind(kind: PendingActionKind): PendingAction {
  const base = {
    id: `pa_${kind}`,
    scenario_id: 'scn_test',
    chip_id: `chip_${kind}`,
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-03T12:10:00.000Z',
    emitted_at_iso: '2026-07-03T11:59:00.000Z',
  };
  switch (kind) {
    case 'run_analysis':
    case 'what_would_flip':
      return { ...base, action: { kind } };
    case 'draft_graph':
      // C3/C4 (#488): brief_seed optional — minimal valid form is bare.
      return { ...base, action: { kind } };
    case 'set_factor_value':
      return { ...base, action: { kind, factor_id: 'fac_x', value: 1, operator: 'set' } };
    case 'edit_graph_add_risk':
      return { ...base, action: { kind, label: 'Risk' } };
    case 'proposed_concept':
      return {
        ...base,
        action: { kind, concept: 'morale', preferred_kind: 'factor', public_label: 'Add', public_message: 'Add?' },
      };
    case 'apply_proposed_change':
      return {
        ...base,
        chip_id: 'prop_ref_abcdef',
        preconditions: { graph_hash: 'gh' },
        action: {
          kind,
          proposal_ref: 'prop_ref_abcdef',
          inline_patch: { handler_id: 'set_factor_value', params: {}, target_entity_ids: ['fac_x'] },
          public_label: 'Apply',
          public_message: 'Apply?',
        },
      };
  }
}

describe('derivePendingActivity — single ORIENT-time pending tally, per kind', () => {
  it('empty input → all-zero tally', () => {
    expect(derivePendingActivity([], NOW_MS)).toEqual({
      liveCount: 0,
      expiredCount: 0,
      kinds: {},
      confirmationExpectingLiveCount: 0,
    });
  });

  // Table-test EVERY kind's confirmation-expecting contribution in isolation —
  // the kind-scope decision (propose-then-decide only) is proven here directly,
  // independent of routing / the ContextPack serialisation.
  it.each<[PendingActionKind, number]>([
    ['apply_proposed_change', 1],
    ['proposed_concept', 1],
    ['set_factor_value', 0],
    ['edit_graph_add_risk', 0],
    ['run_analysis', 0],
    ['what_would_flip', 0],
  ])('a single live %s → confirmationExpectingLiveCount %d, but always counted live', (kind, expected) => {
    const tally = derivePendingActivity([pendingOfKind(kind)], NOW_MS);
    expect(tally.liveCount).toBe(1);
    expect(tally.kinds[kind]).toBe(1);
    expect(tally.confirmationExpectingLiveCount).toBe(expected);
  });

  it('expired entries are counted as expired, never live or confirmation-expecting', () => {
    const expiredProposal: PendingAction = {
      ...pendingOfKind('apply_proposed_change'),
      expires_at_iso: '2020-01-01T00:00:00.000Z',
    };
    const tally = derivePendingActivity([expiredProposal], NOW_MS);
    expect(tally).toMatchObject({ liveCount: 0, expiredCount: 1, confirmationExpectingLiveCount: 0 });
    expect(tally.kinds).toEqual({});
  });

  it('mixed set: live confirm-expecting + live clarification + expired → correct partition', () => {
    const tally = derivePendingActivity(
      [
        pendingOfKind('proposed_concept'), // live, confirm-expecting
        pendingOfKind('set_factor_value'), // live, NOT confirm-expecting
        { ...pendingOfKind('apply_proposed_change'), expires_at_turn_count: 0 }, // turn-expired
      ],
      NOW_MS,
    );
    expect(tally.liveCount).toBe(2);
    expect(tally.expiredCount).toBe(1);
    expect(tally.confirmationExpectingLiveCount).toBe(1);
    expect(tally.kinds).toEqual({ proposed_concept: 1, set_factor_value: 1 });
  });
});
