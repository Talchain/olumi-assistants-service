/**
 * ⭐⭐ P0a — THE USER ANSWERS THE PRODUCT'S OWN EFFECT-VALUE ASK, AND IT BINDS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT
 *
 * Fresh-journey completion on deployed CEE `f18d941` was 1 of 23. The product
 * drafts a model, refuses to analyse it because option effect values are
 * missing, ASKS the user to supply one — and the user's answer bound **0 of 13
 * times**, including answers phrased exactly as the product itself advises.
 *
 * MEASURED AT PRISTINE `f18d941b2e4c` by driving the real predicates
 * (`readMissingValueAnswer` + `resolveRepairValueBinding`) over the corpus
 * below: **21 of 24 legitimate forms read `null` and resolved
 * `not_bare_value_shape`.** `route-v2.ts:5471` gates the entire repair
 * pre-route on `repairAnswerReading.kind === 'numeric'`, so a `null` reading
 * means the turn is never claimed at all — the witnessed SILENT NO-OP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE TWO CATEGORIES, KEPT ABSOLUTELY APART — this file's whole structure
 *
 *   READ THE NUMBER THE USER STATED  → binds. A hedge qualifies CONFIDENCE, not
 *     the value; "about 0.6" contains the user's own figure and this code moves
 *     it by nothing. A percent sign is NOTATION whose divisor (100) is carried
 *     in the notation itself, over a DIMENSIONLESS scale.
 *   CHOOSE A NUMBER THE USER DID NOT GIVE → stays banned. "high" is never 0.7;
 *     `matchBareRepairValue` still refuses every qualitative reading, so the
 *     `user_specified` stamp (`normalise-option-interventions.ts:191`) cannot
 *     become a lie about provenance.
 *   INVENT A SCALE FRAME → stays banned. "£40,000" is a HUMAN-SCALE quantity
 *     whose divisor is a factor's `scale_frame`
 *     (`tools/handlers/d1-shared/scale-frame.ts`) — a concept that does not
 *     exist for an option effect. Binding one would persist a value PLoT's
 *     `value < 0 || value > 1` gate refuses: a new defect, not a fix.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE CORPUS IS SOURCED FROM OUTSIDE THIS LANE'S HEAD, as the standing brief
 * requires for any predicate over natural language, and EVERY case carries its
 * OPPOSITE-DIRECTION TWIN — a form that must bind beside a form that must still
 * refuse. They cannot share one window (four consecutive rounds were once lost
 * on a neighbouring predicate, each fixing one direction and reopening the
 * other, every round under a fully green suite).
 *
 *   · `SUGGESTED_PHRASING_KNOWN_DROPPED` (`compose/configure-option-clarify-response.ts`)
 *     — "0.6, say" and "I think 0.6 makes sense.", both captured in Paul's live
 *     session, both pinned there as replies the product could not read.
 *   · `MISSING_VALUE_ANSWER_KNOWN_DROPPED` — "Set it to about 0.12.".
 *   · `QUALITATIVE_VALUE_KNOWN_DROPPED` — the refusal direction, unchanged.
 *   · `OPTION_EFFECT_WRITE_KNOWN_DROPPED` / `ANSWERED_ASK_KNOWN_DROPPED` — the
 *     wrong-entity twins ("For the hybrid option, set it to 0.8.").
 *   · the deployed 23-journey measurement that opened this lane — "8%",
 *     "1 month", "I'd say …", "… (ish)".
 */

import { describe, expect, it } from 'vitest';

import {
  MISSING_VALUE_ANSWER_KNOWN_DROPPED,
  readMissingValueAnswer,
  messageAnswersMissingValueAsk,
} from '../missing-value-answer.js';
import {
  resolveRepairValueBinding,
  type RepairValueBindingResolution,
} from '../repair-value-binding.js';

const OPTION_ID = 'opt-hire';
const FACTOR_ID = 'fac-payroll';

/**
 * The readiness the product is showing when it asks. `status:
 * 'needs_user_input'` is load-bearing: `deriveOnScreenEffectAsk` requires it,
 * because a bare figure's ONLY antecedent is the question actually rendered.
 */
const READINESS = {
  status: 'needs_user_input',
  blockers: [
    {
      blocker_type: 'missing_value',
      option_id: OPTION_ID,
      option_label: 'Hire two engineers',
      factor_id: FACTOR_ID,
      factor_label: 'Payroll cost',
    },
  ],
} as unknown as Parameters<typeof resolveRepairValueBinding>[0]['readiness'];

function resolve(message: string): RepairValueBindingResolution {
  return resolveRepairValueBinding({ message, readiness: READINESS });
}

/**
 * ⭐ BOUND **BY IDENTITY**, never by a value predicate another slot could
 * satisfy (trap 19). A resolution that wrote the right number to the wrong pair
 * would satisfy a value-only assertion and is exactly the harm this seam exists
 * to prevent, so the option id and the factor id are asserted on every bind.
 */
function expectBoundTo(message: string, expectedValueText: string): void {
  const r = resolve(message);
  expect(r.matched, `"${message}" did not resolve`).toBe(true);
  if (!r.matched) return;
  expect(r.kind, `"${message}" resolved as ${r.kind}`).toBe('bind');
  if (r.kind !== 'bind') return;
  expect(r.pair.optionId, `"${message}" bound the wrong option`).toBe(OPTION_ID);
  expect(r.pair.factorId, `"${message}" bound the wrong factor`).toBe(FACTOR_ID);
  expect(r.valueText, `"${message}" wrote the wrong value`).toBe(expectedValueText);
  // The instruction is what the edit lane executes; it must carry the canonical
  // figure and both labels, or the write lands somewhere else or not at all.
  expect(r.instruction).toContain(expectedValueText);
  expect(r.instruction).toContain('Hire two engineers');
  expect(r.instruction).toContain('Payroll cost');
}

function expectNoBind(message: string): void {
  const r = resolve(message);
  const bound = r.matched && r.kind === 'bind';
  expect(bound, `"${message}" bound and must not have`).toBe(false);
}

describe('a hedged figure binds — the hedge is about confidence, not the value', () => {
  it.each([
    // CQE's own hedge vocabulary (`context/cqe/rules.ts:35`).
    ['about 0.6', '0.6'],
    ['roughly 0.6', '0.6'],
    ['around 0.6', '0.6'],
    ['approximately 0.6', '0.6'],
    ['nearly 0.6', '0.6'],
    ['circa 0.6', '0.6'],
    // The symbol form of the same hedge.
    ['~0.6', '0.6'],
    // Paul's live session, pinned in `SUGGESTED_PHRASING_KNOWN_DROPPED`.
    ['0.6, say', '0.6'],
    ['I think 0.6 makes sense.', '0.6'],
    // The deployed 23-journey measurement.
    ["I'd say 0.6", '0.6'],
    ['0.6 (ish)', '0.6'],
    ['0.6ish', '0.6'],
    ['maybe 0.6', '0.6'],
    ["let's say 0.6", '0.6'],
    ['call it 0.6', '0.6'],
    // The hedge inside each of the three verb shapes, not just the bare form.
    ['Set it to about 0.12.', '0.12'],
    ['Make it roughly 0.6.', '0.6'],
    ['Use about 0.6.', '0.6'],
    ['Yes, set it to about 0.6.', '0.6'],
  ])('%s binds to the asked pair as %s', (message, expected) => {
    expectBoundTo(message, expected);
  });

  it('does NOT move the number the user gave', () => {
    // The whole risk of admitting a hedge is that the figure drifts. It does
    // not: the hedge is stripped, the digits are untouched.
    for (const [message, expected] of [
      ['about 0.123456', '0.123456'],
      ['roughly .5', '.5'],
      ['~0.05', '0.05'],
    ] as const) {
      expectBoundTo(message, expected);
    }
  });
});

describe('percent NOTATION binds as the fraction it denotes', () => {
  it.each([
    ['8%', '0.08'],
    ['60%', '0.6'],
    ['100%', '1'],
    ['0%', '0'],
    ['12.5%', '0.125'],
    ['8 percent', '0.08'],
    ['8 per cent', '0.08'],
    ['Set it to 60%.', '0.6'],
    ['about 60%', '0.6'],
  ])('%s binds as %s', (message, expected) => {
    expectBoundTo(message, expected);
  });

  it('⭐ writes the CANONICAL 0-1 spelling, never the percent token', () => {
    // The instruction is re-read by `readOptionEffectValue`, which DECLINES a
    // percent sign. A resolution carrying "8%" would fail to land two seams
    // later with nothing on screen to explain why.
    const r = resolve('8%');
    expect(r.matched && r.kind === 'bind').toBe(true);
    if (!r.matched || r.kind !== 'bind') return;
    expect(r.instruction).not.toContain('%');
    expect(r.instruction).toContain('0.08');
  });

  it('⭐ 100% binds, and so does a bare 1 WHEN NO ORDINAL OFFER COULD EXIST', () => {
    // ⚠⚠ THE ORDINAL GUARD WAS NARROWED, NOT REMOVED, and the narrowing is the
    // whole point. `1` is INSIDE the producer's own scale, and refusing it
    // refused the top of the range — measured on deployed `f18d941` against a
    // model with ONE outstanding blocker, with no hint anywhere that `1.0`
    // would have worked. The measured collision it was written for comes from
    // THIS lane's own ask arm, which offers numbered chips ONLY when two or
    // more pairs are outstanding. This fixture has exactly one, so no numbered
    // offer can have been made and there is nothing to collide with.
    expectBoundTo('100%', '1');
    expectBoundTo('1', '1');
    expectBoundTo('1.0', '1.0');
  });

  it('⚠ THE TWIN — with TWO pairs outstanding a bare 1 is refused again', () => {
    // The discriminating half. Same message, same binder, different state: an
    // ordinal reading is now possible, so the estate declines rather than picks.
    const twoPairs = {
      status: 'needs_user_input',
      blockers: [
        {
          blocker_type: 'missing_value',
          option_id: OPTION_ID, option_label: 'Hire two engineers',
          factor_id: FACTOR_ID, factor_label: 'Payroll cost',
        },
        {
          blocker_type: 'missing_value',
          option_id: 'opt-b', option_label: 'Outsource',
          factor_id: 'fac-b', factor_label: 'Delivery risk',
        },
      ],
    } as unknown as Parameters<typeof resolveRepairValueBinding>[0]['readiness'];
    const r = resolveRepairValueBinding({ message: '1', readiness: twoPairs });
    expect(r.matched).toBe(false);
    if (r.matched) return;
    expect(r.reason).toBe('bare_value_not_model_unit');
    // …while the unambiguous spellings still bind even there.
    for (const message of ['1.0', '100%']) {
      const ok = resolveRepairValueBinding({ message, readiness: twoPairs });
      // Two pairs outstanding => the referent is genuinely ambiguous for a
      // context-free figure, so the honest outcome is the per-pair ASK, never a
      // guess. What matters here is that it is not refused on SCALE.
      expect(ok.matched, message).toBe(true);
    }
  });
});

describe('⚠ THE OPPOSITE-DIRECTION TWINS — these must STILL refuse', () => {
  it.each([
    // A HUMAN-SCALE quantity. Its divisor is a factor `scale_frame`, which does
    // not exist for an option effect: binding it would persist a value the
    // compute refuses (PLoT gates `value < 0 || value > 1`).
    '£40,000',
    '$40000',
    '40,000',
    '40000',
    '40k',
    '1.2m',
    '3bn',
    'about 40000',
    'roughly £40k',
    '40000 (ish)',
    // A quantity with a UNIT of a different kind.
    '3 months',
    '12 weeks',
    '1 month',
    '18 units',
    // ⚠ '1' LEFT THIS LIST — it is inside the scale and now binds when no
    // numbered offer could exist; its refusing twin is asserted above. '2' and
    // '3' are still refused, and by RANGE rather than by ordinal shape.
    '2',
    '3',
    // A WORD in the value slot — never mapped to a number.
    'high',
    'low',
    'Set it to high.',
    'Set it to a third.',
    'Set it to roughly half.',
    // The message names an entity, so the edit lane owns the referent.
    'Set it to 0.12 for the subcontracting option.',
    'For the hybrid option, set it to 0.8.',
    'The team disagrees, set the Payroll cost baseline to 0.8.',
    // A question is not an answer.
    'What should I set it to?',
    'Should it be 0.6?',
    // ⭐ BATCHED — banned by ruling. Binding several values BY ORDER can attach
    // the user's figure to the wrong factor, which is worse than refusing.
    'Set A to 0.2 and B to 0.4.',
    '0.6 and 0.3',
    '0.2, 0.4, 0.6',
    // A hedge with no figure is not a figure.
    'about',
    'say',
    'maybe',
    'I think so',
  ])('%s does not bind', (message) => {
    expectNoBind(message);
  });

  it('⭐⭐ THE VERB-BEARING ARM RANGE-CHECKS TOO — a live fabrication hole, closed', () => {
    // ⚠⚠ THE CLASS MY OWN CORPUS DID NOT IMAGINE, and it was found by the
    // sibling probe rather than by me — the standing brief's point about a
    // corpus from the author's head exactly. MEASURED at this tip before the
    // fix, by driving the real resolver:
    //
    //   'Set it to 40000.'  -> { matched: true, kind: 'bind', valueText: '40000' }
    //   'Set it to 40,000.' -> bind   ·   'Make it 500.' -> bind   ·   'Use 1200.' -> bind
    //
    // i.e. a USER-SCALE figure bound as a 0-1 effect value on the verb-bearing
    // path, while the elliptical path refused the identical number. The range
    // guard existed and was applied to ONE arm.
    for (const message of [
      'Set it to 40000.',
      'Set it to 40,000.',
      'Set it to 8.',
      'Make it 500.',
      'Use 1200.',
      'Set it to 2.',
      'Set it to 400%.',
    ]) {
      expectNoBind(message);
      const r = resolve(message);
      expect(r.matched, message).toBe(false);
      if (r.matched) continue;
      expect(r.reason, message).toBe('bare_value_not_model_unit');
    }
  });

  it('⚠ THE TWIN — an IN-SCALE verb-bearing answer still binds, including a bare 1', () => {
    // The discriminating half: the guard must refuse by RANGE, not refuse the
    // arm. A bare `1` is admitted here because a verb-bearing sentence is never
    // an ordinal selection.
    for (const [message, expected] of [
      ['Set it to 0.6.', '0.6'],
      ['Set it to 1.', '1'],
      ['Set it to 0.', '0'],
      ['Set it to 60%.', '0.6'],
      ['Make it 0.05.', '0.05'],
    ] as const) {
      expectBoundTo(message, expected);
    }
  });

  it('a bare figure outside the 0-1 effect scale refuses by RANGE, not by shape', () => {
    // The reason matters: it is what a useful refusal would be composed from.
    const r = resolve('40000');
    expect(r.matched).toBe(false);
    if (r.matched) return;
    expect(r.reason).toBe('bare_value_not_model_unit');
  });

  it('a hedged out-of-scale figure refuses by RANGE too — the hedge changed nothing', () => {
    const r = resolve('about 40000');
    expect(r.matched).toBe(false);
    if (r.matched) return;
    expect(r.reason).toBe('bare_value_not_model_unit');
  });

  it('⭐ a percent OUTSIDE the scale still refuses — the notation is not a licence', () => {
    // 400% is 4.0, which is not an effect value. Reading the notation must not
    // become "any percent is acceptable".
    expectNoBind('400%');
    const r = resolve('400%');
    expect(r.matched).toBe(false);
    if (r.matched) return;
    expect(r.reason).toBe('bare_value_not_model_unit');
  });
});

describe('the antecedent is still the question ON SCREEN', () => {
  it('a hedged bare figure does NOT bind when the product is asking something else', () => {
    // `deriveOnScreenEffectAsk` gates on `status === 'needs_user_input'`. A
    // graph blocked on an orphan node renders "resolve the model issue", and a
    // figure typed under that sentence answers no question anybody asked.
    const blocked = {
      status: 'blocked',
      blockers: [
        {
          blocker_type: 'missing_value',
          option_id: OPTION_ID,
          option_label: 'Hire two engineers',
          factor_id: FACTOR_ID,
          factor_label: 'Payroll cost',
        },
      ],
    } as unknown as Parameters<typeof resolveRepairValueBinding>[0]['readiness'];
    for (const message of ['about 0.6', '8%', '0.6, say']) {
      const r = resolveRepairValueBinding({ message, readiness: blocked });
      expect(r.matched, message).toBe(false);
      if (r.matched) continue;
      expect(r.reason, message).toBe('no_outstanding_ask');
    }
  });

  it('two outstanding pairs and a REFERENT-bearing hedge ASKS rather than guessing', () => {
    const twoPairs = {
      status: 'needs_user_input',
      blockers: [
        {
          blocker_type: 'missing_value',
          option_id: OPTION_ID, option_label: 'Hire two engineers',
          factor_id: FACTOR_ID, factor_label: 'Payroll cost',
        },
        {
          blocker_type: 'missing_value',
          option_id: 'opt-b', option_label: 'Outsource',
          factor_id: 'fac-b', factor_label: 'Delivery risk',
        },
      ],
    } as unknown as Parameters<typeof resolveRepairValueBinding>[0]['readiness'];
    const r = resolveRepairValueBinding({
      message: 'Set it to about 0.6.',
      readiness: twoPairs,
    });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.kind).toBe('ask');
    if (r.kind !== 'ask') return;
    expect(r.pairs).toHaveLength(2);
    // The chips carry the CANONICAL figure, because their replay message is
    // executed by the writer.
    expect(r.valueText).toBe('0.6');
  });
});

describe('⭐ KNOWN-UNBOUND — pinned as data so the suite REDs if the set GROWS or SHRINKS', () => {
  /**
   * Phrasings this lane KNOWINGLY leaves unbound, each with a stated reason. A
   * gap recorded in the suite is honest; a gap invisible to it is how four
   * rounds happened.
   */
  const KNOWN_UNBOUND: readonly { readonly message: string; readonly why: string }[] = [
    {
      message: 'Set it to a third.',
      why:
        'a WORD NUMBER. Parsing it means choosing between 0.33 and 0.333…, i.e. inventing '
        + 'precision the user did not give. Unchanged from pristine.',
    },
    {
      message: 'Set it to 0.12 for the subcontracting option.',
      why: 'NAMES A TARGET inside the answering clause, so the edit lane owns it. Must stay refused.',
    },
    {
      message: 'It went up a lot,set it to 0.12.',
      why:
        'a clause break with NO following space. Pre-existing, pinned before this lane; widening a '
        + 'conjunct this lane did not come to change is the "while we\'re here" work the scope rule bans.',
    },
    {
      message: 'The costs are fixed - set it to about 0.8.',
      why:
        '⚠ ADDED BY THIS LANE. A HEDGED, CONTEXT-BEARING answer. The reading now succeeds (arm 2, '
        + 'referent present), but rule 3c re-reads the figure with `readOptionEffectValue`, whose '
        + '`\\bto\\s+` anchor does not reach across a hedge word — so the turn declines exactly as it '
        + 'did at pristine. NO REGRESSION, and closing it belongs to `option-effect-write.ts`, which '
        + 'is not this lane\'s file.',
    },
    {
      message: '2',
      why:
        'OUT OF SCALE. Not an ordinal refusal — the range guard alone declines it, and it would '
        + 'decline it identically however many pairs were outstanding.',
    },
    {
      message: '£40,000',
      why:
        'a HUMAN-SCALE quantity. Its divisor is a factor `scale_frame`, a concept that does not exist '
        + 'for an option effect; converting it would invent a frame and persist a value the compute '
        + 'refuses. The honest behaviour is to refuse and say what is needed.',
    },
    {
      message: '3 months',
      why: 'a quantity with a unit of a different kind. Same reason as the currency case.',
    },
    {
      message: 'Set A to 0.2 and B to 0.4.',
      why:
        '⭐ BATCHED, and DELIBERATELY not closed. Binding several values by ORDER can attach the '
        + "user's figure to the wrong factor. The honest behaviour is the `ask` arm's per-pair chips.",
    },
  ];

  it('every member is unbound, for the reason stated', () => {
    for (const { message } of KNOWN_UNBOUND) expectNoBind(message);
  });

  it('⭐ every member nonetheless TERMINATES the demand where it is an answer at all', () => {
    // Termination and binding are different questions with different costs. A
    // hedged, targeted or out-of-scale answer is still unmistakably an ANSWER,
    // and repeating the identical demand at it is the witnessed loop.
    for (const message of [
      'Set it to a third.',
      'Set it to 0.12 for the subcontracting option.',
      '£40,000',
      'Set A to 0.2 and B to 0.4.',
    ]) {
      expect(messageAnswersMissingValueAsk(message) || readMissingValueAnswer(message) !== null, message)
        .toBe(true);
    }
  });

  it('the pinned known-dropped set is EXACTLY these three', () => {
    // ⚠ REDs if the set grows OR shrinks. "Set it to about 0.12." left it in
    // this lane; see the constant's own header for the withdrawn reason.
    expect([...MISSING_VALUE_ANSWER_KNOWN_DROPPED]).toStrictEqual([
      'Set it to a third.',
      'Set it to 0.12 for the subcontracting option.',
      'It went up a lot,set it to 0.12.',
    ]);
  });
});

describe('nothing that bound at pristine stops binding', () => {
  it.each([
    ['0.6', '0.6'],
    ['0.12', '0.12'],
    ['.12', '.12'],
    ['0', '0'],
    ['Set it to 0.6.', '0.6'],
    ['Set the value to 0.6.', '0.6'],
    ['Change it to 0.6.', '0.6'],
    ['Make it 0.12.', '0.12'],
    ['Use 0.12.', '0.12'],
    ['Set it to .12.', '.12'],
    ['Yes, set it to 0.12.', '0.12'],
    ['  0.6  ', '0.6'],
  ])('%s still binds as %s', (message, expected) => {
    expectBoundTo(message, expected);
  });
});
