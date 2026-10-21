import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { hasGaps, structureGaps } from '../structure.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';

const orphan = { id: 'runway', label: 'Remaining cash runway', kind: 'factor' as const, estimate_by: null, value: null, low: null, high: null, unit: 'months', defined_as: null, limit: null,
  source: 'user' as const, party: null, quote: 'we will run out of money soon' };
const risk = (id: string, low: number | null, high: number | null, horizon: number | null) => ({ id, label: 'Supplier fails',
  occurrence: { estimate_by: null, low, high }, horizon_months: horizon, horizon_by: null, mitigations: [], source: 'user' as const, party: null, quote: 'our supplier may fail' });

describe('the draft structure check (structure only, never meaning)', () => {
  it('CONTRAST: complete models have no gaps (a status-quo option changes nothing and is never a gap)', () => {
    for (const m of [KNOWN_ANSWER, OPTION_EFFECTS]) expect(structureGaps(m)).toEqual({ goal_not_measurable: false, unreachable: [], risk_without_chance: [] });
  });

  it('a goal with no target is not measurable (the decision title as the goal)', () => {
    const m: LivingModelT = { ...KNOWN_ANSWER, aims: [{ ...KNOWN_ANSWER.aims[0]!, text: 'Accelerate it', target: null }] };
    expect(structureGaps(m).goal_not_measurable).toBe(true);
    expect(hasGaps(structureGaps(m))).toBe(true);
  });

  it('a factor, an option or a risk with no path to the goal is unreachable; a path through a definition or a setting reaches it', () => {
    const m: LivingModelT = { ...KNOWN_ANSWER, factors: [...KNOWN_ANSWER.factors, orphan],
      options: [...KNOWN_ANSWER.options, { id: 'cut', label: 'Cut spending', status: 'feasible', developed_from: null, source: 'olumi', party: null, quote: null,
        settings: [{ estimate_by: null, factor_id: 'runway', value: 9, low: null, high: null, unit: 'months', source: 'olumi', party: null, quote: null }] }] };
    expect(structureGaps(m).unreachable).toEqual(['runway', 'cut']);
    const linked: LivingModelT = { ...m, links: [...m.links, { id: 'runway_g', from: 'runway', to: 'g', source: 'olumi', party: null, quote: null,
      effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: 'units', sign: '+' } }] };
    expect(structureGaps(linked).unreachable, 'the link reaches the goal, and the option reaches it through its setting').toEqual([]);
    const part: LivingModelT = { ...m, factors: [{ ...KNOWN_ANSWER.factors[0]!, defined_as: { op: 'sum', of: ['runway'], source: 'user', party: null, quote: null } }, orphan] };
    expect(structureGaps(part).unreachable, 'a part of a definition on the goal path reaches it').toEqual([]);
  });

  it('a risk with no chance or window is reported (its chance is the person\'s to give)', () => {
    const linkFrom = (id: string) => ({ id: `${id}_g`, from: id, to: 'g', source: 'user' as const, party: null, quote: 'it would cost us 20 units',
      effect: { form: 'point' as const, estimate_by: null, value: 20, sd: null, low: null, high: null, unit: 'units', sign: '-' as const } });
    const m: LivingModelT = { ...KNOWN_ANSWER, risks: [risk('r1', null, null, null), risk('r2', 0.1, 0.2, 12)], links: [...KNOWN_ANSWER.links, linkFrom('r1'), linkFrom('r2')] };
    const g = structureGaps(m);
    expect(g).toEqual({ goal_not_measurable: false, unreachable: [], risk_without_chance: ['r1'] });
    expect(hasGaps(g)).toBe(true);
  });
});
