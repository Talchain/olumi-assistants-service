/**
 * A STRUCTURAL PROBE (spike S1; DL, phase 0b fix 2): does an asked figure CANCEL OUT of a goal? Decided numerically, never
 * symbolically: evaluate the goal's per-draw outcome margins twice on the same draws, with the asked figure at two different
 * values; identical margins mean it cancels ("today's output per developer" under a "+10 % on today" goal).
 *
 * This is NOT the simulator and never produces a chance: draws are deterministic points across each range (the range law is
 * irrelevant to an identity), and only margins are compared. It follows the executable model's reading convention
 * (executable.ts): values[t] are computed from the stocks at boundary t; a flow reads intervals, a state reads boundaries.
 */
import type { ExecutableModel, Goal, Limit, Quantity } from './executable.js';

type Check = Goal | Limit;

/** Deterministic points in [0, 1): a fixed LCG, so both runs of a probe see the same draws. */
function points(seed: number, n: number): number[] {
  let s = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length: n }, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; });
}

/** The margins of one check, per option and draw (and per period for `every`), with `override` fixing the given inputs. */
export function probeMargins(x: ExecutableModel, check: Check, override: ReadonlyMap<string, number>, draws = 8): number[] {
  const byId = new Map(x.quantities.map((q) => [q.id, q] as const));
  const target = 'target' in check ? check.target : check.bound;
  const out: number[] = [];
  const u = x.quantities.map((q, i) => points(i + 1, draws));
  const ru = x.risks.map((_, i) => points(1000 + i, draws));
  for (const option of x.options) for (let d = 0; d < draws; d++) {
    const values = run(x, byId, option.sets, override, (qi) => u[qi][d], (ri) => ru[ri][d]);
    const read = (id: string, t: number) => values[t].get(id) ?? NaN;
    const reading = (id: string) => byId.get(id)?.reading ?? 'state';
    const { start_period: s, periods: p } = check.window;
    const span = (id: string) => (reading(id) === 'flow' ? range(s, s + p - 1) : range(s + 1, s + p));
    const endAt = (id: string) => (reading(id) === 'flow' ? s + p - 1 : s + p);
    const agg = (id: string): number => {
      const xs = span(id).map((t) => read(id, t));
      switch (check.aggregation) {
        case 'end': return read(id, endAt(id));
        case 'sum': return xs.reduce((a, b) => a + b, 0);
        case 'mean': return xs.reduce((a, b) => a + b, 0) / p;
        case 'max': return Math.max(...xs);
        case 'min': return Math.min(...xs);
        default: return NaN;
      }
    };
    const rhs = read(target, endAt(target));
    if (check.aggregation === 'every') {
      for (const t of span(check.quantity)) out.push(margin(read(check.quantity, t), read(target, t)));
    } else {
      const lhs = check.per ? agg(check.quantity) / agg(check.per) : agg(check.quantity);
      out.push(margin(lhs, rhs));
    }
  }
  return out;
}

/** One check's aggregated value per option on the probe's first draw (fixed inputs make it exact): for structural rows. */
export function probeValue(x: ExecutableModel, check: Check, optionId: string): number {
  const byId = new Map(x.quantities.map((q) => [q.id, q] as const));
  const option = x.options.find((o) => o.id === optionId)!;
  const values = run(x, byId, option.sets, new Map(), () => 0, () => 1);
  const { start_period: s, periods: p } = check.window;
  const flow = byId.get(check.quantity)?.reading === 'flow';
  const at = check.aggregation === 'end' ? (flow ? s + p - 1 : s + p) : NaN;
  return values[at]?.get(check.quantity) ?? NaN;
}

/** True when the two margin lists are the same, value by value (non-finite values never count as the same). */
export function sameMargins(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => Number.isFinite(v) && Number.isFinite(b[i]) && Math.abs(v - b[i]) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(b[i])));
}

const margin = (l: number, r: number) => (r !== 0 ? (l - r) / Math.abs(r) : l - r);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

function run(x: ExecutableModel, byId: Map<string, Quantity>, sets: ExecutableModel['options'][number]['sets'],
  override: ReadonlyMap<string, number>, draw: (qi: number) => number, riskDraw: (ri: number) => number): Map<string, number>[] {
  const index = new Map(x.quantities.map((q, i) => [q.id, i] as const));
  const setsOn = new Map<string, { from: number; to: string }[]>();
  for (const s of sets) setsOn.set(s.quantity, [...(setsOn.get(s.quantity) ?? []), { from: s.from_period, to: s.to }].sort((a, b) => a.from - b.from));
  const risksOn = new Map<string, number[]>();
  x.risks.forEach((r, i) => risksOn.set(r.effect_on, [...(risksOn.get(r.effect_on) ?? []), i]));
  const deps = (q: Quantity): string[] => [
    ...(q.equation?.form === 'definition' ? q.equation.parts : q.equation?.form === 'effect' ? [q.equation.base, ...q.equation.terms.flatMap((t) => [t.coefficient, t.driver])] : []),
    ...(setsOn.get(q.id) ?? []).map((s) => s.to),
    ...(risksOn.get(q.id) ?? []).flatMap((i) => [x.risks[i].occurrence, x.risks[i].severity]),
  ];
  // Same-period order: stocks first (they are read, not computed, within a period), then a depth-first topological order.
  const order: Quantity[] = [];
  const seen = new Set<string>();
  const visit = (q: Quantity) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    if (!q.stock) for (const d of deps(q)) { const dq = byId.get(d); if (dq) visit(dq); }
    order.push(q);
  };
  for (const q of x.quantities) visit(q);
  const input = (q: Quantity): number => {
    if (override.has(q.id)) return override.get(q.id)!;
    const dist = q.dist!;
    return dist.kind === 'fixed' ? dist.value : dist.low + draw(index.get(q.id)!) * (dist.high - dist.low);
  };
  const fired = x.risks.map((_, i) => riskDraw(i));
  const stocks = new Map<string, number>();
  const pass = (t: number, v: Map<string, number>) => {
    for (const q of order) {
      const active = (setsOn.get(q.id) ?? []).filter((s) => s.from <= t).pop();
      let val = q.stock ? stocks.get(q.id) ?? NaN : active ? v.get(active.to) ?? NaN : q.dist || override.has(q.id) ? input(q) : evaluate(q, v);
      for (const i of risksOn.get(q.id) ?? []) {
        const r = x.risks[i];
        if (t >= r.from_period && fired[i] < (v.get(r.occurrence) ?? 0)) val = r.mode === 'add' ? val + (v.get(r.severity) ?? NaN) : val * (v.get(r.severity) ?? NaN);
      }
      v.set(q.id, val);
    }
  };
  const values: Map<string, number>[] = [];
  for (let t = 0; t <= x.periods; t++) {
    const v = new Map<string, number>();
    if (t === 0) { pass(0, v); for (const q of order) if (q.stock) stocks.set(q.id, v.get(q.stock.start) ?? NaN); }
    pass(t, v); // boundary t: every quantity from the stocks at t (S[0] = each stock's start)
    values.push(v);
    for (const q of order) if (q.stock) {
      stocks.set(q.id, stocks.get(q.id)! + q.stock.inflows.reduce((a, f) => a + (v.get(f) ?? NaN), 0) - q.stock.outflows.reduce((a, f) => a + (v.get(f) ?? NaN), 0));
    }
  }
  return values;
}

function evaluate(q: Quantity, v: Map<string, number>): number {
  const e = q.equation;
  if (!e) return NaN;
  const g = (id: string) => v.get(id) ?? NaN;
  if (e.form === 'effect') return g(e.base) + e.terms.reduce((a, t) => a + g(t.coefficient) * g(t.driver), 0);
  const [first, ...rest] = e.parts.map(g);
  switch (e.op) {
    case 'sum': return [first, ...rest].reduce((a, b) => a + b, 0);
    case 'difference': return rest.reduce((a, b) => a - b, first);
    case 'product': return [first, ...rest].reduce((a, b) => a * b, 1);
    case 'ratio': return rest.reduce((a, b) => a / b, first);
  }
}
