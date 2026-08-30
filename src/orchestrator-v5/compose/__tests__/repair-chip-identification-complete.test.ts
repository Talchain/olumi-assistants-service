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
import { MISSING_VALUE_ASK_FORMAT_HINT } from '../../routing/missing-value-answer.js';

import { composeConfigureOptionClarifyResponse } from '../configure-option-clarify-response.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';
import {
  buildRepairPairChip,
  buildRepairPairChipMessage,
  buildConfigureOptionDirectSetSentence,
  buildConfigureOptionAdvisedFormat,
} from '../../configure-option-chip-text.js';

const OPTION = 'rebuild our product on an AI-native architecture';
const FACTOR = 'Cash runway consumed';

/** The teach-the-format lead-in — the sentence a chip click must never get. */
const RETYPE_LEAD_IN = 'Tell me what it changes, like this:';

const compose = (message: string) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message,
    analysisWillProceed: true,
  }).assistant_text;

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
  it('does NOT hand back the retype template', () => {
    expect(compose(CHIP.message)).not.toContain(RETYPE_LEAD_IN);
  });

  it('does NOT quote the whole advised sentence back as something to type', () => {
    const advised = buildConfigureOptionAdvisedFormat(OPTION, FACTOR, '0.6');
    expect(compose(CHIP.message)).not.toContain(advised);
  });

  it('asks for the STRENGTH in human terms, naming the slot the chip named', () => {
    // ⚠⚠ THE SHAPE OF THE ASK CHANGED AND THE ASSERTION FOLLOWS IT. This read
    // `toMatch(/from 0 .*to 1/)` — Olumi's internal normalised coefficient
    // scale, which a strategic user is never asked to understand (founder
    // ruling, 30 Aug 2026). What this test is ACTUALLY about — that the chip
    // click lands on an ask naming the slot and requesting the value — is
    // unchanged and is still asserted; only the calibration is now human, and
    // it is derived from the module that accepts it rather than transcribed.
    const text = compose(CHIP.message);
    expect(text).toContain(OPTION);
    expect(text).toContain(FACTOR);
    expect(text).toContain(MISSING_VALUE_ASK_FORMAT_HINT);
    expect(text).not.toMatch(/\b0\.\d/);
  });

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
    expect(findForbiddenPhraseHit(compose(CHIP.message))).toBeNull();
  });

  /**
   * ⛔ THE DIRECT-SET SENTENCE MUST NOT APPEAR ON THIS BRANCH.
   *
   * WHEN WRITTEN (#1113) the reason was FALSITY: the sentence then read "open
   * <option> on the canvas and add <factor> to what it changes", and a live
   * drive on 2026-08-25 found the canvas option panel renders the intervention
   * row inside a `<fieldset disabled>` — a forced native write produced ZERO
   * wire calls, and the panel states it is read-only because the change "cannot
   * yet be saved to the shared model".
   *
   * ⚠ THE REASON HAS CHANGED; THE ASSERTION HAS NOT. ROADMAP 2.1269 fixed the
   * `answered` branch (this note used to record that branch as an outstanding
   * defect — it is closed, and the sentence now points at chat). What this case
   * pins today is that the two branches stay DISTINCT: this branch makes its own
   * ask in its own words, and must not also append the shared sentence.
   */
  it('makes its own ask and does not append the shared direct-set sentence', () => {
    expect(compose(CHIP.message)).not.toContain(buildConfigureOptionDirectSetSentence());
  });
});

/**
 * ⭐⭐ THE DISCRIMINATING CONTROL (CLAUDE.md trap 22b — one predicate, two
 * opposite harms, and a corpus that tests one direction is a guard watching one
 * door).
 *
 * Dropping the template is a GAP for a user who has named nothing; keeping it
 * for a chip click is the LIE this PR closes. These cases point the opposite
 * way to every case above and MUST stay green, so a fix that widens into a
 * blanket deletion REDs here rather than shipping.
 */
describe('identification NOT complete — the teach-the-format branch is untouched', () => {
  it.each([
    ['option named, factor absent', `Configure ${OPTION}`],
    ['nothing named', 'help me with this'],
    ['a different option entirely', 'Help me configure the hiring option.'],
  ])('%s — still gets the routable phrasing', (_name, message) => {
    const text = compose(message);
    expect(text).toContain(RETYPE_LEAD_IN);
    expect(text).toContain(buildConfigureOptionAdvisedFormat(OPTION, FACTOR, '0.6'));
  });
});
