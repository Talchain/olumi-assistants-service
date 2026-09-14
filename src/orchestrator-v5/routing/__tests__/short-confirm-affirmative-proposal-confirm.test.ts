/**
 * ⭐⭐ #1560 — A CONFIRMATION IN THE PRODUCT'S OWN WORDS MUST APPLY THE HELD
 * PROPOSAL, AND WHERE IT CANNOT, THE AFFORDANCE MUST SURVIVE.
 *
 * WITNESSED LIVE on staging CEE `8e4efce0`, 14 Sep 2026, asserted at the
 * STORED OBJECT rather than the prose (a receipt claiming application is
 * exactly what is under test):
 *
 *   offer turn   → chip `prop_4d14a6d63cd7` "Add this limit",
 *                  graph_hash b6fb4e2aaa2d4eae
 *   "Yes, make it."
 *                → graph_hash b6fb4e2aaa2d4eae (UNCHANGED), blocks [], and
 *                  prose that asks a SECOND time: "Reply yes to continue."
 *
 * The offer copy that immediately precedes it is "Say the word and I will
 * MAKE IT." — the product teaches a phrase its own confirmation vocabulary
 * cannot hear.
 *
 * POSITIVE CONTROL for the instrument (same build, same brief, one live
 * proposal): "do it" → graph_hash 538a664c9245bae4 → 0f50ff47b63285aa with a
 * `graph_patch` block. So the apply path works and graph_hash DOES move — which
 * is what makes the unchanged hash above an absence claim rather than a
 * property of the field. (Trap 13: an absence assertion needs a presence.)
 *
 * ── WHY THESE ASSERTIONS ARE SHAPED THIS WAY ──────────────────────────────
 * TRAP 19 — every positive binds to the resolved pending BY chip_id. A matcher
 * that resolved the WRONG held proposal passes `matched === true`.
 *
 * TRAP 13 — the negatives are the load-bearing half. Widening a consent
 * vocabulary is a mutation-safety change: the failure mode is not "no match",
 * it is "a read-shaped or value-bearing turn silently applies a held mutation".
 * Each negative is paired with a positive proving the harness can see a match.
 *
 * TRAP 22b — every positive gets its OPPOSITE-DIRECTION TWIN. The two harms are
 * asymmetric and cannot share one window: a false negative costs one extra
 * "yes"; a false positive writes a mutation the user never authorised.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  tryShortConfirmResume,
  PROPOSAL_CONFIRM_PATTERN,
  SHORT_CONFIRM_PATTERN,
} from '../deterministic-short-confirm.js';
import {
  filterLivePendingActions,
  type PendingAction,
} from '../../session/pending-action.js';

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW_MS = Date.parse('2026-09-14T12:00:00.000Z');

/** The proposal the warrant demotion mints, in `emitProposedChange`'s shape. */
function heldProposal(proposalRef = 'prop_4d14a6d63cd7'): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: proposalRef,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: proposalRef,
      inline_patch: {
        handler_id: 'add_constraint',
        params: { constraint_type: 'at_most', value: 7, unit: '%' },
        target_entity_ids: ['f-churn'],
      },
      public_label: 'Add this limit',
      public_message: 'Add that limit to my model.',
    },
    preconditions: { graph_hash: 'h_live' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-09-14T11:59:00.000Z',
  } as PendingAction;
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
 * The witnessed utterance plus the class the affirmative-lead sweep opens.
 * "Yes, make it." is the live capture; the rest are the same shape — an
 * optional affirmative over a closed, value-free, proposal-targeted phrase.
 */
const AFFIRMED_CONFIRMATIONS: readonly string[] = [
  'Yes, make it.',
  'yes, make it',
  'Yes, make that change.',
  'Yes, apply that.',
  'Yes, add that.',
  'Sure, apply that change.',
  'ok, make that update',
  'make it',
  'apply it',
];

describe('#1560 — an affirmative over the product’s own offer word resolves the held proposal', () => {
  it.each(AFFIRMED_CONFIRMATIONS)(
    '⭐ resolves the HELD PROPOSAL BY ID for: %s',
    (message) => {
      const held = heldProposal('prop_witnessed99');
      const out = resume(message, [held]);

      expect(out.matched).toBe(true);
      // TRAP 19 — identity, never truthiness. `matched: true` alone would pass
      // on recovery_expired / recovery_ambiguous / a different pending.
      expect(out).toMatchObject({ dispatch: 'pending_action' });
      const resolved = (out as unknown as { pending: PendingAction }).pending;
      expect(resolved.chip_id).toBe('prop_witnessed99');
      expect(
        (resolved.action as unknown as { inline_patch: { handler_id: string } })
          .inline_patch.handler_id,
      ).toBe('add_constraint');
    },
  );

  it('⭐ THE WITNESSED REGRESSION — "Yes, make it." after the offer says "I will make it"', () => {
    const held = heldProposal('prop_4d14a6d63cd7');
    const out = resume('Yes, make it.', [held]);

    expect(out).toMatchObject({ dispatch: 'pending_action' });
    expect((out as unknown as { pending: PendingAction }).pending.chip_id).toBe(
      'prop_4d14a6d63cd7',
    );
  });

  it('DISCRIMINATING PAIR — two live proposals are listed, never silently picked', () => {
    const a = heldProposal('prop_first000000');
    const b = heldProposal('prop_second00000');
    const out = resume('Yes, make it.', [a, b]);

    expect(out).toMatchObject({ dispatch: 'recovery_ambiguous' });
    const ids = (out as unknown as { candidates: readonly PendingAction[] }).candidates.map(
      (p) => p.chip_id,
    );
    expect(ids).toEqual(['prop_first000000', 'prop_second00000']);
  });
});

describe('#1560 — the widened vocabulary may NEVER over-reach', () => {
  /**
   * TRAP 22b — the opposite-direction twins. Each names a value, a different
   * target, or a read, so resuming the held proposal would apply something the
   * user did not authorise. All are tested WITH a live proposal present, which
   * is the only state in which this pattern is consulted at all.
   */
  const MUST_NOT_RESOLVE: readonly string[] = [
    'Yes, set churn to 5%.',
    'make it 5%',
    'Yes, make it bigger',
    'Yes, make that change to pricing',
    'change the timeframe',
    'Yes, show me the comparison',
    'add a constraint on revenue',
    'Yes, remove that.',
  ];

  it.each(MUST_NOT_RESOLVE)('refuses to resume the held proposal for: %s', (message) => {
    const held = heldProposal('prop_mustnotfire');
    const out = resume(message, [held]);

    // Whatever else happens, it must not consume the held mutation.
    if (out.matched) {
      expect(out).not.toMatchObject({ dispatch: 'pending_action' });
    } else {
      expect(out.matched).toBe(false);
    }
  });

  /**
   * THE BRIEF'S NEGATIVE CONTROL, verbatim from the live capture. The bare
   * mention that OPENS the journey must still write nothing and still ask —
   * the ask-first behaviour is correct and must survive this widening. A fix
   * that applied a constraint from a bare mention would be far worse than the
   * defect it replaces.
   *
   * Measured live at pristine `8e4efce0`: this message produced "Nothing has
   * been changed. I want to confirm this with you before I edit the model"
   * with graph_hash unchanged. That behaviour is unchanged here.
   */
  it('NEGATIVE CONTROL — a bare mention with no confirmation resolves nothing', () => {
    const held = heldProposal('prop_baremention1');
    const out = resume(
      'If the churn goes over 7% for more than 3 months, we will have a cash flow problem, so this is a serious risk.',
      [held],
    );
    expect(out.matched).toBe(false);
    // The offer is untouched and still owed.
    expect(filterLivePendingActions([held], NOW_MS).map((p) => p.chip_id)).toEqual([
      'prop_baremention1',
    ]);
  });

  it('a proposal-shaped confirmation with NO live proposal resolves nothing', () => {
    // Paired control: the same strings that resolve above must be inert when
    // there is nothing held — the vocabulary is not a licence to mutate.
    for (const message of ['Yes, make it.', 'make it', 'Yes, add that.']) {
      const out = resume(message, []);
      expect(out.matched, `${message} must not resolve with no pendings`).toBe(false);
    }
  });
});

/**
 * ⭐⭐⭐ THE INTERLOCK (the brief's explicit requirement).
 *
 * The estate's ruled precedent: *truthful about a state is not the same as
 * executable as an action — find the control and prove it is REACHABLE in that
 * state.* An acknowledgement that deletes the only executable control is worse
 * than no acknowledgement.
 *
 * So: for a confirmation the prose route CANNOT apply, the held proposal must
 * remain live and unconsumed — the chip that renders it is still owed.
 *
 * The interlock is the PRECONDITION assertion. It pins, in-test, that this
 * phrase is genuinely outside the confirmation vocabulary. If the vocabulary
 * is later widened so the prose route CAN apply this phrase, that assertion
 * goes RED and this test must be rewritten deliberately — it can never start
 * silently passing for the opposite reason (TRAP 13b: a guard whose
 * discrimination depends on a fact nothing pins).
 */
describe('#1560 INTERLOCK — where prose cannot apply, the offer survives unconsumed', () => {
  // The beat-2 utterance from the live capture. Free-content, no back-reference
  // to the offer, so it is deliberately NOT in the closed vocabulary.
  const UNRECOGNISED = 'Yes, treat it as a constraint the model checks against.';

  it('PRECONDITION — this phrase is outside the confirmation vocabulary', () => {
    // If either of these flips, the prose route has gained the ability to apply
    // this phrase and the survival assertion below is no longer about the same
    // situation. RED on purpose.
    expect(SHORT_CONFIRM_PATTERN.test(UNRECOGNISED)).toBe(false);
    expect(PROPOSAL_CONFIRM_PATTERN.test(UNRECOGNISED)).toBe(false);
  });

  it('⭐ the held proposal is NOT consumed and remains live, so the affordance is still owed', () => {
    const held = heldProposal('prop_survives0001');
    const out = resume(UNRECOGNISED, [held]);

    // Nothing applied …
    expect(out.matched).toBe(false);
    expect(out).not.toMatchObject({ dispatch: 'pending_action' });

    // … therefore the offer must still be live and renderable as a chip.
    const stillLive = filterLivePendingActions([held], NOW_MS);
    expect(stillLive.map((p) => p.chip_id)).toEqual(['prop_survives0001']);
  });
});
