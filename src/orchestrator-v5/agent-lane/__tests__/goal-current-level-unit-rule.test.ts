/**
 * ⛔ THE GOAL'S CURRENT LEVEL IS READ IN THE GOAL'S OWN UNIT — row by row, over the goal units the estate has
 * actually stored (the `goal_threshold_unit` spellings in this repo's served fixtures: "GBP MRR", "£ per month",
 * "GBP/month", "%", "customers", "£M ARR", and none).
 *
 * `readStatedGoalLevel` is the one rule the chat proposer applies before the brief path's scale rule. The route-level
 * rows (`goal-current-level-real-route.test.ts`) prove the proposer applies it; these rows pin the rule's whole
 * class: another currency, another measure or period of the same currency, another unit of the same kind, a
 * magnitude suffix, an unclassified or missing unit — and the spellings of ONE unit that must stay admitted.
 */
import { describe, it, expect } from 'vitest';
import { readStatedGoalLevel } from '../goal-current-level.js';
import { canonicaliseLimitUnit } from '../admit-constraint.js';

const read = (value: number, stated: string | undefined, goalUnit: string | undefined) =>
  readStatedGoalLevel(value, stated, { label: 'G', unit: goalUnit });

describe('admitted: the goal\'s own unit, spelled either way — the figure is unchanged', () => {
  it.each([
    ['GBP MRR', '£'], ['GBP MRR', 'GBP'], ['GBP MRR', 'gbp'], ['GBP MRR', 'GBP MRR'], ['GBP MRR', '£ MRR'], ['GBP MRR', 'gbp mrr'],
    ['£ per month', '£'], ['£ per month', 'GBP per month'], ['£ per month', '£/month'], ['£ per month', 'GBP/month'],
    ['GBP/month', '£ per month'], ['£', 'GBP'],
    ['%', '%'], ['%', 'percent'], ['%', 'percentage'],
    ['months', 'month'], ['months', 'months'], ['users', 'user'],
  ])('goal in %j, stated %j → admitted as stated', (goalUnit, stated) => {
    const r = read(12000, stated, goalUnit);
    expect(r, JSON.stringify(r)).toStrictEqual({ ok: true, raw: 12000 });
  });
});

describe('scaled: a k/m suffix on the goal\'s own currency — exactly the admit-constraint M-rung, stamped', () => {
  it.each([
    ['GBP MRR', 12, '£k', 12000], ['GBP MRR', 12, 'GBPk', 12000], ['GBP MRR', 12, 'GBP k', 12000], ['GBP MRR', 12, '£K', 12000],
    ['GBP MRR', 0.012, '£m', 12000], ['£ per month', 4.1, '£m', 4100000],
  ])('goal in %j, %d %j → raw %d with the M-rung\'s own stamp', (goalUnit, value, stated, raw) => {
    const r = read(value, stated, goalUnit);
    const mRung = canonicaliseLimitUnit(value, stated, { unit: goalUnit.split(/[\s/]+/)[0] });
    expect(r, JSON.stringify(r)).toStrictEqual({ ok: true, raw, normalised: mRung.provenance_unit_normalised });
    expect(mRung.provenance_unit_normalised).toStrictEqual({ rule: 'agent_lane_limit_magnitude_v1', original_value: value, original_unit: stated });
  });
});

describe('refused: never recorded as the goal\'s current level', () => {
  it.each([
    // another currency
    ['GBP MRR', 'USD', 'unit_mismatch'], ['GBP MRR', '$', 'unit_mismatch'], ['GBP MRR', 'EUR', 'unit_mismatch'], ['GBP MRR', 'USD MRR', 'unit_mismatch'],
    ['£ per month', '$/month', 'unit_mismatch'],
    // a currency word the one currency alphabet does not name: which currency cannot be proven
    ['GBP MRR', 'pounds', 'unit_mismatch'],
    // the same currency, another measure or period
    ['GBP MRR', 'GBP ARR', 'unit_mismatch'], ['GBP MRR', 'GBP per year', 'unit_mismatch'], ['GBP MRR', 'GBP/month', 'unit_mismatch'],
    ['£ per month', 'GBP MRR', 'unit_mismatch'], ['£ per month', '£ per year', 'unit_mismatch'],
    // another unit of the same kind
    ['%', 'pp', 'unit_mismatch'], ['%', 'percentage points', 'unit_mismatch'], ['months', 'weeks', 'unit_mismatch'], ['users', 'people', 'unit_mismatch'],
    // another kind of unit
    ['GBP MRR', '%', 'unit_mismatch'], ['GBP MRR', 'users', 'unit_mismatch'], ['%', '£', 'unit_mismatch'],
    // a goal whose unit no classifier reads, and a figure in one it does
    ['customers', '£', 'unit_mismatch'], ['customers', '%', 'unit_mismatch'], ['£M ARR', '£', 'unit_mismatch'],
    // fail closed: an unclassified or missing unit on a goal whose unit is known
    ['GBP MRR', 'subscribers', 'unit_unrecognised'], ['GBP MRR', '$k', 'unit_unrecognised'], ['GBP MRR', '£bn', 'unit_unrecognised'],
    ['GBP MRR', '£k MRR', 'unit_unrecognised'], ['GBP MRR', 'thousand GBP', 'unit_unrecognised'],
    ['GBP MRR', '', 'unit_unstated'], ['GBP MRR', undefined, 'unit_unstated'], ['%', '', 'unit_unstated'],
  ])('goal in %j, stated %j → %s', (goalUnit, stated, refusal) => {
    const r = read(12, stated, goalUnit);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(!r.ok && r.refusal).toBe(refusal);
    expect(!r.ok && r.detail).toContain(goalUnit);
  });
});

describe('NAMED RESIDUAL (fail open, as the lane does) — pinned so a change is a decision, not drift', () => {
  it.each([
    ['customers', ''], ['customers', 'customers'], ['customers', 'subscribers'], ['£M ARR', '£M ARR'],
  ])('goal in %j (a unit no classifier reads), stated %j → admitted unchanged', (goalUnit, stated) => {
    expect(read(12, stated, goalUnit)).toStrictEqual({ ok: true, raw: 12 });
  });

  it('a goal with no unit at all → admitted unchanged (nothing to hold the figure to)', () => {
    expect(read(12, '£', undefined)).toStrictEqual({ ok: true, raw: 12 });
  });
});
