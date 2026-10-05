/** SYNTHETIC brief + main records + pass records for the sentence-pass rows. Written for these rows; not a test brief. */
import { buildSentenceInventory, type SentencePassRecord } from '../../sentence-pass.js';
import type { DraftRecordSet } from '../../grammar.js';

export const SYN = 'Our cafe takes £6,000 each week at £3 a cup with 2 baristas. We could hire 1 more barista or keep the team as it is. '
  + 'Our goal is to reach at least £7,500 each week within 6 months. Each extra barista adds about £450 each week. '
  + 'Changing the price of a cup will not change what we take.';

/** The main call's records, as a drafter that left three links open would type them. */
export function synMain(): DraftRecordSet {
  return JSON.parse(JSON.stringify({ stated_items: [
    /* 0 */ { kind: 'goal', source_quote: 'reach at least £7,500 each week within 6 months', value: 7500, value_literal: '£7,500', unit: '£/week',
      unit_literals: ['each week'], quantity: 1, baseline_ref: 1, role: 'target', direction: 'unresolved', direction_literal: 'unresolved' },
    /* 1 */ { kind: 'figure', source_quote: 'Our cafe takes £6,000 each week', value: 6000, value_literal: '£6,000', unit: '£/week',
      unit_literals: ['each week'], quantity: 1, role: 'baseline' },
    /* 2 */ { kind: 'figure', source_quote: 'with 2 baristas', value: 2, value_literal: '2', unit: 'baristas', unit_literals: ['baristas'], quantity: 2, role: 'baseline' },
    /* 3 */ { kind: 'option', source_quote: 'hire 1 more barista', value: 1, value_literal: '1', quantity: 2, setting: 'change_by' },
    /* 4 */ { kind: 'option', source_quote: 'keep the team as it is', is_baseline: true },
    /* 5 */ { kind: 'cause', source_quote: 'Each extra barista adds about £450 each week.', relationship: 'unresolved' },
    /* 6 */ { kind: 'cause', source_quote: 'Changing the price of a cup will not change what we take.', relationship: 'unresolved' },
  ], claims: [] })) as DraftRecordSet;
}

export const inventory = buildSentenceInventory(SYN);
/** Test-side lookup of an inventory id by its literal (the pass itself only ever sees ids). */
export const F = (literal: string): number => {
  const hits = inventory.figures.filter((f) => f.literal === literal);
  if (hits.length !== 1) throw new Error(`fixture: figure ${literal} x${hits.length}`);
  return hits[0]!.id;
};
export const S = (fragment: string): number => inventory.sentences.find((s) => s.text.includes(fragment))!.id;

/** The pass, typed from the synthetic brief by hand. */
export function synPass(): SentencePassRecord[] {
  return [
    { sentence: S('Our goal'), role: 'goal', figure: F('£7,500'), direction: 'floor', direction_literal: 'at least', baseline_figure: F('£6,000') },
    { sentence: S('Each extra barista'), role: 'cause', relationship: {
      from_figure: F('2'), to_figure: F('£6,000'), per_source_change: 1, per_source_literal: 'Each extra barista', amount: 450, amount_literal: '£450' } },
    { sentence: S('Changing the price'), role: 'cause', relationship: { from_figure: F('£3'), to_figure: F('£6,000'), no_effect_literal: 'will not change' } },
    { sentence: S('Our cafe'), role: 'figure', figure: F('£3'), value: 3, value_literal: '£3', unit: '£/cup', unit_literals: ['a cup'], quantity_of: F('£3') },
  ];
}
