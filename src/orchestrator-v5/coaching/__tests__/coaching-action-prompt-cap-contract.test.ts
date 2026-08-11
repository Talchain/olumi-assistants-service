/**
 * THE DERIVED GUARD FOR A HAND-MAINTAINED MIRROR OF A CONTRACT CAP.
 *
 * ⚠ NAMING THE TRAP, BECAUSE THAT IS THE POINT OF THIS FILE (CLAUDE.md trap 12).
 * `coaching/fragile-edge-offer-text.ts` declares
 *
 *     export const COACHING_ACTION_PROMPT_MAX = 300;
 *
 * and that number is a HAND-WRITTEN MIRROR of `PHASE3_ACTION_PROMPT_MAX`, a
 * MODULE-PRIVATE constant inside vendored `@talchain/schemas@0.39.0`
 * (`dist/boundary/blocks.js:431`). It cannot be imported: the package does not
 * export it, only the schema that applies it. So the estate's dominant defect
 * class is live here by construction — a list a human must remember to sync,
 * whose drift reads as green.
 *
 * The schemas package's own comment records that the cap is DERIVED from
 * `PHASE3_BODY_MAX` "by derivation, not by definition", i.e. it is explicitly
 * expected to move independently one day. When it moves, `isOverrideActionComposable`
 * would silently start admitting prompts the contract rejects (a dropped block —
 * a finding the user never sees) or rejecting prompts it accepts (a missing
 * chip). Neither fails loudly anywhere.
 *
 * A derivation is impossible, so this is the next best thing and the only thing
 * that CAN notice: a BOUNDARY PROBE. It asks the real schema to validate a
 * prompt of exactly `COACHING_ACTION_PROMPT_MAX` characters (must PASS) and one
 * of exactly one more (must FAIL). Either half moving turns this RED by name,
 * on a schemas bump, in CI — which is the whole ask.
 */

import { describe, it, expect } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import { maximalCoachingBlock } from '@talchain/schemas/fixtures';

import { COACHING_ACTION_PROMPT_MAX } from '../fragile-edge-offer-text.js';

/** The vendored package's own maximal fixture, with one field replaced. */
function blockWithActionPrompt(length: number): unknown {
  return {
    ...(maximalCoachingBlock as unknown as Record<string, unknown>),
    action_prompt: 'a'.repeat(length),
  };
}

describe('COACHING_ACTION_PROMPT_MAX mirrors the contract cap — boundary probe', () => {
  it('PRECONDITION: the unmodified fixture validates, so the probe can discriminate', () => {
    // Trap 13: without this, a fixture that failed for an unrelated reason would
    // make the "301 is rejected" assertion pass for the wrong reason, and the
    // guard would be certifying nothing.
    expect(CoachingBlockSchema.safeParse(maximalCoachingBlock).success).toBe(true);
  });

  it('a prompt of exactly COACHING_ACTION_PROMPT_MAX characters VALIDATES', () => {
    const result = CoachingBlockSchema.safeParse(blockWithActionPrompt(COACHING_ACTION_PROMPT_MAX));
    expect(
      result.success,
      `the contract rejected a prompt of ${COACHING_ACTION_PROMPT_MAX} chars — ` +
        'COACHING_ACTION_PROMPT_MAX in coaching/fragile-edge-offer-text.ts is now LOOSER than ' +
        "the schemas cap it mirrors, so the composability gate admits prompts the contract drops. " +
        'Re-read PHASE3_ACTION_PROMPT_MAX in @talchain/schemas dist/boundary/blocks.js and update it.',
    ).toBe(true);
  });

  it('a prompt of exactly one character MORE is REJECTED', () => {
    const result = CoachingBlockSchema.safeParse(
      blockWithActionPrompt(COACHING_ACTION_PROMPT_MAX + 1),
    );
    expect(
      result.success,
      `the contract accepted a prompt of ${COACHING_ACTION_PROMPT_MAX + 1} chars — ` +
        'COACHING_ACTION_PROMPT_MAX in coaching/fragile-edge-offer-text.ts is now TIGHTER than ' +
        'the schemas cap it mirrors, so the composability gate refuses action chips the contract ' +
        'would have carried. Re-read PHASE3_ACTION_PROMPT_MAX and update it.',
    ).toBe(false);
  });

  it('the rejection is about LENGTH and about action_prompt specifically', () => {
    // Bind by identity, not by "something failed" (trap 19): a fixture that
    // broke for an unrelated reason would satisfy the assertion above.
    const result = CoachingBlockSchema.safeParse(
      blockWithActionPrompt(COACHING_ACTION_PROMPT_MAX + 1),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'action_prompt');
    expect(issue, 'the failure was not about action_prompt — the probe is measuring something else').toBeDefined();
    expect(issue!.code).toBe('too_big');
  });
});
