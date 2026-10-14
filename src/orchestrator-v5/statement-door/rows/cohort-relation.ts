/**
 * ⭐ SYSTEM 4 row "Relation (same cohort)", as SYSTEM 1's door reads and writes it (M4-cohort; SCIENCE). ONE option's cohort
 * forecast from the user's own words, three statements on the subject {kind: 'option', id, field: 'relation'}:
 *  · point: how many people the option reaches over the goal's window (held fixed; System 4 conflict 4, open → fails closed);
 *  · range: the user's two estimates of the UNDERLYING conversion rate with about one chance in four below and one in four above
 *    (AIE #94 6176433015). Only a range bound to the one-in-four ask for THIS option and window is that; the door binds it by the
 *    ask's subject, and the writer re-checks the ask's words (`answering`);
 *  · holds_now: the user's answer that the count target counts converts among those same people (no independence assumed).
 * The Beta curve through the two estimates, and the binomial same-draw law, are Olumi's approximation, said as such.
 * NOT registered until the contract AMENDs (row lookup by subject; per-statement ask binding; `answering` stamped). Pure.
 */
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { cohortTargetsOf, isCohortRateRow, readCohortForecast, type CohortForecast } from '../../goal-target/cohort-forecast.js';
import { applyCohortForecastEdit, cohortQuartileQuestion, cohortWindowOf, peopleFiguresIn, percentRangesIn, storedTargetRowsOf, withoutPercentRanges,
  type ApprovedCohortForecast } from '../../goal-target/cohort-forecast-write.js';
import type { RoleRow } from '../role-table.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';
import type { DoorReading } from '../read.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const labelOf = (graph: unknown, id: unknown): string => String(nodesOf(graph).find((n) => n.id === id)?.label ?? id);

/** System 4 conflict 4 (people reached held at the stated point; its own uncertainty excluded): open until the AIE rules. */
export const COHORT_PEOPLE_POINT_SIGNED = false;

const byForm = (statements: readonly UserStatement[], form: UserStatement['form']): UserStatement[] => statements.filter((s) => s.form === form);
const sayPeople = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

/** The two targets the same-cohort answer joins: the percentage of the people reached, and the count of them. */
function rateAndCount(graph: unknown): { rate: Rec; count: Rec } | undefined {
  const rows = storedTargetRowsOf(graph);
  const rate = rows.filter(isCohortRateRow);
  const count = rows.filter((r) => !rate.includes(r));
  return rows.length === 2 && rate.length === 1 && count.length === 1 ? { rate: rate[0]!, count: count[0]! } : undefined;
}

export const COHORT_RELATION_ROW: RoleRow = {
  field: 'relation',
  unit: '',
  forms: ['point', 'range', 'holds_now'],
  read(quote: string, subject: DoorSubject, graph: unknown) {
    if (subject.kind !== 'option' || cohortWindowOf(graph) === undefined || rateAndCount(graph) === undefined) {
      return { refused: 'This forecast is only for an option, on a goal with a percentage and a count target over one window.' };
    }
    const ranges = percentRangesIn(quote);
    // A percentage range's own lower figure ("12 and 18%") is never a number of people: people are read outside the range's words.
    const outsideRanges = withoutPercentRanges(quote);
    const people = peopleFiguresIn(outsideRanges);
    if (ranges.length === 1 && people.length === 0) return { form: 'range', low: ranges[0]!.low, high: ranges[0]!.high };
    if (people.length === 1 && ranges.length === 0) return { form: 'point', low: people[0]!.low, high: people[0]!.high };
    if (people.length === 0 && ranges.length === 0) return { form: 'holds_now' };
    return { refused: 'That statement holds more than one figure for this forecast, so it is kept as said.' };
  },
  carrier: 'cohort_forecast',
  readingWords(statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown) {
    const window = cohortWindowOf(graph) ?? '';
    const [conv] = byForm(statements, 'range');
    const [ppl] = byForm(statements, 'point');
    const parts = [
      ...(conv === undefined ? [] : [`your estimates as about one chance in four below ${conv.low}% and one chance in four above ${conv.high}% `
        + `for ‘${label}’, among the people it reaches, during ${window}. These are your estimates, not a minimum and maximum`]),
      ...(ppl === undefined ? [] : [`‘${label}’ reaching ${sayPeople(ppl.low!)} during ${window}`]),
      ...(byForm(statements, 'holds_now').length === 0 ? [] : [`the customers being counted among those same people, as you said`]),
    ];
    return parts.join('; ');
  },
  assumptions(statements: readonly UserStatement[], _subject: DoorSubject, graph: unknown) {
    const pair = rateAndCount(graph);
    const rateLabel = pair === undefined ? 'conversion rate' : labelOf(graph, pair.rate.node_id);
    return [
      `Olumi’s approximation, not yours: the underlying ‘${rateLabel}’ is treated as a smooth curve (a Beta distribution) through your two `
        + 'estimates, and each person converts or not at that same chance. If no such curve fits them, no chance is given for this option.',
      ...(byForm(statements, 'point').length === 0 ? [] : ['The number reached is held fixed, so its own uncertainty is not included.']),
    ];
  },
  recordedWords(statements: readonly UserStatement[], _subject: DoorSubject, label: string) {
    const [conv] = byForm(statements, 'range');
    const [ppl] = byForm(statements, 'point');
    return `Recorded from your words: ‘${label.trim()}’ reaches ${sayPeople(ppl?.low ?? 0)}, with about one chance in four that its `
      + `underlying conversion rate is below ${conv?.low}% and one in four that it is above ${conv?.high}%.`;
  },
  maxStatements: 3,
  signed_by: '6176433015',
};

/** The adapter onto the existing `cohort_forecast` door member: the three verified statements → the writer's approved record. */
export const cohortForecastWriter = (peoplePointSigned: boolean): FieldWriter => ({
  member: 'cohort_forecast',
  approve(reading: DoorReading, graph: unknown): DoorWrite | { readonly refused: string } {
    if (!peoplePointSigned) return { refused: 'conflict_open: holding the people reached at one stated figure awaits its science ruling (System 4 conflict 4).' };
    const [conv, ...moreConv] = byForm(reading.statements, 'range');
    const [ppl, ...morePpl] = byForm(reading.statements, 'point');
    const [same, ...moreSame] = byForm(reading.statements, 'holds_now');
    if (conv === undefined || ppl === undefined || same === undefined || moreConv.length + morePpl.length + moreSame.length > 0) {
      return { refused: 'incomplete: the forecast needs the people reached, the two conversion estimates and the same-people answer, one each.' };
    }
    const option = nodesOf(graph).find((n) => n.id === reading.subject.id && n.kind === 'option');
    const window = cohortWindowOf(graph);
    const pair = rateAndCount(graph);
    if (option === undefined || window === undefined || pair === undefined) return { refused: 'targets_not_cohort' };
    const f: CohortForecast = { people_reached: ppl.low!, conversion_middle_half_pct: [conv.low!, conv.high!],
      same_cohort: { rate_target_node_id: String(pair.rate.node_id), count_target_node_id: String(pair.count.node_id), stated_by: 'user' },
      author: 'user' };
    if (cohortTargetsOf(storedTargetRowsOf(graph), f) === undefined) return { refused: 'targets_not_cohort' };
    // The writer re-checks the ask the range answered (`answering`, stamped by the door from the bound ask's words).
    const statements = { people: ppl, conversion: { ...conv, ...(conv.answering === undefined ? {} : { answering: conv.answering }) }, same_cohort: same };
    const approved: ApprovedCohortForecast = { option_id: String(option.id), cohort_forecast: f, expected_node: structuredClone(option),
      expected_targets: structuredClone(storedTargetRowsOf(graph)), statements };
    const dry = applyCohortForecastEdit(graph, approved);
    if (dry.kind !== 'mutated') return { refused: dry.kind === 'refused' ? dry.reason : 'already_held' };
    return { member: 'cohort_forecast', payload: approved,
      holds: (after: unknown) => {
        const node = nodesOf(after).find((n) => n.id === approved.option_id);
        const held = readCohortForecast(node);
        return held !== undefined && JSON.stringify(held) === JSON.stringify(f);
      } };
  },
});
export const COHORT_FORECAST_WRITER: FieldWriter = cohortForecastWriter(COHORT_PEOPLE_POINT_SIGNED);

/** The ask for one option's forecast, in the door's subject (target-testability says these words). */
export const cohortForecastAsk = (graph: unknown, optionId: string): { subject: DoorSubject; words: string } | undefined => {
  const window = cohortWindowOf(graph);
  return window === undefined ? undefined
    : { subject: { kind: 'option', id: optionId, field: 'relation' }, words: cohortQuartileQuestion(labelOf(graph, optionId), window) };
};
