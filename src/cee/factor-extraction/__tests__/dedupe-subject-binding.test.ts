/**
 * ⭐⭐⭐ A NUMBER SHARED BY TWO DIFFERENTLY-NAMED QUANTITIES IS NOT A DUPLICATE.
 *
 * MEASURED ON THE WIRE (Render `srv-d4slpaili9vc73eiq4og`, 17 Sep 2026,
 * recurring at 17:58:34Z and 18:00:34Z on a pricing brief):
 *
 *   keptLabel:"Churn Rate"   keptValue:59   supersededLabel:"Churn Rate"  supersededValue:54
 *     event:"cee.factor_extraction.dedupe_superseded"
 *   skippedLabel:"Churn Rate" skippedValue:49  event:"cee.factor_extraction.dedupe_within_extraction"
 *   skippedLabel:"Plan Price" skippedValue:59  event:"cee.factor_extraction.dedupe_within_extraction"
 *
 * 49, 54 and 59 are the PRICES in that brief. TWO separate defects produced
 * that log, and only ONE of them is repaired here:
 *
 *  (1) AT EXTRACTION — `inferLabel` (index.ts) reads a 50-character lookbehind
 *      for a context word, so a churn sentence sitting within 50 characters of a
 *      price binds the price to "Churn Rate". ⛔ DELIBERATELY NOT FIXED. Fixing
 *      it means inferring a number's subject from prose, and this estate has a
 *      recorded burn history on exactly that (CLAUDE.md trap 22f: four rounds of
 *      oscillation on one natural-language predicate, each round closing one
 *      direction and reopening the other). A fifth rule is the forbidden move.
 *
 *  (2) AT DEDUPE — `qualifyExtractedFactors` collided two factors whose ONLY
 *      relation was a shared number, and then kept the wrong one. This is the
 *      defect repaired, and the reason it matters more than a mislabel: it does
 *      not merely misname a figure, it DELETES the correctly-named factor to
 *      keep the incorrect one. A required-fields guard then sees a factor
 *      carrying a value and calls the graph healthy — "more fields populated"
 *      is the wrong success metric; "correctly bound" is the right one.
 *
 * THE DERIVED MECHANISM. The collision predicate was
 *     unitsCompatible(a.unit, b.unit) && ( |a.value − b.value| ≤ |a.value|·0.1
 *                                          || labelsMatch(a.label, b.label) )
 * — a DISJUNCTION whose value limb carried no label condition whatsoever. So
 * {Churn Rate, 59} and {Plan Price, 59} collided on the number alone, and with
 * both at the same inferred confidence the incumbent won on push order.
 *
 * THE REPAIR, and it guesses at no prose. The value limb now applies only when
 * at least one side NAMED NO SUBJECT — `isUnidentifiedQuantityLabel`, true
 * exactly when `inferLabel` found no context word and fell back to naming the
 * quantity's shape ("Value" / "Rate" / "Factor"). That is the extractor's own
 * record of a failure to identify, not a reading of English. When both sides
 * name a subject, the labels decide; when either named nothing, proximity is
 * still the best available reading and the limb is unchanged.
 *
 * ⚠ OPPOSITE-DIRECTION TWINS ARE MANDATORY HERE. Dedupe exists for a reason,
 * and this estate's recorded pattern is that a fix in one direction reopens the
 * other (CLAUDE.md trap 22b). Every case below is paired: the DEFECT block
 * proves the correct factor survives, and the TWIN block proves genuine
 * duplicates still collapse — including ROADMAP 2.299's {Factor, 6M} vs
 * {Target, 6M}, which collapses ONLY through the value limb and is therefore
 * the case a careless narrowing would break.
 *
 * Brief shapes are taken from the real captured pricing brief
 * (`output/core-overnight-20260914/switch/results/v201-pricing/attempts.json`:
 * "…keeping monthly churn under 4%, should we increase the Pro plan price from
 * £49 to £59 per month…"), not invented to match the fix.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import {
  UNIDENTIFIED_QUANTITY_LABELS,
  extractFactors,
  isUnidentifiedQuantityLabel,
} from '../index.js';
import type { GraphT } from '../../../schemas/graph.js';

function freshGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'MRR Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

/** label → the raw figure the enriched graph recorded against it. */
async function factorFigures(brief: string): Promise<Map<string, number | undefined>> {
  const out = await enrichGraphWithFactorsAsync(freshGraph(), brief);
  const figures = new Map<string, number | undefined>();
  for (const node of out.graph.nodes.filter((n) => n.kind === 'factor')) {
    const data = node.data as { value?: number; raw_value?: number } | undefined;
    figures.set(String(node.label), data?.raw_value ?? data?.value);
  }
  return figures;
}

/**
 * The wire brief's shape: a churn sentence, then a from-to price move whose
 * lookbehind reaches back into it, then the plan's own price.
 *
 * Extraction at this tip (asserted in-test below, so the case cannot decay into
 * a tautology if `inferLabel` moves):
 *   {Churn Rate, 51.5, range, 0.80} {Churn Rate, 54, explicit, 0.95}
 *   {Churn Rate, 49, inferred, 0.60} {Plan Price, 59, inferred, 0.60}
 *   {Churn Rate, 0.04, %, 0.60}
 * 54 and 59 are 5 apart — inside the 10% window of 54 — so on the pristine tip
 * {Plan Price, 59} collided with the churn-bound 54 and was skipped.
 */
const WIRE_BRIEF =
  'Our monthly churn is running at 4%. Churn-linked seats move from £49 to £54 per month. The Pro plan is currently £59.';

/** The same shape carrying all three prices, closest to the logged triple. */
const WIRE_BRIEF_TRIPLE =
  'Our monthly churn is running at 4%. Churn-linked seats move from £54 to £59 per month, with £49 still on legacy. The Pro plan is currently £59.';

/** A bare currency figure (no context word ⇒ "Value") then the plan's own price, equal. */
const UNNAMED_THEN_NAMED =
  'We looked at £59 across the board last quarter. The Pro plan would move to £59.';

describe('DEFECT — a correctly-labelled factor is not discarded because a wrongly-labelled one claimed its number first', () => {
  it('PRECONDITION — the wire brief really does mis-bind the prices to churn and offer a rival "Plan Price"', () => {
    // ⚠ PINS ITS OWN PRECONDITION (CLAUDE.md trap 13b). Without this, a change
    // to `inferLabel` could make the case below pass because the collision
    // stopped happening rather than because the survivor changed.
    const extracted = extractFactors(WIRE_BRIEF);
    const churnBound = extracted.filter((f) => f.label === 'Churn Rate' && f.unit === '£');
    expect(churnBound.map((f) => f.value).sort((a, b) => Number(a) - Number(b))).toEqual([49, 51.5, 54]);

    const planPrice = extracted.find((f) => f.label === 'Plan Price');
    expect(planPrice).toBeDefined();
    expect(planPrice?.value).toBe(59);
    expect(planPrice?.unit).toBe('£');

    // The collision is real: 59 is inside the 10% window of the churn-bound 54,
    // the units are compatible, and the labels do NOT match. Value alone is
    // the only thing relating them.
    expect(Math.abs(54 - 59)).toBeLessThanOrEqual(Math.abs(54 * 0.1));
    // Neither side is a fallback label — both name a subject.
    expect(isUnidentifiedQuantityLabel('Churn Rate')).toBe(false);
    expect(isUnidentifiedQuantityLabel('Plan Price')).toBe(false);
  });

  it('the plan price survives beside the churn factor (pristine keeps only the churn factor)', async () => {
    //   pristine  → Map { 'Churn Rate' => 49 }                       Plan Price DELETED
    //   post-fix  → Map { 'Churn Rate' => 49, 'Plan Price' => 59 }
    const figures = await factorFigures(WIRE_BRIEF);
    expect(figures.get('Plan Price')).toBe(59);
    expect([...figures.keys()]).toContain('Churn Rate');
  });

  it('the three-price wire shape also keeps the plan price', async () => {
    //   pristine  → Map { 'Churn Rate' => 54, 'Value' => 49 }        Plan Price DELETED
    //   post-fix  → Map { 'Churn Rate' => 54, 'Value' => 49, 'Plan Price' => 59 }
    const figures = await factorFigures(WIRE_BRIEF_TRIPLE);
    expect(figures.get('Plan Price')).toBe(59);
  });

  it('when an UNNAMED figure and a NAMED one collide, the named one wins — and they still collapse to ONE factor', async () => {
    //   pristine  → Map { 'Value' => 59 }        the fallback label won on push order
    //   post-fix  → Map { 'Plan Price' => 59 }
    // ⭐ The count assertion is the load-bearing half: this is a genuine
    // collision on one figure, so the repair must change WHICH survives without
    // stopping the collapse.
    const figures = await factorFigures(UNNAMED_THEN_NAMED);
    expect([...figures.keys()]).toEqual(['Plan Price']);
    expect(figures.get('Plan Price')).toBe(59);
  });
});

describe('TWIN — genuine duplicates still collapse (a fix that stops deduping is the regression)', () => {
  it('ROADMAP 2.299 — {Factor, 6M} and the stated {Target, 6M} still collide and the Target still mints the goal threshold', async () => {
    // ⭐⭐ THE CASE A CARELESS NARROWING BREAKS. These two labels do NOT match;
    // they collide ONLY through the value limb. The limb survives here because
    // "Factor" is a fallback label — the extractor itself recorded that it
    // could not identify the subject.
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Output ranges between 5500000 and 6500000 most years; our target is 6000000.',
    );
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>;
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_raw).toBe(6_000_000);
    // ...and the superseded range is not ALSO injected beside it.
    expect(out.graph.nodes.filter((n) => n.kind === 'factor')).toHaveLength(0);
    expect(out.factorsAdded).toBe(0);
  });

  it('ROADMAP 2.299 — {Factor, 6M} and {Revenue, 6M} still collapse to the better-labelled Revenue', async () => {
    const figures = await factorFigures(
      'Output ranges between 5500000 and 6500000 most years; revenue is 6000000.',
    );
    expect([...figures.keys()]).toEqual(['Revenue']);
    expect(figures.get('Revenue')).toBe(6_000_000);
  });

  it('two SYNONYM subjects at the same figure still collapse to one factor', async () => {
    // "Price"/"Cost" both name a subject, so the value limb no longer applies —
    // the LABEL limb (SYNONYM_GROUPS) is what collapses them, and it must.
    const figures = await factorFigures(
      'The unit price is £120 per seat. That unit cost of £120 has not moved this year.',
    );
    expect(figures.size).toBe(1);
    expect(figures.get('Price')).toBe(120);
  });

  it('the SAME subject stated twice at different figures still collapses to one factor', async () => {
    const figures = await factorFigures(
      'Our monthly churn is running at 4%. Churn-linked seats move from £49 to £54 per month.',
    );
    // One churn-labelled money factor, not three.
    expect([...figures.keys()].filter((k) => k === 'Churn Rate')).toHaveLength(1);
  });
});

describe('VOCABULARY — the fallback list is the producer\'s own, and fails loud on drift', () => {
  it('every fallback label is REACHED by a real brief and is recognised as unidentified', () => {
    // ⚠ A derived guard proves agreement, never completeness (CLAUDE.md trap
    // 12d). This drives `inferLabel` through `extractFactors` for each fallback
    // branch, so the constant is checked against what the function EMITS.
    const reached = new Map<string, string>([
      ['percentage', 'It moved by 12% last quarter.'],
      ['currency', 'We set aside £4200 last quarter.'],
      ['bare', 'Output ranges between 5500000 and 6500000 most years.'],
    ]);
    for (const [branch, brief] of reached) {
      const labels = extractFactors(brief).map((f) => f.label);
      const expected = UNIDENTIFIED_QUANTITY_LABELS[branch as keyof typeof UNIDENTIFIED_QUANTITY_LABELS];
      expect(labels, `${branch} branch of inferLabel`).toContain(expected);
      expect(isUnidentifiedQuantityLabel(expected)).toBe(true);
    }
  });

  it('the vocabulary has exactly three members — adding or removing one must be a deliberate act', () => {
    expect(Object.values(UNIDENTIFIED_QUANTITY_LABELS).sort()).toEqual(['Factor', 'Rate', 'Value']);
  });

  it('a label that NAMES a subject is never treated as a fallback', () => {
    for (const named of ['Plan Price', 'Churn Rate', 'Revenue', 'Target', 'Subscription Price']) {
      expect(isUnidentifiedQuantityLabel(named), named).toBe(false);
    }
    // Case and padding are normalised, so a fallback cannot sneak past as "  value ".
    expect(isUnidentifiedQuantityLabel('  value ')).toBe(true);
  });
});
