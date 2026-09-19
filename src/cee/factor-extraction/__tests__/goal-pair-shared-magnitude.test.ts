/**
 * ⭐⭐ A GOAL'S TARGET AND ITS BASELINE MUST BE READ ON ONE SCALE, OR NO PAIR.
 *
 * ── THE DEFECT, MEASURED IN THE STAGING DATABASE (not inferred) ─────────────
 * A user wrote a goal of the shape *"grow ARR from 8 to 11 million within 12
 * months"*. The persisted goal node carried:
 *
 *     goal_threshold_raw   11,000,000     ← "11 million", correct
 *     goal_threshold_cap   13,750,000     ← raw × 1.25 (`target_derived_headroom`)
 *     observed_state.baseline  5.8181…e-7 ← 8 ÷ 13,750,000
 *
 * The magnitude word attached to the TARGET and not to the BASELINE, from the
 * same phrase, in the same sentence. ISL then computes
 * `level = B + (option_sample − status_quo_sample)` and `P(level ≥ T)`; with
 * `B = 5.8e-7` against `T = 0.8` the probability is a STRUCTURAL ZERO — not
 * "unlikely", arithmetically impossible — and it is rendered as a confident
 * number rather than as a refusal.
 *
 * ── WHERE THE TWO NUMBERS GOT THEIR SCALES ─────────────────────────────────
 * `resolveOneGoalMatch` resolved each side INDEPENDENTLY through
 * `resolveAmount`, which multiplies that side's own digits by that side's own
 * magnitude suffix. "from 8 to 11 million" captures `toMult: "million"` and no
 * `fromMult`, so the two amounts landed six orders of magnitude apart with
 * nothing looking. Everything downstream is CORRECT and unchanged: the
 * enricher already divides both by the SAME cap (`enricher.ts:1547,1554`), and
 * `transforms/schema-v3.ts:449` projects the pair into `observed_state`
 * faithfully. The divergence is created before any of that.
 *
 * ── THE RULE ALREADY EXISTED AND DID NOT REACH THIS PATH ───────────────────
 * `utils/amount-range.ts` owns the shared-trailing-suffix question for the two
 * bounds of ONE written quantity (`resolveAmountRange`, the elliptical branch
 * at `:661-711`), and its from-to sibling `resolveAmountPairBothOrNeither`
 * (`:924`) refuses a one-sided magnitude outright. The goal pair-former used
 * NEITHER. So this change makes the EXISTING rule reach the goal path rather
 * than minting a second predicate over natural language (CLAUDE.md trap 22:
 * a corpus drawn from the author's head cannot see the class the author did
 * not imagine — so the reading is delegated, not re-derived).
 *
 * ── WHAT IS NOT DONE, DELIBERATELY ─────────────────────────────────────────
 * Nothing is clamped, floored or rescaled to look plausible. Where the shared
 * suffix has a rival reading the pair is REFUSED BY NAME: no baseline is
 * minted, ISL refuses with `missing_goal_baseline`, and the user is asked.
 * That path is already the common one — 338 of the 409 persisted goals on the
 * headroom rule carry no `observed_state` at all and refuse honestly today.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The captured log stream. `importOriginal`-SPREAD, never a hand-listed mock
 * (CLAUDE.md trap 12) — a `vi.mock` factory REPLACES the module, so a
 * hand-written object silently drops every export the module later gains.
 */
const events: Array<Record<string, unknown>> = [];

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  const capture = (obj: unknown): void => {
    if (obj && typeof obj === 'object') events.push(obj as Record<string, unknown>);
  };
  return {
    ...actual,
    log: { ...actual.log, info: capture, debug: capture, warn: capture, error: capture },
  };
});

const { extractGoalTargetWithBaseline } = await import('../index.js');

/** Every `goal_pair_refused` event one brief emitted, newest last. */
function refusalsFor(brief: string): Array<Record<string, unknown>> {
  events.length = 0;
  extractGoalTargetWithBaseline(brief);
  return events.filter((e) => e.event === 'cee.factor_extraction.goal_pair_refused');
}

beforeEach(() => {
  events.length = 0;
});

/** The string measured in the staging database. */
const REAL_CORPUS_BRIEF = 'grow ARR from 8 to 11 million within 12 months';

describe('the real corpus string', () => {
  /**
   * ⭐ THE PRECONDITION IS PINNED IN-TEST (CLAUDE.md trap 13b). Asserting the
   * fixed pair alone would pass just as happily if this brief stopped matching
   * the goal grammar altogether — a green test about a construction the
   * extractor no longer reads. So the construction is proved live FIRST: the
   * target must still be the user's 11 million, and the matched text must be
   * the whole sentence.
   */
  it('still matches the goal grammar, and still reads the user\'s stated target', () => {
    const pair = extractGoalTargetWithBaseline(REAL_CORPUS_BRIEF);
    expect(pair, 'the goal grammar must still read this construction').not.toBeNull();
    expect(pair!.value).toBe(11_000_000);
    expect(pair!.matchedText).toContain('from 8 to 11 million');
  });

  it('reads the elided magnitude onto the baseline: 8 means 8 million, not 8', () => {
    const pair = extractGoalTargetWithBaseline(REAL_CORPUS_BRIEF);
    expect(pair!.baseline).toBe(8_000_000);
  });

  /**
   * The consequence, stated in the units the defect was measured in. With the
   * `target_derived_headroom` cap (raw × 1.25) the baseline normalises to
   * 8,000,000 ÷ 13,750,000 = 0.5818…, which sits below the 0.8 threshold and
   * above ISL's floor — a real probability instead of a structural zero.
   * Before this change it was 8 ÷ 13,750,000 = 5.8181…e-7.
   */
  it('normalises to a scorable baseline rather than a structural zero', () => {
    const pair = extractGoalTargetWithBaseline(REAL_CORPUS_BRIEF);
    const cap = pair!.value * 1.25;
    const normalisedBaseline = pair!.baseline / cap;
    expect(normalisedBaseline).toBeCloseTo(0.581818, 6);
    expect(normalisedBaseline).toBeGreaterThan(0.1);
  });
});

describe('the shared trailing magnitude distributes only where the digits ascend', () => {
  it.each([
    ['grow ARR from 8 to 11 million within 12 months', 8_000_000, 11_000_000],
    ['increase conversions from 2 to 5 thousand within 12 months', 2_000, 5_000],
    ['Raise the target from 100 to 250 thousand within 12 months', 100_000, 250_000],
  ])('%s → baseline %d, target %d', (brief, baseline, target) => {
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair, `expected a pair for: ${brief}`).not.toBeNull();
    expect(pair!.baseline).toBe(baseline);
    expect(pair!.value).toBe(target);
  });

  /**
   * ⚠ THE OPPOSITE HARM, AND IT IS THE ONE THAT MATTERS MORE. Distributing a
   * suffix onto a lower bound the writer stated AT FULL SCALE would fabricate a
   * magnitude — the over-read, which this estate names the worse direction.
   * `resolveAmountRange`'s ordering precondition forbids it by construction:
   * the bare digits 800,000 do not ascend to 1.1, so nothing is distributed and
   * the literal reading stands. Byte-identical to the behaviour before this
   * change, and pinned so a later "symmetry" tidy-up cannot land it quietly.
   */
  it('does NOT distribute onto a lower bound already written at full scale', () => {
    const pair = extractGoalTargetWithBaseline(
      'grow revenue from 800,000 to 1.1 million within 12 months',
    );
    expect(pair).not.toBeNull();
    expect(pair!.baseline).toBe(800_000);
    expect(pair!.value).toBe(1_100_000);
  });

  /**
   * The genuinely ambiguous shape: "500" could be the writer's literal £500 or
   * an elided £500k, and BOTH readings ascend to £2m. Guessing is the
   * 1,000×-wrong publication the shared-suffix module exists to stop, so the
   * pair is refused by name. Today this brief mints baseline 500 against a
   * 2,000,000 target — normalised 0.0002 against a 0.8 threshold, the same
   * structural zero in a smaller spelling.
   */
  it('refuses BY NAME when a rival reading of the dropped suffix also ascends', () => {
    const brief = 'grow revenue from 500 to 2 million within 12 months';
    expect(extractGoalTargetWithBaseline(brief)).toBeNull();
    // BY IDENTITY, not by "a refusal happened": the reason AND the side that
    // carried the magnitude, so a rule that refused for some other cause — or
    // named the wrong side — cannot satisfy this (CLAUDE.md trap 19).
    expect(refusalsFor(brief)).toContainEqual(
      expect.objectContaining({
        reason: 'scale_ellipsis_unreadable',
        magnitude_side: 'target',
      }),
    );
  });

  /**
   * Shared-suffix ellipsis reads BACKWARDS from the end of a coordinate
   * structure, never forwards, so a magnitude on the BASELINE alone has no
   * reading at all. It is refused by this rule rather than by the direction
   * check that happens to catch it downstream — comparability is a
   * PRECONDITION of comparison (the ordering argument ROADMAP 2.371(d) already
   * made for the mixed-percent refusal), and a reason that names the wrong rule
   * teaches the next reader the wrong thing.
   */
  it('refuses BY NAME when only the baseline carries a magnitude', () => {
    const brief = 'grow ARR from 8 million to 11 within 12 months';
    expect(extractGoalTargetWithBaseline(brief)).toBeNull();
    expect(refusalsFor(brief)).toContainEqual(
      expect.objectContaining({
        reason: 'scale_ellipsis_unreadable',
        magnitude_side: 'baseline',
      }),
    );
  });
});

describe('pairs that already agreed about scale are untouched', () => {
  it.each([
    ['Increase annual revenue from £4 million today to £6 million within 12 months', 4_000_000, 6_000_000],
    ['We will increase revenue from £4M to £6M within 12 months', 4_000_000, 6_000_000],
    ['Raise the price from £49 to £59 this year', 49, 59],
    ['Grow revenue from 4000000 to a target of 6000000', 4_000_000, 6_000_000],
    ['Our target is 800 customers, currently at 500.', 500, 800],
    ['grow the team from 8 to 11 within 12 months', 8, 11],
  ])('%s', (brief, baseline, target) => {
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair, `expected a pair for: ${brief}`).not.toBeNull();
    expect(pair!.baseline).toBe(baseline);
    expect(pair!.value).toBe(target);
  });

  it('leaves a percent pair on its own convention', () => {
    const pair = extractGoalTargetWithBaseline('Improve retention from 85% to a target of 95%.');
    expect(pair).toEqual(
      expect.objectContaining({ value: 0.95, baseline: 0.85, unit: '%' }),
    );
  });
});

/**
 * ⚠ AN HONEST RECORDED GAP, PINNED IN BOTH DIRECTIONS (CLAUDE.md trap 22f).
 *
 * The shared-suffix rule this change delegates to is defined over DIGITS plus a
 * magnitude SUFFIX. A cardinal-WORDS amount ("eight", "two hundred thousand")
 * is a different grammar: its scale is spelled inside the phrase, and reading
 * an ellipsis across the two would be a second natural-language predicate
 * written from this lane's own head, over a class it has no corpus for. So the
 * words branch is left EXACTLY as it was, and the residual is recorded here
 * rather than left invisible — the suite REDs if this set grows OR shrinks.
 */
describe('KNOWN GAP — a cardinal-words amount is outside the shared-suffix rule', () => {
  it('still reads "from eight to 11 million" on two scales', () => {
    const pair = extractGoalTargetWithBaseline('grow ARR from eight to 11 million within 12 months');
    expect(pair).not.toBeNull();
    // RECORDED, NOT ENDORSED: 8 against 11,000,000.
    expect(pair!.baseline).toBe(8);
    expect(pair!.value).toBe(11_000_000);
  });

  it('still reads a words baseline against a words target correctly', () => {
    const pair = extractGoalTargetWithBaseline(
      'grow MRR from one hundred and eighty thousand to two hundred and fifty thousand within 12 months',
    );
    expect(pair).not.toBeNull();
    expect(pair!.baseline).toBe(180_000);
    expect(pair!.value).toBe(250_000);
  });
});
