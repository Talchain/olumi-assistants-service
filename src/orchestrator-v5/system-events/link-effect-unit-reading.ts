/** Literal, per-end unit readings for an unsized link (RT-6 U1–U4). No graph writes. */
import { findStatedAmounts, readCurrencyUnitWithQualifiers, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { countedNoun } from '../agent-lane/counted-nouns.js';
import { sameWord, wordsOf } from '../agent-lane/stated-by-user.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { LinkEffectStatement } from './link-effect-edit.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v : undefined;

export interface LinkEffectUnitReading {
  readonly node_id: string;
  readonly unit_reading: { readonly unit: string; readonly source: 'user_stated'; readonly source_quote: string };
}
export interface PreparedLinkEffectUnitReadings {
  readonly unit_readings: readonly LinkEffectUnitReading[];
  /** One question, including every unresolved eligible end. Nothing is written until it is answered. */
  readonly ask?: string;
}

const unitOf = (n: Rec): string | undefined => text(n.unit)
  ?? (isRec(n.observed_state) ? text(n.observed_state.unit) : undefined)
  ?? (n.kind === 'goal' ? text(n.goal_threshold_unit) : undefined)
  ?? (isRec(n.data) ? text(n.data.unit) : undefined)
  ?? (isRec(n.unit_reading) ? text(n.unit_reading.unit) : undefined);
const naturalOf = (edge: Rec): Rec | undefined => isRec(edge.provenance) && isRec(edge.provenance.natural_effect)
  ? edge.provenance.natural_effect : undefined;
const endpointUnit = (edge: Rec, id: string): string | undefined => {
  const natural = naturalOf(edge);
  return natural === undefined ? undefined : text(natural[edge.from === id ? 'per_source_change_unit' : 'amount_unit']);
};
// A points change and a % level use the same raw unit; this comparator does not reinterpret a literal bare %.
const levelUnitKey = (u: string): string | undefined => /^(?:percentage\s+points?|pp|points?)$/i.test(u.trim()) ? unitComparisonKey('%') : unitComparisonKey(u);

/** The model can adopt only where no established unit or level would be reinterpreted (U1). */
function eligible(node: Rec, edges: readonly Rec[], from: string, to: string, unit: string): boolean {
  if (unitOf(node) !== undefined) return false;
  // Even a zero level is a level; never infer a unit for a value already held by the model.
  if (isRec(node.observed_state) && ['value', 'raw_value', 'baseline'].some(k => node.observed_state && isRec(node.observed_state)
    && node.observed_state[k] !== undefined && node.observed_state[k] !== null)) return false;
  return !edges.some(e => (e.from === node.id || e.to === node.id) && !(e.from === from && e.to === to)
    && endpointUnit(e, String(node.id)) !== undefined && levelUnitKey(endpointUnit(e, String(node.id))!) !== levelUnitKey(unit));
}

/** Only words explicitly stated inside THIS end's clause may qualify its currency period. */
function periodOf(clause: string): string | null | undefined {
  const periods = [...clause.matchAll(/(?:\bper\s+|\/\s*)([\p{L}]+)\b/giu)].map(m => m[1]!.toLowerCase());
  if (periods.some(p => !['day', 'week', 'month', 'quarter', 'year'].includes(p))) return null;
  return new Set(periods).size > 1 ? null : periods[0];
}

/** Words that may sit between an end's name and its figure ("waste rate rises by about 1 point"); nothing else may. */
const LINKING = /^(?:rises?|rising|rose|falls?|falling|fell|increases?|increasing|increased|decreases?|decreasing|decreased|grows?|growing|grew|drops?|dropping|dropped|goes|going|went|up|down|by|about|around|roughly|approximately|nearly|almost|some)$/i;

/**
 * The figure's own phrase: an exact substring of the quote, bounded so it can never be silently dropped (≤500).
 * A figure belongs to THIS end only by adjacency (Codex buddy HIGH, 5 Oct):
 *  - forward: right after the figure (its unit words and a literal period), "of" / a determiner / "more|extra|additional",
 *    then the end's own words FIRST ("£3 of sales revenue", "3 more customers"); "£3 of profit" never names Sales revenue,
 *    and "2 points of market share for gross margin" never names Gross margin;
 *  - backward: the end's own words, then only movement / linking words, then the figure ("waste rate rises by 1 point");
 *    "on sales brings in £3" never names Sales revenue.
 */
function clauseOf(quote: string, amounts: readonly StatedAmount[], i: number, node: Rec, other: Rec): string | undefined {
  const a = amounts[i]!;
  const figureStart = a.index + (a.matchedText.length - a.matchedText.trimStart().length);
  const figureEnd = a.index + a.matchedText.length;
  const next = amounts[i + 1]?.index ?? quote.length;
  // A run may use any word of the end's label (shared words included: "marketing revenue" beside "marketing spend"), but
  // it names THIS end only if it holds ≥2 of its distinguishing words, or all of them when it has fewer. So a partial
  // prefix ("of gross profit" for Gross margin) never names it (Codex buddy r2 HIGH).
  const labelWords = wordsOf(String(node.label ?? node.id));
  const distinct = [...new Set([...labelWords.filter(w => !wordsOf(String(other.label ?? other.id)).some(o => sameWord(w, o))),
    ...(typeof node.count_noun === 'string' ? wordsOf(node.count_noun) : [])])];
  if (distinct.length === 0) return undefined;
  const inLabel = (w: string): boolean => [...labelWords, ...distinct].some(o => sameWord(o, w.toLowerCase()));
  const namesThisEnd = (run: readonly string[]): boolean => {
    const hit = distinct.filter(d => run.some(w => sameWord(d, w.toLowerCase()))).length;
    return hit >= Math.min(2, distinct.length);
  };
  const bounded = (from: number, to: number): string | undefined => {
    const clause = quote.slice(from, to).trimEnd();
    return clause.length >= 1 && clause.length <= 500 ? clause : undefined;
  };
  const PERIOD = /^(?:(?:\s+per\s+|\s*\/\s*)[\p{L}]+\b)*/iu;
  // Forward.
  const rest = quote.slice(figureEnd, next);
  // Whitespace is consumed only WITH a unit word, so "£3 per month" keeps its period (buddy r2 P2).
  const UNIT_WORDS = /^(?:\s*(?:percentage\s+points?|pp|points?)\b)?/iu;
  const unitTail = UNIT_WORDS.exec(rest)![0];
  const periodTail = PERIOD.exec(rest.slice(unitTail.length))![0];
  let at = unitTail.length + periodTail.length;
  // "5% rise in footfall", "a 10% jump in flour prices": a movement noun + in/of may stand between figure and end.
  const lead = /^\s*(?:(?:rise|increase|fall|drop|decrease|cut|jump|change|reduction|gain|growth|decline)s?\s+(?:in|of)\s+)?(?:of\s+)?(?:(?:the|our|your|its|their)\s+)?(?:(?:more|extra|additional)\s+)?/iu.exec(rest.slice(at))![0];
  at += lead.length;
  const tail = rest.slice(at);
  let named = 0;
  const run: string[] = [];
  for (const m of tail.matchAll(/[\p{L}]+/gu)) {
    // The end's label words come FIRST and run contiguously (whitespace only between them).
    if ((named === 0 && m.index !== 0) || !/^\s*$/.test(tail.slice(named, m.index)) || !inLabel(m[0])) break;
    named = m.index! + m[0].length;
    run.push(m[0]);
  }
  if (named > 0 && namesThisEnd(run)) {
    const after = at + named;
    const period = PERIOD.exec(rest.slice(after))![0];
    return bounded(figureStart, figureEnd + after + period.length);
  }
  // Backward, within this local clause only.
  const previousEnd = i === 0 ? 0 : amounts[i - 1]!.index + amounts[i - 1]!.matchedText.length;
  const before = quote.slice(previousEnd, figureStart);
  const cuts = [...before.matchAll(/[!?;:,\n]|(?<!\d)\.|\.(?!\d)/g)];
  const boundary = cuts.length === 0 ? 0 : cuts[cuts.length - 1]!.index! + 1;
  const words = [...before.slice(boundary).matchAll(/[\p{L}]+/gu)];
  // The text between words must be whitespace only, so a symbol or stray figure never bridges two phrases.
  const gapOk = (k: number): boolean => /^\s*$/.test(before.slice(boundary + words[k]!.index! + words[k]![0].length,
    k + 1 < words.length ? boundary + words[k + 1]!.index! : figureStart));
  let k = words.length - 1;
  while (k >= 0 && LINKING.test(words[k]![0]) && gapOk(k)) k--;
  let first = -1;
  const back: string[] = [];
  while (k >= 0 && inLabel(words[k]![0]) && gapOk(k)) { first = k; back.push(words[k]![0]); k--; }
  if (first < 0 || !namesThisEnd(back)) return undefined;
  const suffix = UNIT_WORDS.exec(rest)![0];
  const period = PERIOD.exec(rest.slice(suffix.length))![0];
  return bounded(previousEnd + boundary + words[first]!.index!, figureEnd + suffix.length + period.length);
}

function literalUnit(a: StatedAmount, clause: string, node: Rec): { unit?: string; barePercent?: true } {
  if (a.kind === 'percent') return { barePercent: true };
  if (a.kind === 'currency' && a.currencyCode !== undefined) {
    // The scanner can distribute a range's currency onto a bare endpoint. Adoption requires a currency literally
    // written on THIS amount, so inherited metadata alone never authorises a unit reading.
    const prefix = a.matchedText.trim().split(/\d/, 1)[0];
    if (readCurrencyUnitWithQualifiers(prefix).kind !== 'currency') return {};
    const period = periodOf(clause);
    if (period === null) return {};
    return { unit: `${a.currencyCode}${period === undefined ? '' : `/${period}`}` };
  }
  const literal = a.matchedText.trim();
  const at = clause.indexOf(literal);
  if (at < 0) return {};
  const tail = clause.slice(at + literal.length);
  if (/^\s*(?:percentage\s+points?\b|pp\b|points?\s+of\b)/i.test(tail)) return { unit: '%' };
  const nounWords = tail.replace(/^\s*(?:(?:more|extra|additional)\s+)?/, '').match(/[\p{L}]+/gu) ?? [];
  const noun = nounWords[0];
  const statedCountNoun = typeof node.count_noun === 'string' ? wordsOf(node.count_noun) : undefined;
  if (noun !== undefined && (statedCountNoun !== undefined
    ? statedCountNoun.length > 0 && statedCountNoun.every((w, i) => nounWords[i] !== undefined && sameWord(w, nounWords[i]!.toLowerCase()))
    : countedNoun(noun) && wordsOf(String(node.label ?? '')).some(w => sameWord(w, noun.toLowerCase())))) {
    return { unit: typeof node.count_noun === 'string' ? node.count_noun : noun };
  }
  return {};
}

export function prepareLinkEffectUnitReadings(
  graph: unknown, from: string, to: string, effect: LinkEffectStatement, quote: string,
): PreparedLinkEffectUnitReadings {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { unit_readings: [] };
  const nodes = graph.nodes.filter(isRec);
  const source = nodes.find(n => n.id === from); const target = nodes.find(n => n.id === to);
  if (source === undefined || target === undefined) return { unit_readings: [] };
  const edges = graph.edges.filter(isRec);
  const current = edges.find(e => e.from === from && e.to === to);
  const amounts = findStatedAmounts(quote, { isoCurrencyCodes: true });
  const unit_readings: LinkEffectUnitReading[] = [];
  const asks: string[] = [];
  for (const [node, other, value, statedUnit] of [[source, target, effect.per_source_change, effect.per_source_change_unit],
    [target, source, effect.amount, effect.amount_unit]] as const) {
    // Step 1's established size continues to govern; this door adopts units for UNSIZED ends only.
    if (unitOf(node) !== undefined || (current !== undefined && endpointUnit(current, String(node.id)) !== undefined)) continue;
    const candidates = amounts.flatMap((a, i) => {
      if (a.magnitude !== Math.abs(value)) return [];
      const clause = clauseOf(quote, amounts, i, node, other);
      return clause === undefined ? [] : [{ clause, ...literalUnit(a, clause, node) }];
    });
    const one = candidates.length === 1 ? candidates[0] : undefined;
    const unit = one?.unit;
    if (!eligible(node, edges, from, to, unit ?? statedUnit)) continue;
    const label = String(node.label ?? node.id);
    if (one?.barePercent === true) {
      const example = value < 0 ? `${10 + Math.abs(value)}% → 10%` : `10% → ${10 + value}%`;
      asks.push(`Is that a ${Math.abs(value)}-point ${value < 0 ? 'fall' : 'rise'} in \u201c${label}\u201d (say ${example}), or ${Math.abs(value)}% of today\u2019s level?`);
    } else if (unit === undefined || unit.length > 40) {
      asks.push(`What unit is the ${Math.abs(value)} change in \u201c${label}\u201d stated in?`);
    } else {
      unit_readings.push({ node_id: String(node.id), unit_reading: { unit, source: 'user_stated', source_quote: one!.clause } });
    }
  }
  // One question even when both ends need clarification.
  return { unit_readings, ...(asks.length > 0 ? { ask: asks.map((ask, i) => { const lead = i === 0 ? ask : ask[0]!.toLowerCase() + ask.slice(1); return i < asks.length - 1 ? lead.replace(/\?$/, ';') : lead; }).join(' ') } : {}) };
}
