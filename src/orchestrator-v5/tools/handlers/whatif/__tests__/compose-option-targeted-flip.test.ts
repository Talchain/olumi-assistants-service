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
  composeOptionTargetedFlipAnswer,
  type OptionTargetedFlipAnswer,
} from '../compose-option-targeted-flip.js';
import type { TargetOption } from '../resolve-target-option.js';
import type { FlipEntry, FlipSummary } from '../../../../compose/flip-proposal.js';
import { textAssertsLeadingOption } from '../../../../compose/leading-option-egress-guard.js';

const OFFSHORE: TargetOption = { id: 'opt_offshore', label: 'Engage Offshore Partner' };
const HIRE: TargetOption = { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' };

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
    expect(a!.text).toContain('Those are the single-factor changes');
    // Capped at two named levers, like the generic composer.
    expect(a!.text).not.toContain('Offshore Engagement');
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
  const ALL_BRANCHES: OptionTargetedFlipAnswer[] = [
    composeOptionTargetedFlipAnswer(HIRE, FLIPS_TO_HIRE)!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry()], 'concrete'))!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry({ direction: 'decrease' })], 'concrete'))!,
    composeOptionTargetedFlipAnswer(HIRE, summary([entry({ direction: null })], 'concrete'))!,
    composeOptionTargetedFlipAnswer(OFFSHORE, FLIPS_TO_HIRE)!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'no_practical_flip'))!,
    composeOptionTargetedFlipAnswer(OFFSHORE, summary([entry()], 'insufficient_data'))!,
  ];

  it('non-vacuity: every branch produced real prose', () => {
    expect(ALL_BRANCHES).toHaveLength(7);
    for (const a of ALL_BRANCHES) expect(a.text.length).toBeGreaterThan(60);
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
    // The current leader on the pinned scenario is 'Maintain Current Team
    // (Status Quo)'. The composers never receive it and never read it — they
    // take no projection at all — so this is structural, not incidental.
    for (const a of ALL_BRANCHES) {
      expect(a.text).not.toContain('Maintain Current Team');
      expect(a.text).not.toMatch(/currently leads|beats|ahead of/i);
    }
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
