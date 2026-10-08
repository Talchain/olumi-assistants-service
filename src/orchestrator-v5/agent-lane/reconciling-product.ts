/**
 * ⛔ A GOAL WHOSE STATED LEVEL IS THE PRODUCT OF ITS TWO STATED PARTS IS WORKED OUT AS ONE (R3 #72 5886596030).
 *
 * Sums are minted from a goal's parents (`findSumTallies`); products came ONLY from the drafter (`identities`). On
 * Paul's own brief ("£49 … 1,500 paying subscribers and £75k MRR") 3 of 5 served drafts declared none, so MRR was two
 * default-strength links: £59 reached a median £77.3k where 1,500 × £59 is £88.5k, and the reply said the target "is
 * not met under any current option".
 *
 * When the drafter declares no identity for the goal, this declares `goal = A × B` as OLUMI's reading
 * (`provenance: 'inferred'`, so `stated_in_brief: false`) only when every figure is the user's and they reconcile:
 *  · the goal's current level o is stated (explicit, written in the brief, and not the target written once);
 *  · the goal has EXACTLY TWO non-option parents, both factors whose levels a, b the user wrote (non-zero);
 *  · |o − a·b| ≤ 5% of |o| — ISL's own reconciliation tolerance (`IDENTITY_RECONCILIATION_TOLERANCE`).
 * Anything else returns the candidate untouched. Admission then judges it like any declaration (`markProductIdentities`),
 * and PLoT/ISL frame-check it (a zero operand is withdrawn; ISL's k-scale absorbs the ≤ 5% gap).
 */
import type { CandidateModel } from './admit-model.js';
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../cee/extraction/numeric-parser.js';
import { figureTheUserWrote, levelWrittenApartFromTarget } from './stated-by-user.js';
import { sayFigure } from './say-figure.js';
import { readCount, readMoney, readMoneyTotal, readUnitParts } from './same-unit.js';

export { periodIn, readMoneyTotal, sameUnit } from './same-unit.js';

/** ISL `robustness_analyzer_v2.py` `IDENTITY_RECONCILIATION_TOLERANCE`: the same share, never a looser one. */
export const RECONCILIATION_TOLERANCE = 0.05;

const stated = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0;

/** An accumulation's first part is S₀: today's stock, never the stock projected at the deadline. */
export function accumulationStockFor(node: Record<string, unknown>, byId: ReadonlyMap<string, Record<string, unknown>>): Record<string, unknown> | null {
  const identity = node.nonlinear_identity;
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const carrier = identity as Record<string, unknown>;
  const ids = carrier.factor_ids;
  if (carrier.operation !== 'accumulation' || !Array.isArray(ids) || ids.length !== 3
    || !ids.every((id) => typeof id === 'string') || new Set(ids).size !== 3 || ids.some((id) => id === node.id)) return null;
  return byId.get(ids[0] as string) ?? null;
}

/** The candidate equivalent, before the accumulation carrier is written by late admission. */
function reconciliationFactor(candidate: CandidateModel, label: string) {
  const accumulation = (candidate.identities ?? []).find((i) => i.outcome === label && i.operation === 'accumulation');
  if (accumulation !== undefined && accumulation.factors.length !== 3) return undefined;
  const today = accumulation !== undefined ? accumulation.factors[0] : label;
  return candidate.factors.find((f) => f.label === today);
}


/**
 * ⛔ AIQ 5886846493 + 5886967509 (HARD): (money per <unit> per period) × (count of that <unit>) = money per period, in the
 * goal's OWN currency and period. The rate's per-unit denominator MUST name the count ("£/subscriber/month" ×
 * "subscribers"): it is what makes a product the only dimensionally valid reading. No denominator ("GBP/month"),
 * another count, anything unknown or scaled (£k) → no mint. "3 engineers × £25k budget ≈ £75k MRR" fails on the period.
 */
export function unitsCompose(goalUnit: unknown, goalLabel: string, a: { unit: unknown; label: string }, b: { unit: unknown; label: string }): Composition {
  const goal = readMoney(goalUnit, goalLabel);
  // The goal is money per period itself: a goal per subscriber (ARPU) is not price × subscribers.
  if (goal === null || goal.per !== null) return NO;
  let confirm: Composition = NO;
  for (const [m, c] of [[a, b], [b, a]] as const) {
    const money = readMoney(m.unit, '');
    // DL #2802 P0: the FULL reader decides it is a count; readCount alone takes 'percent'/'pp' as nouns (sameUnit needs that).
    const count = readUnitParts(c.unit)?.kind === 'count' ? readCount(c.unit) : null;
    if (money === null || count === null) continue;
    if (money.code !== goal.code || money.period !== goal.period) continue;
    // AIQ 5886967509: the DENOMINATOR is the dimensional proof. A rate with none ("GBP/month") could be summed as easily
    // as multiplied, so it is a CONFIRMATION for the user, never a silent mint. It must be the count's own noun (its last
    // word: "subscriber seats" counts seats), and every word of it must be in the count.
    const per = money.per;
    if (per === null) { confirm = { kind: 'confirm', rate: m.label, count: c.label, code: goal.code }; continue; }
    if (per[per.length - 1] !== count[count.length - 1] || !per.every((w) => count.includes(w))) continue;
    // A per-N-month rate composes but is never the parser's proof (AIQ 5891385320 (3)): the card.
    if (money.mixed === true) { confirm = { kind: 'confirm', rate: m.label, count: c.label, code: goal.code }; continue; }
    return { kind: 'proof', rate: m.label, count: c.label, code: goal.code };
  }
  return confirm;
}


export type Composition =
  | { readonly kind: 'proof' | 'confirm'; readonly rate: string; readonly count: string; readonly code: string }
  | { readonly kind: 'no' };
const NO: Composition = { kind: 'no' };

/** The two parents that are the user's own levels, when every OTHER parent is a link #2328 re-points; else null. */
function twoUserPartsBesideRepointable(candidate: CandidateModel, metric: string, sources: readonly string[]): string[] | null {
  const factor = (label: string) => candidate.factors.find((f) => f.label === label);
  const users = sources.filter((s) => { const f = factor(s); return f !== undefined && f.baseline_known === true && f.provenance === 'explicit' && stated(f.baseline_value); });
  // A brief that also states a third parent's level ("churn is 3.5%") has three of the user's figures among the parents
  // (P0 PARTNER 5904117525): the product is the ONE pair of them that reconciles with the goal and whose units compose.
  let pair: string[] = users;
  if (users.length > 2) {
    const o = candidate.goal.baseline_value;
    const pairs: string[][] = [];
    for (let i = 0; i < users.length; i += 1) for (let j = i + 1; j < users.length; j += 1) {
      const a = factor(users[i]!)!; const b = factor(users[j]!)!;
      if (!stated(o) || Math.abs(o - (a.baseline_value as number) * (b.baseline_value as number)) > RECONCILIATION_TOLERANCE * Math.abs(o)) continue;
      if (unitsCompose(candidate.goal.unit, metric, a, b).kind !== 'no') pairs.push([users[i]!, users[j]!]);
    }
    if (pairs.length !== 1) return null;
    pair = pairs[0]!;
  }
  if (pair.length !== 2) return null;
  const reaches = (from: string, skip: unknown): boolean => {
    const seen = new Set([from]); const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const l of candidate.links) {
        if (l === skip || l.from !== at || l.to === metric) continue;
        if (pair.includes(l.to)) return true;
        if (!seen.has(l.to)) { seen.add(l.to); queue.push(l.to); }
      }
    }
    return false;
  };
  for (const s of sources.filter((x) => !pair.includes(x))) {
    const f = factor(s);
    const links = candidate.links.filter((l) => l.from === s && l.to === metric);
    if (f === undefined || links.length !== 1 || readCurrencyUnitWithQualifiers(f.unit).kind === 'currency') return null;
    const l = links[0]!;
    if (l.provenance === 'explicit' || l.effect_provenance == null || l.effect_provenance === 'explicit') return null;
    if (!stated(l.effect_amount ?? null) || !stated(l.effect_per_source_change ?? null) || reaches(s, l)) return null;
  }
  return pair;
}

/**
 * Everything but the units: the goal's stated level o and its EXACTLY TWO drafted non-option parents, both the user's
 * figures, reconciling within 5%. Shared by the silent mint and the confirmation, so the two can never disagree on it.
 */
function reconcilingParts(candidate: CandidateModel, brief: string) {
  const goal = candidate.goal;
  const metric = goal.metric;
  const o = goal.baseline_value;
  if (goal.baseline_known !== true || goal.baseline_provenance !== 'explicit' || !stated(o)) return null;
  if (!figureTheUserWrote(o, goal.unit, brief) || !levelWrittenApartFromTarget(o, goal.unit, goal.value, brief)) return null;
  if ((candidate.identities ?? []).some((i) => i.outcome === metric)) return null;
  const options = new Set(candidate.options.map((opt) => opt.label));
  const all = [...new Set(candidate.links.filter((l) => l.to === metric).map((l) => l.from))].filter((s) => !options.has(s));
  // An accumulation parent is S_N, not a user-stated level today. Its goal product must be declared, never minted
  // from a projected factor's own figure; late accumulation admission refuses a carrier with no admitted goal product.
  if (all.some((s) => (candidate.identities ?? []).some((i) => i.outcome === s && i.operation === 'accumulation'))) return null;
  // ⛔ A THIRD PARENT THE PRODUCT WILL RE-POINT DOES NOT HIDE THE READING (R3 5903882132, guest `73192fdf`; DL 5903903027):
  // 1 in 5 constructor drafts declare no product and link churn straight into MRR beside price and subscribers — no card,
  // and Run 1 stated an additive "£59 → ~£76.8k, 0%". The extra parent must be exactly what `product-goal-extra-parent.ts`
  // re-points once the product is read (a non-money factor, Olumi-sized, with no route to either part); anything else —
  // an addend, a money parent, a risk, a user-stated link — keeps today's refusal.
  const sources = all.length === 2 ? all : twoUserPartsBesideRepointable(candidate, metric, all);
  if (sources === null || sources.length !== 2) return null;
  const parts = sources.map((s) => candidate.factors.find((f) => f.label === s));
  const levels: number[] = [];
  for (const f of parts) {
    if (f === undefined || f.baseline_known !== true || f.provenance !== 'explicit' || !stated(f.baseline_value)) return null;
    if (!figureTheUserWrote(f.baseline_value, f.unit, brief)) return null;
    levels.push(f.baseline_value);
  }
  if (Math.abs(o - levels[0]! * levels[1]!) > RECONCILIATION_TOLERANCE * Math.abs(o)) return null;
  return { metric, o, parts: parts as [NonNullable<(typeof parts)[number]>, NonNullable<(typeof parts)[number]>], levels };
}

/**
 * ⛔ FORK (iii) (R3 5891486222; AIQ 5891286280; DL hold 5891050797): EVERY goal product Olumi derives waits for the user's
 * Yes. Where the goal's three stated figures reconcile and the units compose (with or without the per-item denominator),
 * the reading is kept on the goal as Olumi's (`provenance: 'inferred'` → `stated_in_brief: false`). PLoT does not forward
 * an inferred goal product (its variant (d)), so #416 withholds the goal's chance under its existing reason until the
 * user presses the #2296 card, whose approval (#2292) makes it `stated_in_brief: true`. The drafter's typed unit never
 * licenses anything: it only decides whether the units compose.
 */
export function withReconcilingProductIdentity(candidate: CandidateModel, brief: string): CandidateModel {
  const r = reconcilingParts(candidate, brief);
  if (r === null) return candidate;
  const c = unitsCompose(candidate.goal.unit, r.metric, r.parts[0], r.parts[1]);
  if (c.kind === 'no') return candidate;
  return {
    ...candidate,
    identities: [...(candidate.identities ?? []), { outcome: r.metric, operation: 'product', factors: [r.parts[0].label, r.parts[1].label], provenance: 'inferred' }],
  };
}

/** Olumi's own money parent of the goal that only made the goal's stated level add up: dropped, and said. */
export interface GapResidual {
  readonly goal: string; readonly label: string; readonly value: number; readonly code: string; readonly period: 'month' | 'year';
  readonly o: number; readonly parts: readonly [string, string]; readonly levels: readonly [number, number];
}

/** The residual must BE the brief's own gap, to rounding: 0.5% of the goal's level (£375 on £75k). */
export const GAP_ROUNDING = 0.005;

/**
 * ⛔ OLUMI'S GAP RESIDUAL IS NOT A REVENUE STREAM (R3 5904253749, served `ef042ce` m0 `c8108752`; AIQ 5904262145 +
 * 5904406904; DL 5904403673). 1 in 10 served constructor drafts gave MRR three parents: the user's £49 and 1,500, and an
 * Olumi "non-Pro MRR" of £1,500/month — exactly £75,000 − £49 × 1,500, a stream the brief never names. Three parents
 * meant no product reading and no card, and Run 1 stated an additive "£59 → £75.0k–£78.4k".
 *
 * Dropped (and SAID, AIQ's condition) only when it is nothing but that plug:
 *  · the goal's level o is the user's, and its non-option parents are EXACTLY the user's two levels a, b plus this one;
 *  · a × b reconciles with o within ISL's 5% and the units compose (the card's own reading, so the card then applies);
 *  · it is Olumi's (not explicit, not a figure the brief writes), money in the goal's own currency AND period, sized to
 *    o − a·b within 0.5% of o;
 *  · nothing else touches it: no link in, one link out (into the goal, not the user's), no option sets it, no limit
 *    names it, and no goal identity other than a product over exactly a × b.
 * A user-stated other revenue, an Olumi addend of any other size, or one with causes of its own is kept as today.
 */
export function withoutGapResidual(candidate: CandidateModel, brief: string): { model: CandidateModel; residual: GapResidual } | null {
  const goal = candidate.goal;
  const metric = goal?.metric;
  const o = goal?.baseline_value;
  if (goal === undefined || goal.baseline_known !== true || goal.baseline_provenance !== 'explicit' || !stated(o)) return null;
  if (!figureTheUserWrote(o, goal.unit, brief) || !levelWrittenApartFromTarget(o, goal.unit, goal.value, brief)) return null;
  const options = new Set(candidate.options.map((opt) => opt.label));
  const all = [...new Set(candidate.links.filter((l) => l.to === metric).map((l) => l.from))].filter((s) => !options.has(s));
  const factor = (label: string) => candidate.factors.find((f) => f.label === label);
  const isUsers = (label: string): boolean => {
    const f = factor(label);
    return f !== undefined && f.baseline_known === true && f.provenance === 'explicit' && stated(f.baseline_value) && figureTheUserWrote(f.baseline_value, f.unit, brief);
  };
  // The user's product beside the residual: the goal's own two user parents (m0), or ONE carrier whose declared product is
  // a user part × an unlevelled operand read at TODAY's level through its one user-levelled cause (m8).
  const read = all.length === 3 ? twoUsersBeside(all, isUsers) : all.length === 2 ? carrierAtTodayBeside(candidate, all, isUsers) : null;
  if (read === null) return null;
  const a = factor(read.a)!;
  const b = factor(read.b)!;
  const product = (a.baseline_value as number) * (b.baseline_value as number);
  if (Math.abs(o - product) > RECONCILIATION_TOLERANCE * Math.abs(o)) return null;
  const composes = unitsCompose(goal.unit, metric, a, b);
  if (composes.kind === 'no') return null;
  const [rate, count] = composes.rate === b.label ? [b, a] : [a, b];
  const label = read.residual;
  const r = factor(label);
  if (r === undefined || r.provenance === 'explicit' || r.baseline_known === true || !stated(r.baseline_value)) return null;
  const gm = readMoneyTotal(goal.unit, metric);
  // ⛔ Money the brief WRITES at this size is the user's, whatever the draft tagged. A bare count is not money: on Paul's
  // brief the gap (£1,500) equals the subscriber count (1,500), which `figureTheUserWrote` reads as the same figure.
  const size = r.baseline_value;
  if (findStatedAmounts(brief).some((m) => m.kind === 'currency' && Math.abs(m.magnitude - Math.abs(size)) < 0.5)) return null;
  const rm = readMoneyTotal(r.unit, label);
  if (gm === null || rm === null || gm.code !== rm.code || gm.period !== rm.period) return null;
  if (Math.abs(r.baseline_value - (o - product)) > GAP_ROUNDING * Math.abs(o)) return null;
  const touching = candidate.links.filter((l) => l.from === label || l.to === label);
  if (touching.length !== 1 || touching[0]!.to !== metric) return null;
  if (touching[0]!.provenance === 'explicit' || touching[0]!.effect_provenance === 'explicit') return null;
  if (candidate.options.some((opt) => (opt.interventions ?? []).some((i) => i.factor_label === label))) return null;
  if (candidate.constraints.some((c) => c.metric === label)) return null;
  const ids = (candidate.identities ?? []).filter((i) => i.outcome === metric || i.factors.includes(label));
  if (ids.some((i) => i.outcome !== metric || i.operation !== 'product' || i.factors.length !== 2 || !i.factors.every((f) => read.goalProductParts.includes(f)))) return null;
  return {
    model: { ...candidate, factors: candidate.factors.filter((f) => f.label !== label), links: candidate.links.filter((l) => l !== touching[0]) },
    residual: { goal: metric, label, value: r.baseline_value, code: gm.code, period: gm.period, o, parts: [rate.label, count.label], levels: [rate.baseline_value as number, count.baseline_value as number] },
  };
}

interface ResidualReading {
  /** The two user factors whose TODAY levels make the product. */
  readonly a: string; readonly b: string;
  /** The goal parent that is the candidate residual. */
  readonly residual: string;
  /** The parts a goal-level product may be declared over (none may name the residual). */
  readonly goalProductParts: readonly string[];
}

/** m0: exactly two of the goal's three parents are the user's levels; the third is the candidate residual. */
function twoUsersBeside(all: readonly string[], isUsers: (label: string) => boolean): ResidualReading | null {
  const users = all.filter(isUsers);
  if (users.length !== 2) return null;
  return { a: users[0]!, b: users[1]!, residual: all.find((s) => !users.includes(s))!, goalProductParts: users };
}

/**
 * m8 (R3 5904253749 served `ef042ce` `5c909daa`): MRR = ‘Pro plan MRR’ (Olumi's product of ‘Pro plan price’ × ‘Month-12
 * paying subscribers’) + Olumi's ‘non-Pro MRR’ £1,500. The carrier's product is read at TODAY's level exactly as the card
 * reads it (`identity-proposal.ts` `todaysOperand`): one part is the user's factor, the other has no level and ONE cause
 * carrying the user's level. The carrier holds nothing but that product (its only causes are the two parts).
 */
function carrierAtTodayBeside(candidate: CandidateModel, all: readonly string[], isUsers: (label: string) => boolean): ResidualReading | null {
  const options = new Set(candidate.options.map((opt) => opt.label));
  const causesOf = (label: string): string[] => [...new Set(candidate.links.filter((l) => l.to === label).map((l) => l.from))].filter((s) => !options.has(s));
  for (const [carrier, residual] of [[all[0]!, all[1]!], [all[1]!, all[0]!]] as const) {
    const products = (candidate.identities ?? []).filter((i) => i.outcome === carrier);
    if (products.length !== 1 || products[0]!.operation !== 'product' || products[0]!.factors.length !== 2) continue;
    const [x, y] = products[0]!.factors as [string, string];
    const causes = causesOf(carrier);
    if (causes.length !== 2 || !causes.includes(x) || !causes.includes(y)) continue;
    for (const [user, operand] of [[x, y], [y, x]] as const) {
      if (!isUsers(user)) continue;
      const f = candidate.factors.find((n) => n.label === operand);
      const unlevelled = candidate.outcomes.some((n) => n.label === operand) || (f !== undefined && !stated(f.baseline_value));
      if (!unlevelled || (candidate.identities ?? []).some((i) => i.outcome === operand)) continue;
      const levelled = causesOf(operand).filter(isUsers);
      if (levelled.length !== 1 || (candidate.identities ?? []).some((i) => i.outcome === levelled[0])) continue;
      return { a: user, b: levelled[0]!, residual, goalProductParts: [] };
    }
  }
  return null;
}

/**
 * AIQ 5904406904's condition: the drop is said, in Olumi's voice, with the card's own figures — the card's own formatter
 * (`sayFigure`), so a £49.99 price is never misquoted as £50 (AIQ 5904567773 follow-up 1).
 */
export function gapResidualLine(g: GapResidual): string {
  const money = (v: number): string => sayFigure(v, g.code);
  // AIQ 5904567773 follow-up 2: the brief may NAME such a stream without a figure ("plus some add-on revenue"), so the
  // line claims only what the code checked — the brief writes no money of this size — never that the stream is unnamed.
  return `I had added ‘${g.label}’ of ${money(g.value)} a ${g.period} so that ‘${g.goal}’ matched your ${money(g.o)}. Its size was my guess, `
    + `not a figure you gave, so I've taken it out. Your ${money(g.levels[0])} × ${sayFigure(g.levels[1], '')} = ${money(g.levels[0] * g.levels[1])} is on the card for you to confirm.`;
}

/** A goal product the draft declared whose units provably don't combine into the goal's: dropped, and said. */
export interface DroppedGoalProduct { readonly goal: string; readonly factors: readonly string[]; readonly into: string }

/** The goal currency's own symbol, DERIVED from the one currency vocabulary (never a second list: ROADMAP 2.972's guard). */
const symbolOf = (code: string): string => Object.entries(CURRENCY_SYMBOL_TO_CODE).find(([, c]) => c === code)?.[0] ?? code;
type Identity = NonNullable<CandidateModel['identities']>[number];

/**
 * ⛔ AIQ 5892219245 (3): units that DON'T COMPOSE are not a reading at all ("Olumi reads MRR as ‘Engineers’ × ‘Budget per
 * engineer’" would present nonsense as Olumi's view). Said only when every unit reads — the goal as money per period,
 * each factor as money or a count — and still fails `unitsCompose`, even reading a period-less £ at the goal's period.
 * A unit Olumi cannot read proves nothing about dimensions, so that declaration is demoted and withheld instead.
 * Returns the goal's unit in words ("£ per month").
 */
function clashInto(candidate: CandidateModel, i: Identity): string | null {
  const goal = candidate.goal;
  const g = readMoney(goal.unit, goal.metric);
  if (g === null || g.per !== null || g.period === null || i.factors.length !== 2) return null;
  const parts = i.factors.map((s) => candidate.factors.find((f) => f.label === s));
  if (parts.some((f) => f === undefined || (readMoney(f.unit, '') === null && readCount(f.unit) === null))) return null;
  const [a, b] = parts as [NonNullable<(typeof parts)[number]>, NonNullable<(typeof parts)[number]>];
  if (unitsCompose(goal.unit, goal.metric, a, b).kind !== 'no') return null;
  // ⛔ A money unit with NO period (a bare "GBP") proves nothing about the period: it is how the drafter types Paul's
  // real monthly price (C46's rows carry exactly that product). Read at the goal's period first; only a clash that
  // survives it (a stated other period, a count × a count, another count's denominator) is not a reading at all.
  const atGoalPeriod = (f: typeof a): typeof a => {
    const m = readMoney(f.unit, '');
    return m !== null && m.period === null && typeof f.unit === 'string' ? { ...f, unit: `${f.unit} per ${g.period}` } : f;
  };
  if (unitsCompose(goal.unit, goal.metric, atGoalPeriod(a), atGoalPeriod(b)).kind !== 'no') return null;
  return `${symbolOf(g.code)} per ${g.period}`;
}

/**
 * AIQ 5892219245 (scope) + PR Review 5892269272: a GOAL CARRIER in the card's domain — a non-option parent of the goal
 * whose declared product is the goal's own reading: its two levels and the goal's are the user's (explicit), within 5%.
 * Read on the NUMBERS only, a superset of PLoT #420's `goalCarrierIds`: CEE's and PLoT's unit readers differ (PLoT lets
 * a period-less rate compose), so a CEE units test here could leave a carrier PLoT withholds as inferred arriving as the
 * user's. Whatever other parents the goal has.
 */
function goalCarrierReading(candidate: CandidateModel, i: Identity): boolean {
  const goal = candidate.goal;
  const o = goal.baseline_value;
  if (i.operation !== 'product' || i.outcome === goal.metric || i.factors.length !== 2) return false;
  if (candidate.options.some((opt) => opt.label === i.outcome)) return false;
  if (!candidate.links.some((l) => l.from === i.outcome && l.to === goal.metric)) return false;
  if (goal.baseline_known !== true || goal.baseline_provenance !== 'explicit' || !stated(o)) return false;
  const levels: number[] = [];
  for (const label of i.factors) {
    const f = reconciliationFactor(candidate, label);
    if (f === undefined || f.baseline_known !== true || f.provenance !== 'explicit' || !stated(f.baseline_value)) return false;
    levels.push(f.baseline_value);
  }
  return Math.abs(o - levels[0]! * levels[1]!) <= RECONCILIATION_TOLERANCE * Math.abs(o);
}

/**
 * ⛔ NO CONSTRUCTION PATH WRITES A GOAL PRODUCT AS THE USER'S (AIQ 5892219245 (1); FORK (iii), R3 served `b5a673a`: a
 * drafter-declared MRR = price × subscribers on Paul's plain brief). A product the drafter declares on the goal, or on a
 * goal carrier in the card's domain, is the drafter's reading whatever it tagged (`admit-model.ts` turns `explicit`
 * into `stated_in_brief: true`). Only the card's Yes (#2292) or a user-authored edit makes it the user's.
 *  · Units that don't compose into the goal's (PR Review CHANGES_REQUIRED on 9af5ffb4: "£75k MRR = 3 engineers × £25k
 *    budget per engineer", numbers matching) → DROPPED, and said in `dropped` for the `loss` line (AIQ (3)).
 *  · Anything else (inside the card domain; the levels not all the user's; more than 5% off) → DEMOTED to `inferred`,
 *    so PLoT (d) withholds the goal chance until the user's Yes (AIQ (2), (4)).
 * A candidate with nothing to change comes back as the very same object.
 */
export function unconfirmGoalProducts(candidate: CandidateModel, brief: string): { model: CandidateModel; dropped: DroppedGoalProduct[] } {
  void brief;
  const metric = candidate.goal?.metric;
  const dropped: DroppedGoalProduct[] = [];
  let changed = false;
  const kept: Identity[] = [];
  for (const i of candidate.identities ?? []) {
    const onGoal = i.outcome === metric && i.operation === 'product';
    if (!onGoal && !goalCarrierReading(candidate, i)) { kept.push(i); continue; }
    const into = onGoal ? clashInto(candidate, i) : null;
    if (into !== null) { dropped.push({ goal: metric, factors: [...i.factors], into }); changed = true; continue; }
    if (i.provenance === 'inferred') { kept.push(i); continue; }
    kept.push({ ...i, provenance: 'inferred' });
    changed = true;
  }
  return changed ? { model: { ...candidate, identities: kept }, dropped } : { model: candidate, dropped };
}

/** AIQ 5892219245 (3)'s disclosed line for a dropped goal product. */
export function droppedGoalProductLine(d: DroppedGoalProduct): string {
  return `The draft proposed ‘${d.goal}’ = ${d.factors.map((f) => `‘${f}’`).join(' × ')}, but those units don't combine into ${d.into}, so it is not used.`;
}
