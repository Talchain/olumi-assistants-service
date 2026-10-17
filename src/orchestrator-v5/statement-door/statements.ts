/**
 * ⭐ SYSTEM 1: the user's recorded statements, kept on the subject's node (DL ruling 14 Oct 23:09Z; shape SESSION4 23:11Z; AIE
 * 6180193788: "preserve the actual human definition and its speaker/source independently through saved evidence, THIS working AI
 * input and cold reopen"). ONE node key, `user_statements`: one record per subject (`subjectKey`), on the subject's node (a link's
 * on its `from` node). Written ONLY through `withUserStatement` by the door's writer, in the same commit as the member its reading
 * sets; a later record for the same subject REPLACES it (a correction supersedes). Read through `userStatementFor`, never the raw
 * key. Pure.
 */
import { isDeepStrictEqual } from 'node:util';
import { namesBothEnds } from '../goal-target/input-claim-context.js';
import { isFactorNamedByUser } from '../routing/stated-event-risk.js';
import { answeredAsk, askedSubjects, type StatementAsk } from './ask.js';

import { userStatementOf, type UserStatement } from '../agent-lane/user-statements.js';
import { isStatementField, subjectKey, subjectNodeKey, type DoorSubject, type StatementField } from './subject.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What binds a statement to a subject beside its words. */
export interface DoorContext {
  readonly selection?: { readonly element_ids: readonly string[]; readonly unresolved: string };
  /** Olumi's previous reply, bound by the route from the session's own items. */
  readonly preceding_ask?: string;
  /** The readiness asks Olumi said in recent turns, each with its subject and turn (`ask.ts`). */
  readonly asks?: readonly StatementAsk[];
}

/** The statement is about THIS subject: its words, else the user's selection, else the ask it answers, else Olumi's preceding ask. */
export function statementBoundTo(graph: unknown, subject: DoorSubject, quote: string, ctx: DoorContext = {}, answering?: string,
  alsoAnswers: readonly DoorSubject[] = []): 'bound' | 'another' | 'unbound' {
  // The subjects an ask of which this statement may answer: its own, and the row's `answersFor` (one key each).
  // The NODES this statement may answer for: its own, and the rows' `answersFor` (a cohort option's "the same people" answers the goal's ask).
  const answers = new Set([subject, ...alsoAnswers].map(subjectNodeKey));
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (subject.kind === 'link') {
    const entities = nodes.flatMap((n) => (typeof n.id === 'string' && typeof n.label === 'string' ? [{ id: n.id, label: n.label }] : []));
    if (subject.to_id !== undefined && namesBothEnds(quote, entities, subject.id, subject.to_id)) return 'bound';
  } else {
    const same = nodes.filter((n) => n.kind === subject.kind && typeof n.id === 'string' && typeof n.label === 'string');
    const named = same.filter((n) => isFactorNamedByUser(String(n.label), quote));
    if (named.length === 1) return named[0]!.id === subject.id ? 'bound' : 'another';
    if (named.length > 1) return 'unbound';
  }
  const s = ctx.selection;
  if (s !== undefined && s.unresolved === 'none' && s.element_ids.length === 1) {
    if (s.element_ids[0] === subject.id) return 'bound';
    if (nodes.some((n) => n.id === s.element_ids[0] && n.kind === subject.kind)) return 'another';
  }
  const answered = answeredAsk(answering, ctx.asks ?? []);
  // The ask names the NODE; the field is the row's reading of the words (one readiness line asks "true now?" and "how likely?").
  if (answered !== undefined) return answers.has(subjectNodeKey(answered.subject)) ? 'bound' : 'another';
  if (typeof answering === 'string' && answering.trim() !== '') return 'unbound';
  const asked = [...new Set(askedSubjects(ctx.preceding_ask, ctx.asks ?? []).map(subjectNodeKey))];
  if (asked.length === 1) return answers.has(asked[0]!) ? 'bound' : 'another';
  return 'unbound';
}

/** The node key. */
export const USER_STATEMENTS_KEY = 'user_statements' as const;

/** What a record attests beyond its member, for a later reader to check it still applies (an options fingerprint, a later month). */
export type StatementAttest = Readonly<Record<string, string | number | boolean>>;

/** One subject's recorded statements: the user's verified words, Olumi's reading of them, and when they were recorded. */
export interface UserStatementRecord {
  readonly subject_key: string;
  readonly field: StatementField;
  readonly statements: readonly UserStatement[];
  readonly recorded_at: string;
  readonly attest?: StatementAttest;
}

/** Current retained text is a reading of correction metadata, never a rewritten human quote. */
export function currentStatementRetention(record: UserStatementRecord): {
  readonly spans: readonly { readonly text: string; readonly origin: 'held_user_statement' | 'unknown' }[];
  readonly complete: boolean;
} | undefined {
  const a = record.attest;
  if (a?.recorded_by !== 'correction') return undefined;
  const unreadable = { spans: [], complete: false } as const;
  const limit = Object.keys(a).length;
  const countOf = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= limit;
  const count = a.retained_count;
  if (!countOf(count)) return unreadable;
  const spans: { text: string; origin: 'held_user_statement' | 'unknown' }[] = [];
  for (let i = 0; i < count; i++) {
    const key = `retained_${i}`, parts = a[`${key}_parts`];
    let text = a[key];
    if (text === undefined) {
      if (!countOf(parts) || parts === 0) return unreadable;
      const pieces = Array.from({ length: parts }, (_, p) => a[`${key}_part_${p}`]);
      if (!pieces.every(p => typeof p === 'string' && p.length > 0)) return unreadable;
      text = pieces.join('');
    } else if (parts !== undefined) return unreadable;
    const origin = a[`${key}_origin`];
    if (typeof text !== 'string' || text.trim() === '' || (origin !== 'held_user_statement' && origin !== 'unknown')) return unreadable;
    spans.push({ text, origin });
  }
  return { spans, complete: true };
}

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const attestOf = (v: unknown): StatementAttest | undefined | null => {
  if (v === undefined) return undefined;
  if (!isRec(v)) return null;
  return Object.values(v).every((x) => typeof x === 'boolean' || (typeof x === 'string' && x.length <= 200) || (typeof x === 'number' && Number.isFinite(x)))
    ? v as StatementAttest : null;
};

/** A well-formed record, or `undefined`: a malformed one is never read as the user's. */
export function userStatementRecordOf(v: unknown): UserStatementRecord | undefined {
  if (!isRec(v) || !text(v.subject_key, 400) || !isStatementField(v.field) || !text(v.recorded_at, 40) || !Array.isArray(v.statements)
    || v.statements.length === 0) return undefined;
  const statements = v.statements.map(userStatementOf);
  const attest = attestOf(v.attest);
  if (statements.some((s) => s === undefined) || attest === null) return undefined;
  return { subject_key: v.subject_key, field: v.field, statements: statements as UserStatement[], recorded_at: v.recorded_at,
    ...(attest !== undefined ? { attest } : {}) };
}

/**
 * A record construction wrote from the brief (AIE 6183705670 (1)): the user's own sentence, kept for the saved model, a reopen and
 * the AI, but never a PRESS. A reader whose meaning is "the user approved this on its card" (the same-people answer, a stated
 * chance) reads only `pressedRecord`; a later press for the same subject replaces it.
 */
export const CONSTRUCTION_ATTEST: StatementAttest = { recorded_by: 'construction' };
export function pressedRecord(record: UserStatementRecord | undefined): UserStatementRecord | undefined {
  return record?.attest?.recorded_by === CONSTRUCTION_ATTEST.recorded_by ? undefined : record;
}

/** The node a subject's record lives on: its own node; a link's `from` node. */
const nodeIdOf = (subject: DoorSubject): string => subject.id;
const nodeOf = (graph: unknown, id: string): Rec | undefined =>
  (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n): n is Rec => isRec(n) && n.id === id) : undefined);

/** Every well-formed record on a node, in stored order: what the AI's working input and a reopen show beside it. */
export function userStatementsOn(node: unknown): UserStatementRecord[] {
  const held = isRec(node) && Array.isArray(node[USER_STATEMENTS_KEY]) ? node[USER_STATEMENTS_KEY] as unknown[] : [];
  return held.map(userStatementRecordOf).filter((r): r is UserStatementRecord => r !== undefined);
}

/** The subject's record on its node, or `undefined`. */
export function userStatementOnNode(node: unknown, key: string): UserStatementRecord | undefined {
  return userStatementsOn(node).find((r) => r.subject_key === key);
}

/** The subject's record, or `undefined`. */
export function userStatementFor(graph: unknown, subject: DoorSubject): UserStatementRecord | undefined {
  return userStatementOnNode(nodeOf(graph, nodeIdOf(subject)), subjectKey(subject));
}

/**
 * ⭐ THE ONE READ OF "THE USER STATED THIS LINK'S EFFECT AS A RANGE": construction's verified record from the brief (its attest),
 * a range statement, not negated. ⛔ #3329 GREEN CORE (DL-3 02:59Z; BUDDY-A B1): a range pressed from CHAT (`LINK_EFFECT_RANGE_ROW`,
 * no attest) is Olumi's reading the user chose to use, and an AI-omitted negation cannot be told apart from a genuine range, so it
 * grants no authority here: its size is still asked. Consent never repairs a possibly wrong reading (the #3325 lesson).
 */
export function linkHoldsStatedRange(graph: unknown, from: string, to: string): boolean {
  const record = userStatementFor(graph, { kind: 'link', id: from, to_id: to, field: 'effect' });
  return record?.attest?.recorded_by === CONSTRUCTION_ATTEST.recorded_by
    && record.statements.some((st) => st.form === 'range' && st.negated !== true);
}

/** The record ONE press writes. */
export function userStatementRecord(subject: DoorSubject, statements: readonly UserStatement[], recordedAt: string,
  attest?: StatementAttest): UserStatementRecord {
  return { subject_key: subjectKey(subject), field: subject.field, statements: JSON.parse(JSON.stringify(statements)) as UserStatement[],
    recorded_at: recordedAt, ...(attest !== undefined ? { attest: { ...attest } } : {}) };
}

/**
 * The graph with the subject's record written (the writer's half; door members only): it REPLACES any record for the same
 * subject, and leaves every other record and node as it was. `undefined` when the subject's node is not in the graph.
 */
export function withUserStatement(graph: Rec & { nodes: unknown[] }, record: UserStatementRecord, subject: DoorSubject): (Rec & { nodes: unknown[] }) | undefined {
  if (record.subject_key !== subjectKey(subject)) return undefined;
  const at = graph.nodes.findIndex((n) => isRec(n) && n.id === nodeIdOf(subject));
  if (at < 0) return undefined;
  const node = graph.nodes[at] as Rec;
  const held = Array.isArray(node[USER_STATEMENTS_KEY]) ? (node[USER_STATEMENTS_KEY] as unknown[]) : [];
  const kept = held.filter((h) => !(isRec(h) && h.subject_key === record.subject_key));
  const nodes = [...graph.nodes];
  nodes[at] = { ...node, [USER_STATEMENTS_KEY]: [...kept, JSON.parse(JSON.stringify(record)) as Rec] };
  return { ...graph, nodes };
}

/** Whether the graph holds exactly this record for the subject: the read-back's half. */
export function holdsUserStatement(graph: unknown, record: UserStatementRecord, subject: DoorSubject): boolean {
  const held = userStatementFor(graph, subject);
  return held !== undefined && isDeepStrictEqual(held, userStatementRecordOf(JSON.parse(JSON.stringify(record))));
}
