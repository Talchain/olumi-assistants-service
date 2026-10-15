/**
 * AIE 6180618773 C4 (the final science table): the number reached is the user's point FORECAST, and holding it fixed is Olumi's
 * explicit conditional scenario, said as Olumi's with its uncertainty left out. The card the press adopts says so. Second brief
 * (the two-brief rule beside marketing's capture and joint rows): a recruitment funnel, its own labels, figures and window from
 * today, so the words follow from the forecast, never from marketing's literals.
 */
import { describe, expect, it } from 'vitest';
import { cohortFixedReachScenario, cohortForecastCardWords, cohortForecastRecordedWords } from '../cohort-forecast-write.js';

const F = { people_reached: 9, conversion_middle_half_pct: [55, 80] } as never;
const S = { people: { source: 'A referral scheme would get us 9 candidates to offer in the first four months.' },
  conversion: { source: 'I would say 55% to 80%.' }, same_cohort: { source: 'Yes, the engineers we hire are the candidates who accept our offers.' } } as never;

describe('C4: the reach is the user\'s forecast; holding it fixed is Olumi\'s scenario (recruitment brief)', () => {
  const lines = cohortForecastCardWords('Start a referral scheme', F, S, 'Offer acceptance rate', 'Engineers hired', 'the first four months').split('\n');

  it('RED: the user\'s line says their FORECAST, and claims nothing fixed for them', () => {
    expect(lines[1]).toBe('From your messages: ‘A referral scheme would get us 9 candidates to offer in the first four months.’ · ‘Yes, the engineers '
      + 'we hire are the candidates who accept our offers.’. Your forecast is that it reaches 9 people during the first four months, and ‘Engineers hired’ '
      + 'counts the people who convert among those same people, as you said.');
    expect(lines[1]).not.toMatch(/held fixed|It reaches/);
  });

  it('RED: Olumi\'s scenario is its own line, said once, with the reach\'s uncertainty left out; the law stays Olumi\'s approximation', () => {
    expect(lines[2]).toBe(cohortFixedReachScenario(9, 'the first four months'));
    expect(lines[2]).toBe('Olumi’s scenario, not yours: the chance is worked out as if exactly 9 people are reached during the first four months; '
      + 'how many it actually reaches may differ, and that uncertainty is not included.');
    expect(lines.filter((l) => l.includes('as if exactly'))).toHaveLength(1);
    expect(lines[3]).toMatch(/^Olumi’s approximation, not yours: the underlying ‘Offer acceptance rate’ is treated as a smooth curve/);
  });

  it('RED: the receipt records their forecast, not a certainty', () => {
    expect(cohortForecastRecordedWords('Start a referral scheme', F)).toBe('Recorded from your words: your forecast that ‘Start a referral scheme’ '
      + 'reaches 9 people, with about one chance in four that its underlying conversion rate is below 55% and one in four that it is above 80%.');
  });
});
