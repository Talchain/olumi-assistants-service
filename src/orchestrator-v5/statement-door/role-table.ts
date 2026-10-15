/**
 * ⭐ SYSTEM 4's interface, as SYSTEM 1's door reads it (owner of the ROWS: SCIENCE; each row is signed once by the AIE). For each
 * field: what a statement of it is in (unit, forms, the figures a quote states), the ONE engine carrier it is written to, and the
 * words a card says for Olumi's reading of it and for every Olumi assumption it rests on. A field is migrated onto the door only
 * once its row is here with its AIE signature; until then that field stays on its current path (DL condition 3, 22:49Z).
 *
 * ONE dispatch, keyed by (field, carrier) (SCIENCE AMEND (a), DL 23:19Z): a field is not enough to choose a carrier (`level` on
 * a factor, on a team's months to finish and on a cohort go to different members), so a row says which subjects it `applies`
 * to and carries its own `writer`. `doorRowFor(subject, graph)` is the one lookup: exactly one row, else none (fail closed).
 */
import type { StatementForm, UserStatement } from '../agent-lane/user-statements.js';
import type { DoorSubject, StatementField } from './subject.js';
import type { DoorWriteMember, FieldWriter } from './write.js';
import { MEASURE_ROW } from './fields/measure.js';
import { TIMING_ROW } from './fields/goal-timing.js';
import { RISK_HOLDS_NOW_ROW, RISK_OCCURRENCE_ROW } from './fields/risk.js';
import { COHORT_RELATION_ROW, COHORT_SAME_PEOPLE_ROW } from './fields/cohort-relation.js';

/** A field reader's reading of one statement: the form, the figure's ends (absent for a figure-free form) and a qualifier. */
export interface DoorFigure {
  readonly form: StatementForm;
  readonly low?: number;
  readonly high?: number;
  readonly qualifier?: string;
  /** A figure-free field's reading: the user's own words it rests on, inside the quote ("story points completed per sprint"). */
  readonly words?: string;
  /** The span of the quote the figure governs (the shared reader's clause): the subject is bound by it, not by the whole quote. */
  readonly clause?: string;
}

export interface RoleRow {
  readonly field: StatementField;
  /** The unit the statement's figure is read in ('' for a figure-free reading). */
  readonly unit: string;
  readonly forms: readonly StatementForm[];
  /**
   * The field's reading of ONE whole statement, by the field's shared reader (never a new matcher): its form and figure, or the
   * reason it is not this field's reading (a different window, a negated event, a bound the carrier cannot hold…), which keeps
   * the user's words as said.
   */
  readonly read: (quote: string, subject: DoorSubject, graph: unknown, words?: string,
    /** The ask the statement answers, as the Agent named it (bound separately by `statementBoundTo`): a row may read a form only as that answer. */
    answering?: string) => DoorFigure | { readonly refused: string };
  /** The level door member the reading is written through (`write.ts`). With `field`, the row's key: unique in the table. */
  readonly carrier: DoorWriteMember;
  /** Whether this row reads statements about this subject (its kind and the graph's structure); never by elimination. */
  readonly applies: (subject: DoorSubject, graph: unknown) => boolean;
  /**
   * The other subjects whose asks a statement about this subject may answer (SCIENCE AMEND (d)): a cohort option's "the same
   * people" answers the GOAL's same-people question, asked once for every option. Absent: only this subject's own asks.
   */
  readonly answersFor?: (subject: DoorSubject, graph: unknown) => readonly DoorSubject[];
  /** The adapter onto `carrier`: the verified reading → ONE write, or the reason the carrier cannot hold it. */
  readonly writer: FieldWriter;
  /** A sentence the model already holds as this subject's ADMITTED source for this field (the brief's own words): bound by it. */
  readonly sourceOf?: (subject: DoorSubject, graph: unknown) => string | undefined;
  /**
   * Forms recorded only from the words the user typed in THIS turn, the message that answers Olumi's ask (AIE 6174707160 and
   * 6176433015: two conversion figures are the user's one-in-four estimates only as their answer to that question). `detail` says why not.
   */
  readonly answerTypedNow?: { readonly forms: readonly StatementForm[]; readonly detail: (subject: DoorSubject, label: string, graph: unknown) => string };
  /** Olumi's reading of the statement, as the card says it ("your estimate of about 30% that ‘X’ happens …"). */
  readonly readingWords: (statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown, words?: string) => string;
  /** Every derived interpretation or separate Olumi assumption the reading rests on, each said once, before the card's question. */
  readonly assumptions: (statements: readonly UserStatement[], subject: DoorSubject, graph: unknown, words?: string) => readonly string[];
  /** The receipt after a confirmed write and read-back ("Recorded your estimate: …"). */
  readonly recordedWords: (statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown, words?: string) => string;
  /**
   * A statement about the WHOLE model's effects ("All of these effects would be fully in place by month 3") is about the
   * model's one goal: true only when the row's reading words quantify over every effect and the graph holds exactly one goal,
   * the subject. That is the statement's own scope, never elimination among candidates.
   */
  readonly bindsWhole?: (quote: string, subject: DoorSubject, graph: unknown, words?: string) => boolean;
  /**
   * What the statements, read together, still leave unsaid, as the ONE ask to say (the words are kept; nothing is prepared), or
   * `undefined` when the reading is complete.
   */
  readonly incomplete?: (statements: readonly UserStatement[], subject: DoorSubject, graph: unknown, words?: string) => string | undefined;
  /** The quantity a verified statement records (its stored `subject.quantity`, read by the carrier's writer); default the field. */
  readonly quantity?: string;
  /** The period a statement of this subject is stated over, kept on it ("3 months"), where the field has one. */
  readonly periodOf?: (subject: DoorSubject, graph: unknown) => string | undefined;
  /** True where the written postimage adds an Olumi derivation (its button is "Use this reading", AIE 6181498097). */
  readonly derives?: boolean;
  /** A stated 0 is a figure of this field, recorded as 0 (a chance of 0%, a level of none), never refused as missing. */
  readonly allowsZero?: boolean;
  /** At most this many statements make one reading (a lead's start and its settling-in: 2). */
  readonly maxStatements: number;
  /** The AIE comment id that signed this row's meaning and words. */
  readonly signed_by: string;
}

/** The table. Each migration adds its signed row(s), one per (field, carrier): M3 a goal's measure and timing; M1 a risk's chance and "holds now"; M4 a cohort option's relation and the goal's same-people relation. */
export const ROLE_TABLE: RoleRow[] = [MEASURE_ROW, TIMING_ROW, RISK_OCCURRENCE_ROW, RISK_HOLDS_NOW_ROW, COHORT_RELATION_ROW, COHORT_SAME_PEOPLE_ROW];
export const rowKey = (r: Pick<RoleRow, 'field' | 'carrier'>): string => `${r.field}:${r.carrier}`;

/** The ONE row for this subject: its field, and the one row whose `applies` holds. None, or more than one, is no row. */
export function doorRowFor(subject: DoorSubject, graph: unknown): RoleRow | undefined {
  const rows = ROLE_TABLE.filter((r) => r.field === subject.field && r.applies(subject, graph));
  return rows.length === 1 ? rows[0] : undefined;
}
