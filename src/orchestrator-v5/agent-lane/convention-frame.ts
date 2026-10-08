/**
 * ⭐ OLUMI'S CONVENTION FRAME (Science §(s) + §(u), goals rulings 8 Oct 2026; DL GO). A frame is a scale convention: it
 * rescales the normalised β, never the natural-unit size (−24 subscribers per point stays −24). The drafter's own
 * `plausible_max` is Olumi's guess, and a guess of 0–100 points for a monthly churn of 3% pushed an ordinary effect past
 * |β| = 1, so admission set a sound size aside (P44 mechanism arm: 0 of 9 drafts chance-ready). This is the disciplined
 * version of that guess.
 *
 * Precedence (DL, approving P44's reading): a ceiling the USER wrote > this convention > the drafter's plausible_max.
 *  · a BOUNDED RATE in [0, 100] (churn, conversion, share, utilisation…): ceiling = min(100, max(2 × level, level + 10));
 *  · a NON-NEGATIVE LEVEL (a price, a count, money per period, headcount): ceiling = 2 × level;
 *  · NEVER BINDS: when an option setting or a user constraint reaches ≥ 80% of the ceiling it is widened (a rate to
 *    min(100, 2 × that value), a level to 2 × that value). Nothing is ever clipped.
 *  · EXCLUDED, the drafter's range stays (fail closed: anything not positively recognised): a signed rate or level (a
 *    change, growth, margin, profit, cash flow, balance…), a rate that can exceed 100% (NRR, an index, % of baseline), a
 *    level of 0 or no level the model knows, any unit outside the percent / currency / count families. The GOAL is not a
 *    factor and never reaches this function.
 * Pure.
 */
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { sayFigure } from './say-figure.js';
import { isCurrencyUnit } from '../../utils/currency-alphabet.js';

/** Words that make a quantity signed or able to exceed its range: never framed by the convention (Science §(s)(2), §(u)). */
const SIGNED_OR_UNBOUNDED = /\b(change|changes|growth|grow|increase|decrease|uplift|delta|difference|margin|inflation|index|indexed|baseline|yoy|year[- ]on[- ]year|net|nrr|ndr|profit|profits|cash ?flow|balance|surplus|deficit|gain|gains|loss|losses|temperature|return|roi)\b/i;

/** A share or probability bounded in [0, 100] by what it is (Science §(s): churn, conversion, market share, utilisation…). */
const BOUNDED_RATE = /\b(churn|conversion|share|utili[sz]ation|attendance|occupancy|uptake|adoption|win rate|retention|abandonment|cancellation|completion rate|response rate|open rate|click[- ]through|renewal rate|attrition|turnover rate|default rate)\b/i;

/** Count units (Science §(u): counts and headcount). The unit's head noun, singular or plural, optionally "per <period>". */
const COUNT_HEADS = new Set(['subscriber', 'customer', 'user', 'account', 'client', 'member', 'seat', 'licence', 'license',
  'engineer', 'developer', 'person', 'people', 'staff', 'employee', 'headcount', 'hire', 'fte', 'deal', 'order', 'unit', 'sale',
  'lead', 'trial', 'signup', 'sign-up', 'visitor', 'ticket', 'store', 'site', 'pod', 'pitch', 'contract', 'project', 'booking',
  'patient', 'student', 'shipment', 'installation']);

/** A per-period tail on a count unit: "/month", "per month", "a year", "/wk"… */
const PER_PERIOD = /(\/\s*|\bper\s+|\ba\s+|\beach\s+)(day|week|wk|month|mo|quarter|year|yr|annum)\b/i;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isCountUnit(unit: string): boolean {
  const head = unit.trim().toLowerCase().split(/[\s/]+/)[0] ?? '';
  return COUNT_HEADS.has(head) || (head.endsWith('s') && COUNT_HEADS.has(head.slice(0, -1)));
}

/**
 * Money per something with a qualifier, as the drafter writes a price: "£/Pro subscriber/month" (the estate's currency
 * reader says `plain` for it). The head before the first "/" or "per" must itself be a currency.
 */
function isMoneyPerUnit(unit: string): boolean {
  const t = unit.trim();
  const head = t.split(/\s*\/\s*|\s+per\s+/i)[0] ?? '';
  return head !== t && head !== '' && isCurrencyUnit(head);
}

export type ConventionClass = 'bounded_rate' | 'non_negative_level';

/**
 * A money level with POSITIVE evidence that it cannot go negative (#2842 review P1-4: a currency unit plus a blacklist let
 * "Operating income" through). Its label must name a price, cost, spend, fee, wage, budget or revenue kind; anything else in
 * money (income, earnings, value, result…) keeps the drafter's range.
 */
const NON_NEGATIVE_MONEY = /\b(price|prices|cost|costs|fee|fees|spend|spending|salary|salaries|wage|wages|pay|payroll|budget|rent|revenue|sales|mrr|arr|subscription|charge|charges|tariff|expense|expenses|bill|invoice)\b/i;

/** Which convention applies to this factor, or `undefined` (excluded: the drafter's range stays). */
export function conventionClassOf(label: string, unit: string | null | undefined, level: number | null | undefined): ConventionClass | undefined {
  if (typeof unit !== 'string' || unit.trim() === '' || !finite(level) || !(level > 0)) return undefined;
  if (SIGNED_OR_UNBOUNDED.test(label) || SIGNED_OR_UNBOUNDED.test(unit)) return undefined;
  const cls = classifyUnitScaleClass(unit);
  if (cls === 'percent') return level <= 100 && BOUNDED_RATE.test(label) ? 'bounded_rate' : undefined;
  if (cls !== 'unknown') return undefined; // percentage points, basis points, … : a change, never a level here
  if (readCurrencyUnitWithQualifiers(unit).kind === 'currency' || isMoneyPerUnit(unit)) {
    return NON_NEGATIVE_MONEY.test(label) ? 'non_negative_level' : undefined;
  }
  // ⛔ Science §(v)(2): a count PER PERIOD ("subscribers per month") is a FLOW. What it adds to a stock depends on how many
  // periods it runs, so its links into a stock stay unsized until the accumulation identity exists: never re-framed here.
  if (PER_PERIOD.test(unit)) return undefined;
  return isCountUnit(unit) ? 'non_negative_level' : undefined;
}

export interface ConventionFrame {
  readonly cls: ConventionClass;
  readonly frame: number;
  /** The setting that widened the ceiling (≥ 80% of it), when one did. */
  readonly widened_by?: number;
}

/**
 * The convention's ceiling for a factor at `level`, widened over `settings` (option settings and user constraints on
 * it, in its own unit) and over `spread_upper` (the top of an Olumi-ESTIMATED level's own spread, Science §(v)(1)) so
 * that none reaches 80% of it. `undefined` when the factor is excluded, or when the ceiling would be 1 or less (a frame
 * the node writers refuse, so the level and its options would land in two value spaces; #2842 review P1-5).
 */
export function conventionFrameFor(args: {
  readonly label: string; readonly unit: string | null | undefined; readonly level: number | null | undefined;
  readonly settings: readonly number[]; readonly spread_upper?: number;
}): ConventionFrame | undefined {
  const cls = conventionClassOf(args.label, args.unit, args.level);
  if (cls === undefined) return undefined;
  const level = args.level as number;
  let frame = cls === 'bounded_rate' ? Math.min(100, Math.max(2 * level, level + 10)) : 2 * level;
  const top = Math.max(level, ...[...args.settings, ...(finite(args.spread_upper) ? [args.spread_upper] : [])].filter(finite).map(Math.abs));
  let widened_by: number | undefined;
  if (top >= 0.8 * frame) {
    widened_by = top;
    frame = cls === 'bounded_rate' ? Math.min(100, 2 * top) : 2 * top;
  }
  if (cls === 'bounded_rate' && top > 100) return undefined; // not a [0, 100] share after all: excluded, never clipped
  if (!(frame > 1)) return undefined;
  return { cls, frame: Number(frame.toPrecision(12)), ...(widened_by !== undefined ? { widened_by } : {}) };
}

/** The top of an Olumi-estimated level's own spread: the estate's "half its size" spread (Science §(j)/(v)). */
export const estimatedSpreadUpper = (level: number): number => level * 1.5;

/**
 * Whether the brief WRITES this figure as a ceiling could be written for this factor: the same number AND the same kind
 * of amount (money for a money level, a percentage for a rate, a plain number for a count). #2842 review P1-8: a bare
 * numeric match let "we have 150 customers" keep a drafted £150 price ceiling.
 */
export function briefWritesFigure(brief: string | undefined, value: number, cls?: ConventionClass, unit?: string | null): boolean {
  if (typeof brief !== 'string' || !finite(value)) return false;
  const kind = cls === 'bounded_rate' ? 'percent'
    : cls === 'non_negative_level' && typeof unit === 'string' && (readCurrencyUnitWithQualifiers(unit).kind === 'currency' || isMoneyPerUnit(unit)) ? 'currency'
      : cls === 'non_negative_level' ? 'plain' : undefined;
  return findStatedAmounts(brief).some((a) => Math.abs(a.magnitude - value) < 1e-9 && (kind === undefined || a.kind === kind));
}

/** "Olumi treats ‘Pro plan price’ as between £0 and £98 a month" (Science §(u)'s words), in the factor's own unit. */
export function conventionFrameWords(label: string, unit: string, frame: number): string {
  // A per-period unit reads as speech here ("£98 a month"), as Science's sentence says it.
  const spoken = (s: string): string => s.replace(/\s*\/\s*(month|year|week|day|quarter)$/, ' a $1');
  const hi = spoken(sayFigure(frame, unit));
  const lo = spoken(sayFigure(0, unit));
  // One unit phrase, said once: "£0 a month … £98 a month" → "£0 and £98 a month"; "0% … 13%" keeps both signs.
  let k = 0;
  while (k < lo.length && k < hi.length && lo[lo.length - 1 - k] === hi[hi.length - 1 - k]) k++;
  const shared = lo.slice(lo.length - k);
  const cut = shared.indexOf(' ');
  const loWords = cut >= 0 ? lo.slice(0, lo.length - (shared.length - cut)) : lo;
  return `Olumi treats ‘${label}’ as between ${loWords} and ${hi}`;
}

/**
 * ⭐ SCIENCE §(u)(b): an OLUMI-drafted size takes its sign from the drawn direction (|amount| per |change|). A user's size,
 * an undirected link, a missing or zero size is returned exactly as written, `resolved: false`.
 */
export function olumiSignedSize(
  link: { readonly direction: string; readonly effect_amount?: number | null; readonly effect_per_source_change?: number | null },
  userStated: boolean,
): { amount: number | null | undefined; per: number | null | undefined; resolved: boolean } {
  const amount = link.effect_amount; const per = link.effect_per_source_change;
  const keep = { amount, per, resolved: false };
  if (userStated || !finite(amount) || !finite(per) || amount === 0 || per === 0) return keep;
  const sign = link.direction === 'positive' ? 1 : link.direction === 'negative' ? -1 : 0;
  if (sign === 0 || Math.sign(amount / per) === sign) return keep;
  return { amount: sign * Math.abs(amount), per: Math.abs(per), resolved: true };
}

export interface SizedLinkReach { readonly from: string; readonly to: string; /** |amount ÷ per| */ readonly r: number }
export interface RescuedLink { readonly from: string; readonly to: string; readonly reframed: readonly string[]; readonly frames: { readonly from?: number; readonly to?: number } }

/**
 * ⭐ RESCUE-ONLY (DL "B"; Science accepted with "the rescue frame is the deterministic formula only, never a search"). Each
 * end of a link is either TODAY's frame or the formula's `convention` frame; nothing in between is ever tried.
 *  1. For each sized link that is not representable today (β = r × source frame ÷ target frame > 1), take the first of
 *     [the source's formula frame, the target's, both] that makes it representable.
 *  2. NO HARM: with every chosen frame in place, a frame is dropped wherever a link that was representable today stops
 *     being so, or a link whose other end has no known frame would read a larger β (a wider source, a narrower target).
 *     Repeated until nothing changes; it only ever removes, so it ends.
 * Returns the factors re-framed and the links that are representable only because of them. Pure.
 */
export function rescueConventionFrames(
  links: readonly SizedLinkReach[],
  today: (label: string) => number | undefined,
  convention: ReadonlyMap<string, number>,
): { applied: string[]; rescued: RescuedLink[] } {
  const ok = (x: number | undefined): x is number => finite(x) && x > 0;
  const beta = (l: SizedLinkReach, frame: (x: string) => number | undefined): number | undefined => {
    const a = frame(l.from); const b = frame(l.to);
    return ok(a) && ok(b) ? (l.r * a) / b : undefined;
  };
  const applied = new Set<string>();
  for (const l of links) {
    const was = beta(l, today);
    if (was === undefined || was <= 1) continue;
    for (const ends of [[l.from], [l.to], [l.from, l.to]]) {
      if (!ends.every((e) => convention.has(e))) continue;
      const b = beta(l, (x) => (ends.includes(x) ? convention.get(x) : today(x)));
      if (b !== undefined && b <= 1) { ends.forEach((e) => applied.add(e)); break; }
    }
  }
  const final = (x: string): number | undefined => (applied.has(x) ? convention.get(x) : today(x));
  for (let changed = true; changed;) {
    changed = false;
    for (const l of links) {
      const touched = [l.from, l.to].filter((e) => applied.has(e));
      if (touched.length === 0) continue;
      const was = beta(l, today); const now = beta(l, final);
      let harmed: boolean;
      if (was !== undefined) harmed = was <= 1 && (now === undefined || now > 1);
      else {
        // The other end has no known frame: the re-framed end must not raise β (a source may only narrow, a target only widen).
        harmed = touched.some((e) => {
          const before = today(e); const after = convention.get(e);
          if (!ok(before) || !ok(after)) return true;
          return e === l.from ? after > before : after < before;
        });
      }
      if (harmed) { touched.forEach((e) => applied.delete(e)); changed = true; }
    }
  }
  const rescued: RescuedLink[] = [];
  for (const l of links) {
    const was = beta(l, today); const now = beta(l, final);
    if (was === undefined || was <= 1 || now === undefined || now > 1) continue;
    const reframed = [l.from, l.to].filter((e) => applied.has(e));
    if (reframed.length === 0) continue;
    rescued.push({ from: l.from, to: l.to, reframed, frames: {
      ...(applied.has(l.from) ? { from: convention.get(l.from)! } : {}), ...(applied.has(l.to) ? { to: convention.get(l.to)! } : {}) } });
  }
  return { applied: [...applied], rescued };
}
