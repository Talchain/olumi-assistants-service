/**
 * ⭐ PAUL-HIT S3 (Panel #70 5854839233, FINDINGS S3) — THE CHALLENGE TITLE NAMES THE LIMIT AND ITS FIGURE — RED-first.
 *
 * THE DEFECT: the Reasoning tab's "Challenge the thinking" shows a card's TITLE alone. Paul's served card
 * (`coach:limit_estimate:ff862af73b3546e3:2026-09-27T08:56:05.586Z:auto_first_pass`, export 17d1cd3a) read
 * "Check the figure your limit was checked against", which names neither the limit nor the figure. Its body said both:
 * "Your limit on “Monthly churn” was checked against Olumi's estimate that it is about 3% per month today…".
 *
 * THE RULE: the title says what the body says, briefly: which limit, and the figure it was checked against. The first
 * form within `title_max` wins; a long label falls back to a shorter form, never refusing the card. The body is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { composeEstimatedLimitCard, ESTIMATED_LIMIT_FALLBACK_TITLE, type EstimatedLimit } from '../estimated-limit-card.js';
import { RUN_TURN_COACHING_CONTRACT } from '../fragile-link-challenge.js';

// Paul's served limit, verbatim from the served body (export 17d1cd3a).
const served: EstimatedLimit = { nodeId: 'monthly_churn', kind: 'factor', label: 'Monthly churn', level: '3% per month', whose: 'olumi' };
const { title_max } = RUN_TURN_COACHING_CONTRACT.limits;

describe('S3: the estimated-limit title names the limit and the figure', () => {
  it("RED (Paul's served card): Olumi's estimate → the title names “Monthly churn” and 3% per month", () => {
    const copy = composeEstimatedLimitCard(served);
    expect(copy.title).toBe("Your “Monthly churn” limit was checked against Olumi's estimate of 3% per month");
    expect(copy.title.length).toBeLessThanOrEqual(title_max);
    // The body the title summarises is unchanged.
    expect(copy.body).toBe("Your limit on “Monthly churn” was checked against Olumi's estimate that it is about 3% per month today, not a figure you gave. If you know the real figure, it is worth saying.");
  });

  it('RED (ratified arm): an adopted assumption → names the limit and the assumed figure, never "Olumi\'s estimate"', () => {
    const copy = composeEstimatedLimitCard({ ...served, level: '4%', whose: 'ratified' });
    expect(copy.title).toBe('Your “Monthly churn” limit was checked against an assumed 4%');
    expect(copy.title).not.toMatch(/Olumi's estimate|you said|not a figure you gave/);
  });

  it('a long label falls back to a shorter form that still names the figure, within title_max', () => {
    const label = 'Monthly churn among existing Pro customers on annual plans';
    const olumi = composeEstimatedLimitCard({ ...served, label });
    expect(olumi.title.length).toBeLessThanOrEqual(title_max);
    expect(olumi.title).toContain('3% per month');
    const ratified = composeEstimatedLimitCard({ ...served, label, level: '4%', whose: 'ratified' });
    expect(ratified.title).toBe('Your limit was checked against an assumed 4%');
  });

  it('nothing naming it fits → the fallback title, and the card is never refused for its title', () => {
    const level = `${'9'.repeat(70)} per month`;
    expect(composeEstimatedLimitCard({ ...served, level }).title).toBe(ESTIMATED_LIMIT_FALLBACK_TITLE);
    expect(composeEstimatedLimitCard({ ...served, level, whose: 'ratified' }).title).toBe(ESTIMATED_LIMIT_FALLBACK_TITLE);
  });
});
