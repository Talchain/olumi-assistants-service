/** Scoped source corrections on the existing statement-record operation; no text-to-retraction matcher. */
import { isDeepStrictEqual } from 'node:util';
import { userStatementOf, verifyStatements, type UserStatement } from '../../agent-lane/user-statements.js';
import { wholeStatementIn } from '../../goal-target/input-claim-context.js';
import { statementBoundTo } from '../read.js';
import { subjectKey, resolveSubject, type DoorSubject } from '../subject.js';
import { userStatementFor, userStatementRecord, userStatementRecordOf, withUserStatement, type UserStatementRecord } from '../statements.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export interface CorrectionEditRequest {
  readonly subject: DoorSubject;
  readonly expected_record?: UserStatementRecord | null;
  readonly retirement: { readonly quote: string; readonly scope: 'whole' | 'part'; readonly disposition: 'historical' | 'retracted' };
  /** Explicit source spans to keep, never an inferred complement of the retired span. */
  readonly retained: readonly string[];
  readonly reading_words: string;
  readonly legacy?: { readonly field: 'already_true_quote' | 'dependency'; readonly expected: string; readonly replacement: string | null };
}
export interface StatementCorrectionRequest { readonly quote: string; readonly edits: readonly CorrectionEditRequest[] }
export interface ApprovedCorrectionEdit extends CorrectionEditRequest {
  readonly expected_record: UserStatementRecord | null;
  readonly expected_node: Rec;
  readonly record: UserStatementRecord;
}
export interface StatementCorrection {
  readonly source: UserStatement;
  readonly edits: readonly ApprovedCorrectionEdit[];
}
export type CorrectionResult = { readonly refused: string } | { readonly correction: StatementCorrection; readonly candidate: Rec; readonly words: string };

const nodeOf = (graph: Rec, id: string): Rec | undefined => Array.isArray(graph.nodes)
  ? graph.nodes.find((n): n is Rec => rec(n) && n.id === id) : undefined;
const legacyOf = (node: Rec, field: 'already_true_quote' | 'dependency'): unknown => field === 'already_true_quote'
  ? node.already_true_quote : rec(node.draft_widening) ? node.draft_widening.relies_on : undefined;

/** Keep complete earlier quotes, never manufacture a new human quotation by splicing a bundled sentence. */
function replacementStatements(source: UserStatement, e: CorrectionEditRequest): UserStatement[] {
  const current: UserStatement = { ...source, subject: { quantity: subjectKey(e.subject), node_id: e.subject.id,
    ...(e.subject.option_id === undefined ? {} : { option_id: e.subject.option_id }) } };
  return [{ ...current, qualifier: e.reading_words, qualifier_in_quote: source.quote.includes(e.reading_words),
    conditions: e.retained.join('; ') }, ...e.retained.map(span => {
    const earlier = e.expected_record?.statements.find(s => s.quote.includes(span));
    // A legacy string with no source record has unknown origin. Only the current verified message is human evidence.
    const quoted = earlier ?? current;
    return { ...quoted, form: 'describes' as const, low: undefined, high: undefined,
      qualifier: span, qualifier_in_quote: quoted.quote.includes(span),
      conditions: earlier === undefined
        ? 'Olumi’s reading retains this earlier span; its original source is unverified. The current correction is the human source.'
        : 'Only the explicitly retained span is current. Other content of this complete earlier quotation is historical or retracted by the correction.',
      reading: 'olumi' as const };
  })];
}

/** Parse persisted approval bytes with the same complete-record parser as every other statement card. */
export function statementCorrectionOf(value: unknown): StatementCorrection | undefined {
  if (!rec(value) || !Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 6
    || !rec(value.source) || value.source.speaker !== 'user' || value.source.reading !== 'olumi'
    || typeof value.source.quote !== 'string' || typeof value.source.source !== 'string') return undefined;
  const source = userStatementOf(value.source);
  if (source === undefined || source.form !== 'describes' || source.low !== undefined || source.high !== undefined
    || !wholeStatementIn(source.source, source.quote)) return undefined;
  const keys = new Set<string>();
  for (const raw of value.edits) {
    if (!rec(raw) || !rec(raw.subject) || !rec(raw.expected_node) || !rec(raw.retirement)
      || typeof raw.retirement.quote !== 'string' || raw.retirement.quote.trim() === ''
      || !['whole', 'part'].includes(String(raw.retirement.scope)) || !['historical', 'retracted'].includes(String(raw.retirement.disposition))
      || !Array.isArray(raw.retained) || !raw.retained.every(x => typeof x === 'string' && x.trim() !== '')
      || (raw.retirement.scope === 'part' && raw.retained.length === 0)
      || typeof raw.reading_words !== 'string' || raw.reading_words.trim() === '') return undefined;
    const record = userStatementRecordOf(raw.record);
    if (record === undefined || record.subject_key !== subjectKey(raw.subject as unknown as DoorSubject)
      || (raw.expected_record !== null && userStatementRecordOf(raw.expected_record) === undefined)) return undefined;
    if (keys.has(record.subject_key)) return undefined;
    keys.add(record.subject_key);
    if (raw.legacy !== undefined && (!rec(raw.legacy) || !['already_true_quote', 'dependency'].includes(String(raw.legacy.field))
      || typeof raw.legacy.expected !== 'string' || !(raw.legacy.replacement === null || typeof raw.legacy.replacement === 'string'))) return undefined;
  }
  return value as unknown as StatementCorrection;
}

/** The native postimage. Expected records/nodes are checked before any member changes; a refusal changes nothing. */
export function applyStatementCorrection(graph: unknown, value: unknown): { candidate?: Rec; refused?: string; unchanged?: true } {
  const approved = statementCorrectionOf(value);
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || approved === undefined) return { refused: 'invalid_statement' };
  // A complete matching postimage is a retry, never an excuse to ignore a stale preimage on a partial write.
  const held = approved.edits.every(e => {
    const node = nodeOf(graph, e.subject.id);
    return node !== undefined && isDeepStrictEqual(userStatementFor(graph, e.subject), e.record)
      && (e.legacy === undefined || isDeepStrictEqual(legacyOf(node, e.legacy.field), e.legacy.replacement === null ? undefined : e.legacy.replacement));
  });
  if (held) return { candidate: graph, unchanged: true };
  for (const e of approved.edits) {
    const resolved = resolveSubject(graph, e.subject);
    const node = nodeOf(graph, e.subject.id);
    if (resolved.kind !== 'resolved' || !isDeepStrictEqual(resolved.subject, e.subject) || node === undefined) return { refused: 'node_not_found' };
    if (!isDeepStrictEqual(node, e.expected_node)
      || !isDeepStrictEqual(userStatementFor(graph, e.subject) ?? null, e.expected_record)) return { refused: 'node_changed' };
    if (statementBoundTo(graph, e.subject, approved.source.quote) !== 'bound') return { refused: 'unrelated_correction' };
    const oldQuotes = e.expected_record?.statements.map(s => s.quote) ?? [];
    if (e.legacy !== undefined) {
      if (legacyOf(node, e.legacy.field) !== e.legacy.expected) return { refused: 'node_changed' };
      oldQuotes.push(e.legacy.expected);
      if (e.legacy.replacement !== null && !approved.source.quote.includes(e.legacy.replacement)) return { refused: 'replacement_not_stated' };
    }
    if (!oldQuotes.some(q => q.includes(e.retirement.quote))) return { refused: 'retired_source_not_held' };
    if (!e.retained.every(q => oldQuotes.some(old => old.includes(q)))) return { refused: 'retained_source_not_stated' };
    // The JSON round-trip is the stored representation: omitted bounds are absent, never another numerical reading.
    if (!isDeepStrictEqual(e.record.statements, JSON.parse(JSON.stringify(replacementStatements(approved.source, e))))) return { refused: 'invalid_statement' };
    if (!isDeepStrictEqual(e.record.attest, { recorded_by: 'correction', disposition: e.retirement.disposition,
      scope: e.retirement.scope })) return { refused: 'invalid_statement' };
  }
  let candidate = structuredClone(graph) as Rec & { nodes: unknown[] };
  for (const e of approved.edits) {
    const next = withUserStatement(candidate, e.record, e.subject);
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
export function statementCorrectionWords(c: StatementCorrection): string {
  const recordWords = (record: UserStatementRecord | null): string => record === null ? 'No earlier structured record.'
    : record.statements.map(s => [
      `Human source: “${s.source}”.`, ...(s.quote === s.source ? [] : [`Quoted words: “${s.quote}”.`]),
      ...(s.low === undefined && s.high === undefined ? [] : [`Recorded figure/bounds: ${s.low ?? 'unknown'} to ${s.high ?? 'unknown'} ${s.unit ?? '(unit unknown)'}.`]),
      ...(s.reference === undefined ? [] : [`Reference: ${s.reference}.`]), ...(s.period === undefined ? [] : [`Period: ${s.period}.`]),
      ...(s.qualifier === undefined ? [] : [`Olumi’s reading of the relevant words: ${s.qualifier}.`]),
      ...(s.conditions === undefined ? [] : [`Scope and conditions: ${s.conditions}.`]),
      ...(s.negated === true ? ['The statement is negated.'] : []),
    ].join('\n')).join('\n');
  return [`From your message: “${c.source.quote}”. Olumi proposes this reading of your correction.`,
    ...c.edits.flatMap(e => [
      `Subject: ${String(e.expected_node.label)}; field: ${e.subject.field}.`,
      `Retire as ${e.retirement.disposition} (${e.retirement.scope}): “${e.retirement.quote}”.`,
      `Keep explicitly: ${e.retained.length ? e.retained.map(q => `“${q}”`).join('; ') : 'nothing from the retired record'}.`,
      `Earlier source and reading:\n${recordWords(e.expected_record)}`, `Replacement source and reading:\n${recordWords(e.record)}`,
      ...(e.legacy === undefined ? [] : [`${e.legacy.field === 'dependency' ? 'Recorded dependency' : 'Current evidence claim'}: “${e.legacy.expected}” → ${e.legacy.replacement === null ? 'removed from current evidence' : `“${e.legacy.replacement}”`}.`]),
    ]),
    'Only the explicitly retained spans remain current from the earlier account; its other content is historical or retracted as shown. Omitted changes: none. Unknowns, figures, link strengths, options, settings and other people’s recorded views remain unchanged. This records source meaning; it does not calculate a numerical effect. Your quote stays human source; the interpretation remains Olumi’s after approval.',
  ].join('\n');
}

export function prepareStatementCorrection(graph: unknown, request: StatementCorrectionRequest,
  texts: { now?: string; conversation?: string }, at: string): CorrectionResult {
  if (!rec(graph) || !Array.isArray(graph.nodes) || typeof request?.quote !== 'string'
    || !wholeStatementIn(texts.now ?? '', request.quote) || !Array.isArray(request.edits) || request.edits.length === 0) return { refused: 'correction_not_stated' };
  const edits: ApprovedCorrectionEdit[] = [];
  let source: UserStatement | undefined;
  for (const e of request.edits) {
    if (!rec(e) || !rec(e.subject)) return { refused: 'invalid_statement' };
    const node = nodeOf(graph, e.subject?.id);
    if (node === undefined) return { refused: 'node_not_found' };
    const verified = verifyStatements([{ quote: request.quote, form: 'describes' }], texts,
      { subject: { quantity: subjectKey(e.subject), node_id: e.subject.id }, unit: '', forms: ['describes'], figuresIn: () => [] });
    if (verified.kind === 'refused') return { refused: verified.refusal };
    source = verified.statements[0]!;
    if (!Array.isArray(e.retained)) return { refused: 'retained_list_required' };
    const expected = e.expected_record === undefined ? userStatementFor(graph, e.subject) ?? null : e.expected_record;
    edits.push({ ...e, expected_record: expected, expected_node: structuredClone(node),
      record: userStatementRecord(e.subject, replacementStatements(source, { ...e, expected_record: expected }), at,
        { recorded_by: 'correction', disposition: e.retirement?.disposition, scope: e.retirement?.scope }) });
  }
  const correction: StatementCorrection = { source: source!, edits };
  const written = applyStatementCorrection(graph, correction);
  if (written.refused || written.candidate === undefined) return { refused: written.refused ?? 'invalid_statement' };
  return { correction, candidate: written.candidate, words: statementCorrectionWords(correction) };
}
