/**
 * A FACTOR'S FRAME HOLDS EVERY EFFECT STATED INTO IT (DL 22 Oct; served bf9ccf15). "Volunteers signed up" was 12 today, so its
 * frame was 15, while the person's options add 18 and 25 volunteers: sent as 1.2 and 1.67. PLoT clamps a coefficient to
 * [-1, 1] (`graph-normaliser.ts`) and, for a person's own size on the goal's path, withholds every figure (`clampedEffects`),
 * so nothing was shown and the implied quantity's read came back empty (`engine_read_incomplete`). SYNTHETIC wording, the
 * served figures; the real mapper. Expectations by hand: every sized link reaches the engine at |coefficient| <= 1 and reads
 * back as the person's own size in their units.
 */
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';
import { supplier } from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const adds = (id: string, from: string, to: string, value: number, unit: string): LivingModelT['links'][number] =>
  ({ id, from, to, ...who(`${from} adds ${value}`), effect: { estimate_by: null, form: 'point', value, sd: null, low: null, high: null, unit, sign: '+' } });
const option = (id: string): LivingModelT['options'][number] =>
  ({ status: 'feasible', id, label: id, settings: [], developed_from: null, ...who(`or ${id}`) });
/** The served shape: an aim with no figure, volunteers 12 today, three options each adding volunteers (+18, +25, +10). */
const festival = (): LivingModelT => ({
  aims: [{ id: 'ready', text: 'Festival ready to open', status: 'current', defined_as: null, ...who('ready to open within 6 weeks'), target: null }],
  options: ['social', 'schools', 'flyers', 'keep'].map(option),
  factors: [{ id: 'volunteers', label: 'Volunteers signed up', kind: 'factor', estimate_by: null, value: 12, low: null, high: null, unit: 'volunteers',
    defined_as: null, limit: null, ...who('12 volunteers so far') }],
  links: [adds('social_v', 'social', 'volunteers', 18, 'volunteers'), adds('schools_v', 'schools', 'volunteers', 25, 'volunteers'),
    adds('flyers_v', 'flyers', 'volunteers', 10, 'volunteers'),
    { id: 'v_ready', from: 'volunteers', to: 'ready', ...who('more volunteers make it readier'),
      effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
const capOf = (g: Rec, id: string) => ((g.nodes as Rec[]).find((n) => n.id === id)!.observed_state as Rec).cap as number;
const edge = (g: Rec, from: string, to: string) => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;

describe('a factor\'s frame holds every effect stated into it, so no stated size is clamped', () => {
  it('the served shape: every link into volunteers reaches the engine at most 1, and reads back as the person\'s own size', () => {
    const g = mapLivingModel(festival()).graph as Rec;
    const v = capOf(g, 'volunteers');
    expect(v, 'widened to hold +25 (capFor on 25: 25 × 1.25)').toBe(31.25);
    for (const [option, size] of [['social', 18], ['schools', 25], ['flyers', 10]] as const) {
      const e = edge(g, `${option}__on`, 'volunteers');
      expect(Math.abs(e.strength.mean), option).toBeLessThanOrEqual(1);
      // Natural units: coefficient × this frame ÷ the switch's frame (0 to 1) = volunteers added.
      expect(e.strength.mean * v / capOf(g, `${option}__on`), option).toBeCloseTo(size, 9);
      expect(e.defaulted, option).toBeUndefined();
    }
    // Today's level is the same figure on the wider frame.
    expect((g.nodes as Rec[]).find((n) => n.id === 'volunteers')!.observed_state).toMatchObject({ raw_value: 12, value: 12 / 31.25 });
  });

  it('PLoT\'s cut rule (|mean| > 1) is tripped by no edge, while the mapper before this sent 1.2 and 1.67', () => {
    const g = mapLivingModel(festival()).graph as Rec;
    expect((g.edges as Rec[]).filter((e) => typeof e.strength?.mean === 'number' && Math.abs(e.strength.mean) > 1)).toEqual([]);
  });

  it('causes first: a widened cause widens what it drives, so a chain of stated sizes all fit', () => {
    const m = festival();
    // Listed BEFORE its cause, so it is only right once the cause has been widened (a second pass).
    m.factors.unshift({ id: 'helpers', label: 'Helpers on the day', kind: 'factor', estimate_by: null, value: 20, low: null, high: null, unit: 'helpers',
      defined_as: null, limit: null, ...who('20 helpers today') });
    m.links.push(adds('v_helpers', 'volunteers', 'helpers', 2, 'helpers'));
    const g = mapLivingModel(m).graph as Rec;
    // 2 helpers per volunteer on volunteers' 31.25 frame need 62.5: helpers widened to 62.5 × 1.25.
    expect(capOf(g, 'helpers')).toBe(78.125);
    const e = edge(g, 'volunteers', 'helpers');
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(e.strength.mean * capOf(g, 'helpers') / capOf(g, 'volunteers')).toBeCloseTo(2, 9);
  });

  it('an event\'s effect on a factor fits too (an event is 0 or 1, on a frame of 1)', () => {
    const m = supplier('point');
    m.factors.push({ id: 'output', label: 'Output', kind: 'factor', estimate_by: null, value: 12, low: null, high: null, unit: 'units', defined_as: null, limit: null,
      ...who('12 units today') });
    m.links.push({ id: 'fails_output', from: 'supplier_fails', to: 'output', ...who('if it fails we lose 30 units'),
      effect: { estimate_by: null, form: 'point', value: 30, sd: null, low: null, high: null, unit: 'units', sign: '-' } });
    const g = mapLivingModel(m).graph as Rec;
    const e = edge(g, 'supplier_fails', 'output');
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(e.strength.mean * capOf(g, 'output')).toBeCloseTo(-30, 9);
  });

  it('INVARIANCE: a model whose effects already fit maps exactly as before (KNOWN_ANSWER, OPTION_EFFECTS, the event model)', () => {
    // Pinned values from staging before this change (frames already wide enough): nothing moves.
    expect(capOf(mapLivingModel(KNOWN_ANSWER).graph as Rec, 'f')).toBe(1);
    for (const m of [KNOWN_ANSWER, OPTION_EFFECTS, supplier('point'), supplier('exact')]) {
      const g = mapLivingModel(m).graph as Rec;
      expect((g.edges as Rec[]).every((e) => typeof e.strength?.mean !== 'number' || Math.abs(e.strength.mean) <= 1)).toBe(true);
    }
  });

  it('CONTRAST: an effect in another unit is not sized here, so it never widens the frame', () => {
    const m = festival();
    m.links = m.links.map((l) => (l.id === 'schools_v' ? { ...l, effect: { ...l.effect, unit: 'hours' } } : l));
    // Without schools' +25 the widest effect is social's +18: 18 × 1.25.
    expect(capOf(mapLivingModel(m).graph as Rec, 'volunteers')).toBe(22.5);
  });
});
