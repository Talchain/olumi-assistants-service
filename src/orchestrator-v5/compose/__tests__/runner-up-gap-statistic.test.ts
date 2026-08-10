/**
 * F3 — the runner-up gap-statistic reader, measured against a corpus that did
 * NOT come out of the author's head (CLAUDE.md trap 22).
 *
 * ## Provenance of every MUST-TRIP case
 *
 * `AUDIT_*`      the external audit's capture on DEPLOYED build `5d69ce0`,
 *                10 Aug 2026 — the sentence this lane exists to remove.
 * `WALK_*`       `compose/__tests__/fixtures/dsk-walk/session-a|b2.enrichment.json`
 *                — decision_review narratives recorded off staging walks.
 * `PROMPT_V41_*` `src/prompts/Versions /decision_review_prompt_v4_1.txt` — the
 *                served prompt's OWN worked examples.
 * `HEADLINE_*`   the historic sentences `analysis-result-headline.ts` and its
 *                specs record as once-emitted (kept there as append-only
 *                evidence by PR #906, which retired the copy but not the record).
 *
 * Every one of them has an OPPOSITE-DIRECTION TWIN below: a sentence in which
 * the same words, or the same quantity, are legitimate and must survive
 * untouched (trap 22b — a corpus that tests one direction is a guard watching
 * one door).
 *
 * ## RED-first at pristine (CEE f9ce8c90)
 *
 * This file imports `../runner-up-gap-statistic.js`, which does not exist at
 * pristine, so it fails at COLLECT with
 * `Failed to load url ../runner-up-gap-statistic.js`. That is a weak RED and it
 * is stated as such: the load-bearing RED-first evidence for this lane is
 * `coaching/__tests__/decision-review-enricher.runner-up-gap.test.ts`, which
 * runs at pristine and fails on two behavioural assertions.
 */

import { describe, expect, it } from 'vitest';

import {
  KNOWN_UNDETECTED_GAP_FORMS,
  RUNNER_UP_GAP_REPLACEMENT,
  findRunnerUpGapCodes,
  redactRunnerUpGapStatistic,
  unitStatesRunnerUpGap,
} from '../runner-up-gap-statistic.js';

// ============================================================================
// The corpus — MUST TRIP. Every entry is a string this estate has emitted.
// ============================================================================

const AUDIT_33PP =
  'Switch to HubSpot is the stronger route on the current model, coming out ahead of ' +
  'Salesforce by a margin of 33 percentage points.';

const MUST_TRIP: ReadonlyArray<readonly [string, string]> = [
  ['AUDIT_33PP (deployed 5d69ce0)', AUDIT_33PP],
  [
    'WALK session-a',
    'Double Down on Partner Channel leads by a margin of about 78 percentage points.',
  ],
  [
    'WALK session-b2',
    'Energy Efficiency Retrofit comes out ahead by a margin of about 22 percentage points, ' +
      'but the lead is not firm.',
  ],
  [
    'PROMPT_V41 worked example (bare points dialect)',
    'Germany trails by just 7 points and could overtake if market timing assumptions shift.',
  ],
  ['HEADLINE retired copy', 'Switch to HubSpot currently leads by 95 percentage points.'],
  [
    'HEADLINE retired copy, bare points',
    'Double Down on Partner Channel currently leads by 78 points on the current model.',
  ],
  ['run-comparison prior-run copy', 'Double down on SMB previously led by 17 points.'],
  ['two-option comparison', 'Option B (Mid-Market Tier) leads Option A by 6 points.'],
  [
    'explanation fallback',
    'Hire Two Senior Engineers Locally leads at 72% probability, 51 percentage points ahead of the runner-up.',
  ],
  [
    'unbounded label between binder and by',
    'It sits ahead of Standardise on Dell XPS by 44 percentage points.',
  ],
  ['lead-of form', 'Plan A holds a narrow lead of about 7 percentage points.'],
  ['lead-is form', 'The lead is 14 percentage points.'],
  [
    'performs-best form',
    'Engineering Capacity carries the largest influence and the leading option performs best by 14 percentage points.',
  ],
  ['trailing form', 'This is a close call with Option B trailing by 12 points.'],
  ['lead-delta form', 'Its lead has narrowed by about 14 percentage points.'],
  [
    'job-title neighbour that is STILL a gap claim',
    'Hire a tech lead leads by 30 percentage points on your numbers.',
  ],
  ['constraint-gap disclosure copy', 'MacBook Pro leads by 18 percentage points and is the best pick.'],
  ['budget copy', 'Increase Engineering Budget currently leads by 39 percentage points.'],
];

// ============================================================================
// The twins — MUST NOT TRIP. Each pairs with a MUST-TRIP case above.
// ============================================================================

const MUST_NOT_TRIP: ReadonlyArray<readonly [string, string]> = [
  [
    'THE RATIFIED-CORRECT SENTENCE (#906)',
    'Switch to HubSpot came out ahead in 61% of runs of this model.',
  ],
  [
    'the other correct form — win probability, not a gap',
    'UK expansion leads with a 42% win probability, primarily driven by the strong market timing pathway.',
  ],
  [
    'twin of AUDIT_33PP: a user-stated factor pp figure',
    'Raising conversion rate by 5 percentage points would change the ranking.',
  ],
  [
    'twin of the lead-delta form: a factor swing',
    'A swing of around eight percentage points in Engineering Capacity would flip the result.',
  ],
  [
    'twin of the margin forms: the accounting sense of the word',
    'Gross margin falls by 3 percentage points in the downside case.',
  ],
  ['second accounting margin', 'Operating margin improved by 4 percentage points last year.'],
  ['third accounting margin', 'Retention margin slipped by 2 percentage points.'],
  ['an interval width, not a lead', 'The confidence interval spans 23 percentage points.'],
  [
    'a scenario trigger',
    'If churn rises by 10 percentage points, the ranking could flip.',
  ],
  [
    'twin of the job-title case, where NOTHING is a gap claim',
    'The team leads meet weekly to review the 12 percentage points of headroom.',
  ],
  [
    'attributive by — a factor attribution wearing a gap’s clothes',
    'Option A leads, driven by a 12 percentage point rise in conversion.',
  ],
  ['temporal ahead-of', 'Delivery is 5 percentage points ahead of schedule.'],
  [
    'causal leads-to',
    'Higher capacity leads to a 12 percentage point improvement in throughput.',
  ],
  [
    'a flip threshold on a factor',
    'Conversion rate would need to rise 8 percentage points before this changes.',
  ],
  [
    'a user-stated uplift echoed back',
    'The user stated a 15 percentage point uplift in win rate for the partner channel.',
  ],
  ['a flip_threshold display value', '33 percentage points'],
  /**
   * ⚠ THIS PAIR EXISTS BECAUSE A MUTANT SURVIVED, AND IT IS THE ONLY THING
   * PINNING THE BINDER WINDOW (CLAUDE.md trap 13c — a survivor is a claim, and
   * an unpinned constant is a claim nobody made).
   *
   * Widening `{0,25}` to `{0,120}` left all 46 cases GREEN: every attributive
   * twin above happens to carry a COMMA, which the `[^,.!?;:]` class blocks
   * whatever the window is. So the NUMBER was doing no measurable work and a
   * future widening — the exact trap-22b over-reach this reader is built to
   * avoid — would have shipped silently.
   *
   * These two sentences are comma-free, put a factor quantity 60+ characters
   * downstream of a ranking word, and are LEGITIMATE: they state how far a
   * FACTOR moves the outcome, not how far one option is from another. They
   * survive at 25 and are wrongly redacted at 120.
   */
  [
    'window pin A: a comma-free factor sensitivity far downstream of a ranking word',
    'Option A leads in most runs and the conversion assumption alone moves the result by 12 percentage points.',
  ],
  [
    'window pin B: the same shape on a different factor',
    'Plan A leads on the current evidence and a single retention assumption shifts the outcome by 9 percentage points.',
  ],
];

describe('findRunnerUpGapCodes — the measured corpus', () => {
  it.each(MUST_TRIP)('TRIPS: %s', (_provenance, sentence) => {
    expect(findRunnerUpGapCodes(sentence).length).toBeGreaterThan(0);
  });

  it.each(MUST_NOT_TRIP)('SURVIVES: %s', (_provenance, sentence) => {
    expect(findRunnerUpGapCodes(sentence)).toEqual([]);
  });

  it('the corpus is non-trivial in both directions', () => {
    // Trap 13: an absence assertion needs a positive control. If either arm
    // were empty, every `it.each` above would vacuously pass.
    expect(MUST_TRIP.length).toBeGreaterThanOrEqual(18);
    expect(MUST_NOT_TRIP.length).toBeGreaterThanOrEqual(18);
  });
});

describe('KNOWN_UNDETECTED_GAP_FORMS — the honest gap, pinned', () => {
  /**
   * Trap 22f: a gap recorded in the suite is honest; a gap invisible to it is
   * how four rounds of oscillation happen. This asserts EXACTLY the declared
   * set, so it REDs if the set grows OR shrinks — and each member is exercised
   * below so "declared" cannot drift from "true".
   */
  it('the declared set is exactly three forms', () => {
    expect([...KNOWN_UNDETECTED_GAP_FORMS]).toEqual([
      'percent_dialect',
      'spelled_out_number',
      'clause_separated',
    ]);
  });

  it('percent_dialect: "leads by 24%" is NOT detected, deliberately', () => {
    expect(findRunnerUpGapCodes('Option A leads by 24%.')).toEqual([]);
  });

  it('spelled_out_number: "leads by eight percentage points" is NOT detected', () => {
    expect(findRunnerUpGapCodes('Option A leads by eight percentage points.')).toEqual([]);
  });

  it('clause_separated: a clause boundary between binder and connector is NOT crossed', () => {
    expect(
      findRunnerUpGapCodes('Option A leads, and it is clear by 12 percentage points.'),
    ).toEqual([]);
  });
});

describe('redactRunnerUpGapStatistic — surgery, not demolition', () => {
  it('replaces only the offending sentence and reports paths + codes', () => {
    const input = {
      narrative_summary: `${AUDIT_33PP} The result leans heavily on Sales Team Capacity.`,
    };
    const out = redactRunnerUpGapStatistic(input);

    expect(out.value.narrative_summary).toContain(RUNNER_UP_GAP_REPLACEMENT);
    expect(out.value.narrative_summary).toContain('Sales Team Capacity');
    expect(out.value.narrative_summary).not.toContain('33 percentage points');
    expect(out.paths).toEqual(['narrative_summary']);
    expect(out.codes.length).toBeGreaterThan(0);
    expect(out.fields).toBe(1);
  });

  it('reaches every prose field, not just narrative_summary (trap 3b at field grain)', () => {
    const out = redactRunnerUpGapStatistic({
      narrative_summary: 'Plan A came out ahead in 61% of runs of this model.',
      robustness_explanation: { summary: 'The lead is 14 percentage points.' },
      story_headlines: { opt_a: 'Leads by 18 percentage points', opt_b: 'Needs stronger demand' },
    });

    expect(out.paths).toEqual(['robustness_explanation.summary', 'story_headlines.opt_a']);
    expect(out.value.narrative_summary).toBe('Plan A came out ahead in 61% of runs of this model.');
    expect(out.value.story_headlines.opt_b).toBe('Needs stronger demand');
  });

  it('walks arrays and reports indexed paths', () => {
    const out = redactRunnerUpGapStatistic({
      key_assumptions: ['Demand holds', 'Plan A leads by 30 percentage points'],
    });
    expect(out.paths).toEqual(['key_assumptions[1]']);
    expect(out.value.key_assumptions[0]).toBe('Demand holds');
  });

  it('BYTE IDENTITY: a clean review comes back as the SAME REFERENCE', () => {
    const input = {
      produced_at: '2026-08-10T12:00:00.000Z',
      narrative_summary: 'Plan A came out ahead in 61% of runs of this model.',
      flip_thresholds: [{ factor_id: 'fac_conv', current_display: '33 percentage points' }],
      bias_findings: [{ affected_elements: ['opt_a', 'edge_1'] }],
    };
    const out = redactRunnerUpGapStatistic(input);

    // Identity, not deep equality: `replaceAssertingUnits` returns its input
    // reference when nothing asserts, and the walk preserves that upward.
    expect(out.value).toBe(input);
    expect(out.codes).toEqual([]);
    expect(out.fields).toBe(0);
  });

  it('NEVER EMPTIES: a wall-to-wall offending narrative still composes a card', () => {
    const out = redactRunnerUpGapStatistic({
      narrative_summary: 'Plan A leads by 30 percentage points. It is 12 points ahead of Plan B.',
    });
    expect(out.value.narrative_summary.trim().length).toBeGreaterThan(0);
  });

  it('is total over non-object inputs and never throws', () => {
    expect(redactRunnerUpGapStatistic(null).value).toBeNull();
    expect(redactRunnerUpGapStatistic(42).value).toBe(42);
    expect(redactRunnerUpGapStatistic(undefined).value).toBeUndefined();
    expect(unitStatesRunnerUpGap('')).toBe(false);
  });

  it('the replacement asserts nothing — no leader, no number, no existence claim', () => {
    expect(RUNNER_UP_GAP_REPLACEMENT).not.toMatch(/\d/);
    // And it must not itself trip the reader, or a redacted field would be
    // re-redacted on any second pass (a guard that eats its own output).
    expect(findRunnerUpGapCodes(RUNNER_UP_GAP_REPLACEMENT)).toEqual([]);
  });
});
