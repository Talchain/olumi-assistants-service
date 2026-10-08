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
// "10% chance-free drop" is not a cue (Codex #2828 r2): the word must not run on into a hyphen.
const DIRECT_LIKELIHOOD_AFTER = new RegExp(String.raw`^${SPACE}(?:${MODIFIER}){0,3}${LIKELIHOOD_WORD}\b(?!-)`, 'i');
const DIRECT_LIKELIHOOD_BEFORE = new RegExp(String.raw`\b(?:chances?|probability|likelihood|odds|risk)${GAP}(?:(?:of|that|is|at)${GAP}|=${SPACE}|${MODIFIER}){0,4}$`, 'i');
// Not "risk": "the risk of churn is 7%" states a churn RATE, not a likelihood (base refused it; "N% risk" stays direct).
const EVENT_LIKELIHOOD_BEFORE = new RegExp(String.raw`\b(?:chances?|probability|likelihood|odds)${GAP}(?:of|that)${GAP}[^,;.!?\r\n]{1,60}$`, 'i');
const LIKELIHOOD_BRIDGE = new RegExp(String.raw`(?:\b(?:is|at|of)${GAP}|=${SPACE})(?:${MODIFIER}){0,3}$`, 'i');
const HEDGE_BEFORE = new RegExp(String.raw`\b(?:maybe|perhaps|possibly|probably)${GAP}(?:${MODIFIER}){0,3}$`, 'i');
const ESTIMATE_BEFORE = new RegExp(String.raw`\bi(?:(?:['’]d|${GAP}would)${GAP}(?:put${GAP}it${GAP}at|say)|${GAP}(?:reckon|estimate|guess))${GAP}(?:${MODIFIER}){0,3}$`, 'i');
// "It may happen 10–30% in the next 6 months" (the card's own words) and "<event> might happen, N%".
const BARE_EVENT = new RegExp(String.raw`\b(?:may|might|could)${GAP}happen${SPACE}[,:]?${SPACE}(?:(?:about|around|roughly)${GAP})?$`, 'i');
// The happen form's figure must be followed directly by its window: "It may happen: 10% of our customers cancel" is a share.
const WINDOW_NEXT = new RegExp(String.raw`^${SPACE}(?:within|in|over|during)\b`, 'i');
const ALTERNATIVE_BEFORE = new RegExp(String.raw`\bor${GAP}(?:${MODIFIER}){0,3}$`, 'i');
const ALTERNATIVE_AFTER = new RegExp(String.raw`^${SPACE}or\b`, 'i');

type Span = { start: number; end: number };
type Clause = Span & { fragments: Span[] };
type ProbabilityCandidate = { match: RegExpMatchArray; likelihood: boolean; clause: Clause; binding: Span };

function isDecimalPoint(text: string, i: number): boolean {
  return text[i] === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
}

/** "e.g.", "i.e.", "etc.", "vs.", "approx." and "incl." are not clause boundaries (Codex #2828 r2). */
function isAbbreviationPoint(text: string, i: number): boolean {
  return text[i] === '.' && /(?:\b(?:e\.g|e|i\.e|i|etc|vs|approx|incl)|\b[a-z]\.[a-z])$/i.test(text.slice(Math.max(0, i - 8), i));
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
    // Names may be in this fragment or the immediately preceding comma fragment, never across a hard boundary.
    const binding = { start: clause.fragments[Math.max(0, fragmentIndex - 1)]!.start, end: fragment.end };
    if (!/%|percent\b/i.test(match[0])) {
      candidates.push({ match, likelihood: true, clause, binding }); // The existing one-in matcher requires its own cue.
      continue;
    }
    const before = userText.slice(Math.max(clause.start, index - 160), index);
    const after = userText.slice(index + match[0].length, Math.min(clause.end, index + match[0].length + 160));
    const directWord = DIRECT_LIKELIHOOD_AFTER.test(after) || DIRECT_LIKELIHOOD_BEFORE.test(before);
    // "a chance that MRR will be down 10%" names an event, then an amount: the event form needs "is/at/of N%" (Codex #2828 r2).
    const eventWord = EVENT_LIKELIHOOD_BEFORE.test(before) && LIKELIHOOD_BRIDGE.test(before);
    const directLikelihood = directWord || eventWord || HEDGE_BEFORE.test(before) || ESTIMATE_BEFORE.test(before);
    // "probability of losing a customer is 30%" describes an event; "risk of losing 10%" describes its impact.
    const eventVerbIsLikelihood = directWord || (eventWord && LIKELIHOOD_BRIDGE.test(before));
    if (IMPACT_BY.test(before) || IMPACT_AFTER.test(after) || (!eventVerbIsLikelihood && IMPACT_VERB.test(before))) continue;
    const bareEvent = BARE_EVENT.test(before) && WINDOW_NEXT.test(after);
    if (!directLikelihood && !bareEvent && !ALTERNATIVE_BEFORE.test(before) && !ALTERNATIVE_AFTER.test(after)) continue;
    candidates.push({ match, likelihood: directLikelihood || bareEvent, clause, binding });
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
