import { describe, expect, it } from 'vitest';
import { riskOccurrenceWindowFromToday, riskOccurrenceWindowMonths } from '../risk-occurrence.js';

// #3658 review r3: the window and the day it counts from come from ONE validated reading. Withholding the goal's chance
// deletes its threshold, not its reading; a stale or mismatched reading stays rejected by both readers.
type Rec = Record<string, unknown>;
const basis = (over: Rec = {}): Rec => ({ source: 'olumi_reading', quantity_frame: 'level', target_frame: 'level', target_raw: 100, reference: 'today',
  period_months: 3, period_kind: 'at_end', effect_unit: 'units', effects_at_period_end: false, ...over });
const goal = (over: Rec = {}): Rec => ({ id: 'g', kind: 'goal', label: 'Sales', goal_threshold_raw: 100, goal_threshold_frame: 'level', goal_threshold_unit: 'units', ...over });
const withheld = (over: Rec = {}): Rec => ({ id: 'g', kind: 'goal', label: 'Sales', goal_target_basis: basis(over) });
const read = (g: Rec) => ({ window: riskOccurrenceWindowMonths({ nodes: [g], edges: [] }), fromToday: riskOccurrenceWindowFromToday({ nodes: [g], edges: [] }) });

describe('the goal window and its reference come from one reading', () => {
  it('a withheld goal chance keeps its window, counted from the reading\'s own reference', () => {
    expect(read(withheld())).toEqual({ window: 3, fromToday: true });
    expect(read(withheld({ reference: 'launch' }))).toEqual({ window: 3, fromToday: false });
  });
  it('a stale or mismatched launch reading gives no window, and so is never read as counting from today', () => {
    expect(read(goal({ goal_threshold_raw: 150, goal_target_basis: basis({ reference: 'launch' }) }))).toEqual({ window: undefined, fromToday: false });
    expect(read(goal({ goal_target_basis: basis({ target_frame: 'change_rel', reference: 'launch' }) }))).toEqual({ window: undefined, fromToday: false });
    expect(read(goal({ goal_threshold_frame: 'change_rel', goal_target_basis: basis({ target_frame: 'change_rel', reference: 'launch' }) })))
      .toEqual({ window: undefined, fromToday: false });
  });
  it('contrast: a valid reading is unchanged; a reading with no period gives no window', () => {
    expect(read(goal({ goal_target_basis: basis() }))).toEqual({ window: 3, fromToday: true });
    expect(read(goal({ goal_target_basis: basis({ reference: 'launch' }) }))).toEqual({ window: 3, fromToday: false });
    expect(read(goal({ goal_target_basis: basis({ period_months: undefined }) }))).toEqual({ window: undefined, fromToday: false });
  });
});
