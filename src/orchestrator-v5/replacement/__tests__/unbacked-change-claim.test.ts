/**
 * ⭐⭐ THE LAYER CAN CLAIM A SAVE IT DID NOT MAKE — pinned, not fixed.
 *
 * Demonstrated by scripting the model to say "I've updated the model" on a turn
 * whose write was REFUSED: the claim reaches the caller verbatim. There is no
 * truthfulness guard on this exit.
 *
 * ⛔ THIS FILE DOES NOT FIX IT. Suppressing or rewriting the claim means
 * choosing what the product says instead — a copy decision, and not this
 * lane's to take. What IS takeable is making the lie COUNTABLE, so the
 * eventual remedy has a measurement to be judged against instead of a
 * plausible story (CLAUDE.md trap 23: name the OUTCOME metric before the fix).
 *
 * ⭐ A reviewer asked for exactly this, and was right that I had applied my own
 * standard inconsistently: #1654's docblock says *"a gap a suite can see is
 * honest; a gap invisible to it is how this shipped"* — and I applied that to
 * the goal-baseline gap while leaving this one unpinned in the same session.
 *
 * ⚠⚠ THE FLOOR, NOT THE COUNT. Both detectors are pattern-based, and the
 * KNOWN_MISSED block below pins sentences that ARE unbacked claims and that
 * BOTH detectors fail to see. The structural detector anchors on graph NOUNS,
 * so a VALUE claim falls outside it — and value claims are exactly what this
 * layer produces. **A zero from this detector means "no pattern matched",
 * never "the reply was honest."** The set is asserted EXACTLY, so it REDs if
 * the blind spot grows OR shrinks.
 */
import { describe, expect, it } from 'vitest';

import { detectUnbackedChangeClaim } from '../turn-trace.js';
import { findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';
import { containsStructuralSuccessClaim } from '../../routing/mutation-language.js';

// The REAL detectors, never a local re-implementation — a private copy would
// drift from the thing that actually runs (trap 12).
const DETECTORS = { findSuccessClaimHit, containsStructuralSuccessClaim };

const NO_RECEIPT = { receipt_id: null };
const WITH_RECEIPT = { receipt_id: 'rcp-0001' };

describe('a change claimed without a receipt is recorded as exactly that', () => {
  it('FIRES: the reply asserts a change and the turn holds no receipt', () => {
    const hit = detectUnbackedChangeClaim(
      "I've updated the model with those estimates.",
      NO_RECEIPT,
      DETECTORS,
    );
    expect(hit, 'an unbacked change claim must be recorded').not.toBeNull();
  });

  /**
   * ⭐ THE DISCRIMINATING TWIN. Without this, the detector could be firing on
   * the TEXT alone and the receipt term could be dead — the rule is about the
   * pair, so both arms must be shown.
   */
  it('SILENT: the identical sentence with a receipt is a true statement, not a finding', () => {
    expect(
      detectUnbackedChangeClaim("I've updated the model with those estimates.", WITH_RECEIPT, DETECTORS),
      'holding a receipt, a claim of change is TRUE — flagging it would be the false positive',
    ).toBeNull();
  });

  it('SILENT: an honest refusal claims nothing, receipt or not', () => {
    const refusal = 'I did not change anything, because the value you gave does not match the offer.';
    expect(detectUnbackedChangeClaim(refusal, NO_RECEIPT, DETECTORS)).toBeNull();
  });

  it('names the structural detector rather than inventing a quotation it cannot produce', () => {
    // `containsStructuralSuccessClaim` returns a boolean, so there is no phrase
    // to quote. The record must say WHICH detector fired and never manufacture
    // an excerpt the text may not contain.
    const hit = detectUnbackedChangeClaim("I've updated the model with those estimates.", NO_RECEIPT, {
      findSuccessClaimHit: () => null, // force the second detector to be the one that speaks
      containsStructuralSuccessClaim,
    });
    if (hit !== null) expect(hit).toBe('structural_completion_claim');
  });
});

describe('KNOWN-MISSED — the size of the blind spot, asserted exactly', () => {
  /**
   * Sentences that ARE unbacked claims of change and that BOTH detectors fail
   * to see. Pinned so the floor's size is visible rather than assumed.
   *
   * ⛔ This set is EVIDENCE, not a wish list. If a detector improves, an entry
   * stops being missed and this REDs — which is the point: the blind spot may
   * not change silently in either direction.
   */
  const KNOWN_MISSED = [
    "That's saved.",
    'The budget is now set to £50k.',
  ] as const;

  it.each(KNOWN_MISSED)('still missed by BOTH detectors: %s', (sentence) => {
    expect(
      detectUnbackedChangeClaim(sentence, NO_RECEIPT, DETECTORS),
      `"${sentence}" is now DETECTED — good news, but the known-missed set must shrink with it`,
    ).toBeNull();
  });

  it('the known-missed set is exactly this size — it may not grow silently either', () => {
    expect(KNOWN_MISSED).toHaveLength(2);
    // ⚠ POSITIVE CONTROL: if the detectors were inert, every sentence would be
    // "missed" and the block above would pass by testing nothing.
    expect(
      detectUnbackedChangeClaim("I've updated the model.", NO_RECEIPT, DETECTORS),
      'the detectors must demonstrably catch SOMETHING, or these absences are vacuous',
    ).not.toBeNull();
  });
});
