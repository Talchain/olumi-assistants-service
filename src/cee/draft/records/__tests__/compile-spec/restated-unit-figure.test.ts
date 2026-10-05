/**
 * ⛔ CLASS QUESTION (DL, 5 Oct 2026, after the CHANGE-WORDED TARGET finding): does `canonicalQuantityUnits`
 * (quantity-evidence.ts, the stated-items loop) relabel ANY stated item — not only a goal — whose own unit differs from
 * the unit its quantity's declaring item states?
 *
 * Read at 3c613e40: yes. For every stated item with `quantity` naming ANOTHER item, a differing unit pushes
 * `unit_restated_conflict` AND (v-next, or an unbound legacy item) overwrites `item.unit` with the quantity's unit.
 * `unit_restated_conflict` is not a failed-evidence reason for the receipt, and the projector's own re-unit
 * (`referencedUnit`) keeps the overwritten unit, because a referenced item with no unit words is "bound". So a figure
 * "Costs rose 10% last year" on a £/month cost quantity would be stored as 10 £/month: the user's figure misstated.
 *
 * The rule these rows hold: a NON-goal stated figure whose own unit is not its quantity's is refused
 * (`unit_not_evidenced`) or asked, and its number is never stored in the quantity's £ unit. CONTRAST: a referencing
 * figure in the quantity's own unit keeps its number in that unit.
 *
 * Through the records compile chain the served constructor calls (`replayRecordSet`).
 */
import { describe, expect, it } from 'vitest';
import { replayRecordSet } from '../../replay.js';
import type { DraftRecordSet } from '../../grammar.js';

type Json = Record<string, any>;

const BRIEF = 'Our cloud costs are £45,000 a month. Costs rose 10% last year. Last year they were £41,000 a month. '
  + 'We want costs at most £40,000 a month. We could move to Azure or stay on AWS.';
const RESTATED = 1;
const SAME_UNIT = 2;
function records(): DraftRecordSet {
  return { stated_items: [
    { kind: 'figure', source_quote: 'Our cloud costs are £45,000 a month', value: 45000, value_literal: '£45,000', unit: '£/month',
      unit_literals: ['a month'], role: 'baseline', quantity: 0 },
    // The class under test: a figure REFERENCING the £ quantity, typed in its own unit, "%".
    { kind: 'figure', source_quote: 'Costs rose 10% last year', value: 10, value_literal: '10%', unit: '%', quantity: 0 },
    // CONTRAST: a figure referencing the same quantity in the quantity's own unit.
    { kind: 'figure', source_quote: 'Last year they were £41,000 a month', value: 41000, value_literal: '£41,000', unit: '£/month',
      unit_literals: ['a month'], role: 'context', quantity: 0 },
    { kind: 'goal', source_quote: 'We want costs at most £40,000 a month', value: 40000, value_literal: '£40,000', unit: '£/month',
      unit_literals: ['a month'], direction: 'ceiling', direction_literal: 'at most', role: 'target', quantity: 0, baseline_ref: 0 },
    { kind: 'option', source_quote: 'move to Azure' },
    { kind: 'option', source_quote: 'stay on AWS' },
  ], claims: [] } as DraftRecordSet;
}

/** Every object anywhere in `root` that pairs `value` (as value / raw_value / original_value) with a unit matching `unit`. */
function carriers(root: unknown, value: number, unit: RegExp): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Json;
    const unitHere = [o.unit, o.metadata?.unit].find((u) => typeof u === 'string');
    if ([o.value, o.raw_value, o.original_value].includes(value) && typeof unitHere === 'string' && unit.test(unitHere)) out.push(o);
    Object.values(o).forEach(walk);
  };
  walk(root);
  return out;
}

async function compile() {
  const out = await replayRecordSet(records(), { brief: BRIEF });
  if (!out.ok) throw new Error(`compile refused: ${out.reason} ${out.detail ?? ''}`);
  return out;
}

describe('CLASS: a non-goal figure in a unit that is not its quantity\'s is never stored in the quantity\'s unit', () => {
  it('"Costs rose 10% last year" on a £/month quantity: refused (unit_not_evidenced) or asked on its receipt', async () => {
    const out = await compile();
    const row = out.projection.stated_dispositions?.find((d) => d.stated_index === RESTATED) as Json | undefined;
    expect(row, 'receipt row').toBeDefined();
    const refusedOrAsked = row!.disposition === 'asked' || (row!.disposition === 'rejected' && row!.reason === 'unit_not_evidenced');
    expect(refusedOrAsked, JSON.stringify(row)).toBe(true);
    // The receipt keeps the user's own figure verbatim.
    expect(row!.stated_item).toMatchObject({ value: 10, unit: '%' });
  });
  it('no node, basis figure or disclosure stores the 10 in £ (projection AND the repaired graph)', async () => {
    const out = await compile();
    expect(carriers(out.projection.graph, 10, /£/)).toEqual([]);
    expect(carriers(out.graph, 10, /£/)).toEqual([]);
  });
  it('CONTRAST: the same-unit referencing figure keeps 41,000 in £/month', async () => {
    const out = await compile();
    expect(carriers(out.projection.graph, 41000, /£/).length).toBeGreaterThan(0);
    const row = out.projection.stated_dispositions?.find((d) => d.stated_index === SAME_UNIT) as Json | undefined;
    expect(row?.reason).not.toBe('unit_not_evidenced');
  });
});
