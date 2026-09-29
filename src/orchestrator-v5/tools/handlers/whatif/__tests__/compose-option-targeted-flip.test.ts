/**
 * M1 — the ANSWER: addressed about the named option, or a typed refusal.
 *
 * ⚠ THE DEFECT THIS PINS, captured at staging HEAD `74d997a6` before the fix.
 * Asked *"what would make Engage Offshore Partner win?"* on a run whose flip
 * rows ALL name `opt_hire_local`, `composeWhatWouldFlipFallback` answered:
 *
 *   "'Maintain Current Team (Status Quo)' currently leads, with a probability of
 *    52%. … Engineering Capacity and Hiring and Staffing Cost are the most
 *    likely single factors to change which option leads, so they are the
 *    clearest ones to test. If that happened, Hire Two Senior Engineers Locally
 *    would lead instead. …"
 *
 * — a different option named as the one that would lead, and the option asked
 * about not mentioned once. The first test below is that exact scenario.
 */
import { describe, it, expect } from 'vitest';

import {
  composeOptionTargetedFlipAnswer as composeRaw,
  type OptionTargetedFlipAnswer,
} from '../compose-option-targeted-flip.js';
import type { TargetOption } from '../resolve-target-option.js';
import type { FlipEntry, FlipSummary } from '../../../../compose/flip-proposal.js';
import { textAssertsLeadingOption } from '../../../../compose/leading-option-egress-guard.js';

const OFFSHORE: TargetOption = { id: 'opt_offshore', label: 'Engage Offshore Partner' };
const HIRE: TargetOption = { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' };
/** The current leader on the pinned scenario — neither OFFSHORE nor HIRE. */
const LEADER_ID = 'opt_status_quo';

/**
 * Default harness: a PERMITTING verdict with a known leader that is NOT the
 * target. Every case that is not specifically about position uses this, so the
 * position logic is exercised only where it is the subject.
 */
function composeOptionTargetedFlipAnswer(
  target: TargetOption,
  flipSummary: FlipSummary | null | undefined,
  over: { leadingOptionId?: string | null; mayNameLeadingOption?: boolean } = {},
): OptionTargetedFlipAnswer | null {
  return composeRaw({
    target,
    flipSummary,
    leadingOptionId: over.leadingOptionId === undefined ? LEADER_ID : over.leadingOptionId,
    mayNameLeadingOption: over.mayNameLeadingOption ?? true,
  });
}

function entry(over: Partial<FlipEntry> = {}): FlipEntry {
  return {
    factor_id: 'fac_eng_capacity',
    factor_label: 'Engineering Capacity',
    flip_value: 0.62,
    direction: 'increase',
    unit: null,
    value_scale: 'model',
    flip_reason: null,
    margin_supports_flip: true,
    alternative_winner_id: 'opt_hire_local',
    alternative_winner_label: 'Hire Two Senior Engineers Locally',
    ...over,
  };
}

function summary(entries: FlipEntry[], status: FlipSummary['overall_status']): FlipSummary {
  return { overall_status: status, entries, margin_supports_flip: true };
}

/** Every flip row names opt_hire_local. The user asked about opt_offshore. */
const FLIPS_TO_HIRE = summary(
  [
    entry(),
    entry({
      factor_id: 'fac_hiring_cost',
      factor_label: 'Hiring and Staffing Cost',
      flip_value: 0.41,
      direction: 'decrease',
    }),
  ],
  'concrete',
);

describe('THE DEFECT — the answer must address the option the user NAMED', () => {
  it('refuses honestly when nothing flips to the named option, and NAMES it', () => {
    const a = composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe('refused');
    expect((a as Extract<OptionTargetedFlipAnswer, { kind: 'refused' }>).reason).toBe(
      'no_flip_to_target',
    );
    // The answer is ABOUT the option asked about …
    expect(a!.text).toContain('Engage Offshore Partner');
    // … and does NOT hand back the other option as though it were the answer.
    expect(a!.text).not.toContain('Hire Two Senior Engineers Locally');
  });

  it('addresses the SAME evidence when the named option IS the one that flips', () => {
    // Identical flip rows, different question. The answer must change.
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE);
    expect(a!.kind).toBe('addressed');
    expect(a!.text).toContain('Hire Two Senior Engineers Locally would lead instead');
    expect(a!.text).toContain('Engineering Capacity');
    expect(a!.text).toContain('Hiring and Staffing Cost');
  });

  it('names the DIRECTION of travel from the row, scale-free', () => {
    const a = composeOptionTargetedFlipAnswer(
      HIRE,
      summary([entry({ direction: 'decrease' })], 'concrete'),
    );
    expect(a!.text).toContain('Engineering Capacity falls past its tipping point');
  });

  it('falls open to neutral phrasing on an unrecognised direction — never guesses', () => {
    for (const direction of ['sideways', null, '']) {
      const a = composeOptionTargetedFlipAnswer(
        HIRE,
        summary([entry({ direction })], 'concrete'),
      );
      expect(a!.text).toContain('Engineering Capacity passes its tipping point');
      expect(a!.text).not.toContain('rises');
      expect(a!.text).not.toContain('falls');
    }
  });
});

describe('IDENTITY, never labels', () => {
  it('matches on alternative_winner_id even when the LABEL was renamed', () => {
    // The graph label the user matched has been renamed since the analysis ran;
    // PLoT still carries the stale label. A label-matcher misses this row. The
    // id-matcher does not.
    const renamed: TargetOption = { id: 'opt_hire_local', label: 'Hire Two Seniors In-House' };
    const a = composeOptionTargetedFlipAnswer(renamed, FLIPS_TO_HIRE);
    expect(a!.kind).toBe('addressed');
    // Display comes from the GRAPH label — the words in front of the user —
    // never from PLoT's `alternative_winner_label`.
    expect(a!.text).toContain('Hire Two Seniors In-House');
    expect(a!.text).not.toContain('Hire Two Senior Engineers Locally');
  });

  it('does NOT match on a shared label across different ids', () => {
    // Two options can share a display label. Matching on the label would answer
    // about an option the analysis never named.
    const twin: TargetOption = { id: 'opt_twin', label: 'Hire Two Senior Engineers Locally' };
    const a = composeOptionTargetedFlipAnswer(twin, FLIPS_TO_HIRE);
    expect(a!.kind).toBe('refused');
  });

  it('an id-ECHO label does not block an id match — the id is the identity', () => {
    // PLoT's resolveLabel echoes the raw option id when its lookup fails. The
    // identity is still known, and we print the GRAPH label anyway.
    const a = composeOptionTargetedFlipAnswer(
      HIRE,
      summary([entry({ alternative_winner_label: 'opt_hire_local' })], 'concrete'),
    );
    expect(a!.kind).toBe('addressed');
    expect(a!.text).not.toContain('opt_hire_local');
  });

  it('a row with no winner identity is not evidence, even if it has a label', () => {
    const a = composeOptionTargetedFlipAnswer(
      HIRE,
      summary(
        [entry({ alternative_winner_id: null, alternative_winner_label: HIRE.label })],
        'concrete',
      ),
    );
    expect(a!.kind).toBe('refused');
  });

  it('a matching row with NO finite flip_value carries no tipping point to describe', () => {
    for (const flip_value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = composeOptionTargetedFlipAnswer(
        HIRE,
        summary([entry({ flip_value })], 'concrete'),
      );
      expect(a!.kind).toBe('refused');
    }
  });
});

describe('THE TYPED REFUSAL — a first-class outcome, one per honest state', () => {
  it('no_practical_flip: nothing flips at all', () => {
    const a = composeOptionTargetedFlipAnswer(
      OFFSHORE,
      summary(
        [entry({ flip_value: null, flip_reason: 'no_effect_within_bounds', alternative_winner_id: null })],
        'no_practical_flip',
      ),
    );
    expect(a!.kind).toBe('refused');
    expect((a as Extract<OptionTargetedFlipAnswer, { kind: 'refused' }>).reason).toBe(
      'no_practical_flip',
    );
    expect(a!.text).toContain('no single-factor tipping point at all');
    expect(a!.text).toContain('Engage Offshore Partner');
  });

  it('indeterminate: rows exist but isolate no tipping point — no verdict, and it says so', () => {
    const a = composeOptionTargetedFlipAnswer(
      OFFSHORE,
      summary([entry({ flip_value: null, flip_reason: null, alternative_winner_id: null })], 'insufficient_data'),
    );
    expect(a!.kind).toBe('refused');
    expect((a as Extract<OptionTargetedFlipAnswer, { kind: 'refused' }>).reason).toBe(
      'indeterminate',
    );
    expect(a!.text).toContain('did not isolate a single-factor tipping point');
    // It must not claim nothing WOULD work — it does not know that.
    expect(a!.text).not.toContain('none of the single-factor changes');
  });

  it('NEVER fabricates a threshold — no flip_value appears in any refusal', () => {
    for (const status of ['concrete', 'no_practical_flip', 'insufficient_data'] as const) {
      const a = composeOptionTargetedFlipAnswer(
        OFFSHORE,
        summary([entry({ flip_value: 0.62 })], status),
      );
      expect(a!.kind).toBe('refused');
      expect(a!.text).not.toMatch(/0\.62|62/);
    }
  });

  it('the ADDRESSED answer quotes no threshold value either — the chip owns the number', () => {
    const a = composeOptionTargetedFlipAnswer(HIRE, summary([entry({ flip_value: 0.62 })], 'concrete'));
    expect(a!.kind).toBe('addressed');
    expect(a!.text).not.toMatch(/0\.62/);
  });

  it('every refusal is specific: it names the option and says what was probed', () => {
    const reasons: FlipSummary['overall_status'][] = [
      'concrete',
      'no_practical_flip',
      'insufficient_data',
    ];
    for (const status of reasons) {
      const a = composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], status));
      expect(a!.kind).toBe('refused');
      expect(a!.text).toContain('Engage Offshore Partner');
      expect(a!.text.length).toBeGreaterThan(80);
      // Never a generic deflection.
      expect(a!.text).not.toMatch(/could not be summarised|something went wrong|not sure what/i);
    }
  });
});

describe('NO EVIDENCE ⇒ null, so existing behaviour is preserved byte-for-byte', () => {
  it('returns null when there is no flip evidence at all', () => {
    expect(composeOptionTargetedFlipAnswer(OFFSHORE, null)).toBeNull();
    expect(composeOptionTargetedFlipAnswer(OFFSHORE, undefined)).toBeNull();
    expect(composeOptionTargetedFlipAnswer(OFFSHORE, summary([], 'none'))).toBeNull();
  });
});

describe('"only" is a completeness claim and is made only when it is true', () => {
  it('one matching row ⇒ "the only single-factor change"', () => {
    const a = composeOptionTargetedFlipAnswer(HIRE, summary([entry()], 'concrete'));
    expect(a!.text).toContain('the only single-factor change');
  });

  it('more matching rows than we name ⇒ no exhaustiveness claim', () => {
    const three = summary(
      [
        entry(),
        entry({ factor_id: 'f2', factor_label: 'Hiring and Staffing Cost' }),
        entry({ factor_id: 'f3', factor_label: 'Offshore Engagement' }),
      ],
      'concrete',
    );
    const a = composeOptionTargetedFlipAnswer(HIRE, three);
    expect(a!.text).not.toContain('the only');
    // Completeness is NOT claimed over a truncated set.
    expect(a!.text).not.toContain('Those are');
    expect(a!.text).toContain('Those include the single-factor changes');
    // Capped at two named levers, like the generic composer.
    expect(a!.text).not.toContain('Offshore Engagement');
  });
});

describe('F1 — the target may BE the option that has already won', () => {
  /**
   * A flip row's `alternative_winner_id` is by construction never the current
   * leader, so without a leader check "what would make {the leader} win?"
   * deterministically produced "none of the changes would put this in favour of
   * X" — vacuously true, and pragmatically asserting that the winning option
   * trails.
   */
  it('VISIBLE run, target IS the leader ⇒ says so, never a refusal', () => {
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE, {
      leadingOptionId: HIRE.id,
      mayNameLeadingOption: true,
    });
    expect(a!.kind).toBe('already_leading');
    expect(a!.text).toContain('Hire Two Senior Engineers Locally is already the leading option');
    expect(a!.text).not.toContain('none of the single-factor changes');
    expect(a!.text).not.toContain('in favour of');
  });

  it('VISIBLE run, target is the leader, and NOTHING flips at all ⇒ still says so', () => {
    const a = composeOptionTargetedFlipAnswer(
      HIRE,
      summary([entry({ flip_value: null, alternative_winner_id: null })], 'no_practical_flip'),
      { leadingOptionId: HIRE.id, mayNameLeadingOption: true },
    );
    expect(a!.kind).toBe('already_leading');
  });

  /**
   * THE 1/N CASE. On a withheld run the user cannot know the leader, so a
   * fraction of targeted questions name it. Pre-amendment they received a
   * leader-free refusal that survived the withheld gate BY DESIGN and induced a
   * false belief about the hidden leader — worse than HEAD, where those turns
   * were replaced wholesale with neutral copy.
   */
  it('WITHHELD run, target IS the hidden leader ⇒ places it nowhere', () => {
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE, {
      leadingOptionId: HIRE.id,
      mayNameLeadingOption: false,
    });
    expect(a!.kind).toBe('position_unstated');
    // Does not assert it trails …
    expect(a!.text).not.toContain('in favour of');
    expect(a!.text).not.toContain('none of the single-factor changes');
    // … and does not confirm it leads.
    expect(a!.text).not.toMatch(/already the leading option|leads/i);
    expect(a!.text).toContain('cannot say where Hire Two Senior Engineers Locally stands');
  });

  /**
   * ⚠ THE ORACLE PROPERTY. If withheld copy differed when the target happens to
   * be the leader, a user could name each option in turn and read the leader off
   * whichever produced the odd answer. Every unmatched target must get the SAME
   * words.
   */
  it('WITHHELD run: leader and non-leader targets are INDISTINGUISHABLE', () => {
    const noFlipSummary = summary(
      [entry({ flip_value: null, alternative_winner_id: null })],
      'no_practical_flip',
    );
    const asLeader = composeOptionTargetedFlipAnswer(HIRE, noFlipSummary, {
      leadingOptionId: HIRE.id,
      mayNameLeadingOption: false,
    });
    const asNonLeader = composeOptionTargetedFlipAnswer(HIRE, noFlipSummary, {
      leadingOptionId: 'opt_status_quo',
      mayNameLeadingOption: false,
    });
    expect(asLeader!.kind).toBe(asNonLeader!.kind);
    expect(asLeader!.text).toBe(asNonLeader!.text);
  });

  it('WITHHELD run: the factor picture is the GENERIC set, so it cannot leak either', () => {
    // A target-FILTERED picture is empty exactly when the target leads, which
    // would reintroduce the oracle through the back door.
    const a = composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE, {
      leadingOptionId: 'opt_status_quo',
      mayNameLeadingOption: false,
    });
    expect(a!.kind).toBe('position_unstated');
    expect(a!.text).toContain('Engineering Capacity');
    // Names factors, never who would win.
    expect(a!.text).not.toContain('Hire Two Senior Engineers Locally');
  });

  it('an ADDRESSED answer still ships on a withheld run — that claim is licensed', () => {
    // A row naming the target proves the target is not the leader, and naming
    // the COUNTERFACTUAL winner is what the `^`-anchored key patterns preserve.
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE, {
      leadingOptionId: 'opt_status_quo',
      mayNameLeadingOption: false,
    });
    expect(a!.kind).toBe('addressed');
  });

  it('FAIL CLOSED: an unstated permission is treated as withholding', () => {
    const a = composeRaw({
      target: OFFSHORE,
      flipSummary: FLIPS_TO_HIRE,
      leadingOptionId: 'opt_status_quo',
      // mayNameLeadingOption deliberately omitted
    });
    expect(a!.kind).toBe('position_unstated');
  });

  it('permitted but leader UNKNOWN ⇒ declines to place the target, does not guess', () => {
    for (const leadingOptionId of [null, undefined, '']) {
      // composeRaw directly: the harness substitutes a default for `undefined`.
      const a = composeRaw({
        target: OFFSHORE,
        flipSummary: FLIPS_TO_HIRE,
        leadingOptionId,
        mayNameLeadingOption: true,
      });
      expect(a!.kind).toBe('position_unstated');
      expect((a as Extract<OptionTargetedFlipAnswer, { kind: 'position_unstated' }>).reason).toBe(
        'leader_unknown',
      );
      expect(a!.text).not.toContain('could not put a single option forward');
      expect(a!.text).toContain('cannot tell from what this run recorded');
    }
  });

  it('a non-leading target on a permitted run still gets the honest refusal', () => {
    const a = composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE, {
      leadingOptionId: 'opt_status_quo',
      mayNameLeadingOption: true,
    });
    expect(a!.kind).toBe('refused');
    expect(a!.text).toContain('in favour of Engage Offshore Partner');
  });
});

describe('F2 — completeness is claimed only when the named set IS the whole set', () => {
  it('exactly two matches, both named ⇒ "Those are" (a true completeness claim)', () => {
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE);
    expect(a!.kind).toBe('addressed');
    expect(a!.text).toContain('Those are the single-factor changes');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHHELD-RUN CLAIM SAFETY — the pin the lane brief asks for.
 *
 * On a withheld run `projectExplanationAnswerForWithheldClaim` REPLACES the
 * whole answer when it trips the shared leader vocabulary. The existing generic
 * flip prose does trip it (it opens "'…' currently leads"), which is measured in
 * the sibling test below. A targeted answer that did the same would be destroyed
 * before the user ever saw the option they asked about.
 */
describe('WITHHELD RUNS — targeted prose survives its own egress', () => {
  const WITHHELD = { mayNameLeadingOption: false, leadingOptionId: 'opt_status_quo' };
  /**
   * Every branch that can SHIP ON A WITHHELD RUN. `already_leading` is
   * deliberately excluded — it is unreachable without a permitting verdict, and
   * it asserts a leader by design (its inverse control is the last test here).
   */
  const ALL_BRANCHES: OptionTargetedFlipAnswer[] = [
    composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE, WITHHELD)!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry()], 'concrete'), WITHHELD)!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry({ direction: 'decrease' })], 'concrete'), WITHHELD)!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry({ direction: null })], 'concrete'), WITHHELD)!,
    // position_unstated, all three flip statuses, both reasons
    composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE, WITHHELD)!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'no_practical_flip'), WITHHELD)!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'insufficient_data'), WITHHELD)!,
    composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE, { leadingOptionId: null, mayNameLeadingOption: true })!,
    // the permitted refusals — they ship on VISIBLE runs, but must stay clean
    composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE)!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'no_practical_flip'))!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'insufficient_data'))!,
  ];

  it('non-vacuity: every branch produced real prose, and all four kinds are covered', () => {
    expect(ALL_BRANCHES).toHaveLength(11);
    for (const a of ALL_BRANCHES) expect(a.text.length).toBeGreaterThan(60);
    expect(new Set(ALL_BRANCHES.map((a) => a.kind))).toEqual(
      new Set(['addressed', 'position_unstated', 'refused']),
    );
  });

  it('NO targeted answer asserts a leading option — so none is replaced wholesale', () => {
    const tripped = ALL_BRANCHES.filter((a) => textAssertsLeadingOption(a.text)).map(
      (a) => `${a.kind}: ${a.text.slice(0, 140)}`,
    );
    expect(
      tripped,
      'A targeted flip answer trips the shared leader vocabulary. On a withheld run ' +
        'projectExplanationAnswerForWithheldClaim replaces the whole answer with generic ' +
        'withheld copy, so the user never sees the option they asked about. Reword the ' +
        'copy in compose-option-targeted-flip.ts — do not narrow the pattern set.',
    ).toEqual([]);
  });

  it('no targeted answer names or implies the CURRENT leader', () => {
    // The composers receive the leader's ID but never a leader LABEL, and no
    // branch that can ship on a withheld run prints anything about position.
    for (const a of ALL_BRANCHES) {
      expect(a.text).not.toContain('Maintain Current Team');
      expect(a.text).not.toContain('opt_status_quo');
      expect(a.text).not.toMatch(/currently leads|beats|ahead of/i);
    }
  });

  it('INVERSE CONTROL — already_leading DOES assert a leader, so the gate can see it', () => {
    // It is licensed only by a permitting verdict; the withheld gate is its
    // backstop, and a claim the gate cannot see has no backstop.
    const a = composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE, {
      leadingOptionId: HIRE.id,
      mayNameLeadingOption: true,
    });
    expect(a!.kind).toBe('already_leading');
    expect(textAssertsLeadingOption(a!.text)).toBe(true);
  });

  it('POSITIVE CONTROL — the vocabulary CAN see a leader claim about this target', () => {
    // Without this, the assertion above could pass because the scanner is
    // broken rather than because the copy is clean.
    expect(
      textAssertsLeadingOption(
        `${HIRE.label} currently leads, so it beats Maintain Current Team (Status Quo).`,
      ),
    ).toBe(true);
  });
});
