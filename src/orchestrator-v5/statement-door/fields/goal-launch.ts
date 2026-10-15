/**
 * ⭐ THE LAUNCH DATE OF A LAUNCH-WINDOW GOAL, on the ONE statement door (DL 15 Oct, marketing widen3 S6 LOST; AIE #94 ask
 * 6187235962, option A). Served marketing widen3 (CEE 87d5f90e): Paul wrote "We have 6 months to launch our new features from last
 * Friday, and that's when the initial 3-month sales cycle starts." then "Last Friday was the 9th of October." The goal is measured
 * over the first three months after launch, so the launch date OPENS its window (it is never the goal's deadline:
 * `proposeGoalDeadline`'s `launch_opens_window`), and nothing could hold it: the reply said the timing was "noted here, not saved".
 *
 * This records the user's words on the goal (`statement_record`, the field `lead`: the window's start), with Olumi's reading of the
 * date they give (the ONE deadline calendar, `readStatedDeadline`: "6 months … from last Friday", counted from the day the user
 * dated, `readStatedWeekdayDate`) attested beside them and labelled Olumi's. It moves no Run input: the window, the targets and the
 * risk windows are unchanged (a held horizon beside a launch reading is a conflict, `riskOccurrenceWindowMonths`), and the chance of
 * a target measured from launch is still unbuilt (`LAUNCH_WINDOW_UNBUILT`), so the card and receipt say so. Pure.
 */
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { addMonths, readStatedDeadline, sayDate, type DeadlineReadOptions } from '../../goal-target/deadline-date.js';
import { applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord } from '../../goal-target/cohort-forecast-write.js';
import { launchWindowOf, periodWords, type GoalTargetBasis } from '../../goal-target/goal-target-basis.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Pending the AIE's confirmation of option A (#94 6187235962); replaced by the signing comment's id before merge. */
export const GOAL_LAUNCH_SIGNED_BY = '6187235962';
export const GOAL_LAUNCH_QUANTITY = 'launch_date';

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const goalOf = (subject: DoorSubject, graph: unknown): Rec | undefined =>
  nodesOf(graph).find((n) => n.kind === 'goal' && n.id === subject.id);

/** The goal's launch window (its validated target reading, measured over a period from launch), or `undefined`. */
export function launchWindowFor(subject: DoorSubject, graph: unknown): GoalTargetBasis | undefined {
  return subject.kind === 'goal' && subject.field === 'lead' ? launchWindowOf(goalOf(subject, graph)) : undefined;
}

/** Olumi's reading of the launch words: the date, the day it counts from (where the words count from one) and the window's end. */
export interface LaunchReading {
  readonly launch_date: string;
  readonly window_end: string;
  readonly counted_from?: string;
}

/**
 * The date the user's launch words give, by the ONE deadline calendar, and the window it opens. `today` is the caller's (no clock
 * here); `opts.lastWeekday` is the user's own dating of "last <weekday>". `undefined` when the words place no date.
 */
export function launchReadingOf(words: string, basis: GoalTargetBasis, today: string, opts: DeadlineReadOptions = {}): LaunchReading | undefined {
  const placed = readStatedDeadline(words, today, opts);
  if (placed === null || basis.period_months === undefined) return undefined;
  const from = opts.lastWeekday !== undefined && new RegExp(`\\blast\\s+${opts.lastWeekday.weekday}\\b`, 'i').test(words) ? opts.lastWeekday.date : undefined;
  return { launch_date: placed.date, window_end: addMonths(placed.date, basis.period_months), ...(from !== undefined ? { counted_from: from } : {}) };
}

/**
 * The user's own clause the launch words open, from the words to the end of that clause ("6 months" in "We have 6 months to launch
 * our new features from last Friday, and that's when …" → "6 months to launch our new features from last Friday"), so a start day the
 * user named is never dropped by a shorter quote (counting "6 months" from today would move the launch). `undefined` when the
 * words are not in the message or the clause is longer than the calendar reads.
 */
export function launchClauseOf(words: string, message: string): string | undefined {
  const at = message.toLowerCase().indexOf(words.trim().toLowerCase());
  if (words.trim() === '' || at < 0) return undefined;
  const rest = message.slice(at);
  const end = rest.search(/[,;.!?\n]/);
  const clause = (end < 0 ? rest : rest.slice(0, end)).trim();
  return clause.length <= 80 ? clause : undefined;
}

/** The card's reading of the launch, with the window it opens. */
export function launchReadingWords(label: string, basis: GoalTargetBasis, r: LaunchReading): string {
  return `‘${label.trim()}’ is measured ${periodWords(basis)}; your launch: ${sayDate(r.launch_date)}, so that window runs from `
    + `${sayDate(r.launch_date)} to ${sayDate(r.window_end)}`;
}

/** The separate Olumi interpretation the card rests on, and what the record does not change. */
export function launchAssumptionWords(words: string, r: LaunchReading): string[] {
  const counted = r.counted_from !== undefined ? `, counting from ${sayDate(r.counted_from)}, the date you gave` : '';
  return [`Olumi reads “${words}” as ${sayDate(r.launch_date)}${counted}.`,
    'This records your launch date with your words; it does not change the calculation yet.'];
}

/** The receipt after the confirmed write and read-back. */
export function launchRecordedWords(label: string, basis: GoalTargetBasis, r: LaunchReading): string {
  return `Recorded your launch date for ‘${label.trim()}’: ${sayDate(r.launch_date)}, from your words, with Olumi’s reading of the date kept `
    + `distinct. Your targets stay measured ${periodWords(basis)} (${sayDate(r.launch_date)} to ${sayDate(r.window_end)}); the calculation is unchanged.`;
}

/** The record the card writes: the user's statement(s) on the goal, with Olumi's reading of the date attested beside them. */
export function launchRecord(graph: unknown, goalId: string, statements: readonly UserStatement[], r: LaunchReading, at: string): ApprovedStatementRecord | undefined {
  const goal = nodesOf(graph).find((n) => n.kind === 'goal' && n.id === goalId);
  if (goal === undefined || statements.length < 1 || statements.length > 2) return undefined;
  const subject: DoorSubject = { kind: 'goal', id: goalId, field: 'lead' };
  const record = userStatementRecord(subject, statements, at, { reading: 'olumi', quantity: GOAL_LAUNCH_QUANTITY, launch_date: r.launch_date,
    window_end: r.window_end, ...(r.counted_from !== undefined ? { counted_from: r.counted_from } : {}) });
  return { node_id: goalId, expected_node: structuredClone(goal), user_statement: { subject, record } };
}

export const GOAL_LAUNCH_ROW: RoleRow = {
  field: 'lead',
  unit: '',
  forms: ['point', 'describes'],
  carrier: 'statement_record',
  maxStatements: 2,
  signed_by: GOAL_LAUNCH_SIGNED_BY,
  quantity: GOAL_LAUNCH_QUANTITY,
  // The date is Olumi's reading of the user's words, adopted by the press: "Use this reading" (AIE 6181498097).
  derives: true,
  applies: (subject, graph) => launchWindowFor(subject, graph) !== undefined,
  // The card is the host's (`proposeGoalDeadline`'s launch branch reads the date with the user's own dating of the day); a
  // statement proposed on its own is not read here.
  read: () => ({ refused: 'A launch date is recorded from the launch card: propose the user’s launch words with propose_goal_deadline.' }),
  readingWords: (statements, subject, label, graph) => {
    const basis = launchWindowFor(subject, graph);
    const r = basis === undefined ? undefined : readingOfStatements(statements, basis);
    return basis === undefined || r === undefined ? '' : launchReadingWords(label, basis, r);
  },
  assumptions: () => [],
  recordedWords: (statements, subject, label, graph) => {
    const basis = launchWindowFor(subject, graph);
    const r = basis === undefined ? undefined : readingOfStatements(statements, basis);
    return basis === undefined || r === undefined ? `Recorded your launch date for ‘${label.trim()}’.` : launchRecordedWords(label, basis, r);
  },
  get writer() { return GOAL_LAUNCH_WRITER; },
};

/**
 * The reading a launch statement carries: its `reference` is the date Olumi read the words as; the window's end is that date plus the
 * goal's own period (never stored as the user's); the day the words count from, where the user dated one, is the dating statement's.
 */
function readingOfStatements(statements: readonly UserStatement[], basis: GoalTargetBasis): LaunchReading | undefined {
  const s = statements.find((x) => x.subject.quantity === GOAL_LAUNCH_QUANTITY && typeof x.reference === 'string');
  if (s === undefined || basis.period_months === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(s.reference!)) return undefined;
  const dated = statements.find((x) => x !== s && typeof x.reference === 'string');
  return { launch_date: s.reference!, window_end: addMonths(s.reference!, basis.period_months),
    ...(dated?.reference !== undefined ? { counted_from: dated.reference } : {}) };
}

/** The adapter onto the `statement_record` member; the card's payload is prepared by the launch branch (`launchRecord`). */
export const GOAL_LAUNCH_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const basis = launchWindowFor(reading.subject, graph);
    const r = basis === undefined ? undefined : readingOfStatements(reading.statements, basis);
    const approved = r === undefined ? undefined
      : launchRecord(graph, reading.subject.id, reading.statements, r, new Date().toISOString());
    if (approved === undefined) return { refused: 'launch_not_applicable' };
    const dry = applyStatementRecordEdit(graph, approved);
    if (dry.kind !== 'mutated') return { refused: dry.kind === 'refused' ? dry.reason : 'already_held' };
    return { member: 'statement_record', payload: JSON.parse(JSON.stringify(approved)) as unknown };
  },
  holds(write: DoorWrite, after: unknown) {
    const approved = write.member === 'statement_record' && isRec(write.payload) && typeof write.payload.node_id === 'string'
      ? approvedStatementRecordOf({ path: write.payload.node_id, value: write.payload }) : undefined;
    return approved !== undefined && holdsUserStatement(after, approved.user_statement.record, approved.user_statement.subject);
  },
};
