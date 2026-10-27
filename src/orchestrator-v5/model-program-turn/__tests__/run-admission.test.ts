/**
 * The Run's admission limit (alpha G11), 0 provider calls. `costOf` counts the simulator's work and memory from the model's
 * shape; on the real evaluation path (`evaluateCanonical`) a Run whose headline would pass MAX_OPERATIONS or MAX_BYTES is
 * refused by name before the simulator is called, one whose driver sweep would pass it keeps its chance and says the driver
 * is not measured, and readiness says such a model is blocked. Every expected figure and sentence is written by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalLimitT, CanonicalModelT, CanonicalRelationT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import type { ExecutableModel } from '../../model-program/executable.js';
import { costOf, simulate } from '../../model-program/simulate/simulate.js';
import { admission, evaluateCanonical, MAX_BYTES, MAX_OPERATIONS, RUN_DRAWS } from '../evaluate.js';
import { programReadinessOf } from '../program-readiness.js';
import { livingModelOf, MODEL_PROGRAM } from '../program-store.js';
import { at, club, CLUB_BRIEF, q } from './bakery.fixture.js';

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
/** A hand-built executable: a fixed `a`, a ranged `b`, and `s` = a + b + `extra` more parts of a; one goal on s over both times. */
const tiny = (extra = 0, ranged = 1): ExecutableModel => ({
  periods: 1, period_unit: 'month', withheld: [], risks: [], limits: [],
  quantities: [
    { id: 'a', label: 'a', unit: '1', reading: 'state', dist: { kind: 'fixed', value: 1, author: 'person' } },
    ...Array.from({ length: ranged }, (_, i) => ({ id: i === 0 ? 'b' : `b${i}`, label: 'b', unit: '1', reading: 'state' as const,
      dist: { kind: 'range' as const, low: 0, high: 2, basis: 'olumi_estimate' as const, range_kind: 'plausible' as const } })),
    { id: 's', label: 's', unit: '1', reading: 'state', equation: { form: 'definition', op: 'sum', parts: ['a', 'b', ...Array.from({ length: extra }, () => 'a')] } },
    { id: 't', label: 't', unit: '1', reading: 'state', dist: { kind: 'fixed', value: 2, author: 'person' } },
  ],
  goals: [{ id: 'g', label: 'g', quantity: 's', cmp: '>=', target: 't', aggregation: 'end', window: { start_period: 0, periods: 1 } }],
  options: [{ id: 'o', label: 'o', sets: [] }],
});

describe('the Run admission limit (alpha G11)', () => {
  it('costOf, by hand: every read a visit makes, the windows, the sorts and what the run holds', () => {
    // 10 draws × [1 option × (2 times × 6 reads (a 1, b 1, s 1 + 2 parts, t 1) + window 2 × 2) + sorts ⌈log2 11⌉ = 4 × (1 ranged + 1 condition)] = 10 × 24.
    // Bytes: 10 × (16 × 1 ranged + 1 option × (9 × 1 condition + 4: joint, within, both and the kept headline, SC2) + 8 quantile
    // copy) + 8 × 2 times × 4 quantities = 370 + 64.
    expect(costOf(tiny(), 10)).toEqual({ operations: 240, bytes: 434 });
    // A sum's parts are work, however few quantities hold them (Codex r1): 1,000 more parts, 2 times × 1,000 more reads a draw.
    expect(costOf(tiny(1000), 10).operations).toBe(240 + 10 * 2 * 1000);
    // A risk on s (Codex r2–r3): 8 at each of 2 times and 8 a draw, so 10 × 24 more operations, and its uniforms, 8 bytes a draw.
    // Its chance `a` can leave [0, 1] (C14, 27 Oct): the goal's walk over it, 8 a draw (10 × 8 more) and 72 bytes.
    const risky: ExecutableModel = { ...tiny(), risks: [{ id: 'k', occurrence: 'a', severity: 'a', effect_on: 's', mode: 'add', from_period: 0 }] };
    expect(costOf(risky, 10)).toEqual({ operations: 240 + 240 + 80, bytes: 434 + 80 + 72 });
  });

  it('the limits by name: 450 ranged inputs pass MAX_BYTES while their work fits; 1,000,000 parts pass MAX_OPERATIONS', () => {
    expect(costOf(tiny(0, 450), 10_000).operations).toBeLessThan(150_000_000);
    expect(admission(tiny(0, 450))).toEqual({ ok: false, over: 'bytes' });
    expect(admission(tiny(1_000_000))).toEqual({ ok: false, over: 'operations' });
    expect(admission(tiny())).toEqual({ ok: true, operations: costOf(tiny(), 10_000).operations });
  });

  it('C14 (27 Oct): every pair of options is counted (SC2 compares each pair in every draw), so many options are refused before any work', () => {
    const withOptions = (k: number): ExecutableModel => ({ ...tiny(), options: Array.from({ length: k }, (_, i) => ({ id: `o${i}`, label: `o${i}`, sets: [] })) });
    // By hand, 10 draws: one option is 10 × (16 + sorts 4 × 2) = 240 (no pair); two are 10 × (2 × 16 + sorts 4 × 3 + their 1 pair).
    expect(costOf(withOptions(1), 10).operations).toBe(240);
    expect(costOf(withOptions(2), 10).operations).toBe(10 * (2 * 16 + 4 * 3 + 1));
    // 400 options: their own work is 10,000 × (400 × 16 + 14 × 401) = 120,140,000 (under the limit), but their 79,800 pairs
    // are 798,000,000 more, so the Run is refused by name before anything is allocated.
    expect(costOf(withOptions(400), 10_000).operations).toBe(10_000 * (400 * 16 + 14 * 401) + 10_000 * 79_800);
    expect(admission(withOptions(400))).toEqual({ ok: false, over: 'operations' });
    // CONTRAST: a few options, as a model holds them, stay admitted.
    expect(admission(withOptions(5))).toMatchObject({ ok: true });
  });

  it('a Run over the limit (club over 5000 months) is refused by name, the simulator is never called, and readiness says blocked', () => {
    const { m, src } = clubOver(5000);
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    const why = 'This model is too large to work out in one run: 5000 months ahead for 2 options. Counting in longer periods, looking less far ahead or comparing fewer options reduces the work.';
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
    const graph = (c: CanonicalModelT, w: string) => ({ nodes: [], living_model: livingModelOf({ model_program: MODEL_PROGRAM, canonical: c, seed: 7, person_words: [w], runs: [] }) });
    expect(programReadinessOf(graph(m, src))).toMatchObject({ status: 'blocked', blocked_reason: 'MODEL_PROGRAM_TOO_LARGE', may_run: false });
    // Contrast: the club over its own three months is ready.
    expect(programReadinessOf(graph(club(), CLUB_BRIEF))).toMatchObject({ status: 'ready', may_run: true });
    expect(programReadinessOf(graph(club(), CLUB_BRIEF))).not.toHaveProperty('blocked_reason');
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

/**
 * C14 (alpha spec §7, bounded operation, 27 Oct): THE ADMISSION BOUNDARY, on the real evaluation path. The club's cost over an
 * N-month window is 10,000 × (42N + 123) operations (hand arithmetic; 42 more a draw for each month the 2 options visit and
 * the goal's window reads, and 1 for their one pair), so N = 354 is the largest admitted (149,910,000 ≤ MAX_OPERATIONS
 * 150,000,000) and N = 355 the first refused (150,330,000). Each figure is checked on the executable evaluateCanonical itself compiled.
 * Elapsed time is printed, never asserted.
 */
describe('C14: the Run admission boundary on the real evaluation path (club, RUN_DRAWS draws)', () => {
  it('354 months, the largest admitted: costOf is 149,910,000 operations; the headline is simulated once and both options show a figure; the sweep is not run', () => {
    const { m, src } = clubOver(354);
    const t0 = performance.now();
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    console.log('C14 elapsed ms', 'evaluateCanonical club 354 months (admitted)', Math.round(performance.now() - t0));
    const cost = costOf(e.compiled.executable!, RUN_DRAWS);
    expect(cost.operations).toBe(10_000 * (42 * 354 + 123));
    expect(cost.operations).toBe(149_910_000);
    expect(cost.operations).toBeLessThanOrEqual(MAX_OPERATIONS);
    expect(cost.operations + 10_000 * 42, 'one more month passes the limit').toBeGreaterThan(MAX_OPERATIONS);
    expect(cost.bytes, 'operations, not memory, is the limit at this edge').toBeLessThan(MAX_BYTES);
    expect(calls, 'the headline only').toBe(1);
    expect(e.sim).not.toBeNull();
    const v = e.view as Json;
    expect(v.options.map((o: Json) => [o.option_id, o.cell.kind])).toEqual([['promotion', 'figure'], ['carry_on', 'figure']]);
    expect(JSON.stringify(v)).not.toContain('too large to work out in one run');
    const notMeasured = { kind: 'none_licensed', reason: 'This model is too large to test each figure one at a time in one run, so what the chance rests on most is not measured.' };
    expect((v.options as Json[]).map((o) => o.main_driver)).toEqual([notMeasured, notMeasured]);
  }, 60_000);

  it('355 months, the first refused: costOf is 150,330,000 operations; refused by name, the simulator never called', () => {
    const { m, src } = clubOver(355);
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    const cost = costOf(e.compiled.executable!, RUN_DRAWS);
    expect(cost.operations).toBe(10_000 * (42 * 355 + 123));
    expect(cost.operations).toBe(150_330_000);
    expect(cost.operations).toBeGreaterThan(MAX_OPERATIONS);
    expect(cost.bytes).toBeLessThan(MAX_BYTES);
    expect(admission(e.compiled.executable!)).toEqual({ ok: false, over: 'operations' });
    expect(calls).toBe(0);
    expect(e.sim).toBeNull();
    const why = 'This model is too large to work out in one run: 355 months ahead for 2 options. Counting in longer periods, looking less far ahead or comparing fewer options reduces the work.';
    const v = e.view as Json;
    expect(v.options.map((o: Json) => o.option_id)).toEqual(['promotion', 'carry_on']);
    for (const o of v.options as Json[]) {
      expect(o.cell).toEqual({ kind: 'withheld', face: 'Chance not shown yet', why, reasons: [{ code: 'too_large', message: why }] });
      expect(o.main_driver).toEqual({ kind: 'not_recorded' });
    }
    expect(v.goal_chance.notes[0]).toBe(why);
  });
});

/**
 * C14 (alpha spec §7, 27 Oct): a horizon the model works out (a derived goal window) is refused before the Run, by name, and
 * the simulator is never called: compile's typed window error (compile.ts resolveWindow) leaves no executable, and
 * evaluateCanonical returns before admission. Existing behaviour, witnessed on the real evaluation path; 0 provider calls.
 */
describe('C14: a derived goal horizon is refused before the Run, and nothing is simulated', () => {
  it('the club\'s window "months" worked out by a definition: a typed window error naming it, no executable, sim null, the simulator never called', () => {
    const { m, src } = clubOver(3);
    m.quantities = [...m.quantities.map((x) => (x.id === 'months' ? q('months', 'month', { kind: 'derived', status: 'derived', author: 'olumi' }) : x)),
      q('quarter_months', 'month', { value: 3, quote: 'within three months' })];
    m.relations = [...m.relations, { form: 'definition', id: 'months_rel', defines: 'months', op: 'product', parts: [{ id: 'quarter_months', power: 1 }],
      author: 'olumi', quote: null, party: null, approval: 'proposed', author_id: null, approved_by: null } as CanonicalModelT['relations'][number]];
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    const window = e.compiled.errors.filter((x) => x.code === 'window');
    expect(window.map((x) => x.message)).toEqual(['The goal "Reach 340 members within three months" (reach_340)\'s length "months" (months) is derived; a window needs a figure.']);
    expect(e.compiled.executable).toBeNull();
    expect(e.sim).toBeNull();
    expect(calls, 'nothing is simulated').toBe(0);
  });

  it('contrast: the same club with "months" as their figure (3) is admitted and simulated', () => {
    const { m, src } = clubOver(3);
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    expect(e.compiled.errors.filter((x) => x.code === 'window')).toEqual([]);
    expect(e.sim).not.toBeNull();
    expect(calls, 'simulated (the headline and its driver sweep)').toBeGreaterThan(0);
  });
});

/**
 * C14 (alpha spec §7, bounded operation, 27 Oct): in every draw, for every option, each goal and limit walks the values that
 * left their domain (simulate.ts Tally.add), so hundreds of conditions over hundreds of values that can leave (a declared floor
 * or ceiling, a risk's chance, a ratio) is work costOf did not count: 400 conditions over 900 such values were admitted at
 * 108,080,000 operations and took minutes. costOf now counts 8 for each condition and each such value, per option, in every
 * draw. Every figure is hand arithmetic; elapsed time is printed, never asserted. 0 provider calls.
 */
describe('C14: the walk over values that left their domain is counted (conditions × values that can leave)', () => {
  /** One period, one option: fixed `a` and `t`, `leavers` fixed −1 values each with a floor of 0 (so each leaves it in every
   *  draw), `s` = a + all of them, and `checks` goals s ≥ t, each resting on every one of them. */
  const leaving = (checks: number, leavers: number): ExecutableModel => ({
    periods: 1, period_unit: 'month', withheld: [], risks: [], limits: [],
    quantities: [
      { id: 'a', label: 'a', unit: '1', reading: 'state', dist: { kind: 'fixed', value: 1, author: 'person' } },
      { id: 't', label: 't', unit: '1', reading: 'state', dist: { kind: 'fixed', value: 2, author: 'person' } },
      ...Array.from({ length: leavers }, (_, i) => ({ id: `x${i}`, label: 'x', unit: '1', reading: 'state' as const, domain: { min: 0 },
        dist: { kind: 'fixed' as const, value: -1, author: 'person' as const } })),
      { id: 's', label: 's', unit: '1', reading: 'state', equation: { form: 'definition', op: 'sum', parts: ['a', ...Array.from({ length: leavers }, (_, i) => `x${i}`)] } },
    ],
    goals: Array.from({ length: checks }, (_, i) => ({ id: `g${i}`, label: 'g', quantity: 's', cmp: '>=' as const, target: 't', aggregation: 'end' as const,
      window: { start_period: 0, periods: 1 } })),
    options: [{ id: 'o', label: 'o', sets: [] }],
  });
  /** The club with `n` worked-out shortfalls, each the promotion's £500 less the £800 budget (−£300), so with Olumi's floor of
   *  £0 each is below it in every draw; and `caps` more limits on their total, each resting on all of them. */
  const shortfalls = (n: number, caps: number, floor: number | null): CanonicalModelT => {
    const m = club();
    m.quantities.push(...Array.from({ length: n }, (_, i) => q(`short_${i}`, 'GBP', { kind: 'derived', status: 'derived', author: 'olumi', floor })),
      q('shortfall', 'GBP', { kind: 'derived', status: 'derived', author: 'olumi' }));
    m.relations.push(...Array.from({ length: n }, (_, i): CanonicalRelationT => ({ form: 'definition', id: `short_${i}_rel`, defines: `short_${i}`, op: 'sum',
      parts: [{ id: 'promo_cost', sign: 1 }, { id: 'budget', sign: -1 }], author: 'olumi', quote: null, ...at })),
    { form: 'definition', id: 'shortfall_rel', defines: 'shortfall', op: 'sum', parts: Array.from({ length: n }, (_, i) => ({ id: `short_${i}`, sign: 1 as const })),
      author: 'olumi', quote: null, ...at });
    m.limits.push(...Array.from({ length: caps }, (_, i): CanonicalLimitT => ({ id: `short_cap_${i}`, label: `The shortfall within the £800 (${i})`,
      measure: { quantity: 'shortfall', per: null, cmp: '<=', bound: 'budget', aggregation: 'end', window: null }, question: null, author: 'person', quote: 'we can spend £800', ...at })));
    return m;
  };

  it('400 conditions over 900 values that leave are refused by name before the Run; the boundary by hand; on the real path the simulator is never called', () => {
    // By hand, RUN_DRAWS = 10,000 draws, 1 option, 2 times, ⌈log2 10,001⌉ = 14: reads 2L + 4 at each time (a, t and each x 1,
    // s 1 + L + 1 parts), each goal's window 4 and sorts 14, and 8 for each goal and each value that can leave:
    // 10,000 × (4L + 8 + 18C + 8CL). Without the walk, 400 × 900 was 10,000 × 10,808 = 108,080,000: admitted.
    expect(costOf(leaving(400, 900), RUN_DRAWS)).toEqual({ operations: 10_000 * (3_608 + 7_200 + 2_880_000), bytes: 10_000 * (9 * 400 + 4 + 8) + 8 * 2 * 903 + 72 * 400 * 900 });
    expect(costOf(leaving(400, 900), RUN_DRAWS).operations).toBe(28_908_080_000);
    expect(admission(leaving(400, 900))).toEqual({ ok: false, over: 'operations' });
    // A ratio can leave too (a divisor of 0): tiny's s as a ÷ b, the same two parts, is its 240 and the goal's walk over s,
    // 10 × 8, with 72 bytes.
    const ratio: ExecutableModel = { ...tiny(), quantities: tiny().quantities.map((x) => (x.id === 's' ? { ...x, equation: { form: 'definition', op: 'ratio', parts: ['a', 'b'] } } : x)) };
    expect(costOf(ratio, 10)).toEqual({ operations: 240 + 80, bytes: 434 + 72 });
    // The boundary at 40 conditions: 10,000 × (324L + 728), so 44 values is the most admitted (149,840,000 ≤ 150,000,000) and
    // 45 the first refused (153,080,000).
    expect(admission(leaving(40, 44))).toEqual({ ok: true, operations: 149_840_000 });
    expect(costOf(leaving(40, 45), RUN_DRAWS).operations).toBe(153_080_000);
    expect(admission(leaving(40, 45))).toEqual({ ok: false, over: 'operations' });
    // The real path: the compiler gives each floored shortfall its domain, and the club's 52 conditions over 50 of them, for
    // 2 options, cost 10,000 × 2 × 52 × 50 × 8 = 416,000,000 more than the same model without the floors. Refused by name
    // before the Run (unmodified, it was admitted and its headline alone took about 5 s on the Mac).
    const floored = compile(shortfalls(50, 50, 0)).executable!, free = compile(shortfalls(50, 50, null)).executable!;
    expect(floored.quantities.filter((x) => x.domain !== undefined).map((x) => x.id)).toEqual(Array.from({ length: 50 }, (_, i) => `short_${i}`));
    expect(floored.goals.length + floored.limits.length).toBe(52);
    expect(costOf(floored, RUN_DRAWS).operations - costOf(free, RUN_DRAWS).operations).toBe(416_000_000);
    const e = evaluateCanonical(shortfalls(50, 50, 0), { sourceText: CLUB_BRIEF, seed: 7 });
    expect(calls, 'nothing is simulated').toBe(0);
    expect(e.sim).toBeNull();
    const why = 'This model is too large to work out in one run: 3 months ahead for 2 options. Counting in longer periods, looking less far ahead or comparing fewer options reduces the work.';
    for (const o of (e.view as Json).options as Json[]) expect(o.cell).toEqual({ kind: 'withheld', face: 'Chance not shown yet', why, reasons: [{ code: 'too_large', message: why }] });
  });

  it('contrast: a realistic model (30 conditions, 5 values that can leave) is admitted, and its Run walks them in every draw', () => {
    // 10,000 × (4 × 5 + 8 + 18 × 30 + 8 × 30 × 5) = 10,000 × 1,768.
    expect(admission(leaving(30, 5))).toEqual({ ok: true, operations: 17_680_000 });
    const t0 = performance.now();
    const sim = simulate(leaving(30, 5), { seed: 7, draws: RUN_DRAWS });
    console.log('C14 elapsed ms', 'simulate 30 conditions × 5 values that leave (admitted)', Math.round(performance.now() - t0));
    expect(calls).toBe(1);
    // Every value leaves its floor in every draw, so every goal is withheld in all 10,000 draws, naming them.
    for (const [i, g] of sim.options[0]!.per_goal.entries()) {
      expect(g).toEqual({ goal_id: `g${i}`, withheld: { reason: 'invalid_domain', count: 10_000, quantities: ['s', 'x0', 'x1', 'x2', 'x3', 'x4'] } });
    }
  });
});
