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
  MISSING_VALUE_ASK_FORMAT_HINT,
  messageAnswersMissingValueAsk,
  readMissingValueAnswer,
} from '../../routing/missing-value-answer.js';
import {
  matchBareRepairValue,
  resolveRepairValueBinding,
} from '../../routing/repair-value-binding.js';

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

  it('the emitted copy really does invite a reply (else every assertion below is vacuous)', () => {
    // ⚠⚠ THE PRECONDITION MOVED WITH THE COPY. It used to assert the branch
    // emits `CONFIGURE_OPTION_EXAMPLE_VALUE` (`0.6`); that value is Olumi's
    // INTERNAL normalised coefficient and no longer appears in any identified
    // ask (founder ruling, 30 Aug 2026). The precondition this file needs is
    // unchanged in substance — that this branch really does suggest a reply
    // form — so it now pins the human calibration the branch actually emits.
    expect(suggestion()).toContain(MISSING_VALUE_ASK_FORMAT_HINT);
    // …and the discriminating half: the internal form is gone from it.
    expect(suggestion()).not.toMatch(/\b0\.\d/);
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
  it('is now EMPTY — the gap closed', () => {
    // ⚠⚠ IT SHRANK FROM TWO TO ZERO (ROADMAP P0a), and the next test is what
    // makes that honest: an empty set is trivially satisfied by giving up, so
    // emptiness alone asserts nothing. The two former members are named BY VALUE
    // below and each must BIND — if either stops binding, that test REDs and the
    // set has to grow again, consciously.
    expect([...SUGGESTED_PHRASING_KNOWN_DROPPED]).toEqual([]);
  });

  it('⭐ THE TWO FORMER MEMBERS NOW BIND — the positive control on the emptiness above', () => {
    // Paul's live session, verbatim. Measured at pristine `f18d941b2e4c`: both
    // read null on ALL THREE readers, which is why they were pinned.
    const readiness = {
      status: 'needs_user_input',
      blockers: [
        {
          blocker_type: 'missing_value',
          option_id: 'o1', option_label: OPTION,
          factor_id: 'f1', factor_label: FACTOR,
        },
      ],
    };
    for (const message of ['I think 0.6 makes sense.', '0.6, say']) {
      expect(messageAnswersMissingValueAsk(message), message).toBe(true);
      const read = readMissingValueAnswer(message);
      expect(read?.kind, message).toBe('numeric');
      const resolved = resolveRepairValueBinding({ message, readiness: readiness as never });
      expect(resolved.matched, message).toBe(true);
      if (!resolved.matched || resolved.kind !== 'bind') throw new Error(`no bind for ${message}`);
      // BY IDENTITY, never by value alone (trap 19).
      expect(resolved.pair.optionId, message).toBe('o1');
      expect(resolved.pair.factorId, message).toBe('f1');
      expect(resolved.valueText, message).toBe('0.6');
    }
  });

  it('⚠ CONTRAST — a wrapper with no figure in it is still unread', () => {
    // The widening is a closed filler set around a NUMBER, not a licence for
    // ordinary English. Without this, "the wrapper now binds" would be
    // consistent with the anchor having stopped discriminating altogether.
    for (const message of ['I think that makes sense.', 'say', 'about']) {
      expect(readMissingValueAnswer(message), message).toBeNull();
      expect(matchBareRepairValue(message), message).toBeNull();
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
