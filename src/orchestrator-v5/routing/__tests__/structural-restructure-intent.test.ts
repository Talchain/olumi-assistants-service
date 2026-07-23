import { describe, it, expect } from 'vitest';

import {
  detectStructuralRestructureIntent,
  type StructuralRestructureTrigger,
} from '../structural-restructure-intent.js';

/**
 * Detector for the free-text "split the shared factor into per-option links"
 * class (LATENCY-RECAPTURE finding 3 / probe 69a2f44f). Positive-biased
 * (a false positive costs one edit-lane turn; a false negative is the live
 * four-turn-nothing loop), but tight enough to keep casual per-option /
 * each-option mentions out.
 */
describe('detectStructuralRestructureIntent', () => {
  describe('matches restructure requests', () => {
    const positives: ReadonlyArray<[string, StructuralRestructureTrigger]> = [
      // The live probe message (the exact reproduction target).
      ['split the shared factor into per-option links', 'per_option_term'],
      ['Split the shared factor into per-option links.', 'per_option_term'],
      ['can you split the shared cost driver into per option links', 'per_option_term'],
      ['make the shared factor per-option', 'per_option_term'],
      ['turn the shared factor into per-option effects', 'per_option_term'],
      ['duplicate the driver as an option-specific factor', 'per_option_term'],
      ['separate the shared factor into option specific links', 'per_option_term'],
      // The "each option gets its own X" framing (no per-option term).
      ['give each option its own cost factor', 'each_option_own'],
      ['each option should have its own quality driver', 'each_option_own'],
      ['I want a dedicated factor so their own value differs for every option', 'each_option_own'],
    ];
    it.each(positives)('%s → %s', (message, expectedTrigger) => {
      const result = detectStructuralRestructureIntent(message);
      expect(result.matched).toBe(true);
      if (result.matched) expect(result.trigger).toBe(expectedTrigger);
    });
  });

  describe('does NOT match non-restructure text (safe-bias upper bound)', () => {
    const negatives: ReadonlyArray<string> = [
      // Casual / idiomatic uses of a restructure verb without the per-option term.
      "let's split the difference",
      'split this into two conversations',
      'make it clearer',
      'give me a summary',
      // The per-option / each-option term WITHOUT a restructure verb or the
      // "own" clause — a mention, not a request to restructure.
      'the per-option values look off',
      'which factor matters for each option?',
      'show me the goal-fit for each option',
      // "make sense of each option" — the exact false-positive the two-signal
      // gate is designed to exclude (make + each option, but no per-option
      // term and no "own" clause).
      'help me make sense of each option',
      // Empty / non-string.
      '',
    ];
    it.each(negatives)('%s → no match', (message) => {
      expect(detectStructuralRestructureIntent(message).matched).toBe(false);
    });
  });

  /**
   * Interrogative / state-question gate (#644 adversarial P2-1). The review
   * reproduced five FALSE POSITIVES — genuine QUESTIONS that the base detector
   * matched, minting a held proposal + confirm chip instead of a coach
   * discussion. A question about restructuring ("should I make the cost
   * per-option?") or a pure STATE question ("does each option have its own
   * cost factor?") is a request for COACHING; it must reach the coach, never
   * the edit lane. This gate is symmetric with the configure-option sibling's
   * internal question suppressor (configure-option-intent.ts).
   *
   * MUTATION PIN: remove the interrogative gate from
   * detectStructuralRestructureIntent → every case here goes RED (the base
   * detector matches all five, verified against origin/staging fc36930).
   */
  describe('routes QUESTIONS to the coach, not the edit lane (interrogative/state-question gate)', () => {
    const questionFalsePositives: ReadonlyArray<string> = [
      // The five reviewer-reproduced false positives (exact strings).
      'should I make the cost factor per-option?',
      'should I split the cost into per-option links?',
      'would it be better to give each option its own cost factor?',
      'do you think each option should have its own driver?',
      // The clearest miss — a PURE STATE question ("its own" clause present,
      // yet plainly a question, not a restructure request).
      'does each option have its own cost factor?',
    ];
    it.each(questionFalsePositives)('%s → no match (reaches the coach)', (message) => {
      expect(detectStructuralRestructureIntent(message).matched).toBe(false);
    });

    // The gate is a QUESTION gate, not a dropped-"?" over-correction: an
    // interrogative LEAD suppresses even without the trailing "?" (chat users
    // drop it), catching the same deliberation/state shape.
    const questionLeadsNoMark: ReadonlyArray<string> = [
      'should I split the cost into per-option links',
      'does each option have its own cost factor',
    ];
    it.each(questionLeadsNoMark)('%s → no match (interrogative lead, no trailing "?")', (message) => {
      expect(detectStructuralRestructureIntent(message).matched).toBe(false);
    });
  });

  /**
   * SAFE-BIAS LOWER BOUND (do NOT over-correct — #644 acceptance regression).
   * An IMPERATIVE restructure carries neither question signal and MUST still
   * reach the edit lane. Includes the polite-imperative "can you split …" form
   * (a request to ACT, not a question) — the gate deliberately omits the
   * can/could request modals so this #644 acceptance case survives.
   *
   * MUTATION PIN: these stay GREEN with OR without the interrogative gate; if
   * the gate over-reaches (e.g. suppresses on any question-word or a bare
   * "can"), the "can you split …" case goes RED.
   */
  describe('IMPERATIVE restructures still route to the edit lane (no over-correction)', () => {
    const imperativePositives: ReadonlyArray<[string, StructuralRestructureTrigger]> = [
      ['split the cost into per-option links', 'per_option_term'],
      ['give each option its own driver', 'each_option_own'],
      // Polite imperative — phrased with "can you" but a request to ACT.
      ['can you split the shared cost driver into per option links', 'per_option_term'],
      // A declarative desired-state statement that contains the word "should"
      // mid-sentence — NOT a question (no leading interrogative, no "?").
      ['each option should have its own quality driver', 'each_option_own'],
    ];
    it.each(imperativePositives)('%s → %s (edit lane)', (message, expectedTrigger) => {
      const result = detectStructuralRestructureIntent(message);
      expect(result.matched).toBe(true);
      if (result.matched) expect(result.trigger).toBe(expectedTrigger);
    });
  });

  it('is total — never throws on odd input', () => {
    expect(() => detectStructuralRestructureIntent(undefined as unknown as string)).not.toThrow();
    expect(detectStructuralRestructureIntent(undefined as unknown as string).matched).toBe(false);
    expect(detectStructuralRestructureIntent('   ').matched).toBe(false);
  });
});
