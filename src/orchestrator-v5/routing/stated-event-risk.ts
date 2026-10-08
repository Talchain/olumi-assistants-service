/** event_risk.v1 slice 2a: deterministic user occurrence, held outside producer operations. */
import { z } from 'zod';
import { parseNumericValue } from '../../cee/extraction/numeric-parser.js';
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';
import { attestHorizon } from '../agent-lane/horizon-attestation.js';
import type { PatchOperation } from '../../orchestrator/types.js';

const SPACE = String.raw`[ \t]{0,8}`;
const GAP = String.raw`[ \t]{1,8}`;
const NUMBER = String.raw`[+-]?\d{1,6}(?:\.\d{1,6})?`;
const PERCENT = String.raw`(?:%|percent\b)`;
// "1 in N" is a likelihood only with its cue: "a 1 in 5 chance" / "1 in 5 odds", or "probability (of) 1 in 5" closing
// the clause. Without a cue, "version 1 in 5 days" or a denominator with a size word after it are not occurrence statements (Codex r2).
const ODDS = String.raw`(?:1|one)${GAP}in${GAP}\d{1,12}(?!\d|[.,]\d)`;
const ONE_IN = String.raw`${ODDS}${GAP}(?:chance|odds)\b|(?:chance|odds|probability|likelihood)${GAP}(?:(?:of|is)${GAP})?(?:about${GAP})?${ODDS}(?=${SPACE}(?:[.,;:!?)]|$|(?:within|in|over|during|and)\b(?!${SPACE}\d)))`;
const PROBABILITY = new RegExp(
  String.raw`(?<![\w.,+\-])(?:${ONE_IN}|between${GAP}${NUMBER}${SPACE}(?:${PERCENT}${SPACE})?and${GAP}${NUMBER}${SPACE}${PERCENT}|${NUMBER}${SPACE}(?:${PERCENT}${SPACE})?(?:[-–]|${GAP}to${GAP})${SPACE}${NUMBER}${SPACE}${PERCENT}|(?:about${GAP})?${NUMBER}${SPACE}${PERCENT})`, 'gi',
);
const HORIZON = new RegExp(
  String.raw`\b(?:within|in|over|during)${GAP}(?:(?:the${GAP})?(?:next|coming|following)${GAP})?(\d{1,6}(?:\.\d{1,6})?|a|an|one)?${SPACE}(months?|years?|weeks?)\b`, 'gi',
);

const IMPACT_BY = /\bby[ \t]{1,8}(?:(?:about|around|roughly|approximately|at least|at most|up to|more than|less than)[ \t]{1,8})?$/i;
const IMPACT_AFTER = /^[ \t]{0,8}(?:(?:ARR|MRR|revenue|sales|cost|price|monthly|annual)[ \t]{1,8})?(?:drops?|falls?|declines?|cuts?|reductions?|increases?|rises?|loss(?:es)?|hits?|growth|lower|higher|more|less|fewer|churn|conversion|margin|adoption|of[ \t]{1,8}(?:ARR|MRR|revenue|sales|costs?|profit|customers?|investment|budget))\b/i;
const IMPACT_VERB = /\b(?:cuts?|cutting|costs?|costing|reduce[ds]?|reducing|lowers?|lowered|lowering|raises?|raised|raising|increase[ds]?|increasing|drops?|dropped|dropping|falls?|fell|falling|lose[st]?|lost|losing|shrinks?|shrank|shrinking|grows?|grew|growing|decrease[ds]?|decreasing)\b[^%,;.!?\r\n]{0,120}$/i;
const MODIFIER = String.raw`(?:about|around|roughly|a|an)${GAP}`;
const LIKELIHOOD_WORD = String.raw`(?:chances?|likely|probable|probability|likelihood|odds|risk)`;
const HORIZON_HEAD = String.raw`(?:within|in|over|during)${GAP}(?:(?:the${GAP})?(?:next|coming|following)${GAP})?(?:\d{1,6}(?:\.\d{1,6})?|a|an|one)?${SPACE}(?:months?|years?|weeks?)\b`;
const TAIL_WORD = String.raw`(?:$|[,;:.!?)]|${HORIZON_HEAD}|(?:of${GAP}(?:it|this|that|happening)|that|it|this|and|or|if|before|by|for|the${GAP}(?:next|coming))\b)`;
// Every percent needs a supported right-hand attachment; an unknown noun is not a likelihood.
const FIGURE_TAIL = new RegExp(String.raw`^${SPACE}(?:${TAIL_WORD}|(?:${MODIFIER}){0,3}${LIKELIHOOD_WORD}\b(?![-–—])${SPACE}(?:${TAIL_WORD}|(?:the|a|an|we|they|he|she|it|our|to|in|on|of|for)\b))`, 'i');
// DL ruling 8 Oct: explicit likelihood words only; a hedge or an estimate never supplies the cue.
const DIRECT_LIKELIHOOD_AFTER = new RegExp(String.raw`^${SPACE}(?:${MODIFIER}){0,3}(?:chances?|likely|probability|likelihood|odds|risk${GAP}(?:of|that))\b(?![-–—])`, 'i');
const DIRECT_LIKELIHOOD_BEFORE = new RegExp(String.raw`\b(?:chances?|probability|likelihood|odds)(?:${GAP}(?:of|is|are|at)${GAP}|${SPACE}[=:]${SPACE})(?:${MODIFIER}){0,3}$`, 'i');
const WITH_PROBABILITY_BEFORE = new RegExp(String.raw`\bwith${GAP}(?:a${GAP})?probability${GAP}(?:of${GAP})?(?:${MODIFIER}){0,3}$`, 'i');
// Not "risk": "the risk of churn is 7%" states a churn RATE, not a likelihood ("N% risk of/that" stays direct).
const EVENT_LIKELIHOOD_BEFORE = new RegExp(String.raw`\b(?:chances?|probability|likelihood|odds)${GAP}(of|that)${GAP}([^,;.!?\r\n]{1,60})$`, 'i');
// After an event, trailing "of N%" is an amount; "odds of N%" uses the direct noun bridge above.
const EVENT_BRIDGE = new RegExp(String.raw`(?:\b(?:is|are|at)${GAP}|[=:]${SPACE})(?:${MODIFIER}){0,3}$`, 'i');
// A "that" complement must describe a supported predicate before its numeric bridge.
// Nominal "of an outage is N%" and label-style ": / = N%" remain supported.
const EVENT_PREDICATE = /\b(?:may|might|could|will|would|can|should|must|does?|did|has|have|had|is|are|was|were|be|been|being|fails?|failed|failing|leaves?|left|leaving|slips?|slipped|slipping|loses?|lost|losing|happens?|happened|happening|occurs?|occurred|occurring|cuts?|falls?|fell|drops?|dropped|rises?|rose|increases?|increased|decreases?|decreased)\b/i;
// A governing change verb denotes a delta, even with an adjacent likelihood noun.
// "with" / conjunctions break that attachment: "cut its prices with probability N%" is a likelihood.
const LIKELIHOOD_DELTA = new RegExp(String.raw`\b(?:raises?|raised|raising|increases?|increased|increasing|cuts?|reduces?|reduced|reducing|lowers?|lowered|lowering|doubles?|halves?)${GAP}(?:(?!(?:with|and|or|but)\b)[\p{L}\p{N}_'’\-]{1,30}${GAP}){0,3}(?:chances?|risk|odds|probability|likelihood)${GAP}(?:(?:of|that|is|at)${GAP}|=${SPACE}|${MODIFIER}){0,4}$`, 'iu');
const ALTERNATIVE_BEFORE = new RegExp(String.raw`\bor${GAP}(?:${MODIFIER}){0,3}$`, 'i');
const ALTERNATIVE_AFTER = new RegExp(String.raw`^${SPACE}or\b`, 'i');

type Span = { start: number; end: number };
type Clause = Span & { fragments: Span[] };
type ProbabilityCandidate = { match: RegExpMatchArray; likelihood: boolean; clause: Clause; binding: Span };

function isDecimalPoint(text: string, i: number): boolean {
  return text[i] === '.' && /\d/.test(text[i + 1] ?? '')
    && (i === 0 || /[\d \t+\-−]/.test(text[i - 1] ?? ''));
}

/** Only the two dots in "e.g." / "i.e." are exempt; lone initials and "etc." / "vs." end clauses. */
function isAbbreviationPoint(text: string, i: number): boolean {
  if (text[i] !== '.') return false;
  const before = text.slice(Math.max(0, i - 8), i);
  return /\b(?:e\.g|i\.e)$/i.test(before)
    || (/\be$/i.test(before) && /^g\./i.test(text.slice(i + 1, i + 3)))
    || (/\bi$/i.test(before) && /^e\./i.test(text.slice(i + 1, i + 3)));
}

/** Window clauses and their comma fragments, once per input. Decimal points stay in their numeric token. */
function likelihoodClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  let start = 0;
  let fragmentStart = 0;
  let fragments: Span[] = [];
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    if (ch === ',') {
      fragments.push({ start: fragmentStart, end: i });
      fragmentStart = i + 1;
      continue;
    }
    if (i !== text.length && (ch === undefined || !';.!?\r\n'.includes(ch) || isDecimalPoint(text, i) || isAbbreviationPoint(text, i))) continue;
    fragments.push({ start: fragmentStart, end: i });
    clauses.push({ start, end: i, fragments });
    start = i + 1;
    fragmentStart = start;
    fragments = [];
  }
  return clauses;
}

/** Draft and card share the same decimal/abbreviation/clause boundary rules. */
export function splitStatedLikelihoodClauses(text: string): string[] {
  return likelihoodClauses(text).map((clause) => text.slice(clause.start, clause.end));
}

/** Quotation scopes only: every written percent or unitless probability, never an admission authority. */
export function splitEventRiskFigureSpans(text: string): Array<{ span: string; clause_text: string }> {
  const figure = /(?<![\p{L}\p{N}.,+\-−])[+\-−]?(?:\d+(?:\.\d+)?[ \t]{0,8}(?:%|percent\b)|(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)(?![\p{L}\p{N}.%]))/giu;
  const spans: Array<{ span: string; clause_text: string }> = [];
  for (const clause of likelihoodClauses(text)) {
    const clauseText = text.slice(clause.start, clause.end);
    const horizons = [...clauseText.matchAll(HORIZON)];
    for (const match of clauseText.matchAll(figure)) {
      // A horizon's "1 month" is a duration, not a unitless probability.
      if (!/%|percent\b/i.test(match[0]) && horizons.some(h => match.index! >= h.index!
        && match.index! < h.index! + h[0].length)) continue;
      const absolute = match;
      absolute.index = clause.start + match.index!;
      const fragmentIndex = clause.fragments.findIndex(f => absolute.index! >= f.start && absolute.index! <= f.end);
      const fragment = clause.fragments[fragmentIndex]!;
      const start = isStandaloneLikelihoodFragment(text, fragment, absolute)
        ? clause.fragments[Math.max(0, fragmentIndex - 1)]!.start : fragment.start;
      spans.push({ span: text.slice(start, fragment.end), clause_text: clauseText });
    }
  }
  return spans;
}

const SCAFFOLD_TOKEN = /[ \t,:]{1,24}|[a-z]{1,30}(?:['’][ds])?/iy;
const SCAFFOLD_WORDS = new Set(['and', 'then', 'there', 'is', 'a', 'an', 'about', 'around', 'roughly',
  'maybe', 'perhaps', 'possibly', 'probably', 'chance', 'chances', 'likely', 'probable', 'probability',
  'likelihood', 'odds', 'risk', 'that', 'of', 'it', 'this', 'happen', 'happens', 'may', 'might', 'could',
  "i'd", 'i’d', "there's", 'there’s', "it's", 'it’s', "that's", 'that’s',
  'i', 'would', 'put', 'at', 'say', 'reckon', 'estimate', 'guess']);

/** Borrow preceding comma context only for a figure fragment with no event description. */
function isStandaloneLikelihoodFragment(text: string, fragment: Span, match: RegExpMatchArray): boolean {
  // Keep the per-candidate work bounded, even when thousands of figures share a long fragment.
  if (fragment.end - fragment.start > 320) return false;
  const residual = (text.slice(fragment.start, match.index!)
    + text.slice(match.index! + match[0].length, fragment.end)).replace(HORIZON, '');
  let cursor = 0;
  let wordCount = 0;
  // Disjoint token classes and a sticky cursor avoid backtracking through repeated scaffolding.
  while (cursor < residual.length) {
    SCAFFOLD_TOKEN.lastIndex = cursor;
    const token = SCAFFOLD_TOKEN.exec(residual);
    if (token === null) return false;
    if (/^[a-z]/i.test(token[0]) && (!SCAFFOLD_WORDS.has(token[0].toLowerCase()) || ++wordCount > 24)) return false;
    cursor = SCAFFOLD_TOKEN.lastIndex;
  }
  return true;
}

/**
 * A figure needs a directly attached allowlisted likelihood form. Impact attachment vetoes still win.
 * Checks are bounded to 160 characters; clause and comma-fragment traversal is monotone.
 * An explicit uncued alternative ("1 in 5 chance or 30%") remains ambiguous, not a second likelihood.
 */
function statedProbabilityCandidates(userText: string): ProbabilityCandidate[] {
  const matches = [...userText.matchAll(PROBABILITY)];
  if (matches.length === 0) return [];
  const clauses = likelihoodClauses(userText);
  const candidates: ProbabilityCandidate[] = [];
  let clauseIndex = 0;
  let fragmentIndex = 0;
  for (const match of matches) {
    const index = match.index!;
    while (clauseIndex < clauses.length - 1 && index > clauses[clauseIndex]!.end) {
      clauseIndex += 1;
      fragmentIndex = 0;
    }
    const clause = clauses[clauseIndex]!;
    while (fragmentIndex < clause.fragments.length - 1 && index > clause.fragments[fragmentIndex]!.end) fragmentIndex += 1;
    const fragment = clause.fragments[fragmentIndex]!;
    // Unknown event words keep the binding in this fragment, even if only the previous event is in the graph.
    const binding = { start: isStandaloneLikelihoodFragment(userText, fragment, match)
      ? clause.fragments[Math.max(0, fragmentIndex - 1)]!.start : fragment.start, end: fragment.end };
    if (!/%|percent\b/i.test(match[0])) {
      candidates.push({ match, likelihood: true, clause, binding }); // The existing one-in matcher requires its own cue.
      continue;
    }
    const before = userText.slice(Math.max(clause.start, index - 160), index);
    const after = userText.slice(index + match[0].length, Math.min(clause.end, index + match[0].length + 160));
    const directWord = DIRECT_LIKELIHOOD_AFTER.test(after) || DIRECT_LIKELIHOOD_BEFORE.test(before)
      || WITH_PROBABILITY_BEFORE.test(before);
    // A bare noun in "that churn is N%" is a rate.
    const event = EVENT_LIKELIHOOD_BEFORE.exec(before);
    const bridge = event === null ? null : EVENT_BRIDGE.exec(event[2]!);
    if (event?.[1]?.toLowerCase() === 'that' && bridge !== null
      && !EVENT_PREDICATE.test(event[2]!.slice(0, bridge.index))) continue;
    const eventWord = event !== null && bridge !== null;
    const directLikelihood = directWord || eventWord;
    // "probability of losing a customer is 30%" describes an event; "risk of losing 10%" describes its impact.
    const eventVerbIsLikelihood = directWord || eventWord;
    if (IMPACT_BY.test(before) || IMPACT_AFTER.test(after) || LIKELIHOOD_DELTA.test(before)
      || (!eventVerbIsLikelihood && IMPACT_VERB.test(before))) continue;
    if (!FIGURE_TAIL.test(after)) continue;
    if (!directLikelihood && !ALTERNATIVE_BEFORE.test(before) && !ALTERNATIVE_AFTER.test(after)) continue;
    candidates.push({ match, likelihood: directLikelihood, clause, binding });
  }
  return candidates;
}

function statedProbability(userText: string): ProbabilityCandidate | undefined {
  const candidates = statedProbabilityCandidates(userText);
  return candidates.length === 1 && candidates[0]!.likelihood ? candidates[0] : undefined;
}

/** A likelihood (one probability, a likelihood word, not an impact "by 20%") stated without a time window. */
export function readStatedLikelihoodWithoutWindow(userText: string): boolean {
  if (typeof userText !== 'string') return false;
  return statedProbability(userText) !== undefined && [...userText.matchAll(HORIZON)].length === 0;
}

type LabelTrie = { children: Map<string, LabelTrie>; word?: string };
const WORD_RUN = /[\p{L}\p{N}_]+/gu;

/**
 * Did the user's own words name this factor? Label and user text are split into the SAME word runs (letters, digits,
 * underscore). Every label word of 3+ characters must start a user word ("price" names "prices"); a label made only of
 * shorter words ("AI") needs each as a whole user word. Each user word walks one trie of label words: linear in the text.
 */
export function isFactorNamedByUser(label: string, userText: string): boolean {
  if (typeof label !== 'string' || typeof userText !== 'string') return false;
  const labelWords = [...new Set(label.toLowerCase().match(WORD_RUN) ?? [])];
  const long = labelWords.filter((w) => w.length >= 3);
  const missing = new Set(long.length > 0 ? long : labelWords);
  if (missing.size === 0) return false;
  const exact = long.length === 0;
  const root: LabelTrie = { children: new Map() };
  for (const word of missing) {
    let node = root;
    for (const ch of word) {
      let child = node.children.get(ch);
      if (child === undefined) { child = { children: new Map() }; node.children.set(ch, child); }
      node = child;
    }
    node.word = word;
  }
  for (const [word] of userText.toLowerCase().matchAll(WORD_RUN)) {
    let node: LabelTrie | undefined = root;
    let i = 0;
    for (const ch of word) {
      node = node.children.get(ch);
      i += ch.length;
      if (node === undefined) break;
      if (node.word !== undefined && (!exact || i === word.length)) missing.delete(node.word);
    }
    if (missing.size === 0) return true;
  }
  return false;
}

/** Reader metadata for draft name binding; never serialize this span into a held occurrence member. */
export function readStatedEventRiskWithBindingSpan(userText: string): { event_risk: EventRiskV1T; quote: string; binding_span: string; clause_text: string } | undefined {
  if (typeof userText !== 'string') return undefined;
  const candidate = statedProbability(userText);
  // A bare "in year" from "cost in year one" was never a supported window; it must not hide a real window.
  const horizons = [...userText.matchAll(HORIZON)].filter((h) => h[1] !== undefined || /\b(?:next|coming|following)\b/i.test(h[0]));
  if (candidate === undefined || horizons.length !== 1) return undefined;
  const probability = candidate.match;
  const horizon = horizons[0]!;
  // One span cannot be both the likelihood and the window ("1 in 5 months").
  if (probability.index! < horizon.index! + horizon[0].length && horizon.index! < probability.index! + probability[0].length) return undefined;
  // The window belongs to the likelihood's clause. Preserve only the existing explicit "It may happen" continuation.
  const probabilityFirst = probability.index! < horizon.index!;
  const gap = probabilityFirst ? userText.slice(probability.index! + probability[0].length, horizon.index!)
    : userText.slice(horizon.index! + horizon[0].length, probability.index!);
  const sameClause = horizon.index! >= candidate.clause.start && horizon.index! + horizon[0].length <= candidate.clause.end;
  if (!sameClause && !(probabilityFirst
    && /^[ \t]{0,8}[.!?][ \t]{0,8}it[ \t]{1,8}(?:may|might|could)[ \t]{1,8}happen[ \t]{0,8}$/i.test(gap))) return undefined;
  let pLow: number;
  let pHigh: number;
  if (!/%|percent\b/i.test(probability[0])) {
    // Odds: the cue is in the match; refuse an amount ("£1 in 5") and any denominator outside 2..1000.
    const odds = /(?:1|one)[ \t]{1,8}in[ \t]{1,8}(\d{1,12})/i.exec(probability[0]);
    const before = userText.slice(Math.max(0, probability.index! - 1), probability.index!);
    if (odds === null || /\p{Sc}/u.test(before)) return undefined;
    const denominator = Number(odds[1]);
    if (denominator < 2 || denominator > 1000) return undefined;
    pLow = pHigh = Math.round(10000 / denominator) / 10000;
  } else {
    // A bounded token reaches the existing numeric parser; never scan the whole hostile input there.
    // The shared range parser reads unsigned bounds; refuse signed negative endpoints before it.
    if (/^(?:(?:between|about)[ \t]{1,8})?-|(?:[-–]|\b(?:to|and))[ \t]{0,8}-/.test(probability[0])) return undefined;
    const number = parseNumericValue(probability[0].replace(/percent\b/gi, '%'));
    if (number === null || number.unit !== 'percent') return undefined;
    const low = number.rangeMin ?? number.value;
    const high = number.rangeMax ?? number.value;
    if (low < 0 || high > 100 || low > high) return undefined;
    pLow = low / 100;
    pHigh = high / 100;
  }
  if (horizon[1] === undefined && !/\b(?:next|coming|following)\b/i.test(horizon[0])) return undefined;
  const count = horizon[1] === undefined || ['a', 'an', 'one'].includes(horizon[1].toLowerCase()) ? 1 : Number(horizon[1]);
  if (count <= 0) return undefined;
  const unit = horizon[2]!.toLowerCase();
  const months = unit.startsWith('week') ? Math.max(0.1, Math.round(count / 4.345 * 10) / 10)
    : count * (unit.startsWith('year') ? 12 : 1);
  // Reuse the goal's attestation on the bounded original span for supported whole-month durations.
  if (!unit.startsWith('week') && Number.isInteger(count)
    && attestHorizon(horizon[0], { horizon_months: months }).status !== 'attested') return undefined;
  const parsed = EventRiskV1.safeParse({ version: 1,
    occurrence: { p_low: pLow, p_high: pHigh, basis: 'user', meaning: 'at_least_once_within_horizon' },
    horizon: { months: Math.max(0.1, months) },
  });
  if (!parsed.success) return undefined;
  const start = Math.min(probability.index!, horizon.index!);
  const end = Math.max(probability.index! + probability[0].length, horizon.index! + horizon[0].length);
  return { event_risk: parsed.data, quote: userText.slice(start, end), binding_span: userText.slice(candidate.binding.start, candidate.binding.end),
    clause_text: userText.slice(candidate.clause.start, candidate.clause.end) };
}

/** Keep the occurrence/quote wire shape unchanged for held-card and approval consumers. */
export function readStatedEventRisk(userText: string): { event_risk: EventRiskV1T; quote: string } | undefined {
  const stated = readStatedEventRiskWithBindingSpan(userText);
  return stated === undefined ? undefined : { event_risk: stated.event_risk, quote: stated.quote };
}

export const GM_HELD_USER_EVENT_RISK_KEY = 'user_event_risk';
const UserEventRiskMember = z.object({ risk_id: z.string().min(1), event_risk: EventRiskV1, quote: z.string().min(1).refine((quote) => quote.trim() !== '') }).strict()
  .refine((m) => m.event_risk.occurrence.basis === 'user' && m.event_risk.occurrence.meaning === 'at_least_once_within_horizon' && m.event_risk.mitigations === undefined);
export type UserEventRisk = z.infer<typeof UserEventRiskMember>;
export function readUserEventRiskMember(raw: unknown): UserEventRisk | undefined {
  const parsed = UserEventRiskMember.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Fail closed by identity; stamp only after the re-referee, in the same atomic apply. */
export function stampUserEventRisk(operations: PatchOperation[], raw: unknown, graph: unknown): PatchOperation[] | undefined {
  if (raw === undefined) return operations;
  const member = readUserEventRiskMember(raw);
  if (member === undefined) return undefined;
  const { risk_id: id, event_risk } = member;
  const adds = operations.filter((o) => o.op === 'add_node' && o.path === id);
  const node = adds[0]?.value as Record<string, unknown> | undefined;
  const existing = graph as { nodes?: { id?: string }[]; edges?: { to?: string }[] };
  if (adds.length !== 1 || node?.id !== id || node.kind !== 'risk' || node.event_risk !== undefined
    || existing.nodes?.some((n) => n.id === id) || existing.edges?.some((e) => e.to === id)
    || operations.some((o) => o.op === 'add_edge' && (o.value as Record<string, unknown>)?.to === id)) return undefined;
  return operations.map((o) => {
    if (o === adds[0]) return { ...o, value: { ...node, event_risk } };
    if (o.op !== 'add_edge' || (o.value as Record<string, unknown>)?.from !== id) return o;
    // Science Q7: an event's stated impact is not a doubted mechanism, so existence is 1.0. The SIZE is still
    // Olumi's placeholder, so `defaulted: true` ("default strength was applied", EdgeV3) and its provenance stay:
    // the placeholder-parts and link-sizing readers must keep treating the impact as unsized.
    return { ...o, value: { ...(o.value as Record<string, unknown>), exists_probability: 1 } };
  });
}
