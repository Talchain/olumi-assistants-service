/**
 * Natural-unit Monte Carlo simulator for an executable model (spike S2, against the DL's interface of 23 Oct). Pure, synchronous,
 * no I/O: the same model and seed give the same result.
 *
 * Stochastic semantics (the PL's corrections, binding):
 *   - Common random numbers: every uncertain quantity is drawn ONCE per draw index, from its own stream keyed by (seed, id),
 *     and those draws are shared by ALL options. Option switches are never randomised.
 *   - Every goal, the joint and the limits read the SAME draws; the joint is counted draw by draw, never a product of marginals.
 *   - A `range` is read by the one law in `range-law.ts`: a person's 'bounds' with CEE's existing conversion (mapper.ts),
 *     conditioned on [low, high], as the PL ruled (AMEND, 23 Oct); a plausible range (W10, interim) with exactly 1 draw in
 *     10 below its low end and 1 in 10 above its high end, in equal-mass halves around its median, an end on a hard edge
 *     being that edge, drawn within its domain; a risk's occurrence is conditioned on [0, 1]; low = high is that figure. A
 *     chance worked out by an equation is never clipped: outside [0, 1] it is outside the domain (below).
 *   - Time (DL ruling 1, 23 Oct; a quantity's `reading` is 'state' or 'flow'): a model of N periods has boundaries 0..N and
 *     intervals 0..N−1. At each time k = 0..N, (1) the option's sets and the risk effects active at k apply, and (2) every
 *     quantity is evaluated, in dependency order, from the stocks' boundary levels S[k]; then (3) S[k+1] = S[k] + Σ inflows −
 *     Σ outflows, the flows of interval k. A STATE is read at boundaries, a FLOW over intervals:
 *       - `end`: a state reads S[start + periods]; a flow reads interval start + periods − 1;
 *       - `sum` (the PL's ruling, 23 Oct: the compiler's integration-unit rule): the start-of-interval samples
 *         start … start + periods − 1, for a state and a flow alike;
 *       - `mean` / `every` / `max` / `min`: a flow reads intervals start … start + periods − 1; a state reads boundaries
 *         start + 1 … start + periods.
 *     Interval k is the (k+1)th period, so the level after six months is {0, 6} on a state (S[6]), and revenue in months
 *     6–8 (ordinal) is {5, 3} on a flow (intervals 5–7).
 *   - A nonfinite draw (NaN, e.g. a `ratio` by zero, or ±Infinity) is outside the model's domain, never a failed outcome
 *     (DL ruling 3): any such draw in what a goal or limit reads withholds that chance, the joint (for a goal) or within_limits
 *     (for a limit), and joint_within_limits, typed 'invalid_domain' with the count and the quantities. No draw is dropped.
 *     So is a value outside what it can be (executable.ts `domain`, and a risk's chance within [0, 1]; spec §3.7), after the
 *     options and risks act, up to its own rounding (`inside`): NaN at that time, never clamped, and the WHOLE draw is outside
 *     the domain for every condition resting on it, however the value later recovers; so is a value that turns nonfinite
 *     (a ratio by zero) and later recovers. Named among the quantities where it left, not where it was read.
 *     Every chance the simulator withholds is listed once in `SimResult.withheld_chances`; the compiler's `withheld[]` (what
 *     is not in this run) is echoed unchanged into `SimResult.withheld` (executable.ts r3).
 *   - `per` (executable.ts r3): a goal or limit read as agg(quantity) ÷ agg(per), the same aggregation over the same window,
 *     each by its own reading. A zero or nonfinite denominator is outside the domain (withheld). Never with `every`.
 *   - A limits-only run (no goals) has no joint: it is withheld as 'no_goals', and joint_within_limits is within_limits.
 *   - EXACT chances (gold-model ruling 4): a condition whose every draw gives the same reading and the same target, with no
 *     risk in what it rests on, is exact for that option (e.g. "Keep", which adds exactly 0 to an uncertain effect): its
 *     chance is 0 or 1 and its precision is that point, with no Monte Carlo interval. Otherwise the Wilson interval.
 *
 * Where the interface is silent, this file decides as follows (and throws a plain Error where no meaning can be given):
 *   - Only stocks may close a loop: a same-period cycle (including one made by an option's set or a risk) throws.
 *   - An option set makes the quantity read its `to` quantity from `from_period` on; with several sets on one quantity the
 *     latest started one applies. A set on a stock throws (set its start or its flows instead).
 *   - `from_period` (of a set or a risk) may name a quantity: a TIMING, a figure or a range, sampled once per draw with the
 *     other inputs (gold-model ruling 2), ONCE per draw on the shared draw. It takes effect from period ceil(timing), strictly
 *     (the PL's ruling, 23 Oct): a whole number stays at that boundary, a fraction waits to the next, and one beyond the
 *     horizon never takes effect. Its range is conditioned to 0 or more by the compiler (Olumi's conversion); a draw below 0
 *     or NaN is outside the domain (invalid_domain), never clamped. An option can name its own timing.
 *   - A risk reads its occurrence and severity at time `from_period`, under the option (so a mitigation can lower the chance).
 *     It fires where the risk's own uniform draw is below the occurrence. On a non-stock quantity the effect applies at every
 *     time from `from_period`; on a stock it is one shock to the boundary level S[from_period], which then accumulates. An
 *     uncertain severity is drawn in every draw (its stream must not shift) but applied only where the risk fires.
 *   - A goal's target and a limit's bound are read where the window ends (its last boundary or interval). `every` holds when
 *     every reading in the window holds; its aggregated value (for outcomes) is the worst one (min for > / >=, max for < / <=).
 *     `max` / `min` are the window's highest / lowest reading (gold-model ruling 1, executable.ts r3).
 *   - Drivers: each uncertain quantity the option's goals and limits depend on, in model order, except any quantity an option
 *     sets (a switch is a choice, never an uncertainty: gold-model ruling 5). joint_if_low / joint_if_high are
 *     joint_within_limits over the bottom and top third of that quantity's draws.
 *   - Per-draw results (SC0), only when `perDraw` asks: every draw's own value, target and met for each goal and limit, the
 *     headline per draw, which risks fired, and each ranged input's draws, all on the same draw indices (`result.ts` PerDraw).
 *     They are what the paired comparison, value of information, uncertainty share, failure summaries and a tipping point
 *     read; they never change a result and are never stored with a Run.
 */
import type { Aggregation, Cmp, ExecutableModel, Goal, Limit, Option, OptionSet, Quantity, Reading, Risk, Window } from '../executable.js';
import { pairedDifference, wilson95, type PairedDifference } from './paired.js';
import { standardNormals, uniforms } from './prng.js';
import { fromStandardNormal, fromUniform, rangeLaw, truncatedStandardNormal, type RangeDist, type SpreadReading } from './range-law.js';
import type { Chance, ChanceOrWithheld, OptionResult, OutsideCause, PerDraw, PerDrawCondition, PerDrawOption, RecordedDraw, SimResult, WithheldChance, WithheldChanceEntry } from './result.js';

/** A range's law as range-law.ts reads it; `lower` and `upper` are where its draws are conditioned (±Infinity: not). */
type NormalLaw = SpreadReading;
/** A quantity's reading, as the compiler set it (executable.ts r2, S1). */
export const readingOf = (q: Quantity): Reading => q.reading;
/** Gold-model ruling 2, ahead of S1's executable.ts: a `from_period` that names a timing quantity. */
type FromPeriod = number | string;
const fromOf = (x: OptionSet | Risk): FromPeriod => (x as { from_period: FromPeriod }).from_period;

export interface SimulateOptions {
  draws?: number;
  seed: number;
  /** Draw indices whose per-period values are returned in `SimResult.recorded` (evidence only; never changes a result). */
  record?: readonly number[];
  /** SC0: return every draw's own results in `SimResult.per_draw` (in memory only; never changes a result). */
  perDraw?: boolean;
}

/** The SIMULATION precision of a chance (paired.ts owns it, beside the paired gap). */
export { wilson95 };

type Op = 'sum' | 'difference' | 'product' | 'ratio';
type StockNode = { readonly kind: 'stock'; readonly start: number; readonly inflows: readonly number[]; readonly outflows: readonly number[] };
type Node =
  | { readonly kind: 'fixed'; readonly value: number }
  | { readonly kind: 'drawn'; readonly slot: number }
  | { readonly kind: 'definition'; readonly op: Op; readonly parts: readonly number[] }
  | { readonly kind: 'effect'; readonly base: number; readonly coefficients: readonly number[]; readonly drivers: readonly number[] }
  | StockNode;
/** A period: a whole number, or a timing quantity (a figure or a range) read per draw. */
type Timing = { readonly fixed: number } | { readonly q: number };

interface Check {
  readonly id: string;
  readonly q: number;
  readonly ref: number;
  readonly cmp: Cmp;
  readonly aggregation: Aggregation;
  readonly first: number;
  readonly last: number;
  /** executable.ts r3 `per`: the denominator quantity, read over the same window by its own reading. */
  readonly per?: { readonly q: number; readonly first: number; readonly last: number };
}
interface CompiledRisk {
  readonly id: string;
  readonly occurrence: number;
  readonly severity: number;
  readonly on: number;
  readonly add: boolean;
  readonly from: Timing;
}
interface Compiled {
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly nodes: readonly Node[];
  readonly ranged: readonly { readonly q: number; readonly law: NormalLaw }[];
  readonly stocks: readonly number[];
  readonly goals: readonly Check[];
  readonly limits: readonly Check[];
  readonly risks: readonly CompiledRisk[];
  /** Every quantity any option sets: a switch, never a driver. */
  readonly switches: ReadonlySet<number>;
  readonly periods: number;
  /** What each value can be (executable.ts `domain`), ±Infinity where nothing is declared. */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
}
interface PlanSet { readonly from: Timing; readonly to: number }
interface Plan {
  readonly option_id: string;
  readonly order: readonly number[];
  readonly sets: readonly (readonly PlanSet[])[];
  readonly risksOn: readonly (readonly number[])[];
  /** Slots (into `Compiled.ranged`) reported as drivers for this option. */
  readonly drivers: readonly number[];
  /** Per goal and per limit: what it rests on under this option, and whether that includes a risk (then never exact). */
  readonly goalReach: readonly ReadonlySet<number>[];
  readonly limitReach: readonly ReadonlySet<number>[];
  readonly goalRisky: readonly boolean[];
  readonly limitRisky: readonly boolean[];
}
interface Inputs {
  readonly drawn: readonly Float64Array[];
  readonly riskU: readonly Float64Array[];
}

const OPS: ReadonlySet<string> = new Set(['sum', 'difference', 'product', 'ratio']);
const CMPS: ReadonlySet<string> = new Set(['>=', '<=', '>', '<']);
const AGGS: ReadonlySet<string> = new Set(['end', 'sum', 'mean', 'every', 'max', 'min']);
const wholeFrom = (n: number, min: number): boolean => Number.isInteger(n) && n >= min;

function compile(model: ExecutableModel): Compiled {
  const periods = model.periods;
  if (!wholeFrom(periods, 1)) throw new Error(`periods must be a whole number of at least 1, got ${periods}`);
  const index = new Map<string, number>();
  model.quantities.forEach((q, i) => {
    if (index.has(q.id)) throw new Error(`duplicate quantity id "${q.id}"`);
    index.set(q.id, i);
  });
  const ref = (id: string, where: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`${where} names unknown quantity "${id}"`);
    return i;
  };
  const ranged: { q: number; law: NormalLaw }[] = [];
  const chances = new Set(model.risks.map((r) => r.occurrence));
  const nodes = model.quantities.map((q, i): Node => compileNode(q, i, ref, ranged, chances.has(q.id)));
  const stocks = nodes.flatMap((n, i) => (n.kind === 'stock' ? [i] : []));

  /**
   * The ONE window selector, given the aggregation (a `per` denominator reads through it with the same one): a sum takes
   * the start-of-interval samples start … start+periods−1 for a state and a flow alike; otherwise a flow reads intervals
   * start … start+periods−1 and a state boundaries start+1 … start+periods (`end` reads the last of them).
   */
  const windowOf = (w: Window, reading: Reading, aggregation: Aggregation, where: string): [number, number] => {
    if (!wholeFrom(w.start_period, 0) || !wholeFrom(w.periods, 1) || w.start_period + w.periods > periods) {
      throw new Error(`${where}: window from period ${w.start_period} for ${w.periods} periods is not inside the model's ${periods} periods`);
    }
    return reading === 'state' && aggregation !== 'sum' ? [w.start_period + 1, w.start_period + w.periods] : [w.start_period, w.start_period + w.periods - 1];
  };
  const check = (x: Goal | Limit, against: string, kind: string): Check => {
    const where = `${kind} "${x.id}"`;
    if (!CMPS.has(x.cmp)) throw new Error(`${where}: unknown comparison "${x.cmp}"`);
    if (!AGGS.has(x.aggregation)) throw new Error(`${where}: unknown aggregation "${x.aggregation}"`);
    const q = ref(x.quantity, where);
    const [first, last] = windowOf(x.window, readingOf(model.quantities[q]!), x.aggregation, where);
    let per: Check['per'];
    if (x.per !== undefined) {
      if (x.aggregation === 'every') throw new Error(`${where}: a ratio (per) is never read with 'every'`);
      const pq = ref(x.per, `${where}'s per`);
      const [pFirst, pLast] = windowOf(x.window, readingOf(model.quantities[pq]!), x.aggregation, where);
      per = { q: pq, first: pFirst, last: pLast };
    }
    return { id: x.id, q, ref: ref(against, where), cmp: x.cmp, aggregation: x.aggregation, first, last, ...(per !== undefined ? { per } : {}) };
  };
  if (model.goals.length === 0 && model.limits.length === 0) throw new Error('the model has no goals or limits to simulate');
  const goals = model.goals.map((g) => check(g, g.target, 'goal'));
  const limits = model.limits.map((l) => check(l, l.bound, 'limit'));
  unique([...model.goals, ...model.limits].map((x) => x.id), 'goal or limit');

  /** A `from_period`: a whole number, or a timing quantity that has its own figure or range (read per draw). */
  const timing = (from: FromPeriod, where: string): Timing => {
    if (typeof from === 'number') {
      if (!wholeFrom(from, 0)) throw new Error(`${where}: from_period must be a whole number of at least 0`);
      return { fixed: from };
    }
    const q = ref(from, `${where}'s timing`);
    if (model.quantities[q]!.dist === undefined) throw new Error(`${where}: its timing "${from}" must be a figure or a range, not worked out`);
    return { q };
  };
  unique(model.risks.map((r) => r.id), 'risk');
  const risks = model.risks.map((r): CompiledRisk => {
    const where = `risk "${r.id}"`;
    if (r.mode !== 'add' && r.mode !== 'multiply') throw new Error(`${where}: unknown mode "${String(r.mode)}"`);
    const occurrence = ref(r.occurrence, where);
    const dist = model.quantities[occurrence]!.dist;
    if (dist?.kind === 'fixed' && !(dist.value >= 0 && dist.value <= 1)) throw new Error(`${where}: occurrence ${dist.value} is not a chance in 0..1`);
    if (dist?.kind === 'range' && !(dist.low >= 0 && dist.high <= 1)) throw new Error(`${where}: occurrence range ${dist.low} to ${dist.high} is not inside 0..1`);
    return { id: r.id, occurrence, severity: ref(r.severity, where), on: ref(r.effect_on, where), add: r.mode === 'add', from: timing(fromOf(r), where) };
  });
  const switches = new Set(model.options.flatMap((o) => o.sets.flatMap((s) => (index.has(s.quantity) ? [index.get(s.quantity)!] : []))));
  // What each value can be: its domain, and a risk's chance within [0, 1] whatever it records (spec §3.7). Rounding is
  // allowed per value, by its own calculation (`inside`), never by the size of the end.
  const lo = Float64Array.from(model.quantities, (q) => Math.max(q.domain?.min ?? -Infinity, chances.has(q.id) ? 0 : -Infinity));
  const hi = Float64Array.from(model.quantities, (q) => Math.min(q.domain?.max ?? Infinity, chances.has(q.id) ? 1 : Infinity));
  return { ids: model.quantities.map((q) => q.id), index, nodes, ranged, stocks, goals, limits, risks, switches, periods, lo, hi };
}

function unique(ids: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate ${what} id "${id}"`);
    seen.add(id);
  }
}

function compileNode(q: Quantity, i: number, ref: (id: string, where: string) => number, ranged: { q: number; law: NormalLaw }[],
  chance: boolean): Node {
  const where = `quantity "${q.id}"`;
  if (q.reading !== 'state' && q.reading !== 'flow') throw new Error(`${where}: reading must be 'state' or 'flow'`);
  if (q.stock !== undefined && q.reading !== 'state') throw new Error(`${where} is a stock, so it reads as a state`);
  const forms = [q.dist, q.equation, q.stock].filter((x) => x !== undefined).length;
  if (forms !== 1) throw new Error(`${where} must have exactly one of dist, equation, stock (it has ${forms})`);
  if (q.dist !== undefined) {
    if (q.dist.kind === 'fixed') {
      if (!Number.isFinite(q.dist.value)) throw new Error(`${where}: fixed value ${q.dist.value} is not finite`);
      return { kind: 'fixed', value: q.dist.value };
    }
    if (q.dist.kind !== 'range') throw new Error(`${where}: unknown dist kind`);
    // A risk's occurrence is a chance: its mathematical domain is [0, 1].
    const reading = rangeLaw(q.dist as RangeDist, chance ? { domain: { min: 0, max: 1 } } : {});
    if (reading.kind === 'point') return { kind: 'fixed', value: reading.value };
    ranged.push({ q: i, law: reading });
    return { kind: 'drawn', slot: ranged.length - 1 };
  }
  if (q.equation !== undefined) {
    const e = q.equation;
    if (e.form === 'definition') {
      if (!OPS.has(e.op)) throw new Error(`${where}: unknown definition op "${String(e.op)}"`);
      const min = e.op === 'difference' || e.op === 'ratio' ? 2 : 1;
      if (e.parts.length < min) throw new Error(`${where}: ${e.op} needs at least ${min} parts`);
      return { kind: 'definition', op: e.op, parts: e.parts.map((p) => ref(p, where)) };
    }
    if (e.form !== 'effect') throw new Error(`${where}: unknown equation form`);
    return { kind: 'effect', base: ref(e.base, where), coefficients: e.terms.map((t) => ref(t.coefficient, where)),
      drivers: e.terms.map((t) => ref(t.driver, where)) };
  }
  const s = q.stock!;
  return { kind: 'stock', start: ref(s.start, where), inflows: s.inflows.map((x) => ref(x, where)), outflows: s.outflows.map((x) => ref(x, where)) };
}

/**
 * THE ONE DEPENDENCY AUTHORITY (DL 24 Oct, #3728 buddy point 2): what these quantities rest on under one option (null: no
 * option's sets), through every edge: a definition's parts, an effect's base, coefficients and drivers, a stock's start and
 * flows, the option's sets on a quantity (their value AND their timing), and every risk on it (its occurrence, severity AND
 * timing). The simulator's own closure and present's basis and driver inputs both read this, so they never disagree.
 */
export function restsOn(model: ExecutableModel, roots: readonly string[], optionId: string | null): Set<string> {
  const byId = new Map(model.quantities.map((x) => [x.id, x] as const));
  const sets = model.options.find((o) => o.id === optionId)?.sets ?? [];
  const timing = (x: OptionSet | Risk): string[] => (typeof fromOf(x) === 'string' ? [fromOf(x) as string] : []);
  const seen = new Set<string>();
  const todo = [...roots];
  while (todo.length > 0) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const x = byId.get(id);
    if (x?.equation?.form === 'definition') todo.push(...x.equation.parts);
    if (x?.equation?.form === 'effect') todo.push(x.equation.base, ...x.equation.terms.flatMap((t) => [t.coefficient, t.driver]));
    if (x?.stock !== undefined) todo.push(x.stock.start, ...x.stock.inflows, ...x.stock.outflows);
    for (const st of sets) if (st.quantity === id) todo.push(st.to, ...timing(st));
    for (const r of model.risks) if (r.effect_on === id) todo.push(r.occurrence, r.severity, ...timing(r));
  }
  return seen;
}

function planOption(c: Compiled, option: Option, model: ExecutableModel): Plan {
  const n = c.nodes.length;
  const where = `option "${option.id}"`;
  const sets: PlanSet[][] = Array.from({ length: n }, () => []);
  for (const s of option.sets) {
    const q = c.index.get(s.quantity), to = c.index.get(s.to);
    if (q === undefined || to === undefined) throw new Error(`${where} sets unknown quantity "${q === undefined ? s.quantity : s.to}"`);
    if (c.nodes[q]!.kind === 'stock') throw new Error(`${where} sets stock "${s.quantity}"; set its start or its flows instead`);
    const raw = fromOf(s);
    let from: Timing;
    if (typeof raw === 'number') {
      if (!wholeFrom(raw, 0)) throw new Error(`${where}: from_period must be a whole number of at least 0`);
      if (sets[q]!.some((x) => 'fixed' in x.from && x.from.fixed === raw)) throw new Error(`${where} sets "${s.quantity}" twice from period ${raw}`);
      from = { fixed: raw };
    } else {
      const t = c.index.get(raw);
      if (t === undefined) throw new Error(`${where}'s timing names unknown quantity "${raw}"`);
      if (c.nodes[t]!.kind !== 'fixed' && c.nodes[t]!.kind !== 'drawn') throw new Error(`${where}: its timing "${raw}" must be a figure or a range, not worked out`);
      from = { q: t };
    }
    sets[q]!.push({ from, to });
  }
  const risksOn: number[][] = Array.from({ length: n }, () => []);
  c.risks.forEach((r, i) => risksOn[r.on]!.push(i));

  /** Same-period dependencies: what q's value at k is computed from at k. A stock's flows act one period later, so they are not. */
  const deps = (q: number): number[] => {
    const node = c.nodes[q]!;
    const own = node.kind === 'definition' ? [...node.parts]
      : node.kind === 'effect' ? [node.base, ...node.coefficients, ...node.drivers]
        : node.kind === 'stock' ? [node.start] : [];
    return [...own, ...sets[q]!.map((s) => s.to), ...risksOn[q]!.flatMap((r) => [c.risks[r]!.occurrence, c.risks[r]!.severity])];
  };
  const state = new Uint8Array(n);
  const stack: number[] = [];
  const order: number[] = [];
  const visit = (q: number): void => {
    if (state[q] === 2) return;
    if (state[q] === 1) {
      const loop = [...stack.slice(stack.indexOf(q)), q].map((i) => c.ids[i]).join(' → ');
      throw new Error(`${where}: cycle not through a stock: ${loop}`);
    }
    state[q] = 1;
    stack.push(q);
    for (const d of deps(q)) visit(d);
    stack.pop();
    state[q] = 2;
    order.push(q);
  };
  for (let q = 0; q < n; q++) visit(q);

  /** What a quantity rests on through every edge: the one authority, `restsOn`, read by its ids. */
  const closure = (roots: readonly number[]): Set<number> =>
    new Set([...restsOn(model, roots.map((q) => c.ids[q]!), option.id)].flatMap((id) => (c.index.has(id) ? [c.index.get(id)!] : [])));
  /** A goal's or limit's own roots: its quantity, its target or bound, and its denominator (`per`), as present.ts reads them. */
  const roots = (k: Check): number[] => [k.q, k.ref, ...(k.per !== undefined ? [k.per.q] : [])];
  const goalReach = c.goals.map((k) => closure(roots(k))), limitReach = c.limits.map((k) => closure(roots(k)));
  const risky = (on: ReadonlySet<number>): boolean => [...on].some((q) => risksOn[q]!.length > 0);
  const reach = closure([...c.goals, ...c.limits].flatMap(roots));
  const drivers = c.ranged.flatMap((r, slot) => (reach.has(r.q) && !c.switches.has(r.q) ? [slot] : []));
  return { option_id: option.id, order, sets, risksOn, drivers, goalReach, limitReach, goalRisky: goalReach.map(risky), limitRisky: limitReach.map(risky) };
}

function drawInputs(c: Compiled, seed: number, draws: number): Inputs {
  return {
    drawn: c.ranged.map(({ q, law }) => {
      // W10 changes the law, never a stream (range-law.ts, HOW A DRAW IS MADE): the same key, stream and one value per draw.
      const key = `q:${c.ids[q]}`;
      if (law.lower === -Infinity && law.upper === Infinity) {
        // A plausible range with no edge (a person's bounds always have one): z's sign picks the half, |z| draws it.
        const z = standardNormals(seed, key, draws);
        for (let i = 0; i < draws; i++) z[i] = fromStandardNormal(law, z[i]!);
        return z;
      }
      // Conditioned on [lower, upper] by inverse CDF, one uniform per draw: no draw outside, none piled on an end.
      const u = uniforms(seed, key, draws);
      if (law.ends === 'hard_bounds') {
        // A person's bounds: rangeSpread's Normal conditioned on them, exactly as before W10.
        const alpha = (law.lower - law.centre) / law.sd, beta = (law.upper - law.centre) / law.sd;
        for (let i = 0; i < draws; i++) u[i] = law.centre + law.sd * truncatedStandardNormal(u[i]!, alpha, beta);
        return u;
      }
      const draw = fromUniform(law);
      for (let i = 0; i < draws; i++) u[i] = draw(u[i]!);
      return u;
    }),
    riskU: c.risks.map((r) => uniforms(seed, `r:${r.id}`, draws)),
  };
}

/**
 * Rounding, fixed before execution (spec C9). Each value carries a first-order bound on its rounding error (`errs`): an input
 * U × |itself| (a decimal figure is stored to within that), and each operation adds what its operands carry, scaled as the
 * operation scales them, plus U × |its result|. U = 2^-52 is twice the unit roundoff, which covers the second-order terms.
 */
const U = Number.EPSILON;

/**
 * Within what it can be (spec §3.7), up to rounding: finite, and no further outside an end than its own rounding bound `e`
 * plus the end's. So £0.10 + £0.20 is on a ceiling of £0.30, and 100000000 + 0.3 − 100000000 (0.29999999701976776) is on a
 * floor of 0.3, while £1,000,000,000,500 is above a ceiling of £1,000,000,000,000. A value within its ends needs no allowance;
 * one outside an end is excused only by a finite one (an overflow near 1e308 excuses nothing: Codex r3, r4).
 */
const inside = (v: number, e: number, lo: number, hi: number): boolean =>
  Number.isFinite(v)
  && (v >= lo || (Number.isFinite(e) && v >= lo - e - U * Math.abs(lo)))
  && (v <= hi || (Number.isFinite(e) && v <= hi + e + U * Math.abs(hi)));

/** A period in draw d: a whole number, or the strict ceil of the timing quantity's one draw; below 0 or NaN is NaN (invalid). */
function periodOf(t: Timing, c: Compiled, inputs: Inputs, d: number): number {
  if ('fixed' in t) return t.fixed;
  const node = c.nodes[t.q]!;
  const v = node.kind === 'fixed' ? node.value : node.kind === 'drawn' ? inputs.drawn[node.slot]![d]! : NaN;
  return Number.isNaN(v) || v < 0 ? NaN : Math.ceil(v);
}

/** The set active at k: the latest started one (ties: the later in the option's list), -1 for none, INVALID for a set whose timing is outside its domain. */
const INVALID = -2;
function activeSet(sets: readonly PlanSet[], froms: Float64Array, base: number, k: number): number {
  let to = -1, best = -Infinity;
  for (let i = 0; i < sets.length; i++) {
    const f = froms[base + i]!;
    if (Number.isNaN(f)) return INVALID;
    if (f <= k && f >= best) { best = f; to = sets[i]!.to; }
  }
  return to;
}

/** The node's value at `row`; writes its rounding bound (U, above) to errs[at]. */
function evaluate(node: Exclude<Node, StockNode>, vals: Float64Array, errs: Float64Array, row: number, at: number, inputs: Inputs, d: number,
  finiteUncertain?: ReadonlySet<number>): number {
  switch (node.kind) {
    case 'fixed': errs[at] = U * Math.abs(node.value); return node.value;
    case 'drawn': { const v = inputs.drawn[node.slot]![d]!; errs[at] = U * Math.abs(v); return v; }
    case 'effect': {
      let v = vals[row + node.base]!, e = errs[row + node.base]!;
      for (let i = 0; i < node.drivers.length; i++) {
        const coefficient = node.coefficients[i]!, driver = node.drivers[i]!;
        const a = vals[row + coefficient]!, b = vals[row + driver]!;
        // The exact initial read leaves a finite ranged input unsampled. Zero cancels it, not an invalid/unknown value.
        const zero = finiteUncertain && ((a === 0 && finiteUncertain.has(driver)) || (b === 0 && finiteUncertain.has(coefficient)));
        if (zero) continue;
        const ab = a * b;
        v += ab;
        e += Math.abs(a) * errs[row + driver]! + Math.abs(b) * errs[row + coefficient]! + U * Math.abs(ab) + U * Math.abs(v);
      }
      errs[at] = e;
      return v;
    }
    case 'definition': {
      const p = node.parts;
      let v = vals[row + p[0]!]!, e = errs[row + p[0]!]!;
      let finiteUncertainLeft = finiteUncertain?.has(p[0]!) ?? false;
      for (let i = 1; i < p.length; i++) {
        const x = vals[row + p[i]!]!, ex = errs[row + p[i]!]!;
        if (node.op === 'sum') { v += x; e += ex + U * Math.abs(v); }
        else if (node.op === 'difference') { v -= x; e += ex + U * Math.abs(v); }
        else if (node.op === 'product') {
          const zero = finiteUncertain && ((v === 0 && finiteUncertain.has(p[i]!)) || (x === 0 && finiteUncertainLeft));
          e = zero ? 0 : Math.abs(x) * e + Math.abs(v) * ex + U * Math.abs(v * x);
          v = zero ? 0 : v * x;
          finiteUncertainLeft = false; // an unresolved intermediate has no licence to conceal an invalid calculation
        }
        else if (x === 0) { errs[at] = e; return NaN; } // a ratio by zero: outside the domain where it arises (runOption)
        else { const r = v / x; e = (e + Math.abs(r) * ex) / Math.abs(x) + U * Math.abs(r); v = r; }
      }
      errs[at] = e;
      return v;
    }
  }
}

/**
 * The exact period-0 levels of a compiled model, before any option. Reuse the run's evaluator and dependency order,
 * without drawing inputs or running time forward. A range has no exact value, but zero times a finite range is exactly
 * zero. Risk-dependent or invalid values stay absent, including a zero denominator. A stock starts at its start.
 */
export function exactInitialValues(model: ExecutableModel): ReadonlyMap<string, number> {
  const baseline = { ...model, options: [], risks: [] };
  const c = compile(baseline);
  const p = planOption(c, { id: '', label: '', sets: [] }, baseline);
  const risky = new Set(model.risks.map((r) => r.effect_on));
  // Only the compiler's primitive finite ranges have this licence; a missing or invalid intermediate does not.
  const finiteUncertain = new Set(c.ranged.flatMap(({ q, law }) => !risky.has(c.ids[q]!)
    && Number.isFinite(law.centre) && Number.isFinite(law.sd) ? [q] : []));
  const vals = new Float64Array(c.nodes.length).fill(NaN), errs = new Float64Array(c.nodes.length);
  const inputs: Inputs = { drawn: [], riskU: [] };
  for (const q of p.order) {
    const node = c.nodes[q]!;
    if (node.kind === 'drawn' || risky.has(c.ids[q]!)) continue;
    let value: number;
    if (node.kind === 'stock') { value = vals[node.start]!; errs[q] = errs[node.start]!; }
    else value = evaluate(node, vals, errs, 0, q, inputs, 0, finiteUncertain);
    // Outside what it can be (spec §3.7), as the run reads it: no level, so nothing resting on it has one either.
    if (inside(value, errs[q]!, c.lo[q]!, c.hi[q]!)) vals[q] = value;
  }
  return new Map(c.ids.flatMap((id, q) => Number.isFinite(vals[q]) ? [[id, vals[q]!] as const] : []));
}

const below = (cmp: Cmp): boolean => cmp === '<=' || cmp === '<';
const holds = (x: number, cmp: Cmp, y: number): boolean => (cmp === '>=' ? x >= y : cmp === '<=' ? x <= y : cmp === '>' ? x > y : x < y);

/**
 * A condition's aggregated value in one draw, or `null` when a value it reads (in its window, or its target or bound) is
 * NaN or ±Infinity: a nonfinite draw is outside the model's domain, never a failed outcome (DL ruling 3, 23 Oct).
 */
function aggregate(k: Check, vals: Float64Array, n: number, over: { readonly q: number; readonly first: number; readonly last: number } = k): number | null {
  const a = k.aggregation;
  const highest = a === 'max' || (a === 'every' && below(k.cmp));
  const lowest = a === 'min' || (a === 'every' && !below(k.cmp));
  let acc = highest ? -Infinity : lowest ? Infinity : 0;
  for (let t = a === 'end' ? over.last : over.first; t <= over.last; t++) {
    const v = vals[t * n + over.q]!;
    if (!Number.isFinite(v)) return null;
    acc = a === 'end' ? v : highest ? Math.max(acc, v) : lowest ? Math.min(acc, v) : acc + v;
  }
  return a === 'mean' ? acc / (over.last - over.first + 1) : acc;
}

/** Type-7 quantiles of every draw (none is dropped: a condition with a nonfinite draw is withheld before this). */
function quantiles(a: Float64Array): { p10: number; p50: number; p90: number } {
  const s = a.slice().sort();
  const at = (p: number): number => {
    const h = (s.length - 1) * p, lo = Math.floor(h);
    return lo + 1 < s.length && h > lo ? s[lo]! + (h - lo) * (s[lo + 1]! - s[lo]!) : s[lo]!;
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/** The bottom and top third of each uncertain quantity's draws (by value, ties by draw index), shared by every option. */
function terciles(inputs: Inputs, draws: number): { low: Int32Array; high: Int32Array }[] {
  const m = Math.floor(draws / 3);
  return inputs.drawn.map((x) => {
    const idx = Int32Array.from({ length: draws }, (_, i) => i).sort((a, b) => x[a]! - x[b]! || a - b);
    return { low: idx.slice(0, m), high: idx.slice(draws - m) };
  });
}

/** One condition's tally over the draws: met per draw, its aggregated values, nonfinite draws, and whether it is exact. */
/** The most specific cause wins (result.ts `OutsideCause`): what a value did itself, then not finite, then follows. */
const CAUSE_RANK: Readonly<Record<OutsideCause, number>> = { below: 0, above: 0, divided_by_zero: 0, not_finite: 1, follows: 2 };

class Tally {
  readonly met: Uint8Array;
  /** Each draw's aggregated value; NaN in a draw outside the domain. */
  readonly agg: Float64Array;
  /** SC0, only when per-draw results are asked for: each draw's target or bound where the window ends. */
  readonly target?: Float64Array;
  bad = 0;
  readonly badIds = new Set<string>();
  /** What happened to each quantity named in badIds, the first time (result.ts `OutsideCause`). */
  readonly causes = new Map<string, OutsideCause>();
  private lo = Infinity; private hi = -Infinity; private tLo = Infinity; private tHi = -Infinity;
  constructor(draws: number, keepTarget = false) {
    this.met = new Uint8Array(draws); this.agg = new Float64Array(draws);
    if (keepTarget) this.target = new Float64Array(draws);
  }
  /** Records draw d; returns 1 met, 0 not met, -1 outside the domain. `left`: the values that left their domain at any time in
   *  this draw; one the condition rests on (`reach`) makes the whole draw outside the domain for it, however the value
   *  later recovers (spec §3.7), and is named. */
  add(k: Check, vals: Float64Array, n: number, d: number, ids: readonly string[], left: readonly number[], reach: ReadonlySet<number>, why: Uint8Array): number {
    const top = aggregate(k, vals, n), bottom = k.per === undefined ? 1 : aggregate(k, vals, n, k.per);
    const ratio = top === null || bottom === null || bottom === 0 ? null : top / bottom;
    const a = ratio !== null && Number.isFinite(ratio) ? ratio : null, target = vals[k.last * n + k.ref]!;
    if (this.target !== undefined) this.target[d] = target;
    if (a === null || !Number.isFinite(target) || left.some((q) => reach.has(q))) {
      this.bad++;
      this.agg[d] = NaN;
      // Where a value left its domain, that is what happened to it (first, so a quantity that left its floor is never also
      // said to be "not a number" because its own reading then is); elsewhere, why the condition could not be read.
      // Named in the same order as ever; a quantity's cause is the most specific seen (CAUSE_RANK): what it did itself, then
      // "not a finite number", then "follows" (unreadable only because a value it rests on left its domain in this draw).
      const named = (id: string, cause: OutsideCause) => {
        this.badIds.add(id);
        const was = this.causes.get(id);
        if (was === undefined || CAUSE_RANK[cause] < CAUSE_RANK[was]) this.causes.set(id, cause);
      };
      const unread: OutsideCause = left.some((q) => reach.has(q)) ? 'follows' : 'not_finite';
      if (top === null || (a === null && bottom !== null && bottom !== 0)) named(ids[k.q]!, unread);
      if (k.per !== undefined && (bottom === null || bottom === 0)) named(ids[k.per.q]!, bottom === 0 ? 'divided_by_zero' : unread);
      if (!Number.isFinite(target)) named(ids[k.ref]!, unread);
      for (const q of left) if (reach.has(q)) named(ids[q]!, why[q] === 1 ? 'below' : why[q] === 2 ? 'above' : 'not_finite');
      return -1;
    }
    this.lo = Math.min(this.lo, a); this.hi = Math.max(this.hi, a); this.tLo = Math.min(this.tLo, target); this.tHi = Math.max(this.tHi, target);
    const met = holds(a, k.cmp, target) ? 1 : 0;
    this.met[d] = met;
    this.agg[d] = a;
    return met;
  }
  /** Every draw read the same value against the same target. */
  get constant(): boolean { return this.lo === this.hi && this.tLo === this.tHi; }
}

function runOption(c: Compiled, p: Plan, inputs: Inputs, draws: number, thirds: { low: Int32Array; high: Int32Array }[],
  record: ReadonlySet<number>, recorded: RecordedDraw[], perDraw?: PerDrawOption[], headlines?: Int8Array[]): OptionResult {
  const n = c.nodes.length, N = c.periods;
  /** Every quantity at each time k = 0..N, evaluated from the stocks' boundary levels S[k]: boundaries for a state, intervals for a flow. */
  const vals = new Float64Array((N + 1) * n);
  /** Each value's rounding bound (U, above); NaN where the value is NaN because something it reads is. */
  const errs = new Float64Array((N + 1) * n);
  /** Each stock's boundary level S[k] for the time being evaluated, and its rounding bound. */
  const level = new Float64Array(n), levelErr = new Float64Array(n);
  const fired = new Int8Array(c.risks.length);
  const severity = new Float64Array(c.risks.length), severityErr = new Float64Array(c.risks.length);
  const riskFrom = new Float64Array(c.risks.length);
  // Each quantity's sets, resolved per draw (a timing quantity is sampled with the draw).
  const setBase = new Int32Array(n);
  let nSets = 0;
  for (let q = 0; q < n; q++) { setBase[q] = nSets; nSets += p.sets[q]!.length; }
  const setFrom = new Float64Array(nSets);
  const keep = perDraw !== undefined;
  const goals = c.goals.map(() => new Tally(draws, keep)), limits = c.limits.map(() => new Tally(draws, keep));
  const joint = new Uint8Array(draws), within = new Uint8Array(draws), both = new Uint8Array(draws);
  /** The headline per draw (1, 0, −1 outside the domain), kept for the paired gaps (SC2); each risk's firing only when asked (SC0). */
  const headline = new Int8Array(draws);
  const firedIn = keep ? c.risks.map(() => new Int8Array(draws)) : undefined;
  /** The values that left their domain in this draw, once each (`off` marks them), and how (`why`: 1 below its floor, 2 above
   *  its ceiling, 3 not a finite number). */
  const off = new Uint8Array(n), why = new Uint8Array(n), left: number[] = [];
  let jointBad = 0, withinBad = 0, bothBad = 0;

  for (let d = 0; d < draws; d++) {
    fired.fill(-1);
    for (const q of left) off[q] = 0;
    left.length = 0;
    for (let q = 0; q < n; q++) p.sets[q]!.forEach((s, i) => { setFrom[setBase[q]! + i] = periodOf(s.from, c, inputs, d); });
    c.risks.forEach((r, i) => { riskFrom[i] = periodOf(r.from, c, inputs, d); });
    for (let k = 0; k <= N; k++) {
      const row = k * n;
      // (1) + (2): the sets and risk effects active at k, then every quantity in dependency order from the stocks at S[k].
      for (const q of p.order) {
        const node = c.nodes[q]!;
        let v: number, e: number;
        if (node.kind === 'stock') { v = k === 0 ? vals[row + node.start]! : level[q]!; e = k === 0 ? errs[row + node.start]! : levelErr[q]!; }
        else {
          const to = activeSet(p.sets[q]!, setFrom, setBase[q]!, k);
          if (to === INVALID) { v = NaN; e = NaN; }
          else if (to >= 0) { v = vals[row + to]!; e = errs[row + to]!; }
          else { v = evaluate(node, vals, errs, row, row + q, inputs, d); e = errs[row + q]!; }
        }
        for (const r of p.risksOn[q]!) {
          const risk = c.risks[r]!, from = riskFrom[r]!;
          if (Number.isNaN(from)) { v = NaN; e = NaN; continue; }
          // A stock takes its one shock at boundary from_period, which the next boundaries then carry.
          if (k < from || (node.kind === 'stock' && k !== from)) continue;
          if (fired[r]! < 0) {
            // Read once, at from_period, under this option. A chance outside [0, 1] is already NaN here (its domain, below), as
            // is a nonfinite one (an overflow such as 1e200 × 1e200): outside the domain, never a certain or an impossible
            // event, never clipped (Codex r1 #3709, spec §3.7).
            const raw = vals[row + risk.occurrence]!;
            const chance = Number.isFinite(raw) ? raw : NaN;
            fired[r] = Number.isNaN(chance) ? 2 : inputs.riskU[r]![d]! < chance ? 1 : 0;
            severity[r] = vals[row + risk.severity]!;
            severityErr[r] = errs[row + risk.severity]!;
          }
          const s = severity[r]!, es = severityErr[r]!;
          if (fired[r] === 2) { v = NaN; e = NaN; }
          else if (fired[r] === 1 && risk.add) { v += s; e += es + U * Math.abs(v); }
          else if (fired[r] === 1) { e = Math.abs(s) * e + Math.abs(v) * es + U * Math.abs(v * s); v *= s; }
        }
        // A value outside what it can be (a stock below its floor, a chance above 1, a level a shock takes below 0) is outside
        // the model's domain in this draw (spec §3.7): NaN, and the draw is withheld for what rests on it, with the count;
        // never clamped, never dropped. So is a nonfinite one (a ratio by zero, an overflow), however the value later
        // recovers. A NaN `e` is a value NaN because something it reads is (or a timing or a risk's chance outside its
        // domain, as before): it is named where it left, not again here.
        if (!inside(v, e, c.lo[q]!, c.hi[q]!)) {
          if ((Number.isFinite(v) || !Number.isNaN(e)) && off[q] === 0) { off[q] = 1; why[q] = !Number.isFinite(v) ? 3 : v < c.lo[q]! ? 1 : 2; left.push(q); }
          v = NaN; e = NaN;
        }
        vals[row + q] = v;
        errs[row + q] = e;
      }
      // (3) S[k+1] = S[k] + Σ inflows − Σ outflows, every flow read in interval k (from S[k]).
      if (k < N) {
        for (const q of c.stocks) {
          const s = c.nodes[q] as StockNode;
          let next = vals[row + q]!, e = errs[row + q]!;
          for (const i of s.inflows) { next += vals[row + i]!; e += errs[row + i]! + U * Math.abs(next); }
          for (const o of s.outflows) { next -= vals[row + o]!; e += errs[row + o]! + U * Math.abs(next); }
          level[q] = next;
          levelErr[q] = e;
        }
      }
    }

    let allGoals = 1, allLimits = 1, badGoal = false, badLimit = false;
    c.goals.forEach((g, i) => { const m = goals[i]!.add(g, vals, n, d, c.ids, left, p.goalReach[i]!, why); if (m < 0) badGoal = true; else allGoals &= m; });
    c.limits.forEach((l, i) => { const m = limits[i]!.add(l, vals, n, d, c.ids, left, p.limitReach[i]!, why); if (m < 0) badLimit = true; else allLimits &= m; });
    if (badGoal) jointBad++;
    if (badLimit) withinBad++;
    if (badGoal || badLimit) bothBad++;
    joint[d] = allGoals;
    within[d] = allLimits;
    both[d] = allGoals & allLimits;
    headline[d] = badGoal || badLimit ? -1 : both[d]!;
    // fired: 1 fired, 0 not, −1 never read (beyond the horizon), 2 its chance outside its domain (said as −2).
    if (firedIn !== undefined) c.risks.forEach((_, i) => { firedIn[i]![d] = fired[i] === 2 ? -2 : fired[i]!; });

    if (record.has(d)) {
      const values: Record<string, number[]> = {};
      c.ids.forEach((id, q) => { values[id] = Array.from({ length: N + 1 }, (_, k) => vals[k * n + q]!); });
      const risks_fired: Record<string, boolean | null> = {};
      c.risks.forEach((r, i) => { risks_fired[r.id] = fired[i] === 1 ? true : fired[i] === 0 ? false : null; });
      recorded.push({ option_id: p.option_id, draw: d, values, risks_fired });
    }
  }

  const count = (a: Uint8Array): number => a.reduce((s, x) => s + x, 0);
  /** Gold-model ruling 4: exact (0 or 1, no interval) where every draw is the same and no risk is in play; else Wilson. */
  const chanceOf = (k: number, exact: boolean): Chance => {
    const chance = k / draws;
    return { chance, precision_95: exact ? [chance, chance] : wilson95(k, draws) };
  };
  const invalid = (bad: number, quantities: Iterable<string>): WithheldChance =>
    ({ withheld: { reason: 'invalid_domain', count: bad, quantities: [...new Set(quantities)] } });
  /** What happened to each quantity named, over every goal and limit: what it did itself (below, above, divided by zero) over
   *  "not a finite number", and that over "follows" (said only where certain in every tally that names it). */
  const outside: Record<string, OutsideCause> = {};
  for (const t of [...goals, ...limits]) for (const [id, cause] of t.causes) if (outside[id] === undefined || CAUSE_RANK[cause] < CAUSE_RANK[outside[id]!]) outside[id] = cause;
  const exactGoal = goals.map((t, i) => t.constant && !p.goalRisky[i]);
  const exactLimit = limits.map((t, i) => t.constant && !p.limitRisky[i]);
  const goalIds = goals.flatMap((t) => [...t.badIds]), limitIds = limits.flatMap((t) => [...t.badIds]);
  const condition = (t: Tally, exact: boolean): ChanceOrWithheld => (t.bad > 0 ? invalid(t.bad, t.badIds) : chanceOf(count(t.met), exact));
  const summary = (t: Tally) => (t.bad > 0 ? invalid(t.bad, t.badIds) : quantiles(t.agg));
  const meanOver = (a: Uint8Array, idx: Int32Array): number => idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
  const allExactGoals = exactGoal.every(Boolean), allExactLimits = exactLimit.every(Boolean);
  headlines?.push(headline);
  if (perDraw !== undefined) {
    // The tallies' own arrays, handed over: a draw outside the domain has a NaN value and met −1.
    const conditionOf = (t: Tally, id: string): PerDrawCondition => ({ id, value: t.agg, against: t.target!,
      met: Int8Array.from(t.met, (m, d) => (Number.isNaN(t.agg[d]!) ? -1 : m)) });
    perDraw.push({ option_id: p.option_id, goals: c.goals.map((g, i) => conditionOf(goals[i]!, g.id)),
      limits: c.limits.map((l, i) => conditionOf(limits[i]!, l.id)), joint_within_limits: headline,
      risks: c.risks.map((r, i) => ({ risk_id: r.id, fired: firedIn![i]! })) });
  }
  return {
    option_id: p.option_id,
    per_goal: c.goals.map((g, i) => ({ goal_id: g.id, ...condition(goals[i]!, exactGoal[i]!) })),
    joint: c.goals.length === 0 ? { withheld: { reason: 'no_goals', count: 0, quantities: [] } }
      : jointBad > 0 ? invalid(jointBad, goalIds) : chanceOf(count(joint), allExactGoals),
    within_limits: withinBad > 0 ? invalid(withinBad, limitIds) : chanceOf(count(within), allExactLimits),
    joint_within_limits: bothBad > 0 ? invalid(bothBad, [...goalIds, ...limitIds]) : chanceOf(count(both), allExactGoals && allExactLimits),
    outcomes: c.goals.map((g, i) => ({ goal_id: g.id, ...summary(goals[i]!) })),
    per_limit: c.limits.map((l, i) => ({ limit_id: l.id, ...condition(limits[i]!, exactLimit[i]!) })),
    limit_outcomes: c.limits.map((l, i) => ({ limit_id: l.id, ...summary(limits[i]!) })),
    drivers: bothBad > 0 || thirds.length === 0 || Math.floor(draws / 3) === 0 ? [] : p.drivers.map((slot) => ({
      quantity: c.ids[c.ranged[slot]!.q]!,
      joint_if_low: meanOver(both, thirds[slot]!.low),
      joint_if_high: meanOver(both, thirds[slot]!.high),
    })),
    outside,
  };
}

/** Every chance the simulator withheld, once. */
function withheldList(options: readonly OptionResult[]): WithheldChanceEntry[] {
  const w = (option_id: string, scope: WithheldChanceEntry['scope'], x: ChanceOrWithheld, id?: string): WithheldChanceEntry[] =>
    ('withheld' in x ? [{ option_id, scope, ...(id === undefined ? {} : { id }), ...x.withheld }] : []);
  return options.flatMap((o) => [
    ...o.per_goal.flatMap((g) => w(o.option_id, 'goal', g, g.goal_id)),
    ...o.per_limit.flatMap((l) => w(o.option_id, 'limit', l, l.limit_id)),
    ...w(o.option_id, 'joint', o.joint), ...w(o.option_id, 'within_limits', o.within_limits),
    ...w(o.option_id, 'joint_within_limits', o.joint_within_limits),
  ]);
}

/**
 * ADMISSION (alpha G11): what a run of this model costs, from its shape alone, before anything is allocated. `operations`
 * counts runOption's work in every draw for every option: at each time 0..periods, each quantity's visit and every value it
 * reads (an equation's parts or terms, a stock's start and flows, the option's sets, and eight for each risk on it, more
 * than its timing, its fired state read three times and its severity); each condition's window, read twice for a ratio;
 * each set's timing; eight a draw for each risk (its reset, timing, occurrence, chance, uniform and severity); and the sorts (each ranged input's terciles, each
 * condition's quantiles per option). `bytes` is what the run holds at once: each ranged input's draws with its terciles
 * (16 per draw, the sort's index included), each risk's uniforms, every option's tallies and kept headline, one quantile copy and one
 * option's values.
 */
export function costOf(model: ExecutableModel, draws: number): { readonly operations: number; readonly bytes: number } {
  const times = model.periods + 1, options = model.options.length, checks = [...model.goals, ...model.limits];
  const ranged = model.quantities.filter((q) => q.dist?.kind === 'range').length;
  const reads = 8 * model.risks.length + model.quantities.reduce((s, q) => s + 1
    + (q.equation === undefined ? 0 : q.equation.form === 'definition' ? q.equation.parts.length : 1 + 2 * q.equation.terms.length)
    + (q.stock === undefined ? 0 : 1 + q.stock.inflows.length + q.stock.outflows.length), 0);
  const windows = checks.reduce((s, k) => s + 2 * (k.window.periods + 1), 0);
  const sets = model.options.reduce((s, o) => s + o.sets.length, 0);
  const sorts = Math.ceil(Math.log2(draws + 1)) * (ranged + options * checks.length);
  return { operations: draws * (options * (times * reads + windows + 8 * model.risks.length) + sets * (times + 1) + sorts),
    bytes: draws * (16 * ranged + 8 * model.risks.length + options * (9 * checks.length + 4) + 8) + 8 * times * model.quantities.length };
}

export function simulate(model: ExecutableModel, opts: SimulateOptions): SimResult {
  const draws = opts.draws ?? 10000;
  if (!wholeFrom(draws, 1)) throw new Error(`draws must be a whole number of at least 1, got ${draws}`);
  if (!Number.isFinite(opts.seed)) throw new Error(`seed must be a finite number, got ${opts.seed}`);
  for (const d of opts.record ?? []) if (!Number.isInteger(d) || d < 0 || d >= draws) throw new Error(`record: draw ${d} is not in 0..${draws - 1}`);
  const c = compile(model);
  if (model.options.length === 0) throw new Error('the model has no options to simulate');
  unique(model.options.map((o) => o.id), 'option');
  const plans = model.options.map((o) => planOption(c, o, model));
  const inputs = drawInputs(c, opts.seed, draws);
  const thirds = terciles(inputs, draws);
  const record = new Set(opts.record ?? []);
  const recorded: RecordedDraw[] = [];
  const perDraw: PerDrawOption[] | undefined = opts.perDraw === true ? [] : undefined;
  const headlines: Int8Array[] = [];
  const options = plans.map((p) => runOption(c, p, inputs, draws, thirds, record, recorded, perDraw, headlines));
  // SC2: every pair of options on the same draws, a − b, in model order; exact where both headlines are fixed in every draw.
  const exactHeadline = (o: OptionResult): boolean => !('withheld' in o.joint_within_limits) && o.joint_within_limits.precision_95[0] === o.joint_within_limits.precision_95[1];
  const paired: { a: string; b: string; joint_within_limits: PairedDifference }[] = options.flatMap((oa, i) => options.slice(i + 1).map((ob, k) => ({
    a: oa.option_id, b: ob.option_id, joint_within_limits: pairedDifference(headlines[i]!, headlines[i + 1 + k]!, exactHeadline(oa) && exactHeadline(ob)) })));
  // The compiler's withheld[] is echoed unchanged (executable.ts r3); an older model without it echoes none.
  const echoed = (model.withheld ?? []).map((x) => ({ ...x }));
  const per_draw: PerDraw | undefined = perDraw === undefined ? undefined
    : { inputs: Object.fromEntries(c.ranged.map((r, slot) => [c.ids[r.q]!, inputs.drawn[slot]!] as const)), options: perDraw };
  return { draws, seed: opts.seed, options, withheld: echoed, withheld_chances: withheldList(options), paired, ...(opts.record !== undefined ? { recorded } : {}),
    ...(per_draw !== undefined ? { per_draw } : {}) };
}
