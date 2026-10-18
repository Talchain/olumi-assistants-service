/**
 * ⭐ SYSTEM 1: the user's recorded statements, kept on the subject's node (DL ruling 14 Oct 23:09Z; shape SESSION4 23:11Z; AIE
 * 6180193788: "preserve the actual human definition and its speaker/source independently through saved evidence, THIS working AI
 * input and cold reopen"). ONE node key, `user_statements`: one record per subject (`subjectKey`), on the subject's node (a link's
 * on its `from` node). Written ONLY through `withUserStatement` by the door's writer, in the same commit as the member its reading
 * sets; a later record for the same subject REPLACES it (a correction supersedes). Read through `userStatementFor`, never the raw
 * key. Pure.
 */
import { isDeepStrictEqual } from 'node:util';
import { namesBothEnds, speechReading, wholeStatementIn } from '../goal-target/input-claim-context.js';
import { isFactorNamedByUser } from '../routing/stated-event-risk.js';
import { answeredAsk, askedSubjects, type StatementAsk } from './ask.js';

import { userStatementOf, verifyStatements, type UserStatement } from '../agent-lane/user-statements.js';
import { plainQuoteWords, verbatimSourceLine } from '../agent-lane/quote-confirmation.js';
import { quoteSpansIn } from '../agent-lane/stated-by-user.js';
import { isStatementField, subjectKey, subjectNodeKey, resolveSubject, SUBJECT_KINDS, type DoorSubject, type StatementField } from './subject.js';

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
  alsoAnswers: readonly DoorSubject[] = [], found?: { subject?: DoorSubject }, correction?: Pick<ApprovedCorrectionEdit, 'retirement'>): 'bound' | 'another' | 'unbound' {
  if (found !== undefined) delete found.subject;
  // The subjects an ask of which this statement may answer: its own, and the row's `answersFor` (one key each).
  // The NODES this statement may answer for: its own, and the rows' `answersFor` (a cohort option's "the same people" answers the goal's ask).
  const answers = new Set([subject, ...alsoAnswers].map(subjectNodeKey));
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (subject.kind === 'link') {
    const entities = nodes.flatMap((n) => (typeof n.id === 'string' && typeof n.label === 'string' ? [{ id: n.id, label: n.label }] : []));
    if (subject.to_id !== undefined && namesBothEnds(quote, entities, subject.id, subject.to_id)) return 'bound';
  } else {
    const same = nodes.filter((n) => n.kind === subject.kind && typeof n.id === 'string' && typeof n.label === 'string');
    let named = same.filter((n) => isFactorNamedByUser(String(n.label), quote));
    if (correction !== undefined) {
      // Corrections opt in. Old sentences are never names; quoted bytes identify only a node that uniquely holds them across the model.
      const speech = speechReading(quote), retired = speechReading(correction.retirement.quote).text;
      const outside = speech.text.split('').map((ch, at) => speech.inSpeech(at) ? ' ' : ch).join('');
      const labelled = same.filter(n => isFactorNamedByUser(String(n.label), outside));
      const cited = retired !== '' && quoteSpansIn(speech.text, retired).some(at => speech.inSpeech(at) && speech.inSpeech(at + retired.length));
      const holders = cited ? nodes.filter(n => [
        ...recordsWithUnknownSpeakerOn(n).flatMap(r => r.statements.map(s => s.quote)),
        ...[legacyOf(n, 'already_true_quote'), legacyOf(n, 'dependency')].filter((s): s is string => typeof s === 'string'),
      ].some(held => quoteSpansIn(speechReading(held).text, retired).length > 0)) : [];
      named = labelled.length > 0 ? labelled : cited ? holders.length === 1 ? holders.filter(n => n.kind === subject.kind) : []
        : same.filter(n => isFactorNamedByUser(String(n.label), speech.text));
    }
    if (named.length === 1) {
      if (found !== undefined) found.subject = { ...subject, id: String(named[0]!.id) };
      return named[0]!.id === subject.id ? 'bound' : 'another';
    }
    if (named.length > 1) return correction !== undefined && named.some(n => n.id === subject.id)
      && named.every(n => answers.has(subjectNodeKey({ ...subject, id: String(n.id) }))) ? 'bound' : 'unbound';
  }
  const s = ctx.selection;
  if (s !== undefined && s.unresolved === 'none' && s.element_ids.length === 1) {
    if (s.element_ids[0] === subject.id) return 'bound';
    if (nodes.some((n) => n.id === s.element_ids[0] && n.kind === subject.kind)) {
      if (found !== undefined) found.subject = { ...subject, id: s.element_ids[0]! };
      return 'another';
    }
  }
  const answered = answeredAsk(answering, ctx.asks ?? []);
  // The ask names the NODE; the field is the row's reading of the words (one readiness line asks "true now?" and "how likely?").
  if (answered !== undefined) {
    if (found !== undefined) found.subject = answered.subject;
    return answers.has(subjectNodeKey(answered.subject)) ? 'bound' : 'another';
  }
  if (typeof answering === 'string' && answering.trim() !== '') return 'unbound';
  const subjects = askedSubjects(ctx.preceding_ask, ctx.asks ?? []);
  const asked = [...new Set(subjects.map(subjectNodeKey))];
  if (asked.length === 1) {
    if (found !== undefined) found.subject = subjects[0];
    return answers.has(asked[0]!) ? 'bound' : 'another';
  }
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

/** A stored record whole, or `undefined` if any part is malformed; `unknownSpeaker` keeps the brief's speaker-unknown words too. */
function recordOf(v: unknown, unknownSpeaker: boolean): UserStatementRecord | undefined {
  if (!isRec(v) || !text(v.subject_key, 400) || !isStatementField(v.field) || !text(v.recorded_at, 40) || !Array.isArray(v.statements)
    || v.statements.length === 0) return undefined;
  const parsed = v.statements.map(userStatementOf);
  const attest = attestOf(v.attest);
  if (parsed.some((s) => s === undefined) || attest === null) return undefined;
  const statements = (parsed as UserStatement[]).filter((s) => unknownSpeaker || s.speaker === 'user');
  return statements.length === 0 ? undefined : { subject_key: v.subject_key, field: v.field, statements, recorded_at: v.recorded_at,
    ...(attest !== undefined ? { attest } : {}) };
}

/**
 * A well-formed record, or `undefined`: a malformed one is never read as the user's. ⛔ DL-3 #3376 ruling 3: the user's statements
 * ONLY, exactly what every reader saw before construction kept speaker-unknown words; a record holding only those is none here.
 */
export function userStatementRecordOf(v: unknown): UserStatementRecord | undefined {
  return recordOf(v, false);
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

const heldOn = (node: unknown): unknown[] => (isRec(node) && Array.isArray(node[USER_STATEMENTS_KEY]) ? node[USER_STATEMENTS_KEY] as unknown[] : []);

/** Every well-formed record on a node, in stored order, as `userStatementRecordOf` reads each: the user's statements only. */
export function userStatementsOn(node: unknown): UserStatementRecord[] {
  return heldOn(node).map(userStatementRecordOf).filter((r): r is UserStatementRecord => r !== undefined);
}

/**
 * ⛔ The ONE read of the brief's speaker-unknown words (`UserStatement.speaker`), beside the user's own, for the code that shows
 * them: the AI's context and the not-represented list. Never the user's; every other reader takes `userStatementsOn`.
 */
export function recordsWithUnknownSpeakerOn(node: unknown): UserStatementRecord[] {
  return heldOn(node).map((r) => recordOf(r, true)).filter((r): r is UserStatementRecord => r !== undefined);
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

/** Scoped source correction stays with the canonical record owner; no second store or text-to-retraction matcher. */
interface CorrectionEditRequest {
  readonly subject: DoorSubject;
  readonly expected_record?: UserStatementRecord | null;
  readonly retirement: { readonly quote: string; readonly scope: 'whole' | 'part'; readonly disposition: 'historical' | 'retracted' };
  /** Explicit source spans to keep, never an inferred complement of the retired span. */
  readonly retained: readonly string[];
  readonly reading_words: string;
  readonly legacy?: { readonly field: 'already_true_quote' | 'dependency'; readonly expected: string; readonly replacement: string | null };
}
export interface StatementCorrectionRequest { readonly quote: string; readonly edits: readonly CorrectionEditRequest[]; /** The AI's own speaker reading (`QUOTE_SPEAKER`, lean core P2). */ readonly speaker?: unknown }
interface ApprovedCorrectionEdit extends CorrectionEditRequest {
  readonly expected_record: UserStatementRecord | null;
  readonly expected_node: Rec;
  readonly record: UserStatementRecord;
}
export interface StatementCorrection {
  readonly source: UserStatement;
  readonly edits: readonly ApprovedCorrectionEdit[];
  /** The server's existing subject context, frozen with the card; never supplied by the tool's correction argument. */
  readonly binding_context?: DoorContext;
}
type CorrectionResult = { readonly refused: string; readonly words?: string } | { readonly correction: StatementCorrection; readonly candidate: Rec; readonly words: string };

const legacyOf = (node: Rec, field: 'already_true_quote' | 'dependency'): unknown => field === 'already_true_quote'
  ? node.already_true_quote : isRec(node.draft_widening) ? node.draft_widening.relies_on : undefined;

/** Untouched context from this subject's existing carrier; never evidence for the correction's source or retained spans. */
const correctionUnknowns = (node: unknown, subject: DoorSubject): readonly UserStatement[] =>
  recordsWithUnknownSpeakerOn(node).find(r => r.subject_key === subjectKey(subject))?.statements.filter(s => s.speaker === 'unknown') ?? [];

/** A source correction cannot silently replace adoption or other held attestation. Carry-forward needs its own contract. */
function protectedAttestation(record: UserStatementRecord | null | undefined): boolean {
  const by = record?.attest?.recorded_by;
  return record?.attest !== undefined && by !== 'construction' && by !== 'correction';
}

/** Retention describes the correction, never the conditions under which the human statement holds. */
function correctionAttest(e: CorrectionEditRequest): StatementAttest {
  const metadata: Record<string, string | number | boolean> = { recorded_by: 'correction', disposition: e.retirement?.disposition,
    scope: e.retirement?.scope, retained_count: e.retained.length };
  e.retained.forEach((span, index) => {
    if (typeof span !== 'string') return;
    const key = `retained_${index}`;
    // Existing attestation strings have a 200-character limit; preserve longer spans losslessly in ordered pieces.
    if (span.length <= 200) metadata[key] = span;
    else {
      metadata[`${key}_parts`] = Math.ceil(span.length / 200);
      for (let start = 0; start < span.length; start += 200) metadata[`${key}_part_${start / 200}`] = span.slice(start, start + 200);
    }
    metadata[`${key}_origin`] = e.expected_record?.statements.some(s => s.quote.includes(span)) ? 'held_user_statement' : 'unknown';
  });
  return metadata;
}

/** Keep complete earlier quotes, never manufacture a new human quotation by splicing a bundled sentence. */
function replacementStatements(source: UserStatement, e: CorrectionEditRequest): UserStatement[] {
  const current: UserStatement = { ...source, subject: { quantity: subjectKey(e.subject), node_id: e.subject.id,
    ...(e.subject.option_id === undefined ? {} : { option_id: e.subject.option_id }) } };
  return [{ ...current, qualifier: e.reading_words, qualifier_in_quote: source.quote.includes(e.reading_words) }, ...e.retained.map(span => {
    const earlier = e.expected_record?.statements.find(s => s.quote.includes(span));
    if (earlier !== undefined) return { ...earlier };
    // A legacy string with no source record has unknown origin. Only the current verified message is human evidence.
    return { ...current, qualifier: span, qualifier_in_quote: current.quote.includes(span) };
  })];
}

/** A pending card must not turn malformed context into a crash or a different binding on its native press. */
function isCorrectionContext(value: unknown): value is DoorContext {
  if (!isRec(value) || (value.preceding_ask !== undefined && typeof value.preceding_ask !== 'string')) return false;
  const s = value.selection;
  if (s !== undefined && (!isRec(s) || !Array.isArray(s.element_ids) || !s.element_ids.every(id => typeof id === 'string')
    || typeof s.unresolved !== 'string')) return false;
  return value.asks === undefined || (Array.isArray(value.asks) && value.asks.every(a => isRec(a) && typeof a.words === 'string'
    && isRec(a.subject) && typeof a.subject.kind === 'string' && (SUBJECT_KINDS as readonly string[]).includes(a.subject.kind) && typeof a.subject.id === 'string'
    && isStatementField(a.subject.field) && (a.subject.option_id === undefined || typeof a.subject.option_id === 'string')
    && (a.subject.to_id === undefined || typeof a.subject.to_id === 'string') && (a.turn_id === undefined || typeof a.turn_id === 'string')));
}

/** Parse persisted approval bytes with the same complete-record parser as every other statement card. */
export function statementCorrectionOf(value: unknown): StatementCorrection | undefined {
  if (!isRec(value) || !Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 6
    || !isRec(value.source) || value.source.speaker !== 'user' || value.source.reading !== 'olumi'
    || typeof value.source.quote !== 'string' || typeof value.source.source !== 'string') return undefined;
  const source = userStatementOf(value.source);
  if (source === undefined || source.form !== 'describes' || source.low !== undefined || source.high !== undefined
    || !wholeStatementIn(source.source, source.quote)) return undefined;
  const context = value.binding_context;
  if (context !== undefined && !isCorrectionContext(context)) return undefined;
  const keys = new Set<string>();
  const edits: readonly ApprovedCorrectionEdit[] = value.edits;
  for (const raw of edits) {
    if (!isRec(raw) || !isRec(raw.subject) || !isRec(raw.expected_node) || !isRec(raw.retirement)
      || typeof raw.retirement.quote !== 'string' || raw.retirement.quote.trim() === ''
      || !['whole', 'part'].includes(String(raw.retirement.scope)) || !['historical', 'retracted'].includes(String(raw.retirement.disposition))
      || !Array.isArray(raw.retained) || !raw.retained.every(x => typeof x === 'string' && x.trim() !== '')
      || (raw.retirement.scope === 'part' && raw.retained.length === 0)
      || typeof raw.reading_words !== 'string' || raw.reading_words.trim() === '') return undefined;
    const record = userStatementRecordOf(raw.record);
    if (record === undefined || record.subject_key !== subjectKey(raw.subject)
      || (raw.expected_record !== null && userStatementRecordOf(raw.expected_record) === undefined)) return undefined;
    if (keys.has(record.subject_key)) return undefined;
    keys.add(record.subject_key);
    if (raw.legacy !== undefined && (!isRec(raw.legacy) || !['already_true_quote', 'dependency'].includes(String(raw.legacy.field))
      || typeof raw.legacy.expected !== 'string' || !(raw.legacy.replacement === null || typeof raw.legacy.replacement === 'string'))) return undefined;
  }
  // Only correction members cross this read: review display fields cannot select the approval wording.
  return { source, edits, ...(context === undefined ? {} : { binding_context: context }) };
}

interface CorrectionDiagnostic {
  failed_check?: string;
  binder_result?: ReturnType<typeof statementBoundTo>;
  /** Zero-based index in the requested edit list. */
  failed_edit_index?: number;
  /** Native binding fact for the non-authorising subject question; never logged or used to retarget a write. */
  bound_subject?: DoorSubject;
}

/** The native postimage. Expected records/nodes are checked before any member changes; a refusal changes nothing. */
export function applyStatementCorrection(graph: unknown, value: unknown, diagnostic?: CorrectionDiagnostic): { candidate?: Rec; refused?: string; unchanged?: true } {
  const approved = statementCorrectionOf(value);
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || approved === undefined) return { refused: 'invalid_statement' };
  if (approved.edits.some(e => protectedAttestation(e.expected_record))) return { refused: 'correction_attestation_protected' };
  // A complete matching postimage is a retry, never an excuse to ignore a stale preimage on a partial write.
  const held = approved.edits.every(e => {
    const node = nodeOf(graph, e.subject.id);
    return node !== undefined && isDeepStrictEqual(userStatementFor(graph, e.subject), e.record)
      && isDeepStrictEqual(correctionUnknowns(node, e.subject), correctionUnknowns(e.expected_node, e.subject))
      && (e.legacy === undefined || isDeepStrictEqual(legacyOf(node, e.legacy.field), e.legacy.replacement === null ? undefined : e.legacy.replacement));
  });
  if (held) return { candidate: graph, unchanged: true };
  for (const [editIndex, e] of approved.edits.entries()) {
    const resolved = resolveSubject(graph, e.subject);
    const node = nodeOf(graph, e.subject.id);
    if (resolved.kind !== 'resolved' || !isDeepStrictEqual(resolved.subject, e.subject) || node === undefined) return { refused: 'node_not_found' };
    if (!isDeepStrictEqual(node, e.expected_node)
      || !isDeepStrictEqual(userStatementFor(graph, e.subject) ?? null, e.expected_record)) return { refused: 'node_changed' };
    const found: { subject?: DoorSubject } = {};
    let binding = statementBoundTo(graph, e.subject, approved.source.quote, approved.binding_context, undefined, [], found, e);
    // A bundle can name several items; a question about one item does not bind the others.
    if (binding === 'unbound') binding = statementBoundTo(graph, e.subject, approved.source.quote, {}, undefined,
      approved.edits.map(edit => edit.subject), found, e);
    if (binding !== 'bound') {
      if (diagnostic !== undefined) Object.assign(diagnostic, { binder_result: binding, failed_edit_index: editIndex, bound_subject: found.subject,
        failed_check: `correction.postimage.unrelated_correction.${binding}` });
      return { refused: 'unrelated_correction' };
    }
    // Unknown words prove held source bytes only; their original attribution remains unchanged in the postimage.
    const oldQuotes = [...(e.expected_record?.statements.map(s => s.quote) ?? []), ...correctionUnknowns(node, e.subject).map(s => s.quote)];
    if (e.legacy !== undefined) {
      if (legacyOf(node, e.legacy.field) !== e.legacy.expected) return { refused: 'node_changed' };
      oldQuotes.push(e.legacy.expected);
      if (e.legacy.replacement !== null && !approved.source.quote.includes(e.legacy.replacement)) return { refused: 'replacement_not_stated' };
    }
    if (!oldQuotes.some(q => q.includes(e.retirement.quote))) return { refused: 'retired_source_not_held' };
    if (!e.retained.every(q => oldQuotes.some(old => old.includes(q)))) return { refused: 'retained_source_not_stated' };
    // Compare the exact stored representation, including every retained form, figure and condition.
    if (!isDeepStrictEqual(e.record.statements, JSON.parse(JSON.stringify(replacementStatements(approved.source, e))))) return { refused: 'invalid_statement' };
    if (!isDeepStrictEqual(e.record.attest, correctionAttest(e))) return { refused: 'invalid_statement' };
  }
  let candidate = structuredClone(graph) as Rec & { nodes: unknown[] };
  for (const e of approved.edits) {
    const next = withUserStatement(candidate, { ...e.record,
      statements: [...e.record.statements, ...correctionUnknowns(e.expected_node, e.subject)] }, e.subject);
    if (next === undefined) return { refused: 'node_not_found' };
    candidate = next;
    if (e.legacy !== undefined) {
      const node = nodeOf(candidate, e.subject.id)!;
      const owner = e.legacy.field === 'already_true_quote' ? node : { ...(node.draft_widening as Rec) };
      const key = e.legacy.field === 'already_true_quote' ? 'already_true_quote' : 'relies_on';
      if (e.legacy.replacement === null) delete owner[key]; else owner[key] = e.legacy.replacement;
      if (e.legacy.field === 'dependency') node.draft_widening = owner;
    }
  }
  return { candidate };
}

/** All changes are existing record/source members. The complete old/new bytes are available before approval. */
export function statementCorrectionWords(c: StatementCorrection | { readonly selected_label: string; readonly bound_label?: string }
  | { readonly readings: readonly string[]; readonly source_state: 'missing' | 'partial' | 'reported' | 'unknown';
    readonly source_words?: string; readonly excerpt_words?: string }, legacy = false): string {
  if ('readings' in c) return ['Review the correction’s source',
    ...[...new Set(c.readings)].map(reading => `Olumi’s reading: ${reading}.`),
    c.source_state === 'missing' ? 'Olumi could not find words of your own stating this correction. This review does not authorise a change.'
      : c.source_state === 'partial' ? 'Olumi could not verify this excerpt as the complete applicable statement. This review does not authorise a change.'
        : c.source_state === 'reported' ? 'These words report another speaker’s view; they do not establish that you assert the reported correction. This review does not authorise a change.'
          : 'Olumi could not establish who asserted these words. This review does not authorise a change.',
    ...(c.excerpt_words === undefined ? [] : [`Excerpt — your recorded words: “${c.excerpt_words}”.`]),
    ...(c.source_words === undefined ? [] : [c.source_state === 'partial' ? `Recorded words — you: “${c.source_words}”.`
      : c.source_state === 'reported' ? `Reported words — speaker unknown: “${c.source_words}”.` : `Words — speaker unknown: “${c.source_words}”.`]),
  ].join('\n');
  if ('selected_label' in c) return c.bound_label === undefined
    ? 'Olumi could not establish which item these words concern. Which item should this correction concern?'
    : `Olumi reads these words as referring to “${c.bound_label}”, rather than “${c.selected_label}”. Which item should this correction concern?`;
  const amountWords = (s: UserStatement): string[] => {
    const unit = s.unit ? ` ${s.unit}` : ' (unit unknown)';
    if (s.low !== undefined && s.high !== undefined) return [s.low === s.high
      ? `Recorded amount: ${s.low}${unit}.` : `Recorded range: between ${s.low} and ${s.high}${unit}.`];
    if (s.low !== undefined) return [`Recorded lower limit: at least ${s.low}${unit}.`];
    if (s.high !== undefined) return [`Recorded upper limit: at most ${s.high}${unit}.`];
    return [];
  };
  const fieldWords: Record<string, string> = { level: 'current amount', target: 'aim', holds_now: 'current account', occurrence: 'likelihood',
    lead: 'timing', effect: 'effect', measure: 'meaning', relation: 'explanation' };
  const recordWords = (record: UserStatementRecord | null): string => record === null ? 'No earlier source was recorded.'
    : record.statements.map(s => [
      legacy || s.speaker === 'user' ? `Your words: “${s.source}”.` : `Recorded words — speaker/source unknown: “${s.source}”.`,
      ...(s.quote === s.source ? [] : [`Quoted words: “${s.quote}”.`]), ...amountWords(s),
      ...(s.reference === undefined ? [] : [`Reference: ${s.reference}.`]), ...(s.period === undefined ? [] : [`Period: ${s.period}.`]),
      ...(s.qualifier === undefined ? [] : [`Olumi’s reading of the relevant words: ${s.qualifier}.`]),
      ...(s.conditions === undefined ? [] : [`Scope and conditions: ${s.conditions}.`]),
      ...(s.negated === true ? ['The statement is negated.'] : []),
    ].join('\n')).join('\n');
  return [legacy ? `From your message: “${c.source.quote}”. Olumi proposes this reading of your correction.`
    : `Review Olumi’s proposed correction\nRecorded words — you: “${c.source.source}”.`,
    ...c.edits.flatMap(e => [
      `For ${String(e.expected_node.label)}, correct the ${fieldWords[e.subject.field] ?? 'account'}.`,
      ...(legacy ? [] : [`Olumi’s reading: ${e.reading_words}. Proposed change to “${String(e.expected_node.label)}” — ${fieldWords[e.subject.field] ?? 'account'}:`]),
      e.retirement.disposition === 'retracted' ? `Withdraw “${e.retirement.quote}” from the current account.`
        : `Keep “${e.retirement.quote}” only as earlier context.`,
      `Keep explicitly: ${e.retained.length ? e.retained.map(q => `“${q}”`).join('; ') : 'nothing from the retired record'}.`,
      ...e.retained.filter(span => !e.expected_record?.statements.some(s => s.quote.includes(span)))
        .map(span => `For the earlier words “${span}”, the original speaker and source are unknown. Your current correction is the human source; it does not verify who supplied those earlier words.`),
      `Earlier source and reading:\n${recordWords(legacy ? e.expected_record
        : recordsWithUnknownSpeakerOn(e.expected_node).find(r => r.subject_key === subjectKey(e.subject)) ?? e.expected_record)}`,
      `${legacy ? '' : '→\n'}Replacement source and reading:\n${recordWords(legacy ? e.record : { ...e.record,
        statements: [...e.record.statements, ...correctionUnknowns(e.expected_node, e.subject)] })}`,
      ...(e.legacy === undefined ? [] : [`${e.legacy.field === 'dependency' ? 'Recorded dependency' : 'Current evidence claim'}: “${e.legacy.expected}” → ${e.legacy.replacement === null ? 'removed from current evidence' : `“${e.legacy.replacement}”`}.`]),
    ]),
    'Only the explicitly kept parts remain current from the earlier account; its other content is withdrawn or kept as earlier context as shown. This card records only the listed source corrections. Other changes need their own supported card. Unknowns, figures, link strengths, options, settings and other people’s recorded views remain unchanged. This records meaning; it does not calculate a numerical effect. Your quote stays yours; the reading remains Olumi’s after approval.',
    ...(legacy ? [] : ['Approving authorises only this displayed change as an Olumi reading; it does not make it something you said.']),
  ].join('\n');
}

export function prepareStatementCorrection(graph: unknown, request: StatementCorrectionRequest,
  texts: { now?: string; conversation?: string }, at: string, diagnostic?: CorrectionDiagnostic, context: DoorContext = {}): CorrectionResult {
  const refused = (reason: string, check: string, words?: string): CorrectionResult => {
    if (diagnostic !== undefined) diagnostic.failed_check = check;
    return { refused: reason, ...(words === undefined ? {} : { words }) };
  };
  // The existing preconditions, in the same order; the observation never grants permission or enters the record.
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return refused('correction_not_stated', 'correction.graph_shape');
  const readings = Array.isArray(request?.edits) ? request.edits.flatMap(e => isRec(e) && typeof e.reading_words === 'string' ? [e.reading_words] : []) : [];
  if (typeof request?.quote !== 'string') return refused('correction_not_stated', 'correction.quote_present',
    statementCorrectionWords({ readings, source_state: 'missing' }));
  // Recover ONLY the same complete line in the existing quote reader's spelling, never an omitted remainder or another speaker.
  const line = verbatimSourceLine({ now: texts.now }, request.quote);
  const quote = line !== undefined && plainQuoteWords(line) === plainQuoteWords(request.quote) ? line : request.quote;
  if (!wholeStatementIn(texts.now ?? '', quote)) {
    // Display only facts from the existing literal/whole-statement and paired-speech readers; no source permission changes.
    const speech = speechReading(texts.now ?? ''), said = speechReading(request.quote).text;
    const spans = quoteSpansIn(speech.text, said);
    const quoted = spans.length > 0 && spans.every(at => speech.inSpeech(at) || speech.inSpeech(at + said.length));
    const reported = quoted && request.speaker === 'other';
    const partial = !quoted && spans.length > 0 && line !== undefined && wholeStatementIn(texts.now ?? '', line);
    return refused('correction_not_stated', 'correction.quote_whole_current_turn', statementCorrectionWords({ readings,
      source_state: reported ? 'reported' : partial ? 'partial' : spans.length === 0 && line === undefined ? 'missing' : 'unknown',
      ...(line === undefined ? {} : { source_words: line }), ...(partial ? { excerpt_words: request.quote } : {}) }));
  }
  if (!Array.isArray(request.edits) || request.edits.length === 0) return refused('correction_not_stated', 'correction.edits_nonempty');
  const edits: ApprovedCorrectionEdit[] = [];
  let source: UserStatement | undefined;
  const requested: readonly CorrectionEditRequest[] = request.edits;
  for (const e of requested) {
    if (!isRec(e) || !isRec(e.subject)) return refused('invalid_statement', 'correction.edit_subject_shape');
    const node = nodeOf(graph, e.subject?.id);
    if (node === undefined) return refused('node_not_found', 'correction.edit_subject_exists');
    const verified = verifyStatements([{ quote, form: 'describes', ...(request.speaker !== undefined ? { speaker: request.speaker } : {}) }], texts,
      { subject: { quantity: subjectKey(e.subject), node_id: e.subject.id }, unit: '', forms: ['describes'], figuresIn: () => [] });
    if (verified.kind === 'refused') return refused(verified.refusal, `correction.source.${verified.refusal}`,
      request.speaker === 'other' || request.speaker === 'unknown' ? statementCorrectionWords({ readings,
        source_state: request.speaker === 'other' ? 'reported' : 'unknown', source_words: line ?? quote }) : undefined);
    source = verified.statements[0]!;
    if (!Array.isArray(e.retained)) return refused('retained_list_required', 'correction.retained_list');
    const expected = e.expected_record === undefined ? userStatementFor(graph, e.subject) ?? null : e.expected_record;
    if (protectedAttestation(expected)) return refused('correction_attestation_protected', 'correction.protected_attestation');
    edits.push({ ...e, expected_record: expected, expected_node: structuredClone(node),
      record: userStatementRecord(e.subject, replacementStatements(source, { ...e, expected_record: expected }), at,
        correctionAttest({ ...e, expected_record: expected })) });
  }
  const correction: StatementCorrection = { source: source!, edits,
    ...(context.selection === undefined && context.preceding_ask === undefined ? {} : { binding_context: structuredClone(context) }) };
  const observed = diagnostic ?? {};
  const written = applyStatementCorrection(graph, correction, observed);
  if (written.refused === 'unrelated_correction') {
    const edit = edits[observed.failed_edit_index!];
    const bound = observed.bound_subject;
    const boundNode = bound === undefined ? undefined : nodeOf(graph, bound.id);
    const end = bound?.to_id === undefined ? undefined : nodeOf(graph, bound.to_id);
    const boundLabel = typeof boundNode?.label !== 'string' || (bound?.kind === 'link' && typeof end?.label !== 'string') ? undefined
      : bound?.kind === 'link' ? `${boundNode.label} → ${String(end!.label)}` : boundNode.label;
    return { refused: written.refused, words: statementCorrectionWords({ selected_label: String(edit?.expected_node.label ?? 'the selected item'),
      ...(observed.binder_result !== 'another' || boundLabel === undefined ? {} : { bound_label: boundLabel }) }) };
  }
  if (written.refused || written.candidate === undefined) return refused(written.refused ?? 'invalid_statement', diagnostic?.failed_check ?? `correction.postimage.${written.refused ?? 'invalid_statement'}`);
  return { correction, candidate: written.candidate, words: statementCorrectionWords(correction) };
}
