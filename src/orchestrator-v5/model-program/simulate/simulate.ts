/**
 * Natural-unit Monte Carlo simulator for an executable model (spike S2, against the DL's interface of 23 Oct). Pure, synchronous,
 * no I/O: the same model and seed give the same result.
 *
 * Stochastic semantics (the PL's corrections, binding):
 *   - Common random numbers: every uncertain quantity is drawn ONCE per draw index, from its own stream keyed by (seed, id),
 *     and those draws are shared by ALL options. Option switches are never randomised.
 *   - Every goal, the joint and the limits read the SAME draws; the joint is counted draw by draw, never a product of marginals.
 *   - A `range` is drawn with CEE's existing range conversion, reused (`range-law.ts`, which cites mapper.ts).
 *   - Per period t = 0..periods−1: (1) the option's sets and the risk effects active at t apply; (2) every non-stock quantity
 *     is evaluated, in dependency order, from the stocks at t; (3) stock[t+1] = stock[t] + Σ inflows − Σ outflows.
 *   - `ratio` by zero makes that draw NaN; NaN never meets a goal or a limit, and the count is reported (`nan_draws`).
 *   - Fixed inputs only: every draw is the same, the chance is exactly 0 or 1, and its precision is that point.
 *
 * Where the interface is silent, this file decides as follows (and throws a plain Error where no meaning can be given):
 *   - A stock's value at period t is its level at the start of t, before t's flows: period 0 reads `start`, period T reads the
 *     level after T periods of flows (so a reading after T periods needs periods ≥ T + 1).
 *   - Only stocks may close a loop: a same-period cycle (including one made by an option's set or a risk) throws.
 *   - An option set makes the quantity read its `to` quantity from `from_period` on; with several sets on one quantity the
 *     latest started one applies. A set on a stock throws (set its start or its flows instead).
 *   - A risk reads its occurrence and severity at its `from_period`, under the option (so a mitigation can lower the chance).
 *     It fires where the risk's own uniform draw is below the occurrence. On a non-stock quantity the effect applies to every
 *     period from `from_period`; on a stock it is one shock to the level at `from_period`, which then accumulates. An
 *     uncertain severity is drawn in every draw (its stream must not shift) but applied only where the risk fires.
 *   - A goal's target and a limit's bound are read at the window's last period. `every` holds when every period in the window
 *     holds; its aggregated value (for outcomes) is the window's worst period (min for > / >=, max for < / <=).
 *   - Drivers: each uncertain quantity the option's goals and limits depend on, and whose own draw the option uses (not one it
 *     sets from period 0), in model order. joint_if_low / joint_if_high are joint_within_limits over the bottom and top third
 *     of that quantity's draws.
 */
import type { Aggregation, Cmp, ExecutableModel, Option, Quantity, Window } from '../executable.js';
import { standardNormals, uniforms } from './prng.js';
import { rangeLaw, type NormalLaw } from './range-law.js';
import type { Chance, OptionResult, RecordedDraw, SimResult } from './result.js';

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
  const nodes = model.quantities.map((q, i): Node => compileNode(q, i, ref, ranged));
  const stocks = nodes.flatMap((n, i) => (n.kind === 'stock' ? [i] : []));

  const windowOf = (w: Window, where: string): [number, number] => {
    if (!wholeFrom(w.start_period, 0) || !wholeFrom(w.periods, 1) || w.start_period + w.periods > periods) {
      throw new Error(`${where}: window from period ${w.start_period} for ${w.periods} periods is not inside periods 0..${periods - 1}`);
    }
    return [w.start_period, w.start_period + w.periods - 1];
  };
  const check = (id: string, quantity: string, cmp: Cmp, against: string, aggregation: Aggregation, w: Window, kind: string): Check => {
    const where = `${kind} "${id}"`;
    if (!CMPS.has(cmp)) throw new Error(`${where}: unknown comparison "${cmp}"`);
    if (!AGGS.has(aggregation)) throw new Error(`${where}: unknown aggregation "${aggregation}"`);
    const [first, last] = windowOf(w, where);
    return { id, q: ref(quantity, where), ref: ref(against, where), cmp, aggregation, first, last };
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

function compileNode(q: Quantity, i: number, ref: (id: string, where: string) => number, ranged: { q: number; law: NormalLaw }[]): Node {
  const where = `quantity "${q.id}"`;
  const forms = [q.dist, q.equation, q.stock].filter((x) => x !== undefined).length;
  if (forms !== 1) throw new Error(`${where} must have exactly one of dist, equation, stock (it has ${forms})`);
  if (q.dist !== undefined) {
    if (q.dist.kind === 'fixed') {
      if (!Number.isFinite(q.dist.value)) throw new Error(`${where}: fixed value ${q.dist.value} is not finite`);
      return { kind: 'fixed', value: q.dist.value };
    }
    if (q.dist.kind !== 'range') throw new Error(`${where}: unknown dist kind`);
    ranged.push({ q: i, law: rangeLaw(q.dist) });
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
      return z;
    }),
    riskU: c.risks.map((r) => uniforms(seed, `r:${r.id}`, draws)),
  };
}

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

function aggregate(k: Check, vals: Float64Array, n: number): number {
  if (k.aggregation === 'end') return vals[k.last * n + k.q]!;
  const every = k.aggregation === 'every', worstIsMax = below(k.cmp);
  let acc = every ? (worstIsMax ? -Infinity : Infinity) : 0;
  for (let t = k.first; t <= k.last; t++) {
    const v = vals[t * n + k.q]!;
    if (Number.isNaN(v)) return NaN;
    acc = !every ? acc + v : worstIsMax ? Math.max(acc, v) : Math.min(acc, v);
  }
  return k.aggregation === 'mean' ? acc / (k.last - k.first + 1) : acc;
}

function quantiles(a: Float64Array): { p10: number; p50: number; p90: number } {
  const s = a.filter((x) => !Number.isNaN(x)).sort();
  if (s.length === 0) return { p10: NaN, p50: NaN, p90: NaN };
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
  const n = c.nodes.length, P = c.periods;
  const vals = new Float64Array(P * n);
  const level = new Float64Array(n);
  const fired = new Int8Array(c.risks.length);
  const goalMet = c.goals.map(() => new Uint8Array(draws));
  const goalAgg = c.goals.map(() => new Float64Array(draws));
  const joint = new Uint8Array(draws), within = new Uint8Array(draws), both = new Uint8Array(draws);
  let nanDraws = 0;

  for (let d = 0; d < draws; d++) {
    fired.fill(-1);
    for (let t = 0; t < P; t++) {
      const row = t * n;
      // (1) + (2): sets and risk effects active at t, then every quantity in dependency order from the stocks at t.
      for (const q of p.order) {
        const node = c.nodes[q]!;
        let v: number;
        if (node.kind === 'stock') v = t === 0 ? vals[row + node.start]! : level[q]!;
        else {
          const to = activeSet(p.sets[q], t);
          v = to >= 0 ? vals[row + to]! : evaluate(node, vals, row, inputs, d);
        }
        for (const r of p.risksOn[q]!) {
          const risk = c.risks[r]!;
          if (t < risk.from || (node.kind === 'stock' && t !== risk.from)) continue;
          if (fired[r]! < 0) {
            const chance = vals[risk.from * n + risk.occurrence]!;
            fired[r] = Number.isNaN(chance) ? 2 : inputs.riskU[r]![d]! < chance ? 1 : 0;
          }
          if (fired[r] === 2) v = NaN;
          else if (fired[r] === 1) {
            const s = vals[risk.from * n + risk.severity]!;
            v = risk.add ? v + s : v * s;
          }
        }
        vals[row + q] = v;
      }
      // (3) stock[t+1] = stock[t] + Σ inflows − Σ outflows, all read at t.
      for (const q of c.stocks) {
        const s = c.nodes[q] as StockNode;
        let next = vals[row + q]!;
        for (const i of s.inflows) next += vals[row + i]!;
        for (const o of s.outflows) next -= vals[row + o]!;
        level[q] = next;
      }
    }

    let allGoals = 1, allLimits = 1, nan = false;
    c.goals.forEach((g, i) => {
      const a = aggregate(g, vals, n), target = vals[g.last * n + g.ref]!;
      if (Number.isNaN(a) || Number.isNaN(target)) nan = true;
      const met = holds(a, g.cmp, target) ? 1 : 0;
      goalMet[i]![d] = met;
      goalAgg[i]![d] = a;
      allGoals &= met;
    });
    for (const l of c.limits) {
      const a = aggregate(l, vals, n), bound = vals[l.last * n + l.ref]!;
      if (Number.isNaN(a) || Number.isNaN(bound)) nan = true;
      allLimits &= holds(a, l.cmp, bound) ? 1 : 0;
    }
    joint[d] = allGoals;
    within[d] = allLimits;
    both[d] = allGoals & allLimits;
    if (nan) nanDraws++;

    if (record.has(d)) {
      const values: Record<string, number[]> = {};
      c.ids.forEach((id, q) => { values[id] = Array.from({ length: P }, (_, t) => vals[t * n + q]!); });
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
  const meanOver = (a: Uint8Array, idx: Int32Array): number => idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
  return {
    option_id: p.option_id,
    per_goal: c.goals.map((g, i) => ({ goal_id: g.id, ...chanceOf(count(goalMet[i]!)) })),
    joint: chanceOf(count(joint)),
    within_limits: chanceOf(count(within)),
    joint_within_limits: chanceOf(count(both)),
    outcomes: c.goals.map((g, i) => ({ goal_id: g.id, ...quantiles(goalAgg[i]!) })),
    drivers: thirds.length === 0 || Math.floor(draws / 3) === 0 ? [] : p.drivers.map((slot) => ({
      quantity: c.ids[c.ranged[slot]!.q]!,
      joint_if_low: meanOver(both, thirds[slot]!.low),
      joint_if_high: meanOver(both, thirds[slot]!.high),
    })),
    nan_draws: nanDraws,
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
