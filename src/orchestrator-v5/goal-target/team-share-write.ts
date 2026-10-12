/** S2b's one team-time writer, called only by the atomic batch door. TIME is sampled as stated. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { draftedTeamPartOf, eventShareCarrierOf } from './event-by-date-model.js';
import { goalDeadlineFromRecord, isShareCalendarDate } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { cappedTeamShareMean, teamShareMoments } from './event-by-date-share.js';
import { displayedPctAt } from './goal-chance-driver.js';
import { quoteSpansIn } from '../agent-lane/stated-by-user.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';

type Rec = Record<string, any>;
/** A complete duration clause, with bounded conversational framing and unit conversion. */
const TIME_NUMBER = '(?:[0-9]{1,3}(?:\\.[0-9]{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|a|an)';
export const TEAM_TIME = new RegExp(`^(?:probably[ \\t]{1,4}|(?:we|I)[ \\t]{1,4}(?:think|expect|estimate)[ \\t]{1,4}|(?:it(?:['’](?:ll|d)|[ \\t]{1,4}(?:will|would|could|should))|the[ \\t]{1,4}(?:current[ \\t]{1,4})?team)[ \\t]{1,4}(?:take|takes|need|needs)[ \\t]{1,4}|it[ \\t]{1,4}takes[ \\t]{1,4})?(?:(?:about|around|roughly|approximately)[ \\t]{1,4})?(?:between[ \\t]{1,4})?(${TIME_NUMBER})(?:[ \\t]{0,4}(?:–|—|-|to|and)[ \\t]{0,4}(${TIME_NUMBER}))?[ \\t]{1,4}(months?|weeks?|years?)(?:[ \\t]{1,4}(?:with[ \\t]{1,4}(?:the|our)[ \\t]{1,4}(?:current[ \\t]{1,4})?team|for[ \\t]{1,4}(?:the|our)[ \\t]{1,4}(?:current[ \\t]{1,4})?team|to[ \\t]{1,4}(?:finish|complete|deliver|launch)))?(?:,[ \\t]{0,4}I[ \\t]{1,4}think)?[.!?]{0,1}$`, 'iu');
const TIME_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, a: 1, an: 1 };
export function readTeamTime(words: unknown): { low_months: number; high_months: number } | null {
  if (typeof words !== 'string' || words.length > 1000) return null;
  // Consume the complete duration clause. Unsupported prefixes never expose a numeric suffix.
  const expression = words.trim();
  const m = TEAM_TIME.exec(expression);
  if (m === null) return null;
  const read = (s: string): number => TIME_WORDS[s.toLowerCase()] ?? Number(s);
  const scale = /^years?$/i.test(m[3]!) ? 12 : /^weeks?$/i.test(m[3]!) ? 12 * 7 / 365.25 : 1;
  const a = read(m[1]!) * scale, b = read(m[2] ?? m[1]!) * scale;
  if (!(a > 0 && b > 0) || !Number.isFinite(a + b)) return null;
  return { low_months: Math.min(a, b), high_months: Math.max(a, b) };
}
/** Weeks have no terminating month representation. Admit the exact conversion or its two-decimal tool rendering;
 * the writer always uses the server's unrounded conversion, never the model's number. */
export function teamTimeArgumentsMatch(words: unknown, args: { low_months: number; high_months: number }, stated: { low_months: number; high_months: number }): boolean {
  const convertedWeeks = typeof words === 'string' && /\bweeks?\b/i.test(words);
  const same = (a: number, b: number): boolean => a === b || (convertedWeeks && a === Math.round(b * 100) / 100);
  return same(args.low_months, stated.low_months) && same(args.high_months, stated.high_months);
}

/**
 * ⭐ EBD E2 — THE TEAM'S TIME FROM ANY OF THE USER'S MESSAGES, BY QUOTE BINDING (Paul, 12 Oct, scenario 4184e877: "The team
 * are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low
 * confidence in this because they keep missing deadlines." was refused `team_time_not_stated`: the whole-message reader
 * accepts only a bare duration sentence). The Agent passes the user's exact words (`quote`) and the figure; the door
 * checks the quote is in one of the user's own messages and the figure is a duration the quote states. The duration is
 * read clause by clause with the existing anchored reader (`readTeamTime`): a clause may open with any words except one
 * that makes it another quantity (a hiring time, a delay, a deadline). A missing quote reads THIS message, as before.
 */
const CLAUSE_BOUNDARY = /[,;:()[\]!?\n]|(?<!\d)\.|\.(?!\d)|\b(?:but|so|because|though|although|while|whereas)\b/giu;
/** A word before a duration that makes it something other than the team's time to finish. */
const NOT_TEAM_TIME_WORD = /^(?:hire|hires|hiring|hired|recruit|recruits|recruiting|recruited|recruitment|onboard|onboards|onboarding|notice|deadline|deadlines|due|ago|since|late|later|early|earlier|behind|delay|delays|delayed|slip|slips|slipped|slipping|miss|misses|missed|missing|left|remaining|start|starts|starting|started|join|joins|joining|ramp|half|quarter|couple|few|several)$/;
const WORD_IN_CLAUSE = /^[^ \t]{1,80}[ \t]*/;
/** Durations a quote states, one per clause it ends: `readTeamTime` over the clause, then over each later start word. */
export function teamTimesInQuote(quote: unknown): { low_months: number; high_months: number }[] {
  if (typeof quote !== 'string' || quote.length > 1000) return [];
  const out: { low_months: number; high_months: number }[] = [];
  for (const clause of quote.split(CLAUSE_BOUNDARY)) {
    let rest = (clause ?? '').trim();
    for (let i = 0; i <= 40 && rest !== ''; i += 1) {
      const read = readTeamTime(rest);
      if (read !== null) { out.push(read); break; }
      const word = WORD_IN_CLAUSE.exec(rest);
      const bare = word === null ? '' : word[0].trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (word === null || NOT_TEAM_TIME_WORD.test(bare) || /\d/.test(bare) || Object.hasOwn(TIME_WORDS, bare)) break;
      rest = rest.slice(word[0].length).trim();
    }
  }
  return out;
}

/**
 * ⭐ EBD E2 (a) — THE ONE WIDENING RULE, FOR AIE REVIEW. A single time (Paul's "7 months") is the user's most likely time,
 * and the chance needs a soonest and latest time. Olumi proposes the range from that figure P by ONE rule, shown on the
 * card as "Olumi's estimate from your P months", never as the user's:
 *   · the user expressed doubt about the time in the same sentence (`TEAM_TIME_DOUBT`): P to 1.5 × P;
 *   · otherwise: 0.85 × P to 1.25 × P.
 * Each end is rounded to 0.1 month (0.01 month when P is under a month). The user approves or changes it on the card.
 */
export const TEAM_TIME_WIDENING = { doubt: { low: 1, high: 1.5 }, default: { low: 0.85, high: 1.25 } } as const;
export const TEAM_TIME_DOUBT = /\b(?:low|little|limited|not\s+much|no)\s+confidence\b|\bnot\s+(?:very\s+|that\s+|so\s+|really\s+|fully\s+|too\s+)?(?:confident|sure|certain)\b|\bunsure\b|\buncertain\b|\bsceptical\b|\bskeptical\b|(?<!\bno\s)(?<!\bwithout\s)(?<!\blittle\s)\bdoubt(?:s|ful)?\b|\bkeeps?\s+(?:missing|slipping)\b|\b(?:over-?)?optimistic\b/iu;
export type TeamTimeWidening = keyof typeof TEAM_TIME_WIDENING;
export function widenedTeamTime(p: number, widening: TeamTimeWidening): { low_months: number; high_months: number } {
  const f = TEAM_TIME_WIDENING[widening], step = p >= 1 ? 10 : 100;
  // Factors as whole hundredths, so 13 × 0.85 = 11.05 rounds to 11.1 (binary 0.85 would give 11.0).
  const end = (factor: number): number => Math.round(p * step * Math.round(factor * 100) / 100) / step;
  return { low_months: end(f.low), high_months: end(f.high) };
}

/** A time the user stated, bound to their words; a single time carries Olumi's range and both authorships. */
export interface BoundTeamTime {
  readonly low_months: number;
  readonly high_months: number;
  /** The user's own single time, when the range is Olumi's estimate from it. */
  readonly most_likely_months?: number;
  readonly range_origin?: 'olumi_estimate';
  readonly widening?: TeamTimeWidening;
}
const plainWords = (t: string): string => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/[ \t]+/g, ' ').trim();
/** The sentence(s) of `text` that hold `quote` (never split at a decimal point). */
function sentencesHolding(text: string, quote: string): string {
  const ends = [...text.matchAll(/[!?\n]|(?<!\d)\.|\.(?!\d)/g)].map(m => m.index!);
  return quoteSpansIn(text, quote).map(at => {
    const start = ends.filter(e => e < at).pop();
    const end = ends.find(e => e >= at + quote.length - 1);
    return text.slice(start === undefined ? 0 : start + 1, end === undefined ? text.length : end + 1);
  }).join(' ');
}
export function bindTeamTimeQuote(texts: { readonly now?: string | null; readonly conversation?: string | null },
  args: { readonly quote?: unknown; readonly low_months?: unknown; readonly high_months?: unknown } | undefined):
  { readonly kind: 'bound'; readonly time: BoundTeamTime; readonly quote: string } | { readonly kind: 'refused'; readonly detail: string } {
  const now = typeof texts.now === 'string' ? texts.now : '';
  const quoted = typeof args?.quote === 'string' && args.quote.trim() !== '' ? args.quote.trim() : now.trim();
  const quote = plainWords(quoted);
  const source = [now, typeof texts.conversation === 'string' ? texts.conversation : '']
    .map(plainWords).find(t => quote !== '' && quoteSpansIn(t, quote).length > 0);
  if (source === undefined) {
    return { kind: 'refused', detail: 'Nothing was prepared: `quote` must be the user\u2019s own words stating the time, copied exactly from one of their messages.' };
  }
  const low = Number(args?.low_months), high = Number(args?.high_months);
  const stated = Number.isFinite(low) && Number.isFinite(high)
    ? teamTimesInQuote(quote).find(r => teamTimeArgumentsMatch(quote, { low_months: low, high_months: high }, r)) : undefined;
  if (stated === undefined) {
    return { kind: 'refused', detail: 'Type how long it would take with your current team, for example "6–10 months" or "about 8 months".' };
  }
  if (stated.low_months !== stated.high_months) return { kind: 'bound', time: stated, quote: quoted };
  const widening: TeamTimeWidening = TEAM_TIME_DOUBT.test(sentencesHolding(source, quote)) ? 'doubt' : 'default';
  return { kind: 'bound', quote: quoted, time: { ...widenedTeamTime(stated.low_months, widening),
    most_likely_months: stated.low_months, range_origin: 'olumi_estimate', widening } };
}

export interface ApprovedTeamTime {
  readonly goal_id: string;
  readonly team_id: string;
  readonly low_months: number;
  readonly high_months: number;
  readonly deadline: string;
  readonly reference_date: string;
  /** EBD E2: the user's single time when the range is Olumi's estimate from it (`bindTeamTimeQuote`). */
  readonly most_likely_months?: number;
  readonly range_origin?: 'olumi_estimate';
  readonly widening?: TeamTimeWidening;
  /** EBD: what the card read (`teamTimeReadDigest`) — its approval precondition, field-scoped. */
  readonly read_digest?: string;
}

/**
 * ⭐ EBD — A TEAM-TIME CARD IS STALE ONLY WHEN WHAT IT READ CHANGED (DL, from SYS1's E5 build: a team-time card offered before
 * the hiring times land must still apply after them). The card read the team part (the whole node), the goal's identity,
 * held deadline and deliverable unit, and the time held on the definition's carrier; nothing else. The write itself stays CAS-fenced on the graph read at
 * approval (`applyTeamShareEdit`) and scoped to the team part (`teamSharePostimageIsScoped`).
 */
export function teamTimeReadDigest(graph: unknown): string | null {
  const part = draftedTeamPartOf(graph);
  if (part === null) return null;
  const carrier = eventShareCarrierOf(graph)?.provenance?.share_by_date;
  // The whole team node (its label, its held time, anything on it); of the goal, what the card states; of the carrier, the time.
  return createHash('sha256').update(stableStringify([part.goal.id, goalDeadlineFromRecord(graph, part.goal.id) ?? null,
    part.goal.goal_threshold_unit ?? null, part.deliverable, part.team, carrier?.stated_time ?? null])).digest('hex');
}
/** True only for a one-operation team-time proposal whose own read still holds on `graph`. */
export function teamTimeReadHolds(p: { readonly operations: readonly { readonly op: string; readonly value?: unknown }[] }, graph: unknown): boolean {
  if (p.operations.length !== 1 || p.operations[0]!.op !== 'set_team_time') return false;
  const read = (p.operations[0]!.value as { read_digest?: unknown } | null | undefined)?.read_digest;
  return typeof read === 'string' && read === teamTimeReadDigest(graph);
}
export function teamObservedState(a: ApprovedTeamTime, unit: string): Rec {
  if (a.low_months === a.high_months) return { quantity: 'months_to_finish', most_likely: a.low_months,
    unit: 'months', deadline: a.deadline, reference_date: a.reference_date };
  const m = teamShareMoments(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months);
  return { value: m.mean, std: m.sd, raw_value: m.mean * 100, unit, cap: 100, source: 'cee_inference',
    stated_time: { quantity: 'months_to_finish', low: a.low_months, high: a.high_months, unit: 'months',
      deadline: a.deadline, reference_date: a.reference_date,
      // EBD E2: human-origin most likely time, AI-origin range. Never read back as the user's range.
      ...(a.most_likely_months !== undefined && a.range_origin === 'olumi_estimate' ? {
        most_likely: a.most_likely_months, most_likely_origin: 'user', range_origin: 'olumi_estimate', widening: a.widening } : {}) } };
}
/** Single estimates live on the held definition carrier, outside modelled numeric observed_state. */
export function teamTimeIsHeld(team: Rec, a: ApprovedTeamTime, unit: string, graph: unknown): boolean {
  return isDeepStrictEqual(a.low_months === a.high_months ? eventShareCarrierOf(graph)?.provenance.share_by_date.stated_time : team.observed_state, teamObservedState(a, unit));
}
export function teamTimeCard(a: ApprovedTeamTime, _unit: string, deliverable: string): string {
  if (a.low_months === a.high_months) return `Use about ${a.low_months} months as your most likely time with today's team? The chance stays withheld until you give the soonest and latest times.`;
  const time = a.low_months === a.high_months ? `${a.low_months}` : `${a.low_months}–${a.high_months}`;
  const pct = displayedPctAt(cappedTeamShareMean(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months), 'whole');
  const by = `By ${sayDate(a.deadline)} that is about ${pct}% of ${deliverable}.`;
  // EBD E2: ONE card for a single time — the user's figure, and Olumi's range from it, labelled as Olumi's (AIE review).
  if (a.most_likely_months !== undefined && a.range_origin === 'olumi_estimate') {
    return `Use Olumi's ${time} months for today's team? It is Olumi's estimate from your ${a.most_likely_months} months, `
      + (a.widening === 'doubt' ? 'allowing for it to run later because you have doubts about it. ' : 'allowing for it to run earlier or later. ') + by;
  }
  return `Use ${time} months for today's team? ${by}`;
}
export type TeamTimeEditResult =
  | { kind: 'mutated'; mutatedGraph: Rec; handlerFacts: readonly HandlerFact[]; confirmation: string }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string };
export function applyTeamShareEdit(graph: unknown, a: ApprovedTeamTime, expectedHash: string): TeamTimeEditResult {
  const part = draftedTeamPartOf(graph);
  if (part === null || part.goal.id !== a.goal_id || part.team.id !== a.team_id) return { kind: 'refused', reason: 'team_not_found' };
  if (![a.low_months, a.high_months].every(Number.isFinite) || a.low_months <= 0 || a.high_months < a.low_months
    || !isShareCalendarDate(a.deadline) || !isShareCalendarDate(a.reference_date)
    || timeBetween(a.reference_date, a.deadline, 'months') <= 0) return { kind: 'refused', reason: 'invalid_time' };
  if (goalDeadlineFromRecord(graph, part.goal.id) !== a.deadline) return { kind: 'refused', reason: 'deadline_changed' };
  const os = teamObservedState(a, String(part.goal.goal_threshold_unit));
  // The landed postimage itself proves an equal retry, before CAS (the first write moved the hash).
  if (teamTimeIsHeld(part.team, a, String(part.goal.goal_threshold_unit), graph)) return { kind: 'unchanged' };
  if (computeAnalysisAffectingGraphHash(graph as never) !== expectedHash) return { kind: 'refused', reason: 'stale_graph' };
  const out = structuredClone(graph) as Rec;
  const team = out.nodes.find((n: Rec) => n.id === a.team_id);
  const carrier = eventShareCarrierOf(out)!.provenance.share_by_date;
  // EBD E2 (b): a single most likely time (a card approved before the widening rule) is held on the carrier and never
  // deletes the team part's level; a range is the level.
  if (a.low_months === a.high_months) carrier.stated_time = os;
  else { team.observed_state = os; delete carrier.stated_time; }
  const fact = EditGraphHandlerFactSchema.parse({ fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: { edit_kind: 'parameter_update', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: 'factor', label: part.team.label.slice(0, 120) }],
      graph_hash_before: expectedHash, graph_hash_after: computeAnalysisAffectingGraphHash(out as never),
      safe_summary: teamTimeCard(a, String(part.goal.goal_threshold_unit), part.deliverable).split('?')[0], impact: 'low', rerun_recommended: true } });
  return { kind: 'mutated', mutatedGraph: out, handlerFacts: [fact as HandlerFact], confirmation: teamTimeCard(a, String(part.goal.goal_threshold_unit), part.deliverable).split('? ')[1]! };
}
/** Only the one part's observed state can differ. */
export function teamSharePostimageIsScoped(before: unknown, after: unknown, id: string): boolean {
  const strip = (g: unknown): unknown => {
    const out = structuredClone(g) as Rec;
    if (!Array.isArray(out?.nodes)) return null;
    for (const n of out.nodes) if (n.id === id) delete n.observed_state;
    for (const edge of out.edges ?? []) if (edge.from === id && edge.provenance?.share_by_date?.team_id === id) delete edge.provenance.share_by_date.stated_time;
    return out;
  };
  return isDeepStrictEqual(strip(before), strip(after));
}
