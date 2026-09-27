/**
 * ⛔ A DERIVED LEVEL IS THE USER'S ONLY UNDER AIQ'S THREE TYPED CONDITIONS (ruling #70 5859388817).
 *
 * Served (DL pj-20260927T181846Z, journey C): C06/C07 set the "Incremental 6-month spend" limit to at most £30,000
 * (the user's figure, `provenance: 'explicit'`); C08 the user typed "Let's spit it 50/50 at this stage." (sic). The
 * Agent added the option with NO levels: "'50/50' did not state a separate figure for either factor in the model".
 *
 * The rule (a pure reading here; the persisted `derived_from` stamp waits for Canonical's carrier, #70 5859537590):
 *   1. every operand is user-stated and typed: the ratio in THIS message, the base a user-stated total in the model;
 *   2. the operation is exact arithmetic (a split whose shares sum to the whole), with no hedge;
 *   3. exactly ONE candidate total is in scope, or the user is asked which.
 * Anything else is not the user's derivation (Olumi's arithmetic, stamped and shown as such).
 */
import { describe, it, expect } from 'vitest';
import { readUserSplit, type StatedTotal } from '../derived-split.js';

const SPEND: StatedTotal = { node_id: 'incremental_6_month_spend', label: 'Incremental 6-month spend', value: 30000, unit: 'GBP', by: 'user' };
const C08 = "Let's spit it 50/50 at this stage.";

describe('the user\'s split: all three conditions hold', () => {
  it('RED: the served C08 turn — "50/50" of the £30,000 the user set → £15,000 each, with the working', () => {
    const r = readUserSplit(C08, [SPEND], 2);
    expect(r).toEqual({ kind: 'user_split', ratio: [0.5, 0.5], base: SPEND, parts: [15000, 15000], working: '£15,000 each: half of your £30,000' });
  });

  it('other typed splits: "70:30", "70/30", "a third each", "split it evenly"', () => {
    expect(readUserSplit('Put it 70:30 into features and ads.', [SPEND], 2)).toMatchObject({ kind: 'user_split', parts: [21000, 9000] });
    expect(readUserSplit('Go 70/30.', [SPEND], 2)).toMatchObject({ kind: 'user_split', parts: [21000, 9000] });
    expect(readUserSplit('A third each across the three.', [SPEND], 3)).toMatchObject({ kind: 'user_split', ratio: [1 / 3, 1 / 3, 1 / 3] });
    expect(readUserSplit('Split it evenly.', [SPEND], 2)).toMatchObject({ kind: 'user_split', parts: [15000, 15000] });
    expect(readUserSplit('All of it into ads: 100/0.', [SPEND], 2), 'an exact split with an empty part is still exact').toMatchObject({ kind: 'user_split', parts: [30000, 0] });
  });

  it('the parts always re-sum to the base (thirds of £20,000 are not rounded into £20,000.01)', () => {
    const r = readUserSplit('A third each.', [{ ...SPEND, value: 20000 }], 3);
    expect(r.kind).toBe('user_split');
    if (r.kind === 'user_split') expect(Math.abs(r.parts.reduce((a, b) => a + b, 0) - 20000)).toBeLessThan(1e-6);
  });
});

describe('any condition failing is NOT the user\'s derivation', () => {
  it('RED: condition 1 — a base that is Olumi\'s estimate is never a user\'s total', () => {
    expect(readUserSplit(C08, [{ ...SPEND, by: 'olumi' }], 2)).toEqual({ kind: 'not_derived' });
  });

  it('RED: condition 3 — two user totals in scope → ask which, never guess', () => {
    const old: StatedTotal = { node_id: 'annual_budget', label: 'Annual budget', value: 20000, unit: 'GBP', by: 'user' };
    expect(readUserSplit(C08, [SPEND, old], 2)).toEqual({ kind: 'ask_which_total', candidates: [SPEND, old] });
  });

  it('RED: condition 2 — shares that do not make the whole ("60/30") are refused, never normalised', () => {
    expect(readUserSplit('Go 60/30.', [SPEND], 2)).toEqual({ kind: 'not_derived' });
  });

  it('condition 2 — a hedge is not exact arithmetic ("roughly 50/50", "mostly into ads")', () => {
    expect(readUserSplit("Let's do roughly 50/50.", [SPEND], 2)).toEqual({ kind: 'not_derived' });
    expect(readUserSplit('Mostly into ads, a bit to features.', [SPEND], 2)).toEqual({ kind: 'not_derived' });
  });

  it('a share count that does not match the parts is not this split ("50/50" across three factors)', () => {
    expect(readUserSplit(C08, [SPEND], 3)).toEqual({ kind: 'not_derived' });
  });

  it('the "50/50 chance" idiom is a probability, not a split; no typed ratio at all is nothing', () => {
    expect(readUserSplit("It's a 50/50 chance it works.", [SPEND], 2)).toEqual({ kind: 'not_derived' });
    expect(readUserSplit('Add a third option.', [SPEND], 2)).toEqual({ kind: 'not_derived' });
  });
});
