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
  MISSING_VALUE_ASK_FORMAT_HINT,
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
  it('⭐ the pinned known-dropped set is EXACTLY these three (REDs if it grows OR shrinks)', () => {
    // ⚠⚠ THE SET SHRANK AGAIN — '0.12', THE BARE NUMBER, HAS LEFT IT, and the
    // reason it was ever in it was FALSE. It was pinned on the ground that
    // "nothing in CEE records which slot the previous turn asked about"; measured
    // at this tip, `deriveAskedEffectPair` records exactly that, off the
    // PERSISTED graph's head blocker. The pin was correct to make the gap
    // visible and wrong about why it was open — which is the case for keeping
    // pins: this one survived precisely because it was written down.
    //
    // ⚠⚠ AND IT SHRANK ONCE MORE — 'Set it to about 0.12.', THE HEDGE, HAS LEFT
    // IT, and its stated reason was wrong in the same way. It read: *"a HEDGE.
    // Binding it would record an approximation as an exact user-stated figure."*
    // That collapses two different acts. CHOOSING a number the user did not give
    // ("high" -> 0.7) is fabrication and stays banned. READING the number they
    // DID give, through a hedge word, is not: 0.12 is the user's figure in
    // "about 0.12" exactly as it is in "0.12", and the hedge qualifies their
    // CONFIDENCE. Refusing it bought no provenance safety — the `user_specified`
    // stamp is truthful either way — and cost the journey: on deployed `f18d941`
    // a natural answer to the product's own question cleared the block 0/13.
    //
    // The THREE that REMAIN are refusals this lane did not disturb: a WORD
    // NUMBER (parsing it invents precision), a NAMED TARGET (the edit lane owns
    // it), and a space-less clause break (a pre-existing coverage gap).
    expect([...MISSING_VALUE_ANSWER_KNOWN_DROPPED]).toStrictEqual([
      'Set it to a third.',
      'Set it to 0.12 for the subcontracting option.',
      'It went up a lot,set it to 0.12.',
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

  it('units and currencies are never bound — but PERCENT NOTATION now is', () => {
    // ⚠⚠ `'Set it to 12%.'` LEFT THIS LIST, and the two halves are different
    // claims that used to share one window.
    //   · A CURRENCY or a UNIT is a HUMAN-SCALE quantity whose divisor is a
    //     factor's `scale_frame` — a concept that does not exist for an option
    //     effect. Converting one would invent a frame and persist a value the
    //     compute refuses. STILL REFUSED, and this is the direction that must
    //     never move.
    //   · A PERCENT is NOTATION over a DIMENSIONLESS scale; its divisor (100) is
    //     carried in the notation itself. Reading "12%" as 0.12 moves the user's
    //     figure by nothing. Now bound — see the twin below.
    for (const message of [
      'Set it to £5000.',
      'Set it to $5000.',
      'Set it to 3 months.',
      'Make it 40k.',
      'Set it to 1.2m.',
    ]) {
      expect(matchBareRepairValue(message), message).toBeNull();
    }
  });

  it('⭐ THE TWIN: percent binds, and it binds as the FRACTION, not the numeral', () => {
    const twelvePercent = matchBareRepairValue('Set it to 12%.');
    expect(twelvePercent).not.toBeNull();
    // The user's own token is preserved for quoting…
    expect(twelvePercent?.valueText).toBe('12%');
    // …and the canonical spelling is what a writer gets, because
    // `readOptionEffectValue` declines a percent sign.
    expect(twelvePercent?.modelUnitText).toBe('0.12');
    // OPPOSITE DIRECTION: the bare numeral is NOT the same claim.
    expect(matchBareRepairValue('Set it to 12.')?.modelUnitText).toBe('12');
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
      // ⭐ SPELLED EXPLICITLY BECAUSE IT LEFT THE KNOWN-DROPPED SET. It used to
      // reach this list through the spread above; keeping it by name means the
      // coverage does not silently SHRINK by the same edit that closed the gap.
      '0.12',
      ADVISED,
    ];
    const looped = everyAnswer.filter((m) => clarify(m) === DEMAND);
    // ⚠⚠ THE RESIDUE IS NOW EMPTY, AND THE EXCEPTION THAT USED TO SIT HERE WAS
    // CLOSED BY A READ, NOT BY A NEW RECORD. The comment this replaces said a
    // bare "0.12" "still gets the demand" because "nothing records which slot
    // was asked about". That premise was false at the time it was written:
    // `deriveAskedEffectPair` reads the asked pair off the head of the canonical
    // blocker list, which is a fact about the PERSISTED GRAPH and therefore
    // still present on the answering turn — precisely BECAUSE the answer has not
    // been written yet. The gap was pinned behind a reason nobody re-derived.
    expect(looped).toStrictEqual([]);
  });

  it('⭐⭐ THE DECLARED RESIDUE IS CLOSED — a bare number is an answer and terminates', () => {
    // ⚠ THIS ASSERTION IS THE INVERSE OF THE ONE IT REPLACES, AND THE FLIP IS
    // THE DELIVERABLE. It previously read `toBe(false)` / `toBe(DEMAND)`, on the
    // stated ground that "nothing in CEE records which slot the previous turn
    // asked about". Measured: `deriveAskedEffectPair` records exactly that, off
    // the persisted graph's head blocker, and has done since 2.1266. The turn
    // being uncommitted was never the obstacle — the SLOT is graph state, not
    // turn state.
    //
    // A bare number is the plainest answer a human gives to "what value?", and
    // returning the identical demand to it was the witnessed dead end
    // (deployed `a7ee21e`: chip → "0.6" → `exit_path: turn_executor`,
    // `GAINED_PAIR []`, blockers 8 → 8, hash unchanged).
    expect(messageAnswersMissingValueAsk('0.12')).toBe(true);
    expect(clarify('0.12')).not.toBe(DEMAND);
  });

  it('⭐ a bare number reads as ELLIPTICAL — it carries no antecedent of its own', () => {
    // The distinction that keeps the claim safe: the reading is numeric, and it
    // is marked as carrying NO referent, so a consumer that resolves its slot
    // from the sentence must refuse it. `matchBareRepairValue` does exactly that
    // — the slot for this shape comes from the product's outstanding ask or from
    // nowhere.
    const reading = readMissingValueAnswer('0.12');
    expect(reading).toEqual({
      kind: 'numeric',
      elliptical: true,
      percentApplied: false,
      valueText: '0.12',
      modelUnitText: '0.12',
      referent: null,
      leadingContext: '',
    });
    expect(matchBareRepairValue('0.12')).toBeNull();
  });

  it('the bare-number claim is WHOLE-MESSAGE anchored — it cannot creep', () => {
    // ⭐ The anchor is the entire guard, so this reading can only ever DECLINE.
    // Anything carrying a unit, a word, a second figure or a trailing clause is
    // refused, and each of these is a shape a looser numeric grab would claim.
    // ⚠⚠ '12%' AND 'about 0.12' LEFT THIS LIST, and the anchor did NOT loosen —
    // it gained two members inside the same `^…$`. A percent is notation over
    // the same dimensionless scale; a hedge is a closed filler set. Neither can
    // name an entity, which is the property the anchor exists to enforce. The
    // discriminating half is directly below and it still holds.
    for (const message of ['£5000', '0.12 for the option', '0.12 and 0.5', '0.12 months']) {
      const reading = readMissingValueAnswer(message);
      const isBare = reading !== null && reading.kind === 'numeric' && reading.elliptical;
      expect(isBare, message).toBe(false);
    }
    // OPPOSITE DIRECTION — the two that moved, and they moved to `true`.
    for (const message of ['12%', 'about 0.12']) {
      const reading = readMissingValueAnswer(message);
      const isBare = reading !== null && reading.kind === 'numeric' && reading.elliptical;
      expect(isBare, message).toBe(true);
    }
  });

  it('the CHANGED ASK quotes the user back, names the slot, and invents no number', () => {
    const reply = clarify("Set the X option's effect on Y to high");
    expect(reply).toContain('"high"');
    expect(reply).toContain(FACTOR);
    expect(reply).toContain(OPTION);
    // ⚠ THE CALIBRATION IS NOW HUMAN. This asserted `'from 0'` / `'to 1'` —
    // Olumi's internal normalised coefficient scale, which a strategic user is
    // never asked to understand (founder ruling, 30 Aug 2026). The property the
    // test is about — the ask states a calibration rather than guessing a
    // figure — is unchanged, and the anchors are derived from the module that
    // accepts them rather than transcribed.
    expect(reply).toContain(MISSING_VALUE_ASK_FORMAT_HINT);
    // NOTHING is guessed: no invented figure appears anywhere, and the internal
    // representation is not shown either.
    expect(reply).not.toContain('0.6');
    expect(reply).not.toContain('0.8');
    expect(reply).not.toMatch(/\b0\.\d/);
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
    // ⚠ `'Set it to about 0.12.'` LEFT THIS LIST because it is no longer refused
    // — the hedge is about CONFIDENCE and the figure is the user's own. See
    // `HEDGE_WORD`'s header for the withdrawn reason, quoted rather than deleted.
    for (const message of [
      'Set it to 0.12 for the subcontracting option.',
      "Set the X option's effect on Y to high",
      'Set it to a third.',
      // ⭐ ADDED. A bare human-scale quantity is unbindable AND unmistakably an
      // answer; before this lane it satisfied neither arm and the composer
      // repeated the identical demand at it.
      '£40,000',
      '40k',
      '3 months',
    ]) {
      expect(matchBareRepairValue(message), message).toBeNull();
      expect(messageAnswersMissingValueAsk(message), message).toBe(true);
    }
  });

  it('does not terminate on messages that answer nothing', () => {
    // ⚠ '0.12' LEFT THIS LIST. A bare number is now recognised as an answer
    // (see the DECLARED RESIDUE case above); it never belonged with messages
    // that answer nothing, and keeping it here would re-assert the loop.
    for (const message of ['Run the analysis.', 'What is missing?', '']) {
      expect(messageAnswersMissingValueAsk(message)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2 — THE CLAUSE ANCHOR: an answer may carry context, and the difference is
// RECORDED rather than lost.
//
// ⚠ THE WITNESSED SENTENCE IS A VERBATIM WIRE CAPTURE (18 Aug composed
// model-compiler journey, deployed CEE `585f8dce` / UI `dd089a50`, fresh
// guest), not one composed here (trap 16-inverse). RED at pristine
// `3e15752e`: `readMissingValueAnswer` returned `null` for it.
// ═══════════════════════════════════════════════════════════════════════════
describe('A2 — the clause anchor is STRICTLY ADDITIVE', () => {
  const WITNESSED =
    'Doubling down on enterprise sales would push sales headcount up a lot - set it to 0.8.';

  it('the witnessed prose answer reads as numeric, with its context recorded', () => {
    expect(readMissingValueAnswer(WITNESSED)).toStrictEqual({
      kind: 'numeric',
      elliptical: false,
      percentApplied: false,
      valueText: '0.8',
      modelUnitText: '0.8',
      referent: 'it',
      leadingContext: 'doubling down on enterprise sales would push sales headcount up a lot',
    });
  });

  it('⭐ EVERY whole-message form still reads with leadingContext EMPTY', () => {
    // The additive claim, measured rather than asserted. `Yes. Set it to 0.12.`
    // is the case that would break under a split-FIRST reading: its affirmative
    // lead ends in a full stop, so splitting before matching would demote a
    // whole-message answer to a context-bearing one and `matchBareRepairValue`
    // would stop claiming it.
    for (const message of [
      'Set it to 0.12.',
      'Change the value to 0.5',
      'Make it 0.12.',
      'Use 0.12.',
      'Set it to .12.',
      'Yes, set it to 0.12.',
      'Yes. Set it to 0.12.',
      'Okay. Make the effect value 0.4',
    ]) {
      const answer = readMissingValueAnswer(message);
      expect(answer?.kind, message).toBe('numeric');
      expect(answer?.kind === 'numeric' && answer.leadingContext, message).toBe('');
      // …and the bare binder still claims every one of them.
      expect(matchBareRepairValue(message), message).not.toBeNull();
    }
  });

  it('a decimal point is NOT a clause break — the value is never truncated', () => {
    // ⚠ THE STATED REASON HERE USED TO BE WRONG AND A MUTANT CAUGHT IT. It said
    // the digit lookarounds stop "0.8" splitting into "0" and "8."; measured,
    // the `\s+` requirement already does that, and deleting the lookarounds left
    // the whole battery green. The assertion is still worth keeping — it pins
    // the value the reading returns — but it is NOT what makes the lookarounds
    // load-bearing. The case below is.
    expect(readMissingValueAnswer('The costs are fixed - set it to 0.8.')).toStrictEqual({
      kind: 'numeric',
      elliptical: false,
      percentApplied: false,
      valueText: '0.8',
      modelUnitText: '0.8',
      referent: 'it',
      leadingContext: 'the costs are fixed',
    });
  });

  it('⭐ a number that ENDS a clause is not a break either — the killing case for the lookbehind', () => {
    // "We agreed 0.5." — the stop IS followed by whitespace, so without
    // `(?<!\d)` this becomes a break and the message binds while carrying a
    // second figure the reader cannot account for. Declining is the safe
    // direction and this is the case that pins it.
    expect(readMissingValueAnswer('We agreed 0.5. Set it to 0.8.')).toBeNull();
    // Opposite-direction twin: the same shape with a NON-numeric lead binds, so
    // the guard is narrow rather than a blanket refusal of leading stops.
    expect(readMissingValueAnswer('We agreed on this. Set it to 0.8.')?.kind).toBe('numeric');
  });

  it('every closed referent works after context too — no second vocabulary', () => {
    for (const referent of BARE_REFERENTS) {
      const answer = readMissingValueAnswer(`The team agrees on this - set ${referent} to 0.4.`);
      expect(answer?.kind, referent).toBe('numeric');
      expect(answer?.kind === 'numeric' && answer.referent, referent).toBe(referent);
    }
  });

  it('OPPOSITE DIRECTION — a bare referent is REQUIRED once context is present', () => {
    // "Use 0.8." alone is unmistakably an answer because nothing else is in the
    // message. After a clause it might belong to that clause instead, so the
    // referent-free forms are refused. The twin above proves they still bind
    // whole-message.
    for (const message of [
      'The numbers are all guesses - use 0.8.',
      'The numbers are all guesses - make 0.8.',
    ]) {
      expect(readMissingValueAnswer(message)?.kind, message).not.toBe('numeric');
    }
  });

  it('⭐ THE PIN THAT FLIPPED — a COMMA IS now a clause break (RUN-B, 18 Aug 2026)', () => {
    // ⚠ THIS TEST'S OLD BODY IS QUOTED HERE VERBATIM, beside the flip, because
    // a pin that changes silently is worse than no pin (trap 22f):
    //
    //   it('OPPOSITE DIRECTION — a COMMA is not a clause break', () => {
    //     // A comma continues a clause, so the referent binds to what that
    //     // clause introduced. Reading the lead as context here would be a
    //     // wrong-entity write, which is why the break set is sentence-level
    //     // only.
    //     expect(readMissingValueAnswer('For the hybrid option, set it to 0.8.'))
    //       .toBeNull();
    //   });
    //
    // WHY IT FLIPPED. On the composed journey of 18 Aug 2026 — deployed CEE
    // `4a513781`, with #1034 AND #1035 already live — a fresh guest answered
    // the product's own option-effect ask with
    //   "That would push sales headcount up a lot, set it to 0.8."
    // ONE COMMA where the previous run's user happened to type a dash. This
    // reader returned null, route-v2's answered-ask pre-route never opened,
    // and the turn fell to the FACTOR-BASELINE pre-route, which wrote
    // `3a75cabd.observed_state.value` 0.5 → 0.8 while `interventions` stayed
    // empty. A punctuation mark decided which ENTITY got written.
    //
    // The harm the old rule named is REAL and is now guarded where it was
    // always actually guarded — at the graph, not at the punctuation. The old
    // body's own canonical example still declines end to end, at
    // `resolveOptionEffectWrite`'s conjunct (a): the word "option" makes the
    // shipped classifier claim the sentence (the W1 class), and rule 3c is
    // unreachable for anything the classifier claims. That is asserted, by
    // execution on a real graph, in
    // `composed-journey-run-b-option-effect.test.ts`.
    const witnessed = 'That would push sales headcount up a lot, set it to 0.8.';
    expect(readMissingValueAnswer(witnessed)).toEqual({
      kind: 'numeric',
      elliptical: false,
      percentApplied: false,
      valueText: '0.8',
      modelUnitText: '0.8',
      referent: 'it',
      leadingContext: 'that would push sales headcount up a lot',
    });
    // The old member now READS as an answer here — this module is pure text and
    // has no graph — and the entity check that refuses it lives one seam on.
    expect(readMissingValueAnswer('For the hybrid option, set it to 0.8.')?.kind).toBe('numeric');
    // ⭐ THE OWNER BOUNDARY IS UNCHANGED, which is what keeps the flip additive:
    // a context-bearing answer still never reaches the sole-missing-pair binder.
    expect(matchBareRepairValue('For the hybrid option, set it to 0.8.')).toBeNull();
    expect(matchBareRepairValue(witnessed)).toBeNull();
  });

  it('OPPOSITE DIRECTION — a TRAILING clause still refuses, context or not', () => {
    for (const message of [
      'The costs are fixed - set it to 0.12 and rerun the analysis.',
      'The costs are fixed - set it to 0.12, then tell me what changed.',
      'The costs are fixed - should I set it to 0.12?',
      'The costs are fixed - set it to £5000.',
    ]) {
      expect(matchBareRepairValue(message), message).toBeNull();
      const answer = readMissingValueAnswer(message);
      expect(answer === null || answer.kind !== 'numeric', message).toBe(true);
    }
    // ⚠ 'The costs are fixed - set it to 12%.' LEFT THE LIST ABOVE, and only
    // its READING moved. The trailing-clause arm now reads it as numeric,
    // because a percent is a figure the user stated. What this test is actually
    // about — that `matchBareRepairValue` never claims a context-bearing
    // message — is UNCHANGED and is asserted here rather than dropped.
    expect(matchBareRepairValue('The costs are fixed - set it to 12%.')).toBeNull();
    expect(readMissingValueAnswer('The costs are fixed - set it to 12%.')?.kind).toBe('numeric');
  });

  it('⭐ `matchBareRepairValue` keeps its ENTIRELY-bare contract — one shape, one owner', () => {
    // The field is what keeps the two consumers apart (trap 21). Without this
    // guard the widened reading would silently hand context-bearing answers to
    // a binder whose slot rule is "exactly one pair missing" and which has no
    // reader for what the prose points at.
    expect(readMissingValueAnswer(WITNESSED)?.kind).toBe('numeric');
    expect(matchBareRepairValue(WITNESSED)).toBeNull();
  });

  it('never throws on hostile input, with or without breaks', () => {
    for (const message of ['-', ' - ', '. - .', ';;;', 'set it to - 0.8', '0.8 - set it to']) {
      expect(() => readMissingValueAnswer(message), message).not.toThrow();
    }
  });
});
