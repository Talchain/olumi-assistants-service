/** Scoped source corrections on the existing statement-record operation; no text-to-retraction matcher. */
import { isDeepStrictEqual } from 'node:util';
import { userStatementOf, verifyStatements, type UserStatement } from '../../agent-lane/user-statements.js';
import { wholeStatementIn } from '../../goal-target/input-claim-context.js';
import { subjectKey, resolveSubject, type DoorSubject } from '../subject.js';
import { statementBoundTo, userStatementFor, userStatementRecord, userStatementRecordOf, withUserStatement, type UserStatementRecord, type StatementAttest } from '../statements.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
interface CorrectionEditRequest {
  readonly subject: DoorSubject;
  readonly expected_record?: UserStatementRecord | null;
  readonly retirement: { readonly quote: string; readonly scope: 'whole' | 'part'; readonly disposition: 'historical' | 'retracted' };
  /** Explicit source spans to keep, never an inferred complement of the retired span. */
  readonly retained: readonly string[];
  readonly reading_words: string;
  readonly legacy?: { readonly field: 'already_true_quote' | 'dependency'; readonly expected: string; readonly replacement: string | null };
}
export interface StatementCorrectionRequest { readonly quote: string; readonly edits: readonly CorrectionEditRequest[] }
interface ApprovedCorrectionEdit extends CorrectionEditRequest {
  readonly expected_record: UserStatementRecord | null;
  readonly expected_node: Rec;
  readonly record: UserStatementRecord;
}
export interface StatementCorrection {
  readonly source: UserStatement;
  readonly edits: readonly ApprovedCorrectionEdit[];
}
type CorrectionResult = { readonly refused: string } | { readonly correction: StatementCorrection; readonly candidate: Rec; readonly words: string };

const nodeOf = (graph: Rec, id: string): Rec | undefined => Array.isArray(graph.nodes)
  ? graph.nodes.find((n): n is Rec => rec(n) && n.id === id) : undefined;
const legacyOf = (node: Rec, field: 'already_true_quote' | 'dependency'): unknown => field === 'already_true_quote'
  ? node.already_true_quote : rec(node.draft_widening) ? node.draft_widening.relies_on : undefined;

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

/** Parse persisted approval bytes with the same complete-record parser as every other statement card. */
export function statementCorrectionOf(value: unknown): StatementCorrection | undefined {
  if (!rec(value) || !Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 6
    || !rec(value.source) || value.source.speaker !== 'user' || value.source.reading !== 'olumi'
    || typeof value.source.quote !== 'string' || typeof value.source.source !== 'string') return undefined;
  const source = userStatementOf(value.source);
  if (source === undefined || source.form !== 'describes' || source.low !== undefined || source.high !== undefined
    || !wholeStatementIn(source.source, source.quote)) return undefined;
  const keys = new Set<string>();
  const edits: readonly ApprovedCorrectionEdit[] = value.edits;
  for (const raw of edits) {
    if (!rec(raw) || !rec(raw.subject) || !rec(raw.expected_node) || !rec(raw.retirement)
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
    if (raw.legacy !== undefined && (!rec(raw.legacy) || !['already_true_quote', 'dependency'].includes(String(raw.legacy.field))
      || typeof raw.legacy.expected !== 'string' || !(raw.legacy.replacement === null || typeof raw.legacy.replacement === 'string'))) return undefined;
  }
  return { ...value, source, edits };
}

/** The native postimage. Expected records/nodes are checked before any member changes; a refusal changes nothing. */
export function applyStatementCorrection(graph: unknown, value: unknown): { candidate?: Rec; refused?: string; unchanged?: true } {
  const approved = statementCorrectionOf(value);
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || approved === undefined) return { refused: 'invalid_statement' };
  if (approved.edits.some(e => protectedAttestation(e.expected_record))) return { refused: 'correction_attestation_protected' };
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
    // Compare the exact stored representation, including every retained form, figure and condition.
    if (!isDeepStrictEqual(e.record.statements, JSON.parse(JSON.stringify(replacementStatements(approved.source, e))))) return { refused: 'invalid_statement' };
    if (!isDeepStrictEqual(e.record.attest, correctionAttest(e))) return { refused: 'invalid_statement' };
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
      `Your words: “${s.source}”.`, ...(s.quote === s.source ? [] : [`Quoted words: “${s.quote}”.`]), ...amountWords(s),
      ...(s.reference === undefined ? [] : [`Reference: ${s.reference}.`]), ...(s.period === undefined ? [] : [`Period: ${s.period}.`]),
      ...(s.qualifier === undefined ? [] : [`Olumi’s reading of the relevant words: ${s.qualifier}.`]),
      ...(s.conditions === undefined ? [] : [`Scope and conditions: ${s.conditions}.`]),
      ...(s.negated === true ? ['The statement is negated.'] : []),
    ].join('\n')).join('\n');
  return [`From your message: “${c.source.quote}”. Olumi proposes this reading of your correction.`,
    ...c.edits.flatMap(e => [
      `For ${String(e.expected_node.label)}, correct the ${fieldWords[e.subject.field] ?? 'account'}.`,
      e.retirement.disposition === 'retracted' ? `Withdraw “${e.retirement.quote}” from the current account.`
        : `Keep “${e.retirement.quote}” only as earlier context.`,
      `Keep explicitly: ${e.retained.length ? e.retained.map(q => `“${q}”`).join('; ') : 'nothing from the retired record'}.`,
      ...e.retained.filter(span => !e.expected_record?.statements.some(s => s.quote.includes(span)))
        .map(span => `For the earlier words “${span}”, the original speaker and source are unknown. Your current correction is the human source; it does not verify who supplied those earlier words.`),
      `Earlier source and reading:\n${recordWords(e.expected_record)}`, `Replacement source and reading:\n${recordWords(e.record)}`,
      ...(e.legacy === undefined ? [] : [`${e.legacy.field === 'dependency' ? 'Recorded dependency' : 'Current evidence claim'}: “${e.legacy.expected}” → ${e.legacy.replacement === null ? 'removed from current evidence' : `“${e.legacy.replacement}”`}.`]),
    ]),
    'Only the explicitly kept parts remain current from the earlier account; its other content is withdrawn or kept as earlier context as shown. This card records only the listed source corrections. Other changes need their own supported card. Unknowns, figures, link strengths, options, settings and other people’s recorded views remain unchanged. This records meaning; it does not calculate a numerical effect. Your quote stays yours; the reading remains Olumi’s after approval.',
  ].join('\n');
}

export function prepareStatementCorrection(graph: unknown, request: StatementCorrectionRequest,
  texts: { now?: string; conversation?: string }, at: string): CorrectionResult {
  if (!rec(graph) || !Array.isArray(graph.nodes) || typeof request?.quote !== 'string'
    || !wholeStatementIn(texts.now ?? '', request.quote) || !Array.isArray(request.edits) || request.edits.length === 0) return { refused: 'correction_not_stated' };
  const edits: ApprovedCorrectionEdit[] = [];
  let source: UserStatement | undefined;
  const requested: readonly CorrectionEditRequest[] = request.edits;
  for (const e of requested) {
    if (!rec(e) || !rec(e.subject)) return { refused: 'invalid_statement' };
    const node = nodeOf(graph, e.subject?.id);
    if (node === undefined) return { refused: 'node_not_found' };
    const verified = verifyStatements([{ quote: request.quote, form: 'describes' }], texts,
      { subject: { quantity: subjectKey(e.subject), node_id: e.subject.id }, unit: '', forms: ['describes'], figuresIn: () => [] });
    if (verified.kind === 'refused') return { refused: verified.refusal };
    source = verified.statements[0]!;
    if (!Array.isArray(e.retained)) return { refused: 'retained_list_required' };
    const expected = e.expected_record === undefined ? userStatementFor(graph, e.subject) ?? null : e.expected_record;
    if (protectedAttestation(expected)) return { refused: 'correction_attestation_protected' };
    edits.push({ ...e, expected_record: expected, expected_node: structuredClone(node),
      record: userStatementRecord(e.subject, replacementStatements(source, { ...e, expected_record: expected }), at,
        correctionAttest({ ...e, expected_record: expected })) });
  }
  const correction: StatementCorrection = { source: source!, edits };
  const written = applyStatementCorrection(graph, correction);
  if (written.refused || written.candidate === undefined) return { refused: written.refused ?? 'invalid_statement' };
  return { correction, candidate: written.candidate, words: statementCorrectionWords(correction) };
}
