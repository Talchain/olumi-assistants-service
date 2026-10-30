/**
 * G10 wiring (Paul, 30 Oct: "genuinely optimal and seamlessly integrated, and also can be reverted quickly"; contract v2 with
 * PL 01:31Z): the tipping point is searched on the permitted leader's measured main driver, over the driver's own low and high
 * ends, and said once at the end of the leader's words, of the values tried only. Every expectation is worked out BY HAND.
 *
 * The models: score = Z + c + b·x, Z Olumi's plausible range −Z90 to Z90 (a standard Normal since W10), x Olumi's range 0 to
 * 20 (the figure searched; probes at 0, 1, …, 20), and each option sets its own c and b, so at a fixed x its chance is
 * Φ(c + b·x). Keep sets nothing (c0, b 0). Every gap a row calls definite is at least 7.9 points at 4,000 draws a probe.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutableModel, Option, Quantity } from '../../executable.js';
import { simulate } from '../../simulate/simulate.js';
import { Z90 } from '../../simulate/range-law.js';
import { presentAnalysisView, type PresentInput } from '../present.js';

const searched: { seed: number; quantity: string }[] = [];
vi.mock('../tipping.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tipping.js')>();
  return { ...real, tippingPoint: (input: Parameters<typeof real.tippingPoint>[0]) => { searched.push({ seed: input.seed, quantity: input.quantity }); return real.tippingPoint(input); } };
});

type Rec = Record<string, any>;
const fixed = (id: string, value: number, author: 'person' | 'structure' = 'person'): Quantity => ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author } });
const range = (id: string, low: number, high: number): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'range', low, high, basis: 'olumi_estimate', range_kind: 'plausible' } });
/** Keep at Φ(c0); each other option at Φ(c + b·x). */
const model = (c0: number, others: { id: string; label: string; c: number; b: number }[]): ExecutableModel => ({
  periods: 1, period_unit: 'month',
  quantities: [range('z', -Z90, Z90), range('x', 0, 20), fixed('one', 1, 'structure'), fixed('c', c0), fixed('b', 0), fixed('zero', 0),
    ...others.flatMap((o) => [fixed(`c_${o.id}`, o.c), fixed(`b_${o.id}`, o.b)]),
    { id: 'score', label: 'score', unit: '', reading: 'state', equation: { form: 'effect', base: 'z', terms: [{ coefficient: 'c', driver: 'one' }, { coefficient: 'b', driver: 'x' }] } }],
  goals: [{ id: 'g', label: 'g', quantity: 'score', cmp: '>=', target: 'zero', aggregation: 'end', window: { start_period: 0, periods: 1 } }],
  limits: [], risks: [], withheld: [],
  options: [{ id: 'keep', label: 'Keep', sets: [] } as Option, ...others.map((o) => ({ id: o.id, label: o.label,
    sets: [{ quantity: 'c', to: `c_${o.id}`, from_period: 0 }, { quantity: 'b', to: `b_${o.id}`, from_period: 0 }] }) as Option)],
});
const view = (m: ExecutableModel, more: Partial<PresentInput> = {}): Rec =>
  presentAnalysisView({ model: m, result: simulate(m, { seed: 20261030, draws: 10_000 }), tipping_operations: 150_000_000, ...more }) as unknown as Rec;
const GOAL = 'the goal';

describe('G10 wiring: the tipping point on the leader\'s measured main driver, said of the values tried', () => {
  it('(a) a leader crossing: Keep up to 7, Expand from 9; the change between them', () => {
    // Expand Φ(0.25·(x − 8)): at 7 Φ(−0.25) = 40.1% against Keep's 50%; at 8 equal (the same draws); at 9 59.9%. Headline:
    // x − 8 ~ Normal(2, (10/Z90)²), so Expand ≈ Φ(0.5/2.19) ≈ 59% against 50%: Expand leads, x its driver.
    const v = view(model(0, [{ id: 'expand', label: 'Expand', c: -2, b: 0.25 }]));
    expect(v.leader.goal_chance_leader).toBe('expand');
    expect(v.tipping).toMatchObject({ kind: 'crossing', quantity: 'x', from: { kind: 'leader', option_id: 'keep' }, to: { kind: 'leader', option_id: 'expand' }, between: [7, 9] });
    expect(v.leader.words.endsWith(` At the values of ‘x’ tried from 0 to 20: up to 7, ‘Keep’ is the more likely to achieve ${GOAL}; from 9, ‘Expand’ is the more likely to achieve ${GOAL}. The change comes somewhere between 7 and 9.`)).toBe(true);
  });

  it('(h) the opposite direction reads in probe order: Expand up to 11, Keep from 13', () => {
    // Expand Φ(3 − 0.25·x): 50% at 12; headline mean 3 − 2.5 = 0.5, so Expand ≈ 59% leads.
    const v = view(model(0, [{ id: 'expand', label: 'Expand', c: 3, b: -0.25 }]));
    expect(v.tipping).toMatchObject({ kind: 'crossing', from: { kind: 'leader', option_id: 'expand' }, to: { kind: 'leader', option_id: 'keep' }, between: [11, 13] });
    expect(v.leader.words).toContain(`: up to 11, ‘Expand’ is the more likely to achieve ${GOAL}; from 13, ‘Keep’ is the more likely to achieve ${GOAL}.`);
  });

  it('(i) a third option: Expand overtakes Keep at 10, but Premium leads by then; only the leader across every option is named', () => {
    // Premium Φ(0.25·(x − 8)) crosses Keep's 50% at 8; Expand Φ(0.1·(x − 10)) stays at least 7.9 points below Premium from 9.
    const v = view(model(0, [{ id: 'expand', label: 'Expand', c: -1, b: 0.1 }, { id: 'premium', label: 'Premium', c: -2, b: 0.25 }]));
    expect(v.leader.goal_chance_leader).toBe('premium');
    expect(v.tipping).toMatchObject({ kind: 'crossing', from: { kind: 'leader', option_id: 'keep' }, to: { kind: 'leader', option_id: 'premium' }, between: [7, 9] });
    const sentence = v.leader.words.slice(v.leader.words.indexOf(' At the values of'));
    expect(sentence).not.toContain('Expand');
  });

  it('(b) none: Expand leads at every value tried', () => {
    // Keep Φ(−1.5) = 6.7%; Expand Φ(0.25·x − 0.5) is 30.9% at 0 and rises: Expand at every probe.
    const v = view(model(-1.5, [{ id: 'expand', label: 'Expand', c: -0.5, b: 0.25 }]));
    expect(v.tipping).toMatchObject({ kind: 'none', state: { kind: 'leader', option_id: 'expand' } });
    expect(v.leader.words.endsWith(` At every value of ‘x’ tried from 0 to 20, ‘Expand’ is the more likely to achieve ${GOAL}.`)).toBe(true);
  });

  it('(c) where even the leader is more likely to miss, the question is 50% for the leader', () => {
    // Keep Φ(−3) = 0.1%; Expand Φ(0.25·x − 4): 40.1% at 15, 50% at 16, 59.9% at 17. Headline: mean −1.5, sd 2.19, ≈ 25%.
    const v = view(model(-3, [{ id: 'expand', label: 'Expand', c: -4, b: 0.25 }]));
    expect(v.leader.words).toContain('more likely to miss');
    expect(v.tipping).toMatchObject({ kind: 'crossing', from: { kind: 'below' }, to: { kind: 'above' }, between: [15, 17] });
    expect(v.leader.words.endsWith(` At the values of ‘x’ tried from 0 to 20: up to 15, ‘Expand’ is more likely to miss ${GOAL} than to meet it; from 17, ‘Expand’ is more likely to meet ${GOAL} than to miss it. The change comes somewhere between 15 and 17.`)).toBe(true);
  });

  it('(d)(e) no measured driver, or no budget given: no search, no field, and the leader\'s words are exactly as before', () => {
    const m = model(0, [{ id: 'expand', label: 'Expand', c: -2, b: 0.25 }]);
    const base = view(m, { tipping_operations: undefined });
    expect(base.tipping).toBeUndefined();
    const searched = view(m);
    // The only differences: the field, and the sentence at the end of the leader's words.
    expect(searched.leader.words.startsWith(base.leader.words)).toBe(true);
    const { tipping: _t, leader: l1, ...rest1 } = searched, { leader: l2, ...rest2 } = base;
    expect(JSON.stringify(rest1)).toBe(JSON.stringify(rest2));
    expect({ ...l1, words: '' }).toEqual({ ...l2, words: '' });
    const unswept = view(m, { sweep: false });
    expect([unswept.tipping, /tried from/.test(unswept.leader.words)]).toEqual([undefined, false]);
  });

  it('(k) PL 01:57Z: the search draws its own seed, forked from the Run\'s per figure, never the draws that chose it', () => {
    searched.length = 0;
    view(model(0, [{ id: 'expand', label: 'Expand', c: -2, b: 0.25 }]));
    const forked = createHash('sha256').update('tipping:20261030:x', 'utf8').digest().readUInt32BE(0);
    expect(searched).toEqual([{ seed: forked, quantity: 'x' }]);
    expect(forked).not.toBe(20261030);
  });

  it('(f) over what the Run and the sweep leave of the admission limit: refused by name, and said', () => {
    const v = view(model(0, [{ id: 'expand', label: 'Expand', c: -2, b: 0.25 }]), { tipping_operations: 1 });
    expect(v.tipping).toMatchObject({ kind: 'refused', reason: 'work_bound', limit: 1 });
    expect(v.leader.words.endsWith(' This model is too large to test ‘x’ across its range in one run.')).toBe(true);
  });
});
