/**
 * NATURAL-UNIT EDITS ON A RATE FACTOR — "change hiring cost to £62 per month".
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * 21% of the 300 most recently-updated live boards (22 Sep 2026) hold at least
 * one rate-shaped factor unit — 59 of them `£/month`. A user editing such a
 * factor in the words they would naturally use was REFUSED:
 *
 *   "This factor uses £/month; the value provided is in £."
 *
 * Executed at `bd35cc9e`, the whole chain: `extractQuantities` returns unit
 * `GBP` for "£62 per month", "£62/month", "£62 a month" AND for a bare "£62" —
 * BYTE-IDENTICAL results. The denominator is not in the extractor's unit
 * vocabulary, and it is not recoverable downstream either: `raw_text` is
 * truncated at the amount. Only the original message still holds it.
 *
 * ⛔ THE GATE WAS NOT THE DEFECT AND MUST NOT BE LOOSENED. Given `£` against a
 *    stored `£/month`, refusing is correct. `unitComparisonKey`'s own docblock
 *    forbids widening it to strip punctuation or match prefixes, and that
 *    warning is right: `£/month` vs `£/day` is a real rescale, not a spelling.
 *
 * So the fix carries what the user actually wrote, and folds SPELLINGS only.
 *
 * ── THE FALSE POSITIVE THIS SUITE EXISTS TO PREVENT ────────────────────────
 * Seven live nodes are stored as `£ ARR per customer`. In "change ARR per
 * customer to £480" the `per` belongs to the FACTOR LABEL, not to the amount.
 * A reader that scanned the sentence for `per <noun>` would invent `/customer`
 * on a plain £480. The denominator must IMMEDIATELY follow the amount.
 */

import { describe, it, expect } from 'vitest';

import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import { mapCqeQuantityToProposalValue } from '../deterministic-value-update.js';
import {
  evaluateFactorValueProposal,
  unitComparisonKey,
} from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { classifyUnitScaleClass } from '../../../cee/draft/records/unit-scale-class.js';

/** The one quantity the message carries, mapped exactly as production maps it. */
function proposalUnitFor(message: string): string | undefined {
  const quantities = extractQuantities(message);
  expect(quantities.length).toBe(1);
  return mapCqeQuantityToProposalValue(quantities[0]!, message).unit;
}

describe('the rate denominator survives into the proposal', () => {
  it.each([
    ['change hiring cost to £62 per month', '£/month'],
    ['change hiring cost to £62/month', '£/month'],
    ['set hiring cost to £62 a month', '£/month'],
    ['increase hiring cost by £10 per month', '£/month'],
    ['change the licence to £900 per year', '£/year'],
  ])('%s → %s', (message, expected) => {
    expect(proposalUnitFor(message)).toBe(expected);
  });

  it('CONTROL — a bare amount invents no denominator', () => {
    // Without this the suite would pass on a mutant that appends '/month' to
    // every currency amount.
    expect(proposalUnitFor('change hiring cost to £62')).toBe('£');
  });

  it('FALSE-POSITIVE CONTROL — a "per" inside the FACTOR LABEL is not a denominator', () => {
    // `£ ARR per customer` is a real live unit on 7 nodes. The amount here is a
    // plain £480 and must stay one.
    //
    // ⚠ THIS CONTROL ALONE IS NOT LOAD-BEARING FOR THE ANCHOR, and saying so
    //   here is the point: a mutant that replaced the anchored read with a
    //   whole-message scan SURVIVED it, because `customer` is not in the closed
    //   period list and the list caught what the anchor was supposed to. The
    //   two controls below fail that mutant; they are why the anchor is tested
    //   rather than merely asserted.
    expect(proposalUnitFor('change ARR per customer to £480')).toBe('£');
  });

  it('ANCHOR CONTROL — a period BEFORE the amount is not this amount\'s denominator', () => {
    // "each year" is the review cadence, not the cost's rate. A sentence-wide
    // scan for `per|a|an|each <period>` would attach `/year` to £62.
    expect(proposalUnitFor('each year we redo this, so change hiring cost to £62')).toBe('£');
  });

  it('ANCHOR CONTROL — a period AFTER other words is not this amount\'s denominator', () => {
    // The denominator must be the NEXT thing after the amount, not merely
    // somewhere downstream of it.
    expect(proposalUnitFor('change hiring cost to £62, and we pay per month')).toBe('£');
  });

  it('CONTROL — a unitless amount stays unitless', () => {
    expect(proposalUnitFor('change contacts to 30 per week')).toBeUndefined();
  });

  it('CONTROL — carrying the denominator changes no SCALE verdict', () => {
    // Unit IDENTITY and unit SCALE are different questions (the evaluator's
    // docblock says so). This pins that the richer unit is still classified
    // exactly as the bare currency was, so no normalisation moves.
    expect(classifyUnitScaleClass('£/month')).toBe(classifyUnitScaleClass('£'));
    expect(classifyUnitScaleClass('£/year')).toBe(classifyUnitScaleClass('£'));
  });
});

describe('the real gate now accepts the edit it used to refuse', () => {
  const evaluateFor = (message: string, factorUnit: string) => {
    const unit = proposalUnitFor(message);
    const quantities = extractQuantities(message);
    const { value } = mapCqeQuantityToProposalValue(quantities[0]!, message);
    return evaluateFactorValueProposal({
      rawInput: value,
      operator: 'set',
      ...(unit !== undefined ? { unit } : {}),
      factorUnit,
      factorExistingRaw: 50,
      factorObservedRawValue: 50,
      inputHasUnit: unit !== undefined && unit.length > 0,
    });
  };

  it('accepts "£62 per month" against a £/month factor', () => {
    const verdict = evaluateFor('change hiring cost to £62 per month', '£/month');
    expect(verdict.ok).toBe(true);
  });

  it('CONTRAST — still refuses a genuinely different rate', () => {
    // The whole point of not loosening the gate. £/day is a 30x rescale.
    const verdict = evaluateFor('change hiring cost to £62 per day', '£/month');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('unit_mismatch');
  });

  it('CONTRAST — still refuses a bare amount against a rate factor', () => {
    const verdict = evaluateFor('change hiring cost to £62', '£/month');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('unit_mismatch');
  });
});

describe('unitComparisonKey folds SPELLINGS of one rate, and nothing else', () => {
  const same = (a: string, b: string) => unitComparisonKey(a) === unitComparisonKey(b);

  it('equates the separator spellings', () => {
    expect(same('£ per month', '£/month')).toBe(true);
    expect(same('£ / month', '£/month')).toBe(true);
    expect(same('contacts per week', 'contacts/week')).toBe(true);
  });

  it('equates the currency alphabet inside a rate', () => {
    expect(same('GBP/month', '£/month')).toBe(true);
    expect(same('USD per year', '$/year')).toBe(true);
  });

  it('equates singular and plural periods', () => {
    expect(same('£ per month', '£/months')).toBe(true);
  });

  it('PINS THE NON-EQUIVALENCES — a rescale is never a spelling', () => {
    expect(same('£/month', '£/day')).toBe(false);
    expect(same('£/month', '£/year')).toBe(false);
    expect(same('£', '£/month')).toBe(false);
    expect(same('£/month', '$/month')).toBe(false);
    expect(same('months', 'weeks')).toBe(false);
    expect(same('%', 'pp')).toBe(false);
    // The existing case-fold must survive untouched.
    expect(same('Months', 'months')).toBe(true);
  });
});
