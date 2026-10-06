/**
 * ⭐ A LEVEL CHANGE STATES A SWITCH'S SIZE (MC, DL bench DIAGNOSIS §2a, 6 Oct 2026). The bench bank's own briefs state a
 * switch's effect as the level it moves FROM and TO, never as the amount: investor (7 served drafts) "lift our enterprise
 * win rate from 20% to about 30%" and "about 30% of trial users abandon at that step today, and fixing it should roughly
 * halve that"; bakery "a central kitchen would cut waste from 12% of output to 6%". The literal reader needs the amount
 * written, so each stayed Olumi's guess and Olumi asked for a size the user had already given.
 *
 * Every must-bind row is a sentence copied from a banked brief. A percentage level moves in POINTS: "from 20% to 30%"
 * is +10 points, never +50%.
 */
import { describe, it, expect } from 'vitest';
import { statedSwitchEffectQuoteMatches, type StatedEffectDetail } from '../stated-effect.js';

// Copied verbatim from the banked briefs (bench/bank: acc__cut5-investor-stg3 et al.; mc__out-g1-21ef54cc_brief1_draw1).
const INV_A = 'Option A: build the AI reporting module — enterprise prospects tell us it would lift our enterprise win rate from 20% to about 30%.';
const INV_B = 'Option B: fix the integration-step bug — about 30% of trial users abandon at that step today, and fixing it should roughly halve that.';
const BAKERY = 'We think an 8% price rise would cut footfall by about 5%, and a central kitchen would cut waste from 12% of output to 6%.';
const BAKERY_HISTORY = 'Wholesale flour costs rose 18% this year and our gross margin fell from 62% to 54%.';

const perSwitch = (amount: number, amount_unit: string): StatedEffectDetail =>
  ({ amount, amount_unit, per_source_change: 1, per_source_change_unit: 'switch' });

type Spans = { amount: { start: number; end: number }; per: { start: number; end: number }; level?: { names: { start: number; end: number } } };
function match(quote: string, detail: StatedEffectDetail): { ok: boolean; spans?: Spans } {
  let spans: Spans | undefined;
  const ok = statedSwitchEffectQuoteMatches(quote, detail, (s) => { spans = s as Spans; });
  return { ok, spans };
}

describe('must bind: a real brief\'s level change is read as the switch\'s size, in points', () => {
  it('RED (investor A): "from 20% to about 30%" is +10 percentage points, said at the level it moves to', () => {
    const { ok, spans } = match(INV_A, perSwitch(10, 'percentage points'));
    expect(ok).toBe(true);
    expect(INV_A.slice(spans!.amount.start, spans!.amount.end)).toBe('30%');
    // Where the quantity is named, for the binder's same-quantity check: the words before "from".
    expect(INV_A.slice(spans!.level!.names.start, spans!.level!.names.end)).toContain('enterprise win rate');
  });

  it('RED (investor B): "roughly halve that" of "about 30%" is −15 percentage points', () => {
    const { ok, spans } = match(INV_B, perSwitch(-15, 'percentage points'));
    expect(ok).toBe(true);
    expect(INV_B.slice(spans!.amount.start, spans!.amount.end)).toBe('halve');
    // "that" points at the ONE percentage before it; its own clause names the quantity.
    expect(INV_B.slice(spans!.level!.names.start, spans!.level!.names.end)).toContain('30% of trial users abandon');
  });

  it('RED (bakery): "cut waste from 12% of output to 6%" is −6 in the level\'s own "% of output" (points), and in points', () => {
    expect(match(BAKERY, perSwitch(-6, '% of output')).ok).toBe(true);
    expect(match(BAKERY, perSwitch(-6, 'percentage points')).ok).toBe(true);
  });
});

describe('must NOT bind: never invent a size the sentence does not state', () => {
  it('"from 20% to 30%" never becomes 50% (a relative reading), in points or in "%"', () => {
    expect(match(INV_A, perSwitch(50, 'percentage points')).ok).toBe(false);
    expect(match(INV_A, perSwitch(50, '%')).ok).toBe(false);
  });

  it('a bare "%" is the relative spelling: +10 "%" is not read off "from 20% to about 30%"', () => {
    expect(match(INV_A, perSwitch(10, '%')).ok).toBe(false);
  });

  it('the other sign is never read: −10 points is not "from 20% to about 30%"', () => {
    expect(match(INV_A, perSwitch(-10, 'percentage points')).ok).toBe(false);
  });

  it('ambiguous direction: a verb the other way from its numbers ("cut … from 20% to about 30%") reads nothing', () => {
    const q = INV_A.replace('would lift', 'would cut');
    expect(match(q, perSwitch(10, 'percentage points')).ok).toBe(false);
    expect(match(q, perSwitch(-10, 'percentage points')).ok).toBe(false);
  });

  it('ambiguous direction: "either halve that or double it" reads nothing', () => {
    const q = INV_B.replace('should roughly halve that', 'should either halve that or double it');
    expect(match(q, perSwitch(-15, 'percentage points')).ok).toBe(false);
    expect(match(q, perSwitch(30, 'percentage points')).ok).toBe(false);
  });

  it('history is not an effect: "our gross margin fell from 62% to 54%" (bakery brief) reads nothing', () => {
    expect(match(BAKERY_HISTORY, perSwitch(-8, 'percentage points')).ok).toBe(false);
  });

  it('a negated change reads nothing ("would not lift … from 20% to about 30%")', () => {
    expect(match(INV_A.replace('would lift', 'would not lift'), perSwitch(10, 'percentage points')).ok).toBe(false);
  });

  it('"halve that" with TWO percentages before it points at neither', () => {
    const q = INV_B.replace('today, and fixing', 'today and 12% churn in the first month, and fixing');
    expect(match(q, perSwitch(-15, 'percentage points')).ok).toBe(false);
    expect(match(q, perSwitch(-6, 'percentage points')).ok).toBe(false);
  });

  it('"halve" a quantity named in words is not "that": "halve support tickets" reads nothing', () => {
    expect(match(INV_B.replace('halve that', 'halve support tickets'), perSwitch(-15, 'percentage points')).ok).toBe(false);
  });

  it('a level of ANOTHER base is not the link\'s: "from 12% of revenue to 6%" is not −6 "% of output"', () => {
    expect(match(BAKERY.replace('12% of output', '12% of revenue'), perSwitch(-6, '% of output')).ok).toBe(false);
  });
});
