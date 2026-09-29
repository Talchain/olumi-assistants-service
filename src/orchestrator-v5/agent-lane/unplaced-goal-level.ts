/**
 * ⛔ THE BRIEF'S LEVEL THAT NEVER REACHED A CHANGE GOAL (R3-B #72 5894575583; MG 5894657102 / 5894719651; AIQ (b) ACK
 * 5894808343 (1)).
 *
 * Served `7c23be87` and 18 of 44 saved change goals (0 LLM): "Monthly spend is £45k; we want to cut costs by 20%" drafts
 * the goal as a change (`change_rel` −0.2) with NO current level: the drafter names the goal "costs" and puts the £45k
 * nowhere (13 saves) or on a side factor (5). A change is measured from today's level, so no chance of the cut was shown,
 * and the build said the level "was not stated" while the user wrote it.
 *
 * AIQ (b): the brief's ONE figure in the goal's own terms is taken as today's level AS OLUMI'S DISCLOSED READING (the
 * join of "costs" to "Monthly spend" is Olumi's; the figure, the change and the direction are the user's, in one
 * sentence). PURE: no model call, no write; the caller writes the reading and says it.
 *
 * `adopt` only when ALL hold:
 *  · the goal's target is a stated CHANGE (`change_rel` | `change_abs`), and no level of the user's was admitted for it;
 *  · the goal's unit reads as ONE currency and the goal names ONE period (`readMoneyTotal`: its unit, else its name);
 *  · exactly ONE amount in the brief is in that currency, other than the change itself (`change_abs`'s own figure) —
 *    two would be a guess (AIQ row (b));
 *  · that amount's own clause names the SAME period ("Monthly spend is £45k", "£45k a month"): "£540k a year" beside a
 *    monthly goal, or a clause naming no period at all, is never read as this goal's level (AIQ row (c), the #2305
 *    period lesson);
 *  · it is in the SAME SENTENCE as the goal's own change figure ("…is £45k; we want to cut costs by 20%"): AIQ's premise
 *    for (b) is that the figure, the change and the direction are one statement. "Our support team costs £45,000 a
 *    month. Cut our monthly cloud bill by 15%" states the figure for another quantity (S4G-8b) and is never taken;
 *  · its own phrase names no other quantity (`phraseNamesOnlyTheGoal`, PTL 5895711185): "Our support team costs £45,000 a
 *    month and we want to cut our cloud bill by 15%" states the figure for the support team, never the cloud bill;
 *  · no factor already holds it: the drafter gave it to another quantity, and that join is not Olumi's to undo.
 * Named under-claim (the fail-safe): a phrase naming the goal by a word its name lacks ("Our AWS bill is £45k" for
 * "cloud costs") is refused, and no chance is shown, as before.
 * `refused` lists what the brief gives in any currency that was NOT taken (for the honest no-base words: "Your brief
 * gives £45k, but it isn't held as today's level of ‘costs’"); null when the brief gives no money figure at all.
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import type { CandidateModel } from './admit-model.js';
import { periodIn, readMoneyTotal } from './reconciling-product.js';

export type BriefGoalLevel =
  | {
      readonly kind: 'adopt';
      /** The figure in the GOAL'S OWN unit (its scale applied: "£45k" is 45 on a "£k/month" goal). */
      readonly value: number;
      /** The amount exactly as the brief writes it ("£45k"). */
      readonly written: string;
      /** The brief's own clause that states it ("Monthly spend is £45k"), at most QUOTE_MAX characters. */
      readonly quote: string;
    }
  | { readonly kind: 'refused'; readonly written: readonly string[] };

export const QUOTE_MAX = 160;

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The clause (`;` breaks it) or the sentence (`;` does not) of `text` around [start, end). */
function spanAround(text: string, start: number, end: number, breaks: RegExp): string {
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(breaks)) {
    const at = m.index ?? 0;
    // A decimal point inside a figure ("£4.5k") is not a break.
    if (m[0] === '.' && /\d/.test(text[at - 1] ?? '') && /\d/.test(text[at + 1] ?? '')) continue;
    if (at < start) from = at + m[0].length;
    else if (at >= end) { to = at; break; }
  }
  return text.slice(from, to).trim();
}

const clauseAround = (text: string, start: number, end: number): string => spanAround(text, start, end, /[.;!?\n]/g);
/** The figure's own phrase: its clause, cut again at a comma or a joining word ("…£45,000 a month and we want…"). */
const phraseAround = (text: string, start: number, end: number): string =>
  spanAround(text, start, end, /[.;!?\n,]|\b(?:and|but|while|whereas)\b/gi);

/**
 * Words that name no quantity: how a level or its change is stated ("Our monthly spend is about £45k a month", "we want
 * to cut our £45k monthly bill by 20%"). Anything else in the figure's phrase must be a word of the goal's own name.
 */
const PLAIN_WORDS: ReadonlySet<string> = new Set([
  'our', 'the', 'we', 'us', 'it', 'its', 'this', 'that', 'my', 'your', 'their', 'a', 'an', 'is', 'are', 'was', 'were',
  'currently', 'current', 'today', 'now', 'at', 'of', 'on', 'for', 'in', 'per', 'about', 'around', 'roughly',
  'approximately', 'total', 'totals', 'run', 'runs', 'come', 'comes', 'to', 'pay', 'spend', 'spending', 'spent', 'cost',
  'costs', 'bill', 'bills', 'month', 'months', 'monthly', 'year', 'years', 'yearly', 'annual', 'annually', 'annum',
  'want', 'need', 'aim', 'plan', 'cut', 'reduce', 'lower', 'bring', 'down', 'trim', 'decrease', 'by', 'from',
]);
const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/**
 * ⛔ THE FIGURE IS STATED FOR THE GOAL'S OWN QUANTITY, OR FOR NONE NAMED (PTL #72 5895711185: "Our support team costs
 * £45,000 a month and we want to cut our cloud bill by 15%" was ADOPTED as the cloud bill's level). The figure's own
 * phrase may name nothing but the goal: a word that is neither plain (`PLAIN_WORDS`) nor a word of the goal's name
 * ("support", "team") states the figure for another quantity, and it is never Olumi's to join.
 */
function phraseNamesOnlyTheGoal(brief: string, a: { index: number; matchedText: string }, goalName: string): boolean {
  const phrase = phraseAround(brief, a.index, a.index + a.matchedText.length).replace(a.matchedText, ' ');
  const own = new Set(goalName.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '').map(singular));
  return phrase.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '')
    .every((w) => PLAIN_WORDS.has(w) || own.has(singular(w)));
}
const sentenceAround = (text: string, start: number, end: number): string => spanAround(text, start, end, /[.!?\n]/g);

export function briefGoalLevel(candidate: CandidateModel, brief: string | null | undefined): BriefGoalLevel | null {
  const goal = candidate.goal;
  if (typeof brief !== 'string' || (goal.frame !== 'change_rel' && goal.frame !== 'change_abs')) return null;
  const unit = readCurrencyUnitWithQualifiers(typeof goal.unit === 'string' ? goal.unit : '');
  const scale = unit.kind === 'currency' ? unit.multiplier ?? 1 : 1;
  const isTheChange = (a: { magnitude: number }): boolean =>
    goal.frame === 'change_abs' && typeof goal.value === 'number' && same(a.magnitude, Math.abs(goal.value) * scale);
  const money = findStatedAmounts(brief).filter((a) => a.kind === 'currency' && !isTheChange(a));
  const distinct = money.filter((a, i) => money.findIndex((b) => same(b.magnitude, a.magnitude) && b.currencyCode === a.currencyCode) === i);
  if (distinct.length === 0) return null;
  const refused: BriefGoalLevel = { kind: 'refused', written: distinct.map((a) => a.matchedText) };
  if (unit.kind !== 'currency' || unit.currencyCode === undefined) return refused;
  const goalMoney = readMoneyTotal(goal.unit, goal.metric);
  if (goalMoney === null || goalMoney.code !== unit.currencyCode) return refused;
  const inCurrency = distinct.filter((a) => a.currencyCode === unit.currencyCode);
  if (inCurrency.length !== 1) return refused;
  const a = inCurrency[0]!;
  const clause = clauseAround(brief, a.index, a.index + a.matchedText.length);
  if (periodIn(clause) !== goalMoney.period) return refused;
  // The goal's own change figure, as the brief writes it: "20%" for `change_rel` −20, "£9k" for `change_abs` −9000.
  const change = findStatedAmounts(brief).find((c) => typeof goal.value === 'number' && (goal.frame === 'change_rel'
    ? c.kind === 'percent' && same(c.magnitude, Math.abs(goal.value))
    : c.kind === 'currency' && c.currencyCode === unit.currencyCode && same(c.magnitude, Math.abs(goal.value) * scale)));
  const sentence = sentenceAround(brief, a.index, a.index + a.matchedText.length);
  if (change === undefined || sentence !== sentenceAround(brief, change.index, change.index + change.matchedText.length)) return refused;
  if (!phraseNamesOnlyTheGoal(brief, a, typeof goal.metric === 'string' ? goal.metric : '')) return refused;
  const carried = candidate.factors.some((f) => {
    if (typeof f.baseline_value !== 'number' || !Number.isFinite(f.baseline_value)) return false;
    const fu = readCurrencyUnitWithQualifiers(typeof f.unit === 'string' ? f.unit : '');
    return fu.kind === 'currency' && fu.currencyCode === unit.currencyCode && same(f.baseline_value * (fu.multiplier ?? 1), a.magnitude);
  });
  if (carried) return refused;
  return {
    kind: 'adopt',
    value: a.magnitude / scale,
    written: a.matchedText,
    quote: clause.length <= QUOTE_MAX ? clause : `${clause.slice(0, QUOTE_MAX - 1)}…`,
  };
}
