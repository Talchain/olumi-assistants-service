/**
 * ⭐ M4-cohort (SCIENCE): the science table's row T8 "Relation (same cohort)" on the ONE statement door (AIE 6176433015; the final
 * table 6180618773, row T8 and conflict C4). ONE option's cohort forecast from the user's own words, three statements on the
 * subject {kind: 'option', id, field: 'relation'}:
 *  · point: how many people the option reaches over the goal's window. A human point forecast is not certainty: Olumi holds it
 *    fixed only as its own explicit conditional scenario, said on the card the press adopts (C4);
 *  · range: the user's two estimates of the UNDERLYING conversion rate with about one chance in four below and one in four above,
 *    only as their answer to the one-in-four ask for THIS option and window (T2; the writer re-checks the ask's words);
 *  · holds_now: the user's answer that the count target counts converts among those same people. It answers the goal's
 *    same-people question (`launchWindowQuestion`), so it binds through the goal's relation ask (`answersFor`).
 * The Beta curve through the two estimates and the same-draw law are Olumi's approximation, said as such (T8). Pure.
 */
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { cohortTargetsOf, isCohortRateRow, readCohortForecast, type CohortForecast } from '../../goal-target/cohort-forecast.js';
import {
  applyCohortForecastEdit, applyStatementRecordEdit, approvedCohortForecastOf, approvedStatementRecordOf, asksQuartileQuestion, cohortFixedReachScenario,
  cohortQuartileQuestion, UNDERLYING_RATE_MEANING,
  cohortForecastAskWords, cohortForecastRecordedWords, cohortLawApproximation, cohortWindowOf, peopleFiguresIn, percentRangesIn,
  sameCohortLabelsOf, sameCohortRecordedWords, sameCohortStatementOf, storedTargetRowsOf, withoutPercentRanges,
  type ApprovedCohortForecast, type ApprovedStatementRecord,
} from '../../goal-target/cohort-forecast-write.js';
import { goalTargetBasisOf, launchWindowQuestion, periodWords } from '../../goal-target/goal-target-basis.js';
import type { StatementAsk } from '../ask.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const labelOf = (graph: unknown, id: unknown): string => String(nodesOf(graph).find((n) => n.id === id)?.label ?? id);
export const COHORT_RELATION_SIGNED_BY = '6180618773';

const byForm = (statements: readonly UserStatement[], form: UserStatement['form']): UserStatement[] => statements.filter((s) => s.form === form);
const sayPeople = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

/** The two targets the same-cohort answer joins: the percentage of the people reached, and the count of them. */
function rateAndCount(graph: unknown): { rate: Rec; count: Rec } | undefined {
  const rows = storedTargetRowsOf(graph);
  const rate = rows.filter(isCohortRateRow);
  const count = rows.filter((r) => !rate.includes(r));
  return rows.length === 2 && rate.length === 1 && count.length === 1 ? { rate: rate[0]!, count: count[0]! } : undefined;
}
const theGoal = (graph: unknown): Rec | undefined => {
  const goals = nodesOf(graph).filter((n) => n.kind === 'goal');
  return goals.length === 1 ? goals[0] : undefined;
};
/** The goal's relation subject: the one the same-people question is asked in. */
const goalRelationSubject = (graph: unknown): DoorSubject | undefined => {
  const goal = theGoal(graph);
  return typeof goal?.id === 'string' ? { kind: 'goal', id: goal.id, field: 'relation' } : undefined;
};
const applies = (subject: DoorSubject, graph: unknown): boolean => subject.kind === 'option' && subject.field === 'relation'
  && nodesOf(graph).some((n) => n.id === subject.id && n.kind === 'option') && cohortWindowOf(graph) !== undefined && rateAndCount(graph) !== undefined;

/**
 * Why two conversion figures were not recorded as the user's one-in-four estimates (AIE 6174707160 and 6176433015), with the coaching
 * the retired `propose_cohort_forecast` gave: keep their range as said, and offer a comparable past campaign instead of asking again.
 */
export const quartilesNotAskedDetail = (optionLabel: string, window: string): string =>
  `Two conversion figures are recorded as the user's own estimates only as their answer, in the message that answers it, to exactly: `
  + `"${cohortQuartileQuestion(optionLabel, window)}" (${UNDERLYING_RATE_MEANING}) Pass answering set to that question. A range they gave any `
  + 'other way is kept as they said it and is never read as these estimates. If they cannot judge those chances, keep their range as they '
  + 'said it and offer to look at the conversion of a comparable past campaign instead; do not keep asking. Nothing was prepared.';

export const COHORT_RELATION_ROW: RoleRow = {
  field: 'relation',
  unit: '',
  forms: ['point', 'range', 'holds_now'],
  carrier: 'cohort_forecast',
  maxStatements: 3,
  signed_by: COHORT_RELATION_SIGNED_BY,
  applies,
  answersFor: (subject, graph) => {
    const goal = applies(subject, graph) ? goalRelationSubject(graph) : undefined;
    return goal === undefined ? [] : [goal];
  },
  get writer() { return COHORT_FORECAST_WRITER; },
  answerTypedNow: { forms: ['range'], detail: (_subject, label, graph) => quartilesNotAskedDetail(label, cohortWindowOf(graph) ?? '') },
  read(quote, subject, graph) {
    if (!applies(subject, graph)) {
      return { refused: 'This forecast is only for an option, on a goal with a percentage and a count target over one window.' };
    }
    const ranges = percentRangesIn(quote);
    // A percentage range's own lower figure ("12 and 18%") is never a number of people: people are read outside the range's words.
    const people = peopleFiguresIn(withoutPercentRanges(quote));
    if (ranges.length === 1 && people.length === 0) return { form: 'range', low: ranges[0]!.low, high: ranges[0]!.high };
    if (people.length === 1 && ranges.length === 0) return { form: 'point', low: people[0]!.low, high: people[0]!.high };
    if (people.length === 0 && ranges.length === 0) return { form: 'holds_now' };
    return { refused: 'That statement holds more than one figure for this forecast, so it is kept as said.' };
  },
  readingWords(statements, _subject, label, graph) {
    const window = cohortWindowOf(graph) ?? '';
    const [conv] = byForm(statements, 'range');
    const [ppl] = byForm(statements, 'point');
    return [
      ...(conv === undefined ? [] : [`your estimates as about one chance in four below ${conv.low}% and one chance in four above ${conv.high}% `
        + `for the underlying conversion rate of ‘${label}’, among the people it reaches, during ${window}. These are your estimates, not a minimum and maximum`]),
      ...(ppl === undefined ? [] : [`your forecast that ‘${label}’ reaches ${sayPeople(ppl.low!)} during ${window}`]),
      ...(byForm(statements, 'holds_now').length === 0 ? [] : ['your answer that they come from the same people']),
    ].join('; ');
  },
  assumptions(statements, _subject, graph) {
    const pair = rateAndCount(graph);
    const [ppl] = byForm(statements, 'point');
    const window = cohortWindowOf(graph) ?? '';
    return [
      ...(ppl === undefined ? [] : [cohortFixedReachScenario(ppl.low!, window)]),
      cohortLawApproximation(pair === undefined ? 'conversion rate' : labelOf(graph, pair.rate.node_id)),
    ];
  },
  recordedWords(statements, _subject, label) {
    const [conv] = byForm(statements, 'range');
    const [ppl] = byForm(statements, 'point');
    return conv === undefined || ppl === undefined ? `Recorded from your words about ‘${label.trim()}’.`
      : cohortForecastRecordedWords(label, { people_reached: ppl.low!, conversion_middle_half_pct: [conv.low!, conv.high!] });
  },
};

/** The adapter onto the existing `cohort_forecast` door member: the three verified statements → the writer's approved record. */
export const COHORT_FORECAST_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const [conv, ...moreConv] = byForm(reading.statements, 'range');
    const [ppl, ...morePpl] = byForm(reading.statements, 'point');
    // The same-people answer is the goal's, once recorded there (`COHORT_SAME_PEOPLE_ROW`); else it comes with this reading.
    const [said, ...moreSame] = byForm(reading.statements, 'holds_now');
    const same = said ?? sameCohortStatementOf(graph);
    if (conv === undefined || ppl === undefined || same === undefined || moreConv.length + morePpl.length + moreSame.length > 0) {
      return { refused: 'incomplete: the forecast needs the people reached, the two conversion estimates and the same-people answer, one each.' };
    }
    const option = nodesOf(graph).find((n) => n.id === reading.subject.id && n.kind === 'option');
    const pair = rateAndCount(graph);
    const window = cohortWindowOf(graph);
    if (option === undefined || !applies(reading.subject, graph) || pair === undefined || window === undefined) return { refused: 'targets_not_cohort' };
    // ⛔ The range is the user's quartiles only as their answer to the one-in-four question for THIS option and window.
    if (!asksQuartileQuestion(conv.answering, cohortQuartileQuestion(String(option.label ?? ''), window))) {
      return { refused: quartilesNotAskedDetail(String(option.label ?? ''), window) };
    }
    const f: CohortForecast = { people_reached: ppl.low!, conversion_middle_half_pct: [conv.low!, conv.high!],
      same_cohort: { rate_target_node_id: String(pair.rate.node_id), count_target_node_id: String(pair.count.node_id), stated_by: 'user' },
      author: 'user' };
    if (cohortTargetsOf(storedTargetRowsOf(graph), f) === undefined) return { refused: 'targets_not_cohort' };
    const record = userStatementRecord(reading.subject, reading.statements, new Date().toISOString());
    // The writer re-checks the ask the range answered (`answering`, stamped by the door on the verified statement).
    const approved: ApprovedCohortForecast = { option_id: String(option.id), cohort_forecast: f, expected_node: structuredClone(option),
      expected_targets: structuredClone(storedTargetRowsOf(graph)), statements: { people: ppl, conversion: conv, same_cohort: same },
      user_statement: { subject: reading.subject, record } };
    const dry = applyCohortForecastEdit(graph, approved);
    if (dry.kind !== 'mutated') return { refused: dry.kind === 'refused' ? dry.reason : 'already_held' };
    return { member: 'cohort_forecast', payload: JSON.parse(JSON.stringify(approved)) as unknown };
  },
  /** The stored write's forecast and words, held on its option by identity (the read-back, and the retry's verified no-op). */
  holds(write: DoorWrite, after: unknown) {
    const approved = write.member === 'cohort_forecast' && isRec(write.payload) && typeof write.payload.option_id === 'string'
      ? approvedCohortForecastOf({ path: write.payload.option_id, value: write.payload }) : undefined;
    if (approved?.user_statement === undefined) return false;
    const held = readCohortForecast(nodesOf(after).find((n) => n.id === approved.option_id));
    return held !== undefined && JSON.stringify(held) === JSON.stringify(approved.cohort_forecast)
      && holdsUserStatement(after, approved.user_statement.record, approved.user_statement.subject);
  },
};

/**
 * The asks a cohort forecast answers, in the door's subjects, in the words readiness says them: each option's forecast questions
 * (`cohortForecastAskWords`: the people it reaches, then its one-in-four question), and the goal's same-people question.
 */
export function cohortForecastAsks(graph: unknown): StatementAsk[] {
  const window = cohortWindowOf(graph);
  const goal = goalRelationSubject(graph);
  const basis = goalTargetBasisOf(theGoal(graph));
  const labels = sameCohortLabelsOf(graph);
  if (window === undefined || goal === undefined || basis === undefined || labels === undefined) return [];
  // The same-people question in readiness's own words (`launchWindowQuestion`, target-testability's case (a)).
  const sameCohortQuestion = launchWindowQuestion(labels.rate, basis, labels.count);
  return [
    ...nodesOf(graph).filter((n) => n.kind === 'option' && typeof n.id === 'string')
      .map((n) => ({ subject: { kind: 'option', id: String(n.id), field: 'relation' } as DoorSubject,
        words: cohortForecastAskWords(labelOf(graph, n.id), periodWords(basis), window) })),
    { subject: goal, words: sameCohortQuestion },
  ];
}

const countLabelOf = (graph: unknown): string => sameCohortLabelsOf(graph)?.count ?? 'the count';
const rateLabelOf = (graph: unknown): string => sameCohortLabelsOf(graph)?.rate ?? 'the rate';
const appliesToGoal = (subject: DoorSubject, graph: unknown): boolean => subject.kind === 'goal' && subject.field === 'relation'
  && goalRelationSubject(graph)?.id === subject.id && cohortWindowOf(graph) !== undefined && rateAndCount(graph) !== undefined;

/**
 * ⭐ M4-cohort, T8 on the GOAL: the user's answer to the same-people question (`launchWindowQuestion`), one figure-free statement,
 * recorded on the goal. It is the relation between the goal's two targets, said once for every option. Olumi claims no law from
 * it (the same-draw approximation is said on each option's forecast card, T8).
 */
export const COHORT_SAME_PEOPLE_ROW: RoleRow = {
  field: 'relation',
  unit: '',
  forms: ['holds_now'],
  carrier: 'statement_record',
  maxStatements: 1,
  signed_by: COHORT_RELATION_SIGNED_BY,
  applies: appliesToGoal,
  get writer() { return GOAL_RELATION_WRITER; },
  read(quote, subject, graph) {
    if (!appliesToGoal(subject, graph)) return { refused: 'This is said of a goal with a percentage and a count target over one window.' };
    return percentRangesIn(quote).length > 0 || peopleFiguresIn(withoutPercentRanges(quote)).length > 0
      ? { refused: 'That statement holds a figure, so it is not the answer to whether both targets count the same people. It is kept as said.' }
      : { form: 'holds_now' };
  },
  // AIE 6182987896: only the relation the user answered, in the question's own words; no added definition of who converts.
  readingWords: (_s, _subject, _label, graph) => `your answer that your ‘${countLabelOf(graph)}’ come from the same people your ‘${rateLabelOf(graph)}’ is measured on`,
  assumptions: () => [],
  recordedWords: (_s, _subject, _label, graph) => sameCohortRecordedWords(graph),
};

/** The adapter onto the `statement_record` member: the ONE verified answer, recorded on the goal and read back by identity. */
export const GOAL_RELATION_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const goal = nodesOf(graph).find((n) => n.id === reading.subject.id && n.kind === 'goal');
    if (goal === undefined || !appliesToGoal(reading.subject, graph) || reading.statements.length !== 1) return { refused: 'targets_not_cohort' };
    const record = userStatementRecord(reading.subject, reading.statements, new Date().toISOString());
    const approved: ApprovedStatementRecord = { node_id: String(goal.id), expected_node: structuredClone(goal), user_statement: { subject: reading.subject, record } };
    const dry = applyStatementRecordEdit(graph, approved);
    if (dry.kind !== 'mutated') return { refused: dry.kind === 'refused' ? dry.reason : 'already_held' };
    return { member: 'statement_record', payload: JSON.parse(JSON.stringify(approved)) as unknown };
  },
  /** The stored write's words, held on its goal by identity. */
  holds(write: DoorWrite, after: unknown) {
    const approved = write.member === 'statement_record' && isRec(write.payload) && typeof write.payload.node_id === 'string'
      ? approvedStatementRecordOf({ path: write.payload.node_id, value: write.payload }) : undefined;
    return approved !== undefined && holdsUserStatement(after, approved.user_statement.record, approved.user_statement.subject);
  },
};
