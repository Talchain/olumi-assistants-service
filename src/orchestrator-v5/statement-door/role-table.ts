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

/** A field reader's reading of one statement: the form, the figure's ends (absent for a figure-free form) and a qualifier. */
export interface DoorFigure {
  readonly form: StatementForm;
  readonly low?: number;
  readonly high?: number;
  readonly qualifier?: string;
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
  readonly read: (quote: string, subject: DoorSubject, graph: unknown) => DoorFigure | { readonly refused: string };
  /** The level door member the reading is written through (`write.ts`). With `field`, the row's key: unique in the table. */
  readonly carrier: DoorWriteMember;
  /** Whether this row reads statements about this subject (its kind and the graph's structure); never by elimination. */
  readonly applies: (subject: DoorSubject, graph: unknown) => boolean;
  /** The adapter onto `carrier`: the verified reading → ONE write, or the reason the carrier cannot hold it. */
  readonly writer: FieldWriter;
  /** Olumi's reading of the statement, as the card says it ("your estimate of about 30% that ‘X’ happens …"). */
  readonly readingWords: (statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown) => string;
  /** Every Olumi assumption the reading rests on, each said once (a step, a convention, a part the user did not give). */
  readonly assumptions: (statements: readonly UserStatement[], subject: DoorSubject, graph: unknown) => readonly string[];
  /** The receipt after a confirmed write and read-back ("Recorded your estimate: …"). */
  readonly recordedWords: (statements: readonly UserStatement[], subject: DoorSubject, label: string, graph: unknown) => string;
  /** At most this many statements make one reading (a lead's start and its settling-in: 2). */
  readonly maxStatements: number;
  /** The AIE comment id that signed this row's meaning and words. */
  readonly signed_by: string;
}

/** The table. Empty in the contract (PR-0); each migration adds its signed row(s), one per (field, carrier). */
export const ROLE_TABLE: RoleRow[] = [];
export const rowKey = (r: Pick<RoleRow, 'field' | 'carrier'>): string => `${r.field}:${r.carrier}`;

/** The ONE row for this subject: its field, and the one row whose `applies` holds. None, or more than one, is no row. */
export function doorRowFor(subject: DoorSubject, graph: unknown): RoleRow | undefined {
  const rows = ROLE_TABLE.filter((r) => r.field === subject.field && r.applies(subject, graph));
  return rows.length === 1 ? rows[0] : undefined;
}
