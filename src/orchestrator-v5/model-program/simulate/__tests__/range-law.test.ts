/**
 * W10 (interim, the DL on Paul's instruction, 26 Oct, until Neil and Jinghui review the method): how a range is read.
 * Every expected value is worked out BY HAND in closed form in the comment beside it and written as a literal. Shares
 * checked by simulation use 20,000 draws, and the hand value must lie within the 95% Wilson half-width of the sampled share.
 * Φ⁻¹(0.9) = 1.2815516: a half-Normal is beyond 1.2815516 σ exactly 1 time in 5 (2 × (1 − 0.9)).
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Goal, Quantity } from '../../executable.js';
import { simulate } from '../simulate.js';
import { standardNormals, uniforms } from '../prng.js';
import { rangeLaw, truncatedStandardNormal, type Domain, type RangeDist } from '../range-law.js';
import { EIGHT_IN_TEN_WORDS, INDEPENDENCE_WORDS, presentAnalysisView, type PresentQuantity } from '../../present/present.js';
import { ENGINE_VERSIONS } from '../../../model-program-turn/run-receipt.js';
import { MODEL_PROGRAM, reopenProgram } from '../../../model-program-turn/program-store.js';
import { withNewRun } from '../../../model-program-turn/program-save.js';
import { seedOf } from '../../../model-program-turn/evaluate.js';
import { bakery, BRIEF } from '../../../model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
const N = 20_000;
const SEED = 20261023;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const ALL = Array.from({ length: N }, (_, i) => i);
/** 1.96 × √(p(1 − p)/20,000): 0.00416 at 0.1 or 0.9, 0.00693 at 0.5. */
const W10 = 0.00416, W50 = 0.00693;

const range = (id: string, low: number, high: number, opts: { mode?: number; basis?: RangeDist['basis']; kind?: RangeDist['range_kind']; domain?: Domain; unit?: string } = {}): Quantity =>
  ({ id, label: id, unit: opts.unit ?? '', reading: 'state', dist: { kind: 'range', low, high, ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    basis: opts.basis ?? 'person_range', range_kind: opts.kind ?? 'plausible', ...(opts.domain !== undefined ? { domain: opts.domain } : {}) } });
const fixed = (id: string, value: number, unit = ''): Quantity => ({ id, label: id, unit, reading: 'state', dist: { kind: 'fixed', value, author: 'person' } });
const model = (quantities: Quantity[], goals: Goal[], options: ExecutableModel['options'] = [{ id: 'hold', label: 'Hold', sets: [] }]): ExecutableModel =>
  ({ periods: 1, period_unit: 'month', quantities, goals, limits: [], options, risks: [], withheld: [] });
const goal = (id: string, quantity: string, target: string, cmp: Goal['cmp'] = '>='): Goal => ({ id, label: id, quantity, cmp, target, aggregation: 'end', window: ONE });
/** Every draw of quantity x alone (its own stream, `q:x`), as the simulator draws it. */
const drawsOf = (x: Quantity): number[] => simulate(model([x, fixed('t', 0)], [goal('g', x.id, 't')]), { seed: SEED, draws: N, record: ALL })
  .recorded!.map((d) => d.values[x.id]![0]!);
const share = (v: readonly number[], f: (x: number) => boolean): number => v.filter(f).length / v.length;
const spread = (d: Quantity, opts = {}) => {
  const r = rangeLaw(d.dist as RangeDist, opts);
  if (r.kind !== 'normal') throw new Error('expected a spread');
  return r;
};
/**
 * A person's hard bounds as drawn BEFORE W10, copied verbatim from staging 3ea44fea (range-law.ts `rangeLaw`, for a 'bounds'
 * range with its own domain, and simulate.ts `drawInputs`, its conditioned branch), on the helpers W10 leaves unchanged
 * (prng.ts `uniforms`, range-law.ts `truncatedStandardNormal`).
 */
function preW10BoundsDraws(x: Quantity, seed: number, draws: number): Float64Array {
  const d = x.dist as RangeDist, { low, high, mode } = d;
  const sd = (high - low) / Math.sqrt(12);
  const centre = mode ?? (low + high) / 2;
  const domains = [d.domain].filter((y): y is Domain => y !== undefined);
  const lower = Math.max(low, ...domains.map((y) => y.min ?? -Infinity));
  const upper = Math.min(high, ...domains.map((y) => y.max ?? Infinity));
  const u = uniforms(seed, `q:${x.id}`, draws), alpha = (lower - centre) / sd, beta = (upper - centre) / sd;
  for (let i = 0; i < draws; i++) u[i] = centre + sd * truncatedStandardNormal(u[i]!, alpha, beta);
  return u;
}

describe('W10: a plausible range is read so that 1 draw in 10 falls below its low end and 1 in 10 above its high end', () => {
  it('(a) symmetric: 10 to 30 around 20 is the Normal on 20 with σ = 10/1.2815516 = 7.80304; 10% below 10, 10% above 30', () => {
    // P(X < 10) = ½ × P(|Z| > 10/7.80304 = 1.2815516) = ½ × 0.2 = 0.1; the same above 30. (Before W10, the √12 Normal,
    // σ = 20/√12 = 5.7735: 1 − Φ(1.7321) = 0.0416 each side, a 92% interval.)
    const x = range('x', 10, 30, { mode: 20 });
    expect(spread(x)).toMatchObject({ ends: 'p10_p90', centre: 20, sd_below: expect.closeTo(7.80304, 4), sd_above: expect.closeTo(7.80304, 4), share_below: 0.5,
      edge_below: false, edge_above: false, lower: -Infinity, upper: Infinity });
    const v = drawsOf(x);
    expect(Math.abs(share(v, (d) => d < 10) - 0.1)).toBeLessThanOrEqual(W10);
    expect(Math.abs(share(v, (d) => d > 30) - 0.1)).toBeLessThanOrEqual(W10);
  });

  it('(b) off-centre 10, 20, 100: equal-mass halves put 10% below 10 and 10% above 100, with 20 the median', () => {
    // σL = (20 − 10)/1.2815516 = 7.80304, σH = (100 − 20)/1.2815516 = 62.42433. P(X < 10) = ½ × P(|Z| > 1.2815516) = 0.1;
    // P(X > 100) = ½ × P(|Z| > 80/62.42433 = 1.2815516) = 0.1; P(X < 20) = ½ exactly. (The continuous split Normal, whose
    // halves meet at a common density, gives 2.2% below 10 and 17.8% above 100: both are far outside ±0.416 points.)
    const x = range('x', 10, 100, { mode: 20 });
    expect(spread(x)).toMatchObject({ centre: 20, sd_below: expect.closeTo(7.80304, 4), sd_above: expect.closeTo(62.42433, 4), share_below: 0.5 });
    const v = drawsOf(x);
    expect(Math.abs(share(v, (d) => d < 10) - 0.1)).toBeLessThanOrEqual(W10);
    expect(Math.abs(share(v, (d) => d > 100) - 0.1)).toBeLessThanOrEqual(W10);
    expect(Math.abs(share(v, (d) => d < 20) - 0.5)).toBeLessThanOrEqual(W50);
  });

  it('(c) an end on a hard edge: 0, 2, 10 with a floor of 0 is never below 0, 10% above 10, and 2 is the median', () => {
    // The low end sits on the floor, so it is that edge (rule 2): the lower half is a half-Normal on [0, 2], σ = 2/1.2815516
    // = 1.56061 truncated at 0 (|Z| ≤ 1.2815516), keeping its ½. The upper half: σH = 8/1.2815516 = 6.24243, P(X > 10) =
    // ½ × 0.2 = 0.1. (Before W10, the √12 Normal on 2, σ 2.8868, unbounded, put 24% below 0 and 0.3% above 10.)
    const x = range('x', 0, 10, { mode: 2, basis: 'olumi_estimate', domain: { min: 0 } });
    expect(spread(x)).toMatchObject({ centre: 2, sd_below: expect.closeTo(1.56061, 4), sd_above: expect.closeTo(6.24243, 4), share_below: 0.5,
      edge_below: true, edge_above: false, lower: 0, upper: Infinity });
    const v = drawsOf(x);
    expect(v.filter((d) => d < 0)).toEqual([]);
    expect(v.filter((d) => d === 0)).toEqual([]); // never clamped onto the edge
    expect(Math.abs(share(v, (d) => d > 10) - 0.1)).toBeLessThanOrEqual(W10);
    expect(Math.abs(share(v, (d) => d < 2) - 0.5)).toBeLessThanOrEqual(W50);
  });

  it('(d) a count "0 to 10" with a floor of 0 and no most likely value: never below 0, 10% above 10, the middle 5 the median', () => {
    // m = the middle, 5; σ = 5/1.2815516 = 3.90152 each side, the lower half truncated at 0 (rule 2). P(X > 10) = 0.1.
    // Contrast: the same range with no floor is strictly inside its (empty) domain, so rule 1 puts 10% below 0.
    const x = range('n', 0, 10, { unit: 'people', domain: { min: 0 } });
    expect(spread(x)).toMatchObject({ centre: 5, sd_below: expect.closeTo(3.90152, 4), sd_above: expect.closeTo(3.90152, 4), edge_below: true, lower: 0 });
    const v = drawsOf(x);
    expect(v.filter((d) => d < 0)).toEqual([]);
    expect(Math.abs(share(v, (d) => d > 10) - 0.1)).toBeLessThanOrEqual(W10);
    expect(Math.abs(share(v, (d) => d < 5) - 0.5)).toBeLessThanOrEqual(W50);
    expect(Math.abs(share(drawsOf(range('n', 0, 10, { unit: 'people' })), (d) => d < 0) - 0.1)).toBeLessThanOrEqual(W10);
  });

  it('(e) a person\'s hard bounds are drawn exactly as before W10, draw for draw', () => {
    // Exact equality, in this process, with the pre-W10 computation (`preW10BoundsDraws`), so no platform's floating point is
    // compared with another's: a pinned sha256 of these draws was fb41a2e0… on macOS and 9c37af28… on Linux CI. "Between 10
    // and 30" around 12, and "between 0 and 10" around 2 with a floor of 0; the chances are the ones recorded on the staging
    // engine before W10 (3ea44fea, engine mp-a04e2cebf944) for the same seed.
    const x = range('x', 10, 30, { mode: 12, kind: 'bounds' }), n = range('n', 0, 10, { mode: 2, kind: 'bounds', domain: { min: 0 } });
    const r = simulate(model([x, n, fixed('t', 15), fixed('t2', 4)], [goal('g', 'x', 't'), goal('g2', 'n', 't2')]), { seed: SEED, draws: N, record: ALL });
    const drawn = (id: string) => r.recorded!.map((d) => d.values[id]![0]!);
    const before = { x: Array.from(preW10BoundsDraws(x, SEED, N)), n: Array.from(preW10BoundsDraws(n, SEED, N)) };
    expect(new Set(before.x).size).toBeGreaterThan(N - 10); // not vacuous: 20,000 distinct draws
    expect(drawn('x')).toEqual(before.x);
    expect(drawn('n')).toEqual(before.n);
    const shareAtLeast = (v: readonly number[], t: number) => v.filter((d) => d >= t).length / v.length;
    expect(r.options[0]!.per_goal.map((g) => ('chance' in g ? g.chance : null))).toEqual([shareAtLeast(before.x, 15), shareAtLeast(before.n, 4)]);
    expect(r.options[0]!.per_goal.map((g) => ('chance' in g ? g.chance : null))).toEqual([0.47295, 0.3278]);
    expect(spread(x)).toMatchObject({ ends: 'hard_bounds', centre: 12, sd: expect.closeTo(20 / Math.sqrt(12), 12), lower: 10, upper: 30 });
  });

  it('seeds stay reproducible: each figure keeps its own stream, one value per draw (W10 changes the law, never a stream)', () => {
    // With no edge, draw i is m + σ·z_i from prng `standardNormals(seed, "q:x")`, σ = σL where z_i < 0, else σH (z's sign
    // picks the half); within an edge, draw i rises with u_i from prng `uniforms(seed, "q:x")` (one uniform, inverse CDF).
    const free = range('x', 10, 100, { mode: 20 }), z = standardNormals(SEED, 'q:x', N);
    const v = drawsOf(free), sL = 10 / 1.2815515655446004, sH = 80 / 1.2815515655446004;
    for (const i of [0, 1, 2, 777, 19_999]) expect(v[i]).toBeCloseTo(20 + (z[i]! < 0 ? sL : sH) * z[i]!, 9);
    const edged = drawsOf(range('x', 0, 10, { mode: 2, domain: { min: 0 } })), u = uniforms(SEED, 'q:x', N);
    const byU = [...u.keys()].sort((a, b) => u[a]! - u[b]!), byX = [...edged.keys()].sort((a, b) => edged[a]! - edged[b]!);
    expect(byX).toEqual(byU);
  });
});

describe('W10: the words say how the range was read, once, and what is assumed about how figures move together', () => {
  const FORBIDDEN = /\b(best|winner|wins?|recommend\w*|should|go with)\b|comes out on top/i;
  const person = (label: string, relation = false): PresentQuantity => ({ label, author: 'person', confirmed: true, ...(relation ? { relation_author: 'person' as const } : {}) });
  /** Members = start + effect × promotions; 'Two' and 'Three' set the promotions. `start` may be a range. */
  const promo = (start: Quantity) => model([start, range('effect', 3, 9, { mode: 4, unit: 'member' }), fixed('none', 0, 'promotion'), fixed('two', 2, 'promotion'),
    fixed('three', 3, 'promotion'), { id: 'members', label: 'members', unit: 'member', reading: 'state', equation: { form: 'effect', base: 'start', terms: [{ coefficient: 'effect', driver: 'none' }] } },
    fixed('target', 112, 'member')], [goal('g', 'members', 'target')],
  [{ id: 'two', label: 'Two promotions', sets: [{ quantity: 'none', to: 'two', from_period: 0 }] }, { id: 'three', label: 'Three promotions', sets: [{ quantity: 'none', to: 'three', from_period: 0 }] }]);
  const LABELS: Record<string, PresentQuantity> = { start: person('Members today'), effect: person('Members per promotion'), none: { label: 'Promotions', author: 'structure' },
    two: person('Two'), three: person('Three'), members: person('Members', true), target: person('Target') };
  const view = (m: ExecutableModel) => presentAnalysisView({ model: m, result: simulate(m, { seed: SEED, draws: 2000 }), quantities: LABELS,
    aims: { g: { confirmed: true, accepted: true } } }) as unknown as Rec;
  const count = (text: string, part: string) => text.split(part).length - 1;
  const ENDS = '‘Members per promotion’ follows Olumi’s provisional reading of your range, 3 to 9 members';
  const READING = `${ENDS}, as the range it falls in 8 times out of 10, with 4 members as the middle value`;

  it('(g) the 8-in-10 reading, its middle value and whose range it is, once in the view (W8 c7.1), each chance naming the range by its ends; the independence clause once per result', () => {
    const one = view(promo(fixed('start', 100, 'member')));
    const faces = (v: Rec) => (v.options as Rec[]).map((o) => o.cell.face as string).join(' ');
    for (const o of one.options) {
      expect(o.cell.kind).toBe('figure');
      expect(count(o.cell.face, ENDS)).toBe(1);
    }
    expect(count(faces(one), READING)).toBe(1);
    expect(count(faces(one), EIGHT_IN_TEN_WORDS)).toBe(1);
    // One uncertain figure: nothing to vary together, so no independence clause (contrast).
    expect(JSON.stringify(one)).not.toContain(INDEPENDENCE_WORDS);
    // Two: the clause once in the whole result, in its notes, never in a chance's own words.
    const two = view(promo(range('start', 95, 105, { unit: 'member' })));
    expect(INDEPENDENCE_WORDS).toBe('Olumi treats these figures as varying independently, except where the model links them.');
    expect(count(JSON.stringify(two), INDEPENDENCE_WORDS)).toBe(1);
    expect(two.goal_chance.notes).toContain(INDEPENDENCE_WORDS);
    expect(count(faces(two), EIGHT_IN_TEN_WORDS)).toBe(2); // each range said in full once in the view
    // The existing negatives: no choice made for the person, no raw line break, words on one line.
    for (const v of [one, two]) {
      const text = JSON.stringify(v);
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toContain('\\n');
      for (const o of v.options) expect(o.cell.face).toBe(o.cell.face.trim().replace(/\s+/g, ' '));
    }
  });

  it('(g) an end on a hard edge is said "never below" it, with the other end\'s 1 in 10, and no 8-in-10 claim', () => {
    const m = promo(range('start', 100, 110, { unit: 'member', domain: { min: 100 } }));
    const face = view(m).options[0].cell.face as string;
    expect(face).toContain('‘Members today’ follows Olumi’s provisional reading of your range, 100 to 110 members, as never below 100 members and above '
      + '110 members only 1 time in 10, with 105 members as the middle value');
    expect(count(face, EIGHT_IN_TEN_WORDS)).toBe(1); // the promotion effect's, not the edged one's
  });

  describe('Codex B1 on #3801: where the domain cuts into a tail, its end is not 1 in 10, so no frequency is said; the law is unchanged', () => {
    // One person's range x, goal x ≥ its middle. Each cut case's true share beyond its cut end is worked out by hand from
    // range-law.ts's halves (each keeps ½, conditioned on its part of the domain): lower half Z in [a, 0], a = (lower − m)/σL,
    // P(X < low) = ½ × (Φ(−1.2815516) − Φ(a)) / (½ − Φ(a)).
    const faceOf = (x: Quantity, middle: number): string => {
      const m = model([x, fixed('t', middle)], [goal('g', 'x', 't')]);
      const v = presentAnalysisView({ model: m, result: simulate(m, { seed: SEED, draws: 2000 }), quantities: { x: person('Figure'), t: person('Target') },
        aims: { g: { confirmed: true, accepted: true } } }) as unknown as Rec;
      expect(v.options[0].cell.kind).toBe('figure');
      return v.options[0].cell.face as string;
    };
    const FREQUENCY = /times? (?:out )?(?:of|in) 10/;
    const CUT: ReadonlyArray<readonly [string, Quantity, number, string]> = [
      // σ = 7.80304, a = −11/7.80304 = −1.40971, Φ(a) = 0.07931: (0.1 − 0.07931)/(0.5 − 0.07931) × ½ = 0.02459 below 10
      // (and above 30), never 0.1.
      ['10, 20, 30 kept within 9 to 31', range('x', 10, 30, { mode: 20, domain: { min: 9, max: 31 } }), 20,
        '‘Figure’ follows Olumi’s provisional reading of your range, 10 to 30, with 20 as the middle value, kept to Olumi’s reading of what it can be (9 to 31)'],
      // The low end is the floor (never below 0); above 2, σH = 0.78030, b = 1.1/0.78030 = 1.40971: the same 0.02459, never 0.1.
      ['0, 1, 2 kept within 0 to 2.1', range('x', 0, 2, { mode: 1, domain: { min: 0, max: 2.1 } }), 1,
        '‘Figure’ follows Olumi’s provisional reading of your range, 0 to 2, as never below 0, with 1 as the middle value, kept to Olumi’s reading of what it can be (0 to 2.1)'],
      // σ = 0.35114, a = −0.5/0.35114 = −1.42395, Φ(a) = 0.07723: 0.02693 below 0.05 (and above 0.95), never 0.1.
      ['a chance 0.05 to 0.95 within 0 to 1', range('x', 0.05, 0.95, { domain: { min: 0, max: 1 } }), 0.5,
        '‘Figure’ follows Olumi’s provisional reading of your range, 0.05 to 0.95, with 0.5 as the middle value, kept to Olumi’s reading of what it can be (0 to 1)'],
    ];
    for (const [name, x, middle, words] of CUT) {
      it(`${name}: no frequency, the middle value (still the median: the law is unchanged)`, () => {
        const face = faceOf(x, middle);
        expect(face).toContain(words);
        expect(face).not.toMatch(FREQUENCY);
        expect(spread(x).share_below).toBe(0.5);
      });
    }
    it('contrast: 10, 20, 30 with no domain is exactly 1 in 10 at each end (row (a)), so the 8-in-10 words stay', () => {
      const free = faceOf(range('x', 10, 30, { mode: 20 }), 20);
      expect(free).toContain('‘Figure’ follows Olumi’s provisional reading of your range, 10 to 30, as the range it falls in 8 times out of 10, with 20 as the middle value');
      expect(count(free, EIGHT_IN_TEN_WORDS)).toBe(1);
    });
    it('T1 (27 Oct): a person\'s hard bounds are read in plain words, never "a bell-shaped spread"', () => {
      const face = faceOf(range('x', 10, 30, { mode: 20, kind: 'bounds' }), 20);
      expect(face).toContain('‘Figure’ follows Olumi’s provisional reading of your range, 10 to 30, held within those bounds: values near its middle are likelier than values near its ends');
      expect(face).not.toContain('bell-shaped');
    });
  });
});

describe('W10: one goal chance under the new reading, units, and stored Runs', () => {
  it('(h) the same model in £ and in £k gives identical chances, with an off-centre range and an edge', () => {
    // Every £ figure ÷ 1000; the law is linear in its ends (each half's σ and its edge scale by 1/1000), so every draw scales
    // and every comparison is the same: identical chances and joint, outcomes ÷ 1000.
    const build = (k: number) => model([range('price', 10 / k, 100 / k, { mode: 20 / k, domain: { min: 0 }, unit: k === 1 ? '£' : '£k' }),
      range('unit_cost', 0, 5 / k, { domain: { min: 0 }, unit: k === 1 ? '£' : '£k' }), range('customers', 80, 120, { mode: 100 }),
      { id: 'margin', label: 'margin', unit: '', reading: 'state', equation: { form: 'definition', op: 'difference', parts: ['price', 'unit_cost'] } },
      { id: 'profit', label: 'profit', unit: '', reading: 'state', equation: { form: 'definition', op: 'product', parts: ['margin', 'customers'] } },
      fixed('target', 2000 / k)], [goal('g', 'profit', 'target')]);
    const pounds = simulate(build(1), { seed: SEED, draws: N }).options[0]!, thousands = simulate(build(1000), { seed: SEED, draws: N }).options[0]!;
    const c = pounds.per_goal[0] as { chance: number };
    expect(c.chance).toBeGreaterThan(0.05);
    expect(c.chance).toBeLessThan(0.95);
    expect(thousands.per_goal).toEqual(pounds.per_goal);
    expect(thousands.joint).toEqual(pounds.joint);
    expect((thousands.outcomes[0] as { p50: number }).p50 * 1000).toBeCloseTo((pounds.outcomes[0] as { p50: number }).p50, 6);
  });

  it('(i) a Run stored by the engine before W10 reopens as "from before an update", never as current', () => {
    // The engine token before W10 is the staging engine's at 3ea44fea (its modules' bytes): mp-a04e2cebf944. W10 changes
    // range-law.ts, simulate.ts and present.ts, so today's token differs, and a Run stored with the old one is not current.
    const PRE_W10_ENGINE = 'mp-a04e2cebf944';
    expect(ENGINE_VERSIONS.engine).toMatch(/^mp-[0-9a-f]{12}$/);
    expect(ENGINE_VERSIONS.engine).not.toBe(PRE_W10_ENGINE);
    const { graph, run } = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf('w10-before-an-update'), person_words: [BRIEF], runs: [] });
    expect(run.receipt.versions.engine).toBe(ENGINE_VERSIONS.engine);
    const stored = JSON.parse(JSON.stringify(graph).split(ENGINE_VERSIONS.engine).join(PRE_W10_ENGINE)) as Rec;
    const reopened = reopenProgram(stored)!;
    expect([reopened.run!.run_id, reopened.run!.receipt.versions.engine, reopened.current, reopened.engine_current]).toEqual([run.run_id, PRE_W10_ENGINE, true, false]);
    const v = reopened.view as Rec;
    expect([v.staleness.stale, v.staleness.reason, v.face_when_stale]).toEqual([true, 'engine_or_format_updated', 'This result is from before an update. Run again to see the chance.']);
    expect([Object.hasOwn(v, 'leader'), v.leader_licence]).toEqual([false, 'withheld']);
    // Contrast: the same Run stored with today's token reopens as current.
    const today = reopenProgram(JSON.parse(JSON.stringify(graph)))!;
    expect([today.current, today.engine_current, (today.view as Rec).staleness.stale]).toEqual([true, true, false]);
  });
});
