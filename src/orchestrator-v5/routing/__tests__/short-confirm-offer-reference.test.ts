/**
 * ⭐⭐ PC1 / F-B — OFFER ACCEPTANCE IS A WARRANT. ROADMAP 2.663.
 *
 * WITNESSED LIVE on staging CEE `bb33751`, 6 Aug 2026
 * (`PHASE0-EVIDENCE-2026-07-28/consent-witness-findings-2026-08-07.md` §4).
 * The assistant offered a repair in prose ("Would you like me to help rephrase
 * that constraint now?"). The user accepted, verbatim:
 *
 *   "Yes, please rephrase the churn constraint as you offered earlier."
 *
 * and got: "Nothing has been changed. You did not ask me to edit the model, so
 * I have not." — #836's warrant demotion firing on a turn that WAS consent, to
 * the assistant's OWN offer. Consent loop: offer → yes → "you did not ask me".
 *
 * ── THE MECHANISM (traced at `0ecf5c67`) ──────────────────────────────────
 * The third warrant source is `isConfirmResume` — set when a pre-route CONSUMED
 * a pending action. The only pre-route that can consume an `apply_proposed_change`
 * on a typed message is `tryShortConfirmResume`, and its two matchers are both
 * anchored start-to-end over a closed vocabulary:
 *   · `SHORT_CONFIRM_PATTERN`    — "yes" / "yes please" / "go ahead" / …
 *   · `PROPOSAL_CONFIRM_PATTERN` — "add that" / "make that change" / …
 * An acceptance that REFERS BACK to the offer ("do what you offered") matches
 * neither, so the turn carried no warrant and #836 correctly demoted it. The
 * gate was right; the warrant vocabulary was short.
 *
 * ── THE INVARIANT UNDER TEST ──────────────────────────────────────────────
 * While a live `apply_proposed_change` is held, an affirmative that points at
 * the assistant's own offer resolves THAT offer — it is consent, not a fresh
 * request.
 *
 * ── WHY THESE ASSERTIONS ARE SHAPED THIS WAY ──────────────────────────────
 * TRAP 19 — every positive binds to the resolved pending BY ID, never to
 * "matched === true": a matcher that resolved the WRONG held proposal would
 * pass a bare truthiness assertion.
 *
 * TRAP 13 — the negatives are the load-bearing half and each is PAIRED with the
 * positive that proves the harness can see a match at all. Widening a consent
 * vocabulary is a mutation-safety change: the failure mode is not "no match",
 * it is "a read-shaped ask silently applies a held mutation", which is ROADMAP
 * 2.652 running backwards. So the negatives assert the three ways this could
 * over-reach: no live proposal · no affirmative lead on a free-content form ·
 * a competing quantity in the message.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { tryShortConfirmResume } from '../deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW_MS = Date.parse('2026-08-07T12:00:00.000Z');

/** The proposal the #836 demotion emits, in the shape `emitProposedChange` mints. */
function heldProposal(proposalRef = 'prop_aaaaaaaaaaaa'): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: proposalRef,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: proposalRef,
      inline_patch: {
        handler_id: 'add_constraint',
        params: { constraint_type: 'at_most', value: 3, unit: '%' },
        target_entity_ids: ['f-churn'],
      },
      public_label: 'Add this limit',
      public_message: 'Add that limit to my model.',
    },
    preconditions: { graph_hash: 'h_live' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-07T11:59:00.000Z',
  } as PendingAction;
}

/** A NON-proposal pending, for the "no live proposal" control. */
function heldRunAnalysis(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_run_analysis',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-07T11:59:00.000Z',
  } as unknown as PendingAction;
}

function resume(message: string, pendingActions: readonly PendingAction[]) {
  return tryShortConfirmResume({
    message,
    pendingActions,
    currentTurnIndex: 1,
    nowMs: NOW_MS,
    analysisFreshness: 'fresh',
  });
}

/**
 * THE WITNESSED UTTERANCE, verbatim from the consent-witness walk, plus the
 * generic form the ROADMAP row names. Both are acceptances of an offer the
 * assistant made; neither names a value of its own.
 */
const OFFER_ACCEPTANCES: readonly string[] = [
  'Yes, please rephrase the churn constraint as you offered earlier.',
  'Yes, please do what you offered.',
  'Yes, please do what you offered earlier.',
  'Do what you offered.',
  'Go ahead with the change you suggested.',
  'Yes, apply the change you proposed.',
  'Yes please, do what you suggested earlier.',
];

describe('F-B — an affirmative that points at the assistant’s own offer resolves the held proposal', () => {
  it.each(OFFER_ACCEPTANCES)(
    '⭐ resolves the HELD PROPOSAL BY ID for: %s',
    (message) => {
      const held = heldProposal('prop_witnessed01');
      const out = resume(message, [held]);

      expect(out.matched).toBe(true);
      // TRAP 19 — bind to the pending by identity. `matched: true` alone would
      // pass on `recovery_expired` / `recovery_ambiguous` / a different pending.
      expect(out).toMatchObject({ dispatch: 'pending_action' });
      const resolved = (out as { pending: PendingAction }).pending;
      expect(resolved.chip_id).toBe('prop_witnessed01');
      expect(
        (resolved.action as unknown as { inline_patch: { handler_id: string } }).inline_patch
          .handler_id,
      ).toBe('add_constraint');
    },
  );

  it('DISCRIMINATING PAIR — with TWO live proposals it lists rather than silently picking one', () => {
    const a = heldProposal('prop_first000000');
    const b = heldProposal('prop_second00000');
    const out = resume('Yes, please do what you offered.', [a, b]);

    // The consent-clarity amendment owns this: never a silent pick.
    expect(out).toMatchObject({ dispatch: 'recovery_ambiguous' });
    const ids = (out as { candidates: readonly PendingAction[] }).candidates.map(
      (p) => p.chip_id,
    );
    expect(ids).toEqual(['prop_first000000', 'prop_second00000']);
  });
});

describe('F-B — the offer-reference family may NEVER over-reach (2.652 running backwards)', () => {
  it('CONTROL 1 — with NO live proposal the CLOSED form does not activate at all', () => {
    const out = resume('Yes, please do what you offered.', [heldRunAnalysis()]);
    // Bind to the SKIP REASON, not to `matched: false`. Both offer-reference
    // forms are gated on a live proposal; without that gate the phrase would
    // still fail to resolve (the narrowing empties the pool) and report
    // `kind_not_yet_resumable` instead — so `matched: false` alone cannot tell
    // "the gate held" from "the gate was gone and something else caught it".
    // Measured: mutant M5 (precondition deleted) SURVIVED the weaker form.
    expect(out).toMatchObject({ matched: false, skip_reason: 'no_short_confirm' });
  });

  it('CONTROL 1b — with NO live proposal the FREE-CONTENT form does not activate either', () => {
    // The twin of control 1 for the other pattern. Control 1 exercises only the
    // closed-vocabulary form, whose precondition rides `isProposalConfirm`;
    // this one is the single case that observes the acceptance form's own gate.
    const out = resume(
      'Yes, please rephrase the churn constraint as you offered earlier.',
      [heldRunAnalysis()],
    );
    expect(out).toMatchObject({ matched: false, skip_reason: 'no_short_confirm' });
  });

  it('CONTROL 1 POSITIVE PAIR — the SAME message with a live proposal DOES resolve, proving control 1 is not vacuous', () => {
    const out = resume('Yes, please do what you offered.', [
      heldProposal('prop_paircontrol'),
    ]);
    expect(out).toMatchObject({ dispatch: 'pending_action' });
    expect((out as { pending: PendingAction }).pending.chip_id).toBe('prop_paircontrol');
  });

  it('⭐ CONTROL 2a — a READ-SHAPED ask with NO affirmative lead is NOT consent', () => {
    // The 2.652 defect inverted: this must never apply a held mutation.
    // ⚠ The back-reference verb here is deliberately `offered` — one the
    // pattern DOES recognise. The first draft said "as you described earlier",
    // which the back-reference set never matched, so the control passed for a
    // reason it did not name and mutant M4 survived it (trap 13b). Now the only
    // thing standing between this sentence and a held mutation is the mandatory
    // affirmative lead, which is exactly what the control claims.
    const out = resume(
      'Show me the option comparison as you offered earlier.',
      [heldProposal()],
    );
    expect(out).toMatchObject({ matched: false });
  });

  it('⭐ CONTROL 2b — an AFFIRMATIVE followed by a read request is still not consent to mutate', () => {
    // Lead present, back-reference recognised: the read-intent guard is the
    // ONLY thing holding here. A user can agree with something and ask to look
    // in the same breath; that is not permission to write.
    const out = resume(
      'Yes, show me the option comparison as you offered earlier.',
      [heldProposal()],
    );
    expect(out).toMatchObject({ matched: false });
  });

  it('⭐ CONTROL 3 — an affirmative carrying its OWN quantity is a fresh request, not an acceptance', () => {
    // "as you offered" is present, but the user named a DIFFERENT value.
    // Resuming the held proposal would apply 3%, not 5% — a wrong-target
    // mutation dressed as consent.
    const out = resume(
      'Yes, set churn to 5% as you offered earlier.',
      [heldProposal()],
    );
    expect(out).toMatchObject({ matched: false });
  });

  it('CONTROL 4 — an unrelated affirmative with no back-reference still falls through', () => {
    const out = resume(
      'Yes, the churn figure looks about right to me.',
      [heldProposal()],
    );
    expect(out).toMatchObject({ matched: false });
  });
});
