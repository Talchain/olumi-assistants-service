/**
 * ⭐⭐⭐ THE PRODUCT'S OWN CHIP ASKED A QUESTION THE PRODUCT COULD NOT ANSWER,
 * and the reply invited the person to ask about something else.
 *
 * MEASURED, staging 19 Sep, scenario `26b908ee`, 18:59:05, request `90854480`.
 * The person clicked **"How likely is this?"** — a chip the product offered —
 * on the risk *Dilution and Control Risk*:
 *
 *   v5.post_analysis_advice_gate  matched=false  unmatched_reason=no_advice_signal
 *   v5.coaching.output_postcheck  violation=unsupported_evidence_or_confidence_claim
 *                                 freshness=fresh  usable_for_chips=true  blocked=false
 *
 * Every guard did its job. The advice gate had no class for a likelihood
 * question, the model invented a confidence claim, the post-check barred it.
 * And the reply was "something was not safe to show as-is, please ask me what
 * you'd like to inspect or change next." **They never asked again.**
 *
 * ⚠ WHAT THESE TESTS GUARD, beyond the new sentence. The risk is not that the
 * copy is wrong; it is (a) that it quietly changes the OTHER violations, and
 * (b) that it grows a claim it cannot support. Both have their own arm below.
 */
import { describe, it, expect } from 'vitest';
import { buildCoachingDegradeResponse } from '../coaching-output-postcheck.js';
import type { CoachingStatePack } from '../../context/canonical-analysis-state.js';

/** Fresh, usable, unblocked — the state the captured turn was actually in. */
const FRESH_USABLE: CoachingStatePack = {
  analysis_present: true,
  freshness: 'fresh',
  blocked: false,
  usable_for_chips: true,
  readiness_status: 'ready',
} as unknown as CoachingStatePack;

const RISK_NODES = [
  { id: 'n_risk', kind: 'risk', label: 'Dilution and Control Risk' },
  { id: 'n_fac', kind: 'factor', label: 'Round Closure Speed' },
];

describe('a question the model cannot answer gets an answer, not a blank prompt', () => {
  it('⭐ THE CAPTURED TURN: names the risk, says what happened, offers two moves that work', () => {
    const out = buildCoachingDegradeResponse(FRESH_USABLE, {
      violation: 'unsupported_evidence_or_confidence_claim',
      question: 'How likely is this?  Dilution and Control Risk',
      readinessNodes: RISK_NODES,
    });
    expect(out.assistant_text).toContain('Dilution and Control Risk');
    // The CAUSE, in terms the person can act on — and warranted by the
    // violation itself, which is the only thing this function actually knows.
    expect(out.assistant_text).toMatch(/claimed more than the model supports/i);
    // TWO next moves, both of which work on the very next turn with no new
    // capability. This is what the swept copy's "ask me what you'd like to
    // inspect or change next" does not give.
    expect(out.assistant_text).toMatch(/what you already believe/i);
    expect(out.assistant_text).toMatch(/what the model does record/i);
    // No futile re-run offer: a re-run cannot give a risk a probability.
    expect(out.suggested_actions).toEqual([]);
  });

  /**
   * ⛔ THE TWO CLAIMS THIS COPY MAY NEVER GROW, each a defect this estate has
   * already paid for. They are asserted as ABSENCES because the tempting edit
   * in both cases reads warmer and more helpful than the honest one.
   */
  it('⛔ never claims the quantity is absent — it cannot see node data', () => {
    const out = buildCoachingDegradeResponse(FRESH_USABLE, {
      violation: 'unsupported_evidence_or_confidence_claim',
      question: 'How likely is this?  Dilution and Control Risk',
      readinessNodes: RISK_NODES,
    });
    // `ReadinessRecoveryNode` is `{ id, kind, label }`. An absence claim from
    // an instrument that cannot observe presence is trap 13.
    expect(out.assistant_text).not.toMatch(/no (recorded )?(likelihood|probability|value)/i);
    expect(out.assistant_text).not.toMatch(/nothing recorded/i);
    expect(out.assistant_text).not.toMatch(/isn.t recorded|is not recorded/i);
  });

  it('⛔ never promises to record the person’s estimate — that is the Research CTA rebuilt', () => {
    const out = buildCoachingDegradeResponse(FRESH_USABLE, {
      violation: 'unsupported_evidence_or_confidence_claim',
      question: 'How likely is this?  Dilution and Control Risk',
      readinessNodes: RISK_NODES,
    });
    // Whether a probability can be persisted onto a risk node is Core's
    // question and is unsettled. Offering to store it would be a visible
    // affordance that terminates in refusal.
    expect(out.assistant_text).not.toMatch(/I.ll (record|save|store|add) it/i);
    expect(out.assistant_text).not.toMatch(/record it against/i);
  });

  it('answers without a subject too, when the question names no single entity', () => {
    const out = buildCoachingDegradeResponse(FRESH_USABLE, {
      violation: 'unsupported_evidence_or_confidence_claim',
      question: 'how likely is all this?',
      readinessNodes: RISK_NODES,
    });
    expect(out.assistant_text).toMatch(/claimed more than the model supports/i);
    expect(out.assistant_text).toMatch(/what the model does record/i);
    // Ambiguity refuses the subject rather than guessing one.
    expect(out.assistant_text).not.toContain('Dilution and Control Risk');
  });

  /**
   * ⭐⭐⭐ THE LOAD-BEARING TWIN. Every OTHER always-on violation keeps the
   * swept copy exactly. Without this, the change could have replaced the
   * ending for all of them and both positives above would still pass.
   */
  it('⭐ every other violation is byte-identical — the new ending is scoped to one', () => {
    const others = [
      'internal_field_exposed',
      'invented_mutation_success',
      'value_change_narration',
      'mutation_proposal_on_non_mutating_question',
      'run_availability_claim_after_refusal',
    ] as const;
    for (const violation of others) {
      const out = buildCoachingDegradeResponse(FRESH_USABLE, {
        violation,
        question: 'How likely is this?  Dilution and Control Risk',
        readinessNodes: RISK_NODES,
      });
      expect(out.assistant_text, violation).toContain('was not safe to show as-is');
      expect(out.assistant_text, violation).not.toMatch(/claimed more than the model supports/i);
    }
    // And with NO violation supplied at all — the pre-#1625 caller shape.
    const none = buildCoachingDegradeResponse(FRESH_USABLE, {
      question: 'How likely is this?  Dilution and Control Risk',
      readinessNodes: RISK_NODES,
    });
    expect(none.assistant_text).toContain('was not safe to show as-is');
  });

  it('a state-UNSAFE pack still takes its trust template — this arm is fresh-only', () => {
    const stale = { ...FRESH_USABLE, freshness: 'stale' } as unknown as CoachingStatePack;
    const out = buildCoachingDegradeResponse(stale, {
      violation: 'unsupported_evidence_or_confidence_claim',
      question: 'How likely is this?  Dilution and Control Risk',
      readinessNodes: RISK_NODES,
    });
    expect(out.assistant_text).not.toMatch(/claimed more than the model supports/i);
  });
});
