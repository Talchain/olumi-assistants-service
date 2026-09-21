/**
 * ⛔⛔ NO USER-FACING ADMISSION MESSAGE MAY FRAME OLUMI AS NAMING A LEADER.
 *
 * Paul's standing product ruling: Olumi does not select a winner or recommend
 * an option, in any wording. It may say an option is more likely to produce a
 * stated outcome, more likely to meet the user's goal, or that an outcome is
 * more probable under one option than another — and what evidence would change
 * that. The claim is about the LIKELIHOOD OF AN OUTCOME, never the superiority
 * of an option.
 *
 * ⚠ SO "NO LEADER YET" IS THE WRONG REFUSAL. It implies a leader exists and is
 * merely being withheld, which is the belief the whole doctrine denies. All
 * four messages previously carried it, including "so a leading option can be
 * named" — the product promising a leader once conditions are met.
 *
 * MEASURED, not assumed: on a real staging turn (21 Sep 2026) the
 * `all_machine_authored` message was the only leader-framed string present in
 * the served payload, so this is copy users actually meet.
 *
 * ⭐ THIS READS THE REAL MAP, not a copy, so a new `SemanticVerdictCause` added
 * without doctrine-safe copy fails here rather than shipping.
 */
import { describe, expect, it } from 'vitest';

import { SEMANTIC_REASON_FOR_TESTS } from '../analysis-admission.js';

/** Phrases that assert, or presuppose, a ranked option. */
const FORBIDDEN = [
  'the leader',
  'a leader',
  'leading option',
  'winner',
  'wins',
  'win rate',
  'recommend',
  'the best choice',
  'you should choose',
  'comes out ahead',
  'performs best',
  'front-runner',
  'overtake',
  'beats',
];

const MESSAGES = Object.entries(SEMANTIC_REASON_FOR_TESTS).map(
  ([cause, v]) => [cause, (v as { message: string }).message] as const,
);

describe('admission copy never frames Olumi as naming a leader', () => {
  it('the map is non-empty and really is the served one', () => {
    expect(MESSAGES.length).toBeGreaterThanOrEqual(4);
    for (const [, m] of MESSAGES) expect(typeof m).toBe('string');
  });

  it.each(MESSAGES)('%s carries no ranked-option framing', (_cause, message) => {
    const lower = message.toLowerCase();
    for (const phrase of FORBIDDEN) {
      expect(lower.includes(phrase), `"${phrase}" in: ${message}`).toBe(false);
    }
  });

  /**
   * ⭐ THE POSITIVE HALF. Removing the forbidden words is not enough — the
   * message must still tell the user what cannot be said and why. A message
   * that merely deleted the claim would pass the case above and say nothing.
   */
  it.each(MESSAGES)('%s still states the claim in goal-likelihood terms', (_cause, message) => {
    expect(message.toLowerCase()).toContain('how likely');
    expect(message.toLowerCase()).toMatch(/your goal|to reach it/);
  });
});
