/**
 * ⭐ M3a — THE GOAL'S MEASURE, on the ONE statement door (AIE #94 6180193788 §1; DL 14 Oct 23:06Z/23:09Z). Served hiring r4
 * (CEE e7f95dc6): Paul wrote "We measure productivity as story points completed per sprint." and nothing could record it; the
 * goal's reading kept "% of today's productivity" and the judge read the measure as lost.
 *
 * The statement defines the goal's quantity in its native unit. It never states today's level, the % reference or the period:
 * those come from the HELD target reading (`goal_target_basis`), which must already be a percentage change from today. On the
 * SAME reading, 100% becomes today's {measure} and each option's change {unit} of today's {measure}; the user's words are
 * recorded on the goal (`user_statements`) in the same commit, apart from Olumi's reading. A level target, or a change from any
 * other reference, is refused with its reason (no member here would carry it), and the words are kept.
 * The measure words are the Agent's reading of the quote, checked to be the user's own words inside it. Pure.
 */
import { UNIT_SCALE_CLASS_TOKENS } from '../../../cee/draft/records/unit-scale-class.js';
import { wordsTheUserWrote } from '../../agent-lane/stated-by-user.js';
import { sayGoalChange } from '../../agent-lane/limit-frame.js';
import { sayFigureWithoutRounding } from '../../agent-lane/say-figure.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { goalTargetBasisOf, periodWords, type GoalTargetBasis } from '../../goal-target/goal-target-basis.js';
import {
  answeredBasisOf, applyGoalReadingEdit, goalReadingProjectionOf, GOAL_READING_CONDITIONS_TEMPLATE, type ApprovedGoalReading,
  type GoalReadingMembers, type GoalReadingProjection,
} from '../../goal-target/goal-reading-write.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { currentStatementRetention, holdsUserStatement, userStatementOnNode, userStatementRecord, claimRecordOf } from '../statements.js';
import { subjectKey, type DoorSubject } from '../subject.js';
import type { FieldWriter } from '../write.js';
import { isDeepStrictEqual } from 'node:util';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const PERCENT_TOKENS: readonly string[] = UNIT_SCALE_CLASS_TOKENS.find(([cls]) => cls === 'percent')?.[1] ?? [];
export const MEASURE_SIGNED_BY = '6180193788';

interface HeldGoal {
  readonly node: Rec;
  readonly basis: GoalTargetBasis;
  readonly projection: GoalReadingProjection & { readonly target: NonNullable<GoalReadingProjection['target']> };
}

function heldGoal(graph: unknown, goalId: string): HeldGoal | undefined {
  const node = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId) : undefined;
  const basis = goalTargetBasisOf(node);
  const projection = goalReadingProjectionOf(graph, goalId);
  if (node === undefined || basis === undefined || projection?.target == null || projection.target.raw === undefined) return undefined;
  return { node, basis, projection: projection as HeldGoal['projection'] };
}

/** The held target is a percentage change from today, with its change in % of today's level: the reading a measure restates. */
const percentChangeFromToday = (h: HeldGoal): boolean => h.projection.target.frame !== undefined && h.projection.target.frame !== 'level'
  && h.basis.reference === 'today'
  && PERCENT_TOKENS.includes((h.projection.target.unit ?? '').trim().toLowerCase())
  && new RegExp(`^${(h.projection.target.unit ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+of\\b`, 'i').test(h.basis.effect_unit);

/** The members the measure sets on the SAME held reading. The reference is the held one ("today"), never the quote's. */
export function measureMembers(h: HeldGoal, measure: string): GoalReadingMembers {
  return { denominator: `today's ${measure}`, effect_unit: `${(h.projection.target.unit ?? '').trim()} of today's ${measure}` };
}

const quoteOf = (s: readonly UserStatement[]): string => s[0]?.quote ?? '';
/** The quote and its sentence end: a quote that already ends a sentence is not given a second full stop (the receipt's rule). */
const quoted = (s: readonly UserStatement[]): string => `“${quoteOf(s)}”${/[.?!]$/.test(quoteOf(s)) ? '' : '.'}`;
const changeOf = (h: HeldGoal): string | undefined => {
  const t = h.projection.target;
  return sayGoalChange(t.frame, t.raw!, t.unit, (v, u) => sayFigureWithoutRounding(v, u ?? ''), t.comparator);
};
const conditionsOf = (h: HeldGoal): string => {
  const also = h.basis.also_required ?? [];
  return also.length === 0 ? '' : ` ${GOAL_READING_CONDITIONS_TEMPLATE.replace('{conditions}', () => also.join('; ').replace(/\.$/, ''))}`;
};
const openOf = (h: HeldGoal): string => (h.basis.open_question !== undefined ? ` Still open: ${h.basis.open_question.trim().replace(/([^.?!])$/, '$1.')}` : '');

/**
 * The AIE's measurement card (6180193788 §1) in the ONE template (SESSION4 23:40Z: no per-field card): the reading is "‘{goal}’
 * measured in {measure}", and each further line is said once as an assumption line: the held target, what 100% means and the
 * change unit, the retained conditions, and the question still open.
 */
export function measureAssumptions(subject: DoorSubject, graph: unknown, measure?: string): string[] {
  const h = heldGoal(graph, subject.id);
  const change = h === undefined ? undefined : changeOf(h);
  if (h === undefined || change === undefined || measure === undefined) return [];
  const m = measureMembers(h, measure);
  return [`Your target remains ${change}, relative to today’s level, ${periodWords(h.basis)}.`,
    `Under this target reading, 100% means ${m.denominator}; each option’s change is expressed in ${m.effect_unit}.`,
    conditionsOf(h).trim(), openOf(h).trim()].filter((x) => x !== '');
}

/** The receipt (AIE 6180193788 §1, measurement receipt), said only after the matching committed read-back. No agent direction. */
export function measureRecordedWords(statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown, measure?: string): string {
  const h = heldGoal(graph, subject.id);
  const change = h === undefined ? undefined : changeOf(h);
  if (h === undefined || change === undefined || measure === undefined) return `Recorded your measurement definition: ${quoted(statements)}`;
  const m = measureMembers(h, measure);
  return `Recorded your measurement definition: ${quoted(statements)} The saved target reading is ‘${h.projection.label || label}’ measured in ${measure}, `
    + `${change}, relative to today’s level, ${periodWords(h.basis)}; 100% means ${m.denominator}, and each option’s change is in ${m.effect_unit}.`
    + `${conditionsOf(h)}${openOf(h)}`;
}

export const MEASURE_ROW: RoleRow = {
  field: 'measure',
  unit: '',
  forms: ['describes'],
  carrier: 'goal_reading',
  maxStatements: 1,
  signed_by: MEASURE_SIGNED_BY,
  applies: (subject) => subject.kind === 'goal',
  get writer() { return MEASURE_WRITER; },
  read: (quote, subject, graph, words) => {
    if (subject.kind !== 'goal') return { refused: 'A measure is said of the goal.' };
    const h = heldGoal(graph, subject.id);
    if (h === undefined) return { refused: 'The goal has no saved reading of its target for this to restate.' };
    if (!percentChangeFromToday(h)) {
      return { refused: `‘${h.projection.label}’’s target is not a percentage change from today, so what it is measured in does not change what its 100% means.` };
    }
    const w = typeof words === 'string' ? words.trim().replace(/[.,;:!?]+$/, '') : '';
    if (w === '' || w.length > 100 || /[\r\n]/.test(w) || !wordsTheUserWrote(w, quote)) {
      return { refused: `Give reading_words: the user’s own words for what ‘${h.projection.label}’ is measured in, copied from “${quote}”.` };
    }
    return { form: 'describes', words: w };
  },
  readingWords: (_s, subject, label, graph, words) => `‘${heldGoal(graph, subject.id)?.projection.label ?? label}’ measured in ${words ?? ''}`,
  assumptions: (_s, subject, graph, words) => measureAssumptions(subject, graph, words),
  // The combined target reading is Olumi's interpretation carrier (AIE 6180193788), so its button is "Use this reading".
  derives: true,
  recordedWords: measureRecordedWords,
};

/** The adapter onto the goal-reading member: the SAME held reading, its two members moved, and the user's words kept with it. */
export const MEASURE_WRITER: FieldWriter = {
  approve: (reading: DoorReading, graph: unknown) => {
    const h = heldGoal(graph, reading.subject.id);
    const s = reading.statements[0];
    if (h === undefined || s === undefined || reading.words === undefined || !percentChangeFromToday(h) || !isRec(h.node.goal_target_basis)) {
      return { refused: 'measure_not_applicable' };
    }
    const members = measureMembers(h, reading.words);
    const record = userStatementRecord(reading.subject, reading.statements, new Date().toISOString());
    const expected = h.node.goal_target_basis;
    const payload: ApprovedGoalReading = { goal_id: reading.subject.id, expected_basis: expected, expected_goal: h.projection, members,
      user_statement: { subject: reading.subject, record } };
    const written = applyGoalReadingEdit(graph, payload);
    if (written.kind === 'refused') return { refused: written.reason };
    const projected = written.kind === 'mutated' ? goalReadingProjectionOf(written.mutatedGraph, reading.subject.id) : h.projection;
    return { member: 'goal_reading', payload: JSON.parse(JSON.stringify(payload)) as unknown, expected: JSON.parse(JSON.stringify(projected ?? null)) as unknown };
  },
  /**
   * The read-back, from the stored write alone (a press reads it after the card was saved): the goal holds the answered reading,
   * the user's record exactly, and the projection the writer computed for it (`expected`).
   */
  holds: (write, after): boolean => {
    const payload = write.payload;
    if (!isRec(payload) || typeof payload.goal_id !== 'string' || !isRec(payload.expected_basis) || !isRec(payload.user_statement)
      || !isRec(payload.expected_goal)) return false;
    const record = claimRecordOf(payload.user_statement.record);
    const s = isRec(payload.user_statement.subject) ? payload.user_statement.subject : undefined;
    if (record === undefined || s === undefined || typeof s.id !== 'string' || s.field !== 'measure') return false;
    const subject: DoorSubject = { kind: 'goal', id: s.id, field: 'measure' };
    const basis = answeredBasisOf(payload.expected_basis, (isRec(payload.members) ? payload.members : undefined) as GoalReadingMembers | undefined);
    const node = isRec(after) && Array.isArray(after.nodes) ? after.nodes.find((n): n is Rec => isRec(n) && n.id === payload.goal_id) : undefined;
    return node !== undefined && isDeepStrictEqual(node.goal_target_basis, basis) && holdsUserStatement(after, record, subject)
      && isDeepStrictEqual(goalReadingProjectionOf(after, payload.goal_id), write.expected);
  },
};

/**
 * The measure the goal's held reading is read in, where the user's recorded statement defines it: the reading's denominator is
 * today's {measure}, and {measure} is the user's own words in a `measure` statement recorded on this goal. `undefined` otherwise
 * (the reading is in the goal's own label, or its measure is not the user's recorded one). For the reading's consumers.
 */
export function recordedMeasureOf(goal: unknown): string | undefined {
  const basis = goalTargetBasisOf(goal);
  if (!isRec(goal) || typeof goal.id !== 'string' || basis?.denominator === undefined) return undefined;
  const m = /^today['’]s\s+(.+)$/u.exec(basis.denominator.trim());
  if (m === null) return undefined;
  const key = subjectKey({ kind: 'goal', id: goal.id, field: 'measure' });
  const record = userStatementOnNode(goal, key);
  const current = record === undefined ? undefined : currentStatementRetention(record);
  return record !== undefined && record.field === 'measure' && (current === undefined
    ? record.statements.some(s => wordsTheUserWrote(m[1], s.quote))
    : current.complete && current.spans.some(s => s.origin === 'held_user_statement' && wordsTheUserWrote(m[1], s.text))) ? m[1] : undefined;
}
