/**
 * THE OFFER, and the round trip that makes "no repeat" real.
 *
 * The decline chip is only durable if the message it mints is the same message
 * the history derivation recognises. That round trip is asserted here rather
 * than assumed, because a mismatch would silently reinstate nagging.
 */
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_VIEW_DECLINE_CHIP_ID,
  OUTSIDE_VIEW_DECLINE_MESSAGE,
  OUTSIDE_VIEW_ENGAGE_CHIP_ID,
  OUTSIDE_VIEW_ENGAGE_MESSAGE,
  buildOutsideViewOffer,
  deriveOutsideViewHistory,
  outsideViewOfferFitsChipBudget,
  SUGGESTION_BUDGET,
} from '../outside-view-offer.js';
import { ROUTED_COACHING_INTENTS } from '../typed-intent-directive.js';
import { coachingIntentForChipId } from '../coaching-chip-registry.js';
import {
  OUTSIDE_VIEW_CLAIM_ID,
  OUTSIDE_VIEW_PROTOCOL_ID,
  assessOutsideViewEligibility,
  type OutsideViewInputs,
} from '../outside-view-eligibility.js';
import { REFERENCE_CLASS_CONFIRM_PREFIX } from '../../belief-elicitation/reference-class-grammar.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

const CTX = { sessionId: 'sess-a', createdAt: '2026-09-23T00:00:00.000Z' };

function inputs(over: Partial<OutsideViewInputs> = {}): OutsideViewInputs {
  return {
    signals: {
      signalVersion: 1,
      windowComplete: true,
      scannedTurnCount: 2,
      referenceClassVocabularyPresent: false,
      tradeOffVocabularyPresent: false,
      numericEstimatePresent: true,
    },
    userMessage: "we'll land 40 new customers",
    stage: 'frame',
    hasDecisionDescription: true,
    confirmedReferenceClassPresent: false,
    declineObservedInWindow: false,
    userStatesNoComparableCases: false,
    ...over,
  };
}
const turn = (user: string | null, assistant: string | null = null): SessionTurnWithContent =>
  ({ user_message: user, assistant_message: assistant }) as unknown as SessionTurnWithContent;

describe('the offer is built only for an eligible verdict', () => {
  it('builds for eligible', () => {
    expect(buildOutsideViewOffer(assessOutsideViewEligibility(inputs()), CTX)).not.toBeNull();
  });
  it.each([
    ['already_completed', inputs({ confirmedReferenceClassPresent: true })],
    ['declined', inputs({ declineObservedInWindow: true })],
    ['not_applicable', inputs({ stage: 'decide' })],
    ['needs_input', inputs({ hasDecisionDescription: false })],
  ])('returns null for %s', (_label, inp) => {
    expect(buildOutsideViewOffer(assessOutsideViewEligibility(inp), CTX)).toBeNull();
  });
});

describe('what the user is shown', () => {
  const offer = buildOutsideViewOffer(assessOutsideViewEligibility(inputs()), CTX)!;

  it("asks the protocol's own authored question, not house copy", () => {
    expect(offer.assistant_text).toContain('broader category');
    expect(offer.assistant_text).not.toMatch(/\[[^\]]*\]/);
  });

  it('emits exactly one coaching block carrying the DSK citation', () => {
    expect(offer.blocks).toHaveLength(1);
    const b = offer.blocks[0] as Record<string, unknown>;
    expect(b['type']).toBe('coaching');
    expect(b['action_intent']).toBe('run_outside_view');
    const prov = b['dsk_claim_provenance'] as Record<string, unknown>;
    expect(prov['claim_id']).toBe(OUTSIDE_VIEW_CLAIM_ID);
    expect(prov['protocol_id']).toBe(OUTSIDE_VIEW_PROTOCOL_ID);
    // Title and strength are the bundle's bytes, never this file's.
    expect(prov['claim_title']).toBe('Outside view and reference class forecasting');
    expect(prov['evidence_strength']).toBe('strong');
  });

  it('is NOT an ExerciseBlock and never sets reference_class', () => {
    const b = offer.blocks[0] as Record<string, unknown>;
    expect(b['type']).not.toBe('exercise');
    expect(b).not.toHaveProperty('reference_class');
    expect(b).not.toHaveProperty('dsk_provenance');
  });

  it('is an assumption_check, NOT a calibration_prompt owned by another flow', () => {
    const b = offer.blocks[0] as Record<string, unknown>;
    // `calibration_prompt` belongs to handlers/draft-calibration-blocks.ts (the
    // "set X to pretty likely" flow). Borrowing it would make this offer
    // indistinguishable from that one in dedupe and telemetry.
    expect(b['coaching_kind']).toBe('assumption_check');
    expect(b['coaching_kind']).not.toBe('calibration_prompt');
    // And it is a deterministic gate's output, not a draft's or a review's.
    expect(b['source']).toBe('deterministic_signal');
    expect(b['source_handler']).toBe('outside_view_offer');
  });

  it('binds no target_ref — the offer is about the decision, not one element', () => {
    expect((offer.blocks[0] as Record<string, unknown>)['target_refs']).toEqual([]);
  });

  /**
   * ⛔⛔ THE ORDER IS LOAD-BEARING, so it is pinned rather than incidental.
   * `chip-finalizer.ts` caps the `chip_prompt_` family and keeps the EARLIER
   * chips. The Canvas Completion lane's review measured the old order: with 2
   * base suggestion chips "Not now" was trimmed and the user was shown a card
   * they could not decline. Decline FIRST means a one-slot budget keeps the
   * refusal, not the commitment.
   */
  it('offers BOTH, with the DECLINE first so a chip budget can never trim the refusal', () => {
    expect(offer.suggested_actions.map((a) => a.id)).toEqual([
      OUTSIDE_VIEW_DECLINE_CHIP_ID,
      OUTSIDE_VIEW_ENGAGE_CHIP_ID,
    ]);
  });

  it('proposes no write of any kind', () => {
    expect(JSON.stringify(offer)).not.toMatch(/graph_patch|set_factor|mutat|observed_state|raw_value/i);
  });

  it('is stable for a session — the same turn twice yields the same block id', () => {
    const again = buildOutsideViewOffer(assessOutsideViewEligibility(inputs()), CTX)!;
    expect((again.blocks[0] as Record<string, unknown>)['block_id']).toBe(
      (offer.blocks[0] as Record<string, unknown>)['block_id'],
    );
  });
});

describe('history derivation binds to the product’s own literals', () => {
  it('detects a confirmed reference class from the confirm prefix', () => {
    const h = deriveOutsideViewHistory([turn(`${REFERENCE_CLASS_CONFIRM_PREFIX} 3 of 7 launches hit target`)]);
    expect(h.confirmedReferenceClassPresent).toBe(true);
  });

  it('does NOT count the ASSISTANT mentioning the confirm phrase', () => {
    const h = deriveOutsideViewHistory([
      turn('what do you think?', `you can say "${REFERENCE_CLASS_CONFIRM_PREFIX} ..." to record it`),
    ]);
    expect(h.confirmedReferenceClassPresent).toBe(false);
  });

  it('ignores turns with no user content rather than throwing', () => {
    expect(deriveOutsideViewHistory([turn(null, 'system event')])).toEqual({
      confirmedReferenceClassPresent: false,
      declineObservedInWindow: false,
      engageObservedInWindow: false,
    });
  });

  it('a plain mention of base rates is NOT a confirmation', () => {
    const h = deriveOutsideViewHistory([turn('our base rate is probably fine')]);
    expect(h.confirmedReferenceClassPresent).toBe(false);
  });
});

describe('⭐ THE ROUND TRIP — declining actually stops the offer', () => {
  it('the decline chip message is recognised by the history derivation', () => {
    const offer = buildOutsideViewOffer(assessOutsideViewEligibility(inputs()), CTX)!;
    const declineChip = offer.suggested_actions.find((a) => a.id === OUTSIDE_VIEW_DECLINE_CHIP_ID)!;
    // The user clicks it; that message becomes their next turn verbatim.
    const history = deriveOutsideViewHistory([turn(declineChip.message)]);
    expect(history.declineObservedInWindow).toBe(true);
    // Feed the derived history back in: the offer must now stand down.
    const next = assessOutsideViewEligibility(inputs({ ...history }));
    expect(next.eligibility).toBe('declined');
    expect(buildOutsideViewOffer(next, CTX)).toBeNull();
  });

  it('engaging then confirming also stops it, via already_completed', () => {
    const offer = buildOutsideViewOffer(assessOutsideViewEligibility(inputs()), CTX)!;
    const engage = offer.suggested_actions.find((a) => a.id === OUTSIDE_VIEW_ENGAGE_CHIP_ID)!;
    expect(engage.message).toBe(OUTSIDE_VIEW_ENGAGE_MESSAGE);
    const history = deriveOutsideViewHistory([
      turn(engage.message),
      turn(`${REFERENCE_CLASS_CONFIRM_PREFIX} 3 of 7 similar launches hit their target`),
    ]);
    const next = assessOutsideViewEligibility(inputs({ ...history }));
    expect(next.eligibility).toBe('already_completed');
    expect(buildOutsideViewOffer(next, CTX)).toBeNull();
  });

  it('the decline literal is not something a user would type by accident', () => {
    expect(OUTSIDE_VIEW_DECLINE_MESSAGE.length).toBeGreaterThan(30);
    expect(deriveOutsideViewHistory([turn('not now')]).declineObservedInWindow).toBe(false);
  });
});

describe('\u26d4 the chip ids must stay honest about what they invoke', () => {
  it('the ENGAGE chip resolves to the outside_view routed intent', () => {
    expect(coachingIntentForChipId(OUTSIDE_VIEW_ENGAGE_CHIP_ID)).toBe('outside_view');
  });

  it('the DECLINE chip spells NO routed intent, so it can never invoke a method', () => {
    // The completeness guard classifies any id CONTAINING a routed-intent token
    // as a method chip. A decline that named the method could only satisfy that
    // guard by mapping "Not now" to running the exercise. Putting a routed token
    // back in this id REDs here.
    for (const intent of ROUTED_COACHING_INTENTS) {
      expect(OUTSIDE_VIEW_DECLINE_CHIP_ID).not.toContain(intent);
    }
    expect(coachingIntentForChipId(OUTSIDE_VIEW_DECLINE_CHIP_ID)).toBeUndefined();
  });
});


/**
 * ⛔⛔ THE FIRST BLOCKER OF THE CANVAS COMPLETION LANE'S EXACT-HEAD REVIEW.
 *
 * Settled state was read from PRIOR turns only, so the turn on which the user
 * pressed "Not now" — and the turn on which they pressed "Take the outside view"
 * — could not see its own message, and the offer was attached again to the very
 * reply acknowledging it. Their probes P1, P1b and P2 each reproduced it through
 * the real `runTurnExecutor`.
 *
 * Bound at the derivation with a CONTRAST CONTROL in each case, so a fix cannot
 * pass by settling everything.
 */
describe('the CURRENT turn settles the offer, not just prior ones', () => {
  it('a decline typed on THIS turn is seen', () => {
    const h = deriveOutsideViewHistory([], OUTSIDE_VIEW_DECLINE_MESSAGE);
    expect(h.declineObservedInWindow).toBe(true);
    expect(h.engageObservedInWindow, 'contrast: engage is untouched').toBe(false);
  });

  it('an engage pressed on THIS turn is seen', () => {
    const h = deriveOutsideViewHistory([], OUTSIDE_VIEW_ENGAGE_MESSAGE);
    expect(h.engageObservedInWindow).toBe(true);
    expect(h.declineObservedInWindow, 'contrast: decline is untouched').toBe(false);
  });

  it('CONTRAST: an ordinary current message settles nothing', () => {
    const h = deriveOutsideViewHistory([], 'we think churn lands at 4% next quarter');
    expect(h.declineObservedInWindow).toBe(false);
    expect(h.engageObservedInWindow).toBe(false);
    expect(h.confirmedReferenceClassPresent).toBe(false);
  });

  it('an absent current message is not an error and settles nothing', () => {
    expect(deriveOutsideViewHistory([])).toEqual({
      confirmedReferenceClassPresent: false,
      declineObservedInWindow: false,
      engageObservedInWindow: false,
    });
  });
});

/**
 * ⛔⛔ THE SECOND HALF OF THE CANVAS COMPLETION REVIEW'S FIRST BLOCKER: the card
 * is not budgeted but its chips are, so the offer could be shown with no way to
 * decline it.
 *
 * `SUGGESTION_BUDGET` is pinned against the REAL finaliser below, not asserted
 * from a comment — a second authority on a shared cap is how these drift.
 */
describe('the offer stands down rather than become un-refusable', () => {
  const sugg = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `chip_prompt_base_${i}` }));

  it('fits when there is at least one suggestion slot left', () => {
    expect(outsideViewOfferFitsChipBudget([])).toBe(true);
    expect(outsideViewOfferFitsChipBudget(sugg(SUGGESTION_BUDGET - 1))).toBe(true);
  });

  it('does NOT fit once the suggestion family is full', () => {
    expect(outsideViewOfferFitsChipBudget(sugg(SUGGESTION_BUDGET))).toBe(false);
    expect(outsideViewOfferFitsChipBudget(sugg(SUGGESTION_BUDGET + 2))).toBe(false);
  });

  it('CONTRAST: non-suggestion chips do not consume the budget', () => {
    const proposals = Array.from({ length: 6 }, (_, i) => ({ id: `prop_${i}` }));
    expect(outsideViewOfferFitsChipBudget(proposals), 'proposals are a different family').toBe(true);
  });

  it('ignores a malformed id instead of throwing', () => {
    expect(outsideViewOfferFitsChipBudget([{ id: 42 }, { }, { id: null }])).toBe(true);
  });

  it('⭐ SUGGESTION_BUDGET agrees with the REAL finaliser, measured not asserted', async () => {
    const { finalizeChips } = await import('../../compose/chip-finalizer.js');
    const over = Array.from({ length: SUGGESTION_BUDGET + 2 }, (_, i) => ({
      id: `chip_prompt_probe_${i}`,
      label: `Probe ${i}`,
      message: `probe ${i}`,
    }));
    const kept = finalizeChips(over as never, { logSuppressions: false }).chips.filter((c) =>
      String((c as { id?: unknown }).id ?? '').startsWith('chip_prompt_'),
    ).length;
    expect(kept, 'the finaliser keeps exactly the budget this module assumes').toBe(SUGGESTION_BUDGET);
  });
});
