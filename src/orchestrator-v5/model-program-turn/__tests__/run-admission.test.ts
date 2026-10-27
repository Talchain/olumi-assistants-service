/**
 * The Run's admission limit (alpha G11), 0 provider calls. `costOf` counts the simulator's work and memory from the model's
 * shape; on the real evaluation path (`evaluateCanonical`) a Run whose headline would pass MAX_OPERATIONS or MAX_BYTES is
 * refused by name before the simulator is called, one whose driver sweep would pass it keeps its chance and says the driver
 * is not measured, and readiness says such a model is blocked. Every expected figure and sentence is written by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import type { ExecutableModel } from '../../model-program/executable.js';
import { costOf } from '../../model-program/simulate/simulate.js';
import { admission, evaluateCanonical, MAX_BYTES, MAX_OPERATIONS, RUN_DRAWS } from '../evaluate.js';
import { programReadinessOf } from '../program-readiness.js';
import { livingModelOf, MODEL_PROGRAM } from '../program-store.js';
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
    const risky: ExecutableModel = { ...tiny(), risks: [{ id: 'k', occurrence: 'a', severity: 'a', effect_on: 's', mode: 'add', from_period: 0 }] };
    expect(costOf(risky, 10)).toEqual({ operations: 240 + 240, bytes: 434 + 80 });
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
