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
 * ⛔ THE LICENCE FOR A SILENT PRODUCT: THE BRIEF'S OWN WORDS BIND THE RATE'S FIGURE TO THE COUNT'S ITEM (AIQ 5891286280;
 * R3's phrase classes 5891270716; DL hold 5891050797 on #2300).
 *
 * The drafter's typed unit ("GBP/subscriber/month") never proves itself: #2291 asks the drafter to write it, so on Paul's
 * plain brief ("Pro plan price … £49 a month … 1,500 paying subscribers") it licensed a silent MRR = price × subscribers
 * the user never stated (served `ed49d44`, 1/5: "reaches above £85k in 99.8%"). Nor does the drafter's own declaration,
 * nor the 5% reconciliation (that corroborates the scale; it is not the user saying it).
 *
 * THE RULE, on the RATE's own figure (`rateValue`, written as money) and the count's OWN noun (no synonyms):
 *  · licensed: "£49 per N", "£49 per N a month", "£49 a month per N", "£49/N", "£49/N/month", "£49 per paying N",
 *    a range "from £49 to £59 per N" (both figures), "each N pays £49", "every N pays £49";
 *  · not licensed (the card): "£49 a month" / "per month" / "monthly"; another noun ("per user" against subscribers);
 *    the phrase on another figure ("£5 per subscriber support cost"); a negated or hypothetical clause ("not per
 *    subscriber", "if we charged £49 per subscriber"); any phrasing not listed. Every miss offers the card: safe.
 */
export function perItemLicence(brief: string, rateValue: number, countNoun: string, countValue?: number): boolean {
  if (typeof brief !== 'string' || !Number.isFinite(rateValue) || !/^[a-z]+$/.test(countNoun)) return false;
  const n = `${countNoun}(?:s|es)?(?![\\w-])`;
  // ⛔ AIQ 5891385320 (1): a modifier on the rate's side ("per ACTIVE subscriber") must be the count's own, as the brief
  // writes the count ("1,500 PAYING subscribers"): different modifiers name different sets, so the card. A bare count
  // ("1,500 subscribers") takes any modifier.
  const countModifiers = new Set<string>();
  if (typeof countValue === 'number' && Number.isFinite(countValue)) {
    const near = new RegExp(`^\\s+(?:([a-z]+)\\s+)?${n}`, 'i');
    for (const a of findStatedAmounts(brief)) {
      if (a.kind === 'currency' || Math.abs(a.magnitude - countValue) > 1e-9 * Math.max(1, Math.abs(countValue))) continue;
      const m = near.exec(brief.slice(a.index + a.matchedText.length));
      if (m !== null && m[1] !== undefined) countModifiers.add(m[1].toLowerCase());
    }
  }
  const agrees = (modifier: string | undefined): boolean =>
    modifier === undefined || countModifiers.size === 0 || countModifiers.has(modifier.toLowerCase());
  const period = '(?:(?:a|per|each|every)\\s+(?:month|year|week|quarter)|monthly|annually|yearly|\\/\\s*(?:month|mo|year|yr))';
  const after = new RegExp(`^\\s*(?:${period}\\s*)?(?:per|\\/)\\s*(?:([a-z]+)\\s+)?${n}`, 'i');
  const range = /^\s*(?:to|-|\u2013|\u2014)\s*[£$€]?\s*\d[\d,]*(?:\.\d+)?\s*[km]?\b/i;
  const before = new RegExp(`\\b(?:each|every)\\s+(?:([a-z]+)\\s+)?${n}\\s+pays\\s*$`, 'i');
  const unsaid = /\b(?:not|never|no|if|unless|would|could|suppose|imagine|were)\b|n['\u2019]t\b/i;
  return findStatedAmounts(brief).some((a) => {
    if (a.kind !== 'currency' || Math.abs(a.magnitude - rateValue) > 1e-9 * Math.max(1, Math.abs(rateValue))) return false;
    const start = a.index;
    const end = a.index + a.matchedText.length;
    // The clause the figure sits in, up to it: a negation or a hypothesis there says nothing of the user's.
    const head = brief.slice(0, start);
    const clause = head.slice(Math.max(...['.', '!', '?', ';', ',', ':', '\n'].map((c) => head.lastIndexOf(c))) + 1);
    if (unsaid.test(clause)) return false;
    let tail = brief.slice(end);
    const partner = range.exec(tail);
    if (partner !== null) tail = tail.slice(partner[0].length);
    const hit = after.exec(tail) ?? before.exec(clause);
    return hit !== null && agrees(hit[1]);
  });
}

/** How a reconciling goal may be worked out: silently (the user's words license it), by the user's confirmation, or not. */
export type ProductReading = 'licensed' | 'card' | 'none';

/**
 * ONE reading, three consumers (AIQ 5891286280 (4)): the mint (`withReconcilingProductIdentity`), the admission of a
 * drafter-declared product (`withoutUnlicensedGoalProduct`) and, through the stored identity, the #2296 card. 'card' is
 * the licence's negation over composing units, so a silent product and a card can never both, or neither, apply.
 */
export function readReconcilingProduct(candidate: CandidateModel, brief: string): ProductReading {
  const r = reconcilingParts(candidate, brief);
  if (r === null) return 'none';
  const c = unitsCompose(candidate.goal.unit, r.metric, r.parts[0], r.parts[1]);
  if (c.kind === 'no') return 'none';
  if (c.kind === 'confirm') return 'card';
  const rate = r.parts.find((p) => p.label === c.rate);
  const count = r.parts.find((p) => p.label === c.count);
  const noun = readCount(count?.unit)?.at(-1);
  return rate !== undefined && typeof rate.baseline_value === 'number' && noun !== undefined
    && perItemLicence(brief, rate.baseline_value, noun, typeof count?.baseline_value === 'number' ? count.baseline_value : undefined)
    ? 'licensed' : 'card';
}

export function withReconcilingProductIdentity(candidate: CandidateModel, brief: string): CandidateModel {
  if (readReconcilingProduct(candidate, brief) !== 'licensed') return candidate;
  const r = reconcilingParts(candidate, brief)!;
  return {
    ...candidate,
    identities: [...(candidate.identities ?? []), { outcome: r.metric, operation: 'product', factors: [r.parts[0].label, r.parts[1].label], provenance: 'inferred' }],
  };
}

/**
 * ⛔ A PRODUCT THE DRAFTER DECLARES ON THE GOAL IS ADMITTED SILENTLY ONLY UNDER THE SAME LICENCE (AIQ 5891286280, MG's
 * half; R3 served `b5a673a`: a drafter-declared MRR = price × subscribers on Paul's plain brief, price stored "£/month").
 * Where the goal's two stated parts reconcile and compose (the card's own domain) and the brief does not license it,
 * the declaration is taken off, whatever provenance the drafter gave it (its tag is its own word), so the goal is
 * card-eligible exactly as if the drafter had declared nothing. Outside that domain, and when licensed, the candidate is
 * returned as it came (the same object).
 */
export function withoutUnlicensedGoalProduct(candidate: CandidateModel, brief: string): CandidateModel {
  const metric = candidate.goal?.metric;
  const declared = (candidate.identities ?? []).filter((i) => i.outcome === metric && i.operation === 'product');
  if (declared.length !== 1) return candidate;
  const bare: CandidateModel = { ...candidate, identities: (candidate.identities ?? []).filter((i) => i !== declared[0]) };
  const r = reconcilingParts(bare, brief);
  if (r === null) return candidate;
  const same = new Set(declared[0]!.factors);
  if (same.size !== 2 || !r.parts.every((p) => same.has(p.label))) return candidate;
  return readReconcilingProduct(bare, brief) === 'card' ? bare : candidate;
}
