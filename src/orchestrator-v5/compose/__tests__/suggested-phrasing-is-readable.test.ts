/**
 * THE PHRASING WE SUGGEST MUST BE A PHRASING WE CAN READ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (Paul's live session, 2026-08-29)
 *
 *   product : "'Two Developers' has no effect value on Development throughput
 *              yet. Give me a number from 0 … to 1 … — 0.6, say."
 *   user    : "I think 0.6 makes sense."
 *   product : the SAME demand again.
 *
 * The `0.6` was the product's OWN exemplar (`CONFIGURE_OPTION_EXAMPLE_VALUE`),
 * carried by a source comment claiming it is "wire-proven to route". Measured
 * here against the three deterministic readers, with a contrast control
 * ("Why can't the analysis run?") and a fabricated control, both all-null:
 *
 *   | input                       | matchBare | answersAsk | readAnswer |
 *   |-----------------------------|-----------|------------|------------|
 *   | "I think 0.6 makes sense."  | null      | false      | null       |
 *   | "0.6, say"                  | null      | false      | null       |
 *   | "0.6"                       | null      | true       | binds      |
 *   | "Set it to 0.6."            | binds     | true       | binds      |
 *
 * ⭐ THE ESTATE ALREADY HAD THE RULE AND APPLIED IT ONE MODULE OVER.
 * `parameter-user-phrasing.ts` refuses to suggest "strong"/"moderate"/"weak"
 * for an edge strength, and states why: *"recovery copy must only recommend an
 * input the system can CURRENTLY accept. Recommending one it cannot would have
 * MANUFACTURED a dead-end loop out of a refusal that is otherwise recoverable
 * in a single step."* `— 0.6, say.` is that rule broken: the exemplar is
 * readable, and the SHAPE the copy wraps it in is not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE FIX IS THE COPY, NOT THE READER — DELIBERATELY
 *
 * Widening a reader to accept "I think 0.6 makes sense" is the pattern-only
 * rule this codebase has already lost four consecutive rounds to, each round
 * fixing one direction and reopening the other. The reader is untouched here.
 * What changes is that the product stops advising a shape it cannot read.
 *
 * ⚠ AND THIS DOES NOT CLOSE THE LIVE LOOP. Paul's ordinary-English wrapper is
 * pinned below as KNOWN-DROPPED, with its real exit named: the pending-question
 * contract (persist the asked cell, bind a short reply to it deterministically)
 * — which lives in the finalise path, not in this module.
 */
import { describe, it, expect } from 'vitest';

import {
  CONFIGURE_OPTION_EXAMPLE_VALUE,
  SUGGESTED_PHRASING_KNOWN_DROPPED,
  composeConfigureOptionClarifyResponse,
} from '../configure-option-clarify-response.js';
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';
import { buildRepairPairChip } from '../../configure-option-chip-text.js';
import {
  messageAnswersMissingValueAsk,
  readMissingValueAnswer,
} from '../../routing/missing-value-answer.js';
import { matchBareRepairValue } from '../../routing/repair-value-binding.js';

const OPTION = 'Two Developers';
const FACTOR = 'Development throughput';

/** The identification-complete branch — the one that emits the exemplar. */
const CHIP = buildRepairPairChip(OPTION, FACTOR, FACTOR);
const suggestion = () =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message: CHIP.message,
    analysisWillProceed: true,
  }).assistant_text;

describe('fixture precondition — this really is the branch that suggests a value', () => {
  it('the chip message completes identification and carries no number', () => {
    expect(CHIP.message).toContain(OPTION);
    expect(CHIP.message).toContain(FACTOR);
    expect(CHIP.message).not.toMatch(/\d/);
  });

  it('the emitted copy really does suggest the exemplar (else every assertion below is vacuous)', () => {
    expect(suggestion()).toContain(CONFIGURE_OPTION_EXAMPLE_VALUE);
  });
});

describe('THE INVARIANT — every reply form the product suggests, its own readers accept', () => {
  it('the exemplar, replied to exactly as the copy invites, BINDS', () => {
    // DERIVED from the constant, not hand-copied, so a change to the exemplar
    // re-runs the check rather than going stale (CLAUDE.md trap 12).
    const reply = CONFIGURE_OPTION_EXAMPLE_VALUE;
    expect(messageAnswersMissingValueAsk(reply)).toBe(true);
    const read = readMissingValueAnswer(reply);
    expect(read?.kind).toBe('numeric');
    expect(read && read.kind === 'numeric' ? read.valueText : null).toBe(
      CONFIGURE_OPTION_EXAMPLE_VALUE,
    );
  });

  it('the copy does NOT suggest a shape its readers reject', () => {
    // ⭐ THE RED THIS FILE WAS WRITTEN AT. The live copy ended
    // `— 0.6, say.`, and "0.6, say" is read by NONE of the three readers.
    const text = suggestion();
    for (const rejected of SUGGESTED_PHRASING_KNOWN_DROPPED) {
      // Every member is genuinely unreadable — asserted below — so the copy
      // containing one would be the product advising a dead end.
      expect(text, `the suggestion contains an unreadable shape: ${rejected}`).not.toContain(
        rejected,
      );
    }
  });

  it('the WHOLE-SENTENCE advised format is deferred to the edit lane, by design (not a gap)', () => {
    // `buildConfigureOptionAdvisedFormat` reads null on `readMissingValueAnswer`
    // BECAUSE it names a target, and that module's numeric arm refuses a named
    // target on purpose ("NAMES A TARGET, so the edit lane owns it"). It still
    // TERMINATES the demand, which is the property that matters here. Pinned so
    // nobody "fixes" a null that is correct.
    const advised = buildConfigureOptionAdvisedFormat(
      OPTION,
      FACTOR,
      CONFIGURE_OPTION_EXAMPLE_VALUE,
    );
    expect(messageAnswersMissingValueAsk(advised)).toBe(true);
    expect(readMissingValueAnswer(advised)).toBeNull();
  });
});

describe('THE KNOWN-DROPPED SET — pinned as data, RED if it grows OR shrinks', () => {
  it('is exactly this set', () => {
    expect([...SUGGESTED_PHRASING_KNOWN_DROPPED]).toEqual([
      'I think 0.6 makes sense.',
      '0.6, say',
    ]);
  });

  it('every member really is unreadable by ALL THREE readers (the gap is measured, not asserted)', () => {
    for (const message of SUGGESTED_PHRASING_KNOWN_DROPPED) {
      expect(matchBareRepairValue(message), message).toBeNull();
      expect(messageAnswersMissingValueAsk(message), message).toBe(false);
      expect(readMissingValueAnswer(message), message).toBeNull();
    }
  });

  it('CONTRAST CONTROL — a readable reply is read, so the probe above can say YES as well as NO', () => {
    // Without this, "all three readers return null" is consistent with three
    // dead readers (CLAUDE.md trap 13: an absence probe needs a positive
    // control).
    expect(messageAnswersMissingValueAsk(CONFIGURE_OPTION_EXAMPLE_VALUE)).toBe(true);
    expect(matchBareRepairValue(`Set it to ${CONFIGURE_OPTION_EXAMPLE_VALUE}.`)).not.toBeNull();
  });

  it('FABRICATED CONTROL — an unrelated sentence is also unread, so a hit means something', () => {
    for (const message of ["Why can't the analysis run?", 'zzqq wibble frotz']) {
      expect(matchBareRepairValue(message), message).toBeNull();
      expect(messageAnswersMissingValueAsk(message), message).toBe(false);
      expect(readMissingValueAnswer(message), message).toBeNull();
    }
  });
});
