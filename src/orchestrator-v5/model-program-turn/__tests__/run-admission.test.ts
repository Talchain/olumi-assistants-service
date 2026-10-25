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
import { admission, evaluateCanonical } from '../evaluate.js';
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
    // Bytes: 10 × (16 × 1 ranged + 1 option × (9 × 1 condition + 3) + 8 quantile copy) + 8 × 2 times × 4 quantities = 360 + 64.
    expect(costOf(tiny(), 10)).toEqual({ operations: 240, bytes: 424 });
    // A sum's parts are work, however few quantities hold them (Codex r1): 1,000 more parts, 2 times × 1,000 more reads a draw.
    expect(costOf(tiny(1000), 10).operations).toBe(240 + 10 * 2 * 1000);
    // A risk on s (Codex r2–r3): 8 at each of 2 times and 8 a draw, so 10 × 24 more operations, and its uniforms, 8 bytes a draw.
    const risky: ExecutableModel = { ...tiny(), risks: [{ id: 'k', occurrence: 'a', severity: 'a', effect_on: 's', mode: 'add', from_period: 0 }] };
    expect(costOf(risky, 10)).toEqual({ operations: 240 + 240, bytes: 424 + 80 });
  });

  it('the limits by name: 450 ranged inputs pass MAX_BYTES while their work fits; 1,000,000 parts pass MAX_OPERATIONS', () => {
    expect(costOf(tiny(0, 450), 10_000).operations).toBeLessThan(150_000_000);
    expect(admission(tiny(0, 450))).toEqual({ ok: false, over: 'bytes' });
    expect(admission(tiny(1_000_000))).toEqual({ ok: false, over: 'operations' });
    expect(admission(tiny())).toEqual({ ok: true, operations: costOf(tiny(), 10_000).operations });
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
