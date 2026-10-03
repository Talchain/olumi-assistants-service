/**
 * THE AUTHORED CONTROLS, EXECUTED.
 *
 * `output/target-ai-architecture/SCIENCE-CONTROLS-v0_1.md` defines CTL-01…CTL-12
 * and says of itself: "No model has been run against them; no pass/fail result
 * is claimed anywhere in this file. They have not been executed." These are the
 * subset a DETERMINISTIC OFFER GATE can answer, executed.
 *
 * ⭐ THEY EARNED THEIR KEEP ON THE FIRST RUN. CTL-11 FAILED — "Quick one —
 * what's £59 × 3,200 subscribers, just the raw monthly total?" drew a science
 * offer. Asking for a calculation is not providing an estimate, and interrupting
 * a narrow arithmetic request is exactly the interruption-cost failure the
 * control was written to catch. The `computation_request` frame exists because
 * of it, and this suite is the reason the defect was found before a user saw it.
 *
 * OUT OF SCOPE, and named rather than quietly skipped: CTL-04…CTL-07, CTL-09,
 * CTL-10 judge bias PROSE and LLM response quality (does it diagnose the person?
 * does it imply a check passed?). A deterministic offer gate emits no prose about
 * bias and makes no such claim, so it cannot pass or fail them. They belong to
 * the response-level evaluation, not here.
 */
import { describe, expect, it } from 'vitest';
import { assessOutsideViewEligibility } from '../outside-view-eligibility.js';
import { deriveOutsideViewHistory, OUTSIDE_VIEW_DECLINE_MESSAGE } from '../outside-view-offer.js';
import { REFERENCE_CLASS_CONFIRM_PREFIX } from '../../belief-elicitation/reference-class-grammar.js';

const base = {
  signals: {
    signalVersion: 1 as const,
    windowComplete: true,
    scannedTurnCount: 4,
    referenceClassVocabularyPresent: false,
    tradeOffVocabularyPresent: false,
    numericEstimatePresent: true,
  },
  userMessage: '',
  stage: 'frame',
  hasDecisionDescription: true,
  confirmedReferenceClassPresent: false,
  declineObservedInWindow: false,
  userStatesNoComparableCases: false,
};
const hist = (m: string) => deriveOutsideViewHistory([{ user_message: m } as never]);
const offers = (over: Partial<typeof base>) =>
  assessOutsideViewEligibility({ ...base, ...over }).eligibility === 'eligible';

describe('controls the gate must pass', () => {
  it('CTL-01 — an explicit decline is honoured in the same session', () => {
    expect(
      offers({
        userMessage: 'What happens to the forecast if churn hits 5% instead of 4%?',
        ...hist(OUTSIDE_VIEW_DECLINE_MESSAGE),
      }),
    ).toBe(false);
  });

  it('CTL-03 — a completed exercise is used, not rerun', () => {
    expect(
      offers({
        userMessage: 'Given what we found, should I delay for the annual cohort?',
        ...hist(`${REFERENCE_CLASS_CONFIRM_PREFIX} 3 of 7 similar increases held churn`),
      }),
    ).toBe(false);
  });

  it('CTL-08 — a well-specified question with labelled figures draws no intervention', () => {
    expect(
      offers({
        userMessage:
          'Our churn is currently 3.1% (measured last quarter), the goal is under 4%, and I want to check: does a move to £59 keep us under 4% if churn rises by up to 0.5 points?',
      }),
    ).toBe(false);
  });

  it('CTL-11 — a narrow arithmetic request is not interrupted', () => {
    // The control that found a real defect. Do not weaken it.
    expect(
      offers({ userMessage: 'Quick one — what’s £59 × 3,200 subscribers, just the raw monthly total?' }),
    ).toBe(false);
  });

  it('CTL-12 — a decline does not leak into a later unrelated turn', () => {
    expect(
      offers({
        userMessage: 'how do our market comparators price their mid tier?',
        ...hist(OUTSIDE_VIEW_DECLINE_MESSAGE),
      }),
    ).toBe(false);
  });
});

describe('positive controls — the gate is not merely silent', () => {
  it('offers on a bare point estimate', () => {
    expect(offers({ userMessage: 'moving to £59 will lose us 40 customers' })).toBe(true);
  });
  it('offers on a forecast that names its period', () => {
    expect(offers({ userMessage: "we'll land 40 new customers next quarter" })).toBe(true);
  });
  it('still offers when a DIFFERENT method was declined — the decline is method-scoped', () => {
    // The decline marker is this protocol's own literal. Another exercise's
    // refusal must not silence this one.
    expect(
      offers({
        userMessage: 'moving to £59 will lose us 40 customers',
        ...hist('no, let us not do a pre-mortem'),
      }),
    ).toBe(true);
  });
});

describe('⛔ CTL-02 — KNOWN GAP, PINNED. This test documents a FAILURE, not a pass.', () => {
  /**
   * The control: after a decline, a genuinely NEW decision-relevant fact
   * ("legal says the £59 price triggers renegotiation with our three largest
   * accounts — 40% of MRR") MAY re-offer, naming what changed. Its own
   * discriminating-failure column calls BOTH directions a failure: re-offering
   * on elapsed time alone, AND never re-offering despite a materially new fact.
   *
   * This gate fails it in the SILENT direction: `declined` is absolute within
   * the window. Deciding "is this fact materially new and decision-relevant?"
   * deterministically is a judgement I am not willing to fake, and guessing it
   * would produce exactly the nagging the other half of the control forbids.
   *
   * Over-suppression is the safer failure for a PoC and matches the delivery
   * doc's "Honour skip/decline and avoid repeatedly reopening settled work".
   * It is a stated trade-off, not an oversight.
   *
   * ⭐ WHEN THIS IS CLOSED, THIS TEST MUST RED — that is its whole purpose.
   */
  it('pins that a new decision-relevant cause does NOT currently re-offer', () => {
    const reOffered = offers({
      userMessage:
        'legal says the £59 price triggers renegotiation with our three largest accounts, 40% of MRR',
      ...hist(OUTSIDE_VIEW_DECLINE_MESSAGE),
    });
    expect(reOffered).toBe(false); // ⛔ CTL-02 wants `true`. Closing the gap REDs this pin.
  });
});
