/**
 * ⭐ A LINK'S EFFECT STATED AS A RANGE IN CHAT (G3 #6, VERIFY-2da89781: "Ranges for B and C (chat, T02 and T03). Stored nowhere";
 * TL 21:18Z adopting the AIE AMEND: "Chat ranges are stored durably through the existing statement door, separately from sizing,
 * and are never claimed as used by a Run"). The user's complete statement about ONE link, with the ONE range it writes, recorded on
 * the link (`user_statements`, on its `from` node) exactly as construction records a range from the brief, by the press. It sizes
 * nothing: the link keeps whatever size it has (Olumi's placeholder), and the card and receipt say so. Every reader of a stated
 * range (`linkHoldsStatedRange`: no re-ask of that link, the Run's limitation words) then reads it as it reads the brief's. Pure.
 */
import { findJoinedRanges } from '../../../cee/provenance/stated-amounts.js';
import { applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord } from '../../goal-target/cohort-forecast-write.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The AIE's restated AMEND (TL6224574645 → 6224694421) that sets this row's meaning: kept as words and ends, never a size. */
export const LINK_EFFECT_RANGE_SIGNED_BY = '6224694421';

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const edgesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : []);
const labelOf = (graph: unknown, id: string | undefined): string => String(nodesOf(graph).find((n) => n.id === id)?.label ?? id ?? '').trim();
const fmt = (n: number): string => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(n));

/** The ONE link this subject names: a link (no option) whose edge is in the graph exactly once. */
const linkHeld = (subject: DoorSubject, graph: unknown): boolean => subject.kind === 'link' && subject.to_id !== undefined
  && subject.option_id === undefined && edgesOf(graph).filter((e) => e.from === subject.id && e.to === subject.to_id).length === 1;

const ends = (subject: DoorSubject, graph: unknown): string => `‘${labelOf(graph, subject.id)}’ → ‘${labelOf(graph, subject.to_id)}’`;

export const LINK_EFFECT_RANGE_ROW: RoleRow = {
  field: 'effect',
  unit: '',
  forms: ['range'],
  carrier: 'statement_record',
  maxStatements: 1,
  signed_by: LINK_EFFECT_RANGE_SIGNED_BY,
  // "0 to 5 points" is a range of the user's: its low end is a figure, never refused as missing.
  allowsZero: true,
  applies: linkHeld,
  // The ONE range the statement writes, by the brief path's own range reader (`findJoinedRanges`): its words stay the user's.
  read: (quote, subject, graph) => {
    if (!linkHeld(subject, graph)) return { refused: 'That link is not in the model.' };
    const ranges = findJoinedRanges(quote);
    if (ranges.length !== 1) return { refused: 'A link’s effect is recorded here only as the ONE range its statement writes, for example “between 4 and 7 points”.' };
    const r = ranges[0]!;
    if (!(r.low.magnitude < r.high.magnitude)) return { refused: `“${r.text}” does not give a low end below its high end.` };
    return { form: 'range', low: r.low.magnitude, high: r.high.magnitude };
  },
  readingWords: (statements, subject, _label, graph) => {
    const s = statements[0];
    return `the effect of ${ends(subject, graph)} is your range, ${fmt(s?.low ?? 0)} to ${fmt(s?.high ?? 0)}, as you wrote it`;
  },
  assumptions: () => ['It is kept as your range and does not size this link: the analysis does not use it, and still uses Olumi’s placeholder for this link.'],
  recordedWords: (statements, subject, _label, graph) => {
    const s = statements[0];
    return `Recorded: your range for ${ends(subject, graph)} stays as you stated it, ${fmt(s?.low ?? 0)} to ${fmt(s?.high ?? 0)}. `
      + 'It does not size the link; the analysis still uses Olumi’s placeholder for it.';
  },
  get writer() { return LINK_EFFECT_RANGE_WRITER; },
};

/** The press's write: the user's statement as the link's ONE range record, on its `from` node as `graph` holds it. */
export function linkEffectRangeRecord(graph: unknown, subject: DoorSubject, reading: DoorReading, at: string): ApprovedStatementRecord | undefined {
  const from = nodesOf(graph).find((n) => n.id === subject.id);
  if (from === undefined || !linkHeld(subject, graph) || reading.statements.length !== 1 || reading.statements[0]!.form !== 'range') return undefined;
  return { node_id: subject.id, expected_node: structuredClone(from), user_statement: { subject, record: userStatementRecord(subject, reading.statements, at) } };
}

/** The adapter onto the `statement_record` member: the record alone; no edge byte moves. */
export const LINK_EFFECT_RANGE_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const approved = linkEffectRangeRecord(graph, reading.subject, reading, new Date().toISOString());
    if (approved === undefined) return { refused: 'link_not_applicable' };
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
