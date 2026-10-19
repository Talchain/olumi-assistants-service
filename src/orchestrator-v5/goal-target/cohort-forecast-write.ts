/**
 * ⭐ AIE SAME-COHORT LAW, THE WRITER (science PR-4b; the reader and the licence are `cohort-forecast.ts` / `goal-targets-joint.ts`).
 *
 * Marketing's two targets ("conversion over 15% AND 20 new customers within the first three months after launch") can be
 * scored together only on ONE cohort: how many people an option reaches over the window, and how likely they are to convert.
 * This is the one writer of an option's `cohort_forecast`, from the user's own words only:
 *  · the people reached, ONE figure the user stated for that option (S2 statement, form `point`);
 *  · the UNDERLYING conversion rate (the chance that one person in that cohort converts, never the realised fraction) as the
 *    two estimates the user gave in answer to Olumi's ONE explicit question for THIS option, cohort and window: about one
 *    chance in four below the lower and one in four above the upper, i.e. their own quartiles (S2 statement, form `range`,
 *    `answering` exactly {@link cohortQuartileQuestion}, typed in the very turn that answers it). A range given any other way,
 *    or an answer to an earlier even-chance question, is never read as quartiles: no automatic percentile, min–max, 90%
 *    interval or tail split (AIE #94 6174707160; AIE 6176433015 amending SCIENCE's option A). Only the press records them;
 *  · the user's own answer that the count target counts converts among those same people (S2, verified quote). Without it the
 *    targets' dependence is unknown and nothing is written (no independence is assumed).
 * Reached ONLY through the atomic level door's `cohort_forecast` member, alone in its commit, after the user pressed the card
 * (card-only, `hasCardOnlyOperations`). The node as stored and the two target rows are the stale gate. Pure.
 */
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { saidByOf, userStatementOf, type UserStatement } from '../agent-lane/user-statements.js';
import { cohortTargetsOf, isCohortRateRow, readCohortForecast, type CohortForecast } from './cohort-forecast.js';
import { goalTargetBasisOf, periodWords } from './goal-target-basis.js';
import { applyStatementCorrection, statementCorrectionOf, type StatementCorrection, holdsUserStatement, pressedRecord, userStatementFor, claimRecordOf, withUserStatement, type UserStatementRecord } from '../statement-door/statements.js';
import { isStatementField, subjectKey, SUBJECT_KINDS, type DoorSubject, type SubjectKind } from '../statement-door/subject.js';
import { GOAL_TARGET_ROLE } from './goal-targets-joint.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The proposal op (`proposal.ts`): `path` is the option's id, `value` is what {@link approvedCohortForecastOf} reads. */
export const SET_COHORT_FORECAST_OP = 'set_cohort_forecast' as const;

/** What the card carries and the door writes. */
export interface ApprovedCohortForecast {
  readonly option_id: string;
  readonly cohort_forecast: CohortForecast;
  /** The option node exactly as stored when the card was made: the stale gate. */
  readonly expected_node: Readonly<Rec>;
  /** The two target rows exactly as stored when the card was made (the thresholds the forecast is read against). */
  readonly expected_targets: readonly Readonly<Rec>[];
  /** The user's verified words: the people reached, the conversion range, and the same-cohort answer. */
  readonly statements: { readonly people: UserStatement; readonly conversion: UserStatement; readonly same_cohort: UserStatement };
  /** THIS proposal's own write already landed: only then is a node holding exactly the card's forecast a verified no-op. */
  readonly own_write_landed?: boolean;
  /**
   * ⭐ SYSTEM 1 (DL 14 Oct 23:09Z, ONE durable statement store): the user's verified statements a door press records on THIS
   * option (`user_statements`), in the same commit as its forecast. Absent on the legacy card's press.
   */
  readonly user_statement?: { readonly subject: DoorSubject; readonly record: UserStatementRecord };
}

/** The stored goal-target rows of `graph` (`role: 'goal_target'`), in stored order. */
export function storedTargetRowsOf(graph: unknown): Rec[] {
  const rows: unknown = isRec(graph) ? graph.goal_constraints : undefined;
  return (Array.isArray(rows) ? rows : []).filter((r): r is Rec => isRec(r) && r.role === GOAL_TARGET_ROLE);
}

/** Whole numbers of people a quote states ("about 500 people", "1,200"). Each is one figure (a point has both ends equal). */
export function peopleFiguresIn(quote: string): { low: number; high: number }[] {
  return [...quote.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?![\d.,]*\d)(?!\s*(?:%|percent|per\s*cent))/giu)]
    .map((m) => Number(m[1]!.replace(/,/g, ''))).filter((n) => Number.isInteger(n) && n >= 1).map((n) => ({ low: n, high: n }));
}

/** The ONE percentage-range pattern ("12–18%", "between 12 and 18 percent", "12% to 18%"). */
const percentRangePattern = (): RegExp => {
  const n = '(\\d{1,2}(?:\\.\\d{1,2})?)';
  const pct = '\\s*(?:%|percent|per\\s*cent)';
  return new RegExp(`(?:between\\s+)?${n}(?:${pct})?\\s*(?:–|—|-|to|and)\\s*${n}${pct}`, 'giu');
};

/** Percentage ranges a quote states, low below high. */
export function percentRangesIn(quote: string): { low: number; high: number }[] {
  return [...quote.matchAll(percentRangePattern())].map((m) => ({ low: Number(m[1]), high: Number(m[2]) })).filter((r) => r.low > 0 && r.low < r.high && r.high < 100);
}

/** The quote with its percentage ranges' own words removed (so a range's lower figure is never read as something else). */
export const withoutPercentRanges = (quote: string): string => quote.replace(percentRangePattern(), ' ');

/** The goal's window as the forecast is read over it ("the first three months after launch"), or `undefined` without one goal. */
export function cohortWindowOf(graph: unknown): string | undefined {
  const goals = (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : []).filter((n): n is Rec => isRec(n) && n.kind === 'goal');
  const basis = goals.length === 1 ? goalTargetBasisOf(goals[0]) : undefined;
  return basis?.period_kind === 'over_period' ? periodWords(basis).replace(/^over /, '') : undefined;
}

/**
 * Olumi's ONE question whose answer is the user's own quartiles of the underlying conversion rate, AIE 6176433015's exact
 * words with THIS option, cohort and window filled in (the reading's only door). It is never asked for another quantity.
 */
export const cohortQuartileQuestion = (optionLabel: string, window: string): string =>
  `For ‘${optionLabel.trim()}’, among the people it reaches during ${window}, what lower and upper estimates of the underlying `
  + 'conversion rate would leave, in your judgement, about a one-in-four chance that the rate is below the lower estimate and a '
  + 'one-in-four chance that it is above the upper estimate?';

/** The meaning the question rests on, said beside it (AIE 6176433015): the chance per person, not the fraction that results. */
export const UNDERLYING_RATE_MEANING = 'Here the underlying conversion rate is the chance that any one of those people converts.';

/**
 * ⭐ Science PR-4b, AIE 6176433015: ONE option's two forecast questions as Olumi says them (readiness's step, and the door's ask
 * in the option's relation subject): the people it reaches, then the one-in-four question for that option, cohort and window,
 * with the meaning of "underlying conversion rate" beside it.
 */
export const cohortForecastAskWords = (option: string, period: string, window: string): string =>
  `For ‘${option}’: how many people would it reach ${period}? ${cohortQuartileQuestion(option, window)} ${UNDERLYING_RATE_MEANING}`;

/** A question as compared: quote marks, spacing and case aside. */
const questionWords = (t: string): string => t.replace(/[\u2018\u2019\u201C\u201D'"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The ask a range answered holds THIS option's one-in-four question for this window, in its exact words. */
export const asksQuartileQuestion = (answering: string | undefined, question: string): boolean =>
  answering !== undefined && questionWords(answering).includes(questionWords(question));

/** The same question, whatever quote marks, spacing or case it was passed back in. */
export const sameQuestion = (a: string | undefined, b: string): boolean => a !== undefined && questionWords(a) === questionWords(b);

const sayPeople = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

/**
 * ⭐ AIE 6180618773 C4: the number reached is held at the user's point forecast only as Olumi's explicit conditional scenario. A
 * human point forecast is not human certainty, so the card says the chance is conditional on that many and that the reach's own
 * uncertainty is not carried. Said once, as Olumi's, on the card the press adopts.
 */
export const cohortFixedReachScenario = (people: number, window: string): string =>
  `Olumi’s scenario, not yours: the chance is worked out as if exactly ${sayPeople(people)} are reached during ${window}; `
  + 'how many it actually reaches may differ, and that uncertainty is not included.';

/** The same-draw law through the user's two estimates: Olumi's approximation (AIE 6180618773 T8: the relation alone does not establish it). */
export const cohortLawApproximation = (rateLabel: string): string =>
  `Olumi’s approximation, not yours: the underlying ‘${rateLabel}’ is treated as a smooth curve (a Beta distribution) through your `
  + 'two estimates, and each person converts or not at that same chance. If no such curve fits them, no chance is given for this option.';

/**
 * The card: the user's answer recorded as their estimates in AIE 6176433015's exact words, their other two statements, and
 * Olumi's own modelling approximation, said as Olumi's and kept apart from theirs.
 */
export function cohortForecastCardWords(optionLabel: string, f: CohortForecast, s: ApprovedCohortForecast['statements'],
  rateLabel: string, countLabel: string, window: string): string {
  const [lo, hi] = f.conversion_middle_half_pct;
  return [
    `From your answer to the question about one chance in four below and one chance in four above: “${s.conversion.source}”. `
      + `Record your estimates as about one chance in four below ${lo}% and one chance in four above ${hi}% for ‘${optionLabel.trim()}’, `
      + `among the people it reaches, during ${window}? These are your estimates, not a minimum and maximum.`,
    `From your messages: ‘${s.people.source}’ · ‘${s.same_cohort.source}’. Your forecast is that it reaches ${sayPeople(f.people_reached)} `
      + `during ${window}, and ‘${countLabel}’ counts the people who convert among those same people, as you said.`,
    cohortFixedReachScenario(f.people_reached, window),
    cohortLawApproximation(rateLabel),
  ].join('\n');
}

export const cohortForecastRecordedWords = (optionLabel: string, f: Pick<CohortForecast, 'people_reached' | 'conversion_middle_half_pct'>): string =>
  `Recorded from your words: your forecast that ‘${optionLabel.trim()}’ reaches ${sayPeople(f.people_reached)}, with about one chance in four that its `
  + `underlying conversion rate is below ${f.conversion_middle_half_pct[0]}% and one in four that it is above ${f.conversion_middle_half_pct[1]}%.`;

export type CohortForecastRefusal = 'invalid_graph' | 'invalid_forecast' | 'option_not_found' | 'option_changed' | 'targets_changed';

export type CohortForecastEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: CohortForecastRefusal };

export function applyCohortForecastEdit(persistedGraph: unknown, approved: ApprovedCohortForecast): CohortForecastEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  // Only a well-formed forecast whose figures are exactly the user's verified statements, by the user, is ever written here,
  // and the conversion's two figures only as their answer to the quartile question for THIS option and the goal's window.
  const f = readCohortForecast({ kind: 'option', cohort_forecast: approved.cohort_forecast });
  const s = approved.statements;
  const named = persistedGraph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.option_id && n.kind === 'option');
  const window = cohortWindowOf(persistedGraph);
  if (f === undefined || !isDeepStrictEqual(f, approved.cohort_forecast) || f.author !== 'user'
    || s.people.form !== 'point' || s.people.low !== f.people_reached || s.people.high !== f.people_reached
    || s.conversion.form !== 'range' || s.conversion.low !== f.conversion_middle_half_pct[0] || s.conversion.high !== f.conversion_middle_half_pct[1]
    || named === undefined || window === undefined
    || !asksQuartileQuestion(s.conversion.answering, cohortQuartileQuestion(String(named.label ?? ''), window))
    || s.same_cohort.form !== 'holds_now') {
    return { kind: 'refused', reason: 'invalid_forecast' };
  }
  // The two targets exactly as the card read them, and still the two the user's answer names.
  const targets = storedTargetRowsOf(persistedGraph);
  if (!isDeepStrictEqual(targets, approved.expected_targets) || cohortTargetsOf(targets, f) === undefined) {
    return { kind: 'refused', reason: 'targets_changed' };
  }
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.option_id && n.kind === 'option');
  if (matches.length !== 1) return { kind: 'refused', reason: 'option_not_found' };
  // The user's words go with the forecast their reading sets, on THIS option, as the door recorded them.
  const said = approved.user_statement;
  if (said !== undefined && (said.subject.kind !== 'option' || said.subject.id !== approved.option_id
    || said.record.subject_key !== subjectKey(said.subject) || claimRecordOf(said.record) === undefined)) {
    return { kind: 'refused', reason: 'invalid_forecast' };
  }
  // The option as the write leaves it: the card's forecast, and the door's record of the words when there is one.
  const landed = ((): unknown => {
    const node = { ...approved.expected_node, cohort_forecast: approved.cohort_forecast };
    return said === undefined ? node : withUserStatement({ nodes: [node] }, said.record, said.subject)?.nodes[0];
  })();
  if (approved.own_write_landed === true && isDeepStrictEqual(matches[0], landed)) {
    return { kind: 'unchanged' };
  }
  if (!isDeepStrictEqual(matches[0], approved.expected_node)) return { kind: 'refused', reason: 'option_changed' };

  const cloned = structuredClone(persistedGraph) as Rec & { nodes: unknown[] };
  const graph = said === undefined ? cloned : withUserStatement(cloned, said.record, said.subject);
  if (graph === undefined || (said !== undefined && !holdsUserStatement(graph, said.record, said.subject))) return { kind: 'refused', reason: 'option_not_found' };
  const option = graph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.option_id)!;
  option.cohort_forecast = structuredClone(approved.cohort_forecast);
  const label = String(option.label ?? approved.option_id).trim();
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'parameter_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'option', label: label.slice(0, 120) }],
      graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never) || null,
      graph_hash_after: computeAnalysisAffectingGraphHash(graph as never) || null,
      safe_summary: 'Recorded from your words an option’s people reached and conversion estimates',
      impact: 'low',
      rerun_recommended: true,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact], confirmation: cohortForecastRecordedWords(label, f) };
}

/** The freshly computed atomic write, exactly: the writer's own postimage of `before`, nothing else. */
export function cohortForecastPostimageIsScoped(before: unknown, after: unknown, approved: ApprovedCohortForecast): boolean {
  const written = applyCohortForecastEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}

/**
 * ⭐ THE WORDS-ONLY STATEMENT RECORD (door member `statement_record`): the user's verified statements recorded on their subject's
 * node (`user_statements`) by the door's press, and nothing else on the node moves. Two subjects use it:
 *  · M4-cohort (science table T8): the GOAL's relation, the user's answer that the count target counts converts among the SAME
 *    people the rate target is measured on, said once for every option; readiness then asks each option's forecast;
 *  · M3c (AIE 6181933060): an OPTION's lead, when its effect is fully in place, with Olumi's reading of the months (`attest`).
 *    The record itself is what the timing reader and the analysis hash read (`optionLeadOf`).
 */
export interface ApprovedStatementRecord {
  readonly node_id: string;
  /** The node exactly as stored when the card was made: the stale gate. */
  readonly expected_node: Readonly<Rec>;
  readonly user_statement: { readonly subject: DoorSubject; readonly record: UserStatementRecord };
  /** The same native operation can replace a bound source record and its explicitly listed legacy reading. */
  readonly correction?: StatementCorrection;
}

export type StatementRecordEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: 'invalid_graph' | 'invalid_statement' | 'node_not_found' | 'node_changed' };

/**
 * ⭐ GAP 1 (DL-3 GO, 19 Oct): a person's own figure for a factor's level, or for an option's setting of it (PATH-B's
 * `propose_change`), kept as THEIR claim beside the figure the SAME commit writes: who said it, a party's name, their words, its
 * conditions and stance. It carries no attest (no adoption, no law), so it is never read as a range, an adoption or a size; other
 * sources' claims on the subject stay beside it (`withClaimsKept`).
 */
export function isFigureClaimRecord(subject: DoorSubject, record: UserStatementRecord): boolean {
  return subject.kind === 'factor' && subject.field === 'level' && subject.to_id === undefined && record.attest === undefined
    && record.statements.some((st) => st.form === 'point' && saidByOf(st) !== 'olumi' && st.low !== undefined && st.low === st.high);
}

/** The subjects this member records, each with the statements it holds: never a figure-bearing record in place of its own carrier. */
function recordable(subject: DoorSubject, record: UserStatementRecord): boolean {
  if (isFigureClaimRecord(subject, record)) return true;
  if (subject.kind === 'goal' && subject.field === 'relation') return record.statements.length === 1 && record.statements[0]!.form === 'holds_now';
  if (subject.kind === 'option' && subject.field === 'lead') {
    return record.statements.length >= 1 && record.statements.length <= 2 && record.attest !== undefined && typeof record.attest.fingerprint === 'string';
  }
  // AIE 6184726873: the adoption of Olumi's equal-tail reading of an option's likely range (`RANGE_LAW_ROW`), with its exact ends.
  if (subject.kind === 'factor' && subject.option_id !== undefined && subject.field === 'level') {
    return record.statements.length === 1 && record.statements[0]!.form === 'range' && record.attest?.range_law === 'equal_tail'
      && typeof record.attest.low === 'number' && typeof record.attest.high === 'number';
  }
  // G3 (TL 21:18Z): a link's effect the user stated as a range in chat (`LINK_EFFECT_RANGE_ROW`): their range, kept as words and
  // ends only. It sizes nothing, so it carries no attest (no law, no adoption) and is never read as a size. ⭐ CLAIM RECORD (spec v2
  // rule 1; AIE DISSENT): another source's view of the same link stays current beside it (`withClaimsKept`, one per source), so the
  // record holds one range claim per source, never a second claim of one source.
  if (subject.kind === 'link' && subject.field === 'effect' && subject.to_id !== undefined && subject.option_id === undefined) {
    const source = (st: UserStatementRecord['statements'][number]): string => JSON.stringify([saidByOf(st), st.party ?? null, st.conditions ?? null]);
    return record.statements.length >= 1 && record.statements.every((st) => st.form === 'range') && record.attest === undefined
      && new Set(record.statements.map(source)).size === record.statements.length;
  }
  // DL-3 05:21Z (AIE 6183352754): what a factor's quantity covers, in the user's words (`FACTOR_DEFINITION_ROW`). It changes no
  // figure, so it carries no attest (no law, no adoption) and is never read as a value, a limit or a size.
  if (subject.kind === 'factor' && subject.option_id === undefined && subject.to_id === undefined && subject.field === 'measure') {
    return record.statements.length === 1 && record.statements[0]!.form === 'describes' && record.attest === undefined;
  }
  return false;
}

export function applyStatementRecordEdit(persistedGraph: unknown, approved: ApprovedStatementRecord): StatementRecordEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) return { kind: 'refused', reason: 'invalid_graph' };
  if (approved.correction !== undefined) {
    const correction = statementCorrectionOf(approved.correction);
    const first = correction?.edits[0];
    if (first === undefined || approved.node_id !== first.subject.id
      || !isDeepStrictEqual(approved.expected_node, first.expected_node)
      || !isDeepStrictEqual(approved.user_statement, { subject: first.subject, record: first.record })) return { kind: 'refused', reason: 'invalid_statement' };
    const written = applyStatementCorrection(persistedGraph, correction);
    const unsized = correction!.edits.flatMap((e) => (e.dependent?.action === 'link_unsized' ? [e.dependent.label] : []));
    const unavailable = correction!.edits.flatMap((e) => (e.dependent?.action === 'level_unavailable' ? [e.dependent] : []));
    // REPLACE: the user's corrected figure written as the level (the card's frozen postimage), said with its figure.
    const replaced = correction!.edits.flatMap((e) => (e.dependent?.action === 'level_replaced' && e.replacement !== undefined
      ? [{ label: e.dependent.label, said: `${e.replacement.value} ${e.replacement.unit.trim()}` }] : []));
    // DEPENDENT CURRENTNESS: Olumi's figures worked out from a corrected level by definition, withdrawn in the same commit.
    const defined = [...new Set(correction!.edits.flatMap((e) => (e.dependent?.action === 'level_replaced' || e.dependent?.action === 'level_unavailable'
      ? (e.dependent.defined ?? []).map((d) => d.label) : [])))];
    if (written.refused !== undefined || written.candidate === undefined) return { kind: 'refused',
      reason: written.refused === 'node_changed' || written.refused === 'node_not_found' ? written.refused : 'invalid_statement' };
    if (written.unchanged) return { kind: 'unchanged' };
    const fact = EditGraphHandlerFactSchema.parse({ fact_type: 'edit_graph', fact_version: 1, noop: false,
      result: { edit_kind: 'parameter_update', status: 'applied', operations_count: correction!.edits.length,
        affected_entities: correction!.edits.map(e => ({ kind: e.subject.kind === 'link' ? 'edge' : e.subject.kind,
          label: String(e.expected_node.label).slice(0, 120) })),
        graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never) || null,
        graph_hash_after: computeAnalysisAffectingGraphHash(written.candidate as never) || null,
        safe_summary: 'Recorded your source correction and explicitly retained material',
        // A correction that withdrew a size the analysis used changes what any earlier Run rested on (GATE → LABEL, one commit).
        impact: unsized.length + unavailable.length + replaced.length + defined.length > 0 ? 'high' : 'low',
        rerun_recommended: unsized.length + unavailable.length + replaced.length + defined.length > 0 } });
    return { kind: 'mutated', mutatedGraph: written.candidate, handlerFacts: [fact as HandlerFact],
      confirmation: 'Recorded your correction and the material explicitly kept on its card. Your source stays yours; Olumi’s reading remains separate.'
        + unsized.map((label) => ` The link “${label}” is now unsized: the analysis cannot use its size until it is sized again.`).join('')
        + replaced.map((r) => ` “${r.label}” now has your corrected figure, ${r.said}.`).join('')
        + unavailable.map((d) => ` “${d.label}” now has no current figure: the analysis cannot use one until it is given again`
          + `${d.held_unit === undefined ? '' : ` in ${d.held_unit}`}${d.incomplete === true ? '. Your corrected figure is kept with your words; this correction is incomplete' : ''}.`).join('')
        + defined.map((label) => ` The calculation for “${label}” is now unavailable because its inputs have changed.`).join('') };
  }
  const said = approved.user_statement;
  const record = claimRecordOf(said.record);
  if (said.subject.id !== approved.node_id || said.record.subject_key !== subjectKey(said.subject) || record === undefined
    || !recordable(said.subject, record)) return { kind: 'refused', reason: 'invalid_statement' };
  // A link's record lives on its `from` node (`withUserStatement`), and only while the link itself is in the graph.
  const link = said.subject.kind === 'link';
  const linkHeld = !link || persistedGraph.edges.filter((e) => isRec(e) && e.from === said.subject.id && e.to === said.subject.to_id).length === 1;
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.node_id && (link || n.kind === said.subject.kind));
  if (matches.length !== 1 || !linkHeld) return { kind: 'refused', reason: 'node_not_found' };
  // A retry after this press landed finds exactly these words held: the verified no-op.
  if (holdsUserStatement(persistedGraph, said.record, said.subject)) return { kind: 'unchanged' };
  if (!isDeepStrictEqual(matches[0], approved.expected_node)) return { kind: 'refused', reason: 'node_changed' };
  const graph = withUserStatement(structuredClone(persistedGraph) as Rec & { nodes: unknown[] }, said.record, said.subject);
  if (graph === undefined) return { kind: 'refused', reason: 'node_not_found' };
  const labelOf = (id: unknown): string => String((persistedGraph.nodes as unknown[]).find((n): n is Rec => isRec(n) && n.id === id)?.label ?? id).trim();
  const label = link ? `${labelOf(said.subject.id)} → ${labelOf(said.subject.to_id)}` : String(matches[0]!.label ?? approved.node_id).trim();
  const lead = said.subject.field === 'lead';
  // ⛔ BUDDY-A 05:30Z: only an option's level range is the range-law adoption; a factor's own definition is words, not a figure.
  const figureClaim = isFigureClaimRecord(said.subject, record);
  const rangeLaw = !figureClaim && said.subject.kind === 'factor' && said.subject.option_id !== undefined && said.subject.field === 'level';
  const definition = said.subject.kind === 'factor' && said.subject.option_id === undefined && said.subject.field === 'measure';
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: { edit_kind: 'parameter_update', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: link ? 'edge' : said.subject.kind, label: label.slice(0, 120) }],
      graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never) || null,
      graph_hash_after: computeAnalysisAffectingGraphHash(graph as never) || null,
      safe_summary: lead ? 'Recorded from your words when an option’s effect is fully in place'
        : figureClaim ? 'Recorded who stated this figure, in their own words'
        : rangeLaw ? 'Recorded your range as stated, with the Olumi approximation you adopted'
          : definition ? 'Recorded your words and Olumi’s reading of what it covers; no figure changed'
          : link ? 'Recorded Olumi’s reading of your words for this link; it does not size the link'
            : 'Recorded from your words that both targets count the same people',
      // A link's range and a factor's definition size nothing, so nothing the analysis reads has changed: no re-Run is owed for them.
      impact: 'low', rerun_recommended: lead || rangeLaw },
  });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: lead ? `Recorded from your words when ‘${label}’ is fully in place.`
      : figureClaim ? `Recorded who stated the figure for ‘${label}’, in their own words, beside it.`
      : rangeLaw ? `Recorded your range for ‘${label}’ as stated, with the Olumi approximation you adopted.`
        : definition ? `Recorded your words on ‘${label}’, with Olumi’s reading of what it covers. No figure changed: the model and its analysis use it exactly as before.`
        : link ? `Recorded Olumi’s reading of your words for ‘${label}’. It does not size the link.` : sameCohortRecordedWords(graph) };
}

/** The labels of the goal's two cohort targets, the rate (a percentage of the people reached) and the count, or `undefined`. */
export function sameCohortLabelsOf(graph: unknown): { readonly rate: string; readonly count: string } | undefined {
  const rows = storedTargetRowsOf(graph);
  const rate = rows.filter(isCohortRateRow);
  const count = rows.filter((r) => !rate.includes(r));
  if (rows.length !== 2 || rate.length !== 1 || count.length !== 1) return undefined;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const label = (id: unknown): string => String(nodes.find((n) => n.id === id)?.label ?? id).trim();
  return { rate: label(rate[0]!.node_id), count: label(count[0]!.node_id) };
}

/** The receipt of the user's same-people answer, after its verified read-back. */
export function sameCohortRecordedWords(graph: unknown): string {
  const l = sameCohortLabelsOf(graph);
  return l === undefined ? 'Recorded from your words that both targets count the same people.'
    : `Recorded from your words: your answer that your ‘${l.count}’ come from the same people your ‘${l.rate}’ is measured on.`;
}

/** The post-image holds exactly this write and nothing else (the dispatch's scope check, as for the forecast). */
export function statementRecordPostimageIsScoped(before: unknown, after: unknown, approved: ApprovedStatementRecord): boolean {
  const written = applyStatementRecordEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}

/** The user's same-people answer recorded on the goal (the door's goal relation), or `undefined`. */
export function sameCohortStatementOf(graph: unknown): UserStatement | undefined {
  const goals = (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : []).filter((n): n is Rec => isRec(n) && n.kind === 'goal');
  if (goals.length !== 1 || typeof goals[0]!.id !== 'string') return undefined;
  const record = pressedRecord(userStatementFor(graph, { kind: 'goal', id: goals[0]!.id, field: 'relation' }));
  return record?.statements.length === 1 && record.statements[0]!.form === 'holds_now' ? record.statements[0] : undefined;
}

/** The card as its stored operation carries it, or `undefined` if malformed. */
export function approvedCohortForecastOf(op: { readonly path: string; readonly value?: unknown }): ApprovedCohortForecast | undefined {
  const v = isRec(op.value) ? op.value : {};
  const f = readCohortForecast({ kind: 'option', cohort_forecast: v.cohort_forecast });
  const st = isRec(v.statements) ? v.statements : {};
  const people = userStatementOf(st.people), conversion = userStatementOf(st.conversion), same = userStatementOf(st.same_cohort);
  if (f === undefined || !isRec(v.expected_node) || !Array.isArray(v.expected_targets) || !v.expected_targets.every(isRec)
    || people === undefined || conversion === undefined || same === undefined) return undefined;
  const said = userStatementCarriedBy(v);
  if (said === null) return undefined;
  return { option_id: op.path, cohort_forecast: f, expected_node: v.expected_node, expected_targets: v.expected_targets,
    statements: { people, conversion, same_cohort: same }, ...(said !== undefined ? { user_statement: said } : {}) };
}

/** A stored card's `user_statement` (the door's record of the words): absent, well-formed, or `null` when malformed. */
function userStatementCarriedBy(v: Rec): ApprovedStatementRecord['user_statement'] | undefined | null {
  if (v.user_statement === undefined) return undefined;
  const u = isRec(v.user_statement) ? v.user_statement : {};
  const subject = isRec(u.subject) ? u.subject : undefined;
  const record = claimRecordOf(u.record);
  if (subject === undefined || typeof subject.id !== 'string' || !(SUBJECT_KINDS as readonly unknown[]).includes(subject.kind)
    || !isStatementField(subject.field) || record === undefined) return null;
  // An option's setting of a factor (`RANGE_LAW_ROW`) is keyed by its option too: the subject keeps it, or the key never matches.
  const parsed: DoorSubject = { kind: subject.kind as SubjectKind, id: subject.id,
    ...(typeof subject.to_id === 'string' ? { to_id: subject.to_id } : {}), ...(typeof subject.option_id === 'string' ? { option_id: subject.option_id } : {}),
    field: subject.field };
  return record.subject_key === subjectKey(parsed) ? { subject: parsed, record } : null;
}

/** The proposal op of the goal's same-people answer (`path` is the goal's id, `value` is what {@link approvedStatementRecordOf} reads). */
export const SET_STATEMENT_RECORD_OP = 'set_statement_record' as const;

/** The goal relation card as its stored operation carries it, or `undefined` if malformed. */
export function approvedStatementRecordOf(op: { readonly path: string; readonly value?: unknown }): ApprovedStatementRecord | undefined {
  const v = isRec(op.value) ? op.value : {};
  const said = userStatementCarriedBy(v);
  if (!isRec(v.expected_node) || said === undefined || said === null) return undefined;
  const correction = v.correction === undefined ? undefined : statementCorrectionOf(v.correction);
  if (v.correction !== undefined && correction === undefined) return undefined;
  return { node_id: op.path, expected_node: v.expected_node, user_statement: said, ...(correction === undefined ? {} : { correction }) };
}

/** A held goal relation card still applies to `graph` exactly when its own writer would not refuse it there. */
export function statementRecordCardHolds(op: { readonly path: string; readonly value?: unknown }, graph: unknown): boolean {
  const approved = approvedStatementRecordOf(op);
  return approved !== undefined && applyStatementRecordEdit(graph, approved).kind !== 'refused';
}

/** A held forecast card still applies to `graph` exactly when its own writer would not refuse it there. */
export function cohortForecastCardHolds(op: { readonly path: string; readonly value?: unknown }, graph: unknown): boolean {
  const approved = approvedCohortForecastOf(op);
  return approved !== undefined && applyCohortForecastEdit(graph, approved).kind !== 'refused';
}
