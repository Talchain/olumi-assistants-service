/**
 * ⭐ S-E GOALS P17: A POPULATION RATE WRITTEN AS A PROBABILITY IS A QUANTITY (Science ruling (b),
 * `inflight/science-393023-goals-rulings-20261007.md`, 7 Oct).
 *
 * "churn probability" and "conversion probability per visitor" are a level the options move and a goal can be set on
 * ("keep churn below 3% a month"). "chance we win the Acme contract" is ONE event's chance, which Olumi computes.
 * The ruling's test, applied in order (the first rule that fires decides; nothing else is read):
 *  1. an explicit per-period marker → quantity; other denominators and "rate" require no event in this segment.
 *     "per month" wins even over an event; "a month" after an event is a duration unless a quantity directly precedes it.
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
const FINITE_AUXILIARY = new Set(['is', 'are', 'was', 'were', 'am', 'has', 'have', 'had', 'do', 'does', 'did',
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would']);
const FINITE_PREDICATE = new Set(['win', 'won', 'meet', 'met', 'hit', 'slip', 'fail', 'succeed', 'happen', 'work',
  'go', 'went', 'come', 'came', 'take', 'took', 'make', 'made', 'get', 'got', 'lose', 'lost', 'fall', 'fell',
  'rise', 'rose', 'churn', 'convert', 'default', 'return', 'respond', 'deliver', 'finish', 'reach', 'miss']);
const PERSONAL_SUBJECT = new Set(['we', 'i', 'you', 'they', 'it', 'he', 'she']);
const CLAUSE_START = new Set(['that', 'if', 'whether', 'when']);

/**
 * A subject + finite verb AFTER the chance measure makes a non-period denominator ambiguous (DL-approved r2).
 * Nominal "of winning" / "of a failed payment" is not a finite clause; a complementiser opens one.
 * Plural "chances" counts opportunities ("chances the team creates per match"), not an event's probability.
 * One linear scan, within the same bounded segment as all other rules.
 */
function eventClause(ws: readonly string[]): boolean {
  const chance = ws.findIndex((w) => CHANCE.has(w) && w !== 'chances');
  if (chance < 0) return false;
  let nominal = false; let subject = false; let personal = false;
  for (let i = chance + 1; i < ws.length; i++) {
    const w = ws[i]!;
    if (w === '|') break;
    if (CLAUSE_START.has(w)) { nominal = false; subject = false; personal = false; continue; }
    if (w === 'of' || w === 'to') { nominal = true; subject = false; personal = false; continue; }
    if (nominal) continue;
    // A denominator's noun phrase is nominal too ("per loan applications"), until an explicit clause opens.
    if (w === 'per' || w === 'for' || w === 'each' || w === 'every') {
      nominal = true; subject = false; personal = false; continue;
    }
    if (DETERMINER.has(w)) { subject = false; personal = false; continue; }
    if (PERSONAL_SUBJECT.has(w)) { subject = true; personal = true; continue; }
    if (w === 'not' || w.endsWith('ly') || w === '%') continue;
    // A finite auxiliary, inflected predicate, or a pronoun's base-form predicate ("we meet") follows its subject.
    // A past participle before the subject ("a failed payment") never reaches this arm.
    if (subject && (FINITE_AUXILIARY.has(w) || FINITE_PREDICATE.has(w) || w.endsWith('s') || w.endsWith('ed') || personal)) return true;
    subject = true;
  }
  return false;
}

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
  let clause = false; let memberAt = -1; let firstWord = -1; let definite = false;
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
      // A definite/possessive singular member names one entity ("our biggest customer"), not a population.
      if (DETERMINER.has(w)) definite = w !== 'a' && w !== 'an';
      if (MEMBER_WORDS.has(w)) { if (definite && !w.endsWith('s')) clause = true; else memberAt = i; }
      else if (!DETERMINER.has(w)) {
        if (CLAUSE_SUBJECT.has(w) || EVENT.has(w) || w === '|' || w === 'by' || w === 'on'
          || (chance >= 0 && (w === 'to' || w === 'and' || memberAt >= 0
            || w.endsWith('ing') || w.endsWith('ed') || w.endsWith('es')))) clause = true;
      }
    } else if (CLAUSE_SUBJECT.has(w) || EVENT.has(w) || w === '|') clause = true;
  }
  return false;
}

/** Rule 1: explicit periods win; other denominators and rate heads require no finite or nominal event. */
function perMarker(ws: readonly string[], population: boolean, clause: boolean): boolean {
  const nounAfter = (i: number): boolean => {
    const w = ws[i];
    return w !== undefined && w !== '|' && w[0]! >= 'a' && w[0]! <= 'z' && !DETERMINER.has(w) && !CLAUSE_SUBJECT.has(w);
  };
  const event = clause || oneOffEvent(ws);
  const denominator = (i: number): boolean => nounAfter(i) && (isPeriod(ws[i]) || !event);
  const quantityBefore = (w: string | undefined): boolean => w !== undefined
    && (w === '%' || (w[0]! >= '0' && w[0]! <= '9') || CHANCE.has(w) || populationWord(w));
  return ws.some((w, i) => ((w === 'rate' || w === 'rates') && !event)
    || (isPeriodWord(w) && (population || CHANCE.has(ws[i + 1] ?? '') || (CHANCE.has(ws[i - 1] ?? '') && i + 1 === ws.length)))
    || (w === 'per' && denominator(i + 1))
    || (w === 'for' && ws[i + 1] === 'each' && denominator(i + 2))
    || ((w === 'each' || w === 'every') && denominator(i + 1) && !WINDOW.has(ws[i - 1] ?? '') && !DATE_AFTER.has(ws[i + 2] ?? ''))
    || ((w === 'a' || w === 'an') && isPeriod(ws[i + 1]) && (!event || quantityBefore(ws[i - 1])) && !WINDOW.has(ws[i - 1] ?? '') && !DATE_AFTER.has(ws[i + 2] ?? ''))
    || (w === '%' && ws[i + 1] === 'of' && MEMBERS.has(ws[i + 2] ?? '')));
}

/** Rule 3: a one-off event, "on time", or "by <date or period>". */
function oneOffEvent(ws: readonly string[]): boolean {
  // "Win rate" names a metric, not a one-off event; a following event ("Success rate of the Q3 launch") still counts.
  // Finite clauses are read independently, so a rate head cannot mask an event clause.
  return ws.some((w, i) => (EVENT.has(w) && ws[i + 1] !== 'rate' && ws[i + 1] !== 'rates')
    || (w === 'on' && ws[i + 1] === 'time') || (w === 'ontime')
    || (w === 'by' && ws[i + 1] !== undefined)
    || (CHANCE.has(w) && w !== 'chances' && (CLAUSE_SUBJECT.has(ws[i + 1] ?? '') || DETERMINER.has(ws[i + 1] ?? '')
      || (ws[i + 1] === 'of' && ws[i + 2]?.endsWith('ing')))));
}

/** Science ruling (b)'s four rules, in order, over ONE unit or label segment. */
export function readRateAsQuantity(text: string): RateReading {
  if (text.length > 400) return { kind: 'chance', rule: 4 };
  const ws = wordsOf(text);
  const population = populationSubject(ws);
  const clause = eventClause(ws);
  if (perMarker(ws, population, clause)) return { kind: 'quantity', rule: 1 };
  if (population) return { kind: 'quantity', rule: 2 };
  if (clause || oneOffEvent(ws)) return { kind: 'chance', rule: 3 };
  return { kind: 'chance', rule: 4 };
}
