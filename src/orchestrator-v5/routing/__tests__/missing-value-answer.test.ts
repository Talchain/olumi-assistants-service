/**
 * ROADMAP 2.1267 — the ask/acceptance pairing, and the terminating invariant.
 *
 * ⭐⭐ EVERY RULE HAS AN OPPOSITE-DIRECTION TWIN. This module widens a predicate
 * that feeds a WRITE, so "it accepts more" is worthless without "it still
 * refuses what it must" — and the refusals are the ones a reviewer should read
 * first.
 *
 * ⚠ THE CORPUS IS THE ESTATE'S OWN PINNED KNOWN-DROPPED SETS, i.e. phrasings
 * recorded by PREVIOUS lanes, from previous witnesses, before this author looked
 * at the seam. That is the point: they are not this author's idea of how a human
 * answers a question (trap 22).
 */

import { describe, expect, it } from 'vitest';
import {
  BARE_REFERENTS,
  MISSING_VALUE_ANSWER_KNOWN_DROPPED,
  messageAnswersMissingValueAsk,
  readMissingValueAnswer,
} from '../missing-value-answer.js';
import {
  matchBareRepairValue,
  REPAIR_BARE_VALUE_KNOWN_DROPPED,
  resolveRepairValueBinding,
} from '../repair-value-binding.js';
import {
  composeConfigureOptionClarifyResponse,
  QUALITATIVE_VALUE_KNOWN_DROPPED,
} from '../../compose/configure-option-clarify-response.js';
import type { StageType } from '@talchain/schemas/boundary';

const OPTION = 'Subcontract inner-city runs';
const FACTOR = 'Courier cost share';
const STAGE = 'framing' as StageType;

const PAIR = [
  {
    blocker_type: 'missing_value',
    option_id: 'o1',
    option_label: OPTION,
    factor_id: 'f1',
    factor_label: FACTOR,
    message: 'Choose the missing effect value.',
  },
];

function clarify(message: string): string {
  return composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: STAGE,
    message,
  }).assistant_text as string;
}

/** The demand the product makes when it has heard nothing yet. */
const DEMAND = clarify('Configure Subcontract inner-city runs');

/** The product's own advised phrasing, as it appears inside that demand. */
const ADVISED = `Set the ${OPTION} option's effect on ${FACTOR} to 0.6`;

describe('ordinary human answers are ACCEPTED and bound (the four forms that looped)', () => {
  // Measured at pristine: ALL FOUR were refused by `matchBareRepairValue` AND by
  // the composer's termination signal — no bind and no termination, i.e. the
  // identical demand. They were pinned as known-dropped by a previous lane.
  const nowClaimed: ReadonlyArray<readonly [string, string]> = [
    ['Make it 0.12.', '0.12'],
    ['Use 0.12.', '0.12'],
    ['Set it to .12.', '.12'],
    ['Yes, set it to 0.12.', '0.12'],
  ];

  for (const [message, expected] of nowClaimed) {
    it(`binds ${JSON.stringify(message)} to the outstanding pair BY ID`, () => {
      const match = matchBareRepairValue(message);
      expect(match?.valueText).toBe(expected);
      const resolved = resolveRepairValueBinding({
        message,
        readiness: { blockers: PAIR } as never,
      });
      expect(resolved.matched).toBe(true);
      if (resolved.matched && resolved.kind === 'bind') {
        expect(resolved.pair.optionId).toBe('o1');
        expect(resolved.pair.factorId).toBe('f1');
        // The value is carried VERBATIM, never reformatted.
        expect(resolved.valueText).toBe(expected);
      } else {
        throw new Error(`expected a bind, got ${JSON.stringify(resolved)}`);
      }
    });
  }

  it('the form the previous lane already claimed still binds (no regression)', () => {
    expect(matchBareRepairValue('Set it to 0.12.')?.valueText).toBe('0.12');
    expect(matchBareRepairValue('Change the value to 0.5')?.valueText).toBe('0.5');
  });

  it('every closed referent is still honoured', () => {
    for (const referent of BARE_REFERENTS) {
      const match = matchBareRepairValue(`set ${referent} to 0.4`);
      expect(match?.valueText).toBe('0.4');
      expect(match?.referent).toBe(referent);
    }
  });
});

describe('OPPOSITE DIRECTION — what must still refuse to bind', () => {
  it('⭐ the pinned known-dropped set is EXACTLY these four (REDs if it grows OR shrinks)', () => {
    expect([...MISSING_VALUE_ANSWER_KNOWN_DROPPED]).toStrictEqual([
      'Set it to about 0.12.',
      'Set it to a third.',
      '0.12',
      'Set it to 0.12 for the subcontracting option.',
    ]);
    // The repair module re-exports the same set — one owner, not two lists.
    expect([...REPAIR_BARE_VALUE_KNOWN_DROPPED]).toStrictEqual([
      ...MISSING_VALUE_ANSWER_KNOWN_DROPPED,
    ]);
    for (const message of MISSING_VALUE_ANSWER_KNOWN_DROPPED) {
      expect(matchBareRepairValue(message)).toBeNull();
    }
  });

  it('a NAMED TARGET is never bound by this path — the edit lane owns it', () => {
    for (const message of [
      'Set it to 0.12 for the subcontracting option.',
      'Set the delivery share to 0.4',
      "Set the Subcontract runs option's effect on Courier cost share to 0.6",
    ]) {
      expect(matchBareRepairValue(message)).toBeNull();
    }
  });

  it('units, currencies and percentages are never bound', () => {
    for (const message of [
      'Set it to 12%.',
      'Set it to £5000.',
      'Set it to 3 months.',
      'Make it 40k.',
    ]) {
      expect(matchBareRepairValue(message)).toBeNull();
    }
  });

  it('questions, compound sentences and trailing clauses are never bound', () => {
    for (const message of [
      'Should I set it to 0.12?',
      'Set it to 0.12 and rerun the analysis.',
      'Set it to 0.12, then tell me what changed.',
      'I already set it to 0.12 last turn.',
    ]) {
      expect(matchBareRepairValue(message)).toBeNull();
    }
  });

  it('a qualitative answer is NEVER bindable — no word is mapped to a number', () => {
    for (const message of QUALITATIVE_VALUE_KNOWN_DROPPED) {
      expect(matchBareRepairValue(message)).toBeNull();
      expect(readMissingValueAnswer(message)?.kind).toBe('qualitative');
    }
    // And the term is the USER'S OWN WORDS, carried not interpreted.
    expect(readMissingValueAnswer("Set the X option's effect on Y to high")).toStrictEqual({
      kind: 'qualitative',
      term: 'high',
    });
  });

  it('never throws on hostile input', () => {
    for (const message of ['', '   ', '.', '%', 'set it to', 'make it']) {
      expect(() => readMissingValueAnswer(message)).not.toThrow();
      expect(matchBareRepairValue(message)).toBeNull();
    }
    expect(readMissingValueAnswer(undefined as unknown as string)).toBeNull();
  });
});

describe('⭐⭐ THE TERMINATING INVARIANT — the same demand cannot be re-issued', () => {
  it('the demand names the slot it is asking about (both halves)', () => {
    expect(DEMAND).toContain(OPTION);
    expect(DEMAND).toContain(FACTOR);
    expect(DEMAND).toContain(ADVISED);
  });

  it('⭐ VERBATIM COMPLIANCE — the witnessed loop — does NOT return the demand', () => {
    // The witnessed defect: the product advised a template, the tester typed it
    // back exactly, and got the identical demand word for word.
    const reply = clarify(ADVISED);
    expect(reply).not.toBe(DEMAND);
    expect(reply).not.toContain(ADVISED);
  });

  it('⭐ NO ANSWER SHAPE CAN PRODUCE THE UNCHANGED DEMAND', () => {
    // The union of every phrasing this estate has recorded as an answer to this
    // ask — the two known-dropped sets plus the forms now claimed. If any one of
    // them reproduced the demand, that is the loop.
    const everyAnswer = [
      ...MISSING_VALUE_ANSWER_KNOWN_DROPPED,
      ...QUALITATIVE_VALUE_KNOWN_DROPPED,
      'Make it 0.12.',
      'Use 0.12.',
      'Set it to .12.',
      'Yes, set it to 0.12.',
      'Set it to 0.12.',
      ADVISED,
    ];
    const looped = everyAnswer.filter((m) => clarify(m) === DEMAND);
    // ⚠ THE ONE EXCEPTION IS NAMED, NOT EXCLUDED. A bare "0.12" carries no verb
    // and no referent, and nothing records which slot was asked about, so it
    // still gets the demand. Asserting the exact set rather than `[]` means the
    // residue is VISIBLE here and this test REDs if anything else joins it — the
    // next assertion states why it is not closed.
    expect(looped).toStrictEqual(['0.12']);
  });

  it('⭐ THE DECLARED RESIDUE, pinned rather than hidden: a bare number', () => {
    // "0.12" alone terminates NOTHING, because nothing in CEE records which slot
    // the previous turn asked about — the ask turn is not even committed to
    // `v5_conversation_turns`. Binding it would be a guess. This assertion is
    // here so the gap is visible in the suite and REDs if it silently changes in
    // either direction.
    expect(messageAnswersMissingValueAsk('0.12')).toBe(false);
    expect(clarify('0.12')).toBe(DEMAND);
  });

  it('the CHANGED ASK quotes the user back, names the slot, and invents no number', () => {
    const reply = clarify("Set the X option's effect on Y to high");
    expect(reply).toContain('"high"');
    expect(reply).toContain(FACTOR);
    expect(reply).toContain(OPTION);
    expect(reply).toContain('from 0');
    expect(reply).toContain('to 1');
    // NOTHING is guessed: no invented figure appears anywhere.
    expect(reply).not.toContain('0.6');
    expect(reply).not.toContain('0.8');
  });

  it('an UNRELATED message still gets the demand — the guard is not a blanket', () => {
    // Termination must be earned by an answer, not by any message at all.
    for (const message of [
      'Configure Subcontract inner-city runs',
      'What does this option do?',
      'Run the analysis.',
    ]) {
      expect(clarify(message)).toBe(DEMAND);
    }
  });
});

describe('the terminating predicate is WIDER than the bindable one (trap 21)', () => {
  it('terminates on answers it refuses to bind', () => {
    for (const message of [
      'Set it to about 0.12.',
      'Set it to 0.12 for the subcontracting option.',
      "Set the X option's effect on Y to high",
    ]) {
      expect(matchBareRepairValue(message)).toBeNull();
      expect(messageAnswersMissingValueAsk(message)).toBe(true);
    }
  });

  it('does not terminate on messages that answer nothing', () => {
    for (const message of ['Run the analysis.', 'What is missing?', '0.12', '']) {
      expect(messageAnswersMissingValueAsk(message)).toBe(false);
    }
  });
});
