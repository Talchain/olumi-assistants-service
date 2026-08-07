/**
 * V5 G7/G8 — short-confirm resume for apply_proposed_change.
 *
 * Pins the new RESUMABLE_KINDS membership: a bare "yes" against a
 * live apply_proposed_change pending action returns
 * `dispatch: 'pending_action'` (synthesis decision happens in
 * TurnExecutor via decideProposedChangeSynthesis).
 *
 * Hash-divergence detection lives in TurnExecutor — short-confirm
 * stays graph-agnostic and only does match / live / kind / freshness
 * gating.
 */

import { describe, expect, it } from 'vitest';

import { tryShortConfirmResume } from '../deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';

function applyProposed(overrides: { id?: string; chipId?: string } = {}): PendingAction {
  return {
    id: overrides.id ?? 'pa1',
    scenario_id: 'scn',
    chip_id: overrides.chipId ?? 'prop_aaaaaaaaaaaa',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: overrides.chipId ?? 'prop_aaaaaaaaaaaa',
      inline_patch: { handler_id: 'add_constraint', params: {}, target_entity_ids: [] },
      // Pass-10 P2-1: standard-variant required render copy. The
      // helper builds standard-variant fixtures, so include the
      // fields rather than relying on the legacy escape hatch.
      public_label: 'Label for proposal',
      public_message: 'Message for proposal.',
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-05-07T12:00:00.000Z',
  };
}

const NOW_MS = Date.parse('2026-05-07T12:00:00.000Z');

describe('tryShortConfirmResume — apply_proposed_change resumable', () => {
  it.each(['yes', 'yes please', 'do it', 'go ahead', 'apply it', 'confirm', 'ok'])(
    '%s with one live apply_proposed_change returns pending_action',
    (msg) => {
      const out = tryShortConfirmResume({
        message: msg,
        pendingActions: [applyProposed()],
        currentTurnIndex: 0,
        nowMs: NOW_MS,
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      expect(out.dispatch).toBe('pending_action');
    },
  );

  it('CONSENT-CLARITY AMENDMENT: two live apply_proposed_change + bare "yes" → recovery_ambiguous listing both (supersedes V5 P0.2 most-recent-wins)', () => {
    // Ratified doctrine (Paul, 2026-07-11): a bare confirmation with
    // MULTIPLE live consent-expecting pendings never silently resolves
    // one — the executor lists them (numbered) and the user picks by
    // number, chip, "all of them", or "none".
    const out = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [
        {
          ...applyProposed({ id: 'pa1', chipId: 'prop_aaaaaaaaaaaa' }),
          emitted_at_iso: '2026-05-07T11:58:00.000Z',
        },
        {
          ...applyProposed({ id: 'pa2', chipId: 'prop_bbbbbbbbbbbb' }),
          emitted_at_iso: '2026-05-07T11:59:30.000Z',
        },
      ],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.dispatch).toBe('recovery_ambiguous');
    if (out.dispatch !== 'recovery_ambiguous') return;
    expect(out.candidates.map((c) => c.chip_id)).toEqual([
      'prop_aaaaaaaaaaaa',
      'prop_bbbbbbbbbbbb',
    ]);
  });

  it('returns recovery_expired when the apply_proposed_change is expired', () => {
    const expired = applyProposed();
    const out = tryShortConfirmResume({
      message: 'yes',
      pendingActions: [{ ...expired, expires_at_iso: '2024-01-01T00:00:00.000Z' }],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.dispatch).toBe('recovery_expired');
  });

  it('does NOT match when message contains an edit verb (e.g. "yes add it")', () => {
    const out = tryShortConfirmResume({
      message: 'yes add it',
      pendingActions: [applyProposed()],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(false);
  });

  // ── P1a (real-user run 2026-07-17, scenario c510030e) ────────────────────
  // The GM held ask copy invites "Reply yes to continue"; a real user
  // naturally OVER-answers with a doubled confirmation ("Yes, go ahead" —
  // the exact P1a repro). The pre-fix SHORT_CONFIRM_PATTERN recognised a
  // SINGLE confirmation token only, so "yes" + a second confirmation phrase
  // fell to the LLM router, which role-played agreement while NOTHING
  // applied. These compound affirmatives carry no edit verb / quantity, so
  // the negative gate must not block them — the single live hold resumes.
  it.each([
    'Yes, go ahead',
    'yes go ahead',
    'yes, go ahead.',
    'yeah go ahead',
    'ok go ahead',
    'yes proceed',
    'yes, do it',
    'sure go ahead',
    'yes and do it',
    'Yes go ahead please',
  ])(
    'compound confirmation %j with one live GM hold returns pending_action (P1a)',
    (msg) => {
      const out = tryShortConfirmResume({
        message: msg,
        pendingActions: [applyProposed()],
        currentTurnIndex: 0,
        nowMs: NOW_MS,
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      expect(out.dispatch).toBe('pending_action');
    },
  );

  // Negative guard for the widened pattern: a leading "yes" followed by a
  // FRESH request (not a confirmation phrase) must still fall through.
  it.each([
    'yes I think so',
    'yes change the timeframe',
    'yes option 2 is best',
    'yes but lower the bar',
  ])('widened pattern still falls through on non-confirmation %j', (msg) => {
    const out = tryShortConfirmResume({
      message: msg,
      pendingActions: [applyProposed()],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(false);
  });
});

describe('tryShortConfirmResume — PROPOSAL_CONFIRM phrases (P0-2)', () => {
  it.each([
    'add that',
    'Add that.',
    'add that please',
    'make that change',
    'make that',
    'Make that change.',
    'do that change',
    'apply that',
    'apply that change',
    "let's do that",
    'lets apply that',
  ])(
    '%s with one live apply_proposed_change returns pending_action despite edit verbs',
    (msg) => {
      const out = tryShortConfirmResume({
        message: msg,
        pendingActions: [applyProposed()],
        currentTurnIndex: 0,
        nowMs: NOW_MS,
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      expect(out.dispatch).toBe('pending_action');
    },
  );

  it('"add that" does NOT match when there is no apply_proposed_change pending action', () => {
    const out = tryShortConfirmResume({
      message: 'add that',
      pendingActions: [
        {
          id: 'pa-x',
          scenario_id: 'scn',
          chip_id: 'chip_x',
          action: { kind: 'run_analysis' },
          preconditions: {},
          expires_at_turn_count: 2,
          expires_at_iso: '2099-01-01T00:00:00.000Z',
          emitted_at_iso: '2026-05-07T12:00:00.000Z',
        },
      ],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(false);
  });

  it('with mixed live kinds, PROPOSAL_CONFIRM narrows resume to apply_proposed_change', () => {
    const proposal = applyProposed();
    const runAnalysis = {
      id: 'pa-run',
      scenario_id: 'scn',
      chip_id: 'chip_run',
      action: { kind: 'run_analysis' as const },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: '2026-05-07T12:00:00.000Z',
    };
    const out = tryShortConfirmResume({
      message: 'add that',
      pendingActions: [runAnalysis, proposal],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.dispatch).toBe('pending_action');
    if (out.dispatch !== 'pending_action') return;
    expect(out.pending.action.kind).toBe('apply_proposed_change');
  });
});

describe('tryShortConfirmResume — ordinal pre-resolve (P0-2)', () => {
  const A = applyProposed({ id: 'pa1', chipId: 'prop_aaaaaaaaaaaa' });
  const B = applyProposed({ id: 'pa2', chipId: 'prop_bbbbbbbbbbbb' });
  const C = applyProposed({ id: 'pa3', chipId: 'prop_cccccccccccc' });

  it.each([
    ['the first one', 0, 'prop_aaaaaaaaaaaa'],
    ['first', 0, 'prop_aaaaaaaaaaaa'],
    ['option 1', 0, 'prop_aaaaaaaaaaaa'],
    ['#1', 0, 'prop_aaaaaaaaaaaa'],
    ['second', 1, 'prop_bbbbbbbbbbbb'],
    ['option 2', 1, 'prop_bbbbbbbbbbbb'],
    ['#2', 1, 'prop_bbbbbbbbbbbb'],
    ['third', 2, 'prop_cccccccccccc'],
  ])(
    '%s with three proposals resolves index %d (%s) directly to pending_action',
    (msg, _idx, expectedChipId) => {
      const out = tryShortConfirmResume({
        message: msg,
        pendingActions: [A, B, C],
        currentTurnIndex: 0,
        nowMs: NOW_MS,
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      // Critically NOT recovery_ambiguous — the ordinal short-circuits.
      expect(out.dispatch).toBe('pending_action');
      if (out.dispatch !== 'pending_action') return;
      expect(out.pending.chip_id).toBe(expectedChipId);
    },
  );

  it('"the first one" with single proposal resolves directly', () => {
    const out = tryShortConfirmResume({
      message: 'the first one',
      pendingActions: [A],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.dispatch).toBe('pending_action');
  });

  it('ordinal beyond candidate count falls through (not matched)', () => {
    const out = tryShortConfirmResume({
      message: 'option 5',
      pendingActions: [A, B],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(false);
  });

  it('ordinal phrases do NOT match when there is no apply_proposed_change pending', () => {
    const out = tryShortConfirmResume({
      message: 'the first one',
      pendingActions: [
        {
          id: 'pa-x',
          scenario_id: 'scn',
          chip_id: 'chip_x',
          action: { kind: 'run_analysis' as const },
          preconditions: {},
          expires_at_turn_count: 2,
          expires_at_iso: '2099-01-01T00:00:00.000Z',
          emitted_at_iso: '2026-05-07T12:00:00.000Z',
        },
      ],
      currentTurnIndex: 0,
      nowMs: NOW_MS,
    });
    expect(out.matched).toBe(false);
  });
});
