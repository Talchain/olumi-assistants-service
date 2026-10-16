/**
 * S7 — THE PRODUCT'S OWN REPAIR CHIP MUST NOT BE ANSWERED WITH A SENTENCE TO
 * RETYPE.
 *
 * ## What was witnessed, wire-level
 *
 * Quartet UI `326970a7` · CEE `5f2e3fd` · PLoT `3a3bee5` · ISL `28fe0c9`, guest
 * session. Chat offered `chip_prompt_repair_effect_value`, labelled
 * **"Set effect on Cash runway consumed"**. Clicking it produced
 * `blocks: []`, `exit_path: edit_graph`, `activeElement: BODY`, and this prose:
 *
 *   "Tell me what it changes, like this: Set the rebuild our product on an
 *    AI-native architecture option's effect on Cash runway consumed to 0.6.
 *    Use a number from 0 … to 1 …"
 *
 * **A button that says "Set effect on X" handed back a sentence for the user to
 * type — naming the very option and factor the chip had already named.**
 *
 * ## Why it happens (derived, not inferred from the symptom)
 *
 * The chip carries NO `action_type` (`configure-option-chip-text.ts` —
 * `ConfigureOptionChip` is `{id,label,message}`), so it is a MESSAGE-REPLAY chip:
 * the UI replays `message` as user text. That message is
 * `buildRepairPairChipMessage(option, factor)` — "Help me configure the
 * <option> option's effect on <factor>." — which carries no digit, so
 * `messageAnswersMissingValueAsk` is false and `readMissingValueAnswer` is null.
 * The composer therefore falls to its BARE-ASK branch, whose whole job is to
 * teach the routable phrasing to a user who has named nothing.
 *
 * **But the user named everything except the number.** The chip completed the
 * IDENTIFICATION deliberately (see `buildRepairPairChip`'s header: it withholds
 * the value on purpose, because inventing the user's figure is the fabrication
 * class P5 exists to close). Answering identification-complete with the
 * teach-the-format branch is the product failing to recognise its own
 * affordance.
 *
 * ## The claim these tests bind
 *
 * Identification-complete ⇒ ask for THE NUMBER ONLY, and name the locus.
 * Identification-absent ⇒ the bare-ask branch is UNCHANGED, byte for byte.
 * The second half is the discriminating control: a fix that simply deleted the
 * template would pass the first half and destroy the lane the template exists
 * for.
 */

import { describe, it, expect } from 'vitest';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';
import { buildRepairPairChip, buildRepairPairChipMessage } from '../../configure-option-chip-text.js';

const OPTION = 'rebuild our product on an AI-native architecture';
const FACTOR = 'Cash runway consumed';

/**
 * ⭐ PRECONDITION PIN (CLAUDE.md trap 13b — a guard whose discrimination
 * depends on a fixture nothing pins is green by accident).
 *
 * Every test below feeds `CHIP.message`. If the chip builder ever stopped
 * producing the identification-complete shape, those tests would keep passing
 * while testing nothing. These assertions make the fixture's identity the
 * suite's business: the string under test IS the product's own chip message,
 * derived from the builder rather than copied from the capture.
 */
const CHIP = buildRepairPairChip(OPTION, FACTOR, FACTOR);

describe('fixture precondition — the message under test is the product\'s own repair chip', () => {
  it('is built by the repair-pair builder, not hand-copied', () => {
    expect(CHIP.message).toBe(buildRepairPairChipMessage(OPTION, FACTOR));
  });

  it('is the chip whose LABEL states the intent this suite is about', () => {
    expect(CHIP.id).toBe('chip_prompt_repair_effect_value');
    expect(CHIP.label).toBe(`Set effect on ${FACTOR}`);
  });

  it('names BOTH the option and the factor, and carries NO number', () => {
    expect(CHIP.message).toContain(OPTION);
    expect(CHIP.message).toContain(FACTOR);
    // Identification complete, value absent — the exact state under test.
    expect(CHIP.message).not.toMatch(/\d/);
  });
});

describe('clicking the repair chip — identification is complete', () => {

  /**
   * ⭐ THE MODULE'S COPY CONTRACT APPLIES TO THE NEW BRANCH TOO — and nothing
   * else asserted it.
   *
   * `configure-option-clarify-response.ts`'s header requires every string it
   * emits to survive the V5 egress guards, because `FORBIDDEN_USER_FACING_PHRASES`
   * replaces the WHOLE response on a hit. The existing guard suite
   * (`configure-option-clarify-terminates.test.ts`) drives only the bare-ask and
   * answered fixtures, so **this branch's copy was outside its corpus** — a
   * corpus that excludes a reachable class cannot certify the code over it
   * (CLAUDE.md trap 13d). Derived via `findForbiddenPhraseHit` rather than by
   * re-listing the patterns (trap 12).
   */
  it('survives the egress guard — the whole response would be replaced otherwise', () => {
    // POSITIVE CONTROL FIRST (trap 13): an absence assertion is vacuous until
    // the instrument is shown able to see a presence. A guard that matched
    // nothing would let the assertion below pass while testing nothing.
    //
    // ⚠ THE CONTROL EARNED ITS KEEP IMMEDIATELY. It was first written with
    // "I couldn't make that change." — taken from this composer's own header,
    // which says the copy must carry *"no 'couldn't'"*. It returned NULL: that
    // phrase is NOT in `FORBIDDEN_USER_FACING_PHRASES` at this tip. The header
    // is a hand-maintained description of the list (trap 12) and is inaccurate
    // on that word. The control below is a DERIVED member of the real list.
    expect(findForbiddenPhraseHit('Sorry, no change was made.')).not.toBeNull();
  });
});
