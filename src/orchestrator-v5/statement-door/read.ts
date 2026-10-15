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
import { namesBothEnds } from '../goal-target/input-claim-context.js';
import { isFactorNamedByUser } from '../routing/stated-event-risk.js';
import { verifyStatement, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
import { answeredAsk, askedSubjects, type StatementAsk } from './ask.js';
import { doorRowFor } from './role-table.js';
import { subjectNodeKey, type DoorSubject } from './subject.js';

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

/**
 * One statement as the Agent gives it: the user's exact words, the ask of Olumi's they answer (its exact words), if any, and for a
 * figure-free field its reading in the user's own words (`reading_words`), which the field's reader checks inside the quote.
 */
export type DoorQuote = string | { readonly quote: string; readonly answering?: string; readonly reading_words?: string };

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
    const fig = row.read(quote, subject, graph, typeof raw === 'string' ? undefined : raw.reading_words);
    if ('refused' in fig) return { kind: 'refused', refusal: 'not_this_field', detail: `${fig.refused} Nothing was prepared. ${KEEP}` };
    // Bound by: the row's own whole-model scope (`bindsWhole`), the model's admitted source sentence for it (`sourceOf`), else the
    // figure's clause (or the quote) by `statementBoundTo`.
    const whole = typeof raw !== 'string' && row.bindsWhole?.(quote, subject, graph, raw.reading_words) === true;
    const source = row.sourceOf?.(subject, graph);
    if (!whole && !(source !== undefined && source === quote)
      && statementBoundTo(graph, subject, fig.clause ?? quote, ctx, answering, row.answersFor?.(subject, graph) ?? []) !== 'bound') {
      return { kind: 'refused', refusal: 'not_this_subject', detail: `“${quote}” is not clearly about ‘${label}’, so nothing was prepared. ${KEEP} Ask only what it is about.` };
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
