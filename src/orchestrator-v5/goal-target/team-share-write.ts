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
 * ⭐ EBD E2 (a) — THE MODEL RANGE FROM A SINGLE FORECAST (AIE 6121986101 / 6122738619, PL 6122519782; settled 12 Oct). A single
 * time (Paul's "7 months") is the user's FORECAST P, a human point kept with their words; it is never called their "most
 * likely" time. The chance needs bounds, so Olumi assumes a provisional model range from P by ONE convention, labelled as
 * Olumi's on the card and on every result line (AIE 6125204695: the engine's chance is a bell-curve approximation from the
 * range's moments, `recovery/bB/ebd-law/DIAGNOSIS.md`; never "every time in it equally likely"):
 *   · low confidence positively bound to that forecast in the same sentence (`TEAM_TIME_LOW_CONFIDENCE`): 0.5 × P to 1.5 × P;
 *   · otherwise: 0.75 × P to 1.25 × P.
 * These widths are an explicitly assumed convention, not calibrated uncertainty. Each end is rounded to 0.1 month (0.01
 * month when P is under a month). The user approves or changes the range on the card.
 */
export const TEAM_TIME_WIDENING = { low_confidence: { low: 0.5, high: 1.5 }, default: { low: 0.75, high: 1.25 } } as const;
/**
 * Low confidence POSITIVELY BOUND to the forecast: a confidence statement whose object is that forecast ("low confidence in
 * this", "not sure about that estimate", "I doubt it"). A keyword elsewhere in the sentence ("they keep missing deadlines",
 * "no doubt") is not confidence attribution.
 */
const FORECAST_OBJECT = String.raw`(?:this|that|it|these|those|them|(?:the|their|this|that)\s+(?:estimate|forecast|figure|number|time|timing|date)s?)\b`;
export const TEAM_TIME_LOW_CONFIDENCE = new RegExp(String.raw`\b(?:low|little|limited|not\s+much|no)\s+confidence\s+(?:in|about|on)\s+${FORECAST_OBJECT}`
  + String.raw`|\bnot\s+(?:very\s+|that\s+|so\s+|really\s+|fully\s+|too\s+)?(?:confident|sure|certain)\s+(?:in|about|of)\s+${FORECAST_OBJECT}`
  + String.raw`|\b(?:unsure|uncertain|sceptical|skeptical|doubtful)\s+(?:about|of)\s+${FORECAST_OBJECT}`
  + String.raw`|\bI\s+doubt\s+${FORECAST_OBJECT}|\b(?:don['’]t|do\s+not)\s+(?:trust|believe)\s+${FORECAST_OBJECT}`, 'iu');
export type TeamTimeRangeRule = keyof typeof TEAM_TIME_WIDENING;
export function widenedTeamTime(p: number, rule: TeamTimeRangeRule): { low_months: number; high_months: number } {
  const f = TEAM_TIME_WIDENING[rule], step = p >= 1 ? 10 : 100;
  // Factors as whole hundredths, so binary floating point never moves a rounded end (13 × 0.75 = 9.75 → 9.8).
  const end = (factor: number): number => Math.round(p * step * Math.round(factor * 100) / 100) / step;
  return { low_months: end(f.low), high_months: end(f.high) };
}

/** A time the user stated, bound to their words; a single forecast carries Olumi's assumed range, each with its own origin. */
export interface BoundTeamTime {
  readonly low_months: number;
  readonly high_months: number;
  /** The user's own single forecast P (human), when the range is Olumi's assumption from it. Never called "most likely". */
  readonly forecast_months?: number;
  /** The user's words for it, qualifier included, as they typed them. */
  readonly forecast_words?: string;
  readonly range_origin?: 'olumi_estimate';
  readonly range_rule?: TeamTimeRangeRule;
}
/** AIE 6122738619, verbatim: the Agent re-reads what the user already said, and asks only if the forecast is missing or unclear. */
export const TEAM_TIME_NOT_STATED = "No change was prepared. Re-read the verified human messages and quote the words that give the current team's time to finish. Ask for that forecast only if the user has not supplied it or its meaning is still ambiguous.";
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
/**
 * ⭐ B2-c (DL, 12 Oct; independent check FAIL on 3c7d1a71: "The team will finish in 9 months; recruitment takes (7 months)"
 * quoted as "7 months" bound as the team's forecast, and "procurement takes 7 months" passed). E2 refused a duration whose
 * clause opened with a word from a list of other quantities; no such list is complete, and brackets cut the subject off.
 * POSITIVE ATTRIBUTION instead: in the user's own statement, a duration is the team's time to finish only when
 *   · the TEAM is named before it in the same statement (`TEAM_NAME`; a statement ends at a sentence end, ';', ':', or a
 *     clause opening with "but", "because", "although", "though", "whereas", "while", "except", "unless", "however");
 *   · every word between the last naming of the team and the duration is from a CLOSED list (`TEAM_GAP_WORDS`: how a time is
 *     reported or expected, how a delivery is said, and the deliverable's own words), brackets and commas included; another
 *     duration there only as a delay the figure restates ("a month late (so, 7 months)");
 *   · every word after it, to the statement's end, is from a closed list too (`TEAM_AFTER_WORDS`: "to finish", "with the
 *     current team", "in total", "or so", …), so nothing after it makes it another quantity ("7 months to hire").
 * Anything else is refused and the user is asked: a refusal is never a misattribution.
 */
const TEAM_NAME = /(?<![\p{L}\p{N}])(?:(?:the|our|my)\s+(?:current\s+|existing\s+|whole\s+)?(?:dev(?:elopment)?\s+|engineering\s+|delivery\s+|product\s+)?(?:team|developers|devs|engineers)|we)(?![\p{L}\p{N}])/giu;
const STATEMENT_END = /[;:!?\n]|(?<!\d)\.|\.(?!\d)|(?<![\p{L}\p{N}])(?:but|because|although|though|whereas|while|except|unless|however)(?![\p{L}\p{N}])/giu;
const DURATION_IN_TEXT = new RegExp(`(?<![\\p{L}\\p{N}])(?:between[ \\t]{1,4})?${TIME_NUMBER}(?:[ \\t]{0,4}(?:–|—|-|to|and)[ \\t]{0,4}${TIME_NUMBER})?[ \\t]{1,4}(?:months?|weeks?|years?)(?![\\p{L}\\p{N}])`, 'giu');
const TIME_UNIT = /^(?:months?|weeks?|years?)$/;
const DELAY_WORD = /^(?:late|early|behind|over|overdue)$/;
const words = (t: string): string[] => (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map(w => w.replace(/^'+|'+$/g, ''));
/** The closed list between the team and its time. Nothing here names another quantity. */
export const TEAM_GAP_WORDS: ReadonlySet<string> = new Set([
  'are', 'is', 'am', 'be', 'been', 'being', 'was', 'were', 'will', 'would', 'could', 'should', 'might', 'may', 'can', 'll', 'have', 'has', 'had',
  'currently', 'now', 'still', 'already', 'also', 'just', 'probably', 'roughly', 'about', 'around', 'approximately', 'maybe', 'perhaps', 'likely',
  'telling', 'tell', 'tells', 'told', 'say', 'says', 'said', 'saying', 'think', 'thinks', 'thought', 'reckon', 'reckons', 'expect', 'expects',
  'expected', 'estimate', 'estimates', 'estimated', 'believe', 'believes', 'guess', 'feel', 'feels', 'me', 'us', 'i', 'they', "they're",
  "they'll", 'it', "it'll", "it's", "it'd", "we're", "we'll", "we'd", 'going', 'to', 'gonna', 'need', 'needs', 'take', 'takes', 'taking',
  'finish', 'finishing', 'complete', 'completing', 'deliver', 'delivering', 'ship', 'shipping', 'release', 'releasing', 'launch', 'launching',
  'get', 'done', 'with', 'the', 'a', 'an', 'our', 'their', 'its', 'this', 'that', 'so', 'in', 'within', 'late', 'early', 'behind',
  'work', 'project', 'feature', 'release', 'product', 'deliverable', 'next', 'current',
]);
/** The closed list after the team's time, to the statement's end. */
export const TEAM_AFTER_WORDS: ReadonlySet<string> = new Set([
  'to', 'finish', 'complete', 'deliver', 'ship', 'launch', 'release', 'it', 'the', 'with', 'for', 'our', 'current', 'existing', 'team', 'in',
  'total', 'overall', 'from', 'now', 'today', 'i', 'think', 'reckon', 'guess', 'or', 'so', 'give', 'take', 'roughly', 'work', 'project',
  'feature', 'product', 'deliverable', 'next', 'all', 'told',
]);
/** True when `figure` (start, end in `text`) is the team's time to finish in the user's statement (B2-c, above). */
function teamOwnsDuration(text: string, start: number, end: number, deliverable: string): boolean {
  const ends = [...text.matchAll(STATEMENT_END)].map(m => [m.index!, m.index! + m[0].length] as const);
  const from = Math.max(0, ...ends.filter(([, e]) => e <= start).map(([, e]) => e));
  const to = Math.min(text.length, ...ends.filter(([b]) => b >= end).map(([b]) => b));
  const before = text.slice(from, start);
  const team = [...before.matchAll(TEAM_NAME)].pop();
  if (team === undefined) return false;
  const own = new Set(words(deliverable));
  const gap = words(before.slice(team.index! + team[0].length));
  for (let i = 0; i < gap.length; i += 1) {
    const w = gap[i]!;
    if ((/^\d+(?:\.\d+)?$/.test(w) || Object.hasOwn(TIME_WORDS, w)) && TIME_UNIT.test(gap[i + 1] ?? '')) {
      // Another duration between the team and its time: only a delay that the figure restates ("a month late").
      if (!DELAY_WORD.test(gap[i + 2] ?? '')) return false;
      i += 2;
      continue;
    }
    if (!TEAM_GAP_WORDS.has(w) && !own.has(w)) return false;
  }
  return words(text.slice(end, to)).every(w => TEAM_AFTER_WORDS.has(w) || own.has(w));
}
/** Every place in `text`, inside a span of `quote`, where a duration reading as `stated` stands. */
function durationSpansIn(text: string, quote: string, stated: { low_months: number; high_months: number }): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const at of quoteSpansIn(text, quote)) {
    for (const m of text.slice(at, at + quote.length).matchAll(DURATION_IN_TEXT)) {
      const r = readTeamTime(m[0]);
      if (r !== null && r.low_months === stated.low_months && r.high_months === stated.high_months) out.push([at + m.index!, at + m.index! + m[0].length]);
    }
  }
  return out;
}
export function bindTeamTimeQuote(texts: { readonly now?: string | null; readonly conversation?: string | null },
  args: { readonly quote?: unknown; readonly low_months?: unknown; readonly high_months?: unknown } | undefined, deliverable = ''):
  { readonly kind: 'bound'; readonly time: BoundTeamTime; readonly quote: string } | { readonly kind: 'refused'; readonly detail: string } {
  const now = typeof texts.now === 'string' ? texts.now : '';
  const quoted = typeof args?.quote === 'string' && args.quote.trim() !== '' ? args.quote.trim() : now.trim();
  const quote = plainWords(quoted);
  const source = [now, typeof texts.conversation === 'string' ? texts.conversation : '']
    .map(plainWords).find(t => quote !== '' && quoteSpansIn(t, quote).length > 0);
  if (source === undefined) {
    return { kind: 'refused', detail: TEAM_TIME_NOT_STATED };
  }
  const low = Number(args?.low_months), high = Number(args?.high_months);
  const stated = Number.isFinite(low) && Number.isFinite(high)
    ? teamTimesInQuote(quote).find(r => teamTimeArgumentsMatch(quote, { low_months: low, high_months: high }, r)) : undefined;
  // B2-c: THIS message is, whole, the base door's duration answer ("6–10 months", "It’ll take 6–10 months"), or the team owns
  // the figure in the user's own statement (positive attribution) at some place the quote stands.
  const wholeAnswer = readTeamTime(plainWords(now));
  const inStatement = stated !== undefined && ((source === plainWords(now) && wholeAnswer !== null
      && wholeAnswer.low_months === stated.low_months && wholeAnswer.high_months === stated.high_months)
    || durationSpansIn(source, quote, stated).some(([start, end]) => teamOwnsDuration(source, start, end, plainWords(deliverable))));
  if (stated === undefined || !inStatement) {
    return { kind: 'refused', detail: TEAM_TIME_NOT_STATED };
  }
  if (stated.low_months !== stated.high_months) return { kind: 'bound', time: stated, quote: quoted };
  const rule: TeamTimeRangeRule = TEAM_TIME_LOW_CONFIDENCE.test(sentencesHolding(source, quote)) ? 'low_confidence' : 'default';
  return { kind: 'bound', quote: quoted, time: { ...widenedTeamTime(stated.low_months, rule),
    forecast_months: stated.low_months, forecast_words: quoted, range_origin: 'olumi_estimate', range_rule: rule } };
}

export interface ApprovedTeamTime {
  readonly goal_id: string;
  readonly team_id: string;
  readonly low_months: number;
  readonly high_months: number;
  readonly deadline: string;
  readonly reference_date: string;
  /** EBD E2: the user's single forecast and their words, when the range is Olumi's assumption from it (`bindTeamTimeQuote`). */
  readonly forecast_months?: number;
  readonly forecast_words?: string;
  readonly range_origin?: 'olumi_estimate';
  readonly range_rule?: TeamTimeRangeRule;
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
      // EBD E2: the human forecast and its words (qualifier kept), apart from Olumi's assumed range. Never read back as theirs.
      ...(a.forecast_months !== undefined && a.range_origin === 'olumi_estimate' ? {
        forecast: a.forecast_months, forecast_origin: 'user', ...(a.forecast_words !== undefined ? { forecast_words: a.forecast_words } : {}),
        range_origin: 'olumi_estimate', range_rule: a.range_rule } : {}) } };
}
/** Single estimates live on the held definition carrier, outside modelled numeric observed_state. */
export function teamTimeIsHeld(team: Rec, a: ApprovedTeamTime, unit: string, graph: unknown): boolean {
  return isDeepStrictEqual(a.low_months === a.high_months ? eventShareCarrierOf(graph)?.provenance.share_by_date.stated_time : team.observed_state, teamObservedState(a, unit));
}
/**
 * The team-time card as its question and the explanation after it, kept apart: the writer's fact summary is the question,
 * its confirmation the explanation (never a split of the joined text).
 */
export function teamTimeCardParts(a: ApprovedTeamTime, _unit: string, deliverable: string): { readonly question: string; readonly explanation: string } {
  if (a.low_months === a.high_months) return { question: `Use about ${a.low_months} months as your most likely time with today's team?`,
    explanation: 'The chance stays withheld until you give the soonest and latest times.' };
  // ⭐ EBD E2, AIE 6125204695 (b1) verbatim: ONE card for a single forecast. The forecast, its words and the qualifier stay the
  // user's; the range and the bell-curve approximation are Olumi's assumptions. No derived progress headline on the card.
  if (a.forecast_months !== undefined && a.range_origin === 'olumi_estimate') {
    return { question: `Use Olumi’s provisional model based on your ${a.forecast_months}-month forecast and an assumed ${a.low_months}–${a.high_months}-month range?`,
      explanation: 'The calculation uses bell-curve approximations of progress and can include outcomes outside those time bounds.'
        + (a.range_rule === 'low_confidence' ? ' You described low confidence in that forecast.' : '') };
  }
  const pct = displayedPctAt(cappedTeamShareMean(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months), 'whole');
  return { question: `Use ${a.low_months}–${a.high_months} months for today's team?`,
    explanation: `By ${sayDate(a.deadline)} that is about ${pct}% of ${deliverable}.` };
}
/**
 * The edit fact's summary (`safe_summary`, at most 80 characters). The card question, as before, except on the assumed-range path,
 * whose AIE 6125204695 question is longer than a summary may be: there it states the same two inputs in fewer words (pending the
 * AIE's ACK, `recovery/bB/B-STRINGS-FOR-AIE.md`), and Olumi's range alone if even that is too long.
 */
export function teamTimeSummary(a: ApprovedTeamTime, unit: string, deliverable: string): string {
  if (a.forecast_months !== undefined && a.range_origin === 'olumi_estimate') {
    const both = `Team time: your ${a.forecast_months}-month forecast, Olumi’s assumed ${a.low_months}–${a.high_months}-month range`;
    return both.length <= 80 ? both : `Team time: Olumi’s assumed ${a.low_months}–${a.high_months}-month range`;
  }
  return teamTimeCardParts(a, unit, deliverable).question.replace(/\?$/, '');
}
export function teamTimeCard(a: ApprovedTeamTime, unit: string, deliverable: string): string {
  const { question, explanation } = teamTimeCardParts(a, unit, deliverable);
  return `${question} ${explanation}`;
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
  // EBD E2 (b): a legacy single time (a card approved before the range convention) is held on the carrier and never
  // deletes the team part's level; a range is the level.
  if (a.low_months === a.high_months) carrier.stated_time = os;
  else { team.observed_state = os; delete carrier.stated_time; }
  const fact = EditGraphHandlerFactSchema.parse({ fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: { edit_kind: 'parameter_update', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: 'factor', label: part.team.label.slice(0, 120) }],
      graph_hash_before: expectedHash, graph_hash_after: computeAnalysisAffectingGraphHash(out as never),
      safe_summary: teamTimeSummary(a, String(part.goal.goal_threshold_unit), part.deliverable), impact: 'low', rerun_recommended: true } });
  return { kind: 'mutated', mutatedGraph: out, handlerFacts: [fact as HandlerFact], confirmation: teamTimeCardParts(a, String(part.goal.goal_threshold_unit), part.deliverable).explanation };
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
