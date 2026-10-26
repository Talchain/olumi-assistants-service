/**
 * A SMALL UNIT ALGEBRA over unit strings (spike S1). A unit is a product of named dimensions with integer exponents
 * (currency, count nouns, time) and a SCALE that only `%` uses: "20 %" is 0.2 of the dimensionless unit "1". The scale is
 * an explicit input conversion (`toFraction`), never part of a unit's identity, so "%" and "1" are the same dimension and
 * the compiler rewrites every % figure as a fraction, saying so.
 *
 *   parseUnit('GBP/member/month') → { dims: { gbp: 1, member: -1, month: -1 }, scale: 1 }
 *   multiply(coefficient, driver) must equal the defined unit; sum and difference parts share one unit.
 *
 * Deliberately NOT here: currency exchange (GBP ≠ USD is an error), magnitude multipliers (k, m: an error, write the figure
 * in full) and implicit time conversion (GBP/year ≠ GBP/month: the model names a conversion quantity such as 12 month/year,
 * so every conversion is visible and authored).
 */

export type Dims = Readonly<Record<string, number>>;
export type Unit = { readonly dims: Dims; readonly scale: number };
export type UnitParse = { ok: true; unit: Unit } | { ok: false; message: string };

const CURRENCY: Readonly<Record<string, string>> = {
  '£': 'gbp', gbp: 'gbp', pound: 'gbp', pounds: 'gbp', sterling: 'gbp',
  $: 'usd', usd: 'usd', dollar: 'usd', dollars: 'usd',
  '€': 'eur', eur: 'eur', euro: 'eur', euros: 'eur',
};
const TIME: Readonly<Record<string, string>> = {
  day: 'day', days: 'day', week: 'week', weeks: 'week', wk: 'week', wks: 'week', month: 'month', months: 'month', mo: 'month',
  quarter: 'quarter', quarters: 'quarter', year: 'year', years: 'year', yr: 'year', yrs: 'year', annum: 'year',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour',
};
export const TIME_DIMS: ReadonlySet<string> = new Set(Object.values(TIME));
/** "% monthly" is a rate per month (phase 0b: churn written as a monthly share failed every first draft). */
const RATE_WORDS: Readonly<Record<string, string>> = {
  daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', annual: 'year', annually: 'year', hourly: 'hour',
};
const DIMENSIONLESS: ReadonlySet<string> = new Set(['1', 'fraction', 'ratio', 'share', 'proportion', 'probability', 'chance', 'number', 'unitless', 'dimensionless', 'x', 'times']);
const PERCENT: ReadonlySet<string> = new Set(['%', 'percent', 'pct', 'percentage']);
const MULTIPLIERS: ReadonlySet<string> = new Set(['k', 'm', 'bn', 'b', 'mn', 'thousand', 'thousands', 'million', 'millions', 'billion', 'billions', 'hundred']);
const IRREGULAR: Readonly<Record<string, string>> = {
  people: 'person', persons: 'person', children: 'child', men: 'man', women: 'woman', staff: 'staff',
  loaves: 'loaf', knives: 'knife', leaves: 'leaf', lives: 'life', halves: 'half', shelves: 'shelf', feet: 'foot', teeth: 'tooth',
};

/** One stem for a count noun's singular and plural ("loaves"/"loaf", "classes"/"class", "deliveries"/"delivery"). */
function stem(t: string): string {
  if (IRREGULAR[t]) return IRREGULAR[t];
  if (t.length > 3 && /(ss|x|ch|sh|z)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 2 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

type Token = { kind: 'dim'; dim: string } | { kind: 'per'; dim: string } | { kind: 'none' } | { kind: 'percent' } | { kind: 'bad'; message: string };

function token(raw: string): Token | null {
  const t = raw.trim().toLowerCase();
  if (t === '') return null;
  if (DIMENSIONLESS.has(t)) return { kind: 'none' };
  if (PERCENT.has(t)) return { kind: 'percent' };
  if (MULTIPLIERS.has(t)) return { kind: 'bad', message: `uses the multiplier "${raw.trim()}"; write the figure in full and drop the multiplier` };
  if (CURRENCY[t]) return { kind: 'dim', dim: CURRENCY[t] };
  if (RATE_WORDS[t]) return { kind: 'per', dim: RATE_WORDS[t] };
  if (TIME[t]) return { kind: 'dim', dim: TIME[t] };
  if (/^[0-9.]+$/.test(t)) return { kind: 'bad', message: `contains the number "${raw.trim()}"; a unit names what is counted, the figure goes in value` };
  if (!/^[a-z][a-z_-]*$/.test(t)) return { kind: 'bad', message: `contains "${raw.trim()}", which is not a unit word` };
  const s = stem(t);
  return { kind: 'dim', dim: CURRENCY[s] ?? TIME[s] ?? s };
}

/** Parse a unit string. "/" and the word "per" divide, read left to right: a/b/c is a per b per c. */
export function parseUnit(text: string): UnitParse {
  const src = String(text ?? '').trim();
  if (src === '') return { ok: false, message: 'is empty; write "1" for a pure number' };
  const spaced = src.replace(/\bper\b/gi, '/').replace(/([£$€%])/g, ' $1 ').replace(/[()]/g, ' ');
  const dims: Record<string, number> = {};
  let scale = 1;
  const segments = spaced.split('/');
  for (const [i, seg] of segments.entries()) {
    const sign = i === 0 ? 1 : -1;
    const words = seg.split(/[\s*·×]+/).filter((w) => w !== '');
    if (words.length === 0 && i > 0) return { ok: false, message: 'has nothing after a "/"' };
    for (const w of words) {
      const m = /^(.*?)\^(-?\d+)$/.exec(w);
      const tok = token(m ? m[1] : w);
      const power = m ? Number(m[2]) * sign : sign;
      if (tok === null || tok.kind === 'none') continue;
      if (tok.kind === 'bad') return { ok: false, message: tok.message };
      if (tok.kind === 'percent') { scale *= power > 0 ? 0.01 ** power : 100 ** -power; continue; }
      if (tok.kind === 'per') { dims[tok.dim] = (dims[tok.dim] ?? 0) - 1; continue; }
      dims[tok.dim] = (dims[tok.dim] ?? 0) + power;
    }
  }
  for (const k of Object.keys(dims)) if (dims[k] === 0) delete dims[k];
  return { ok: true, unit: { dims, scale } };
}

export const DIMENSIONLESS_UNIT: Unit = { dims: {}, scale: 1 };

export function multiply(a: Unit, b: Unit): Unit {
  const dims: Record<string, number> = { ...a.dims };
  for (const [k, v] of Object.entries(b.dims)) { dims[k] = (dims[k] ?? 0) + v; if (dims[k] === 0) delete dims[k]; }
  return { dims, scale: a.scale * b.scale };
}

export function divide(a: Unit, b: Unit): Unit {
  const inv: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.dims)) inv[k] = -v;
  return multiply(a, { dims: inv, scale: 1 / b.scale });
}

/** Same dimensions. Scale is ignored: the compiler converts every % figure to a fraction before anything is combined. */
export function sameDims(a: Unit, b: Unit): boolean {
  const ka = Object.keys(a.dims);
  return ka.length === Object.keys(b.dims).length && ka.every((k) => a.dims[k] === b.dims[k]);
}

export const isDimensionless = (u: Unit): boolean => Object.keys(u.dims).length === 0;

/** The figure as a plain number in its unit's dimensions: 20 in "%" is 0.2. Every other unit's figure is unchanged. */
export const toFraction = (value: number, u: Unit): number => value * u.scale;

/** A readable form for error sentences, e.g. "gbp/member·month". */
export function showUnit(u: Unit): string {
  const entries = Object.entries(u.dims).sort(([a], [b]) => a.localeCompare(b));
  const fmt = (xs: [string, number][]) => xs.map(([k, v]) => (Math.abs(v) === 1 ? k : `${k}^${Math.abs(v)}`)).join('·');
  const num = entries.filter(([, v]) => v > 0);
  const den = entries.filter(([, v]) => v < 0);
  const base = (num.length ? fmt(num) : '1') + (den.length ? `/${fmt(den)}` : '');
  return u.scale === 1 ? base : `${base} (in %)`;
}

/** The unit of a per-period flow of a stock: the stock's unit per the model's period. */
export const perPeriod = (stock: Unit, period: string): Unit => divide(stock, { dims: { [TIME[period] ?? period]: 1 }, scale: 1 });
