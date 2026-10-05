import type { DraftQuoteSpan, DraftStatedRelationship, DraftStatedOptionEffect } from "../draft/records/grammar.js";
import { findStatedAmounts, readUnit, type StatedAmount } from "./stated-amounts.js";
import { boundLiteral } from "../draft/records/quantity-evidence.js";
import { sameUnit, readCountRate, readMoney, periodIn } from "../../orchestrator-v5/agent-lane/same-unit.js";

export interface StatedEffectDetail {
  readonly amount: number;
  readonly amount_unit: string;
  readonly per_source_change: number;
  readonly per_source_change_unit: string;
}

interface LocatedAmount extends StatedAmount {
  readonly units: readonly string[];
  readonly implicitSource?: true;
}

const PERIOD_WORDS: Readonly<Record<string, string>> = {
  month: "month",
  months: "month",
  mo: "month",
  monthly: "month",
  year: "year",
  years: "year",
  yr: "year",
  yearly: "year",
};

function currencyToken(matchedText: string): string | undefined {
  const token = matchedText.match(/(?:A\$|C\$|NZ\$|[£$€¥₹]|CHF|kr)/iu)?.[0];
  return token;
}

function nounUnitsAt(tail: string): readonly string[] {
  const words = tail.match(/^\s+((?:[A-Za-z][A-Za-z-]*\s*){1,3})/u)?.[1]
    .trim()
    .split(/\s+/u)
    .map((word) => word.toLowerCase()) ?? [];
  return words.flatMap((_, start) => words.slice(start).map((__, end) => words.slice(start, start + end + 1).join(" ")));
}

function unitsAt(quote: string, amount: StatedAmount): readonly string[] {
  if (amount.kind === "percent") return ["%"];
  if (amount.kind === "currency") {
    const currency = currencyToken(amount.matchedText);
    if (currency === undefined) return [];
    const tail = quote.slice(amount.index + amount.matchedText.length);
    const period = /^\s*(?:(?:a|per)\s+)?(month|months|mo|monthly|year|years|yr|yearly)\b/iu.exec(tail)?.[1];
    return [period === undefined ? currency : `${currency}/${PERIOD_WORDS[period.toLowerCase()]!}`];
  }
  const before=quote.slice(0,amount.index).match(/(?:[A-Za-z][A-Za-z-]*\s*){1,3}$/u)?.[0] ?? '';
  return [...nounUnitsAt(quote.slice(amount.index + amount.matchedText.length)),...nounUnitsAt(' '+before)];
}

function locatedAmounts(quote: string): LocatedAmount[] {
  const amounts: LocatedAmount[] = findStatedAmounts(quote).flatMap((amount) => {
    const units = unitsAt(quote, amount);
    return [{ ...amount, units }];
  });
  // A counting determiner locates ONE source unit. It contributes no target
  // value, endpoint or sign, and explicit numerals still use the collector above.
  for (const match of quote.matchAll(/\b(?:each|every|per)\b(?=\s+[A-Za-z])/giu)) {
    const units = nounUnitsAt(quote.slice(match.index + match[0].length));
    if (units.length === 0) continue;
    amounts.push({ magnitude: 1, kind: "plain", matchedText: match[0], index: match.index, units, implicitSource: true });
  }
  return amounts;
}

function magnitudeMatches(expected: number, amount: StatedAmount): boolean {
  const reading = readUnit(amount.matchedText);
  return expected === amount.magnitude * reading.multiplier
    || Math.abs(expected - amount.magnitude * reading.multiplier)
      <= Math.max(Math.abs(expected), Math.abs(amount.magnitude * reading.multiplier), 1) * 1e-9;
}

function oneMatchingAmount(
  amounts: readonly LocatedAmount[],
  value: number,
  unit: string,
  source: boolean,
): LocatedAmount | undefined {
  const matches = amounts.filter((amount) => (amount.implicitSource === true ? source && Math.abs(value) === 1 : magnitudeMatches(Math.abs(value), amount))
    && amount.units.some((candidate) => sameUnit(unit, candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * One written figure is never both endpoints, so the source is located among the figures the target did not take.
 * Codex R3 P2(i): in "Each recruiter adds 1 hire." the before-numeral window also puts "recruiter" on the numeral 1,
 * so the source (1 recruiter) matched both "Each" and "1" and the one-match rule refused a stated effect staging read.
 */
function statedEndpoints(amounts: readonly LocatedAmount[], detail: StatedEffectDetail): { readonly target: LocatedAmount | undefined; readonly source: LocatedAmount | undefined } {
  const target = oneMatchingAmount(amounts, detail.amount, detail.amount_unit, false);
  const candidates = target === undefined ? amounts : amounts.filter(amount => amount !== target);
  return { target, source: oneMatchingAmount(candidates, detail.per_source_change, detail.per_source_change_unit, true) };
}

// Unit words written directly at a plain numeral. Month and year are read by the SHARED unit reader (`periodIn`, the
// vocabulary `sameUnit` uses: "annum", "pa", "pcm" included). Only calendar words it does not read stay local, as their
// own periods, so "per week" can never read as a monthly rate (Codex R2 F1).
const OTHER_PERIOD: Readonly<Record<string, string>> = {
  day: "day", days: "day", daily: "day", week: "week", weeks: "week", weekly: "week",
  quarter: "quarter", quarters: "quarter", quarterly: "quarter", yearly: "year",
};
const localPeriod = (word: string | undefined): string | undefined =>
  word === undefined || word === "/" ? undefined : periodIn(word) ?? OTHER_PERIOD[word];
const PERIOD_ADJECTIVE = /^(?:daily|weekly|monthly|quarterly|yearly|annual|annually)$/u;
const PERIOD_CONNECTOR = new Set(["a", "an", "per", "every", "each", "/"]);
const LOCAL_QUALIFIER = new Set(["more", "extra", "additional", "new", "newly", "fewer", "less", "further", "net", "lost", "added", "existing"]);
const LOCAL_FUNCTION_WORD = new Set(["a", "an", "the", "and", "or", "to", "of", "in", "on", "at", "by", "for", "from", "with", "than",
  "per", "each", "every", "into", "over", "under", "across", "between", "about", "around", "roughly", "approximately", "up", "down",
  "is", "are", "was", "were", "be", "would", "will", "could", "should", "if", "when", "while", "but"]);

/**
 * The noun phrase and the period written at a plain numeral. Nothing here supplies a unit. `closed` says the phrase
 * visibly ends inside the scan (a period, a non-coordinating function word, or the sentence end): only then is a noun
 * that is not the declared one a contradiction. A phrase that runs on ("highly experienced, senior hires") or past the
 * scan is a noun the scanner did not place, which is no evidence either way (Codex R2 F2).
 */
function localCountUnit(quote: string, amount: LocatedAmount): { readonly nouns: readonly string[]; readonly period: string | null; readonly closed: boolean } {
  // "/" is its own word, so "deliveries/year" reads its period like "deliveries per year".
  const tail = quote.slice(amount.index + amount.matchedText.length);
  const scanned = tail.match(/^\s+((?:(?:[A-Za-z][A-Za-z-]*|\/)\s*){1,6})/u);
  const words = scanned?.[1]?.replace(/\//gu, " / ").trim().split(/\s+/u).map(word => word.toLowerCase()) ?? [];
  const after = scanned === null ? undefined : tail.charAt(scanned[0].length);
  let i = 0, period: string | null = null;
  while (i < words.length && (LOCAL_QUALIFIER.has(words[i]!) || PERIOD_ADJECTIVE.test(words[i]!))) {
    if (PERIOD_ADJECTIVE.test(words[i]!)) period = localPeriod(words[i])!;
    i++;
  }
  const nouns: string[] = [];
  while (i < words.length && !LOCAL_FUNCTION_WORD.has(words[i]!) && words[i] !== "/" && localPeriod(words[i]) === undefined) nouns.push(words[i++]!);
  const closed = i < words.length ? words[i] !== "and" && words[i] !== "or" : after !== undefined && (after === "" || /[.!?;]/u.test(after));
  if (PERIOD_ADJECTIVE.test(words[i] ?? "")) period = localPeriod(words[i])!;
  else if (PERIOD_CONNECTOR.has(words[i] ?? "") && localPeriod(words[i + 1]) !== undefined) period = localPeriod(words[i + 1])!;
  return { nouns, period, closed };
}

/** The words after a numeral up to its clause end: the sentence end or the next figure, whichever comes first. */
function clauseWordsAfter(quote: string, amount: LocatedAmount): readonly string[] {
  const tail = quote.slice(amount.index + amount.matchedText.length);
  const end = tail.search(/[.!?;]|\d/u);
  return (end === -1 ? tail : tail.slice(0, end)).replace(/\//gu, " / ").match(/[A-Za-z][A-Za-z-]*|\//gu)?.map(word => word.toLowerCase()) ?? [];
}

/**
 * Missing local unit words are not contradictions to the owning quantity declaration; written ones are checked whole.
 * A count is its noun WITH its period: "18 deliveries per year" contradicts deliveries/month, and a noun written at the
 * numeral that is not the declared noun ("18 elephants") contradicts it whatever the opposite endpoint is called.
 */
function unitAgrees(amount: LocatedAmount, expected: string, other: string, quote: string): boolean {
  const money=readMoney(expected,'');
  if(amount.kind==='currency')return money!==null && money.code===amount.currencyCode
    && amount.units.every(u=>{const m=readMoney(u,'');return m===null || m.period===null || m.period===money.period;});
  if(amount.kind==='percent')return sameUnit(expected,'%');
  const count=readCountRate(expected),otherCount=readCountRate(other);
  if(count===null)return true;
  const sameNoun=(unit:string,noun:readonly string[])=>readCountRate(unit)?.noun.join(' ')===noun.join(' ');
  if(amount.implicitSource!==true){
    const local=localCountUnit(quote,amount);
    const runs=local.nouns.flatMap((_,start)=>local.nouns.slice(start).map((__,end)=>local.nouns.slice(start,start+end+1).join(' ')));
    if(local.nouns.length>0 && local.closed && !runs.some(run=>sameNoun(run,count.noun)))return false;
    if(local.period!==null && local.period!==count.period)return false;
    // ⛔ A phrase that runs on past a comma or "and" hides its period and noun from the scan above, so it is read to the
    // clause end (the sentence end or the next figure): a written period that is not the declared one refuses, and so
    // does a clause that never writes the declared noun (Codex R3 P1: "3 highly experienced, carefully vetted hires a
    // year" earned hires/month). A clause that writes no content word ("1 and 4", a range's bounds) stays no evidence.
    if(!local.closed){
      const rest=clauseWordsAfter(quote,amount);
      const restRuns=rest.flatMap((_,start)=>rest.slice(start,start+6).map((__,end)=>rest.slice(start,start+end+1).join(' ')));
      const content=rest.filter(word=>!LOCAL_FUNCTION_WORD.has(word) && word!=='/' && localPeriod(word)===undefined && !PERIOD_ADJECTIVE.test(word));
      if(rest.some(word=>{const period=localPeriod(word);return period!==undefined && period!==count.period;}))return false;
      if(content.length>0 && !restRuns.some(run=>sameNoun(run,count.noun)))return false;
    }
  }
  if(amount.units.some(u=>sameNoun(u,count.noun)))return true;
  return otherCount===null || !amount.units.some(u=>sameNoun(u,otherCount.noun));
}

/** A counting determiner needs its source unit, not an unrelated calendar marker. */
function implicitSourceAgrees(amount: LocatedAmount, unit: string): boolean {
  if (!amount.implicitSource) return true;
  const count = readCountRate(unit);
  if (count !== null) return amount.units.some(candidate => {
    const actual = readCountRate(candidate);
    return actual !== null && actual.noun.join(' ') === count.noun.join(' ')
      && (actual.period === null || actual.period === count.period);
  });
  const money = readMoney(unit, '');
  if (money !== null) return amount.units.some(candidate => {
    const actual = readMoney(candidate, '');
    return actual !== null && actual.code === money.code
      && (actual.period === null || actual.period === money.period)
      && (actual.per ?? []).join(' ') === (money.per ?? []).join(' ');
  });
  return amount.units.some(candidate => sameUnit(unit, candidate));
}

/** Unit words only check the declared ends; they never supply an endpoint or a unit. */
export function statedEffectUnitsMatch(quote: string, detail: StatedEffectDetail, authority: DraftStatedRelationship): boolean {
  const amounts = locatedAmounts(quote);
  const agrees = (span: DraftQuoteSpan | undefined, unit: string, other: string, source = false): boolean => {
    if (span === undefined) return true; // Missing evidence is refused by the evidence guard, not guessed here.
    const amount = amounts.find(a => atSpan(a, span, quote) && (source || !a.implicitSource));
    return amount === undefined || unitAgrees(amount, unit, other, quote) && (!source || implicitSourceAgrees(amount, unit));
  };
  return agrees(authority.amount_span, detail.amount_unit, detail.per_source_change_unit)
    && agrees(authority.range?.low_span, detail.amount_unit, detail.per_source_change_unit)
    && agrees(authority.range?.high_span, detail.amount_unit, detail.per_source_change_unit)
    && agrees(authority.source_span, detail.per_source_change_unit, detail.amount_unit, true);
}

/** Numeric punctuation inside an owned literal is not a sentence boundary. */
function spansShareClause(quote: string, spans: readonly DraftQuoteSpan[]): boolean {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let end = ordered[0]?.end ?? 0;
  for (const span of ordered.slice(1)) {
    if (span.start > end && ['.', '!', '?', ';'].some(d => quote.slice(end, span.start).includes(d))) return false;
    end = Math.max(end, span.end);
  }
  return true;
}

/**
 * Validate, rather than extract, a typed natural effect against its quoted span.
 * The quote supplies no endpoints, signs or target values to the model. It
 * validates the four typed fields using located numerals and units; a counting
 * determiner can locate exactly one source unit.
 */
export function statedEffectFiguresMatch(
  quote: string,
  detail: StatedEffectDetail,
): boolean {
  if (quote.trim().length === 0) return false;
  if (![detail.amount, detail.per_source_change].every((value) => Number.isFinite(value) && value !== 0)) return false;
  if (![detail.amount_unit, detail.per_source_change_unit].every((unit) => typeof unit === "string" && unit.trim().length > 0)) return false;
  const { target, source } = statedEndpoints(locatedAmounts(quote), detail);
  return target !== undefined && source !== undefined && target.index !== source.index;
}

function atSpan(amount: LocatedAmount, span: DraftQuoteSpan, quote: string): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end)
    && span.start >= 0 && span.end <= quote.length && span.start < span.end
    && amount.index >= span.start && amount.index + amount.matchedText.length <= span.end;
}

/** Figures alone cannot attest a signed relationship. The stated cause owns it. */
/** Explicit option authority has no numeric source operand; it is not a natural causal relationship. */
export interface StatedOptionEffectAuthority {
  kind: 'option_effect';
  effect: DraftStatedOptionEffect;
  option_quote: string;
  brief: string;
}

export function statedEffectQuoteMatches(
  quote: string,
  detail: StatedEffectDetail | { readonly amount: number; readonly amount_unit: string },
  authority?: DraftStatedRelationship | StatedOptionEffectAuthority,
): boolean {
  if (authority !== undefined && 'kind' in authority) {
    const e = authority.effect;
    if (!Number.isInteger(e.option) || e.option < 0 || !Number.isInteger(e.quantity) || e.quantity < 0
      || !authority.option_quote.trim() || !authority.brief.includes(authority.option_quote) || !authority.brief.includes(quote)
      || (e.sets_to === undefined) === (e.change_by === undefined)) return false;
    const value = e.sets_to ?? e.change_by;
    if (value !== detail.amount || !Number.isFinite(value) || !quote.trim()) return false;
    const literal = boundLiteral(quote, e.value_literal, detail.amount);
    if (literal.reason !== undefined) return false;
    const amounts = locatedAmounts(quote);
    const target = amounts.find(a => !a.implicitSource && atSpan(a, literal.span, quote));
    if (target === undefined || !unitAgrees(target, detail.amount_unit, '', quote)) return false;
    const spans = [literal.span];
    if (e.range !== undefined) {
      const r = e.range;
      if (!Number.isFinite(r.low) || !Number.isFinite(r.high) || r.low >= r.high || r.low > detail.amount || detail.amount > r.high
        || r.low_literal === undefined || r.high_literal === undefined) return false;
      const low = boundLiteral(quote, r.low_literal, r.low), high = boundLiteral(quote, r.high_literal, r.high);
      if (low.reason !== undefined || high.reason !== undefined || low.span.start >= high.span.start) return false;
      for (const span of [low.span, high.span]) {
        const amount = amounts.find(a => !a.implicitSource && atSpan(a, span, quote));
        if (amount === undefined || !unitAgrees(amount, detail.amount_unit, '', quote)) return false;
        spans.push(span);
      }
    }
    return spansShareClause(quote, spans);
  }
  if (!('per_source_change' in detail)) return false;
  if(authority?.amount_literal!==undefined && authority.range===undefined && authority.amount_span!==undefined && authority.source_span!==undefined){
    if(authority.amount!==detail.amount || authority.per_source_change!==detail.per_source_change || detail.amount===0 || detail.per_source_change===0
      || !sameUnit(authority.amount_unit,detail.amount_unit) || !sameUnit(authority.per_source_change_unit,detail.per_source_change_unit)
      || boundLiteral(quote,authority.amount_literal,detail.amount).reason!==undefined)return false;
    const amounts=locatedAmounts(quote);
    const target=amounts.find(a=>!a.implicitSource && atSpan(a,authority.amount_span!,quote));
    const source=amounts.find(a=>atSpan(a,authority.source_span!,quote) && (a.implicitSource ? Math.abs(detail.per_source_change)===1 : magnitudeMatches(Math.abs(detail.per_source_change),a)));
    if(target===undefined || source===undefined || target.index===source.index || !statedEffectUnitsMatch(quote,detail,authority) || !unitAgrees(target,detail.amount_unit,detail.per_source_change_unit,quote)
      || !unitAgrees(source,detail.per_source_change_unit,detail.amount_unit,quote))return false;
    const left=Math.min(authority.amount_span.end,authority.source_span.end),right=Math.max(authority.amount_span.start,authority.source_span.start);
    return !['.','!','?',';'].some(d=>quote.slice(left,right).includes(d));
  }
  if(authority?.range !== undefined && authority.source_span !== undefined) {
    const r=authority.range;
    if(authority.amount !== detail.amount || authority.per_source_change !== detail.per_source_change
      || !sameUnit(authority.amount_unit,detail.amount_unit) || !sameUnit(authority.per_source_change_unit,detail.per_source_change_unit)
      || r.low>detail.amount || detail.amount>r.high || r.low>r.high || r.low<0 && r.high>0) return false;
    if(r.low_literal===undefined || r.high_literal===undefined || boundLiteral(quote,r.low_literal,r.low).reason!==undefined
      || boundLiteral(quote,r.high_literal,r.high).reason!==undefined) return false;
    if(authority.amount_literal!==undefined && boundLiteral(quote,authority.amount_literal,detail.amount).reason!==undefined)return false;
    const source=locatedAmounts(quote).find(a=>atSpan(a,authority.source_span!,quote) && (a.implicitSource ? Math.abs(detail.per_source_change)===1 : magnitudeMatches(Math.abs(detail.per_source_change),a)));
    if(source===undefined || !statedEffectUnitsMatch(quote,detail,authority))return false;
    const spans=[authority.source_span,r.low_span,r.high_span,authority.amount_span].filter((s):s is DraftQuoteSpan=>s!==undefined);
    return spansShareClause(quote,spans);
  }
  if (authority === undefined || authority.amount_span === undefined || authority.source_span === undefined || !statedEffectFiguresMatch(quote, detail)) return false;
  if (authority.amount !== detail.amount || authority.per_source_change !== detail.per_source_change
    || !sameUnit(authority.amount_unit, detail.amount_unit)
    || !sameUnit(authority.per_source_change_unit, detail.per_source_change_unit)) return false;
  const { target, source } = statedEndpoints(locatedAmounts(quote), detail);
  if (target === undefined || source === undefined
    || !atSpan(target, authority.amount_span, quote) || !atSpan(source, authority.source_span, quote)) return false;
  // The two typed amount spans must be in one relationship clause. Punctuation
  // supplies no sign, value or endpoint; it only refuses cross-sentence evidence.
  const left = Math.min(authority.amount_span.end, authority.source_span.end);
  const right = Math.max(authority.amount_span.start, authority.source_span.start);
  const between = quote.slice(left, right);
  return ![".", "!", "?", ";"].some(delimiter => between.includes(delimiter));
}

/** Runtime read-back of signed evidence; malformed legacy/persisted evidence earns no authority. */
export function readStatedRelationship(value: unknown): DraftStatedRelationship | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const span = (raw: unknown): DraftQuoteSpan | undefined => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const s = raw as Record<string, unknown>;
    return typeof s.start === "number" && Number.isInteger(s.start) && s.start >= 0
      && typeof s.end === "number" && Number.isInteger(s.end) && s.end > s.start ? { start: s.start, end: s.end } : undefined;
  };
  const amount_span = span(v.amount_span), source_span = span(v.source_span);
  if (typeof v.from_quantity !== "number" || !Number.isInteger(v.from_quantity) || v.from_quantity < 0
    || typeof v.to_quantity !== "number" || !Number.isInteger(v.to_quantity) || v.to_quantity < 0
    || typeof v.amount !== "number" || !Number.isFinite(v.amount)
    || typeof v.per_source_change !== "number" || !Number.isFinite(v.per_source_change)
    || typeof v.amount_unit !== "string" || typeof v.per_source_change_unit !== "string"
    || amount_span === undefined || source_span === undefined) return undefined;
  return { from_quantity: v.from_quantity, to_quantity: v.to_quantity, amount: v.amount, amount_unit: v.amount_unit,
    per_source_change: v.per_source_change, per_source_change_unit: v.per_source_change_unit, amount_span, source_span };
}
