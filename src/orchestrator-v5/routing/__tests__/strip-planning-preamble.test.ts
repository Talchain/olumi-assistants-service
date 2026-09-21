/**
 * ⭐⭐ THE PLANNING MONOLOGUE STOPS BEING THE USER-FACING ANSWER — and a real
 * orientation sentence still ships.
 *
 * ── THE RED ────────────────────────────────────────────────────────────────
 * Both MONOLOGUE rows below are VERBATIM from a user's chat window, reported in
 * 5 of 7 evaluation briefs. At pristine `de254398` `stripPlanningPreamble` did
 * not exist and `turn-executor.ts:10622` passed
 * `routingResult.orientationText` straight into `sanitiseNarrateOutput`, which
 * strips tags and dashes and matches neither signature — so these strings were
 * the first paragraph the user read (`compose.ts:353-355`).
 *
 * ── THE OPPOSITE-DIRECTION TWIN ────────────────────────────────────────────
 * A stripper that empties everything passes every RED row. So every RED row has
 * a KEPT twin: an ordinary orientation sentence of the kind the prompt asks for
 * (`Prompts/canonical/routing.txt:97` — "you orient before the action"), which
 * must survive byte-identical. Without the KEPT block, `return ''` is a passing
 * implementation.
 */
import { describe, expect, it } from 'vitest';

import { isPlanningText, stripPlanningPreamble } from '../strip-planning-preamble.js';

/** Verbatim, from the evaluation's transcript. */
const MONOLOGUE_VALUE_CHANGE =
  'The user wants two things: change a factor value, and then see what it does ' +
  'to the comparison. Per rule 9 (one action per turn), I\'ll handle the value ' +
  'change first, then they can ask for the comparison.';

/** Verbatim, from the evaluation's transcript. */
const MONOLOGUE_ENCODING_ITEMS =
  'The user wants me to fill in the open encoding items myself. There are four ' +
  'of them, but rule 9 says one action per turn. I need to pick the single most ' +
  'useful one. Here\'s my reasoning for each:';

describe('RED — the witnessed monologues never reach the user', () => {
  it('the value-change monologue is removed in full', () => {
    expect(stripPlanningPreamble(MONOLOGUE_VALUE_CHANGE)).toBe('');
  });

  it('the encoding-items monologue is removed in full, including the dangling announcement', () => {
    const out = stripPlanningPreamble(MONOLOGUE_ENCODING_ITEMS);
    expect(out).toBe('');
    // The precise harms, named: third-person reference to the reader, an
    // internal rule cited by number, and a reply that stops dead on a colon.
    expect(out).not.toContain('The user wants');
    expect(out).not.toContain('rule 9');
    expect(out).not.toContain("Here's my reasoning for each:");
  });

  it('a reply that stops dead on a colon loses the dangling announcement, not the sentence before it', () => {
    // The list went into the tool call; the announcement can never be completed.
    expect(
      stripPlanningPreamble(
        "I'll set the Enterprise ACV target to £45,000. Here's my reasoning for each:",
      ),
    ).toBe("I'll set the Enterprise ACV target to £45,000.");
  });

  const EACH_MARKER: readonly (readonly [string, string])[] = [
    ['rule cited by number, "per" form', 'Per rule 9, I will do the value change first.'],
    ['rule cited by number, "says" form', 'Rule 9 says one action per turn.'],
    ['rule cited by number, parenthetical form', 'Rule 9 (one action per turn) applies here.'],
    ['third-person reference to the reader', 'The user wants me to fill in the open items.'],
    ['routing self-talk', 'I can only route one action this turn.'],
  ];

  for (const [label, text] of EACH_MARKER) {
    it(`${label} condemns the block`, () => {
      expect(isPlanningText(text)).toBe(true);
      expect(stripPlanningPreamble(text)).toBe('');
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// TWIN — ordinary orientation must survive byte-identical
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shape `Prompts/canonical/routing.txt:97-99` asks for on mutation and run
 * turns: pre-action orientation, no result preview. If any of these is emptied,
 * a user loses the sentence explaining what is about to happen.
 */
const GENUINE_ORIENTATION: readonly string[] = [
  "I'll set the Enterprise ACV target to £45,000 now.",
  "I'm updating the churn factor to 5% and leaving the rest as they are.",
  'This simulation will test how sensitive the comparison is to the enterprise ACV assumption.',
  "I'll add a factor for regulatory risk and link it to the compliance cost.",
  "Two things: I'll change the value, then you can ask for the comparison.",
  // "the user" WITHOUT a mental verb — a model can legitimately be about users.
  'The user adoption factor is doing most of the work in this comparison.',
  // A numbered rule of a real regulation, not one of ours.
  'Rule 9 of the framework you described is already encoded as a constraint.',
];

describe('TWIN — a genuine orientation sentence is untouched', () => {
  for (const text of GENUINE_ORIENTATION) {
    it(`kept byte-identical: ${JSON.stringify(text.slice(0, 46))}…`, () => {
      expect(isPlanningText(text)).toBe(false);
      expect(stripPlanningPreamble(text)).toBe(text);
    });
  }

  it('an ordinary mid-sentence colon is not treated as a dangling announcement', () => {
    const text = "Two things: I'll change the value, then re-run the analysis.";
    expect(stripPlanningPreamble(text)).toBe(text);
  });

  it('a decimal is never mistaken for a sentence boundary', () => {
    const text = "I'll set the budget to £1.5 million. Here's the breakdown for each:";
    // The dangling announcement goes; the £1.5m sentence survives whole.
    expect(stripPlanningPreamble(text)).toBe("I'll set the budget to £1.5 million.");
  });

  it('empty and whitespace inputs are stable', () => {
    expect(stripPlanningPreamble('')).toBe('');
    expect(stripPlanningPreamble('   \n ')).toBe('');
  });
});
