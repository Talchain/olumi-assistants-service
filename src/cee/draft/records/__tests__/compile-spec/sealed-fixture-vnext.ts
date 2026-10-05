import type { DraftRecordSet, DraftStatedItem } from '../../grammar.js';
import { BRIEF, sealedRecords } from './sealed-fixture.js';
export { BRIEF };

/** Hand-typed v-next delta. The sealed arithmetic oracle remains unchanged. */
export function sealedRecordsVNext(): DraftRecordSet {
  const legacy = sealedRecords();
  const items: DraftStatedItem[] = legacy.stated_items.slice(0, 15).map(item => {
    const { value_span, unit_span, direction_span, range, relationship, ...rest } = item;
    return { ...rest,
      ...(value_span ? { value_literal: item.source_quote.slice(value_span.start, value_span.end) } : {}),
      ...(unit_span ? { unit_literals: [item.source_quote.slice(unit_span.start, unit_span.end)] } : {}),
      ...(direction_span ? { direction_literal: item.source_quote.slice(direction_span.start, direction_span.end) } : {}),
      ...(range ? { range: { low: range.low, high: range.high, meaning: range.meaning, low_literal: String(range.low), high_literal: String(range.high) } } : {}),
      ...(relationship ? { relationship: { from_quantity: relationship.from_quantity === 8 ? 3 : relationship.from_quantity,
        to_quantity: relationship.to_quantity, amount: relationship.amount,
        amount_literal: item.source_quote.slice(relationship.amount_span!.start, relationship.amount_span!.end),
        per_source_change: relationship.from_quantity === 8 ? 0.01 : 1,
        per_source_literal: item.source_quote.slice(relationship.source_span!.start, relationship.source_span!.end) } } : {}),
    };
  });
  items[1]!.value_literal='400';items[1]!.unit_literals=['customers'];
  items[2]!.value_literal='£300';items[2]!.unit_literals=['a month'];
  items[3] = { ...items[3]!, quantity: 3, value: 0.1, value_scale: 'unit_interval', value_literal: '10%', unit_literals: [] };
  items[0]!.unit_literals = ['monthly'];
  delete items[6]!.unit; delete items[6]!.baseline; delete items[6]!.unit_literals;
  delete items[8]!.unit; delete items[8]!.quantity;
  items[9]!.unit_literals = ['customers']; items[9]!.value_literal = 'about 2';
  items[9]!.relationship!.range = { low: 1, high: 4, low_literal: 'between 1', high_literal: '4' };
  delete items[9]!.range;
  items[11]!.unit_literals = ['subscribers']; items[11]!.value_literal = 'about 150';
  items[13]!.unit_literals = ['a month'];
  items[13]!.value_literal = '£6';
  const claims: DraftRecordSet["claims"] = legacy.claims.slice(0,5).map(c => ({ ...c, quantity: c.quantity === 8 ? 3 : c.quantity }));
  claims.push({ ...legacy.claims[10]! });
  claims.push({ ...legacy.claims[11]!, sets_to: undefined, basis: undefined, unit: undefined, value_scale: undefined });
  claims.push(...legacy.claims.slice(12).map(c => ({ ...c, ...(c.range ? { range: { low: c.range.low, high: c.range.high, meaning: c.range.meaning, low_literal: '80', high_literal: '250' } } : {}) })));
  // No repeated units or claim-side natural effects in the v-next wire.
  for (const c of claims) if (c.quantity !== undefined) { delete c.unit; delete c.value_scale; }
  // Optional fields are omitted on the wire, never own properties with undefined values.
  return JSON.parse(JSON.stringify({ stated_items: items, claims })) as DraftRecordSet;
}
