/**
 * R2918B — THE QUESTION-CONTEXT GATE, widened to "sole among all live asks a
 * BARE NUMBER could be answering".
 *
 * WHY THIS SUITE EXISTS. `findSoleLiveElicitBaselinePending` is what licenses
 * the elliptical grammar to bind a subject-less answer to the baseline
 * question's target. As shipped it filtered to `elicit_target_baseline` FIRST
 * and only then checked "exactly one" — so a live ask of a DIFFERENT kind did
 * not block it, and a bare number bound to the baseline question regardless of
 * which question the user was actually answering. That was already wrong with
 * "12%"; once a bare "30" is an answer it is much easier to reach, because the
 * other number-asking kinds ("give me a number from 0 to 1", "which of these
 * does your number belong to?") take bare numbers too.
 *
 * The gate now refuses whenever more than one live pending could claim a bare
 * number. Kinds that can only be answered by a confirmation ("Run the
 * analysis") do NOT block it: a bare "yes" answers no percent question, which
 * is the same reasoning `CONFIRMATION_EXPECTING_ACTION_TYPES` already records.
 */

import { describe, expect, it } from 'vitest';

import {
  findSoleLiveElicitBaselinePending,
  PENDING_KIND_CLAIMS_BARE_NUMBER,
  RESUMABLE_ACTION_TYPES,
  type PendingAction,
  type PendingActionAction,
  type PendingActionKind,
} from '../pending-action.js';

const NOW_MS = Date.parse('2026-08-30T12:00:00.000Z');

const BASELINE_ACTION: PendingActionAction = {
  kind: 'elicit_target_baseline',
  target_id: 'n-churn',
  target_label: 'Churn rate',
  constraint_type: 'at_most',
  value: 5,
};

function makePending(id: string, action: PendingActionAction, live = true): PendingAction {
  return {
    id,
    scenario_id: 'scn_test',
    chip_id: `chip_${id}`,
    action,
    preconditions: {},
    expires_at_turn_count: live ? 2 : 0,
    expires_at_iso: live ? '2026-08-30T12:10:00.000Z' : '2026-08-30T11:00:00.000Z',
    emitted_at_iso: '2026-08-30T11:59:00.000Z',
  };
}

const BASELINE = makePending('pa-baseline', BASELINE_ACTION);

describe('R2918B — the sole baseline ask still licenses the elliptical carry', () => {
  it('one live baseline ask, alone → licensed', () => {
    expect(findSoleLiveElicitBaselinePending([BASELINE], NOW_MS)?.id).toBe('pa-baseline');
  });

  it('a live CONFIRMATION-shaped ask does not block it (a bare number answers no "yes" question)', () => {
    const withRun = [BASELINE, makePending('pa-run', { kind: 'run_analysis' })];
    expect(findSoleLiveElicitBaselinePending(withRun, NOW_MS)?.id).toBe('pa-baseline');
  });

  it('an EXPIRED competing number-ask does not block it (liveness first)', () => {
    const withDead = [
      BASELINE,
      makePending(
        'pa-dead',
        {
          kind: 'elicit_option_effect',
          option_id: 'o-1',
          option_label: 'Two Developers',
          factor_id: 'f-1',
          factor_label: 'Development throughput',
        },
        false,
      ),
    ];
    expect(findSoleLiveElicitBaselinePending(withDead, NOW_MS)?.id).toBe('pa-baseline');
  });
});

describe('R2918B — a COMPETING live ask that a bare number could answer blocks the carry', () => {
  it('a live elicit_option_effect ("give me a number from 0 to 1") blocks it', () => {
    const competing = [
      BASELINE,
      makePending('pa-effect', {
        kind: 'elicit_option_effect',
        option_id: 'o-1',
        option_label: 'Two Developers',
        factor_id: 'f-1',
        factor_label: 'Development throughput',
      }),
    ];
    expect(findSoleLiveElicitBaselinePending(competing, NOW_MS)).toBeNull();
  });

  it('a live set_factor_value ask blocks it', () => {
    const competing = [
      BASELINE,
      makePending('pa-sfv', {
        kind: 'set_factor_value',
        factor_id: 'f-1',
        value: 3,
        operator: 'set',
      }),
    ];
    expect(findSoleLiveElicitBaselinePending(competing, NOW_MS)).toBeNull();
  });

  it('two live baseline asks still block each other (the original unanimity rule)', () => {
    const two = [BASELINE, makePending('pa-baseline-2', BASELINE_ACTION)];
    expect(findSoleLiveElicitBaselinePending(two, NOW_MS)).toBeNull();
  });

  it('a sole live number-ask that is NOT the baseline licenses nothing', () => {
    const other = [
      makePending('pa-effect', {
        kind: 'elicit_option_effect',
        option_id: 'o-1',
        option_label: 'Two Developers',
        factor_id: 'f-1',
        factor_label: 'Development throughput',
      }),
    ];
    expect(findSoleLiveElicitBaselinePending(other, NOW_MS)).toBeNull();
  });
});

describe('R2918B — the classification is DERIVED from the kind union, not mirrored (trap 12)', () => {
  it('every resumable kind is classified, and every classified kind is a real kind', () => {
    const classified = new Set(Object.keys(PENDING_KIND_CLAIMS_BARE_NUMBER));
    for (const kind of RESUMABLE_ACTION_TYPES) {
      expect(classified.has(kind)).toBe(true);
    }
    for (const kind of classified) {
      expect(RESUMABLE_ACTION_TYPES.has(kind as PendingActionKind)).toBe(true);
    }
  });

  it('the record is not vacuously all-true or all-false', () => {
    const values = Object.values(PENDING_KIND_CLAIMS_BARE_NUMBER);
    expect(values).toContain(true);
    expect(values).toContain(false);
  });
});
