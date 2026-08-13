/**
 * Clarify v2 rubric — the four MEASURED detection-miss widenings
 * (Track 1 intake fix, 2026-08-13; derivation: olumi-docs/PHASE0-EVIDENCE-
 * 2026-07-28/draft-reliability-2026-08-12/INTAKE-FUNNEL.md §2.1).
 *
 * Each arm below was measured as a detection miss on the DEPLOYED rubric
 * against real wire briefs (CEE a9022e7 = staging tip 335a9380 on the intake
 * path): the information was IN THE TEXT and the battery could not parse the
 * phrasing. The positive cases here are the wire captures' own constructions;
 * trap-22b discipline is binding, so EVERY positive carries at least one
 * opposite-direction twin — a same-vocabulary sentence that must NOT satisfy
 * the dimension — shown failing in the same run.
 *
 * SCOPE (after two rounds of #928 review): ONE arm remains — options
 * from-X-to-Y, guarded by a CLOSED POSITIVE list, which fails safe. The two
 * timeframe arms (closed NEGATIVE list) and the goal-prize arm (defeated the
 * fail-closed denial check) are both gone; the notes below record why, and
 * the flip set survived every removal.
 *
 * RED-first: at pristine (335a9380) every `widened:` positive fails
 * (dimension still missing) and every twin already passes; the twins are the
 * regression floor that keeps the widening from crediting briefs that supply
 * nothing (the failure mode FLOOR 6's `must_ask` direction exists for).
 */
import { describe, it, expect } from 'vitest';

import { assessBriefCompleteness } from '../../src/orchestrator-v5/clarify-v2/rubric.js';

function satisfied(brief: string, dimension: 'goal' | 'options' | 'quantities' | 'timeframe'): boolean {
  return assessBriefCompleteness(brief).satisfied.includes(dimension);
}

// ── THE GOAL-PRIZE ARM WAS ALSO DROPPED (#928 review round 2) ─────────────
// It could not over-credit on its own (closed positive list), but it was the
// one arm on which the fail-closed denial check could be defeated — 8 measured
// phrasings, by token gaps ("Nobody thinks…") and clause-orphaning. On a GOAL
// arm that means an invented objective with NO disclosure, which is the
// round-1 blocker surviving under different wording. Dropping it closed all 8
// AT ZERO COST: M3 still drafts first-turn, as `missing=["goal"]` routes to
// DRAFT-FIRST with an honest disclosure instead of silently to `complete`.
// Its tests live on as REGRESSION pins in clarify-v2.rubric-fail-closed.test.ts
// ("the goal-prize arm is GONE and cannot silently return").

// ── THE TWO TIMEFRAME ARMS WERE ABLATED BEFORE MERGE ──────────────────────
// #928 adversarial review (REVIEW-928.md §1) measured them as FAIL-UNSAFE: a
// closed NEGATIVE list over an unbounded domain (English past-tense verbs), so
// "We trialled it for six months" / "The board met in October" scored
// timeframe-SATISFIED. Their tests are deleted with them rather than left
// skipped — a skipped suite for deleted code is a mirror that goes stale. The
// exact strings that exposed them are PINNED as a known-behaviour corpus in
// clarify-v2.rubric-fail-closed.test.ts, so re-introducing either arm in its
// old shape turns that suite RED.

describe('options widening — deliberative from-X-to-Y change construction (measured miss: M4)', () => {
  it('widened: M4 wire capture — "switch our 40-person engineering team from quarterly releases to continuous deployment"', () => {
    expect(
      satisfied(
        'Should we switch our 40-person engineering team from quarterly releases to continuous deployment? Release overhead currently eats about two engineer-days per sprint, but several enterprise customers say they value predictable, well-documented quarterly release notes.',
        'options',
      ),
    ).toBe(true);
  });

  it('widened: "move from per-seat licences to usage-based pricing"', () => {
    expect(
      satisfied('Should we move from per-seat licences to usage-based pricing?', 'options'),
    ).toBe(true);
  });

  it('widened: second-form lead — "we could migrate from AWS to GCP"', () => {
    expect(satisfied('We could migrate from AWS to GCP. Budget is tight.', 'options')).toBe(true);
  });

  it('twin (opposite direction): a numeric range under a growth verb names no alternatives', () => {
    expect(
      satisfied('Revenue grew from £2m to £4m. Should we hire another sales rep?', 'options'),
    ).toBe(false);
  });

  it('twin (opposite direction): "went from strength to strength" is an idiom, not a choice set', () => {
    expect(
      satisfied('The team went from strength to strength. Should we expand headcount?', 'options'),
    ).toBe(false);
  });

  it('twin (opposite direction): "from customers to date" is a source phrase, not a choice set', () => {
    expect(
      satisfied('Feedback from customers to date suggests caution. Should we delay the launch?', 'options'),
    ).toBe(false);
  });

  it('twin (assertive lead is a plan, not a choice — same rule as the serial-list arm)', () => {
    expect(
      satisfied('We will migrate from AWS to GCP in the coming rollout, whatever it costs us.', 'options'),
    ).toBe(false);
  });
});
