/**
 * ⭐ A LINK'S EFFECT STATED AS A RANGE IN CHAT (G3 #6, VERIFY-2da89781: "Ranges for B and C (chat, T02 and T03). Stored nowhere";
 * TL 21:18Z adopting the AIE AMEND: "Chat ranges are stored durably through the existing statement door, separately from sizing,
 * and are never claimed as used by a Run"). The user's complete statement about ONE link, with the ONE range it writes, recorded on
 * the link (`user_statements`, on its `from` node) exactly as construction records a range from the brief, by the press. It sizes
 * nothing: the link keeps whatever size it has (Olumi's placeholder), and the card and receipt say so. ⛔ #3329 GREEN CORE (DL-3 02:59Z):
 * the press adopts Olumi's READING of the user's words, so it grants no authority: `linkHoldsStatedRange` reads only construction's
 * record, and the link's size is still asked (an AI-omitted negation cannot be told apart from a genuine range). Pure.
 */
import { linkEffectEndUnits, statedInOneOf } from '../../system-events/link-effect-edit.js';
import { findJoinedRanges } from '../../../cee/provenance/stated-amounts.js';
import { statedTailParts } from '../../agent-lane/same-unit.js';
import { applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord } from '../../goal-target/cohort-forecast-write.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord, withClaimsKept } from '../statements.js';
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

/**
 * How many DIFFERENT ranges `quote` writes (G3-unseen 1253187a T03: the same range restated in a second notation was refused as
 * "more than one range"). A range written twice — equal ends AND the same unit read after each high end by the estate's one tail
 * reader (`statedTailParts`, compared part for part as `sameUnit` compares units) — counts once. A range with no unit read after
 * it is never the same as another, and equal figures in different units stay two ranges.
 */
function distinctRangesWritten(quote: string): number {
  const ranges = findJoinedRanges(quote).map((r) => ({ low: r.low.magnitude, high: r.high.magnitude, unit: statedTailParts(quote, r.high) }));
  return ranges.filter((r, i) => !ranges.slice(0, i).some((o) => o.low === r.low && o.high === r.high
    && o.unit !== null && r.unit !== null && JSON.stringify(o.unit) === JSON.stringify(r.unit))).length;
}

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
  // The press adopts Olumi's reading of the user's words, never a record of a range they stated: "Use this reading".
  derives: true,
  applies: linkHeld,
  // ⭐ ONE BINDER (DL-3 22:53Z + RULING 23:12Z; BUDDY-A #3329 B1): the AI reads the range and binds it to this link's effect; the
  // door verifies the quote writes those ends in that unit. This row only says which readings its field takes: a range, never
  // negated, in the unit this link's TARGET is measured in (the link writer's own comparator). "4–7 months before we can measure
  // its effect" is months, never this effect; "will not lift it by 4 to 7 points" is never a range of it.
  read: () => ({ refused: 'Give your reading of the user’s words: the range, its unit as written, and whether it is negated.' }),
  aiReads: (s, subject, graph) => {
    if (!linkHeld(subject, graph)) return 'That link is not in the model.';
    if (s.form !== 'range') return 'A link’s effect is recorded here only as a range the user wrote, for example “between 4 and 7 points”.';
    if (s.negated === true) return `“${s.quote}” says the effect is NOT that range, so it is not recorded as the link’s range; its question stays open.`;
    // Two ranges written in one statement ("4 to 7 points, or 2 to 3 in winter") are two readings, never one range: ask which holds.
    if (distinctRangesWritten(s.quote) > 1) return `“${s.quote}” gives more than one range, so neither is recorded alone; ask which holds.`;
    const units = linkEffectEndUnits(graph, subject.id, subject.to_id ?? '');
    const own = units === null ? [] : [...units.target.own, ...(units.target.adopted !== undefined ? [units.target.adopted] : [])];
    return statedInOneOf(s.unit, own) ? undefined
      : `“${s.unit ?? ''}” is not the unit ‘${labelOf(graph, subject.to_id)}’ is measured in, so this is not a range of the link’s effect.`;
  },
  readingWords: (statements, subject, _label, graph) => {
    const s = statements[0];
    return `the effect of ${ends(subject, graph)} is a range of ${fmt(s?.low ?? 0)} to ${fmt(s?.high ?? 0)} ${s?.unit ?? ''}`.replace(/ {2,}/gu, ' ');
  },
  assumptions: () => ['This is Olumi’s reading of your words, quoted above in full. It is kept as Olumi’s reading, not as a range you stated, '
    + 'and it does not size this link: the analysis does not use it, still uses Olumi’s placeholder for this link, and can still ask its size.'],
  recordedWords: (statements, subject, _label, graph) => {
    const s = statements[0];
    return `Recorded Olumi’s reading of your words, which you chose to use: a range of ${fmt(s?.low ?? 0)} to ${fmt(s?.high ?? 0)} ${s?.unit ?? ''} `
      .replace(/ {2,}/gu, ' ') + `for ${ends(subject, graph)}. It does not size the link; the analysis still uses Olumi’s placeholder for it, and its size can still be asked.`;
  },
  get writer() { return LINK_EFFECT_RANGE_WRITER; },
};

/** The press's write: the user's statement as the link's ONE range record, on its `from` node as `graph` holds it. */
export function linkEffectRangeRecord(graph: unknown, subject: DoorSubject, reading: DoorReading, at: string): ApprovedStatementRecord | undefined {
  const from = nodesOf(graph).find((n) => n.id === subject.id);
  if (from === undefined || !linkHeld(subject, graph) || reading.statements.length !== 1 || reading.statements[0]!.form !== 'range') return undefined;
  // Another party's or the user's earlier view of this link stays beside it (claim record spec v2 rule 1); the same source's is superseded.
  return { node_id: subject.id, expected_node: structuredClone(from), user_statement: { subject, record: withClaimsKept(graph, subject, userStatementRecord(subject, reading.statements, at)) } };
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
