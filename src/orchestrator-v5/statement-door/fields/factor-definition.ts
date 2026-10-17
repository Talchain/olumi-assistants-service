/**
 * ⭐ WHAT A FACTOR'S QUANTITY COVERS, IN THE USER'S WORDS (DL-3 05:21Z; PROGRAMME-PLAN §156 "a user's qualitative statement has no
 * home"): Paul's served turn (export 6292b268, 17 Oct) answered Olumi's question with "It covers both." (the £500,000 limit on
 * ‘Investment spend’ covers setup and ongoing operations), and Olumi could only say "the available edits cannot record this… not
 * saved", every turn, and lost it on reopen. This row keeps such a statement on the factor's node (`user_statements`, the existing
 * statement-record owner), with Olumi's reading of what it says the quantity covers. It is NON-OPERATIVE: no figure, limit, edge or
 * reading of the model moves, so the analysis is exactly as before; the words and the reading are retained for the reasoning, the
 * AI's working input and reopen.
 *
 * The reading words are the AI's, checked to be written in the quote, or in Olumi's own question the quote answers (bound by that
 * question, `bindsByAnsweredQuestion`, only when the host finds it verbatim in Olumi's last reply). Meaning basis: AIE 6183352754
 * (a safely bound qualitative statement is recorded without a numeric interpretation). Pure.
 */
import { wordsTheUserWrote } from '../../agent-lane/stated-by-user.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { applyStatementRecordEdit, approvedStatementRecordOf, type ApprovedStatementRecord } from '../../goal-target/cohort-forecast-write.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementRecord } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite, FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const FACTOR_DEFINITION_SIGNED_BY = '6183352754';

const factorOf = (subject: DoorSubject, graph: unknown): Rec | undefined => (subject.kind !== 'factor' || subject.option_id !== undefined
  || subject.to_id !== undefined || !isRec(graph) || !Array.isArray(graph.nodes) ? undefined
  : graph.nodes.find((n): n is Rec => isRec(n) && n.kind === 'factor' && n.id === subject.id));
const labelOf = (subject: DoorSubject, graph: unknown, label: string): string => String(factorOf(subject, graph)?.label ?? label).trim();
const cleaned = (words: unknown): string => (typeof words === 'string' ? words.trim().replace(/[.,;:!?]+$/u, '') : '');
/** The reading's words come from Olumi's question the quote answers, not from the user's own sentence. */
const fromQuestion = (s: UserStatement | undefined, words: string | undefined): boolean =>
  s?.answering !== undefined && words !== undefined && !wordsTheUserWrote(words, s.quote);

export const FACTOR_DEFINITION_ROW: RoleRow = {
  field: 'measure',
  unit: '',
  forms: ['describes'],
  carrier: 'statement_record',
  maxStatements: 1,
  signed_by: FACTOR_DEFINITION_SIGNED_BY,
  // The words are kept as the user's; what they say the quantity covers is Olumi's reading of them: "Use this reading".
  derives: true,
  bindsByAnsweredQuestion: true,
  applies: (subject, graph) => factorOf(subject, graph) !== undefined,
  read: (quote, subject, graph, words, answering) => {
    const factor = factorOf(subject, graph);
    if (factor === undefined) return { refused: 'That factor is not in the model.' };
    const w = cleaned(words);
    const asked = typeof answering === 'string' && answering.trim() !== '' ? answering.trim() : undefined;
    if (w === '' || w.length > 160 || /[\r\n]/u.test(w) || !(wordsTheUserWrote(w, quote) || (asked !== undefined && wordsTheUserWrote(w, asked)))) {
      return { refused: `Give reading_words: the words that say what ‘${String(factor.label ?? subject.id).trim()}’ covers, copied from “${quote}”`
        + `${asked !== undefined ? ' or from the question it answers' : ''}.` };
    }
    return { form: 'describes', words: w };
  },
  readingWords: (_s, subject, label, graph, words) => `what ‘${labelOf(subject, graph, label)}’ covers: ${words ?? ''}`,
  assumptions: (statements, subject, graph, words) => {
    const s = statements[0];
    const label = labelOf(subject, graph, subject.id);
    return [
      ...(s?.answering !== undefined ? [`You said this in answer to Olumi’s question: “${s.answering}”${fromQuestion(s, words) ? ' The words '
        + 'for what it covers are that question’s, as your answer confirms them.' : ''}`] : []),
      `It is kept with ‘${label}’ as your words and Olumi’s reading of them. It changes no figure: the model and its analysis use `
        + `‘${label}’ exactly as before.`,
    ];
  },
  recordedWords: (_s, subject, label, graph, words) => `Recorded your words on ‘${labelOf(subject, graph, label)}’, with Olumi’s reading of `
    + `them: what it covers is ${words ?? ''}. No figure changed: the model and its analysis use it exactly as before.`,
  get writer() { return FACTOR_DEFINITION_WRITER; },
};

/** The press's write: the user's statement as the factor's ONE definition record, on its node as `graph` holds it. */
export function factorDefinitionRecord(graph: unknown, reading: DoorReading, at: string): ApprovedStatementRecord | undefined {
  const factor = factorOf(reading.subject, graph);
  if (factor === undefined || reading.statements.length !== 1 || reading.statements[0]!.form !== 'describes') return undefined;
  return { node_id: reading.subject.id, expected_node: structuredClone(factor),
    user_statement: { subject: reading.subject, record: userStatementRecord(reading.subject, reading.statements, at) } };
}

/** The adapter onto the `statement_record` member: the record alone; no figure, limit or edge moves. */
export const FACTOR_DEFINITION_WRITER: FieldWriter = {
  approve(reading: DoorReading, graph: unknown) {
    const approved = factorDefinitionRecord(graph, reading, new Date().toISOString());
    if (approved === undefined) return { refused: 'factor_not_applicable' };
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
