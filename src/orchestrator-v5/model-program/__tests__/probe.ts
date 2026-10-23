/**
 * A TEST-ONLY DIAGNOSTIC EVALUATOR (spike S1). It is never part of admission: the compiler never removes an ask or gives a
 * fact a value from a probe (buddy BLOCK upheld by the DL, 23 Oct: two-value agreement proves no identity and no domain).
 * The one production evaluator is S2's simulator. This helper only lets S1's rows read a structural fact on fixed inputs
 * (the PL's inventory counterexample); it should be replaced by S2's simulate once the branches meet.
 * It follows the reading convention (executable.ts): values[t] are computed from the stocks at boundary t.
 */
import type { ExecutableModel, Goal, Limit, Quantity } from '../executable.js';

type Check = Goal | Limit;

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
