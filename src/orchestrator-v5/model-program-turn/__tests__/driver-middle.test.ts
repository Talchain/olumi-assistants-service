/**
 * C10 (the driver basis is accurate), on the real evaluation path (`evaluateCanonical`), 0 provider calls: the figure the
 * driver tests "at the middle" is the range's own middle value, the one the chance's basis names, never the halfway point
 * between its ends. Paul's hiring test (27 Oct): for Olumi's 0.04 to 0.35 around 0.15, the basis said "0.15 as the middle
 * value" while the driver said "at the middle (0.195) about 98%"; at 0.15 the chance is about 76%.
 */
import { describe, expect, it } from 'vitest';
import { evaluateCanonical } from '../evaluate.js';
import { club, CLUB_BRIEF } from './bakery.fixture.js';

type Json = Record<string, any>;
/** The club with Olumi's promotion effect skewed: 3 to 9 a month around 4, so its middle value is 4 and halfway is 6. */
function skewedClub() {
  const m = club();
  m.quantities = m.quantities.map((x) => (x.id === 'promo_effect' ? { ...x, value: 4, low: 3, high: 9 } : x));
  return m;
}

describe('the driver tests a range at the middle value its basis names', () => {
  it('a skewed Olumi range: "at the middle" is its middle value (4), the figure the basis calls the middle value, never halfway (6)', () => {
    const v = evaluateCanonical(skewedClub(), { sourceText: CLUB_BRIEF, seed: 7 }).view as Json;
    const promotion = (v.options as Json[]).find((o) => o.option_id === 'promotion')!;
    expect(promotion.main_driver.kind).toBe('available');
    expect(promotion.main_driver.driver.quantity).toBe('promo_effect');
    expect(promotion.main_driver.driver.middle.value).toBe(4);
    // Bound by identity: the one figure the basis calls the middle value is the one the driver tests at the middle.
    const named = /‘promo effect’ follows [^.]*?, with (.+?) as the middle value/.exec(promotion.cell.face)?.[1];
    const tested = /at the middle \((.+?)\)/.exec(promotion.main_driver.detail)?.[1];
    expect(named).toBeDefined();
    expect(tested).toBe(named);
  });

  it('contrast: a symmetric range (3 to 7 around 5) tests its middle value, which is also halfway', () => {
    const v = evaluateCanonical(club(), { sourceText: CLUB_BRIEF, seed: 7 }).view as Json;
    const promotion = (v.options as Json[]).find((o) => o.option_id === 'promotion')!;
    const d = promotion.main_driver;
    if (d.kind === 'available') expect([d.driver.low.value, d.driver.middle.value, d.driver.high.value]).toEqual([3, 5, 7]);
    else expect(d.kind).toBe('none_licensed');
  });
});
