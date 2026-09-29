/**
 * RACE FRAMING — the decision_review prompts must not ASK for a contest.
 *
 * ## The defect this pins
 *
 * PLoT #357 repaired race framing in PLoT's own copy and derived, with a
 * contrast control, that one class of it is produced UPSTREAM and merely passed
 * through: `m1_review` narratives carrying "…becomes the leading option".
 * PLoT `run.ts` forwards `m1_review` untouched, so the PLoT fix cannot reach
 * it. `m1_review` is the wire carrier for the decision review's
 * `narrative_summary`, `key_assumptions` and `flip_thresholds[].narrative`
 * (see `routes/assist.v1.decision-review.ts`), and those strings are LLM output
 * shaped by the prompts asserted here.
 *
 * Paul's standing product ruling: never "winner", and no race framing at all.
 * Olumi is a strategic reasoning layer; the human is the author and the
 * decision-maker. The product must not stage a contest between the user's own
 * options and announce a victor.
 *
 * ## The corpus is HARVESTED, not invented
 *
 * Every MUST-NOT-CONTAIN phrase below is a string one of these two prompts
 * ACTUALLY CARRIED at `8449e54e` (measured, `rg -a`), so a revert of the fix
 * reinstates a member of this list. None came out of the author's head.
 *
 * ## It reads the REGISTERED DEFAULT, not a copy
 *
 * `getDefaultPrompts()` returns exactly what `registerAllDefaultPrompts()`
 * registered — the bytes served on a PMS miss. Asserting against a re-typed
 * excerpt would be the hand-maintained mirror this repo keeps paying for
 * (CLAUDE.md trap #12).
 *
 * ## ⚠ SCOPE, stated so it is not over-read
 *
 * These are the two prompt surfaces THIS REPO OWNS: the `defaults.ts` monolith
 * (the PMS-miss fallback) and the four code-defined decompose sub-prompts.
 *
 * The monolith actually SERVED on staging is the PMS row `decision_review_default`
 * (snapshot: `Prompts/canonical/decision_review.txt`, served version 15,
 * content hash `ba4879dd0a714b8f`). It is NOT covered here and NOT changed by
 * this PR: its bytes live in Supabase and a change must clear the eval-pass
 * promotion gate. That snapshot still carries the race-framing instructions
 * this file bans — including the literal producer of the reported defect,
 * "the leading option changes" in the flip-threshold narrative template. That
 * is a separate lane; see the PR body.
 */

import { describe, expect, it } from 'vitest';

import { getDefaultPrompts } from '../loader.js';
import { registerAllDefaultPrompts } from '../defaults.js';
import {
  DECOMPOSE_R1_HEADLINE_PROMPT,
  DECOMPOSE_R2_DRIVER_PROMPT,
  DECOMPOSE_R3_FRAGILITY_PROMPT,
  DECOMPOSE_R4_CALIBRATION_PROMPT,
} from '../../cee/decision-review/decompose-prompts.js';

/**
 * All four decomposed sub-prompts, because the ban lives in the SHARED voice
 * block injected into every one of them. Asserting only R1 would leave the
 * other three free to drift — trap 3b at the prompt grain.
 */
const DECOMPOSED_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['R1 headline', DECOMPOSE_R1_HEADLINE_PROMPT],
  ['R2 driver', DECOMPOSE_R2_DRIVER_PROMPT],
  ['R3 fragility', DECOMPOSE_R3_FRAGILITY_PROMPT],
  ['R4 calibration', DECOMPOSE_R4_CALIBRATION_PROMPT],
];

registerAllDefaultPrompts();

/**
 * Instruction phrases that ASK the model for race framing. Each was present in
 * the monolith, the decompose prompts, or both, at the pristine tip.
 *
 * ⚠ These bind by the EXACT instruction string, never by a bare word. A bare
 * `winner` / `runner_up` ban would be wrong: those are INPUT FIELD NAMES the
 * payload carries, and the prompts must keep naming them to read their inputs
 * (CLAUDE.md trap 19 — bind to the object, not to a predicate another object
 * satisfies).
 */
const RACE_INSTRUCTIONS: readonly string[] = [
  // Monolith + R1: the leader's own win probability, stated as a race idiom.
  'came out ahead in',
  // Monolith + R1: the close_call framing.
  'narrow lead in WORDS',
  // Monolith story_headlines.
  '"why it leads" framing',
  '"what would make it lead" framing',
  // R1 story_headlines (single-quoted in that prompt).
  "'why it leads'",
  "'what would make it lead'",
  // R1 sentence-1 fallback.
  "winner's leading position",
  // Monolith + R3 scenario_contexts consequence template.
  'overtakes [exact winner.label]',
  'overtakes [winner.label]',
];

/**
 * Race idioms that must not appear anywhere in an OWNED prompt as wording the
 * model is shown. Deliberately narrower than a vocabulary sweep of the whole
 * file: each is a phrase that can only be a contest frame.
 *
 * ⭐ This list exists because a word-list sweep is provably insufficient — in
 * PLoT the most user-visible string was "Runner-up with 41% win probability",
 * which contains no banned word and was found only by a surviving mutant.
 */
const RACE_IDIOMS: readonly string[] = [
  'becomes the leading option',
  'the leading option changes',
  'comes out ahead',
  'out in front',
  'runner-up with',
  'front-runner',
  'edges out',
  'pulls ahead',
  'leads the field',
  // ⭐ 2026-09-10, added by review. Everything above is a LEADER vocabulary, so
  // the corpus was blind to the same race stated from the BACK of the field.
  // "close behind" reached the rewritten close_call exemplar in the monolith
  // and not one member saw it. This is not a hypothetical family: the live-leak
  // corpus in `orchestrator-v5/context/withheld-history-redaction.ts` records
  // "…with Standardise on Dell XPS close behind at 34%" as a string that
  // actually reached a user, and that module already redacts the family
  // downstream. A prompt asking for it is asking for a string the wire strips.
  'close behind',
  'falls behind',
  'lags behind',
  'just behind',
  'not far behind',
  'trails',
  'the front',
  // ⭐ Pure ordinals. Both prompts state the ordinal ban in prose — "the ordinal
  // is the race frame without the vocabulary" — and no member enforced it, so
  // the ban was advice to the model and nothing to the repo. Bound to
  // rank-bearing phrases, never to the bare words "first"/"second"/"top", which
  // a prompt legitimately uses for sentence and list positions.
  'the top option',
  'the top-ranked option',
  'second-best option',
  'next best option',
  'ranks first',
  'ranks second',
  'in first place',
  'in second place',
];

/** The ratified-correct, non-race statement of an option's OWN standing. */
const OWN_STANDING_INSTRUCTION = 'produced the best outcome in';

/** The explicit ban, stated in prose so the model is told the rule, not only starved of examples. */
const RACE_BAN_SENTENCE = 'NEVER frame the options as a race';

function decisionReviewDefault(): string {
  const text = getDefaultPrompts().decision_review;
  // Trap 13: an absence assertion needs a positive control. If the registry
  // ever returned undefined, every `not.toContain` below would throw rather
  // than pass silently — but assert it anyway, by name.
  expect(typeof text, 'decision_review default must be registered').toBe('string');
  expect((text as string).length).toBeGreaterThan(5_000);
  return text as string;
}

describe('decision_review prompts do not ask for race framing', () => {
  it.each(RACE_INSTRUCTIONS)('monolith default does not carry: %s', (phrase) => {
    expect(decisionReviewDefault()).not.toContain(phrase);
  });

  it.each(DECOMPOSED_PROMPTS)('decomposed %s prompt carries no race instruction', (_name, text) => {
    for (const phrase of RACE_INSTRUCTIONS) expect(text).not.toContain(phrase);
  });

/**
 * A line that FORBIDS an idiom necessarily quotes it. So the idiom guard below
 * asks the discriminating question — *is this idiom being asked for, or banned?*
 * — rather than the blunt one, which no effective ban could ever pass.
 *
 * A BAN LINE is a line carrying an explicit prohibition marker. Every prompt
 * line that mentions a race idiom must be one; a race idiom appearing on an
 * ordinary instruction line is the defect.
 *
 * ⚠ This is why both prompts keep each quoted idiom on a single line with its
 * own NEVER: an idiom split across a line break would evade this reader, and a
 * guard that cannot see the string it names is worth nothing (trap 13).
 */
const BAN_MARKER = /\b(?:never|do not)\b/gi;

/**
 * ⭐ 2026-09-10, added by review: the marker must sit BEFORE the idiom.
 *
 * The predicate was looser than its name. `BAN_MARKER.test(line)` asks *does a
 * prohibition appear anywhere on this line?*, which is not the question. An
 * ordinary instruction line that ASKS for an idiom and then carries an
 * unrelated prohibition — a length cap, a formatting rule, "do not exceed 15
 * words" — was excused by its own trailing clause. Measured at the pristine
 * tip: the whole file passed, 27 of 27, with such a line planted in the
 * monolith. The reader reported an empty list about a prompt that was asking
 * for the contest.
 *
 * So a line is a BAN LINE *for a given occurrence of a given idiom* only when a
 * prohibition marker precedes that occurrence. An idiom quoted after its own
 * NEVER is a ban; an idiom asked for, with a "do not" arriving later on the
 * line, is the defect.
 *
 * This is why both prompts keep each quoted idiom on one line with its own
 * NEVER in front of it: an idiom split across a line break, or trailing its
 * prohibition, would evade this reader (trap 13).
 */
function occurrencesNotPrecededByABan(line: string): boolean {
  const lower = line.toLowerCase();
  const markerAt = [...line.matchAll(BAN_MARKER)].map((m) => m.index ?? 0);
  return RACE_IDIOMS.some((idiom) => {
    const needle = idiom.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (!markerAt.some((mi) => mi < at)) return true;
    }
    return false;
  });
}

/** Lines that mention a race idiom WITHOUT prohibiting it. Empty is the pass. */
function idiomLinesThatAreNotBans(text: string): string[] {
  return text.split('\n').filter(occurrencesNotPrecededByABan);
}

  it('the idiom reader is not blind — the monolith DOES quote idioms, all on ban lines', () => {
    // Trap 13's positive control, and trap 13e's magnitude check. An
    // absence result from a reader that matches nothing at all is worthless,
    // so assert the reader SEES the idioms before trusting that it found none
    // outside a ban.
    const text = decisionReviewDefault();
    const mentioning = text
      .split('\n')
      .filter((l) => RACE_IDIOMS.some((p) => l.toLowerCase().includes(p.toLowerCase())));
    expect(mentioning.length, 'monolith must quote the idioms it bans').toBeGreaterThanOrEqual(3);
    expect(idiomLinesThatAreNotBans(text)).toEqual([]);
  });

  it.each(DECOMPOSED_PROMPTS)('decomposed %s prompt uses race idioms only to ban them', (_name, text) => {
    expect(idiomLinesThatAreNotBans(text)).toEqual([]);
  });

  it('R1 and R3 DO quote the idioms they ban (the reader is not blind here either)', () => {
    for (const [name, text] of [
      ['R1 headline', DECOMPOSE_R1_HEADLINE_PROMPT],
      ['R3 fragility', DECOMPOSE_R3_FRAGILITY_PROMPT],
    ] as const) {
      const mentioning = text
        .split('\n')
        .filter((l) => RACE_IDIOMS.some((p) => l.toLowerCase().includes(p.toLowerCase())));
      expect(mentioning.length, `${name} must quote the idioms it bans`).toBeGreaterThanOrEqual(1);
    }
  });

  it('BOTH owned prompts require the option’s OWN standing instead', () => {
    // The positive half. An absence-only guard is satisfied by a prompt that
    // says nothing at all about the statistic — which hands the model a free
    // choice, and the model's default IS the race frame (that is how
    // "becomes the leading option" reached the wire with no prompt asking
    // for it).
    expect(decisionReviewDefault()).toContain(OWN_STANDING_INSTRUCTION);
    expect(DECOMPOSE_R1_HEADLINE_PROMPT).toContain(OWN_STANDING_INSTRUCTION);
  });

  it.each(DECOMPOSED_PROMPTS)('%s states the race ban explicitly, not only by omission', (_name, text) => {
    expect(text).toContain(RACE_BAN_SENTENCE);
  });

  it('the monolith default states the race ban explicitly too', () => {
    expect(decisionReviewDefault()).toContain(RACE_BAN_SENTENCE);
  });

  it('the flip-threshold narrative template names no contest in either owned prompt', () => {
    // The reported defect's own field. The template must give the model a
    // concrete non-race sentence, because leaving it abstract ("the result
    // changes") is what the model filled in with "becomes the leading option".
    const FLIP_TEMPLATE = 'the model points to a different option';
    expect(decisionReviewDefault()).toContain(FLIP_TEMPLATE);
    expect(DECOMPOSE_R3_FRAGILITY_PROMPT).toContain(FLIP_TEMPLATE);
  });

  it('the corpus is non-trivial', () => {
    expect(RACE_INSTRUCTIONS.length).toBeGreaterThanOrEqual(9);
    // Raised from 9 with the behind-family and ordinal members. A floor that
    // trails the list it guards permits a silent shrink back to the blind
    // corpus that let "close behind" through.
    expect(RACE_IDIOMS.length).toBeGreaterThanOrEqual(24);
    expect(DECOMPOSED_PROMPTS.length).toBe(4);
  });

  /**
   * The reader's own discrimination, pinned on synthetic lines.
   *
   * ⚠ These do NOT read a prompt. They read the predicate. A guard whose
   * discriminating power is only ever exercised by today's prompt bytes stops
   * discriminating the moment those bytes change, with no red anywhere
   * (CLAUDE.md trap 13b) — and this reader's whole job is to tell an ASK from a
   * BAN, so that distinction has to be asserted directly, in both directions.
   */
  describe('the ban reader tells an ASK from a BAN', () => {
    it('an ASK is not excused by a prohibition that arrives later on the line', () => {
      const asking =
        '  Sentence 1: say the option "comes out ahead" on the model\u2019s numbers. Do not exceed 15 words.';
      expect(idiomLinesThatAreNotBans(asking)).toEqual([asking]);
    });

    it('a real ban, marker before the idiom, still passes', () => {
      expect(idiomLinesThatAreNotBans('  NEVER write "comes out ahead" in any output string.')).toEqual(
        [],
      );
    });

    it('a second, unrelated prohibition earlier on the line does not excuse a later ASK', () => {
      // The nearest-marker case, kept honest: the guard admits a line whose
      // idiom follows ANY marker, which is what makes the R3 flip-threshold
      // line ("…never the raw input value. Use the label, never the id. ⚠ NEVER
      // write that an option 'becomes the leading option'…") legitimately pass.
      // Pinned so the admission is a recorded choice, not an accident.
      const admitted =
        "  Use the label, never the id. \u26a0 NEVER write that an option 'becomes the leading option'.";
      expect(idiomLinesThatAreNotBans(admitted)).toEqual([]);
    });

    it('the behind-family members bite', () => {
      const asking = '  e.g., "produced the best outcome in 38% of runs, the others close behind".';
      expect(idiomLinesThatAreNotBans(asking)).toEqual([asking]);
    });

    it('the ordinal members bite', () => {
      const asking = '  Name the top option and say what the next best option would need.';
      expect(idiomLinesThatAreNotBans(asking)).toEqual([asking]);
    });

    it('compliant wording is not flagged — the reader is not a vocabulary sweep', () => {
      // The discriminating half. A guard that REDs on the ratified-correct
      // sentence would be pressure to weaken it back.
      expect(
        idiomLinesThatAreNotBans(
          '  (e.g., "produced the best outcome in 38% of runs of this model, and the\n' +
            '  options were close on the data so far").',
        ),
      ).toEqual([]);
    });
  });
});
