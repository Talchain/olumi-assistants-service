/**
 * Natural-unit Monte Carlo simulator for an executable model (spike S2, against the DL's interface of 23 Oct). Pure, synchronous,
 * no I/O: the same model and seed give the same result.
 *
 * Stochastic semantics (the PL's corrections, binding):
 *   - Common random numbers: every uncertain quantity is drawn ONCE per draw index, from its own stream keyed by (seed, id),
 *     and those draws are shared by ALL options. Option switches are never randomised.
 *   - Every goal, the joint and the limits read the SAME draws; the joint is counted draw by draw, never a product of marginals.
 *   - A `range` is read with CEE's existing range conversion and its sign rule, reused (`range-law.ts`, which cites mapper.ts):
 *     a Normal draw, the figure alone, or held (a plain Error: the compiler withholds what rests on it). A chance (a risk's
 *     occurrence) is clipped to [0, 1].
 *   - Time (DL ruling 1, 23 Oct; a quantity's `reading` is 'state' or 'flow'): a model of N periods has boundaries 0..N and
 *     intervals 0..N−1. At each time k = 0..N, (1) the option's sets and the risk effects active at k apply, and (2) every
 *     quantity is evaluated, in dependency order, from the stocks' boundary levels S[k]; then (3) S[k+1] = S[k] + Σ inflows −
 *     Σ outflows, the flows of interval k. A STATE is read at boundaries, a FLOW over intervals:
 *       - `end`: a state reads S[start + periods]; a flow reads interval start + periods − 1;
 *       - `sum` / `mean` / `every`: a flow reads intervals start … start + periods − 1; a state reads boundaries
 *         start + 1 … start + periods.
 *     So the level after six months is {0, 6} on a state (S[6]); revenue in months 6–8 is {6, 3} on a flow (intervals 6–8).
 *   - A nonfinite draw (NaN, e.g. a `ratio` by zero, or ±Infinity) is outside the model's domain, never a failed outcome
 *     (DL ruling 3): any such draw in what a goal or limit reads withholds that chance, the joint (for a goal) or within_limits
 *     (for a limit), and joint_within_limits, typed 'invalid_domain' with the count and the quantities. No draw is dropped.
 *   - Fixed inputs only: every draw is the same, the chance is exactly 0 or 1, and its precision is that point.
 *
 * Where the interface is silent, this file decides as follows (and throws a plain Error where no meaning can be given):
 *   - Only stocks may close a loop: a same-period cycle (including one made by an option's set or a risk) throws.
 *   - An option set makes the quantity read its `to` quantity from `from_period` on; with several sets on one quantity the
 *     latest started one applies. A set on a stock throws (set its start or its flows instead).
 *   - A risk reads its occurrence and severity at time `from_period`, under the option (so a mitigation can lower the chance).
 *     It fires where the risk's own uniform draw is below the occurrence. On a non-stock quantity the effect applies at every
 *     time from `from_period`; on a stock it is one shock to the boundary level S[from_period], which then accumulates. An uncertain severity is drawn in every draw (its stream must not shift) but applied only where the
 *     risk fires.
 *   - A goal's target and a limit's bound are read where the window ends (its last boundary or interval). `every` holds when
 *     every reading in the window holds; its aggregated value (for outcomes) is the worst one (min for > / >=, max for < / <=).
 *   - Drivers: each uncertain quantity the option's goals and limits depend on, and whose own draw the option uses (not one it
 *     sets from period 0), in model order. joint_if_low / joint_if_high are joint_within_limits over the bottom and top third
 *     of that quantity's draws.
 */
import type { Aggregation, Cmp, ExecutableModel, Option, Quantity, Reading, Window } from '../executable.js';
import { standardNormals, uniforms } from './prng.js';
import { rangeLaw } from './range-law.js';
import type { Chance, OptionResult, RecordedDraw, SimResult, Withheld } from './result.js';

interface NormalLaw {
  readonly centre: number;
  readonly sd: number;
  /** A chance's draws are clipped to [0, 1]. */
  readonly chance: boolean;
}
/** A quantity's reading, as the compiler set it (executable.ts r2, S1). */
export const readingOf = (q: Quantity): Reading => q.reading;

export interface SimulateOptions {
  draws?: number;
  seed: number;
  /** Draw indices whose per-period values are returned in `SimResult.recorded` (evidence only; never changes a result). */
  record?: readonly number[];
}

const Z95 = 1.959963984540054;

/** Wilson score interval at 95% for k successes in n draws: the SIMULATION precision of a chance. */
export function wilson95(k: number, n: number): [number, number] {
  const p = k / n, z2 = Z95 * Z95, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

type Op = 'sum' | 'difference' | 'product' | 'ratio';
type StockNode = { readonly kind: 'stock'; readonly start: number; readonly inflows: readonly number[]; readonly outflows: readonly number[] };
type Node =
  | { readonly kind: 'fixed'; readonly value: number }
  | { readonly kind: 'drawn'; readonly slot: number }
  | { readonly kind: 'definition'; readonly op: Op; readonly parts: readonly number[] }
  | { readonly kind: 'effect'; readonly base: number; readonly coefficients: readonly number[]; readonly drivers: readonly number[] }
  | StockNode;

interface Check {
  readonly id: string;
  readonly q: number;
  readonly ref: number;
  readonly cmp: Cmp;
  readonly aggregation: Aggregation;
  readonly first: number;
  readonly last: number;
}
interface CompiledRisk {
  readonly id: string;
  readonly occurrence: number;
  readonly severity: number;
  readonly on: number;
  readonly add: boolean;
  readonly from: number;
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
  readonly periods: number;
}
interface Plan {
  readonly option_id: string;
  readonly order: readonly number[];
  readonly sets: readonly (readonly { readonly from: number; readonly to: number }[] | undefined)[];
  readonly risksOn: readonly (readonly number[])[];
  /** Slots (into `Compiled.ranged`) reported as drivers for this option. */
  readonly drivers: readonly number[];
}
interface Inputs {
  readonly drawn: readonly Float64Array[];
  readonly riskU: readonly Float64Array[];
}

const OPS: ReadonlySet<string> = new Set(['sum', 'difference', 'product', 'ratio']);
const CMPS: ReadonlySet<string> = new Set(['>=', '<=', '>', '<']);
const AGGS: ReadonlySet<string> = new Set(['end', 'sum', 'mean', 'every']);
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

  /** The time indices a window reads: intervals start … start+periods−1 for a flow, boundaries start+1 … start+periods for a state. */
  const windowOf = (w: Window, reading: Reading, where: string): [number, number] => {
    if (!wholeFrom(w.start_period, 0) || !wholeFrom(w.periods, 1) || w.start_period + w.periods > periods) {
      throw new Error(`${where}: window from period ${w.start_period} for ${w.periods} periods is not inside the model's ${periods} periods`);
    }
    return reading === 'state' ? [w.start_period + 1, w.start_period + w.periods] : [w.start_period, w.start_period + w.periods - 1];
  };
  const check = (id: string, quantity: string, cmp: Cmp, against: string, aggregation: Aggregation, w: Window, kind: string): Check => {
    const where = `${kind} "${id}"`;
    if (!CMPS.has(cmp)) throw new Error(`${where}: unknown comparison "${cmp}"`);
    if (!AGGS.has(aggregation)) throw new Error(`${where}: unknown aggregation "${aggregation}"`);
    const q = ref(quantity, where);
    const [first, last] = windowOf(w, readingOf(model.quantities[q]!), where);
    return { id, q, ref: ref(against, where), cmp, aggregation, first, last };
  };
  if (model.goals.length === 0) throw new Error('the model has no goals to simulate');
  const goals = model.goals.map((g) => check(g.id, g.quantity, g.cmp, g.target, g.aggregation, g.window, 'goal'));
  const limits = model.limits.map((l) => check(l.id, l.quantity, l.cmp, l.bound, l.aggregation, l.window, 'limit'));
  unique([...model.goals, ...model.limits].map((x) => x.id), 'goal or limit');

  unique(model.risks.map((r) => r.id), 'risk');
  const risks = model.risks.map((r): CompiledRisk => {
    const where = `risk "${r.id}"`;
    if (r.mode !== 'add' && r.mode !== 'multiply') throw new Error(`${where}: unknown mode "${String(r.mode)}"`);
    if (!wholeFrom(r.from_period, 0)) throw new Error(`${where}: from_period must be a whole number of at least 0`);
    const occurrence = ref(r.occurrence, where);
    const dist = model.quantities[occurrence]!.dist;
    if (dist?.kind === 'fixed' && !(dist.value >= 0 && dist.value <= 1)) throw new Error(`${where}: occurrence ${dist.value} is not a chance in 0..1`);
    if (dist?.kind === 'range' && !(dist.low >= 0 && dist.high <= 1)) throw new Error(`${where}: occurrence range ${dist.low} to ${dist.high} is not inside 0..1`);
    return { id: r.id, occurrence, severity: ref(r.severity, where), on: ref(r.effect_on, where), add: r.mode === 'add', from: r.from_period };
  });
  return { ids: model.quantities.map((q) => q.id), index, nodes, ranged, stocks, goals, limits, risks, periods };
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
    const reading = rangeLaw(q.dist, { chance });
    if (reading.kind === 'held') throw new Error(`${where} is held: ${reading.reason}; the compiler must withhold what rests on it`);
    if (reading.kind === 'point') return { kind: 'fixed', value: reading.value };
    ranged.push({ q: i, law: { centre: reading.centre, sd: reading.sd, chance } });
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

function planOption(c: Compiled, option: Option): Plan {
  const n = c.nodes.length;
  const sets: { from: number; to: number }[][] = Array.from({ length: n }, () => []);
  for (const s of option.sets) {
    const where = `option "${option.id}"`;
    const q = c.index.get(s.quantity), to = c.index.get(s.to);
    if (q === undefined || to === undefined) throw new Error(`${where} sets unknown quantity "${q === undefined ? s.quantity : s.to}"`);
    if (c.nodes[q]!.kind === 'stock') throw new Error(`${where} sets stock "${s.quantity}"; set its start or its flows instead`);
    if (!wholeFrom(s.from_period, 0)) throw new Error(`${where}: from_period must be a whole number of at least 0`);
    if (sets[q]!.some((x) => x.from === s.from_period)) throw new Error(`${where} sets "${s.quantity}" twice from period ${s.from_period}`);
    sets[q]!.push({ from: s.from_period, to });
  }
  for (const list of sets) list.sort((a, b) => a.from - b.from);
  const risksOn: number[][] = Array.from({ length: n }, () => []);
  c.risks.forEach((r, i) => risksOn[r.on]!.push(i));

  /** Same-period dependencies: what q's value at t is computed from at t. A stock's flows act one period later, so they are not. */
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
      throw new Error(`option "${option.id}": cycle not through a stock: ${loop}`);
    }
    state[q] = 1;
    stack.push(q);
    for (const d of deps(q)) visit(d);
    stack.pop();
    state[q] = 2;
    order.push(q);
  };
  for (let q = 0; q < n; q++) visit(q);

  // What the goals and limits depend on, through every edge (a stock's flows included).
  const reach = new Set<number>();
  const pending = [...c.goals, ...c.limits].flatMap((k) => [k.q, k.ref]);
  while (pending.length > 0) {
    const q = pending.pop()!;
    if (reach.has(q)) continue;
    reach.add(q);
    const node = c.nodes[q]!;
    pending.push(...deps(q), ...(node.kind === 'stock' ? [...node.inflows, ...node.outflows] : []));
  }
  const drivers = c.ranged.flatMap((r, slot) => (reach.has(r.q) && sets[r.q]![0]?.from !== 0 ? [slot] : []));
  return { option_id: option.id, order, sets, risksOn, drivers };
}

function drawInputs(c: Compiled, seed: number, draws: number): Inputs {
  return {
    drawn: c.ranged.map(({ q, law }) => {
      const z = standardNormals(seed, `q:${c.ids[q]}`, draws);
      for (let i = 0; i < draws; i++) z[i] = law.centre + law.sd * z[i]!;
      if (law.chance) for (let i = 0; i < draws; i++) z[i] = clip01(z[i]!);
      return z;
    }),
    riskU: c.risks.map((r) => uniforms(seed, `r:${r.id}`, draws)),
  };
}

/** A chance is clipped to [0, 1] (DL ruling, 23 Oct). NaN stays NaN. */
const clip01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function activeSet(sets: readonly { from: number; to: number }[] | undefined, t: number): number {
  let to = -1;
  if (sets !== undefined) for (const s of sets) { if (s.from > t) break; to = s.to; }
  return to;
}

function evaluate(node: Exclude<Node, StockNode>, vals: Float64Array, row: number, inputs: Inputs, d: number): number {
  switch (node.kind) {
    case 'fixed': return node.value;
    case 'drawn': return inputs.drawn[node.slot]![d]!;
    case 'effect': {
      let v = vals[row + node.base]!;
      for (let i = 0; i < node.drivers.length; i++) v += vals[row + node.coefficients[i]!]! * vals[row + node.drivers[i]!]!;
      return v;
    }
    case 'definition': {
      const p = node.parts;
      let v = vals[row + p[0]!]!;
      for (let i = 1; i < p.length; i++) {
        const x = vals[row + p[i]!]!;
        if (node.op === 'sum') v += x;
        else if (node.op === 'difference') v -= x;
        else if (node.op === 'product') v *= x;
        else if (x === 0) return NaN;
        else v /= x;
      }
      return v;
    }
  }
}

const below = (cmp: Cmp): boolean => cmp === '<=' || cmp === '<';
const holds = (x: number, cmp: Cmp, y: number): boolean => (cmp === '>=' ? x >= y : cmp === '<=' ? x <= y : cmp === '>' ? x > y : x < y);

/**
 * A condition's aggregated value in one draw, or `null` when a value it reads (in its window, or its target or bound) is
 * NaN or ±Infinity: a nonfinite draw is outside the model's domain, never a failed outcome (DL ruling 3, 23 Oct).
 */
function aggregate(k: Check, vals: Float64Array, n: number): number | null {
  const every = k.aggregation === 'every', worstIsMax = below(k.cmp);
  let acc = every ? (worstIsMax ? -Infinity : Infinity) : 0;
  for (let t = k.aggregation === 'end' ? k.last : k.first; t <= k.last; t++) {
    const v = vals[t * n + k.q]!;
    if (!Number.isFinite(v)) return null;
    acc = k.aggregation === 'end' ? v : !every ? acc + v : worstIsMax ? Math.max(acc, v) : Math.min(acc, v);
  }
  return k.aggregation === 'mean' ? acc / (k.last - k.first + 1) : acc;
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

function runOption(c: Compiled, p: Plan, inputs: Inputs, draws: number, thirds: { low: Int32Array; high: Int32Array }[],
  record: ReadonlySet<number>, recorded: RecordedDraw[]): OptionResult {
  const n = c.nodes.length, N = c.periods;
  /** Every quantity at each time k = 0..N, evaluated from the stocks' boundary levels S[k]: boundaries for a state, intervals for a flow. */
  const vals = new Float64Array((N + 1) * n);
  /** Each stock's boundary level S[k] for the time being evaluated. */
  const level = new Float64Array(n);
  const fired = new Int8Array(c.risks.length);
  const severity = new Float64Array(c.risks.length);
  const goalMet = c.goals.map(() => new Uint8Array(draws));
  const goalAgg = c.goals.map(() => new Float64Array(draws));
  const goalBad = c.goals.map(() => 0), limitBad = c.limits.map(() => 0);
  /** Which quantities a condition read a nonfinite value from (its own, or its target or bound). */
  const goalBadIds = c.goals.map(() => new Set<string>()), limitBadIds = c.limits.map(() => new Set<string>());
  const joint = new Uint8Array(draws), within = new Uint8Array(draws), both = new Uint8Array(draws);
  let jointBad = 0, withinBad = 0, bothBadDraws = 0;

  for (let d = 0; d < draws; d++) {
    fired.fill(-1);
    for (let k = 0; k <= N; k++) {
      const row = k * n;
      // (1) + (2): the sets and risk effects active at k, then every quantity in dependency order from the stocks at S[k].
      for (const q of p.order) {
        const node = c.nodes[q]!;
        let v: number;
        if (node.kind === 'stock') v = k === 0 ? vals[row + node.start]! : level[q]!;
        else {
          const to = activeSet(p.sets[q], k);
          v = to >= 0 ? vals[row + to]! : evaluate(node, vals, row, inputs, d);
        }
        for (const r of p.risksOn[q]!) {
          const risk = c.risks[r]!;
          // A stock takes its one shock at boundary from_period, which the next boundaries then carry.
          if (k < risk.from || (node.kind === 'stock' && k !== risk.from)) continue;
          if (fired[r]! < 0) {
            // Read once, at from_period, under this option. A chance is clipped to [0, 1].
            const chance = clip01(vals[row + risk.occurrence]!);
            fired[r] = Number.isNaN(chance) ? 2 : inputs.riskU[r]![d]! < chance ? 1 : 0;
            severity[r] = vals[row + risk.severity]!;
          }
          if (fired[r] === 2) v = NaN;
          else if (fired[r] === 1) v = risk.add ? v + severity[r]! : v * severity[r]!;
        }
        vals[row + q] = v;
      }
      // (3) S[k+1] = S[k] + Σ inflows − Σ outflows, every flow read in interval k (from S[k]).
      if (k < N) {
        for (const q of c.stocks) {
          const s = c.nodes[q] as StockNode;
          let next = vals[row + q]!;
          for (const i of s.inflows) next += vals[row + i]!;
          for (const o of s.outflows) next -= vals[row + o]!;
          level[q] = next;
        }
      }
    }

    let allGoals = 1, allLimits = 1, badGoal = false, badLimit = false;
    c.goals.forEach((g, i) => {
      const a = aggregate(g, vals, n), target = vals[g.last * n + g.ref]!;
      if (a === null || !Number.isFinite(target)) {
        goalBad[i]!++; badGoal = true;
        if (a === null) goalBadIds[i]!.add(c.ids[g.q]!);
        if (!Number.isFinite(target)) goalBadIds[i]!.add(c.ids[g.ref]!);
        return;
      }
      const met = holds(a, g.cmp, target) ? 1 : 0;
      goalMet[i]![d] = met;
      goalAgg[i]![d] = a;
      allGoals &= met;
    });
    c.limits.forEach((l, i) => {
      const a = aggregate(l, vals, n), bound = vals[l.last * n + l.ref]!;
      if (a === null || !Number.isFinite(bound)) {
        limitBad[i]!++; badLimit = true;
        if (a === null) limitBadIds[i]!.add(c.ids[l.q]!);
        if (!Number.isFinite(bound)) limitBadIds[i]!.add(c.ids[l.ref]!);
        return;
      }
      allLimits &= holds(a, l.cmp, bound) ? 1 : 0;
    });
    if (badGoal) jointBad++;
    if (badLimit) withinBad++;
    if (badGoal || badLimit) bothBadDraws++;
    joint[d] = allGoals;
    within[d] = allLimits;
    both[d] = allGoals & allLimits;

    if (record.has(d)) {
      const values: Record<string, number[]> = {};
      c.ids.forEach((id, q) => { values[id] = Array.from({ length: N + 1 }, (_, k) => vals[k * n + q]!); });
      const risks_fired: Record<string, boolean | null> = {};
      c.risks.forEach((r, i) => { risks_fired[r.id] = fired[i] === 1 ? true : fired[i] === 0 ? false : null; });
      recorded.push({ option_id: p.option_id, draw: d, values, risks_fired });
    }
  }

  const stochastic = c.ranged.length > 0 || c.risks.length > 0;
  const count = (a: Uint8Array): number => a.reduce((s, x) => s + x, 0);
  const chanceOf = (k: number): Chance => {
    const chance = k / draws;
    return { chance, precision_95: stochastic ? wilson95(k, draws) : [chance, chance] };
  };
  const invalid = (bad: number, quantities: readonly string[]): Withheld =>
    ({ withheld: { reason: 'invalid_domain', count: bad, quantities: [...new Set(quantities)] } });
  const badGoalIds = goalBadIds.flatMap((x) => [...x]);
  const badLimitIds = limitBadIds.flatMap((x) => [...x]);
  const jointW = jointBad > 0 ? invalid(jointBad, badGoalIds) : chanceOf(count(joint));
  const withinW = withinBad > 0 ? invalid(withinBad, badLimitIds) : chanceOf(count(within));
  const bothBad = jointBad > 0 || withinBad > 0;
  const meanOver = (a: Uint8Array, idx: Int32Array): number => idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
  return {
    option_id: p.option_id,
    per_goal: c.goals.map((g, i) => ({ goal_id: g.id,
      ...(goalBad[i]! > 0 ? invalid(goalBad[i]!, [...goalBadIds[i]!]) : chanceOf(count(goalMet[i]!))) })),
    joint: jointW,
    within_limits: withinW,
    joint_within_limits: bothBad ? invalid(bothBadDraws, [...badGoalIds, ...badLimitIds]) : chanceOf(count(both)),
    outcomes: c.goals.map((g, i) => ({ goal_id: g.id,
      ...(goalBad[i]! > 0 ? invalid(goalBad[i]!, [...goalBadIds[i]!]) : quantiles(goalAgg[i]!)) })),
    drivers: bothBad || thirds.length === 0 || Math.floor(draws / 3) === 0 ? [] : p.drivers.map((slot) => ({
      quantity: c.ids[c.ranged[slot]!.q]!,
      joint_if_low: meanOver(both, thirds[slot]!.low),
      joint_if_high: meanOver(both, thirds[slot]!.high),
    })),
  };
}

export function simulate(model: ExecutableModel, opts: SimulateOptions): SimResult {
  const draws = opts.draws ?? 10000;
  if (!wholeFrom(draws, 1)) throw new Error(`draws must be a whole number of at least 1, got ${draws}`);
  if (!Number.isFinite(opts.seed)) throw new Error(`seed must be a finite number, got ${opts.seed}`);
  for (const d of opts.record ?? []) if (!Number.isInteger(d) || d < 0 || d >= draws) throw new Error(`record: draw ${d} is not in 0..${draws - 1}`);
  const c = compile(model);
  if (model.options.length === 0) throw new Error('the model has no options to simulate');
  unique(model.options.map((o) => o.id), 'option');
  const plans = model.options.map((o) => planOption(c, o));
  const inputs = drawInputs(c, opts.seed, draws);
  const thirds = terciles(inputs, draws);
  const record = new Set(opts.record ?? []);
  const recorded: RecordedDraw[] = [];
  const options = plans.map((p) => runOption(c, p, inputs, draws, thirds, record, recorded));
  return { draws, seed: opts.seed, options, ...(opts.record !== undefined ? { recorded } : {}) };
}
