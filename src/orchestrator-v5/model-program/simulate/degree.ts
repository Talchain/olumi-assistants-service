/**
 * IS A CONDITION'S MARGIN A STRAIGHT LINE IN ONE FIGURE? (SC0; structural, read from the executable model's forms, no sampling.)
 *
 * For figure `x` under one option, a goal's or limit's MARGIN (its aggregated value less its target or bound, read where the
 * window ends) is affine in x in every draw when x reaches it only through forms that keep a straight line. Then two runs at two
 * values of x, on the same seed, give every draw its own line (`simulate`'s per-draw results), and so the chance at ANY value of
 * x on those draws, with every crossing found: no sampled grid can miss one (the tipping point, D2; the science page's method).
 *
 * The degree in x (0, 1, or more than 1 = not straight), through the same edges as `restsOn`:
 *   - x itself: 1; any other figure or range: 0;
 *   - sum, difference: the highest of the parts; product: the sum of the parts; ratio: the numerator's, every divisor of degree 0;
 *   - effect, base + Σ coefficient × driver: the highest of the base and the terms, each term the sum of its two degrees;
 *   - stock: the highest of its start and its flows, found as a fixed point (a flow may read its own stock: churn × members);
 *   - an option's set on a quantity: the highest of its own degree and the set's `to`; its timing must not be x;
 *   - a risk on a quantity: its occurrence and timing of degree 0 (whether it fires must not move with x); `add` takes the
 *     highest of the two degrees, `multiply` their sum;
 *   - a window read `end`, `sum` or `mean` keeps the degree; `max`, `min` and `every` keep only degree 0; a `per` denominator,
 *     and every divisor, must be of degree 0; the target or bound adds its own degree to the margin's.
 * A value that leaves its declared domain is not a question of shape: the runs that confirm a crossing find it there (the draw is
 * outside the domain), so a straight margin still needs those runs.
 */
import type { ExecutableModel, Goal, Limit } from '../executable.js';

export type Straightness =
  | { readonly kind: 'goal' | 'limit'; readonly id: string; readonly straight: true; readonly degree: 0 | 1 }
  | { readonly kind: 'goal' | 'limit'; readonly id: string; readonly straight: false; readonly reason: string };

type Deg = { readonly d: 0 | 1 } | { readonly d: 2; readonly why: string };
const ZERO: Deg = { d: 0 }, ONE: Deg = { d: 1 };
const highest = (...ds: Deg[]): Deg => ds.find((g) => g.d === 2) ?? (ds.some((g) => g.d === 1) ? ONE : ZERO);
const sumOf = (a: Deg, b: Deg, why: string): Deg => (a.d === 2 ? a : b.d === 2 ? b : a.d + b.d > 1 ? { d: 2, why } : a.d + b.d === 1 ? ONE : ZERO);

/** Each goal's and limit's margin under option `optionId` (null: no option's sets), straight in figure `x` or not, with why. */
export function straightness(model: ExecutableModel, x: string, optionId: string | null): Straightness[] {
  const byId = new Map(model.quantities.map((q) => [q.id, q] as const));
  const fig = byId.get(x);
  if (fig === undefined) throw new Error(`unknown quantity "${x}"`);
  if (fig.dist === undefined) throw new Error(`"${x}" is worked out, not a figure or a range`);
  const option = optionId === null ? undefined : model.options.find((o) => o.id === optionId);
  if (optionId !== null && option === undefined) throw new Error(`unknown option "${optionId}"`);
  const sets = option?.sets ?? [];
  const name = (id: string): string => `‘${byId.get(id)?.label ?? id}’`;
  const X = name(x);

  const stocks = model.quantities.filter((q) => q.stock !== undefined).map((q) => q.id);
  const level = new Map<string, Deg>(stocks.map((id) => [id, ZERO]));
  let memo = new Map<string, Deg>();
  const visiting = new Set<string>();
  /** The option's sets and the risks on `id`, applied to its own degree. */
  const acted = (id: string, own: Deg): Deg => {
    let g = own;
    for (const s of sets) {
      if (s.quantity !== id) continue;
      if (s.from_period === x) return { d: 2, why: `${X} is when ‘${option!.label}’ changes ${name(id)}` };
      g = highest(g, deg(s.to));
    }
    for (const r of model.risks) {
      if (r.effect_on !== id) continue;
      if (r.from_period === x) return { d: 2, why: `${X} is when the risk on ${name(id)} starts` };
      const occurs = deg(r.occurrence);
      if (occurs.d !== 0) return occurs.d === 2 ? occurs : { d: 2, why: `whether the risk on ${name(id)} happens moves with ${X}` };
      g = r.mode === 'add' ? highest(g, deg(r.severity)) : sumOf(g, deg(r.severity), `the risk on ${name(id)} multiplies it by a size that moves with ${X}`);
    }
    return g;
  };
  const deg = (id: string): Deg => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const q = byId.get(id);
    if (q === undefined) throw new Error(`unknown quantity "${id}"`);
    if (visiting.has(id)) throw new Error(`cycle not through a stock at "${id}"`);
    visiting.add(id);
    let own: Deg;
    if (id === x) own = ONE;
    else if (q.dist !== undefined) own = ZERO;
    else if (q.stock !== undefined) own = level.get(id)!;
    else if (q.equation?.form === 'effect') {
      const e = q.equation;
      own = highest(deg(e.base), ...e.terms.map((t) => sumOf(deg(t.coefficient), deg(t.driver), `${name(id)} multiplies two quantities that move with ${X}`)));
    } else if (q.equation?.form === 'definition') {
      const { op, parts } = q.equation;
      if (op === 'sum' || op === 'difference') own = highest(...parts.map(deg));
      else if (op === 'product') own = parts.slice(1).reduce((g, p) => sumOf(g, deg(p), `${name(id)} multiplies two quantities that move with ${X}`), deg(parts[0]!));
      else {
        const divisor = parts.slice(1).map(deg).find((g) => g.d !== 0);
        own = divisor === undefined ? deg(parts[0]!) : divisor.d === 2 ? divisor : { d: 2, why: `${name(id)} divides by a quantity that moves with ${X}` };
      }
    } else throw new Error(`quantity "${id}" has no form`);
    const g = acted(id, own);
    visiting.delete(id);
    memo.set(id, g);
    return g;
  };
  // A stock's degree is the highest of its start and flows, which may read the stock itself: rise to a fixed point (0 → 1 → 2).
  const rank = (g: Deg): number => g.d;
  for (let round = 0; round <= 2 * stocks.length + 1; round++) {
    memo = new Map();
    let rose = false;
    for (const id of stocks) {
      const s = byId.get(id)!.stock!;
      const next = acted(id, highest(level.get(id)!, deg(s.start), ...s.inflows.map(deg), ...s.outflows.map(deg)));
      if (rank(next) > rank(level.get(id)!)) { level.set(id, next); rose = true; }
    }
    if (!rose) break;
  }
  memo = new Map();

  const margin = (c: Goal | Limit, kind: 'goal' | 'limit', against: string): Straightness => {
    let g = deg(c.quantity);
    if (c.per !== undefined) {
      const per = deg(c.per);
      if (per.d !== 0) g = per.d === 2 ? per : { d: 2, why: `‘${c.label}’ is per ${name(c.per)}, which moves with ${X}` };
    }
    if (g.d === 1 && (c.aggregation === 'max' || c.aggregation === 'min' || c.aggregation === 'every')) {
      g = { d: 2, why: `‘${c.label}’ reads ${c.aggregation === 'every' ? 'every period' : `the ${c.aggregation === 'max' ? 'highest' : 'lowest'} reading`} of its window` };
    }
    const m = highest(g, deg(against));
    return m.d === 2 ? { kind, id: c.id, straight: false, reason: m.why } : { kind, id: c.id, straight: true, degree: m.d };
  };
  return [...model.goals.map((g) => margin(g, 'goal', g.target)), ...model.limits.map((l) => margin(l, 'limit', l.bound))];
}
