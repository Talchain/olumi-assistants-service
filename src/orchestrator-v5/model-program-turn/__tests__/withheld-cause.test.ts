/**
 * A withheld chance says what actually happened (DL 27 Oct, from Paul's hiring test), on the real evaluation path
 * (`evaluateCanonical`), 0 provider calls. Once the defect baseline was answered, one draw in 10,000 took the defect rate
 * below its floor of 0, and the chance said it "could not be worked out (for example a division by zero)": the value was
 * worked out and fell below what it can be. The simulator knows which: a value below its floor or above its ceiling, a
 * divisor of 0, a value not a finite number, or one unreadable only because a value it rests on left its domain.
 */
import { describe, expect, it } from 'vitest';
import { combineCauses } from '../../model-program/simulate/simulate.js';
import { evaluateCanonical } from '../evaluate.js';
import { club, CLUB_BRIEF } from './bakery.fixture.js';

type Json = Record<string, any>;
/** The club where joins can never be below 0, and Olumi's promotion effect is −40 to 7 a month around −10: in some draws the
 *  promotion takes joins below 0. Carrying on as now never touches it. */
function floored() {
  const m = club();
  m.quantities = m.quantities.map((x) => (x.id === 'joins' ? { ...x, floor: 0 } : x.id === 'promo_effect' ? { ...x, value: -10, low: -40, high: 7 } : x));
  return m;
}
/** Joins within 0 to 40 a month, and Olumi's promotion effect −40 to 40 around 0: below 0 in some draws, above 40 in others. */
function bothWays() {
  const m = club();
  m.quantities = m.quantities.map((x) => (x.id === 'joins' ? { ...x, floor: 0, ceiling: 40 } : x.id === 'promo_effect' ? { ...x, value: 0, low: -40, high: 40 } : x));
  return m;
}
const cellOf = (v: Json, id: string) => (v.options as Json[]).find((o) => o.option_id === id)!.cell;

describe('a withheld chance says what happened in the draws it is withheld for', () => {
  it('a value below its floor is said to have fallen below what it can be, and what rests on it then could not be worked out; never "for example a division by zero"', () => {
    const e = evaluateCanonical(floored(), { sourceText: CLUB_BRIEF, seed: 7 });
    const promotion = e.sim!.options.find((o) => o.option_id === 'promotion')!;
    expect(promotion.outside).toEqual({ joins: 'below', members: 'follows' });
    const cell = cellOf(e.view as Json, 'promotion');
    expect(cell.kind).toBe('withheld');
    const count = (promotion.joint_within_limits as { withheld: { count: number } }).withheld.count;
    expect(count).toBeGreaterThan(0);
    expect(cell.why).toBe(`In ${count.toLocaleString('en-GB')} of 10,000 simulated draws ‘joins’ fell below what it can be (never below 0 member / month), `
      + 'and then ‘members’ could not be worked out, so this model cannot give the chance yet.');
    expect(cell.why).not.toMatch(/division by zero/);
  });

  it('buddy on #3836: below in some draws and above in others is said as outside what it can be, never one direction against every draw', () => {
    const e = evaluateCanonical(bothWays(), { sourceText: CLUB_BRIEF, seed: 7 });
    const promotion = e.sim!.options.find((o) => o.option_id === 'promotion')!;
    expect(promotion.outside).toEqual({ joins: 'outside', members: 'follows' });
    const count = (promotion.joint_within_limits as { withheld: { count: number } }).withheld.count;
    const why = cellOf(e.view as Json, 'promotion').why as string;
    expect(why).toBe(`In ${count.toLocaleString('en-GB')} of 10,000 simulated draws ‘joins’ went outside what it can be (0 member / month to 40 member / month), `
      + 'and then ‘members’ could not be worked out, so this model cannot give the chance yet.');
    expect(why).not.toMatch(/fell below|rose above/);
  });

  it('causes combine across draws: a direction only where every draw went that way', () => {
    expect([combineCauses('below', 'below'), combineCauses('below', 'above'), combineCauses('outside', 'below'), combineCauses('below', 'not_finite'),
      combineCauses('follows', 'not_finite'), combineCauses('divided_by_zero', 'follows'), combineCauses('mixed', 'below'), combineCauses('divided_by_zero', 'above')])
      .toEqual(['below', 'outside', 'outside', 'mixed', 'not_finite', 'not_finite', 'mixed', 'mixed']);
  });

  it('contrast: the other option, which never touches the floor, keeps its chance, with nothing outside its domain; a division by 0 keeps its own words (present.test.ts, Revenue per seat)', () => {
    const e = evaluateCanonical(floored(), { sourceText: CLUB_BRIEF, seed: 7 });
    expect(e.sim!.options.find((o) => o.option_id === 'carry_on')!.outside).toEqual({});
    expect(cellOf(e.view as Json, 'carry_on').kind).toBe('figure');
  });
});
