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

const LIKELIHOOD_CUE = /\b(?:chances?|likely|likelihood|probabl[ey]|probability|odds|maybe|perhaps|possibly|i(?:['’]d| would)[ \t]{1,8}put[ \t]{1,8}it[ \t]{1,8}at)\b/i;
const IMPACT_BY = /\bby[ \t]{1,8}(?:(?:about|around|roughly|approximately|at least|at most|up to|more than|less than)[ \t]{1,8})?$/i;
const IMPACT_AFTER = /^[ \t]{0,8}(?:(?:ARR|MRR|revenue|sales|cost|price|monthly|annual)[ \t]{1,8})?(?:drops?|falls?|declines?|cuts?|reductions?|increases?|rises?|loss(?:es)?|hits?|growth|lower|higher|more|less|fewer|churn|conversion|margin|adoption|of[ \t]{1,8}(?:ARR|MRR|revenue|sales|costs?|profit|customers?|investment|budget))\b/i;
const IMPACT_VERB = /\b(?:cuts?|cutting|reduce[ds]?|reducing|lowers?|lowered|lowering|raises?|raised|raising|increase[ds]?|increasing|drops?|dropped|dropping|falls?|fell|falling|lose[st]?|lost|losing|shrinks?|shrank|shrinking|grows?|grew|growing|decrease[ds]?|decreasing)\b[^%,;.!?\n]{0,120}$/i;
const DIRECT_LIKELIHOOD_AFTER = /^[ \t]{0,8}(?:chances?|probability|likelihood|odds|risk[ \t]{1,8}of)\b/i;
const DIRECT_LIKELIHOOD_BEFORE = /\b(?:chances?|probability|likelihood|odds)[ \t]{1,8}(?:(?:of|is|at|about)[ \t]{1,8}){0,2}$/i;
const BARE_EVENT = /\b(?:might|could)[ \t]{1,8}happen[ \t]{0,8}$/i;

type ProbabilityCandidate = { match: RegExpMatchArray; likelihood: boolean };
type Fragment = { start: number; end: number; likelihood: boolean };

function isDecimalPoint(text: string, i: number): boolean {
  return text[i] === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
}

/** Comma/sentence fragments, once per input. Decimal points stay in their numeric token. */
function likelihoodFragments(text: string): Fragment[] {
  const fragments: Fragment[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    const decimal = isDecimalPoint(text, i);
    if (i !== text.length && (ch === undefined || !',.;!?\n'.includes(ch) || decimal)) continue;
    fragments.push({ start, end: i, likelihood: LIKELIHOOD_CUE.test(text.slice(start, i)) });
    start = i + 1;
  }
  return fragments;
}

/**
 * Impact attachment wins over a cue. Bound each attachment check to 160 characters, and compute clause cues
 * once: repeated "by 10% " in one long clause must not repeatedly scan the rest of the input.
 * Keep uncued, non-impact figures until uniqueness is checked: "1 in 5 chance or 30%" is still ambiguous.
 */
function statedProbabilityCandidates(userText: string): ProbabilityCandidate[] {
  const matches = [...userText.matchAll(PROBABILITY)];
  if (matches.length === 0) return [];
  const fragments = likelihoodFragments(userText);
  const candidates: ProbabilityCandidate[] = [];
  let fragmentIndex = 0;
  for (const match of matches) {
    const index = match.index!;
    while (fragmentIndex < fragments.length - 1 && index > fragments[fragmentIndex]!.end) fragmentIndex += 1;
    const fragment = fragments[fragmentIndex]!;
    if (!/%|percent\b/i.test(match[0])) {
      candidates.push({ match, likelihood: true }); // The existing one-in matcher requires its own cue.
      continue;
    }
    const before = userText.slice(Math.max(fragment.start, index - 160), index);
    const after = userText.slice(index + match[0].length, Math.min(fragment.end, index + match[0].length + 160));
    const directLikelihood = DIRECT_LIKELIHOOD_AFTER.test(after) || DIRECT_LIKELIHOOD_BEFORE.test(before);
    if (IMPACT_BY.test(before) || IMPACT_AFTER.test(after) || (!directLikelihood && IMPACT_VERB.test(before))) continue;
    const previous = fragments[fragmentIndex - 1];
    const bareEvent = previous !== undefined && userText[previous.end] === ','
      && before.trim() === '' && BARE_EVENT.test(userText.slice(Math.max(previous.start, previous.end - 160), previous.end));
    candidates.push({ match, likelihood: fragment.likelihood || bareEvent || directLikelihood });
  }
  return candidates;
}

function statedProbabilities(userText: string): RegExpMatchArray[] {
  const candidates = statedProbabilityCandidates(userText);
  return candidates.length === 1 && candidates[0]!.likelihood ? [candidates[0]!.match] : [];
}

/** A likelihood (one probability, a likelihood word, not an impact "by 20%") stated without a time window. */
export function readStatedLikelihoodWithoutWindow(userText: string): boolean {
  if (typeof userText !== 'string') return false;
  return statedProbabilities(userText).length === 1 && [...userText.matchAll(HORIZON)].length === 0;
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

export function readStatedEventRisk(userText: string): { event_risk: EventRiskV1T; quote: string } | undefined {
  if (typeof userText !== 'string') return undefined;
  const probabilities = statedProbabilities(userText);
  // A bare "in year" from "cost in year one" was never a supported window; it must not hide a real window.
  const horizons = [...userText.matchAll(HORIZON)].filter((h) => h[1] !== undefined || /\b(?:next|coming|following)\b/i.test(h[0]));
  if (probabilities.length !== 1 || horizons.length !== 1) return undefined;
  const probability = probabilities[0]!;
  const horizon = horizons[0]!;
  // One span cannot be both the likelihood and the window ("1 in 5 months").
  if (probability.index! < horizon.index! + horizon[0].length && horizon.index! < probability.index! + probability[0].length) return undefined;
  // Do not attach a separate goal's window to a newly disambiguated likelihood. A following "It may happen"
  // sentence is the existing explicit continuation; otherwise occurrence and window must share a sentence.
  const probabilityFirst = probability.index! < horizon.index!;
  const gap = probabilityFirst ? userText.slice(probability.index! + probability[0].length, horizon.index!)
    : userText.slice(horizon.index! + horizon[0].length, probability.index!);
  const sentenceBoundary = [...gap.matchAll(/[.!?\n]/g)].some((m) => !isDecimalPoint(gap, m.index!));
  if (sentenceBoundary && !(probabilityFirst
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
  return { event_risk: parsed.data, quote: userText.slice(start, end) };
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
