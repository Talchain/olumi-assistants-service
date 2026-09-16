/**
 * The advise-on-modelling question class must have a ROUTING DESTINATION.
 *
 * MEASURED LOSS THIS PINS (staging build `1b50150`, request
 * c55a2800-cae3-420f-b071-79cfed67aadd, 16 Sep 2026 11:14 UTC):
 *   user message : "How do you recommend we add the author event's effort
 *                   level to the decision?"
 *   telemetry    : v5.explanation.answer_verdict
 *                  handler_id=explain_from_structure
 *                  answer_text_valid=false
 *                  answer_validation_error="mutation_language_detected"
 *                  answer_text_length=974  evidence_used_count=3
 *   served       : the whole-model structural recap ("Your decision around …
 *                  is shaped by several causal mechanisms. …"), 643 chars —
 *                  an answer to a question the user did not ask, and
 *                  BYTE-IDENTICAL across five different messages.
 *
 * `isAnalyticalQuestion` already RECOGNISES this class — it is what keeps the
 * turn out of the edit lane — but it is consumed only as a veto, so the
 * classification dies at the routing boundary and the handler cannot tell an
 * advise-on-modelling turn from a structural one.
 *
 * This suite pins the classification that is carried forward, and the
 * DISCRIMINATOR: a genuine structure question must keep reaching the
 * structural answer unchanged.
 */

import { describe, expect, it } from 'vitest';

import {
  ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS,
  ADVICE_SEEKING_QUESTION_PATTERNS,
  ADVISE_ON_MODELLING_PATTERNS,
  isAdviseOnModellingQuestion,
  isAnalyticalQuestion,
} from '../analytical-question-guard.js';

/** The captured message. Reproduced verbatim from the attempt payload. */
const CAPTURED_ADVISE_QUESTION =
  "How do you recommend we add the author event's effort level to the decision?";

/**
 * ADVISE-ON-MODELLING — the user is asking how to REPRESENT something in the
 * model. Every member is bound to the class by its own wording, not by a
 * shared value another message could satisfy.
 */
const ADVISE_ON_MODELLING_MESSAGES: readonly string[] = [
  CAPTURED_ADVISE_QUESTION,
  'How do you recommend we handle the risk of churn?',
  'How would you suggest we capture supplier reliability?',
  'How should I propose we deal with the seasonality effect?',
  'What should we change about the way effort is represented?',
  'What should I improve here?',
];

/**
 * GENUINE STRUCTURE QUESTIONS — the discriminator. These must NOT be claimed
 * by the advise class; they are answered from the saved structure and that
 * path is preserved exactly as it is.
 */
const STRUCTURE_QUESTIONS: readonly string[] = [
  'What most influences my decision?',
  'What depends on Pricing?',
  'What does Engineering Capacity affect?',
  'How do Engineering Capacity and Hiring Cost compare?',
  'Why might this option be leading?',
];

/**
 * NOT ADVISE-ON-MODELLING even though the shared veto claims them. `should
 * we` is a SUBSTANTIVE DECISION question ("should we hire A or B"), not a
 * question about how to model something — two questions under one name
 * (CLAUDE.md trap 21), so the carried classification is deliberately a NAMED
 * SUBSET of the veto rather than the veto itself.
 */
const DECISION_QUESTIONS_INSIDE_THE_VETO: readonly string[] = [
  'Should we hire a tech lead or two developers to increase productivity?',
  'Should I keep the current schedule?',
];

/** Messages carrying a concrete edit clause — an instruction, never advice. */
const MIXED_COMMAND_MESSAGES: readonly string[] = [
  'Add a risk for churn. Should we hire a tech lead?',
  'How do you recommend we manage morale? Add a factor for team mood.',
  'Add a factor called "Should we hire contractors?"',
];

describe('advise-on-modelling: the carried classification', () => {
  it('claims the CAPTURED advise-on-modelling question', () => {
    expect(isAdviseOnModellingQuestion(CAPTURED_ADVISE_QUESTION)).toBe(true);
  });

  it('claims every advise-on-modelling message', () => {
    for (const message of ADVISE_ON_MODELLING_MESSAGES) {
      expect(isAdviseOnModellingQuestion(message), message).toBe(true);
    }
  });

  it('DISCRIMINATOR: claims no genuine structure question', () => {
    for (const message of STRUCTURE_QUESTIONS) {
      expect(isAdviseOnModellingQuestion(message), message).toBe(false);
    }
  });

  it('does not claim a substantive decision question the veto also holds', () => {
    for (const message of DECISION_QUESTIONS_INSIDE_THE_VETO) {
      // Inside the veto …
      expect(isAnalyticalQuestion(message), message).toBe(true);
      // … but NOT advise-on-modelling.
      expect(isAdviseOnModellingQuestion(message), message).toBe(false);
    }
  });

  it('does not claim a message that also issues a concrete command', () => {
    for (const message of MIXED_COMMAND_MESSAGES) {
      expect(isAdviseOnModellingQuestion(message), message).toBe(false);
    }
  });

  /**
   * DERIVED CONTAINMENT, not a hand-maintained mirror. The carried
   * classification is built from the SAME RegExp OBJECTS the veto consults, so
   * it can never widen past the veto. Asserted over the corpus AND by set
   * membership on the objects themselves (identity, not source text), so
   * swapping a pattern for an equal-looking copy fails here.
   */
  it('is a strict SUBSET of the veto, by execution and by object identity', () => {
    const everyMessage = [
      ...ADVISE_ON_MODELLING_MESSAGES,
      ...STRUCTURE_QUESTIONS,
      ...DECISION_QUESTIONS_INSIDE_THE_VETO,
      ...MIXED_COMMAND_MESSAGES,
    ];
    for (const message of everyMessage) {
      if (isAdviseOnModellingQuestion(message)) {
        expect(isAnalyticalQuestion(message), `escaped the veto: ${message}`).toBe(true);
      }
    }
    // Non-empty, or the loop above is vacuous.
    expect(everyMessage.filter(isAdviseOnModellingQuestion).length).toBeGreaterThan(0);
    expect(ADVISE_ON_MODELLING_PATTERNS.length).toBe(2);
  });

  /**
   * ⭐ NO SECOND COPY. `toContain` compares by reference, so each carried
   * pattern must be the SAME OBJECT the veto consults. Re-spelling one as an
   * equal-looking literal inside either veto array REDs here — which is the
   * only route by which a hand-maintained mirror could appear.
   */
  it('shares its patterns with the veto BY OBJECT IDENTITY, not by copy', () => {
    const [recommendationPattern, whatShouldPattern] = ADVISE_ON_MODELLING_PATTERNS;
    expect(ADVICE_SEEKING_QUESTION_PATTERNS).toContain(recommendationPattern);
    expect(ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS).toContain(whatShouldPattern);
  });
});
