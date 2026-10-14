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
import { confirmationQuoteLine, confirmedSelection, verbatimSourceLine, type QuoteConfirmation } from '../agent-lane/quote-confirmation.js';
import { combineStatementEnds, statementReadingWords, userStatementOf, verifyStatements, type StatementForm, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
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
export type TeamTimeRangeRule = keyof typeof TEAM_TIME_WIDENING | 'likely_end';
export function widenedTeamTime(p: number, rule: keyof typeof TEAM_TIME_WIDENING): { low_months: number; high_months: number } {
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
  /** S2: the user's verified statements the time was read from (`teamTimeFromStatements`), kept whole beside it. */
  readonly statements?: readonly UserStatement[];
  /** S2 (PL #94 6135017311): ONE end the user gave, recorded as that end, never a point; the model still needs the other. */
  readonly held_bound?: { readonly end: 'lower' | 'upper'; readonly months: number };
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
 * B2 (independent check BLOCKING 2, CHECK.md on 91405cb2): the clause(s) that ENCLOSE each place `quote` stands in `text`.
 * The quote's figure is read again over them with the same clause reader, so a duration is the team's time only if it is
 * so in the user's own statement, never because the selected words stop just after its subject ("recruitment takes
 * 7 months" quoted as "7 months"). Conservative by construction: a clause holding two durations reads at most one.
 */
function enclosingClauses(text: string, quote: string): string[] {
  const bounds = [...text.matchAll(CLAUSE_BOUNDARY)].map(m => [m.index!, m.index! + m[0].length] as const);
  return quoteSpansIn(text, quote).map(at => {
    const start = Math.max(0, ...bounds.filter(([, e]) => e <= at).map(([, e]) => e));
    const end = Math.min(text.length, ...bounds.filter(([b]) => b >= at + quote.length).map(([b]) => b));
    return text.slice(start, end);
  });
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
    return { kind: 'refused', detail: TEAM_TIME_NOT_STATED };
  }
  const low = Number(args?.low_months), high = Number(args?.high_months);
  const stated = Number.isFinite(low) && Number.isFinite(high)
    ? teamTimesInQuote(quote).find(r => teamTimeArgumentsMatch(quote, { low_months: low, high_months: high }, r)) : undefined;
  const inStatement = stated !== undefined && enclosingClauses(source, quote)
    .some(c => teamTimesInQuote(c).some(r => r.low_months === stated.low_months && r.high_months === stated.high_months));
  if (stated === undefined || !inStatement) {
    return { kind: 'refused', detail: TEAM_TIME_NOT_STATED };
  }
  if (stated.low_months !== stated.high_months) return { kind: 'bound', time: stated, quote: quoted };
  const rule: keyof typeof TEAM_TIME_WIDENING = TEAM_TIME_LOW_CONFIDENCE.test(sentencesHolding(source, quote)) ? 'low_confidence' : 'default';
  return { kind: 'bound', quote: quoted, time: { ...widenedTeamTime(stated.low_months, rule),
    forecast_months: stated.low_months, forecast_words: quoted, range_origin: 'olumi_estimate', range_rule: rule } };
}

/**
 * ⭐ B2-c CONFIRMATION (DL re-scope, 12 Oct; PL #94 6131809231; AIE #94 6132054663), AI-first Lane 1 (DL 12 Oct, PL 6134071898):
 * whose time a sentence states is never parsed, and no regex refuses the Agent's reading. The Agent's arguments carry the
 * figure; this finds only the complete line of the user's own typed words that holds the quote VERBATIM, for the card's quote
 * line (provenance: a quote line is shown only for words the user typed). The card is the check: only the user's press on it
 * records the figure as their selected forecast (`teamTimeConfirmationCard`); until then it is Olumi's reading.
 */
/** The team-time use of the one confirmation mechanism (`agent-lane/quote-confirmation.ts`). */
export type TeamTimeConfirmation = QuoteConfirmation;
export function quotedTeamTime(texts: { readonly now?: string | null; readonly conversation?: string | null },
  args: { readonly quote?: unknown; readonly low_months?: unknown; readonly high_months?: unknown } | undefined):
  { readonly kind: 'found'; readonly time: BoundTeamTime; readonly confirmation: TeamTimeConfirmation } | { readonly kind: 'refused'; readonly detail: string } {
  const low = Number(args?.low_months), high = Number(args?.high_months);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return { kind: 'refused', detail: TEAM_TIME_NOT_STATED };
  const quoted = typeof args?.quote === 'string' ? args.quote.trim() : '';
  const source = quoted === '' ? undefined : verbatimSourceLine(texts, quoted);
  const confirmation = { source: source ?? '', quote: quoted };
  return { kind: 'found', confirmation, time: withAssumedTeamRange({ low_months: low, high_months: high }, quoted,
    source === undefined ? '' : sentencesHolding(plainWords(source), plainWords(quoted))) };
}
/**
 * AI-first Lane 1 (DL 12 Oct, PLAN-AI-FIRST-SUBTRACT): a single time is the user's forecast with Olumi's assumed range by the
 * E2 (a) convention, on EVERY path: typed as the whole answer or quoted from their words. A single time is never held alone
 * as a "most likely" time that keeps the Run closed until the user types a range. A range is kept as given.
 */
export function withAssumedTeamRange(stated: BoundTeamTime, words: string, sentence: string): BoundTeamTime {
  if (stated.low_months !== stated.high_months) return stated;
  const rule: keyof typeof TEAM_TIME_WIDENING = TEAM_TIME_LOW_CONFIDENCE.test(sentence) ? 'low_confidence' : 'default';
  return { ...widenedTeamTime(stated.low_months, rule),
    forecast_months: stated.low_months, forecast_words: words, range_origin: 'olumi_estimate', range_rule: rule };
}

/**
 * ⭐ S2 — TODAY'S TEAM TIME FROM THE USER'S STATEMENTS (RCA-PAUL-TEST-1617Z Symptom 2; AIE #94 6173489813). Paul said "At least
 * 7 months", then "8 months" when Olumi asked for the likely upper end; the one-quote door turned each into a single forecast
 * with Olumi's 6–10, below his own minimum, and nothing was saved. Each statement is verified by the one shared contract
 * (`verifyStatements`) and the ends combine (`combineStatementEnds`):
 *   · a lone figure keeps the E2 (a) convention, unchanged (the user's forecast, Olumi's labelled assumed range);
 *   · two hard ends ("at least 7", "no more than 9") are the user's own range, as given;
 *   · a QUALIFIED end ("likely upper end 8") is not a hard limit (AIE, via the DL 14 Oct). The engine receives the team's share
 *     done by the deadline as a MEAN and SD (`teamShareMoments`: the moments of D / T, D the months to the deadline and T the
 *     time to finish taken as uniform between the range's two ends) and samples that as a bell curve. So Olumi puts the
 *     user's likely end at the `share_within` point of T (AIE 6174458722: 8 in 10), which places the range's end beyond it;
 *     that range is labelled as Olumi's on the card and adopted only by the press. The user's hard end never moves; nothing is
 *     clipped to fit;
 *   · a lone bound, or two statements that disagree, prepares nothing: the Agent asks only for what is missing.
 */
export const TEAM_TIME_LIKELY_END = { share_within: 0.8 } as const;
export const TEAM_TIME_FORMS: readonly StatementForm[] = ['point', 'range', 'lower_bound', 'upper_bound'];
/** Olumi's assumed hard ends for a range whose qualified end(s) the user's time stays within `share_within` of the time. */
export function likelyEndRange(low: number, high: number, lowQualified: boolean, highQualified: boolean): { low_months: number; high_months: number } {
  const tail = 1 - TEAM_TIME_LIKELY_END.share_within;
  const tLow = lowQualified ? tail : 0, tHigh = highQualified ? tail : 0;
  const width = (high - low) / (1 - tLow - tHigh);
  const a = low - tLow * width, b = high + tHigh * width;
  if (lowQualified && a <= 0) return likelyEndRange(low, high, false, highQualified);
  // Two decimals, rounded outward: an assumed end never crosses the user's own.
  return { low_months: Math.min(low, Math.floor(a * 100 + 1e-9) / 100), high_months: Math.max(high, Math.ceil(b * 100 - 1e-9) / 100) };
}
export type TeamTimeFromStatements =
  | { readonly kind: 'found'; readonly time: BoundTeamTime; readonly confirmation: TeamTimeConfirmation }
  | { readonly kind: 'refused'; readonly refusal: string; readonly detail: string };
/** The statements a held bound was recorded from (`teamObservedState`), so a later answer combines with them unrepeated. */
export function heldTeamTimeStatements(graph: unknown): readonly UserStatement[] {
  const held = eventShareCarrierOf(graph)?.provenance?.share_by_date?.stated_time;
  return held?.held_bound !== undefined && Array.isArray(held.statements)
    ? (held.statements as unknown[]).map(userStatementOf).filter((x): x is UserStatement => x !== undefined) : [];
}
export function teamTimeFromStatements(texts: StatementTexts, raw: unknown, held: readonly UserStatement[] = []): TeamTimeFromStatements {
  const v = verifyStatements(raw, texts, { subject: { quantity: 'months_to_finish' }, unit: 'months', forms: TEAM_TIME_FORMS,
    figuresIn: (q) => teamTimesInQuote(q).map((r) => ({ low: r.low_months, high: r.high_months })),
    sameFigure: (q, given, stated) => teamTimeArgumentsMatch(q, { low_months: given, high_months: given }, { low_months: stated, high_months: stated }) });
  if (v.kind === 'refused') return { kind: 'refused', refusal: v.refusal === 'origin_unknown' ? 'origin_unknown' : 'team_time_not_stated', detail: v.detail };
  // PL #94 6135017311: an end already recorded (its own press) combines with what the user says now; it is never asked again.
  const key = (x: UserStatement): string => `${x.form}|${x.low ?? ''}|${x.high ?? ''}|${plainWords(x.quote)}`;
  const statements = [...held.filter((h) => !v.statements.some((x) => key(x) === key(h))), ...v.statements];
  const ends = combineStatementEnds(statements);
  if (ends.kind === 'conflict') return { kind: 'refused', refusal: 'team_time_statements_conflict', detail: `No change was prepared. ${ends.detail}` };
  if (ends.kind === 'one_end') {
    // PL #94 6135017311: ONE end is recorded as that end (its own card), so readiness and the next step ask only for the other.
    if (held.some((h) => key(h) === key(ends.statement))) {
      return { kind: 'refused', refusal: 'team_time_needs_other_end', detail: `No change was prepared. ${statementReadingWords(ends.statement, 'months')} is already recorded. `
        + `Ask only for the ${ends.have === 'lower' ? 'latest' : 'soonest'} time with today's team, never for what the user already said.` };
    }
    const s = ends.statement;
    return { kind: 'found', confirmation: { source: s.source, quote: s.quote },
      time: { low_months: ends.value, high_months: ends.value, held_bound: { end: ends.have, months: ends.value }, statements } };
  }
  if (ends.kind === 'point') {
    const s = ends.statement;
    return { kind: 'found', confirmation: { source: s.source, quote: s.quote }, time: { ...withAssumedTeamRange({ low_months: ends.value, high_months: ends.value },
      s.quote, sentencesHolding(plainWords(s.source), plainWords(s.quote))), statements } };
  }
  const confirmation = { source: [...new Set(statements.map((s) => s.source))].join('\n'), quote: statements.map((s) => s.quote).join('\n') };
  if (!ends.low_qualified && !ends.high_qualified) return { kind: 'found', confirmation, time: { low_months: ends.low, high_months: ends.high, statements } };
  return { kind: 'found', confirmation, time: { ...likelyEndRange(ends.low, ends.high, ends.low_qualified, ends.high_qualified),
    range_origin: 'olumi_estimate', range_rule: 'likely_end', statements } };
}

export interface ApprovedTeamTime {
  readonly goal_id: string;
  readonly team_id: string;
  /**
   * B2-c: the card is Olumi's interpretation of the user's own words (`quotedTeamTime`), confirmed only by the press on it.
   * The source line and quote, verbatim, ride the card and the write; the press records a NEW selected forecast.
   */
  readonly confirmation?: TeamTimeConfirmation;
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
  /** S2: the user's verified statements (`teamTimeFromStatements`), stored whole with the time they give. */
  readonly statements?: readonly UserStatement[];
  /** S2: the one end the user gave, held as that end on the carrier (`teamObservedState`); never a level. */
  readonly held_bound?: { readonly end: 'lower' | 'upper'; readonly months: number };
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
  if (a.held_bound !== undefined) return { quantity: 'months_to_finish', held_bound: a.held_bound, unit: 'months', deadline: a.deadline,
    reference_date: a.reference_date, ...(a.statements !== undefined ? { statements: a.statements } : {}),
    ...(a.confirmation !== undefined ? { selection: confirmedSelection(a.confirmation) } : {}) };
  if (a.low_months === a.high_months) return { quantity: 'months_to_finish', most_likely: a.low_months,
    unit: 'months', deadline: a.deadline, reference_date: a.reference_date };
  const m = teamShareMoments(timeBetween(a.reference_date, a.deadline, 'months'), a.low_months, a.high_months);
  return { value: m.mean, std: m.sd, raw_value: m.mean * 100, unit, cap: 100, source: 'cee_inference',
    stated_time: { quantity: 'months_to_finish', low: a.low_months, high: a.high_months, unit: 'months',
      deadline: a.deadline, reference_date: a.reference_date,
      // EBD E2: the human forecast and its words (qualifier kept), apart from Olumi's assumed range. Never read back as theirs.
      // B2-c: a figure from a confirmation card is the user's SELECTION at the press (`user_confirmed`), never an earlier
      // human fact; its source line and Olumi's reading of it are linked beside it, unchanged.
      ...(a.forecast_months !== undefined && a.range_origin === 'olumi_estimate' ? {
        forecast: a.forecast_months, forecast_origin: a.confirmation !== undefined ? 'user_confirmed' : 'user',
        ...(a.forecast_words !== undefined ? { forecast_words: a.forecast_words } : {}),
        range_origin: 'olumi_estimate', range_rule: a.range_rule } : {}),
      // S2: a range Olumi assumed past the user's qualified end is Olumi's (`range_origin`), apart from their statements.
      ...(a.range_rule === 'likely_end' ? { range_origin: 'olumi_estimate', range_rule: 'likely_end' } : {}),
      ...(a.statements !== undefined ? { statements: a.statements } : {}),
      ...(a.confirmation !== undefined ? { selection: confirmedSelection(a.confirmation) } : {}) } };
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
  if (a.held_bound !== undefined) return { question: `Record ${heldBoundWords(a.held_bound)} for today's team?`,
    explanation: `The chance stays withheld until you give the ${a.held_bound.end === 'lower' ? 'latest' : 'soonest'} time too.` };
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
  if (a.held_bound !== undefined) return `Team time: ${heldBoundWords(a.held_bound)}, the other end still needed`;
  if (a.range_rule === 'likely_end') return `Team time: from your statements, Olumi’s assumed ${a.low_months}–${a.high_months}-month range`;
  if (a.statements !== undefined && a.forecast_months === undefined) return `Team time: ${a.low_months}–${a.high_months} months from your statements`;
  if (a.forecast_months !== undefined && a.range_origin === 'olumi_estimate') {
    const both = `Team time: your ${a.forecast_months}-month forecast, Olumi’s assumed ${a.low_months}–${a.high_months}-month range`;
    return both.length <= 80 ? both : `Team time: Olumi’s assumed ${a.low_months}–${a.high_months}-month range`;
  }
  return teamTimeCardParts(a, unit, deliverable).question.replace(/\?$/, '');
}
/**
 * ⭐ B2-c: the confirmation card, AIE #94 6132054663 verbatim: the user's complete source line, then the question; before the
 * press it is a proposed interpretation, never "your forecast". A single figure keeps the b1 disclosure of Olumi's assumed range
 * apart from the user's point and confidence (the AIE 6125204695 (3) clause and the b1 confidence sentence, existing words); a
 * range is the existing full-range card. The question is the edit fact's summary.
 */
export function teamTimeConfirmationCardParts(a: ApprovedTeamTime, deliverable: string): { readonly quoteLine: string; readonly question: string; readonly disclosure: string } {
  // A quote line only for words the user typed, verbatim; otherwise the card is Olumi's reading alone.
  const quoteLine = a.confirmation !== undefined && a.confirmation.source !== '' ? confirmationQuoteLine(a.confirmation) : '';
  if (a.statements !== undefined && a.forecast_months === undefined) return statementsCardParts(a, deliverable);
  if (a.forecast_months === undefined || a.range_origin !== 'olumi_estimate') {
    const { confirmation: _source, ...range } = a;
    const parts = teamTimeCardParts(range, '', deliverable);
    return { quoteLine, question: parts.question, disclosure: parts.explanation };
  }
  return { quoteLine,
    question: `Do you want to use ${a.forecast_months} months as your forecast for today's team to finish ${deliverable}?`,
    disclosure: `Olumi’s assumed ${a.low_months}–${a.high_months}-month range informs this approximate calculation; modelled outcomes can fall outside those time bounds.`
      + (a.range_rule === 'low_confidence' ? ' You described low confidence in that forecast.' : '') };
}
/**
 * S2: the card for a time read from the user's statements. Each statement's own line is quoted; Olumi's reading of it (its
 * form and qualifier) is said once, as theirs to adopt; an end Olumi assumed past a likely end is Olumi's, with its basis.
 */
/** Olumi's added assumption for each qualified end, in plain words ("8 in 10 chances it's done within 8 months"). */
function likelyEndWords(statements: readonly UserStatement[]): string {
  const chances = `${Math.round(TEAM_TIME_LIKELY_END.share_within * 10)} in 10 chances`;
  const used = statements.filter((s) => s.negated !== true && s.qualifier !== undefined);
  const high = used.find((s) => (s.form === 'upper_bound' || s.form === 'range') && s.high !== undefined)?.high;
  const low = used.find((s) => (s.form === 'lower_bound' || s.form === 'range') && s.low !== undefined)?.low;
  return [high === undefined ? '' : `${chances} it’s done within ${high} months`, low === undefined ? '' : `${chances} it takes at least ${low} months`]
    .filter((x) => x !== '').join(' and ');
}
const heldBoundWords = (b: { readonly end: 'lower' | 'upper'; readonly months: number }): string =>
  `your ${b.end === 'lower' ? 'lower' : 'upper'} end of ${b.months} months`;
function statementsCardParts(a: ApprovedTeamTime, deliverable: string): { readonly quoteLine: string; readonly question: string; readonly disclosure: string } {
  const statements = a.statements ?? [];
  if (a.held_bound !== undefined) {
    const said = statements.find((s) => s.form === (a.held_bound!.end === 'lower' ? 'lower_bound' : 'upper_bound') && (s.low ?? s.high) === a.held_bound!.months);
    return { quoteLine: said === undefined ? '' : `From your message: ‘${said.source}’`,
      question: `Do you want to record ${said === undefined ? heldBoundWords(a.held_bound) : statementReadingWords(said, 'months').replace(/^a /, 'your ')} for today's team to finish ${deliverable}?`,
      disclosure: `The model still needs the ${a.held_bound.end === 'lower' ? 'latest' : 'soonest'} time before it can run; Olumi will not assume it.` };
  }
  const lines = [...new Set(statements.map((s) => s.source))].map((l) => `‘${l}’`);
  const quoteLine = lines.length === 0 ? '' : `From your message${lines.length > 1 ? 's' : ''}: ${lines.join(' and ')}`;
  const readings = statements.filter((s) => s.negated !== true).map((s) => statementReadingWords(s, 'months').replace(/^a /, 'your ')).join(' and ');
  if (a.range_rule === 'likely_end') {
    return { quoteLine,
      question: `Do you want to use Olumi’s provisional model for today's team to finish ${deliverable}, based on ${readings}?`,
      disclosure: `A likely end is not a hard limit: Olumi assumes ${likelyEndWords(statements)}, so its range is ${a.low_months} to ${a.high_months} months. `
        + 'It informs this approximate calculation; modelled outcomes can fall outside those time bounds.' };
  }
  return { quoteLine,
    question: `Do you want to use ${a.low_months}–${a.high_months} months for today's team to finish ${deliverable}, from ${readings}?`,
    disclosure: 'The calculation uses bell-curve approximations of progress and can include outcomes outside those time bounds.' };
}
export function teamTimeConfirmationCard(a: ApprovedTeamTime, deliverable: string): string {
  const { quoteLine, question, disclosure } = teamTimeConfirmationCardParts(a, deliverable);
  return [quoteLine, question, disclosure].filter((t) => t !== '').join(' ');
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
