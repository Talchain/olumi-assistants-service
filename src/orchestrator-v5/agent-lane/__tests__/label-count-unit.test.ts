/**
 * ⭐ RT-6 row 1b (Science ruling #87 6005615422; red team #87 6005529714): a per-change unit the user states as the node's
 * own LABEL ("Every 10 more café subscribers …", node "Café subscribers" counted in "cafés") stands for one of that
 * node's unit. Label IDENTITY only (case + singular/plural), only for a count or count rate, and a period the label names
 * (any of the leaf's periods, never C1's month/year view) must be the unit's own.
 */
import { describe, expect, it } from 'vitest';
import { labelStandsForCountUnit } from '../same-unit.js';

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
