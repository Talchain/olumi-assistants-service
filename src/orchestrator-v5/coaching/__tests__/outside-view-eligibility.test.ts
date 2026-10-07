/**
 * DSK-P-002 (Outside view) PROACTIVE ELIGIBILITY — RED first.
 *
 * Every assertion binds by IDENTITY (the bundle's own protocol id, its published
 * title, its authored step text) rather than by a value another object could
 * satisfy. The bundle is the authority; nothing here restates its contents.
 */
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_VIEW_PROTOCOL_ID,
  OUTSIDE_VIEW_TRIGGER_ID,
  OUTSIDE_VIEW_CLAIM_ID,
  assessOutsideViewEligibility,
  dskStageForProductStage,
  quantityFraming,
  type OutsideViewInputs,
} from '../outside-view-eligibility.js';
import type { ConversationTextSignals } from '../../compose/conversation-text-signals.js';

function signals(over: Partial<ConversationTextSignals> = {}): ConversationTextSignals {
  return {
    signalVersion: 1,
    windowComplete: true,
    scannedTurnCount: 3,
    referenceClassVocabularyPresent: false,
    tradeOffVocabularyPresent: false,
    numericEstimatePresent: true,
    ...over,
  };
}

function inputs(over: Partial<OutsideViewInputs> = {}): OutsideViewInputs {
  return {
    signals: signals(),
    userMessage: "we'll land 40 new customers",
    stage: 'frame',
    hasDecisionDescription: true,
    confirmedReferenceClassPresent: false,
    declineObservedInWindow: false,
    userStatesNoComparableCases: false,
    ...over,
  };
}

describe('the offer fires on a bare point estimate', () => {
  it('is eligible, and cites the bundle protocol AND claim by identity', () => {
    const v = assessOutsideViewEligibility(inputs());
    expect(v.eligibility).toBe('eligible');
    if (v.eligibility !== 'eligible') return;
    expect(v.protocol.protocol_id).toBe(OUTSIDE_VIEW_PROTOCOL_ID);
    expect(v.protocol.protocol_id).toBe('DSK-P-002');
    // Title and strength come from data/dsk/v1.json, never from this file.
    expect(v.protocol.protocol_title).toBe('Outside view exercise');
    expect(v.protocol.evidence_strength).toBe('strong');
    expect(v.claim.claim_id).toBe(OUTSIDE_VIEW_CLAIM_ID);
    expect(v.claim.protocol_id).toBe(OUTSIDE_VIEW_PROTOCOL_ID);
  });

  it('invites the user to name the CATEGORY — the protocol first step, not the second', () => {
    const v = assessOutsideViewEligibility(inputs());
    if (v.eligibility !== 'eligible') throw new Error('expected eligible');
    // steps[0] asks for the reference class; steps[1] already assumes one exists
    // and asks what typically happened. Using steps[1] jumps the protocol.
    expect(v.invitation).toContain('broader category');
    expect(v.invitation).not.toContain('base rate of success');
  });
});

describe('absence claims require a complete window (the fail-closed gate)', () => {
  it('is not applicable when the scan could not see the whole conversation', () => {
    const v = assessOutsideViewEligibility(
      inputs({ signals: signals({ windowComplete: false }) }),
    );
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('history_window_incomplete');
  });
});

describe('it does not re-raise what the conversation already covered', () => {
  it('stands down when reference-class vocabulary is already present', () => {
    const v = assessOutsideViewEligibility(
      inputs({ signals: signals({ referenceClassVocabularyPresent: true }) }),
    );
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('reference_class_already_discussed');
  });

  it('a confirmed reference class in canonical state means already_completed', () => {
    expect(
      assessOutsideViewEligibility(inputs({ confirmedReferenceClassPresent: true })).eligibility,
    ).toBe('already_completed');
  });

  it('an observed decline suppresses the offer', () => {
    expect(
      assessOutsideViewEligibility(inputs({ declineObservedInWindow: true })).eligibility,
    ).toBe('declined');
  });

  it('completion outranks a decline, and both outrank eligibility', () => {
    const v = assessOutsideViewEligibility(
      inputs({ confirmedReferenceClassPresent: true, declineObservedInWindow: true }),
    );
    expect(v.eligibility).toBe('already_completed');
  });
});

describe('a quantity that is framed, not estimated, does not trigger the method', () => {
  // These strings are the corpus's own negative spans, not invented examples.
  const framed: ReadonlyArray<readonly [string, string]> = [
    ['we have £750 budget', 'current_state'],
    ['keeping monthly churn under 4%', 'constraint_op'],
    ['within 6 months', 'horizon_frame'],
    ['need to increase MRR from £215k to £250k', 'target_frame'],
    ['budget under £200k', 'constraint_op'],
    ['current team is 35 people', 'current_state'],
  ];
  for (const [text, frame] of framed) {
    it(`suppresses ${JSON.stringify(text)} via ${frame}`, () => {
      const f = quantityFraming(text);
      expect(f.frames).toContain(frame);
      const v = assessOutsideViewEligibility(inputs({ userMessage: text }));
      expect(v.eligibility).toBe('not_applicable');
      if (v.eligibility !== 'not_applicable') return;
      expect(v.reason).toBe('quantity_is_framed_not_estimated');
    });
  }
});

describe('uncertainty already acknowledged means the method is not needed', () => {
  for (const text of [
    'churn will be roughly 3%',
    'we expect about 40 new customers',
    'I reckon 40 new customers',
    'somewhere between 30 and 50 new customers',
  ]) {
    it(`stands down on ${JSON.stringify(text)}`, () => {
      const v = assessOutsideViewEligibility(inputs({ userMessage: text }));
      expect(v.eligibility).toBe('not_applicable');
      if (v.eligibility !== 'not_applicable') return;
      expect(v.reason).toBe('uncertainty_already_acknowledged');
    });
  }
});

describe("needs_input is the protocol's own required_inputs, nothing else", () => {
  it('asks for the decision description when it is absent', () => {
    const v = assessOutsideViewEligibility(inputs({ hasDecisionDescription: false }));
    expect(v.eligibility).toBe('needs_input');
    if (v.eligibility !== 'needs_input') return;
    expect(v.missing).toContain('decision_description');
  });

  it('asks for an estimate when the user has stated no quantity at all', () => {
    const v = assessOutsideViewEligibility(
      inputs({
        userMessage: 'should we expand into Germany or France?',
        signals: signals({ numericEstimatePresent: false }),
      }),
    );
    expect(v.eligibility).toBe('needs_input');
    if (v.eligibility !== 'needs_input') return;
    expect(v.missing).toContain('user_estimate_or_assumption');
  });

  it('NEVER treats "no reference class supplied yet" as needs_input — that is the first STEP', () => {
    // The default fixture has no reference class anywhere. That is precisely the
    // case the method exists to serve, so it must be eligible, never needs_input.
    expect(assessOutsideViewEligibility(inputs()).eligibility).toBe('eligible');
  });
});

describe('unprecedented is only ever the user’s own claim, never inferred', () => {
  it('stands down when the user says there are no comparable cases', () => {
    const v = assessOutsideViewEligibility(inputs({ userStatesNoComparableCases: true }));
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('user_states_no_comparable_cases');
  });
});

describe('stage applicability crosses the two vocabularies', () => {
  // DSK-P-002 applies at ['frame','evaluate']. The PRODUCT has no 'evaluate' —
  // it says 'analyse'. Passing the product stage straight in made half this
  // protocol's applicability permanently unreachable.
  it.each(['frame', 'analyse'])('applies at the PRODUCT stage %s', (stage) => {
    expect(assessOutsideViewEligibility(inputs({ stage })).eligibility).toBe('eligible');
  });
  it.each(['decide', 'review', 'ideate', 'optimise', ''])('does not apply at %s', (stage) => {
    const v = assessOutsideViewEligibility(inputs({ stage }));
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('stage_not_applicable');
  });
  it('still accepts the DSK spelling directly, so a DSK-stage caller works too', () => {
    expect(assessOutsideViewEligibility(inputs({ stage: 'evaluate' })).eligibility).toBe('eligible');
  });
});

describe('\u2b50 the stage map is TOTAL over the product enum and lands in DSK space', () => {
  it('every product Stage member maps to a real DECISION_STAGES member', async () => {
    const boundary = await import('@talchain/schemas/boundary');
    const stageEnum = (boundary as Record<string, unknown>)['Stage'] as
      | { readonly options?: readonly string[]; readonly _def?: { values?: readonly string[] } }
      | undefined;
    const productStages = stageEnum?.options ?? stageEnum?._def?.values ?? [];
    expect(productStages.length).toBeGreaterThan(0); // non-vacuity
    const { DECISION_STAGES } = await import('../../../dsk/types.js');
    for (const p of productStages) {
      const mapped = dskStageForProductStage(p);
      expect(DECISION_STAGES as readonly string[], `product stage ${p} -> ${mapped}`).toContain(mapped);
    }
  });

  it('an UNKNOWN stage fails closed — it matches nothing rather than defaulting', () => {
    expect(dskStageForProductStage('not_a_stage')).toBe('not_a_stage');
    const v = assessOutsideViewEligibility(inputs({ stage: 'not_a_stage' }));
    expect(v.eligibility).toBe('not_applicable');
  });
});

describe('the trigger and claim ids resolve in the bundle', () => {
  it('names DSK-TR-002 and DSK-T-002, and the trigger links to the protocol', () => {
    expect(OUTSIDE_VIEW_TRIGGER_ID).toBe('DSK-TR-002');
    expect(OUTSIDE_VIEW_CLAIM_ID).toBe('DSK-T-002');
  });
});

describe('it never proposes a write', () => {
  it('the eligible verdict carries no value, no patch and no mutation field', () => {
    const v = assessOutsideViewEligibility(inputs());
    const keys = Object.keys(v).sort();
    expect(keys).toEqual(['claim', 'eligibility', 'invitation', 'protocol']);
    expect(JSON.stringify(v)).not.toMatch(/value|patch|mutat|write|set_factor/i);
  });
});
