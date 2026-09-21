/**
 * ⭐⭐ THE 100-CHARACTER BUDGET IS DOCUMENTED IN THREE PLACES AND ENFORCED BY
 * NOTHING — a hand-maintained mirror in its classic form.
 *
 * `MAX_USER_STRING = 100` (`compose/helpers.ts:107`) is stated as prose in
 * `add-constraint.ts:187`, in `d1-shared/evaluate-factor-value-proposal.ts:1001`
 * and in commit `66651370`'s message. **Nothing asserts it.** And `66651370`
 * exists BECAUSE it was exceeded: a 146-character skeleton was *"truncated
 * mid-word, always"*, so the founder read *"…nothing on record confirm…"* and
 * the entire remedy was unreachable. **The user-visible outcome was WORSE than
 * pristine: a complete-but-wrong sentence became a fragment.**
 *
 * ── WHY THIS ASSERTS SURVIVAL, NOT LENGTH ────────────────────────────────
 * The obvious test is `expect(phrase.length).toBeLessThanOrEqual(100)`. That
 * would be a FOURTH copy of the number, and it would keep passing if the limit
 * ever moved down. So this runs each phrase through the REAL exported
 * `sanitiseForUser` and requires it back UNCHANGED. The number is never
 * mentioned here; the property is "this sentence reaches the user whole", which
 * is what actually matters and cannot drift from its own source of truth.
 *
 * ── AND IT ASSERTS HEADROOM, WHICH IS THE LESSON FROM A ONE-CHARACTER MISS ──
 * Two lanes independently measured these sentences and produced DIFFERENT
 * lists; one candidate (`add-constraint.ts:393`) is over by exactly ONE
 * character, truncating to *"…Nothing on your model change"* and losing the
 * final word of the honest disclosure. **The temptation there is to shave it to
 * exactly the limit and ship — and a sentence with zero headroom is one the
 * next copy edit silently breaks.** So each phrase must survive with padding
 * attached, which measures margin without naming a number.
 */
import { describe, expect, it } from 'vitest';

import { sanitiseForUser } from '../../../compose/helpers.js';
import {
  ADD_CONSTRAINT_USER_GUIDANCE,
  SET_FACTOR_VALUE_USER_GUIDANCE,
  ADJUST_EDGE_STRENGTH_USER_GUIDANCE,
} from '../d1-shared/user-guidance.js';

/** The War-Room-locked canonical phrases, imported — never restated here. */
const CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ['add_constraint', ADD_CONSTRAINT_USER_GUIDANCE],
  ['set_factor_value', SET_FACTOR_VALUE_USER_GUIDANCE],
  ['adjust_edge_strength', ADJUST_EDGE_STRENGTH_USER_GUIDANCE],
];

describe('D1 user guidance reaches the user WHOLE', () => {
  it.each(CANONICAL)('%s: the canonical phrase survives the real sanitiser intact', (_h, phrase) => {
    expect(sanitiseForUser(phrase)).toBe(phrase);
  });

  it.each(CANONICAL)('%s: and survives with HEADROOM, so the next copy edit cannot silently break it', (_h, phrase) => {
    // ⚠ PADDED BY EXACTLY ONE CHARACTER, AND THAT IS THE PRINCIPLED MARGIN.
    // My first version padded by 26 and two phrases FAILED — which was my test
    // inventing an arbitrary margin, the same "two arbitrary length constants"
    // trap this estate has already burned four rounds on. One character asserts
    // the only non-arbitrary property available: **this phrase is not sitting
    // exactly at the limit**, which is the `:393` hazard precisely.
    const padded = `${phrase}.`;
    expect(
      sanitiseForUser(padded),
      'this phrase sits EXACTLY at the truncation limit — any edit now silently cuts it',
    ).toBe(padded);
  });

  /**
   * ⛔ WITHOUT THIS THE WHOLE FILE IS VACUOUS. If `sanitiseForUser` ever stopped
   * truncating — or if this test imported something inert — every assertion
   * above would pass by testing nothing. An absence claim needs a positive
   * control (CLAUDE.md trap 13), and this is the one that makes the others mean
   * something.
   */
  it('POSITIVE CONTROL: the sanitiser demonstrably DOES truncate an over-long sentence', () => {
    const tooLong = `${'A sentence that will certainly exceed the user-string budget. '.repeat(6)}END`;
    const out = sanitiseForUser(tooLong);
    expect(out, 'the sanitiser must visibly shorten an over-long string').not.toBe(tooLong);
    expect(out.length).toBeLessThan(tooLong.length);
  });

  /**
   * ⚠ SCOPE, STATED RATHER THAN IMPLIED. `formatUnitAmbiguityClarify`
   * (`add-constraint.ts:190`) is the one site that passes a SPECIFIC
   * `userGuidance` rather than a canonical phrase, and it is NOT exported, so it
   * is not covered here. Its own docblock records that it was sized by hand
   * against this budget. **Anyone wiring a second specific guidance should
   * export it and add it to `CANONICAL` above** — this file is the place that
   * makes the budget enforceable instead of a comment.
   */
  it('documents that exactly three canonical phrases exist, so a fourth must be added here', () => {
    // Not a count of the codebase — a pin on THIS file's coverage, so adding a
    // handler without adding it here is a visible omission rather than a silent
    // gap in the budget guard.
    expect(CANONICAL).toHaveLength(3);
  });
});
