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

/**
 * Defensive lookup so a dimension with no statement pair fails on the NAMED
 * alphabet assertion below instead of crashing COLLECTION with "Cannot read
 * properties of undefined" (#928 round 2, item 4: the planted fifth dimension
 * failed loudly but unhelpfully, because `it.each` evaluates before any test
 * body runs). Loud AND legible beats loud alone.
 */
const statementsFor = (d: ClarifyDimension): { affirmed: string; denied: readonly string[] } =>
  DIMENSION_STATEMENTS[d] ?? { affirmed: '', denied: [] };

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
    // ⚠ SWAPPED at #928 round 2: this control used to be the PRIZE sentence,
    // whose arm is now DROPPED — leaving it here would have made every goal
    // denial below pass vacuously (nothing fires, so nothing can fail open).
    // A property test whose positive control is a deleted arm tests nothing.
    affirmed: 'The goal is to increase revenue.',
    denied: [
      'I do not think the goal is to increase revenue.',
      'The goal is not to increase revenue.',
      "We aren't trying to increase revenue.",
      'We never wanted to increase revenue.',
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
      const affirmed = statementsFor(dimension).affirmed;
      expect(affirmed, `${dimension}: no affirmed statement — see the alphabet assertion`).not.toBe('');
      expect(satisfied(affirmed, dimension)).toBe(true);
    },
  );

  it.each(
    CLARIFY_V2_DIMENSIONS.flatMap((d) =>
      statementsFor(d).denied.map((s) => [d, s] as const),
    ),
  )('%s: DENIED — "%s" scores MISSING, never satisfied', (dimension, brief) => {
    expect(satisfied(brief, dimension)).toBe(false);
  });

  it('a denial is scoped to its own sentence — it cannot silence a statement that stands', () => {
    // The fail-closed rule must not become a whole-brief mute button: a brief
    // that denies one thing and affirms another keeps the affirmation. This is
    // the assertion that stops the remedy over-correcting into the never-drafts
    // direction (the opposite harm — trap 22b).
    // ⚠ FIXTURE UPDATED at round 2: the second sentence used to be the PRIZE
    // construction, whose arm is dropped — the pin would have asserted a
    // property of a deleted arm and failed for the wrong reason.
    const brief = 'Cost is not the main prize. The goal is to increase revenue.';
    expect(satisfied(brief, 'goal')).toBe(true);
  });

  it('a thousands separator is not a clause boundary (a denied magnitude stays MISSING)', () => {
    // REGRESSION PIN, from a defect this lane introduced and its own property
    // test caught: adding `,` to the boundary class split "£20,000" and the
    // orphaned "000" satisfied quantities on a sentence that denied it.
    expect(satisfied('The switch would not cost £20,000.', 'quantities')).toBe(false);
    expect(satisfied("It won't cost £20,000.", 'quantities')).toBe(false);
    // …while a stated magnitude beside a contrastive comma still counts.
    expect(satisfied('The budget is £20,000, not £50,000.', 'quantities')).toBe(true);
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
  // ⚠ RE-ADJUDICATED at #928 round 2. This was `expected: true` — the widened
  // goal-prize arm. That arm is DROPPED (it was the only arm on which the
  // fail-closed check could be defeated), so the sentence now correctly scores
  // MISSING and M3 drafts first-turn WITH a disclosure instead of silently.
  { brief: 'Faster delivery to northern customers is the main prize.', dimension: 'goal', expected: false, note: 'goal-prize arm DROPPED at round 2 — no longer credited' },
  // ── ROUND-2 corpus: the 8 phrasings that defeated the fail-closed check ──
  // All are the round-1 blocker surviving under different wording ("swap 'I do
  // not think' for 'Nobody thinks'"). Dropping the arm closes all 8 at once —
  // which is why the remedy was a deletion, not a longer token list.
  { brief: 'Nobody here believes headcount is the key prize.', dimension: 'goal', expected: false, note: 'token gap: nobody' },
  { brief: 'I doubt raw speed is the main prize.', dimension: 'goal', expected: false, note: 'token gap: doubt' },
  { brief: 'No one thinks cost is the real prize.', dimension: 'goal', expected: false, note: 'token gap: no one' },
  { brief: 'We disagree that margin is the main prize.', dimension: 'goal', expected: false, note: 'token gap: disagree that' },
  { brief: 'It is unclear that growth is the biggest prize.', dimension: 'goal', expected: false, note: 'token gap: unclear that' },
  { brief: 'We are not sure whether speed or reliability is the main prize.', dimension: 'goal', expected: false, note: 'clause-orphaning: listed token thrown away by the or-boundary' },
  { brief: "I can't tell if cost or speed is the main prize.", dimension: 'goal', expected: false, note: 'clause-orphaning: listed token thrown away by the or-boundary' },
  { brief: 'I do not think raw speed is the main prize.', dimension: 'goal', expected: false, note: 'the original round-1 severe case' },
  // ── the contrastive "X, not Y" regressions the comma boundary closes ──
  { brief: 'The objective is to grow revenue, not to cut costs.', dimension: 'goal', expected: true, note: 'comma boundary: contrastive statement of an objective' },
  { brief: 'We are optimising for margin, not volume.', dimension: 'goal', expected: true, note: 'comma boundary' },
  { brief: 'We must decide by March, not later.', dimension: 'timeframe', expected: true, note: 'comma boundary' },
  { brief: 'We want to increase retention, not vanity signups.', dimension: 'goal', expected: true, note: 'comma boundary' },
];

/**
 * ⭐ THE HONEST GAP (trap 22f). These are inputs on which the denial check
 * still FAILS OPEN, pinned as an EXACT set rather than left invisible.
 *
 * Two mechanisms, both measured, and both **PRE-EXISTING — identical on the
 * `origin/staging` build**, so this PR neither introduces nor widens them
 * (measured three-way: pristine SAT, PR SAT). They are recorded because the
 * module now RATIFIES a fail-closed invariant, and an invariant with an
 * unrecorded exception set is the kind of claim this estate keeps paying for:
 *   1. DENIAL-TOKEN GAPS — "Nobody thinks…", "I doubt…", "We disagree that…"
 *      are denials the closed token alphabet does not contain.
 *   2. CLAUSE-ORPHANING — a LISTED token separated from the match by an
 *      `or`/`and` boundary falls outside the window.
 *
 * NOT fixed by adding tokens: the reviewer ran that variant in advance and
 * measured it halving mechanism 1 while leaving mechanism 2 untouched — CEE
 * #888 round 2, the sunk-cost round. The blocker was closed by removing the
 * arm where these mattered (a GOAL arm, where a defeated denial invents an
 * objective silently). On the arms that remain, the residual cost is the
 * PRE-EXISTING behaviour of the shipped battery.
 *
 * The set is asserted EXACTLY: it REDs if it grows (a new fail-open class) or
 * shrinks (someone fixed one — then move the case and say so).
 */
const KNOWN_FAIL_OPEN: ReadonlyArray<{ readonly brief: string; readonly dimension: ClarifyDimension; readonly mechanism: 'token_gap' | 'clause_orphan' }> = [
  { brief: 'Nobody thinks the goal is to increase revenue.', dimension: 'goal', mechanism: 'token_gap' },
  { brief: 'I doubt the goal is to increase revenue.', dimension: 'goal', mechanism: 'token_gap' },
  { brief: 'We disagree that the goal is to increase revenue.', dimension: 'goal', mechanism: 'token_gap' },
  { brief: 'We are not sure whether speed or reliability is the goal.', dimension: 'goal', mechanism: 'clause_orphan' },
  { brief: "I can't tell whether cost or speed is the objective.", dimension: 'goal', mechanism: 'clause_orphan' },
];

/**
 * The one contrastive construction the comma boundary does NOT recover
 * ("not just X but Y" — the denial and the objective share a clause). A
 * recall loss in the SAFE direction: one extra question. Pinned exactly so it
 * cannot quietly grow into the 2.103 class again.
 */
const KNOWN_OVER_DETECTION: ReadonlyArray<{ readonly brief: string; readonly dimension: ClarifyDimension }> = [
  { brief: 'Our goal is not just cost but speed.', dimension: 'goal' },
];

describe('REVIEWER CORPUS (#928) — the exact known-behaviour set, both directions', () => {
  it('the corpus is intact and carries both directions (a gutted corpus reports green by testing nothing)', () => {
    // Counts re-adjudicated at #928 round 2 (arm dropped + round-2 corpus and
    // the comma-boundary cases adopted). Exact, both directions.
    expect(REVIEWER_CORPUS.length).toBe(30);
    expect(REVIEWER_CORPUS.filter((c) => c.expected === false).length).toBe(22);
    expect(REVIEWER_CORPUS.filter((c) => c.expected === true).length).toBe(8);
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

describe('THE HONEST GAP — fail-open and over-detection, pinned as EXACT sets', () => {
  it('the known fail-open set is exactly what is recorded (REDs if it grows OR shrinks)', () => {
    expect(KNOWN_FAIL_OPEN.length).toBe(5);
    expect(KNOWN_FAIL_OPEN.filter((c) => c.mechanism === 'token_gap').length).toBe(3);
    expect(KNOWN_FAIL_OPEN.filter((c) => c.mechanism === 'clause_orphan').length).toBe(2);
  });

  it.each(KNOWN_FAIL_OPEN.map((c) => [c.brief, c] as const))(
    'KNOWN FAIL-OPEN (%s)',
    (_brief, c) => {
      // Asserting the GAP, not the behaviour we want: if someone closes it,
      // this REDs and the set must be moved deliberately, with a measurement.
      expect(
        satisfied(c.brief, c.dimension),
        `${c.mechanism}: this input no longer fails open — good; move it out of KNOWN_FAIL_OPEN and record the measurement`,
      ).toBe(true);
    },
  );

  it.each(KNOWN_OVER_DETECTION.map((c) => [c.brief, c] as const))(
    'KNOWN OVER-DETECTION (%s)',
    (_brief, c) => {
      expect(satisfied(c.brief, c.dimension)).toBe(false);
    },
  );

  it('the goal-prize arm is GONE and cannot silently return', () => {
    // The arm's own sentence must not credit goal by ANY route. This is the
    // deletion's pin: re-adding the literal turns this RED.
    expect(satisfied('Faster delivery to northern customers is the main prize.', 'goal')).toBe(false);
    expect(satisfied('Keeping the automotive contract is the prize.', 'goal')).toBe(false);
    // …and the capability it was added for is UNAFFECTED: M3 still leaves
    // exactly one dimension missing, so it drafts first-turn with a disclosure.
    const M3 =
      'Should we open a second warehouse in Manchester next year, or expand our existing site? A new site would cost roughly £1.2 million up front with £300,000 a year in running costs; expanding the current one is about £450,000. Faster delivery to northern customers is the main prize.';
    expect(assessBriefCompleteness(M3).missing).toEqual(['goal']);
  });
});
