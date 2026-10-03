/**
 * ⭐ THE NESTED-QUOTE DEFECT, AND THE REASON THE SUITE COULD NOT SEE IT.
 *
 * Reported from the panel:
 *     The held change 'Add 'competitor price reaction'' has lapsed.
 *
 * ⛔ THE CORPUS BELOW COMES FROM THE PRODUCERS, NOT FROM MY HEAD (trap 22).
 * Every existing fixture reaching `buildHeldLapseNotice` uses a quote-free
 * label — 'Apply', 'Continue with this change', 'Widen the depot budget' — so
 * the defect was STRUCTURALLY INVISIBLE to the suite while the real producer
 * (`proposal-continuation.ts:1160`, `public_label: \`Add '${concept}'\``)
 * always emits the failing shape.
 */

import { describe, expect, it } from 'vitest';
import { carriesDelimitingQuote, quoteLabel } from '../quote-label.js';

/** Shapes the real producers emit. */
const PRODUCER_LABELS = [
  // proposal-continuation.ts:1160 — ALWAYS carries its own quotes
  "Add 'competitor price reaction'",
  "Add 'Partner with a local distributor'",
  // commit.test.ts / chip-click fixtures — never carried any
  'Continue with this change',
  'Widen the depot budget',
  'Apply',
] as const;

describe('a label is never wrapped twice', () => {
  it('the reported case loses its outer pair', () => {
    expect(quoteLabel("Add 'competitor price reaction'"))
      .toBe("Add 'competitor price reaction'");
  });

  it('the full sentence no longer nests', () => {
    const label = "Add 'competitor price reaction'";
    const sentence = `The held change ${quoteLabel(label)} has lapsed, say the word if you still want it.`;
    expect(sentence).toBe(
      "The held change Add 'competitor price reaction' has lapsed, say the word if you still want it.",
    );
    expect(sentence).not.toContain("''");
  });

  it.each(PRODUCER_LABELS)('%s never yields a doubled quote', (label) => {
    expect(quoteLabel(label)).not.toContain("''");
  });
});

describe('a quote-free label is unchanged from today — every existing spec stays green', () => {
  it.each(['Continue with this change', 'Widen the depot budget', 'Apply'])(
    '%s still gets its outer pair',
    (label) => {
      expect(quoteLabel(label)).toBe(`'${label}'`);
    },
  );

  it('the sentence pinned by commit.test.ts is byte-identical', () => {
    expect(
      `The held change ${quoteLabel('Continue with this change')} has lapsed`,
    ).toBe("The held change 'Continue with this change' has lapsed");
  });
});

/**
 * ⚠ THE OPPOSITE-DIRECTION TWIN (trap 22b). A predicate guarding two opposite
 * harms needs both pinned. Stripping quotes too eagerly loses the boundary
 * marker that tells a reader where the label ends — as bad as nesting.
 */
describe('an interior apostrophe is not a delimiter', () => {
  it.each([
    "the user's plan",
    "next quarter's budget",
    "the depot's capacity",
  ])('%s KEEPS its outer pair', (label) => {
    expect(carriesDelimitingQuote(label)).toBe(false);
    expect(quoteLabel(label)).toBe(`'${label}'`);
  });

  it.each([
    "Add 'competitor price reaction'",
    "change 'price' to 0.8",
    "'leading'",
  ])('%s is recognised as already delimited', (label) => {
    expect(carriesDelimitingQuote(label)).toBe(true);
  });

  // The hard case: BOTH an apostrophe and a delimiting quote. The delimiter wins,
  // because adding an outer pair would still nest.
  it("a label with both an apostrophe and a quote is treated as delimited", () => {
    const label = "Add 'the user's plan'";
    expect(carriesDelimitingQuote(label)).toBe(true);
    expect(quoteLabel(label)).toBe(label);
  });
});

describe('degenerate inputs', () => {
  it('trims before deciding', () => {
    expect(quoteLabel('  Apply  ')).toBe("'Apply'");
  });
  it('an empty or whitespace label yields empty, never a bare pair', () => {
    expect(quoteLabel('')).toBe('');
    expect(quoteLabel('   ')).toBe('');
  });
});
