/**
 * THE SCALE ASK — Paul's ruling of 2026-09-07, at the unit.
 *
 * These are pure-function assertions about the readings offered and the copy
 * that carries them. The route-level counterpart (no canonical mutation, chips
 * on the wire, guard ORDER) lives in
 * `tests/integration/orchestrator/route-v2-factor-value-edit-scale-guard.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { MAGNITUDE_MULTIPLIERS, MAGNITUDE_WORD_LADDER } from '../../../utils/magnitude-alphabet.js';
import { isClaimableByClarificationResume } from '../../routing/clarification-resume.js';
import {
  buildScaleAskChips,
  buildScaleAskOptions,
  composeScaleAskQuestion,
  SCALE_ASK_MAX_OPTIONS,
  scaleAskChipId,
} from '../scale-ask.js';

describe('MAGNITUDE_WORD_LADDER — the spoken projection of the one alphabet', () => {
  // DERIVED: proves the ladder AGREES with the map. It can never prove the map
  // is complete (CLAUDE.md trap 12d), which is what the corpus below is for.
  it('carries a rung for every multiplier >= 1000 the alphabet knows', () => {
    const expected = new Set(
      Object.values(MAGNITUDE_MULTIPLIERS).filter((m) => m >= 1e3),
    );
    const actual = new Set(MAGNITUDE_WORD_LADDER.map(([multiplier]) => multiplier));
    expect(actual).toEqual(expected);
  });

  it('picks the LONGEST key for each multiplier, so the rung reads as a word', () => {
    for (const [multiplier, word] of MAGNITUDE_WORD_LADDER) {
      const keys = Object.entries(MAGNITUDE_MULTIPLIERS)
        .filter(([, m]) => m === multiplier)
        .map(([k]) => k);
      const longest = [...keys].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
      expect(word, `multiplier ${multiplier} must spell out`).toBe(longest);
    }
  });

  it('is sorted descending by multiplier', () => {
    const multipliers = MAGNITUDE_WORD_LADDER.map(([m]) => m);
    expect(multipliers).toEqual([...multipliers].sort((a, b) => b - a));
  });

  // HAND-WRITTEN CORPUS — the only thing with any power to notice a SHORT map
  // (trap 12d: `thousand` was missing from the canonical alphabet for weeks and
  // every derived guard stayed green, because no corpus happened to spell it).
  it.each([
    [1e3, 'thousand'],
    [1e6, 'million'],
    [1e9, 'billion'],
    [1e12, 'trillion'],
  ])('spells %s as "%s"', (multiplier, word) => {
    expect(MAGNITUDE_WORD_LADDER).toContainEqual([multiplier, word]);
  });
});

describe('buildScaleAskOptions — the candidate readings', () => {
  it("offers the literal reading and the thousand rung for Paul's 8-on-a-100000-frame case", () => {
    const options = buildScaleAskOptions({ value: 8, frame: 100_000 });
    expect(options.map((o) => o.optionText)).toEqual(['8', '8 thousand']);
    expect(options.map((o) => o.amount)).toEqual([8, 8000]);
  });

  it('always leads with the literal reading — the behaviour #1280 ships today', () => {
    for (const value of [1, 2, 8, 12345]) {
      const [first] = buildScaleAskOptions({ value, frame: 1e9 });
      expect(first, `value ${value}`).toMatchObject({ multiplier: 1, word: null, amount: value });
    }
  });

  // THE FILTER IS THE FACTOR'S FRAME, and this is the case that proves it bites:
  // 8 million does not fit a 100,000 frame, so offering it would be a chip whose
  // write the downstream would refuse.
  it('omits a rung whose amount the frame cannot hold', () => {
    const words = buildScaleAskOptions({ value: 8, frame: 100_000 }).map((o) => o.word);
    expect(words).not.toContain('million');
    expect(words).toContain('thousand');
  });

  it('offers a larger frame more rungs, capped at SCALE_ASK_MAX_OPTIONS', () => {
    const options = buildScaleAskOptions({ value: 2, frame: 1e12 });
    expect(options.length).toBeLessThanOrEqual(SCALE_ASK_MAX_OPTIONS);
    expect(options.map((o) => o.word)).toEqual([null, 'thousand', 'million']);
  });

  // Sign-symmetry: the neighbouring guards use Math.abs, and a predicate written
  // with a different symmetry from its neighbour is CLAUDE.md trap 13d.
  it('treats a negative magnitude the same way as its positive twin', () => {
    const negative = buildScaleAskOptions({ value: -8, frame: 100_000 });
    expect(negative.map((o) => o.amount)).toEqual([-8, -8000]);
  });

  it('returns nothing for a sub-1 magnitude — that class belongs to the basis guard', () => {
    expect(buildScaleAskOptions({ value: 0.85, frame: 100_000 })).toEqual([]);
    expect(buildScaleAskOptions({ value: 0, frame: 100_000 })).toEqual([]);
  });

  it('returns nothing for a non-finite value or frame', () => {
    expect(buildScaleAskOptions({ value: Number.NaN, frame: 100_000 })).toEqual([]);
    expect(buildScaleAskOptions({ value: 8, frame: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  // `thousands` groups the WHOLE string it is given, so without the integer
  // precondition a fraction comes back with a comma INSIDE it — a corrupted
  // number printed inside a question about a number being corrupted.
  //
  // ⚠ THE FIXTURE HAS TO BE ABLE TO SHOW THE DEFECT. A first version of this
  // test used 8.5 and a mutant that deleted the precondition SURVIVED it:
  // `thousands(8.5)` is `8.5`, because the grouping regex needs a run of three
  // digits to bite. The corruption only appears from four fractional digits on
  // (`thousands(1234.5678)` === '1,234.5,678'), so that is the value pinned
  // here. A corpus that omits the class the contract admits cannot certify the
  // code over that class.
  it('never puts a comma inside a fraction', () => {
    const options = buildScaleAskOptions({ value: 1234.5678, frame: 1e9 });
    expect(options[0]?.amountText).toBe('1234.5678');
    for (const option of options) {
      expect(option.amountText, option.amountText).not.toMatch(/\.\d*,/);
    }
  });
});

describe('composeScaleAskQuestion — the question, phrased once', () => {
  it("asks Paul's question in his own shape", () => {
    const options = buildScaleAskOptions({ value: 8, frame: 100_000 });
    expect(composeScaleAskQuestion(options)).toBe('Did you mean 8 or 8 thousand?');
  });

  it('lists three readings with a comma before the final choice', () => {
    const options = buildScaleAskOptions({ value: 2, frame: 1e12 });
    expect(composeScaleAskQuestion(options)).toBe('Did you mean 2, 2 thousand or 2 million?');
  });

  // A question with one answer is theatre — the caller falls back to honest
  // refusal copy rather than shipping a dead control.
  it('is empty when there is nothing to choose between', () => {
    expect(composeScaleAskQuestion([])).toBe('');
    expect(composeScaleAskQuestion(buildScaleAskOptions({ value: 8, frame: 8 }))).toBe('');
  });
});

describe('buildScaleAskChips — the channel the answer rides back on', () => {
  const options = buildScaleAskOptions({ value: 8, frame: 100_000 });

  it('labels the spoken form and messages the full digits', () => {
    const chips = buildScaleAskChips({ options, factorLabel: 'Marketing budget' });
    expect(chips.map((c) => c.label)).toEqual(['8', '8 thousand']);
    expect(chips.map((c) => c.message)).toEqual([
      'Set Marketing budget to 8.',
      'Set Marketing budget to 8,000.',
    ]);
  });

  it("carries the factor's unit into both label and message when it has one", () => {
    const chips = buildScaleAskChips({ options, factorLabel: 'Marketing budget', unit: '£' });
    expect(chips[1]?.label).toBe('8 thousand £');
    expect(chips[1]?.message).toBe('Set Marketing budget to 8,000 £.');
  });

  it('gives every reading a distinct, stable id derived from the magnitude word', () => {
    const chips = buildScaleAskChips({ options, factorLabel: 'Marketing budget' });
    expect(chips.map((c) => c.id)).toEqual([
      'chip_prompt_scale_ask_as_typed',
      'chip_prompt_scale_ask_thousand',
    ]);
    expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length);
    expect(scaleAskChipId(options[0]!)).toBe('chip_prompt_scale_ask_as_typed');
  });

  // ⭐⭐ THE SAFETY PIN, AND THE REASON THIS ASK NEEDS NO PENDING ACTION.
  // `tryClarificationResume` picks among live `set_factor_value` pendings BY
  // FACTOR LABEL. If one of these messages were claimable, a STALE pending on
  // the same factor (an "extend the scale" chip from an earlier turn) would
  // claim the click and write ITS value instead of the reading the user chose —
  // precisely the harm Paul's ruling exists to remove. Every message carries a
  // digit, so `EDIT_VERB_OR_QUANTITY_PATTERN` rejects it. Pinned, not assumed.
  it('emits no message the deterministic resumer could hijack', () => {
    const labels = ['Marketing budget', 'Recurring platform licence cost', 'Headcount'];
    for (const factorLabel of labels) {
      for (const chip of buildScaleAskChips({ options, factorLabel })) {
        expect(
          isClaimableByClarificationResume(chip.message),
          `"${chip.message}" must not be claimable by tryClarificationResume`,
        ).toBe(false);
      }
    }
  });
});
