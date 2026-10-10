import { readCurrencyUnitWithQualifiers, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { PERIOD_ADVERB_SPELLINGS, PERIOD_NOUN_SPELLINGS, periodAdverb, periodNoun, type UnitPeriod } from '../../utils/unit-alphabet.js';
import { findLinkEffectAmounts } from './link-effect-figures.js';
import { sameUnit, singular } from './same-unit.js';

export interface LabelHeadReading {
  readonly unit: string;
  readonly source_quote: string;
  readonly amount: { readonly start: number; readonly end: number };
  readonly implicit?: true;
}

/** A postnominal action describes what happened to the counted noun, never its unit. */
const ACTION = /^(?:cancelled|rescheduled|closed|avoided|lost|completed|cancelled-or-rescheduled)$/iu;
const PREPOSITION = /\s+(?:from|of|in|for|to|on|per|with|after|by)\s+/iu;
const tokens = (s: string): string[] => s.toLowerCase().match(/[\p{L}]+(?:-[\p{L}]+)*/gu) ?? [];
const nounKey = (w: string): string => w.endsWith('ss') ? w : /(?:s|x|z|ch|sh)es$/u.test(w) ? w.slice(0, -2)
  : /[^aeiou]ies$/u.test(w) ? `${w.slice(0, -3)}y` : singular(w);
const sameNoun = (a: string, b: string): boolean => nounKey(a) === nounKey(b);
const pluralNoun = (w: string): string => nounKey(w) !== w ? w : /(?:ss|x|z|ch|sh)$/u.test(w) ? `${w}es`
  : /[^aeiou]y$/u.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`;
const MOVEMENT = /^(?:cut|cuts|reduce|reduces|lower|lowers|raise|raises|increase|increases|decrease|decreases|rise|rises|fall|falls|drop|drops|by|about|around|roughly|approximately|nearly|almost)$/iu;
const BOUNDARY = /^(?:a|an|per|of|in|each|every|would|will|could|should|might|may|can|must|adds?|costs?|prevents?|avoids?|reduces?|increases?|cuts?|falls?|rises?|and|but|so|to|for|we|you|they)$/iu;
export { BOUNDARY as LABEL_HEAD_BOUNDARY };
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const periodWords = Object.values(PERIOD_NOUN_SPELLINGS).flat().sort((a, b) => b.length - a.length).map(escape).join('|');
const periodAdverbs = Object.values(PERIOD_ADVERB_SPELLINGS).flat().sort((a, b) => b.length - a.length).map(escape).join('|');
const periodPhrase = `(?:\\s+(?:a|an|per)\\s+|\\s*\\/\\s*)(?:${periodWords})\\b`;
const rateTail = new RegExp(`^(?:(?:${periodPhrase})|\\s+(?:${periodAdverbs})\\b)*`, 'iu');
const forwardLead = new RegExp(`^(?:\\s+(?:more|extra|additional|new))?\\s+(?:(?:a|an|per)\\s+(?:${periodWords})\\s+)?(?:of\\s+)?(?:(?:the|our|your|its|their)\\s+)?`, 'iu');
const bareOrPeriod = new RegExp(`^\\s*(?:$|[.,;:!?]|(?:a|an|per)\\s+(?:${periodWords})\\b)`, 'iu');
const periodsIn = (s: string): UnitPeriod[] => {
  const ps = tokens(s).flatMap(w => { const p = periodAdverb(w); return p === null ? [] : [p]; });
  for (const m of s.matchAll(/(?:\b(?:a|an|per)\s+|\/\s*)([\p{L}]+)\b/giu)) {
    const p = periodNoun(m[1]!); if (p !== null) ps.push(p);
  }
  return ps;
};

export function labelHead(label: string): string | undefined {
  const ws = tokens((label.split(PREPOSITION)[0] ?? label).split('/')[0]!);
  const action = ws.findIndex(w => ACTION.test(w));
  // "Appointments cancelled or rescheduled in advance" counts appointments.
  return (action > 0 ? ws.slice(0, action) : ws).at(-1);
}

/** No vocabulary of count nouns: only THIS label's head, beside THIS figure. */
export function labelHeadUnitAt(quote: string, a: StatedAmount, label: string, otherLabel: string): LabelHeadReading | undefined {
  if (a.kind === 'percent') return undefined; // U3: never 40 cancellations from 40%.
  // A qualified monetary part ("MRR lost to support strain") is not the whole named beside £300 ("of MRR").
  // Dropping its action AND qualifier would manufacture the part's unit without its definitional reading.
  // Keep count actions ("each appointment cancelled in advance") and unqualified money heads ("losses avoided").
  const qualifier = PREPOSITION.exec(label);
  if (a.kind === 'currency' && qualifier !== null
    && tokens(label.slice(0, qualifier.index)).findIndex(w => ACTION.test(w)) > 0
    && periodNoun(tokens(label.slice(qualifier.index + qualifier[0].length))[0] ?? '') === null) return undefined;
  const head = labelHead(label);
  if (head === undefined || sameNoun(head, labelHead(otherLabel) ?? '')) return undefined;
  const end = a.index + a.matchedText.length;
  const after = quote.slice(end);
  let start = a.index;
  let finish = end;
  let named: string | undefined;
  // Forward: 150 days a year; £40k a year of losses. Periods belong to this local phrase.
  const lead = forwardLead.exec(after);
  const noun = lead === null ? null : /^([\p{L}]+(?:-[\p{L}]+)*)(.*)$/su.exec(after.slice(lead[0].length));
  const complete = (tail: string): boolean => {
    if (/^[.,;:!?\n]|^\s*$/u.test(tail)) return true;
    const next = /^\s+([\p{L}]+)\b/u.exec(tail);
    return next !== null && (BOUNDARY.test(next[1]!) || periodAdverb(next[1]!.toLowerCase()) !== null);
  };
  if (noun !== null && sameNoun(noun[1]!.toLowerCase(), head) && complete(noun[2]!)) {
    named = noun[1]!.toLowerCase();
    finish = end + lead![0].length + noun[1]!.length;
  } else if (a.kind === 'plain') {
    // Backward: cut monthly cancellations by about 40. No unrelated noun can bridge the head and figure.
    const before = quote.slice(0, a.index);
    const ws = [...before.matchAll(/[\p{L}]+(?:-[\p{L}]+)*/gu)];
    let i = ws.length - 1;
    while (i >= 0 && MOVEMENT.test(ws[i]![0])) i -= 1;
    const h = ws[i];
    if (h === undefined || !sameNoun(h[0].toLowerCase(), head)
      || !/^\s*(?:[\p{L}]+\s*)*$/u.test(before.slice(h.index! + h[0].length))) return undefined;
    // A unit written after the figure takes precedence over a preceding label: never "response time by 2 hours".
    if (!bareOrPeriod.test(after)) return undefined;
    named = h[0].toLowerCase(); start = h.index!;
    // Preserve a frequency stated before the head in the receipt, too.
    const prior = ws[i - 1];
    if (prior !== undefined && periodAdverb(prior[0].toLowerCase()) !== null) start = prior.index!;
  }
  if (named === undefined) return undefined;
  const rate = rateTail.exec(quote.slice(finish))![0];
  finish += rate.length;
  if (/^\s*(?:per\s+|\/\s*|of\s+)/u.test(quote.slice(finish))) return undefined;
  // The label's stated frequency and the adjacent frequency must agree. No period is borrowed from the other end.
  const local = quote.slice(start, finish);
  const ps = [...periodsIn(label), ...periodsIn(local)];
  if (new Set(ps).size > 1) return undefined;
  const period = ps[0];
  // Literal currency only: the scanner may inherit a range endpoint's currency, which is no adoption warrant.
  const currencyPrefix = a.kind === 'currency' ? a.matchedText.trim().split(/\d/u, 1)[0]!.trim() : undefined;
  if (a.kind === 'currency' && (readCurrencyUnitWithQualifiers(currencyPrefix).kind !== 'currency'
    || a.currencyCode === undefined)) return undefined;
  // Agree with the existing literal-unit reader: a symbol warrants the scanner's canonical code, not a new spelling.
  const currency = a.kind === 'currency' ? a.currencyCode : undefined;
  const unit = `${currency ?? pluralNoun(head)}${period === undefined ? '' : `/${period}`}`;
  if (unit.length > 40 || local.trim().length > 500) return undefined;
  return { unit, source_quote: local.trim(), amount: { start: a.index, end } };
}

export function labelHeadUnit(quote: string, value: number, label: string, otherLabel: string, source = false): LabelHeadReading | undefined {
  const amounts = findLinkEffectAmounts(quote).filter(a => a.magnitude === Math.abs(value));
  const hits = amounts.flatMap(a => { const r = labelHeadUnitAt(quote, a, label, otherLabel); return r === undefined ? [] : [r]; });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1 || !source || value !== 1) return undefined;
  // An explicit TARGET 1 does not erase the source's "each appointment". The located noun distinguishes them.
  // A counting determiner supplies one source; the head must precede its predicate, never a later target noun.
  const head = labelHead(label);
  if (head === undefined) return undefined;
  const implicit = [...quote.matchAll(/\b(?:each|every|per)\s+((?:[\p{L}-]+\s+){0,4})[\p{L}-]+/giu)].flatMap(m => {
    const phrase = m[0].split(/\b(?:should|would|will|could|prevents?|avoids?|adds?|cuts?|reduces?)\b/iu)[0]!;
    const ws = tokens(phrase).slice(1);
    const at = ws.findIndex(w => sameNoun(w, head));
    const own = tokens(label);
    if (at < 0 || !ws.slice(0, at).every(w => own.some(o => sameNoun(o, w)))
      || sameNoun(head, labelHead(otherLabel) ?? '')) return [];
    if (!ws.slice(at + 1).every(w => own.some(o => sameNoun(o, w))
      || /^(?:we|you|they)$/u.test(w) || (w === 'close' && own.includes('closed')))) return [];
    const ps = [...periodsIn(label), ...periodsIn(phrase)];
    if (new Set(ps).size > 1) return [];
    return [{ unit: `${pluralNoun(head)}${ps[0] === undefined ? '' : `/${ps[0]}`}`, source_quote: phrase.trim(),
      amount: { start: m.index!, end: m.index! + m[0].split(/\s/u)[0]!.length }, implicit: true as const }];
  });
  return implicit.length === 1 ? implicit[0] : undefined;
}

/** U1, shared by the construction binder and the chat adoption door. */
export function canAdoptLabelUnit(node: { readonly unit?: unknown; readonly observed_state?: unknown;
  readonly data?: unknown; readonly unit_reading?: unknown; readonly goal_threshold_unit?: unknown;
  readonly goal_threshold_raw?: unknown }, otherUnits: readonly string[], unit: string): boolean {
  const os = node.observed_state as Record<string, unknown> | undefined;
  const data = node.data as Record<string, unknown> | undefined;
  const reading = node.unit_reading as Record<string, unknown> | undefined;
  if ([node.unit, os?.unit, data?.unit, reading?.unit, node.goal_threshold_unit]
    .some(u => typeof u === 'string' && u.trim() !== '')) return false;
  if (node.goal_threshold_raw !== undefined && node.goal_threshold_raw !== null) return false;
  if (os !== undefined && os !== null && ['value', 'raw_value', 'baseline'].some(k => os[k] !== undefined && os[k] !== null)) return false;
  return otherUnits.every(u => u.trim() === '' || sameUnit(u, unit));
}
