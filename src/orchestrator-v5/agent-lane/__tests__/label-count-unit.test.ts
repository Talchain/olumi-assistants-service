/**
 * ⭐ RT-6 row 1b (Science ruling #87 6005615422; red team #87 6005529714): a per-change unit the user states as the node's
 * own LABEL ("Every 10 more café subscribers …", node "Café subscribers" counted in "cafés") stands for one of that
 * node's unit. Label IDENTITY only (case + singular/plural), only for a count or count rate, and a period the label names
 * (any of the leaf's periods, never C1's month/year view) must be the unit's own.
 */
import { describe, expect, it } from 'vitest';
import { labelStandsForCountUnit } from '../same-unit.js';
import { sentenceCountsLabel } from '../../system-events/link-effect-unit-reading.js';

describe('labelStandsForCountUnit: the ONE label-identity matcher (Science 6005615422)', () => {
  it.each([
    ['the red team\'s wording', 'café subscribers', 'Café subscribers', 'cafés'],
    ['singular', 'café subscriber', 'Café subscribers', 'cafés'],
    ['case only', 'CAFÉ SUBSCRIBERS', 'Café subscribers', 'cafés'],
    ['a period-carrying label whose period IS the unit\'s', 'monthly support tickets', 'Monthly support tickets', 'tickets/month'],
    ['a count rate with a periodless label', 'café subscribers', 'Café subscribers', 'cafés per week'],
  ])('YES, %s', (_why, stated, label, unit) => {
    expect(labelStandsForCountUnit(stated, label, unit)).toBe(true);
  });

  it.each([
    ['head noun only (rule (b) refused)', 'subscribers', 'Café subscribers', 'cafés'],
    ['the unit, not the label (that is the unit check\'s job)', 'cafés', 'Café subscribers', 'cafés'],
    ['a money unit', 'monthly revenue', 'Monthly revenue', 'GBP/month'],
    ['a percentage unit', 'churn rate', 'Churn rate', '%'],
    ['a points unit', 'gross margin', 'Gross margin', 'percentage points'],
    ['a duration unit', 'months to break-even', 'Months to break-even', 'months'],
    ['a label period that differs from the unit\'s (full reader: weekly)', 'weekly support tickets', 'Weekly support tickets', 'tickets/month'],
    ['a label period the unit does not carry', 'monthly support tickets', 'Monthly support tickets', 'tickets'],
    ['a label naming two periods', 'weekly monthly tickets', 'Weekly monthly tickets', 'tickets/month'],
    ['an extra word (no fuzzy match)', 'new café subscribers', 'Café subscribers', 'cafés'],
  ])('NO, %s', (_why, stated, label, unit) => {
    expect(labelStandsForCountUnit(stated, label, unit)).toBe(false);
  });
});

// Codex r1: the Agent's unit alone proves nothing; the user's sentence must COUNT the end by its label, after its figure.
describe('sentenceCountsLabel: the label is the counted phrase right after that end\'s figure', () => {
  const LABEL = 'Café subscribers';
  it.each([
    ['"10 more café subscribers"', 'Every 10 more café subscribers adds about 1 percentage point of wholesale subscription revenue.', 10],
    ['no change word', 'For every 10 café subscribers we add, revenue rises about 1 percentage point.', 10],
    ['a fewer change, punctuation after the label', 'With 10 fewer café subscribers, revenue falls about 1 percentage point.', -10],
  ])('YES, %s', (_why, said, figure) => {
    expect(sentenceCountsLabel(said, figure, LABEL)).toBe(true);
  });
  it.each([
    ['the head noun only (the Codex r1 bypass)', 'Every 10 more subscribers adds about 1 percentage point of wholesale subscription revenue.', 10],
    ['the label after ANOTHER figure', 'Every 10 more cafés adds about 1 percentage point, 5 café subscribers or not.', 10],
    ['the label nowhere after the figure', 'Every 10 more cafés adds about 1 percentage point of wholesale subscription revenue.', 10],
    // Codex r2: two figures of this size; the label after the OTHER one (borrowed figure).
    ['two figures of this size, the label after the LATER one (Codex r2)', 'Every 10 more subscribers adds about 1 percentage point of wholesale subscription revenue, alongside 10 café subscribers.', 10],
    // The label after the EARLIER figure of this size: a first-match reader would borrow it (the mutant that survived).
    ['two figures of this size, the label after the EARLIER one', 'Alongside 10 café subscribers, every 10 more subscribers adds about 1 percentage point of wholesale subscription revenue.', 10],
    // Equal source and target figures are two figures of this size: nothing says which one counts this end.
    ['equal source and target figures (Codex r2)', 'Every 10 more café subscribers adds about 10 percentage points of wholesale subscription revenue.', 10],
    // Codex r2: a possessive, or another counted thing, continues the phrase: not a complete counted phrase.
    ['a possessive continuation (Codex r2)', 'Every 10 more café subscribers\u2019 customers adds about 1 percentage point of wholesale subscription revenue.', 10],
    ['another counted noun follows', 'Every 10 more café subscribers customers adds about 1 percentage point of wholesale subscription revenue.', 10],
  ])('NO, %s', (_why, said, figure) => {
    expect(sentenceCountsLabel(said, figure, LABEL)).toBe(false);
  });

});
