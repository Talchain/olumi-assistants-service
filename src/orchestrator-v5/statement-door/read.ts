/**
 * ⭐ SYSTEM 1: ONE reading of a user's statement for ONE subject. Each statement is:
 *  - read by its field's shared reader (`RoleRow.read`, SYSTEM 4's table), which gives Olumi's reading of the form and figure, or
 *    the reason it is not this field's reading;
 *  - BOUND to the subject: it names this subject and no other of its kind, or the user's canvas selection is it, or it answers
 *    an ask Olumi said for it (the ask it names, `answeredAsk`, else Olumi's preceding reply in the ask's own words, `ask.ts`).
 *    The one remaining candidate is never proof;
 *  - verified as a WHOLE statement of the user's own verified words, with a figure the quote states (`verifyStatement`).
 * The reading and its assumptions are the table's words. Pure.
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { verifyStatement, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
import { figuresWritten } from '../agent-lane/construction-source-map.js';
import { doorRowFor } from './role-table.js';
import type { DoorSubject } from './subject.js';
import { statementBoundTo, type DoorContext } from './statements.js';
export { statementBoundTo, type DoorContext } from './statements.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * One statement as the Agent gives it: the user's exact words, the ask of Olumi's they answer (its exact words), if any, and for a
 * figure-free field its reading in the user's own words (`reading_words`), which the field's reader checks inside the quote.
 */
export type DoorQuote = string | { readonly quote: string; readonly answering?: string; readonly reading_words?: string } & AiReading;

/**
 * ⭐ ONE BINDER (DL-3 22:53Z + RULING 23:12Z): the AI's own reading of the statement, as the tool gives it, for a row that reads
 * nothing itself (`RoleRow.aiReads`). The host only verifies the quote writes it.
 */
export interface AiReading {
  readonly form?: unknown;
  readonly value?: unknown;
  readonly low?: unknown;
  readonly high?: unknown;
  readonly unit?: unknown;
  readonly negated?: unknown;
}

export interface DoorReading {
  readonly subject: DoorSubject;
  readonly label: string;
  readonly statements: readonly UserStatement[];
  /** Olumi's reading (with the details the reading itself states), and every SEPARATE Olumi assumption, in the table's words. */
  readonly reading: string;
  readonly assumptions: readonly string[];
  /** The user's own words a figure-free reading rests on (`DoorFigure.words`). */
  readonly words?: string;
}

export type DoorRefusal = 'no_table_row' | 'not_answered_now' | 'statement_malformed' | 'not_this_field' | 'not_this_subject' | 'origin_unknown' | 'statement_not_found'
  | 'figure_not_in_quote';
export type DoorVerdict = { readonly kind: 'read'; readonly reading: DoorReading } | { readonly kind: 'refused'; readonly refusal: DoorRefusal; readonly detail: string };

const KEEP = 'Keep the user’s words exactly as they said them and do not ask them to repeat them.';

/**
 * ⭐ AN ANSWER TO OLUMI'S OWN QUESTION (opt-in `bindsByAnsweredQuestion`; BUDDY-A 05:30Z): a fallback only where the quote binds
 * nothing by itself ('unbound', never 'another'). It binds when the question the AI says it answers is verbatim in Olumi's last
 * reply, that whole reply names this subject and no other of its kind, and the user typed the quote in THIS message (never an
 * earlier answer, never a chip). Containment proves where the question came from, never that the user agreed with it.
 */
function answerBinds(graph: unknown, subject: DoorSubject, label: string, quote: string, answering: string | undefined, ctx: DoorContext,
  texts: StatementTexts): 'bound' | Extract<DoorVerdict, { kind: 'refused' }> | undefined {
  const asked = typeof answering === 'string' ? answering.trim() : '';
  if (asked === '') return undefined;
  const reply = typeof ctx.preceding_ask === 'string' ? ctx.preceding_ask : '';
  if (!reply.includes(asked)) {
    return { kind: 'refused', refusal: 'not_this_subject', detail: `“${asked}” is not in Olumi’s last reply, so it does not bind “${quote}”. Nothing was prepared. ${KEEP}` };
  }
  if (statementBoundTo(graph, subject, asked) !== 'bound' || statementBoundTo(graph, subject, reply) !== 'bound') {
    return { kind: 'refused', refusal: 'not_this_subject', detail: `Olumi’s last reply does not ask about ‘${label}’ alone, so “${quote}” is not clearly about it. `
      + `Nothing was prepared. ${KEEP} Ask only which part it is about.` };
  }
  if (!wholeStatementIn(texts.now ?? '', quote)) {
    return { kind: 'refused', refusal: 'not_answered_now', detail: `“${quote}” is not in what the user typed in this message, so it does not answer Olumi’s last `
      + `question. Nothing was prepared. ${KEEP}` };
  }
  return 'bound';
}

/** The user's statements about ONE subject, read, bound and verified, with Olumi's reading; or the first refusal, with the words kept. */
export function readStatement(graph: unknown, subject: DoorSubject, label: string, quotes: readonly DoorQuote[], texts: StatementTexts,
  ctx: DoorContext = {}): DoorVerdict {
  const row = doorRowFor(subject, graph);
  if (row === undefined) return { kind: 'refused', refusal: 'no_table_row', detail: `‘${subject.field}’ of ‘${label}’ is not on the statement door yet. Nothing was prepared.` };
  if (quotes.length === 0 || quotes.length > row.maxStatements) {
    return { kind: 'refused', refusal: 'statement_malformed', detail: `Give one to ${row.maxStatements} of the user's complete statements about ‘${label}’, copied exactly. Nothing was prepared.` };
  }
  const statements: UserStatement[] = [];
  let words: string | undefined;
  for (const raw of quotes) {
    const quote = (typeof raw === 'string' ? raw : raw.quote).trim();
    const answering = typeof raw === 'string' ? undefined : raw.answering;
    if (row.aiReads !== undefined) {
      // ⭐ ONE BINDER: the AI read it (form, figures, unit, negation) and bound it to this subject; the host reads no figure and
      // binds nothing by name. It verifies only that the quote writes that reading (`figuresWritten`, the unit written after the
      // figure), then the row's check of what its field takes. The record is Olumi's reading of the user's words, adopted only by the press.
      if (typeof raw === 'string') {
        return { kind: 'refused', refusal: 'statement_malformed', detail: `Give your reading of “${quote}”: its form, figures, unit as written, and whether it says the opposite (negated). Nothing was prepared.` };
      }
      const v = verifyStatement({ quote, form: raw.form, value: raw.value, low: raw.low, high: raw.high, unit: raw.unit, negated: raw.negated,
        ...(answering !== undefined ? { answering } : {}) }, texts,
      { subject: { quantity: row.quantity ?? subject.field, node_id: subject.id, ...(subject.option_id !== undefined ? { option_id: subject.option_id } : {}) },
        unit: row.unit, forms: row.forms, figuresIn: figuresWritten, unitWritten: true, ...(row.allowsZero === true ? { allowsZero: true } : {}) });
      if (v.kind === 'refused') return { kind: 'refused', refusal: v.refusal === 'different_conditions' ? 'statement_malformed' : v.refusal, detail: v.detail };
      const why = row.aiReads(v.statement, subject, graph);
      if (why !== undefined) return { kind: 'refused', refusal: 'not_this_field', detail: `${why} Nothing was prepared. ${KEEP}` };
      statements.push(v.statement);
      continue;
    }
    const fig = row.read(quote, subject, graph, typeof raw === 'string' ? undefined : raw.reading_words, answering);
    if ('refused' in fig) return { kind: 'refused', refusal: 'not_this_field', detail: `${fig.refused} Nothing was prepared. ${KEEP}` };
    // Bound by: the row's own whole-model scope (`bindsWhole`), the model's admitted source sentence for it (`sourceOf`), else the
    // figure's clause (or the quote) by `statementBoundTo`.
    const whole = typeof raw !== 'string' && row.bindsWhole?.(quote, subject, graph, raw.reading_words) === true;
    const source = row.sourceOf?.(subject, graph);
    if (!whole && !(source !== undefined && source === quote)) {
      const bound = statementBoundTo(graph, subject, fig.clause ?? quote, ctx, answering, row.answersFor?.(subject, graph) ?? []);
      const byAnswer = bound === 'unbound' && row.bindsByAnsweredQuestion === true ? answerBinds(graph, subject, label, quote, answering, ctx, texts) : undefined;
      if (byAnswer !== undefined && byAnswer !== 'bound') return byAnswer;
      if (bound !== 'bound' && byAnswer !== 'bound') {
        return { kind: 'refused', refusal: 'not_this_subject', detail: `“${quote}” is not clearly about ‘${label}’, so nothing was prepared. ${KEEP} Ask only what it is about.` };
      }
    }
    const figures = fig.low === undefined && fig.high === undefined ? [] : [{ low: (fig.low ?? fig.high)!, high: (fig.high ?? fig.low)! }];
    const v = verifyStatement({ quote, form: fig.form, ...(fig.qualifier !== undefined ? { qualifier: fig.qualifier } : {}),
      ...(answering !== undefined ? { answering } : {}),
      ...(fig.form === 'range' ? { low: fig.low, high: fig.high } : { value: fig.form === 'upper_bound' ? fig.high : fig.low }) }, texts,
    { subject: { quantity: row.quantity ?? subject.field, node_id: subject.id, ...(subject.option_id !== undefined ? { option_id: subject.option_id } : {}) },
      unit: row.unit, forms: row.forms, figuresIn: () => figures, ...(row.allowsZero === true ? { allowsZero: true } : {}),
      ...(row.periodOf?.(subject, graph) !== undefined ? { period: row.periodOf(subject, graph) } : {}) });
    if (v.kind === 'refused') {
      return { kind: 'refused', refusal: v.refusal === 'different_conditions' ? 'statement_malformed' : v.refusal, detail: v.detail };
    }
    // A form the row records only from this turn's words: the same statement, verified against what the user typed now alone.
    if (row.answerTypedNow?.forms.includes(fig.form) === true && verifyStatement({ quote, form: fig.form, ...(answering !== undefined ? { answering } : {}),
      ...(fig.form === 'range' ? { low: fig.low, high: fig.high } : { value: fig.form === 'upper_bound' ? fig.high : fig.low }) }, { now: texts.now },
    { subject: { quantity: row.quantity ?? subject.field, node_id: subject.id }, unit: row.unit, forms: row.forms, figuresIn: () => figures }).kind !== 'verified') {
      return { kind: 'refused', refusal: 'not_answered_now', detail: row.answerTypedNow.detail(subject, label, graph) };
    }
    statements.push(v.statement);
    words ??= fig.words;
  }
  const missing = row.incomplete?.(statements, subject, graph, words);
  if (missing !== undefined) return { kind: 'refused', refusal: 'not_this_field', detail: `${missing} Nothing was prepared. ${KEEP}` };
  return { kind: 'read', reading: { subject, label, statements, reading: row.readingWords(statements, subject, label, graph, words),
    assumptions: row.assumptions(statements, subject, graph, words), ...(words !== undefined ? { words } : {}) } };
}
