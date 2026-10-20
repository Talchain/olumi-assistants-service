import { describe, expect, it } from 'vitest';
import { isSwitch, naturalEffectOf, statementWords, type MagnitudeNode } from '../link-effect.js';

const target: MagnitudeNode = { label: 'Capacity', kind: 'factor', scale_frame: 100,
  observed_state: { value: 0, raw_value: 0, unit: 'tickets per week' }, option_levels: [] };
const source = (unit?: string, levels: number[] = [0, 1]): MagnitudeNode => ({ label: 'Driver', kind: 'factor',
  observed_state: { value: 0, raw_value: 0, unit }, option_levels: levels });

describe('L24: a count at 0/1 remains a count; a switch remains a switch', () => {
  it.each(['specialists', 'people', 'vans', 'packers'])('%s keeps its quantity and rate, independent of another switch', unit => {
    const count = source(unit);
    expect(isSwitch(count, 1)).toBe(false);
    expect(naturalEffectOf(0.2, count, target, 1)).toMatchObject({ amount: 20, per_source_change: 1,
      per_source_change_unit: unit === 'people' ? 'people' : unit.slice(0, -1) });
    expect(statementWords(20, 1, count, target, 1, 100)).toBe(
      `raising "Driver" by 1 ${unit === 'people' ? 'people' : unit.slice(0, -1)} raises "Capacity" by 20 tickets per week`);
    expect(isSwitch(source('on/off'), 1)).toBe(true);
  });
  it.each([undefined, '', 'on/off', '0/1', 'yes/no', 'boolean', 'binary (0/1)', 'release status (0/1)', 'release status (0=not released; 1=released)'])('genuine switch %s stays byte-exact', unit => {
    const s = source(unit);
    expect(isSwitch(s, 1)).toBe(true);
    expect(naturalEffectOf(0.2, s, target, 1)).toEqual({ amount: 20, amount_unit: 'tickets per week',
      per_source_change: 1, per_source_change_unit: 'switch', strength_mean: 0.2, strength_mean_frame: 'edge_strength' });
    expect(statementWords(20, 1, s, target, 1, 100)).toBe('switching on "Driver" raises "Capacity" by 20 tickets per week');
  });
  it('a multi-unit change retains its stated denominator and exact natural amount', () => {
    expect(naturalEffectOf(0.2, source('specialists'), target, 2)).toEqual({ amount: 40, amount_unit: 'tickets per week',
      per_source_change: 2, per_source_change_unit: 'specialists', strength_mean: 0.2, strength_mean_frame: 'edge_strength' });
  });
  it('a fractional option and a non-unit frame remain non-switches even with a binary unit', () => {
    expect(isSwitch(source('on/off', [0, 0.5, 1]), 1)).toBe(false);
    expect(isSwitch(source('on/off'), 2)).toBe(false);
  });
});
