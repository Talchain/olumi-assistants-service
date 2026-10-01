/**
 * ⛔ R3 F5 I1.1 (#85 5932127058, CEE `30d417d0`, guest `799d1a5d`): after the brief the goal held `goal_threshold_unit`
 * "£ per quarter"; the approved "double that" card sent "£" and the target writer stored "£" — the period was gone.
 * The card now writes the goal's held unit when its own unit is that unit without its period.
 */
import { describe, it, expect } from 'vitest';
import { unitKeepingHeldPeriod, unitNamesItsPeriod } from '../goal-period.js';

describe('unitKeepingHeldPeriod — a target write never drops the period the goal\'s unit carries', () => {
  it.each([
    ['£', '£ per quarter', '£ per quarter'],
    ['£', '£/month', '£/month'],
    ['GBP', 'gbp per year', 'gbp per year'],
  ])('RED: card %j against held %j → the held unit %j, byte-equal', (card, held, out) => {
    expect(unitKeepingHeldPeriod(card, held)).toBe(out);
  });

  it.each([
    ['no held unit', '£', undefined, '£'],
    ['a held unit with no period', '£', '£', '£'],
    ['the card names its own period', '£ per month', '£ per quarter', '£ per month'],
    ['a different base unit', 'customers', '£ per quarter', 'customers'],
    ['a held unit with two joints (not one period)', '£', '£ per user per month', '£'],
  ])('CONTROL: %s → the card\'s unit', (_n, card, held, out) => {
    expect(unitKeepingHeldPeriod(card, held)).toBe(out);
  });

  it('unitNamesItsPeriod reads the joint only', () => {
    expect(unitNamesItsPeriod('£ per quarter')).toBe(true);
    expect(unitNamesItsPeriod('£/month')).toBe(true);
    expect(unitNamesItsPeriod('£')).toBe(false);
    expect(unitNamesItsPeriod('people')).toBe(false);
  });
});
