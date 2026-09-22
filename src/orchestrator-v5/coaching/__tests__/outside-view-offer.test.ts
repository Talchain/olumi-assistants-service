/**
 * THE OFFER, and the round trip that makes "no repeat" real.
 *
 * The decline chip is only durable if the message it mints is the same message
 * the history derivation recognises. That round trip is asserted here rather
 * than assumed, because a mismatch would silently reinstate nagging.
 */
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_VIEW_DECLINE_MESSAGE,
  OUTSIDE_VIEW_ENGAGE_MESSAGE,
  buildOutsideViewOffer,
  deriveOutsideViewHistory,
} from '../outside-view-offer.js';
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

  it('binds no target_ref — the offer is about the decision, not one element', () => {
    expect((offer.blocks[0] as Record<string, unknown>)['target_refs']).toEqual([]);
  });

  it('offers BOTH engage and decline, so silence is not the only way out', () => {
    expect(offer.suggested_actions.map((a) => a.id)).toEqual([
      'chip_prompt_outside_view_engage',
      'chip_prompt_outside_view_decline',
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
    const declineChip = offer.suggested_actions.find((a) => a.id.endsWith('decline'))!;
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
    const engage = offer.suggested_actions.find((a) => a.id.endsWith('engage'))!;
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
