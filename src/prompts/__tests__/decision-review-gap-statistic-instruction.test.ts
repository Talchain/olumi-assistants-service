/**
 * F3 — the decision_review prompts must not ASK for the runner-up gap.
 *
 * ## Why this file exists
 *
 * The egress reader (`compose/runner-up-gap-statistic.ts`) removes the
 * statistic if it arrives. This file pins the other half: that we stopped
 * ASKING for it. Without it, part 1 of the F3 fix has no guard at all — a
 * future prompt edit could reinstate "include the margin as percentage points"
 * and every suite in the estate would stay green while the egress reader
 * silently redacted sentence 1 of every narrative.
 *
 * ## It reads the REGISTERED DEFAULT, not a copy
 *
 * `getDefaultPrompts()` returns exactly what `registerAllDefaultPrompts()`
 * registered — the bytes served on a PMS miss. Asserting against a re-typed
 * excerpt would be the hand-maintained mirror this repo keeps paying for
 * (CLAUDE.md trap #12).
 *
 * ## SCOPE, stated so it is not over-read
 *
 * These are the two prompts THIS REPO OWNS. The prompt staging actually serves
 * for the monolith path is the PMS row `decision_review_default`, whose
 * canonical bytes are `Prompts/canonical/decision_review.txt` — NOT covered
 * here, and NOT changed in this PR: a byte change there must clear the
 * eval-pass promotion gate with a passing eval report at the new hash. See the
 * PR body for the delta and the publish procedure.
 */

import { describe, expect, it } from 'vitest';

import { getDefaultPrompts } from '../loader.js';
import { registerAllDefaultPrompts } from '../defaults.js';
import {
  DECOMPOSE_R1_HEADLINE_PROMPT,
  DECOMPOSE_R2_DRIVER_PROMPT,
  DECOMPOSE_R3_FRAGILITY_PROMPT,
  DECOMPOSE_R4_CALIBRATION_PROMPT,
} from '../../cee/decision-review/decompose-prompts.js';

/**
 * All four decomposed sub-prompts, because the ban lives in the SHARED voice
 * block injected into every one of them. Asserting only R1 would leave the
 * other three free to drift — trap 3b at the prompt grain.
 */
const DECOMPOSED_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['R1 headline', DECOMPOSE_R1_HEADLINE_PROMPT],
  ['R2 driver', DECOMPOSE_R2_DRIVER_PROMPT],
  ['R3 fragility', DECOMPOSE_R3_FRAGILITY_PROMPT],
  ['R4 calibration', DECOMPOSE_R4_CALIBRATION_PROMPT],
];

registerAllDefaultPrompts();

/**
 * The instruction shapes that ASK for a gap between two options. Each is a
 * phrase one of these prompts ACTUALLY CARRIED before this PR, not a
 * speculative one — so a revert of the fix reinstates a member of this list.
 */
const GAP_INSTRUCTIONS: readonly string[] = [
  'include margin as percentage points',
  'include the margin as percentage points',
  'Quote it as percentage points',
  'a narrow lead of about',
  '0.07 → "7 percentage points"',
  "0.07 → 'about 7 percentage points'",
  '0.07 becomes "7 percentage points"',
];

/** The ratified-correct statistic (PR #906's sentence family). */
const WIN_PROBABILITY_INSTRUCTION = 'came out ahead in';

function decisionReviewDefault(): string {
  const text = getDefaultPrompts().decision_review;
  // Trap 13: an absence assertion needs a positive control. If the registry
  // ever returned undefined, every `not.toContain` below would throw rather
  // than pass silently — but assert it anyway, by name.
  expect(typeof text, 'decision_review default must be registered').toBe('string');
  expect((text as string).length).toBeGreaterThan(5_000);
  return text as string;
}

describe('decision_review prompts do not ask for a runner-up gap statistic (F3)', () => {
  it.each(GAP_INSTRUCTIONS)('monolith default does not carry: %s', (phrase) => {
    expect(decisionReviewDefault()).not.toContain(phrase);
  });

  it.each(DECOMPOSED_PROMPTS)('decomposed %s prompt carries no gap instruction', (_name, text) => {
    for (const phrase of GAP_INSTRUCTIONS) expect(text).not.toContain(phrase);
  });

  it('BOTH owned prompts require the leading option’s OWN win probability instead', () => {
    // The positive half. An absence-only guard is satisfied by a prompt that
    // says nothing at all about the statistic — which would hand the model a
    // free choice, and the model's default IS the gap (that is how this defect
    // reached the wire).
    expect(decisionReviewDefault()).toContain(WIN_PROBABILITY_INSTRUCTION);
    expect(DECOMPOSE_R1_HEADLINE_PROMPT).toContain(WIN_PROBABILITY_INSTRUCTION);
  });

  it.each(DECOMPOSED_PROMPTS)('%s states the ban explicitly, not only by omission', (_name, text) => {
    expect(text).toContain('NEVER express the distance between two options');
  });

  it('the monolith default states the ban explicitly too', () => {
    expect(decisionReviewDefault()).toContain('NEVER express the distance between two options');
  });

  it('the corpus is non-trivial', () => {
    expect(GAP_INSTRUCTIONS.length).toBeGreaterThanOrEqual(7);
    expect(DECOMPOSED_PROMPTS.length).toBe(4);
  });
});
