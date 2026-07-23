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

  it('is total — never throws on odd input', () => {
    expect(() => detectStructuralRestructureIntent(undefined as unknown as string)).not.toThrow();
    expect(detectStructuralRestructureIntent(undefined as unknown as string).matched).toBe(false);
    expect(detectStructuralRestructureIntent('   ').matched).toBe(false);
  });
});
