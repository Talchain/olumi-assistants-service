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
 * SCOPE (after the #928 review ablation): TWO arms remain — goal `is the …
 * prize` and options from-X-to-Y. Both are guarded by CLOSED POSITIVE lists
 * and fail safe; the two timeframe arms that were guarded by a closed
 * NEGATIVE list are gone (see the note below the goal block).
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

describe('goal widening — predicate-nominative "…is the (main) prize" (measured miss: M3)', () => {
  it('widened: M3 wire capture — "Faster delivery to northern customers is the main prize."', () => {
    expect(
      satisfied(
        'Should we open a second warehouse in Manchester next year, or expand our existing site? Faster delivery to northern customers is the main prize.',
        'goal',
      ),
    ).toBe(true);
  });

  it('widened: bare "…is the prize" without an adjective', () => {
    expect(satisfied('Keeping the automotive contract is the prize. Do we bid low or walk away?', 'goal')).toBe(true);
  });

  it('widened: "…remains the biggest prize"', () => {
    expect(
      satisfied('Do we chase enterprise or SMB? Enterprise remains the biggest prize.', 'goal'),
    ).toBe(true);
  });

  it('twin (opposite direction): a prize DRAW is not an objective — goal stays missing', () => {
    expect(
      satisfied('We run a prize draw for customers every quarter. Should we keep it or drop it?', 'goal'),
    ).toBe(false);
  });

  it('twin (opposite direction): "First prize is…" (prize as subject) — goal stays missing', () => {
    expect(
      satisfied('First prize is a weekend in Paris. Should we sponsor the raffle or skip it?', 'goal'),
    ).toBe(false);
  });

  it('twin (opposite direction): "the prize money" as a fact — goal stays missing', () => {
    expect(satisfied('The prize money doubled. Should we enter the competition or sit it out?', 'goal')).toBe(false);
  });
});

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
