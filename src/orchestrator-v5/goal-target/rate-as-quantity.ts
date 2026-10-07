/**
 * ⭐ S-E GOALS P17: A POPULATION RATE WRITTEN AS A PROBABILITY IS A QUANTITY (Science ruling (b),
 * `inflight/science-393023-goals-rulings-20261007.md`, 7 Oct).
 *
 * "churn probability" and "conversion probability per visitor" are a level the options move and a goal can be set on
 * ("keep churn below 3% a month"). "chance we win the Acme contract" is ONE event's chance, which Olumi computes.
 * The ruling's test, applied in order (the first rule that fires decides; nothing else is read):
 *  1. a per-unit or per-period marker → quantity ("per month", "monthly", "a month", "per customer", "% of users", "rate");
 *  2. a population noun (churn, conversion, retention, default, click-through, open, response, return, attrition) → quantity;
 *  3. a one-off event or decision (win, launch, deal, approval, hire, contract, deadline, "on time", "by <date>",
 *     "succeed", "happen") → chance;
 *  4. otherwise → chance (fail-closed, #2742's behaviour).
 * Words are scanned linearly, with no regular expressions. Text over 400 characters is not read (rule 4).
 */
import { periodAdverb, periodNoun } from '../../utils/unit-alphabet.js';

export type RateReading = { readonly kind: 'quantity' | 'chance'; readonly rule: 1 | 2 | 3 | 4 };

/** The members of a repeated population that "per <x>" / "% of <x>" names (ruling (b): customer, user, visitor, lead, order). */
const MEMBERS = new Set(['customer', 'customers', 'user', 'users', 'visitor', 'visitors', 'lead', 'leads', 'order', 'orders']);
/** Rule 2's population nouns, with the inflections that name the same act ("a customer churns", "a trial user converts"). */
const POPULATION = new Set([
  'churn', 'churns', 'churned', 'churning', 'conversion', 'conversions', 'convert', 'converts', 'converted', 'converting',
  'retention', 'retained', 'default', 'defaults', 'defaulted', 'defaulting', 'clickthrough', 'open', 'opens',
  'response', 'responses', 'return', 'returns', 'attrition',
]);
/** Rule 3's one-off events and decisions. */
const EVENT = new Set([
  'win', 'wins', 'winning', 'won', 'launch', 'launches', 'launching', 'launched', 'deal', 'approval', 'approved', 'hire',
  'hiring', 'contract', 'deadline', 'succeed', 'succeeds', 'success', 'happen', 'happens',
]);
/** Words that make "a <period>" a time window ("within a month"), never a per-period rate ("3% a month"). */
const WINDOW = new Set(['within', 'in', 'by', 'before', 'after', 'for']);

function wordsOf(text: string): string[] {
  const words: string[] = []; let word = '';
  for (const c of text.toLowerCase()) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) word += c;
    else if (c === '%') { if (word !== '') words.push(word); words.push('%'); word = ''; }
    else if (word !== '') { words.push(word); word = ''; }
  }
  if (word !== '') words.push(word);
  // "click-through" / "click through" are one noun.
  return words.flatMap((w, i) => (w === 'click' && words[i + 1] === 'through' ? ['clickthrough'] : w === 'through' && words[i - 1] === 'click' ? [] : [w]));
}

const isPeriod = (w: string | undefined): boolean => w !== undefined && periodNoun(w) !== null;

/** Rule 1: a per-unit or per-period marker. */
function perMarker(ws: readonly string[]): boolean {
  return ws.some((w, i) => w === 'rate' || w === 'rates'
    || periodAdverb(w) !== null
    || (w === 'per' && (isPeriod(ws[i + 1]) || MEMBERS.has(ws[i + 1] ?? '')))
    || (w === 'a' && isPeriod(ws[i + 1]) && !WINDOW.has(ws[i - 1] ?? ''))
    || (w === '%' && ws[i + 1] === 'of' && MEMBERS.has(ws[i + 2] ?? '')));
}

/** Rule 3: a one-off event, "on time", or "by <date or period>". */
function oneOffEvent(ws: readonly string[]): boolean {
  return ws.some((w, i) => EVENT.has(w) || (w === 'on' && ws[i + 1] === 'time') || (w === 'ontime')
    || (w === 'by' && ws[i + 1] !== undefined));
}

/** Science ruling (b)'s four rules, in order, over the words a goal is written in (its unit, then its label). */
export function readRateAsQuantity(text: string): RateReading {
  if (text.length > 400) return { kind: 'chance', rule: 4 };
  const ws = wordsOf(text);
  if (perMarker(ws)) return { kind: 'quantity', rule: 1 };
  if (ws.some((w) => POPULATION.has(w))) return { kind: 'quantity', rule: 2 };
  if (oneOffEvent(ws)) return { kind: 'chance', rule: 3 };
  return { kind: 'chance', rule: 4 };
}
