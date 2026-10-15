/**
 * ⭐ THE APPROXIMATION CARD (AIE 6184726873 / 6184022140; DL 15 Oct): Olumi's equal-tail reading of a person's likely range, ADOPTED
 * by its press. A likely range (the person's, from the brief or the level card) is two ends; the analysis samples it as the
 * quartiles of a lognormal, which no one stated. Until that approximation is adopted, a chance resting on it is withheld with the
 * AIE's face (`goal-chance-licence.ts`, `placeholder-parts.ts`), and this card is the next step: it quotes the words the range was
 * stated in (the range's own `source_quote`, the model's admitted source sentence for it), shows the C2 template whole (basis,
 * family, limitations) and records ONLY the adoption, on the factor, keyed by the option's setting, attesting the law and the exact
 * ends (`rangeLawAdopted`; a changed range is not adopted). The ends stay the person's; the law stays Olumi's. The press's
 * read-back and the existing automatic re-Run then show the chance. Pure.
 */
import { likelyRangeUseOf, rangeApproximationWords, rangeLawCarrierOf, rangeLawSubject, RANGE_LAW_EQUAL_TAIL, type LikelyRangeUse } from '../../intervention-range.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { sayFigureExactly } from '../../agent-lane/say-figure.js';
import { applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord } from '../../goal-target/cohort-forecast-write.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const RANGE_LAW_SIGNED_BY = '6184022140';

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const labelOf = (graph: unknown, id: string | undefined): string => String(nodesOf(graph).find((n) => n.id === id)?.label ?? id ?? '').trim();

/** The person's likely range on this option's setting of this factor, or `undefined`. */
export function rangeLawUseOf(subject: DoorSubject, graph: unknown): LikelyRangeUse | undefined {
  if (subject.kind !== 'factor' || subject.option_id === undefined || subject.to_id !== undefined || subject.field !== 'level') return undefined;
  const option = nodesOf(graph).find((n) => n.kind === 'option' && n.id === subject.option_id);
  const cells = option === undefined ? undefined : [option.interventions, isRec(option.data) ? option.data.interventions : undefined]
    .find((x): x is Rec => isRec(x) && subject.id in x);
  const use = cells === undefined ? undefined : likelyRangeUseOf(subject.id, cells[subject.id]);
  return use !== undefined && use.persons_own ? use : undefined;
}

const say = (n: number, u: LikelyRangeUse): string => sayFigureExactly(n, u.unit ?? '') ?? `${n}${u.unit !== undefined ? ` ${u.unit}` : ''}`;

export const RANGE_LAW_ROW: RoleRow = {
  field: 'level',
  unit: '',
  forms: ['range'],
  carrier: 'statement_record',
  maxStatements: 1,
  signed_by: RANGE_LAW_SIGNED_BY,
  quantity: 'likely_range_law',
  // The postimage adds Olumi's derivation (the equal-tail law), adopted by the press: "Use this reading" (AIE 6181498097).
  derives: true,
  applies: (subject, graph) => rangeLawUseOf(subject, graph) !== undefined,
  // Bound by the words the range was stated in, as the model keeps them on the range (`source_quote`).
  sourceOf: (subject, graph) => rangeLawUseOf(subject, graph)?.source_quote,
  read: (quote, subject, graph) => {
    const use = rangeLawUseOf(subject, graph);
    if (use === undefined) return { refused: 'This option’s setting holds no likely range of the person’s.' };
    if (use.source_quote === undefined || quote.trim() !== use.source_quote.trim()) {
      return { refused: `Only the words the range was stated in carry its approximation${use.source_quote !== undefined ? `: “${use.source_quote}”` : ''}.` };
    }
    return { form: 'range', low: use.low, high: use.high };
  },
  readingWords: (_statements, subject, label, graph) => {
    const use = rangeLawUseOf(subject, graph);
    return use === undefined ? '' : `‘${labelOf(graph, subject.option_id)}’ sets ‘${label.trim()}’ with your stated range, ${say(use.low, use)} to ${say(use.high, use)}`;
  },
  assumptions: (_statements, subject, graph) => {
    const use = rangeLawUseOf(subject, graph);
    return use === undefined ? [] : [`${rangeApproximationWords(say(use.low, use), say(use.high, use))}.`];
  },
  recordedWords: (statements, subject, label, graph) => {
    const s = statements[0];
    const use = rangeLawUseOf(subject, graph);
    const [low, high] = use !== undefined ? [say(use.low, use), say(use.high, use)] : [String(s?.low ?? ''), String(s?.high ?? '')];
    return `Recorded: your range for ‘${label.trim()}’ in ‘${labelOf(graph, subject.option_id)}’ stays as you stated it, ${low} to ${high}, `
      + 'and the analysis now reads it with the Olumi approximation shown.';
  },
  get writer() { return RANGE_LAW_WRITER; },
};

/**
 * The adoption of Olumi's equal-tail reading of ONE option's likely range for a factor: the person's words for the range, the law
 * and its exact ends (`rangeLawAdopted` reads them), on the factor as `graph` holds it. The approximation card's press and the
 * level card's press (which shows the same template, `statedRangeAssumptionWords`) both write through it. `undefined` when the
 * factor is not in the graph or the words are not one range.
 */
export function rangeLawAdoption(graph: unknown, optionId: string, factorId: string, statements: readonly UserStatement[],
  low: number, high: number, at: string): ApprovedStatementRecord | undefined {
  const factor = nodesOf(graph).find((n) => n.id === factorId && n.kind === 'factor');
  if (factor === undefined || statements.length !== 1 || statements[0]!.form !== 'range') return undefined;
  const subject = rangeLawSubject(optionId, factorId);
  // ⭐ C2 currentness: bound to the range the setting holds (`rangeLawCarrierOf`). Where this commit itself writes the range (the
  // level card), the edit door stamps it from the cell as written (`rangeLawOnCarrier`).
  const carrier = rangeLawCarrierOf(rangeCellOf(graph, optionId, factorId));
  const record = userStatementRecord(subject, statements, at, { range_law: RANGE_LAW_EQUAL_TAIL, low, high, ...(carrier !== undefined ? { carrier } : {}) });
  return { node_id: factorId, expected_node: structuredClone(factor), user_statement: { subject, record } };
}

/** ONE option's setting of a factor, as `graph` holds it. */
function rangeCellOf(graph: unknown, optionId: string, factorId: string): unknown {
  const option = nodesOf(graph).find((n) => n.kind === 'option' && n.id === optionId);
  const cells = option === undefined ? undefined : [option.interventions, isRec(option.data) ? option.data.interventions : undefined]
    .find((x): x is Rec => isRec(x) && factorId in x);
  return cells?.[factorId];
}

/**
 * The adoption bound to the range `graph` holds for its setting (the post-write graph of the commit that writes that range), or
 * `undefined` when that setting holds no likely range with the adopted ends: an adoption never binds to a range it was not shown.
 */
export function rangeLawOnCarrier(approved: ApprovedStatementRecord, graph: unknown): ApprovedStatementRecord | undefined {
  const { subject, record } = approved.user_statement;
  const use = subject.option_id === undefined ? undefined : likelyRangeUseOf(subject.id, rangeCellOf(graph, subject.option_id, subject.id));
  if (use === undefined || use.low !== record.attest?.low || use.high !== record.attest?.high) return undefined;
  return { ...approved, user_statement: { subject, record: { ...record, attest: { ...record.attest, carrier: use.carrier } } } };
}

/** The person's range as the level card read it from their sentence: the statement its adoption record holds. */
export const rangeLawStatementOf = (optionId: string, factorId: string, quote: string, low: number, high: number, unit?: string): UserStatement => ({
  speaker: 'user', quote, source: quote, form: 'range', reading: 'olumi', low, high,
  subject: { quantity: RANGE_LAW_ROW.quantity!, node_id: factorId, option_id: optionId }, ...(unit !== undefined ? { unit } : {}),
});

/** The adapter onto the `statement_record` member: the person's words for the range, with the adopted law and its exact ends. */
export const RANGE_LAW_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const use = rangeLawUseOf(reading.subject, graph);
    const approved = use === undefined || reading.subject.option_id === undefined ? undefined
      : rangeLawAdoption(graph, reading.subject.option_id, reading.subject.id, reading.statements, use.low, use.high, new Date().toISOString());
    if (approved === undefined) return { refused: 'range_not_applicable' };
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
