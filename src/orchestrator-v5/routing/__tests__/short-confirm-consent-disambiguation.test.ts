/**
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — resumer-level pins.
 *
 * Doctrine: (a) every consent ask states EXACTLY what the user is
 * confirming; (b) a bare confirmation ("yes" / "go ahead") arriving while
 * MULTIPLE consent-expecting pendings are live must NOT silently resolve
 * one of them — the resumer returns `recovery_ambiguous` carrying every
 * live consent candidate so the executor lists them (numbered) with
 * per-item / all / none resolution. "All of them" is recognised as a
 * deterministic `consent_all` dispatch.
 *
 * Single-consent behaviour is UNCHANGED: consent-priority (F-HELD) still
 * resolves a bare confirm to the one live consent hold, and ordinal /
 * label picks stay deterministic.
 */

import { describe, expect, it } from 'vitest';

import { tryShortConfirmResume } from '../deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_MS = Date.parse('2026-07-11T12:00:00.000Z');

function makeApplyProposedPending(
  n: number,
  overrides: Partial<PendingAction> = {},
): PendingAction {
  const ref = `prop_aaaaaaaaaaa${n}`;
  return {
    id: `pa-apply-${n}`,
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: n },
        target_entity_ids: [`fac-${n}`],
      },
      public_label: `Test Factor ${n} at ${n}0%`,
      public_message: `Check whether Factor ${n} at ${n}0% changes the result.`,
    },
    preconditions: { graph_hash: 'h_base' },
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-11T12:10:00.000Z',
    emitted_at_iso: `2026-07-11T11:5${n}:00.000Z`,
    ...overrides,
  };
}

function makeProposedConceptPending(): PendingAction {
  return {
    id: 'pa-concept-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'pa-concept-1',
    action: {
      kind: 'proposed_concept',
      concept: 'team morale',
      preferred_kind: 'factor',
      public_label: "Add 'team morale'",
      public_message: 'Continue with team morale.',
    },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-11T12:10:00.000Z',
    emitted_at_iso: '2026-07-11T11:59:00.000Z',
  };
}

function makeRunAnalysisPending(): PendingAction {
  return {
    id: 'pa-run-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_rerun_analysis',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-11T12:10:00.000Z',
    emitted_at_iso: '2026-07-11T11:59:30.000Z',
  };
}

const baseInput = { currentTurnIndex: 3, nowMs: NOW_MS };

describe('consent-clarity — single live consent (behaviour unchanged)', () => {
  it('bare "yes" with ONE live consent hold resumes it (consent-priority intact)', () => {
    const hold = makeApplyProposedPending(1);
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [makeRunAnalysisPending(), hold],
      ...baseInput,
    });
    expect(r).toEqual({ matched: true, dispatch: 'pending_action', pending: hold });
  });
});

describe('consent-clarity — multiple live consents + bare confirm → disambiguation', () => {
  it('two live proposals + "yes" → recovery_ambiguous carrying BOTH (no silent pick)', () => {
    const a = makeApplyProposedPending(1);
    const b = makeApplyProposedPending(2);
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [a, b],
      ...baseInput,
    });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.dispatch).toBe('recovery_ambiguous');
    if (r.dispatch !== 'recovery_ambiguous') return;
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toBe(a);
    expect(r.candidates[1]).toBe(b);
  });

  it('live proposal + live proposed_concept + "go ahead" → recovery_ambiguous with both, proposals first', () => {
    const concept = makeProposedConceptPending();
    const hold = makeApplyProposedPending(1);
    const r = tryShortConfirmResume({
      message: 'go ahead',
      pendingActions: [concept, hold],
      ...baseInput,
    });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.dispatch).toBe('recovery_ambiguous');
    if (r.dispatch !== 'recovery_ambiguous') return;
    expect(r.candidates.map((c) => c.action.kind)).toEqual([
      'apply_proposed_change',
      'proposed_concept',
    ]);
  });

  it('suggestion pendings (run_analysis) do NOT count toward the multi-consent trigger', () => {
    const hold = makeApplyProposedPending(1);
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [makeRunAnalysisPending(), hold],
      ...baseInput,
    });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.dispatch).toBe('pending_action');
  });

  it('an ordinal pick ("the first one") still resolves deterministically with two live proposals', () => {
    const a = makeApplyProposedPending(1);
    const b = makeApplyProposedPending(2);
    const r = tryShortConfirmResume({
      message: 'the first one',
      pendingActions: [a, b],
      ...baseInput,
    });
    expect(r).toEqual({ matched: true, dispatch: 'pending_action', pending: a });
  });

  it('an EXPIRED second consent does not trigger disambiguation — the live one resumes', () => {
    const live = makeApplyProposedPending(1);
    const dead = makeApplyProposedPending(2, {
      expires_at_iso: '2026-07-11T11:00:00.000Z',
    });
    const r = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [live, dead],
      ...baseInput,
    });
    expect(r).toEqual({ matched: true, dispatch: 'pending_action', pending: live });
  });
});

describe('consent-clarity — "all of them" resolution', () => {
  it('"all of them" with two live consents → consent_all carrying both', () => {
    const a = makeApplyProposedPending(1);
    const b = makeApplyProposedPending(2);
    const r = tryShortConfirmResume({
      message: 'all of them',
      pendingActions: [a, b],
      ...baseInput,
    });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.dispatch).toBe('consent_all');
    if (r.dispatch !== 'consent_all') return;
    expect(r.candidates).toHaveLength(2);
  });

  it.each(['all', 'All of them.', 'both', 'yes to all', 'apply all', 'all please'])(
    '%j is recognised as an all-consents confirmation',
    (msg) => {
      const r = tryShortConfirmResume({
        message: msg,
        pendingActions: [makeApplyProposedPending(1), makeApplyProposedPending(2)],
        ...baseInput,
      });
      expect(r.matched).toBe(true);
      if (!r.matched) return;
      expect(r.dispatch).toBe('consent_all');
    },
  );

  it('"all of them" with ONE live consent resumes it directly (no list round-trip)', () => {
    const hold = makeApplyProposedPending(1);
    const r = tryShortConfirmResume({
      message: 'all of them',
      pendingActions: [hold],
      ...baseInput,
    });
    expect(r).toEqual({ matched: true, dispatch: 'pending_action', pending: hold });
  });

  it('"all of them" with NO live consents falls through (no misfire on suggestion chips)', () => {
    const r = tryShortConfirmResume({
      message: 'all of them',
      pendingActions: [makeRunAnalysisPending()],
      ...baseInput,
    });
    expect(r.matched).toBe(false);
  });

  it('"all of the numbers" is NOT an all-consents confirmation (anchored pattern)', () => {
    const r = tryShortConfirmResume({
      message: 'all of the numbers',
      pendingActions: [makeApplyProposedPending(1), makeApplyProposedPending(2)],
      ...baseInput,
    });
    expect(r.matched).toBe(false);
  });
});
