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
import { formatUnitAmbiguityClarify } from '../add-constraint.js';
import * as guidanceModule from '../d1-shared/user-guidance.js';
import {
  ADD_CONSTRAINT_USER_GUIDANCE,
  SET_FACTOR_VALUE_USER_GUIDANCE,
  ADJUST_EDGE_STRENGTH_USER_GUIDANCE,
  SUCCESS_TARGET_POSITIVE_USER_GUIDANCE,
} from '../d1-shared/user-guidance.js';

/** The War-Room-locked canonical phrases, imported — never restated here. */
const CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ['add_constraint', ADD_CONSTRAINT_USER_GUIDANCE],
  ['set_factor_value', SET_FACTOR_VALUE_USER_GUIDANCE],
  ['adjust_edge_strength', ADJUST_EDGE_STRENGTH_USER_GUIDANCE],
  // ⭐ ADDED WITH #1661, and the guard below is why it is here rather than
  // implicitly covered. That PR reasoned it should be an EXPORTED constant
  // precisely so this file's union assertion would see it — which is right, and
  // incomplete: the union assertion NOTICES an uncovered export, it does not
  // budget-check one. The entry is what puts the phrase through the real
  // sanitiser, with headroom, alongside its three siblings.
  ['success_target_positive', SUCCESS_TARGET_POSITIVE_USER_GUIDANCE],
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
   * ⭐⭐ THE ONE SITE THAT PASSES A *SPECIFIC* GUIDANCE — and it INTERPOLATES,
   * which is how a length budget is defeated by its own data.
   *
   * Measured: the skeleton is 65 characters and the value appears TWICE, so the
   * budget is ~17.5 characters PER VALUE. Ordinary figures are nowhere near it
   * (`30` -> 69 chars, `30000` -> 75, `MAX_SAFE_INTEGER` -> 97).
   *
   * ⛔ BUT FLOAT NOISE EXCEEDS IT, AND FLOAT NOISE IS WHAT ARITHMETIC PRODUCES.
   * `0.1 + 0.2` stringifies as `0.30000000000000004` — 19 characters — giving
   * **103**, and its negative gives **105**. Both truncate, so the product's
   * clarifying question is cut mid-sentence and the user cannot act on it.
   * That is `66651370`'s defect exactly, in the one sentence that was sized
   * against this budget by hand.
   *
   * ⚠ REACHABILITY IS **NOT** MEASURED AND IS NOT CLAIMED. `params.value` is the
   * user's parsed figure; whether a normalisation-derived value with full float
   * precision reaches this formatter has not been established. **Pinned as a
   * measured boundary, not reported as a live user harm** — the honest form for
   * a gap whose reachability is unknown.
   */
  it('the specific clarify survives for the values a user actually states', () => {
    for (const v of [30, 0.3, 30000, 12.5, Number.MAX_SAFE_INTEGER]) {
      const s = formatUnitAmbiguityClarify(v);
      expect(sanitiseForUser(s), `value ${v} must reach the user whole`).toBe(s);
    }
  });

  it('KNOWN-DROPPED: full-precision float noise TRUNCATES it — pinned, not fixed', () => {
    // ⛔ Do not "fix" this by shaving the skeleton — it is already 65 chars and
    // the value appears twice, so every character saved buys only half a
    // character of value budget. The real remedies are to format the value for
    // display or to interpolate it once, and BOTH change what the user reads,
    // which is a decision rather than a tidy-up.
    const noisy = 0.1 + 0.2; // 0.30000000000000004
    const s = formatUnitAmbiguityClarify(noisy);
    expect(s.length, 'the boundary this pins').toBeGreaterThan(100);
    expect(
      sanitiseForUser(s),
      'if this ever survives intact the budget or the formatter changed — re-derive, do not delete',
    ).not.toBe(s);
  });

  /**
   * ⚠ SCOPE, STATED RATHER THAN IMPLIED. `formatUnitAmbiguityClarify`
   * is now EXPORTED and covered above. **Anyone wiring a second specific
   * guidance should export it and cover it here too** — this file is the place
   * that makes the budget enforceable instead of a comment.
   */
  /**
   * ⭐⭐ THE COMPLETENESS CHECK — because THIS FILE had the same defect it was
   * written to kill.
   *
   * `CANONICAL` above is a HAND-WRITTEN list. My first version pinned it with
   * `expect(CANONICAL).toHaveLength(3)` — **a hand-maintained number guarding a
   * hand-maintained list**, which is the mirror this file exists to remove,
   * reappearing inside it. It would have stayed green forever while a fourth
   * handler's phrase went unguarded.
   *
   * CLAUDE.md trap 12d states the rule: **a derived guard proves AGREEMENT and
   * can never prove COMPLETENESS** — and the only importable cure is a UNION
   * ASSERTION. So the covered set is checked against the module's OWN exports,
   * read at runtime. Add a fourth `*_USER_GUIDANCE` and this REDs by name.
   */
  it('covers EVERY exported *_USER_GUIDANCE — derived from the module, not listed here', () => {
    const exported = Object.entries(guidanceModule)
      .filter(([k, v]) => k.endsWith('_USER_GUIDANCE') && typeof v === 'string')
      .map(([k, v]) => [k, v as string] as const);

    // ⛔ POSITIVE CONTROL: if the import ever resolves to an empty or renamed
    // module, `missing` would be trivially empty and this test would pass by
    // seeing nothing. An absence claim needs a presence first (trap 13).
    expect(exported.length, 'the module must expose guidance constants at all').toBeGreaterThan(0);

    const covered = new Set(CANONICAL.map(([, phrase]) => phrase));
    const missing = exported.filter(([, phrase]) => !covered.has(phrase)).map(([name]) => name);
    expect(
      missing,
      'these guidance phrases are exported but NOT budget-checked — add them to CANONICAL',
    ).toEqual([]);
  });
});
