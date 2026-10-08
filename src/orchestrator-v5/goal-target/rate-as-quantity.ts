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
  'retention', 'retained', 'clickthrough', 'clickthroughs', 'attrition',
]);
/** The remaining ruling nouns can also be everyday words; all population words need the same subject check. */
const POPULATION_IF_SUBJECT = new Set([
  'default', 'defaults', 'defaulted', 'defaulting', 'open', 'opens', 'opened', 'response', 'responses', 'respond',
  'responds', 'responded', 'return', 'returns', 'returned', 'returning',
]);
const CHANCE = new Set(['probability', 'probabilities', 'chance', 'chances', 'likelihood', 'likelihoods', 'odds']);
const MEMBER_WORDS = new Set([...MEMBERS, 'subscriber', 'subscribers', 'borrower', 'borrowers', 'recipient', 'recipients', 'buyer', 'buyers']);
/** Rule 3's one-off events and decisions. */
const EVENT = new Set([
  'win', 'wins', 'winning', 'won', 'launch', 'launches', 'launching', 'launched', 'deal', 'approval', 'approved', 'hire',
  'hiring', 'contract', 'deadline', 'succeed', 'succeeds', 'success', 'happen', 'happens',
]);
/** Words that make "a <period>" a time window ("within a month"), never a per-period rate ("3% a month"). */
const WINDOW = new Set(['within', 'in', 'by', 'before', 'after', 'for']);
/** …and "a month FROM NOW" / "a year AWAY" is a date. */
const DATE_AFTER = new Set(['from', 'away', 'later', 'ago', 'out', 'time', 'after', 'before', 'into', 'since']);
const CLAUSE_SUBJECT = new Set(['we', 'i', 'you', 'they', 'it', 'that']);
const DETERMINER = new Set(['a', 'an', 'the', 'our', 'my', 'their', 'your']);
const LEVEL_QUALIFIER = new Set(['below', 'above', 'under', 'over', 'at', 'less', 'more']);

function wordsOf(text: string): string[] {
  const words: string[] = []; let word = '';
  for (const c of text.toLowerCase()) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) word += c;
    // "%" is a word; "|" cannot be part of a noun phrase.
    else if (c === '%' || c === '|') { if (word !== '') words.push(word); words.push(c); word = ''; }
    else if (word !== '') { words.push(word); word = ''; }
  }
  if (word !== '') words.push(word);
  // "click-through" / "click through" are one noun.
  const click = (w: string | undefined): boolean => w === 'click' || w === 'clicks';
  const through = (w: string | undefined): boolean => w === 'through' || w === 'throughs';
  return words.flatMap((w, i) => (click(w) && through(words[i + 1]) ? ['clickthrough'] : through(w) && click(words[i - 1]) ? [] : [w]));
}

const isPeriod = (w: string | undefined): boolean => w !== undefined && periodNoun(w) !== null;
// The unit alphabet also reads metric aliases (MRR/ARR/pcm/pa). Only actual period words govern a probability.
const isPeriodWord = (w: string | undefined): boolean => w !== undefined && periodAdverb(w) !== null
  && (w.endsWith('ly') || w === 'annual');
const populationWord = (w: string): boolean => POPULATION.has(w) || POPULATION_IF_SUBJECT.has(w);

/** A population word must head the measured subject, never modify "target", "tender", "deposit", etc. */
function populationSubject(ws: readonly string[]): boolean {
  const chance = ws.findIndex((w) => CHANCE.has(w));
  const start = chance < 0 ? 0 : chance + (ws[chance + 1] === 'of' ? 2 : 1);
  let clause = false; let memberAt = -1; let firstWord = -1;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    // A noun immediately before the chance measure heads it ("churn probability").
    if (i + 1 === chance && populationWord(w) && !clause) return true;
    if (i >= start) {
      if (firstWord < 0 && !DETERMINER.has(w)) firstWord = i;
      const next = ws[i + 1];
      const tail = next === undefined || next === '%' || LEVEL_QUALIFIER.has(next)
        || (next[0]! >= '0' && next[0]! <= '9') || (isPeriodWord(next) && i + 2 === ws.length);
      // Read a nominal head ("of churn", "of net churn") or a member's own act ("a trial user converts").
      // A member followed by another lexical word is an event clause, not a licence for a later population word.
      const nominalLabel = chance < 0 && POPULATION.has(w) && !w.endsWith('s') && !w.endsWith('ed') && !w.endsWith('ing');
      const subject = nominalLabel || (chance >= 0 && ws[chance + 1] === 'of') || firstWord === i || memberAt === i - 1;
      if (populationWord(w) && tail && subject && !clause) return true;
      if (MEMBER_WORDS.has(w)) memberAt = i;
      else if (!DETERMINER.has(w)) {
        if (CLAUSE_SUBJECT.has(w) || EVENT.has(w) || w === '|' || w === 'by' || w === 'on'
          || (chance >= 0 && (w === 'to' || w === 'and' || memberAt >= 0
            || w.endsWith('ing') || w.endsWith('ed') || w.endsWith('es')))) clause = true;
      }
    } else if (CLAUSE_SUBJECT.has(w) || EVENT.has(w) || w === '|') clause = true;
  }
  return false;
}

/** Rule 1: a per-unit or per-period marker. */
function perMarker(ws: readonly string[], population: boolean): boolean {
  const nounAfter = (i: number): boolean => {
    const w = ws[i];
    return w !== undefined && w !== '|' && w[0]! >= 'a' && w[0]! <= 'z' && !DETERMINER.has(w) && !CLAUSE_SUBJECT.has(w);
  };
  return ws.some((w, i) => w === 'rate' || w === 'rates'
    || (isPeriodWord(w) && (population || CHANCE.has(ws[i + 1] ?? '') || (CHANCE.has(ws[i - 1] ?? '') && i + 1 === ws.length)))
    || (w === 'per' && nounAfter(i + 1))
    || (w === 'for' && ws[i + 1] === 'each' && nounAfter(i + 2))
    || ((w === 'each' || w === 'every') && nounAfter(i + 1) && !WINDOW.has(ws[i - 1] ?? '') && !DATE_AFTER.has(ws[i + 2] ?? ''))
    || ((w === 'a' || w === 'an') && isPeriod(ws[i + 1]) && !WINDOW.has(ws[i - 1] ?? '') && !DATE_AFTER.has(ws[i + 2] ?? ''))
    || (w === '%' && ws[i + 1] === 'of' && MEMBERS.has(ws[i + 2] ?? '')));
}

/** Rule 3: a one-off event, "on time", or "by <date or period>". */
function oneOffEvent(ws: readonly string[]): boolean {
  return ws.some((w, i) => EVENT.has(w) || (w === 'on' && ws[i + 1] === 'time') || (w === 'ontime')
    || (w === 'by' && ws[i + 1] !== undefined)
    || (CHANCE.has(w) && (CLAUSE_SUBJECT.has(ws[i + 1] ?? '') || DETERMINER.has(ws[i + 1] ?? '')
      || (ws[i + 1] === 'of' && ws[i + 2]?.endsWith('ing')))));
}

/** Science ruling (b)'s four rules, in order, over ONE unit or label segment. */
export function readRateAsQuantity(text: string): RateReading {
  if (text.length > 400) return { kind: 'chance', rule: 4 };
  const ws = wordsOf(text);
  const population = populationSubject(ws);
  if (perMarker(ws, population)) return { kind: 'quantity', rule: 1 };
  if (population) return { kind: 'quantity', rule: 2 };
  if (oneOffEvent(ws)) return { kind: 'chance', rule: 3 };
  return { kind: 'chance', rule: 4 };
}
