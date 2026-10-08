import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
/** Literal, per-end unit readings for an unsized link (RT-6 U1–U4). No graph writes. */
import { classifyValueSource, earnsAuthorshipCredit } from '../../cee/graph-readiness/obligation-provenance.js';
import { readCurrencyUnitWithQualifiers, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { POINTS_UNIT } from '../../utils/unit-alphabet.js';
import { countedNoun } from '../agent-lane/counted-nouns.js';
import { afterChangeWord, denominatorWords, isChangeWord, levelDenominatorOf, linkEffectTheUserStated, namesSourceOf, sameWord, wordsOf } from '../agent-lane/stated-by-user.js';
import { singular, words } from '../agent-lane/same-unit.js';
import { boundedLinkEffectText, findLinkEffectAmounts, linkEffectSourceLevels } from '../agent-lane/link-effect-figures.js';
import { isPercentageLevelUnit, resolveMagnitudeFrame, sourceUnitWords } from '../../cee/magnitude/link-effect.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { LinkEffectStatement } from './link-effect-edit.js';
import { mediatorReadings } from '../agent-lane/mediator-reading.js';
import { canAdoptLabelUnit, labelHeadUnit } from '../agent-lane/label-head-unit.js';
import { isLinkEffectFloor, linkEffectFloorQuestion, readLinkEffectFloorAnswer, type LinkEffectFloor } from '../agent-lane/link-effect-lower-bound.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v : undefined;

export interface LinkEffectUnitReading {
  readonly node_id: string;
  readonly unit_reading: { readonly unit: string; readonly source: 'user_stated'; readonly source_quote: string };
}
/** A current-turn answer; a carried statement supplies context, never any of these figures. */
export interface LinkEffectClarificationReading {
  readonly node_id: string;
  readonly quote: string;
  readonly answer: string;
  readonly current_turn?: true;
  readonly reading?: 'points' | 'relative';
  readonly statement_classification?: 'asserted';
  readonly source_text?: string;
  readonly from_id?: string;
  readonly to_id?: string;
  readonly from_label?: string;
  readonly to_label?: string;
  readonly floor?: LinkEffectFloor;
  readonly upper?: number;
}

const pointsUnit = (unit: string): boolean => /^(?:(?:percentage\s+)?points?|pp)$/i.test(unit.trim());
const answerUnitKey = (unit: string): string | undefined => unitComparisonKey(unit.trim().replace(/\s+a\s+(day|week|month|year)$/i, ' per $1'));

type CurrentEffectEnds = { readonly source: string; readonly target: string };
type CurrentEffectScope = Parameters<typeof linkEffectTheUserStated>[3];
function isCurrentClarification(clarification: LinkEffectClarificationReading | undefined, effect: LinkEffectStatement, quote: string): clarification is LinkEffectClarificationReading {
  return isRec(clarification) && clarification.current_turn === true && clarification.quote === quote
    && clarification.answer === quote && clarification.source_text === quote && quote.length <= 8000
    && clarification.statement_classification === 'asserted' && typeof clarification.from_id === 'string'
    && typeof clarification.to_id === 'string' && clarification.node_id === clarification.to_id
    && Number.isFinite(effect.per_source_change) && effect.per_source_change !== 0 && Number.isFinite(effect.amount) && effect.amount !== 0
    && typeof effect.amount_unit === 'string' && typeof effect.per_source_change_unit === 'string';
}

/** A floor constrains only a current commensurate answer; no stored figure supplies a missing change. */
export function readLinkEffectCurrentFloorAnswer(
  clarification: LinkEffectClarificationReading | undefined, effect: LinkEffectStatement, quote: string,
  ends?: CurrentEffectEnds, scope?: CurrentEffectScope,
): ReturnType<typeof readLinkEffectFloorAnswer> {
  const floor = clarification?.floor;
  const question = isLinkEffectFloor(floor) ? linkEffectFloorQuestion(floor)
    : "What's your best single guess, and what's the most it could plausibly be, in the link's own units?";
  const refuse = (refusal = 'unreadable_floor_answer'): ReturnType<typeof readLinkEffectFloorAnswer> => ({ ok: false, refusal, question });
  if (!isCurrentClarification(clarification, effect, quote) || !isLinkEffectFloor(floor)
    || floor.reading === 'relative' || floor.per_source_change !== effect.per_source_change
    || floor.from_id !== undefined && floor.from_id !== clarification.from_id
    || floor.to_id !== undefined && floor.to_id !== clarification.to_id
    || answerUnitKey(floor.per_source_change_unit) !== answerUnitKey(effect.per_source_change_unit)
    || (floor.reading === 'points' ? !pointsUnit(effect.amount_unit)
      : answerUnitKey(floor.unit) !== answerUnitKey(effect.amount_unit))) return refuse();
  const short = readLinkEffectFloorAnswer(floor, quote);
  if (short.ok) {
    // The current short answer never supplies the source denominator of a prior multi-unit statement.
    return effect.per_source_change === 1 && short.guess === effect.amount && short.upper === clarification.upper ? short : refuse('not_the_users_figure');
  }
  const namedEnds = ends ?? (typeof clarification.from_label === 'string' && typeof clarification.to_label === 'string'
    ? { source: clarification.from_label, target: clarification.to_label } : undefined);
  if (namedEnds === undefined || clarification.upper !== undefined
    || linkEffectTheUserStated(quote, effect, namedEnds, scope ?? { quantities: [namedEnds.source, namedEnds.target] }) !== null) return short;
  if (effect.amount < floor.value || floor.exclusive === true && effect.amount === floor.value) return refuse('outside_stated_bounds');
  // A full current statement gives a point only. No upper or spread is recovered from its other figures.
  return { ok: true, guess: effect.amount };
}

/**
 * A current quoted answer is bound to one carried link. Its own target figure alone supplies the size.
 * A short answer has a one-unit source basis; a full statement must state and bind its source change afresh.
 */
export function readLinkEffectClarificationAnswer(
  clarification: LinkEffectClarificationReading | undefined, effect: LinkEffectStatement, quote: string,
  ends?: CurrentEffectEnds, scope?: CurrentEffectScope,
): boolean {
  if (!isCurrentClarification(clarification, effect, quote)) return false;
  if (clarification.floor !== undefined) return readLinkEffectCurrentFloorAnswer(clarification, effect, quote, ends, scope).ok;
  if (effect.per_source_change !== 1 || quote.length > 400) return false;
  if (clarification.upper !== undefined || boundedLinkEffectText(quote) !== undefined) return false;
  const amounts = findLinkEffectAmounts(quote);
  const amount = amounts.length === 1 ? amounts[0] : undefined;
  if (amount === undefined || amount.magnitude !== Math.abs(effect.amount) || amount.kind === 'percent') return false;
  const prefix = quote.slice(0, amount.index).trim();
  if (!/^(?:(?:my|the|our)\s+)?(?:(?:best(?:\s+single)?\s+)?(?:guess|estimate)(?:\s+is|\s*:)?\s*)?(?:(?:about|around|roughly|approximately)\s*)?[+−-]?$/i.test(prefix)) return false;
  const tail = quote.slice(amount.index + amount.matchedText.length).trim().replace(/[.!]$/, '').trim();
  const direction = /^(?:fewer|less|lower|down)\b/i.test(tail) || /[−-]\s*$/.test(prefix) ? -1 : 1;
  if (Math.sign(effect.amount) !== direction) return false;
  const saidUnit = tail.replace(/^(?:fewer|less|lower|down|more|extra|additional|higher|up)\s+/i, '');
  if (pointsUnit(effect.amount_unit)) return pointsUnit(saidUnit) || saidUnit === '' && clarification.reading === 'points';
  if (amount.kind === 'currency') {
    const period = saidUnit.replace(/^(?:a|per)\s+/i, '/');
    return answerUnitKey(`${amount.currencyCode ?? ''}${period === '' ? '' : period}`) === answerUnitKey(effect.amount_unit);
  }
  return saidUnit !== '' && answerUnitKey(saidUnit) === answerUnitKey(effect.amount_unit);
}

/** A unit-only reply can guide the next question; it never supplies an effect figure. */
export function isRelativeLinkEffectAnswer(answer: string): boolean {
  const reply = answer.trim().replace(/^(?:I mean|I meant|it['’]?s|that['’]?s)\s+/i, '').replace(/[.!]$/, '').trim();
  return /^relative(?:\s+(?:change|increase|decrease))?$/i.test(reply);
}

export interface PreparedLinkEffectUnitReadings {
  readonly unit_readings: readonly LinkEffectUnitReading[];
  /** % level ends whose change is points in the user's own terms: at a TYPED 0, a bare % can only be points (Science F1);
   *  "X% of {the level's own denominator}" says points (U3, Science 6008156781 (1)). The stored reading says points. */
  readonly points_at_zero?: readonly string[];
  /** One question, including every unresolved eligible end. Nothing is written until it is answered. */
  readonly ask?: string;
}

/**
 * The end's level only when the USER stated it (Science F1, #87 5999199710; typed fields 17:3xZ): `raw_value ?? value`
 * (an unframed level has no raw_value) under a source that earns authorship. An Olumi estimate, a default or a missing
 * level is no level here: never a "today's level" in an example, never a zero that settles a reading.
 */
function usersLevelOf(node: Rec): number | undefined {
  const os = isRec(node.observed_state) ? node.observed_state : undefined;
  const level = os === undefined ? undefined : os.raw_value ?? os.value;
  return os !== undefined && typeof level === 'number' && Number.isFinite(level)
    && earnsAuthorshipCredit(classifyValueSource(os.source)) ? level : undefined;
}

/**
 * ⭐ U3 (Science d5 #87 6008156781 (2)): an example never prints a new level equal to today's. `to` at the fewest decimals
 * (≤ 4) that hold it exactly to 4 places (trailing zeros trimmed: 31.5, 12.12, 8.004), never rounded to a coarser figure
 * that misstates it; undefined when even 4 places print today's level (then only the change is said).
 */
function differing(from: number, to: number): string | undefined {
  const shown = Number(to.toFixed(4));
  return shown === Number(from.toFixed(4)) ? undefined : String(shown);
}
/** A change said by itself, never rounded away: up to 4 decimals, else two significant figures. */
const sayChange = (n: number): string => (Number(n.toFixed(4)) !== 0 ? String(Number(n.toFixed(4))) : String(Number(n.toPrecision(2))));
/** U3: points or a share of today's level. The example uses the user's own level when it is theirs, else a generic one. */
function pointsOrShareAsk(label: string, value: number, level: number | undefined, frame: number | undefined): string {
  const by = Math.abs(value);
  const way = value < 0 ? 'fall' : 'rise';
  const move = `${by}-point ${way} in \u201c${label}\u201d`;
  const top = frame !== undefined && frame > 1 ? frame : 100;
  if (level !== undefined && level + value >= 0 && level + value <= top) {
    const points = differing(level, level + value);
    const share = level * (value / 100);
    const shareTo = differing(level, level + share);
    // Codex r1 P2: the share's own direction (a negative level turns a rise into a fall), never the stated figure's sign.
    const shareWay = share < 0 ? 'fall' : 'rise';
    return `Is that a ${move}${points === undefined ? '' : ` (${level}% → ${points}%)`}, or ${by}% of today\u2019s ${level}% `
      + `(a ${sayChange(Math.abs(share))}-point ${shareWay}${shareTo === undefined ? '' : `: ${level}% → ${shareTo}%`})?`;
  }
  const example = value < 0 ? `${10 + by}% → 10%` : `10% → ${10 + value}%`;
  return `Is that a ${move} (say ${example}), or ${by}% of today\u2019s level?`;
}

/**
 * ⭐ U3 (Science d5 #87 6008156781 (1)): "X% of {D}", where D IS the level's own denominator (`levelDenominatorOf`, the
 * ONE D reader), is an absolute change in the level's own unit: POINTS, never asked. D matches word for word after
 * dropping all/the/your/our (`DENOMINATOR_DETERMINER`, the D reader's own list), and the phrase ENDS there (the binder's own
 * rule in `targetFigureOfAnotherQuantity`): never a subset, a superset ("appointments booked online") or a phrase that
 * runs on ("appointments for new patients"). "Of no-shows" or "of today's rate" is RELATIVE, never this.
 */
function percentOfOwnDenominator(quote: string, a: StatedAmount, node: Rec, amounts: readonly StatedAmount[]): boolean {
  const own = levelDenominatorOf(node);
  if (own.length === 0) return false;
  // Codex r1 on #2651 P1-2: a D that names the quantity ITSELF ("% of no-shows" on "no-shows") makes "X% of no-shows" the
  // RELATIVE reading (d5), never points.
  const label = denominatorWords(String(node.label ?? ''));
  if (label.length === own.length && label.every((w, i) => sameWord(w, own[i]!))) return false;
  // Codex r1 P1-1: an occurrence binds to this end by its SIZE only, so it must be the one % of that size in the sentence;
  // two (one per end) leave nothing saying which one carries "of D": no reading, so it asks.
  if (amounts.filter((x) => x.kind === 'percent' && x.magnitude === a.magnitude).length !== 1) return false;
  const after = quote.slice(a.index + a.matchedText.length);
  const m = /^\s+of\s+((?:[\p{L}-]+\s*){1,8})/iu.exec(after);
  if (m === null) return false;
  const said = denominatorWords(m[1]!);
  if (said.length !== own.length || !said.every((w, i) => w === own[i])) return false;
  return /^\s*(?:$|[.,;:!?)\u2013\u2014]|-\s)/u.test(after.slice(m[0].length));
}

/**
 * ⭐ RT-6 row 1b (Codex r1 on the follow-up; Science #87 6005615422): the user's own COUNTED PHRASE for an end is its node's
 * label. Right after a figure equal to that end's change (one change word such as "more"/"fewer" skipped), the sentence's
 * words begin with the label's words (case + `singular()` only). "Every 10 more café subscribers" counts "Café
 * subscribers"; "Every 10 more subscribers" does not, whatever unit the Agent passes.
 */
export function sentenceCountsLabel(said: string, figure: number, label: unknown): boolean {
  if (typeof label !== 'string' || !Number.isFinite(figure) || figure === 0) return false;
  // ⛔ Codex r2: THIS end's own change occurrence, never any figure of its size. Two figures of this size in the sentence
  // (including equal source and target figures) leave nothing saying which one counts this end: no reading, never a guess.
  const want = words(label).map(singular);
  const hits = findLinkEffectAmounts(said).filter((a) => Math.abs(a.magnitude) === Math.abs(figure));
  if (want.length === 0 || hits.length !== 1) return false;
  const hit = hits[0]!;
  // Closing punctuation only: a possessive mark is kept, so "café subscribers’ customers" never reads as the label.
  const raw = words(afterChangeWord(said.slice(hit.index + hit.matchedText.length)));
  const got = raw.map((w) => w.replace(/[.,;:!?"\u201c\u201d]+$/u, ''));
  if (!want.every((w, i) => got[i] !== undefined && singular(got[i]!) === w)) return false;
  // ⛔ Codex r2 + sol r3: a COMPLETE counted phrase needs a DEMONSTRATED boundary, never "the next word is not a known
  // noun" ("café subscribers support tickets" continues it). The label ends the sentence or its clause (closing
  // punctuation), or the next word begins the statement's predicate: a change word the binder itself reads ("adds",
  // "costs") or a modal ("would add"). Anything else, no reading.
  const next = got[want.length];
  return next === undefined || /[.,;:!?]$/u.test(raw[want.length - 1]!) || isChangeWord(next) || MODAL.test(next);
}

/** A modal that opens the predicate after a counted phrase ("10 more café subscribers would add …"): closed-class words. */
const MODAL = /^(?:would|will|could|can|should|might|may|must)$/i;

/** The reading the card shows and the writer stores: an end whose change is points in the user's own terms is said in points
 *  (B3): a % at their typed 0, or "X% of {the level's own denominator}" (U3). */
export function withPointsAtZero<E extends LinkEffectStatement>(effect: E, zero: readonly string[] | undefined, from: string, to: string): E {
  if (zero === undefined || zero.length === 0) return effect;
  return { ...effect, ...(zero.includes(from) ? { per_source_change_unit: POINTS_UNIT } : {}),
    ...(zero.includes(to) ? { amount_unit: POINTS_UNIT } : {}) };
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
// Bare "point(s)" is points of a % only on a quantity whose unit is % (Science F1); on a unitless end it is a count noun.
const levelUnitKey = (u: string): string | undefined => /^(?:percentage\s+points?|pp)$/i.test(u.trim()) ? unitComparisonKey('%') : unitComparisonKey(u);

/** The model can adopt only where no established unit or level would be reinterpreted (U1). */
function eligible(node: Rec, edges: readonly Rec[], from: string, to: string, unit: string): boolean {
  if (unitOf(node) !== undefined || !canAdoptLabelUnit(node, [], unit)) return false;
  return !edges.some(e => (e.from === node.id || e.to === node.id) && !(e.from === from && e.to === to)
    && endpointUnit(e, String(node.id)) !== undefined && levelUnitKey(endpointUnit(e, String(node.id))!) !== levelUnitKey(unit));
}

/** Only words explicitly stated inside THIS end's clause may qualify its currency period. */
function periodOf(clause: string): string | null | undefined {
  const periods = [...clause.matchAll(/(?:\bper\s+|\/\s*)([\p{L}]+)\b|\ba\s+(month|week|year)\b/giu)]
    .map(m => (m[1] ?? m[2])!.toLowerCase());
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
  // A run (contiguous label words beside the figure) names THIS end only if it holds the label's HEAD noun (its last
  // word before any preposition: "margin" of Gross margin, "loss" of Footfall loss from price rise) AND at least one word
  // the other end's label lacks. A partial prefix ("of gross profit" for Gross margin or Gross profit margin) lacks the
  // head; "of margin" beside Operating margin lacks a distinguishing word (Codex buddy r2/r3 HIGH). Each token counts
  // once. A count noun stands in for the label only when it IS the head ("customers" of Customers), never as an alias.
  const rawLabel = String(node.label ?? node.id);
  const labelWords = wordsOf(rawLabel);
  const otherWords = wordsOf(String(other.label ?? other.id));
  const beforePreposition = rawLabel.split(/\s+(?:from|of|in|for|to|on|per|with|after|by)\s+/i)[0] ?? rawLabel;
  const head = wordsOf(beforePreposition).at(-1);
  const countNoun = typeof node.count_noun === 'string' ? wordsOf(node.count_noun) : [];
  if (head === undefined) return undefined;
  // The head matches exactly or as a simple plural, never by stem ("marginal" is not "margin"; buddy r4 HIGH).
  const isHead = (w: string): boolean => { const x = w.toLowerCase(), h = head.toLowerCase(); return x === h || x === `${h}s` || `${x}s` === h; };
  const countIsHead = countNoun.some(isHead);
  const PREPOSITION = /^(?:from|of|in|for|to|on|per|with|after|by)$/i;
  const inLabel = (w: string): boolean => labelWords.some(o => sameWord(o, w.toLowerCase()))
    || (countIsHead && countNoun.some(o => sameWord(o, w.toLowerCase())));
  const namesThisEnd = (run: readonly string[]): boolean => {
    // The head TOKEN itself must be in the run (a count noun's other words never stand in; buddy r4 P2).
    const headHit = run.some(isHead);
    const distinguishing = run.some(w => !otherWords.some(o => sameWord(o, w.toLowerCase())));
    return headHit && distinguishing;
  };
  // A COMPLETE phrase: the run ends where the noun phrase ends, at punctuation, the end, or a word that cannot continue a
  // noun phrase ("£3 of revenue tax" names a tax, not Revenue; buddy r4 HIGH). Unknown → no adoption → the end is asked.
  const ENDS_PHRASE = /^(?:would|will|could|should|might|may|can|costs?|costing|brings?|bringing|adds?|adding|raises?|lowers?|lifts?|cuts?|reduces?|increases?|decreases?|rises?|falls?|drops?|grows?|means?|gives?|makes?|knocks?|pushes?|is|are|was|were|be|and|but|so|then|each|every|per|a|an|which|that|to|in|on|at|by|from|with|over|this|next|for|if|when|as|or)$/i;
  const completeAfter = (text: string): boolean => {
    const m = /^(\s*)([\p{L}]+)/u.exec(text);
    return m === null || ENDS_PHRASE.test(m[2]!);
  };
  // …and on its left (backward): only a sentence start, punctuation, a determiner or a clause word may precede it.
  // ‘Would cut monthly cancellations by 40%’ still names the end beside its bare percent: U3 asks, never adopts it.
  const STARTS_PHRASE = /^(?:the|our|your|its|their|when|if|as|and|each|every|while|because|so|then|once|after|before|that|sees?|saw|makes?|keeps?|gets?|has|have|had|leaves?|puts?|sends?|drives?|watch(?:es)?|cuts?)$/i;
  // "per 12 months", "/ 3 years": a numbered period the unit grammar cannot carry → no adoption, so the end is ASKED
  // (buddy r3 P2), never silently stored without its period.
  const numberedPeriodAt = (from: number): boolean => /^\s*(?:per\s+|\/\s*)\d/i.test(quote.slice(from));
  const bounded = (from: number, to: number): string | undefined => {
    const clause = quote.slice(from, to).trimEnd();
    return clause.length >= 1 && clause.length <= 500 ? clause : undefined;
  };
  const PERIOD = /^(?:(?:\s+per\s+|\s*\/\s*)[\p{L}]+\b|\s+a\s+(?:month|week|year)\b)*/iu;
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
  // A run never ends on a preposition ("revenue per | 12 months"): drop it, so the period guard sees what follows.
  while (run.length > 0 && PREPOSITION.test(run[run.length - 1]!)) {
    const last = run.pop()!;
    named = tail.slice(0, tail.lastIndexOf(last, named)).trimEnd().length;
  }
  if (named > 0 && namesThisEnd(run) && completeAfter(rest.slice(at + named).replace(/^(?:(?:\s+per\s+|\s*\/\s*)[\p{L}]+\b)*/iu, ''))) {
    const after = at + named;
    const period = PERIOD.exec(rest.slice(after))![0];
    if (numberedPeriodAt(figureEnd + unitTail.length) || numberedPeriodAt(figureEnd + after + period.length)) return undefined;
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
  if (first < 0 || !namesThisEnd(back) || (k >= 0 && gapOk(k) && !STARTS_PHRASE.test(words[k]![0]))) return undefined;
  const suffix = UNIT_WORDS.exec(rest)![0];
  const period = PERIOD.exec(rest.slice(suffix.length))![0];
  if (numberedPeriodAt(figureEnd + suffix.length + period.length)) return undefined;
  return bounded(previousEnd + boundary + words[first]!.index!, figureEnd + suffix.length + period.length);
}

/** A selected link binds an unnamed currency end, while its literal amount and period remain the only unit warrant. */
function selectedCurrencyClause(quote: string, amount: StatedAmount): string | undefined {
  if (amount.kind !== 'currency') return undefined;
  const start = amount.index + amount.matchedText.length - amount.matchedText.trimStart().length;
  const end = amount.index + amount.matchedText.length;
  const tail = /^(?:(?:\s+per\s+|\s*\/\s*)[\p{L}]+\b|\s+a\s+(?:month|week|year)\b)*/iu.exec(quote.slice(end))![0];
  // A numbered denominator cannot be quietly omitted from the selected reading either.
  if (/^\s*(?:per\s+|\/\s*)\d/i.test(quote.slice(end + tail.length))) return undefined;
  const clause = quote.slice(start, end + tail.length).trimEnd();
  return clause.length >= 1 && clause.length <= 500 ? clause : undefined;
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
  // "5 points of X" never makes an end of unknown unit a % (Science F1: loyalty points); it is asked, not adopted.
  if (/^\s*(?:percentage\s+points?\b|pp\b)/i.test(tail)) return { unit: '%' };
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
  options?: { readonly link_selected?: boolean; readonly clarification?: LinkEffectClarificationReading },
): PreparedLinkEffectUnitReadings {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { unit_readings: [] };
  const nodes = graph.nodes.filter(isRec);
  const source = nodes.find(n => n.id === from); const target = nodes.find(n => n.id === to);
  if (source === undefined || target === undefined) return { unit_readings: [] };
  const edges = graph.edges.filter(isRec);
  const current = edges.find(e => e.from === from && e.to === to);
  const amounts = findLinkEffectAmounts(quote);
  const percentLevels = percentLevelIds(graph);
  // The writer's ONE frame authority (D2), so a % with no stored cap is read on the same pinned frame it is sized on
  // (Codex buddy r1 HIGH: an explicit-only read skipped U3 where the writer still sized the bare %).
  const view = magnitudeNodes(nodes, percentLevels);
  // ⭐ No-dead-end (C)/(B): a level-less mediator's derived unit is ESTABLISHED (the one reader), so this door never asks
  // "What unit…?" for it; as a source, a gauge reading adds nothing (M→child is never sized separately).
  const mediated = mediatorReadings(graph);
  const unit_readings: LinkEffectUnitReading[] = [];
  const points_at_zero: string[] = [];
  const asks: string[] = [];
  for (const [node, other, value, statedUnit] of [[source, target, effect.per_source_change, effect.per_source_change_unit],
    [target, source, effect.amount, effect.amount_unit]] as const) {
    const label = String(node.label ?? node.id);
    const reading = mediated.get(String(node.id));
    const ownNoun = labelHeadUnit(quote, value, label, String(other.label ?? other.id), node === source);
    const candidates = ownNoun !== undefined ? [{ clause: ownNoun.source_quote, unit: ownNoun.unit }] : amounts.flatMap((a, i) => {
      if (a.magnitude !== Math.abs(value)) return [];
      const clause = clauseOf(quote, amounts, i, node, other)
        ?? (options?.link_selected === true ? selectedCurrencyClause(quote, a) : undefined);
      return clause === undefined ? [] : [{ clause, ...literalUnit(a, clause, node) }];
    });
    const one: { clause: string; unit?: string; barePercent?: true } | undefined = candidates.length === 1 ? candidates[0] : undefined;
    const unit = one?.unit;
    // A gauge not yet written is a fallback for an unknown quantity. This end's own noun or explicitly stated unit
    // supplies its unit first; U1 still guards every stored unit/level/other size. Require literal evidence so an Agent
    // unit alone cannot supersede the gauge, and an already stored gauge remains established.
    // A structured percent LEVEL keeps its authority: only a percentage-point unit may supersede its gauge.
    const levelAllows = (u: string) => !percentLevels.has(String(node.id)) || levelUnitKey(u) === levelUnitKey('%');
    const ownBeforeGauge = reading?.via === 'gauge' && reading.stored !== true
      && ((ownNoun !== undefined && eligible(node, edges, from, to, ownNoun.unit) && levelAllows(ownNoun.unit))
        || (unit !== undefined && eligible(node, edges, from, to, unit) && levelAllows(unit)));
    const mediatedUnit = reading === undefined || (reading.via === 'gauge' && (node === source || ownBeforeGauge)) ? undefined : reading.unit;
    const magnitude = view.get(String(node.id));
    const frame = magnitude === undefined ? undefined : resolveMagnitudeFrame(magnitude);
    // The banked pause source has option levels 0/1 and no observed_state. The SAME sizer still types it as a switch.
    const switchUnit = node === source && magnitude !== undefined && sourceUnitWords(magnitude, frame) === 'switch'
      ? 'switch' : undefined;
    const establishedUnit = unitOf(node) ?? mediatedUnit ?? (current === undefined ? undefined : endpointUnit(current, String(node.id))) ?? switchUnit;
    const literalPercent = amounts.find(a => a.magnitude === Math.abs(value) && a.kind === 'percent');
    const sourceLevels = node === source
      ? linkEffectSourceLevels(quote, namesSourceOf({ source: String(source.label ?? source.id), target: String(target.label ?? target.id) })) : undefined;
    const explicitSourceLevels = sourceLevels !== undefined && Math.abs(sourceLevels.change) === Math.abs(value);
    if (establishedUnit !== undefined && literalPercent !== undefined && !explicitSourceLevels) {
      if ((unitOf(node) !== undefined || percentLevels.has(String(node.id)))
        // A bare % on a percent LEVEL is two readings whatever frame it is stored on (Codex r1 HIGH: a capless 0 resolves to
        // frame 1, and an explicit-100-only test skipped the question); the writer's own dry run decides what it can size.
        && (percentLevels.has(String(node.id)) || isPercentageLevelUnit(establishedUnit, 100))) {
        const level = usersLevelOf(node);
        // Science F1: 10% of 0 is 0, so at the user's own 0 the % can only be points: no question, and the card says
        // points for approval. Only a TYPED 0 settles it; Olumi's estimated 0 is read through the question like any level.
        if (level === 0) { points_at_zero.push(String(node.id)); continue; }
        // U3 (d5 (1)): "X% of {the level's own denominator}" is points in the user's own words: no question; the card says
        // points for approval and the writer stores the points reading, exactly as at a typed 0.
        if (percentOfOwnDenominator(quote, literalPercent, node, amounts)) { points_at_zero.push(String(node.id)); continue; }
        asks.push(pointsOrShareAsk(label, value, level, frame));
        continue;
      }
      if (readCurrencyUnitWithQualifiers(establishedUnit).kind === 'currency') {
        asks.push(`What ${establishedUnit} change in \u201c${label}\u201d do you mean by ${Math.abs(value)}%?`);
        continue;
      }
    }
    // Step 1's established size continues to govern; this door adopts units for UNSIZED ends only.
    if (establishedUnit !== undefined) continue;
    if (!eligible(node, edges, from, to, unit ?? statedUnit)) continue;
    if (one?.barePercent === true) {
      asks.push(pointsOrShareAsk(label, value, undefined, undefined));
    } else if (unit === undefined || unit.length > 40) {
      asks.push(`What unit is the ${Math.abs(value)} change in \u201c${label}\u201d stated in?`);
    } else {
      unit_readings.push({ node_id: String(node.id), unit_reading: { unit, source: 'user_stated', source_quote: one!.clause } });
    }
  }
  // A definite unit settles the reading only. It never makes an explicit lower/upper bound a point estimate.
  if (boundedLinkEffectText(quote) !== undefined && options?.clarification?.floor === undefined && asks.length === 0) {
    asks.push(`You said “${boundedLinkEffectText(quote)}”. What single change in “${String(target.label ?? target.id)}” do you mean, rather than a bound?`);
  }
  // One question even when both ends need clarification.
  return { unit_readings, ...(points_at_zero.length > 0 ? { points_at_zero } : {}), ...(asks.length > 0 ? { ask: asks.map((ask, i) => { const lead = i === 0 ? ask : ask[0]!.toLowerCase() + ask.slice(1); return i < asks.length - 1 ? lead.replace(/\?$/, ';') : lead; }).join(' ') } : {}) };
}
