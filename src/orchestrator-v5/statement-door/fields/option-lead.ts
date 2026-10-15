/**
 * ⭐ M3c — WHEN AN OPTION'S EFFECT IS FULLY IN PLACE, per option, on the ONE statement door (AIE #94 6181933060; spike S8 route B).
 * Served hiring negative r4 (CEE e7f95dc6): "The tech lead would lift productivity from month 2, and each developer from month 2."
 * Only the goal-wide forecast (M3b, `goal-timing.ts`) could be recorded, so the Run withheld every chance at month 3.
 *
 * The forecast is about ONE option (field `lead`): L, the month its effect is FULLY in place, on the target's own reference.
 *  - "from month 2", "in 2 months": L = 2. "by month 2", "within 2 months": L ≤ 2. "between 2 and 4 months": 2 ≤ L ≤ 4.
 *    "not until month 4", "at least 4 months": L ≥ 4. "won't be in place by month 4": L > 4 (a denial bounds it from below).
 *  - A conditional forecast is recorded as said and attests nothing.
 *  - Words with no reference are read on the target's own reference, and that reading is disclosed; another reference is asked.
 * Classified by ONE rule (`classifyOptionLead`): L ≤ M → in place at M; L > M → not in place at M; a span across M → neither.
 * The k law never applies to a level at M. The words are recorded on the option (`statement_record`), with Olumi's reading of
 * the months and the fingerprint of what the forecast was about (`timingFingerprintOf`: any change → stale). Pure.
 */
import { coordinateClausesOf } from '../../agent-lane/link-effect-option-statement.js';
import { factorTheUserNamed } from '../../agent-lane/stated-by-user.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import {
  applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord,
} from '../../goal-target/cohort-forecast-write.js';
import { monthNumber, periodEndWords, type GoalTargetBasis } from '../../goal-target/goal-target-basis.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';
import {
  AFTER_LAUNCH, classifyOptionLead, effectOptions, FROM_TODAY, heldTiming, inQuote, optionEffectsOn, optionLeadOf, optionLeadWords, referenceWords, stanceOf,
  timingAskOf, timingFingerprintOf, type OptionLead, type TimingStance,
} from './goal-timing.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const OPTION_LEAD_SIGNED_BY = '6181933060';

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const theGoal = (graph: unknown): Rec | undefined => {
  const goals = nodesOf(graph).filter((n) => n.kind === 'goal');
  return goals.length === 1 && typeof goals[0]!.id === 'string' ? goals[0] : undefined;
};
const goalIdOf = (graph: unknown): string | undefined => theGoal(graph)?.id as string | undefined;
const held = (graph: unknown): ReturnType<typeof heldTiming> => {
  const goalId = goalIdOf(graph);
  return goalId === undefined ? undefined : heldTiming(graph, goalId);
};

/** "not until", "not before", "no earlier than": a lower bound, said affirmatively (its "not" is no denial of the forecast). */
const LOWER = /\b(?:not (?:until|before)|no (?:earlier|sooner) than|at (?:the )?earliest|at least|or later)\b|\b(?:won['’]t|wouldn['’]t|will not|would not|isn['’]t|aren['’]t)\b[^.;,]*?\buntil\b/i;
/** "by", "within", "no later than", "before": an upper bound only (it could be sooner). */
const UPPER = /\b(?:by|within|no later than|in (?:under|less than)|before|inside)\b/i;

/** Olumi's reading of ONE statement's reading words: its months, its form, its reference and its stance. */
interface LeadReading {
  readonly form: 'point' | 'range' | 'upper_bound' | 'lower_bound';
  readonly low?: number;
  readonly high?: number;
  readonly low_exclusive?: boolean;
  readonly reference: 'today' | 'launch' | undefined;
  readonly stance: TimingStance;
  readonly words: string;
}
function leadReading(quote: string, words: string | undefined): LeadReading | { readonly refused: string } {
  const w = typeof words === 'string' ? words.trim().replace(/[.,;:!?]+$/, '') : '';
  const months = [...w.matchAll(/(?<![\d.])(\d{1,2})(?![\d.])/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 60);
  if (w === '' || w.length > 200 || !inQuote(w, quote) || months.length === 0 || months.length > 2) {
    return { refused: `Give reading_words: the user’s own words for when this option’s effect is fully in place, with its month figure(s), copied from “${quote}”.` };
  }
  const reference = FROM_TODAY.test(w) ? 'today' as const : AFTER_LAUNCH.test(w) ? 'launch' as const : undefined;
  // The statement's own semantics (the shared NEGATED/CONDITIONAL), read on the clause the months are in ("A by month 6, but the
  // chatbot wouldn't be ready until month 8" denies nothing about A); a lower bound's "not until" is not a denial. A condition
  // stated anywhere in the sentence ("If we hire before November, …") governs every clause after it.
  // "won't be ready until month 8" is a lower bound too (ready at month 8, not before): its "won't" denies nothing.
  const clause = coordinateClausesOf(quote).find((c) => inQuote(w, c)) ?? quote;
  const unbounded = (t: string): string => t.replace(new RegExp(LOWER.source, 'gi'), ' ');
  const conditional = stanceOf(unbounded(quote)) === 'conditional' || stanceOf(unbounded(clause)) === 'conditional';
  const stance: TimingStance = conditional ? 'conditional' : stanceOf(unbounded(clause));
  if (months.length === 2) {
    const [a, b] = [Math.min(...months), Math.max(...months)];
    return { form: 'range', low: a, high: b, reference, stance, words: w };
  }
  const n = months[0]!;
  if (stance === 'denied') return { form: 'lower_bound', low: n, low_exclusive: true, reference, stance, words: w };
  if (LOWER.test(w)) return { form: 'lower_bound', low: n, reference, stance, words: w };
  if (UPPER.test(w)) return { form: 'upper_bound', high: n, reference, stance, words: w };
  return { form: 'point', low: n, high: n, reference, stance, words: w };
}

/** The reading the attest records: the months, whether the reference was the target's own by assumption, and the stance. */
function leadOfReading(r: LeadReading): Omit<OptionLead, 'record'> & { readonly reference_assumed?: boolean } {
  return { ...(r.low !== undefined ? { low: r.low } : {}), ...(r.high !== undefined ? { high: r.high } : {}),
    ...(r.low_exclusive === true ? { low_exclusive: true } : {}), ...(r.reference === undefined ? { reference_assumed: true } : {}), stance: r.stance };
}

/** The levers an option sets on the goal's path (the factors whose links reach the goal). */
function leversOf(graph: unknown, option: Rec): Set<string> {
  const goalId = goalIdOf(graph);
  const set = new Set(isRec(option.interventions) ? Object.keys(option.interventions) : []);
  return new Set(goalId === undefined ? [] : optionEffectsOn(graph, goalId).map((e) => String(e.from)).filter((f) => set.has(f)));
}

/**
 * The ONE clause of the quote that names this option, by the lane's own label reader (`factorTheUserNamed`), as the link-effect
 * door reads served hiring r4 (#3146): the options that set the SAME lever on the goal's path are one group ("each developer"
 * names "Hire two developers" and "Hire one developer" alike); a clause names the group when it names one of them by words no
 * other option shares, and names no option outside it. The clause must hold the reading words. Anything else binds nothing.
 */
export function clauseNamingOption(graph: unknown, optionId: string, quote: string, words: string): string | undefined {
  const options = effectOptions(graph).concat(nodesOf(graph).filter((n) => n.kind === 'option' && n.is_baseline === true));
  const self = options.find((o) => o.id === optionId);
  if (self === undefined) return undefined;
  const mine = leversOf(graph, self);
  const group = options.filter((o) => o.id === optionId || [...leversOf(graph, o)].some((l) => mine.has(l)));
  const others = options.filter((o) => !group.includes(o));
  const label = (o: Rec): string => String(o.label ?? '');
  const namesGroup = (clause: string): boolean => group.some((o) => factorTheUserNamed(label(o), clause, { options: others.map(label), others: [] }));
  const namesOther = (clause: string): boolean => others.some((o) => factorTheUserNamed(label(o), clause,
    { options: options.filter((x) => x.id !== o.id).map(label), others: [] }));
  const governing = coordinateClausesOf(quote).filter((c) => namesGroup(c) && !namesOther(c) && inQuote(words, c));
  return governing.length === 1 ? governing[0] : undefined;
}

const applies = (subject: DoorSubject, graph: unknown): boolean => subject.kind === 'option' && subject.field === 'lead'
  && held(graph) !== undefined && effectOptions(graph).some((o) => o.id === subject.id);

/** What the classification means at the target's month, said once (card and receipt). */
function atEndWords(lead: Omit<OptionLead, 'record'>, basis: GoalTargetBasis): string {
  const end = periodEndWords(basis);
  const kind = classifyOptionLead(lead, basis.period_months);
  return kind === 'in_place' ? `That is by ${end}, so its chance at ${end} can use your forecast.`
    : kind === 'later' ? `That is after ${end}, so its chance at ${end} is not part of the scored set; it stays in the model.`
      : kind === 'straddles' ? `That span includes ${end}, so no single chance at ${end} can be said for it.`
        : `It depends on the condition you stated, so no chance at ${end} treats it as in place.`;
}

const sayLead = (lead: Omit<OptionLead, 'record'>, basis: GoalTargetBasis): string =>
  `${lead.stance === 'denied' ? 'not fully in place' : 'fully in place'} ${lead.stance === 'denied' ? `by ${monthNumber(lead.low!)}` : optionLeadWords(lead)} ${referenceWords(basis)}`;

function readingOf(statements: readonly UserStatement[], words: string | undefined): LeadReading | undefined {
  if (statements.length !== 1) return undefined;
  const r = leadReading(statements[0]!.quote, words);
  return 'refused' in r ? undefined : r;
}

export const OPTION_LEAD_ROW: RoleRow = {
  field: 'lead',
  unit: 'months',
  forms: ['point', 'range', 'upper_bound', 'lower_bound'],
  carrier: 'statement_record',
  maxStatements: 1,
  signed_by: OPTION_LEAD_SIGNED_BY,
  // The months, the step at L and "everything else at today's level" are Olumi's reading of the words: "Use this reading".
  derives: true,
  applies,
  // An answer to the goal's ONE timing ask may be about one option ("The tech lead would lift productivity from month 2").
  answersFor: (subject, graph) => {
    const goalId = goalIdOf(graph);
    return applies(subject, graph) && goalId !== undefined && timingAskOf(graph, goalId) !== undefined ? [{ kind: 'goal', id: goalId, field: 'lead' }] : [];
  },
  get writer() { return OPTION_LEAD_WRITER; },
  // Bound by the ONE clause that names this option's group and holds the reading words (`clauseNamingOption`); otherwise by the
  // door's usual rules (the words, the selection, or the ask it answers).
  bindsWhole: (quote, subject, graph, words) => typeof words === 'string' && clauseNamingOption(graph, subject.id, quote,
    words.trim().replace(/[.,;:!?]+$/, '')) !== undefined,
  read: (quote, subject, graph, words) => {
    const h = held(graph);
    if (!applies(subject, graph) || h === undefined) return { refused: 'This forecast is for an option with an effect on a goal read at its target’s end.' };
    const r = leadReading(quote, words);
    if ('refused' in r) return r;
    if (r.reference !== undefined && r.reference !== h.basis.reference) {
      return { refused: `Not yet clear: whether ${monthNumber((r.low ?? r.high)!)} is ${referenceWords(h.basis)}, which is when this target is evaluated.` };
    }
    // The clause the months are written in binds the option ("…, and each developer from month 2"), never the whole sentence.
    const clause = clauseNamingOption(graph, subject.id, quote, r.words) ?? coordinateClausesOf(quote).find((c) => inQuote(r.words, c)) ?? quote;
    return { form: r.form, ...(r.low !== undefined ? { low: r.low } : {}), ...(r.high !== undefined ? { high: r.high } : {}), words: r.words, clause };
  },
  readingWords: (statements, _subject, label, graph, words) => {
    const h = held(graph);
    const r = readingOf(statements, words);
    if (h === undefined || r === undefined) return '';
    return `your forecast${r.stance === 'conditional' ? ', under the condition you stated,' : ''} that ‘${label.trim()}’ would be ${sayLead(leadOfReading(r), h.basis)}`;
  },
  assumptions: (statements, _subject, graph, words) => {
    const h = held(graph);
    const r = readingOf(statements, words);
    if (h === undefined || r === undefined) return [];
    return [
      ...(r.reference === undefined ? [`“${r.words}” is read as counted ${referenceWords(h.basis)}, as your target is.`] : []),
      'Olumi reads the effect as fully in place from that point, with no further build-up after it, and holds everything else at today’s level.',
      atEndWords(leadOfReading(r), h.basis),
    ];
  },
  recordedWords: (statements, subject, label, graph, words) => {
    const h = held(graph);
    const r = readingOf(statements, words);
    // At the press the card carries the words, not Olumi's reading of them: the written record on the option holds that reading.
    const lead = r !== undefined ? leadOfReading(r) : optionLeadOf(graph, subject.id);
    if (h === undefined || lead === undefined) return `Recorded your forecast for ‘${label.trim()}’.`;
    return `Recorded your forecast: ‘${label.trim()}’ ${sayLead(lead, h.basis)}. ${atEndWords(lead, h.basis)}`;
  },
};

/** The adapter onto the `statement_record` member: the words on the option, with Olumi's reading of the months and the fingerprint. */
export const OPTION_LEAD_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const goalId = goalIdOf(graph);
    const option = nodesOf(graph).find((n) => n.kind === 'option' && n.id === reading.subject.id);
    const r = readingOf(reading.statements, reading.words);
    const fingerprint = goalId === undefined ? undefined : timingFingerprintOf(graph, goalId);
    if (option === undefined || r === undefined || fingerprint === undefined || !applies(reading.subject, graph)) return { refused: 'lead_not_applicable' };
    const lead = leadOfReading(r);
    const record = userStatementRecord(reading.subject, reading.statements, new Date().toISOString(), {
      fingerprint, ...(lead.low !== undefined ? { month_low: lead.low } : {}), ...(lead.high !== undefined ? { month_high: lead.high } : {}),
      ...(lead.low_exclusive === true ? { low_exclusive: true } : {}), ...(lead.reference_assumed === true ? { reference_assumed: true } : {}),
      ...(lead.stance !== 'affirmed' ? { stance: lead.stance } : {}) });
    const approved: ApprovedStatementRecord = { node_id: String(option.id), expected_node: structuredClone(option), user_statement: { subject: reading.subject, record } };
    const dry = applyStatementRecordEdit(graph, approved);
    if (dry.kind !== 'mutated') return { refused: dry.kind === 'refused' ? dry.reason : 'already_held' };
    return { member: 'statement_record', payload: JSON.parse(JSON.stringify(approved)) as unknown };
  },
  /** The stored write's words, held on its option by identity. */
  holds(write: DoorWrite, after: unknown) {
    const approved = write.member === 'statement_record' && isRec(write.payload) && typeof write.payload.node_id === 'string'
      ? approvedStatementRecordOf({ path: write.payload.node_id, value: write.payload }) : undefined;
    return approved !== undefined && holdsUserStatement(after, approved.user_statement.record, approved.user_statement.subject);
  },
};
