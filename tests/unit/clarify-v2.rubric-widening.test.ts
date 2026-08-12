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

describe('timeframe widening — bare "for + word-form duration" (measured miss: S4)', () => {
  it('widened: S4 wire capture — "renew our office lease for two years"', () => {
    expect(
      satisfied('Should we renew our office lease for two years, or go fully remote?', 'timeframe'),
    ).toBe(true);
  });

  it('widened: "commit to the vendor contract for three years"', () => {
    expect(
      satisfied('Should we commit to the vendor contract for three years, or negotiate annually?', 'timeframe'),
    ).toBe(true);
  });

  it('twin (opposite direction): perfective "we have been … for two years" is history, not a horizon', () => {
    expect(
      satisfied('We have been in this office for two years. Should we renew the lease or go fully remote?', 'timeframe'),
    ).toBe(false);
  });

  it('twin (opposite direction): "for two years now" is elapsed time, not a horizon', () => {
    expect(
      satisfied('We used the old system for two years now — should we switch or stay?', 'timeframe'),
    ).toBe(false);
  });

  it('twin (opposite direction): past-tense "we ran the pilot for six months" is history', () => {
    expect(
      satisfied('We ran the pilot for six months. Should we roll it out or stop?', 'timeframe'),
    ).toBe(false);
  });

  it('control (pre-existing exclusion holds): a compound adjective is not a horizon', () => {
    expect(satisfied('Should we adopt a two-year plan or stay flexible?', 'timeframe')).toBe(false);
  });
});

describe('timeframe widening — bare month behind in/until/before/during (measured miss: M5)', () => {
  it('widened: M5 wire capture — "launch our beta programme in September … or wait for … December"', () => {
    expect(
      satisfied(
        'Should we launch our beta programme in September with 50 hand-picked customers, or wait for the polished full release in December? Early feedback would shape the roadmap while it can still change, but a buggy beta could damage our reputation with the key accounts we most need to impress.',
        'timeframe',
      ),
    ).toBe(true);
  });

  it('widened: "before March" (deadline without "by")', () => {
    expect(satisfied('We must decide before March, or the grant lapses. Do we commit or pass?', 'timeframe')).toBe(true);
  });

  it('widened: "until January"', () => {
    expect(satisfied('Should we open the store now or wait until January?', 'timeframe')).toBe(true);
  });

  it('twin (opposite direction): "we tried this in March" is a past attempt, not a horizon', () => {
    expect(
      satisfied('We tried this in March and it flopped. Should we try again or drop the idea?', 'timeframe'),
    ).toBe(false);
  });

  it('twin (opposite direction): "the pilot we launched in September" is history', () => {
    expect(
      satisfied('The pilot we launched in September underperformed. Do we persist or cancel it?', 'timeframe'),
    ).toBe(false);
  });

  it('twin (opposite direction): "in May last year" is explicitly backward-looking', () => {
    expect(
      satisfied('Churn spiked in May last year. Should we change the pricing or hold?', 'timeframe'),
    ).toBe(false);
  });
});

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
