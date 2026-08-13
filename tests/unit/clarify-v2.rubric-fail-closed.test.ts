/**
 * Clarify v2 rubric — THE MODULE INVARIANT: every arm FAILS CLOSED
 * (ratified 2026-08-13 after the #928 adversarial review; REVIEW-928.md §1).
 *
 * **An unlisted, ambiguous or NEGATED input scores the dimension MISSING
 * (ask), never silently SATISFIED.**
 *
 * Why this file exists rather than another per-arm test: the defect it pins
 * was not a wrong regex, it was a wrong GUARD SHAPE — two arms enumerated
 * what they REJECTED (past-tense verbs) over an unbounded domain, so every
 * input nobody imagined scored SATISFIED. The author's own corpus could not
 * see it (every twin used a verb already on the author's guard list), a
 * 60/60 suite and a full mutant kit certified it, and an independent
 * corpus found 12 false-satisfied strings in ordinary business English.
 * So the property is asserted here for ALL FOUR dimensions, not for the
 * arms one lane happened to add.
 *
 * Two halves, and both must stay:
 *   1. THE PROPERTY — for every dimension, a denied statement of that
 *      dimension is not evidence for it. Generated from the dimension list,
 *      so a fifth dimension inherits the assertion automatically.
 *   2. THE KNOWN-BEHAVIOUR CORPUS — the reviewer's exact strings, pinned
 *      with their EXACT expected verdicts in BOTH directions (trap 22f's
 *      honest-gap discipline: the suite REDs if the set grows OR shrinks).
 *      This corpus came from OUTSIDE the author's head and is the
 *      load-bearing evidence for these arms (trap 22c) — it is not a
 *      fixture to keep current, and it may be appended to, never edited.
 */
import { describe, it, expect } from 'vitest';

import {
  assessBriefCompleteness,
  CLARIFY_V2_DIMENSIONS,
  CLARIFY_V2_DIMENSION_DETECTORS,
  type ClarifyDimension,
} from '../../src/orchestrator-v5/clarify-v2/rubric.js';

const satisfied = (brief: string, dimension: ClarifyDimension): boolean =>
  assessBriefCompleteness(brief).satisfied.includes(dimension);

// ── 1. THE PROPERTY, over every dimension ─────────────────────────────────
/**
 * A plain, UNDENIED statement of each dimension (the positive control: the
 * battery must actually see these, or the denial assertions below would pass
 * by testing nothing — trap 13) and its DENIED twin.
 */
const DIMENSION_STATEMENTS: Readonly<
  Record<ClarifyDimension, { readonly affirmed: string; readonly denied: readonly string[] }>
> = {
  goal: {
    affirmed: 'Faster delivery to northern customers is the main prize.',
    denied: [
      'I do not think raw speed is the main prize.',
      'Faster delivery is not the main prize.',
      "Speed isn't the main prize here.",
      'Raw speed was never the main prize.',
    ],
  },
  options: {
    affirmed: 'Should we switch the team from quarterly releases to continuous deployment?',
    denied: [
      'We are not weighing whether to switch the team from quarterly releases to continuous deployment.',
      "We can't move from per-seat licences to usage-based pricing.",
    ],
  },
  timeframe: {
    affirmed: 'We must decide by the end of this quarter.',
    denied: [
      'This does not need to land by the end of this quarter.',
      "It isn't due by the end of this quarter.",
    ],
  },
  quantities: {
    affirmed: 'The switch would cost about £20,000.',
    denied: ['The switch would not cost £20,000.', "It won't cost £20,000."],
  },
};

describe('INVARIANT — every dimension fails closed on a DENIED statement', () => {
  it('the alphabet is complete: every declared dimension has a statement pair', () => {
    // Derived, never hand-listed (trap 12): a fifth dimension added to the
    // rubric with no pair here REDs immediately instead of going untested.
    expect(Object.keys(DIMENSION_STATEMENTS).sort()).toEqual([...CLARIFY_V2_DIMENSIONS].sort());
    // And every dimension must actually own detectors — a dimension with an
    // empty battery would satisfy every assertion below vacuously.
    for (const dimension of CLARIFY_V2_DIMENSIONS) {
      expect(CLARIFY_V2_DIMENSION_DETECTORS[dimension].length).toBeGreaterThan(0);
    }
  });

  it.each(CLARIFY_V2_DIMENSIONS.map((d) => [d] as const))(
    '%s: the AFFIRMED statement is satisfied (positive control — the denial assertions are not vacuous)',
    (dimension) => {
      expect(satisfied(DIMENSION_STATEMENTS[dimension].affirmed, dimension)).toBe(true);
    },
  );

  it.each(
    CLARIFY_V2_DIMENSIONS.flatMap((d) =>
      DIMENSION_STATEMENTS[d].denied.map((s) => [d, s] as const),
    ),
  )('%s: DENIED — "%s" scores MISSING, never satisfied', (dimension, brief) => {
    expect(satisfied(brief, dimension)).toBe(false);
  });

  it('a denial is scoped to its own sentence — it cannot silence a statement that stands', () => {
    // The fail-closed rule must not become a whole-brief mute button: a brief
    // that denies one thing and affirms another keeps the affirmation. This is
    // the assertion that stops the remedy over-correcting into the never-drafts
    // direction (the opposite harm — trap 22b).
    const brief =
      'Cost is not the main prize. Faster delivery to northern customers is the main prize.';
    expect(satisfied(brief, 'goal')).toBe(true);
  });

  it('a denial in a DIFFERENT sentence leaves other dimensions untouched', () => {
    const brief = 'We are not sure yet. We must decide by the end of this quarter.';
    expect(satisfied(brief, 'timeframe')).toBe(true);
  });

  // ── The OVER-CORRECTION direction, measured (trap 22b) ───────────────────
  // These three cases are not the reviewer's — they are defects the REMEDY
  // itself created and had to fix, and they are pinned because a future
  // widening of the denial window silently re-opens them. A fail-closed rule
  // that fails closed on everything is the never-drafts baseline by another
  // route: the harm has two directions and they need separate cases.
  it('OVER-CORRECTION: a stated goal followed by a constraint clause still satisfies goal (ROADMAP 2.103 journey brief)', () => {
    // A sentence-scoped denial window scored this MISSING and would have
    // re-opened the exact defect the 2.103 journey fix closed — 5 of 5 fresh
    // users asked for the goal they had just given. The `don't` governs the
    // constraint clause after `but`, not the objective before it.
    const brief =
      "I'm trying to decide between opening our own retail shop, pushing a direct-to-consumer subscription, or just doubling down on wholesale. I care most about profit in 2 years but I don't want to bet the company.";
    expect(satisfied(brief, 'goal')).toBe(true);
  });

  it('OVER-CORRECTION: "or not" is the yes/no restatement, not a denial of the horizon beside it', () => {
    // Pre-existing calibration pin (clarify-v2.rubric.test.ts): this brief's
    // timeframe is genuinely stated. The options battery already models `or
    // not` as a yes/no restatement; the denial check must use that same
    // meaning rather than inventing a second one (trap 21).
    const brief = 'Should we renew the vendor contract or not this quarter?';
    expect(satisfied(brief, 'timeframe')).toBe(true);
    // …and the construction still names no second alternative:
    expect(satisfied(brief, 'options')).toBe(false);
  });

  it('OVER-CORRECTION: the denial window never spans a clause boundary', () => {
    const brief = 'We will not cut headcount, and the goal is to increase revenue.';
    expect(satisfied(brief, 'goal')).toBe(true);
  });
});

// ── 2. THE REVIEWER'S KNOWN-BEHAVIOUR CORPUS (outside-authored) ───────────
/**
 * Every string the #928 reviewer measured as a NEW false-satisfied caused by
 * the two ablated timeframe arms, plus the goal negation case. Each is
 * ordinary business English carrying COMPANY HISTORY — the class the
 * probe-authored 15-brief wire corpus structurally cannot contain, which is
 * why the wire baseline could not detect the defect and must never be read
 * as evidence about it.
 *
 * EXACT SET, BOTH DIRECTIONS. `expected: false` cases RED if an arm is
 * re-introduced in its old shape; `expected: true` cases RED if a future
 * fix over-corrects and silences genuine forward-looking horizons.
 */
const REVIEWER_CORPUS: ReadonlyArray<{
  readonly brief: string;
  readonly dimension: ClarifyDimension;
  readonly expected: boolean;
  readonly note: string;
}> = [
  // — elapsed duration is not a horizon (the ablated `for + duration` arm) —
  { brief: 'We trialled it for six months and adoption stalled.', dimension: 'timeframe', expected: false, note: 'trialled — unlisted past verb' },
  { brief: 'Sales declined for six quarters.', dimension: 'timeframe', expected: false, note: 'declined — unlisted' },
  { brief: 'We leased this building for ten years.', dimension: 'timeframe', expected: false, note: 'leased — unlisted' },
  { brief: 'The outage continued for two weeks.', dimension: 'timeframe', expected: false, note: 'continued — unlisted' },
  { brief: 'Churn stayed above 5% for four quarters.', dimension: 'timeframe', expected: false, note: 'stayed — unlisted' },
  {
    brief:
      'We have been running this particular pilot programme across three separate regions for six months.',
    dimension: 'timeframe',
    expected: false,
    note: 'guard verb WAS listed and fired anyway — the 50-char lookbehind window was itself a leak',
  },
  // — a past date reference is not a horizon (the ablated bare-month arm) —
  { brief: 'We signed the lease in April.', dimension: 'timeframe', expected: false, note: 'signed — unlisted' },
  { brief: 'Costs fell in June.', dimension: 'timeframe', expected: false, note: 'fell — unlisted' },
  { brief: 'We lost two customers in February.', dimension: 'timeframe', expected: false, note: 'lost — unlisted' },
  { brief: 'We hired the last 4 engineers in November.', dimension: 'timeframe', expected: false, note: 'hired — unlisted' },
  { brief: 'The board met in October.', dimension: 'timeframe', expected: false, note: 'met — unlisted' },
  { brief: 'Revenue in March was £2m.', dimension: 'timeframe', expected: false, note: 'no verb before the month at all' },
  // — the goal denial (the severe case: reached `complete`, zero disclosure) —
  {
    brief: 'I do not think raw speed is the main prize.',
    dimension: 'goal',
    expected: false,
    note: 'the prize arm fired on a sentence DENYING that goal',
  },
  // — the OPPOSITE direction: genuine forward-looking horizons still count —
  { brief: 'We must decide by the end of this quarter.', dimension: 'timeframe', expected: true, note: 'pre-existing arm, must survive' },
  { brief: 'It must be live in six months.', dimension: 'timeframe', expected: true, note: 'ROADMAP 2.103 arm, must survive' },
  { brief: 'We have a six month window to decide.', dimension: 'timeframe', expected: true, note: 'horizon noun, must survive' },
  { brief: 'A decision is needed by March.', dimension: 'timeframe', expected: true, note: 'by + month, must survive' },
  { brief: 'Faster delivery to northern customers is the main prize.', dimension: 'goal', expected: true, note: 'the widened goal arm, kept' },
];

describe('REVIEWER CORPUS (#928) — the exact known-behaviour set, both directions', () => {
  it('the corpus is intact and carries both directions (a gutted corpus reports green by testing nothing)', () => {
    expect(REVIEWER_CORPUS.length).toBe(18);
    expect(REVIEWER_CORPUS.filter((c) => c.expected === false).length).toBe(13);
    expect(REVIEWER_CORPUS.filter((c) => c.expected === true).length).toBe(5);
  });

  it.each(REVIEWER_CORPUS.map((c) => [c.brief, c] as const))('%s', (_brief, c) => {
    expect(satisfied(c.brief, c.dimension), `${c.dimension}: ${c.note}`).toBe(c.expected);
  });

  it('R4 — the severe routing case never reaches `complete` (invented goal + invented horizon, zero disclosure)', () => {
    const R4 =
      'Should we rebuild the billing service or patch it? I do not think raw speed is the main prize. The board met in October and 3 customers have complained.';
    const assessment = assessBriefCompleteness(R4);
    expect(assessment.complete).toBe(false);
    // Both denied/elapsed dimensions must be MISSING, so this brief takes the
    // ordinary blocking ask rather than drafting a model whose goal the user
    // explicitly disowned.
    expect([...assessment.missing].sort()).toEqual(['goal', 'timeframe']);
  });
});
