/**
 * The Run's admission limit on the real evaluation path (`evaluateCanonical`, alpha G11), 0 provider calls. A Run whose
 * headline would pass MAX_EVALUATIONS is refused by name before the simulator is called; one whose driver sweep would pass
 * it keeps its chance and says the driver is not measured. Every expected sentence is written by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { evaluateCanonical } from '../evaluate.js';
import { club, CLUB_BRIEF, q } from './bakery.fixture.js';

let calls = 0;
vi.mock('../../model-program/simulate/simulate.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../model-program/simulate/simulate.js')>();
  return { ...real, simulate: (...args: Parameters<typeof real.simulate>) => { calls++; return real.simulate(...args); } };
});
beforeEach(() => { calls = 0; });

type Json = Record<string, any>;
/** The club, counted over `months` months from now. */
const clubOver = (months: number): { m: CanonicalModelT; src: string } => {
  const m = club();
  m.quantities = m.quantities.map((x) => (x.id === 'months' ? q('months', 'month', { value: months, quote: `${months} months ahead` }) : x));
  return { m, src: `${CLUB_BRIEF} We look ${months} months ahead.` };
};

describe('the Run admission limit (alpha G11)', () => {
  it('a Run over the limit (2 options × 5001 times × 10,000 draws) is refused by name and the simulator is never called', () => {
    const { m, src } = clubOver(5000);
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    const why = 'This model is too large to work out in one run: 5000 months ahead for 2 options. Counting in longer periods, looking less far ahead or comparing fewer options brings it within reach.';
    expect(e.compiled.executable).not.toBeNull();
    expect(calls).toBe(0);
    expect(e.sim).toBeNull();
    const v = e.view as Json;
    expect(v.options.map((o: Json) => o.option_id)).toEqual(['promotion', 'carry_on']);
    for (const o of v.options as Json[]) {
      expect(o.cell).toEqual({ kind: 'withheld', face: 'Chance not shown yet', why, reasons: [{ code: 'too_large', message: why }] });
      expect(o.main_driver).toEqual({ kind: 'not_recorded' });
    }
    expect(v.goal_chance.notes[0]).toBe(why);
  });

  it('a Run within the limit whose driver sweep is not (200 months): the chance is worked out, the sweep is not run, and that is said', () => {
    const { m, src } = clubOver(200);
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    expect(calls).toBe(1);
    const v = e.view as Json;
    expect(v.options.map((o: Json) => o.cell.kind)).toEqual(['figure', 'figure']);
    // Both options rest on the promotion's effect (carry on holds it switched off, structurally upstream all the same).
    const notMeasured = { kind: 'none_licensed', reason: 'This model is too large to test each figure one at a time in one run, so what the chance rests on most is not measured.' };
    expect(Object.fromEntries((v.options as Json[]).map((o) => [o.option_id, o.main_driver]))).toEqual({ promotion: notMeasured, carry_on: notMeasured });
  });

  it('contrast: the club over its own three months runs the headline and the sweep (one ranged input, three settings)', () => {
    const e = evaluateCanonical(club(), { sourceText: CLUB_BRIEF, seed: 7 });
    expect(calls).toBe(4);
    const promotion = (e.view as Json).options.find((o: Json) => o.option_id === 'promotion');
    expect(promotion.main_driver.reason ?? '').not.toMatch(/too large/);
    expect(['available', 'none_licensed']).toContain(promotion.main_driver.kind);
  });
});
