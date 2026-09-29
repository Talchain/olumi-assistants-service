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
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWrote, levelWrittenApartFromTarget } from './stated-by-user.js';

/** ISL `robustness_analyzer_v2.py` `IDENTITY_RECONCILIATION_TOLERANCE`: the same share, never a looser one. */
export const RECONCILIATION_TOLERANCE = 0.05;

const stated = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0;

type Period = 'month' | 'year' | null;
const MONTH = new Set(['month', 'months', 'mo', 'monthly', 'pcm', 'mrr']);
const YEAR = new Set(['year', 'years', 'yr', 'annum', 'annual', 'annually', 'pa', 'arr']);
const words = (s: string): string[] => s.toLowerCase().replace(/[()]/g, ' ').replace(/\//g, ' / ').split(/[\s-]+/).filter((w) => w !== '');
const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function periodOf(ws: readonly string[]): Period | 'both' {
  const m = ws.some((w) => MONTH.has(w));
  const y = ws.some((w) => YEAR.has(w));
  return m && y ? 'both' : m ? 'month' : y ? 'year' : null;
}

const isPeriod = (w: string): boolean => MONTH.has(w) || YEAR.has(w);
const isCurrency = (w: string): boolean => readCurrencyUnitWithQualifiers(w).kind === 'currency';
/** The words `readCurrencyUnitWithQualifiers` lets stand beside the currency itself ("GBP recurring revenue", "£ a month"). */
const MONEY_WORDS = new Set(['revenue', 'recurring', 'a']);

/**
 * Money in ONE unscaled currency, its period, and its ONE per-unit denominator ("£/subscriber/month" → [subscriber]).
 *
 * ⛔ PR Review on 9fdc3f96: every "/" or "per" opens a segment, and each segment after the money must be a period or THE
 * denominator. A second denominator ("GBP per subscriber per seat per month") makes price × subscribers money per seat
 * per month, not the goal's money per month. So it is refused, as is a segment that mixes a period into a denominator.
 */
function readMoney(unit: unknown, label: string): { code: string; period: Period; per: string[] | null; mixed?: true } | null {
  if (typeof unit !== 'string') return null;
  const r = readCurrencyUnitWithQualifiers(unit);
  if (r.kind !== 'currency' || r.currencyCode === undefined || (r.multiplier ?? 1) !== 1) return null;
  const ws = words(unit);
  const segments: string[][] = [[]];
  for (const w of ws) {
    if (w === '/' || w === 'per') segments.push([]);
    else segments[segments.length - 1]!.push(w);
  }
  if (segments.some((s) => s.length === 0) || !segments[0]!.every((w) => isCurrency(w) || isPeriod(w) || MONEY_WORDS.has(w))) return null;
  // ⛔ AIQ 5891385320 (3): "per subscriber-month" names the count's noun with the period joined on. It composes (£ per
  // subscriber-month × subscribers IS £/month); the parser just never finished it, so it read as "don't compose" and got
  // neither a card nor the withhold. Read as the denominator plus its period, marked `mixed`: never a silent mint, the card.
  let mixed = false;
  for (const seg of segments.slice(1)) {
    if (seg.length >= 2 && isPeriod(seg[seg.length - 1]!) && !seg.slice(0, -1).some(isPeriod)) { mixed = true; }
  }
  if (mixed) {
    const parts = segments.slice(1);
    if (parts.length !== 1 || ws.filter(isPeriod).length !== 1) return null;
    const seg = parts[0]!;
    const nouns = seg.slice(0, -1);
    if (!nouns.every((w) => /^[a-z]+$/.test(w) && !isCurrency(w) && !MONEY_WORDS.has(w))) return null;
    const period = periodOf([seg[seg.length - 1]!]);
    if (period === 'both' || period === null) return null;
    return { code: r.currencyCode, period, per: nouns.map(singular), mixed: true };
  }
  const denominators = segments.slice(1).filter((s) => !s.every(isPeriod));
  if (denominators.length > 1) return null;
  if (denominators.some((s) => !s.every((w) => /^[a-z]+$/.test(w) && !isPeriod(w) && !isCurrency(w) && !MONEY_WORDS.has(w)))) return null;
  // ⛔ PR Review on 98be677f: ONE period at most. "GBP per subscriber per month per month" is money per month², and
  // "GBP monthly per subscriber per month" says the period twice; neither composes to money per month.
  if (ws.filter(isPeriod).length > 1) return null;
  // The goal's own name can carry its period ("MRR", "Monthly recurring revenue") when its unit does not.
  const own = periodOf(ws);
  const period = own !== null ? own : periodOf(words(label));
  if (period === 'both') return null;
  return { code: r.currencyCode, period, per: denominators.length === 1 ? denominators[0]!.map(singular) : null };
}

/** A COUNT: words only ("subscribers", "paying customers") — no currency, no %, no period, no "per" (a rate). */
function readCount(unit: unknown): string[] | null {
  if (typeof unit !== 'string' || !/^[a-z][a-z\s-]*$/i.test(unit.trim())) return null;
  const ws = words(unit);
  if (ws.length === 0 || ws.includes('per') || periodOf(ws) !== null || readCurrencyUnitWithQualifiers(unit).kind === 'currency') return null;
  return ws.map(singular);
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
    const count = readCount(c.unit);
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
  const sources = [...new Set(candidate.links.filter((l) => l.to === metric).map((l) => l.from))].filter((s) => !options.has(s));
  if (sources.length !== 2) return null;
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

/**
 * ⛔ A PRODUCT THE DRAFTER DECLARES ON THE GOAL IS THE DRAFTER'S READING, NEVER THE USER'S STATEMENT (FORK (iii); R3
 * served `b5a673a`: a drafter-declared MRR = price × subscribers on Paul's plain brief). Every declared goal product is
 * kept but DEMOTED to `inferred`, whatever provenance the drafter tagged it with (its tag is its own word), so it waits
 * for the user's Yes like the mint's.
 *
 * ⛔ PR Review CHANGES_REQUIRED on 9af5ffb4: NOT only inside the card's domain. A declaration whose numbers happen to
 * match but whose units do not compose ("£75k MRR = 3 engineers × £25k budget per engineer") left as the drafter's
 * `explicit` became `stated_in_brief: true` at admission, the user's product, and PLoT (d) withholds only inferred ones.
 * Fail closed: outside the domain it is withheld with no card (the no-card words), never computed as the user's. Only the
 * card's Yes makes a goal product the user's. A candidate with nothing to demote comes back as the very same object.
 */
export function withGoalProductUnconfirmed(candidate: CandidateModel, brief: string): CandidateModel {
  void brief;
  const metric = candidate.goal?.metric;
  const demote = (i: NonNullable<CandidateModel['identities']>[number]): boolean =>
    i.outcome === metric && i.operation === 'product' && i.provenance !== 'inferred';
  if (!(candidate.identities ?? []).some(demote)) return candidate;
  return { ...candidate, identities: (candidate.identities ?? []).map((i) => (demote(i) ? { ...i, provenance: 'inferred' } : i)) };
}
