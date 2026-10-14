/**
 * ⭐ SYSTEM 1: ONE reading of a user's statement for ONE subject. Each statement is:
 *  - read by its field's shared reader (`RoleRow.read`, SYSTEM 4's table), which gives Olumi's reading of the form and figure, or
 *    the reason it is not this field's reading;
 *  - BOUND to the subject: it names this subject and no other of its kind, or the user's canvas selection is it, or Olumi's
 *    preceding reply asked it in the readiness ask's own words (`ask.ts`). The one remaining candidate is never proof;
 *  - verified as a WHOLE statement of the user's own verified words, with a figure the quote states (`verifyStatement`).
 * The reading and its assumptions are the table's words. Pure.
 */
import { namesBothEnds } from '../goal-target/input-claim-context.js';
import { isFactorNamedByUser } from '../routing/stated-event-risk.js';
import { verifyStatement, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
import { askedSubjects, type StatementAsk } from './ask.js';
import { roleRowFor } from './role-table.js';
import { subjectKey, type DoorSubject } from './subject.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What binds a statement to a subject beside its words. */
export interface DoorContext {
  readonly selection?: { readonly element_ids: readonly string[]; readonly unresolved: string };
  /** Olumi's previous reply, bound by the route from the session's own items. */
  readonly preceding_ask?: string;
  /** The current model's readiness asks, each with its subject (`ask.ts`). */
  readonly asks?: readonly StatementAsk[];
}

export interface DoorReading {
  readonly subject: DoorSubject;
  readonly label: string;
  readonly statements: readonly UserStatement[];
  /** Olumi's reading, and every Olumi assumption it rests on, in the table's words. */
  readonly reading: string;
  readonly assumptions: readonly string[];
}

export type DoorRefusal = 'no_table_row' | 'statement_malformed' | 'not_this_field' | 'not_this_subject' | 'origin_unknown' | 'statement_not_found'
  | 'figure_not_in_quote';
export type DoorVerdict = { readonly kind: 'read'; readonly reading: DoorReading } | { readonly kind: 'refused'; readonly refusal: DoorRefusal; readonly detail: string };

const KEEP = 'Keep the user’s words exactly as they said them and do not ask them to repeat them.';

/** The statement is about THIS subject: its words, else the user's selection, else Olumi's preceding ask. */
export function statementBoundTo(graph: unknown, subject: DoorSubject, quote: string, ctx: DoorContext = {}): 'bound' | 'another' | 'unbound' {
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
  const asked = askedSubjects(ctx.preceding_ask, ctx.asks ?? []);
  if (asked.length === 1) return subjectKey(asked[0]!) === subjectKey(subject) ? 'bound' : 'another';
  return 'unbound';
}

/** The user's statements about ONE subject, read, bound and verified, with Olumi's reading; or the first refusal, with the words kept. */
export function readStatement(graph: unknown, subject: DoorSubject, label: string, quotes: readonly string[], texts: StatementTexts,
  ctx: DoorContext = {}): DoorVerdict {
  const row = roleRowFor(subject.field);
  if (row === undefined) return { kind: 'refused', refusal: 'no_table_row', detail: `‘${subject.field}’ is not on the statement door yet. Nothing was prepared.` };
  if (quotes.length === 0 || quotes.length > row.maxStatements) {
    return { kind: 'refused', refusal: 'statement_malformed', detail: `Give one to ${row.maxStatements} of the user's complete statements about ‘${label}’, copied exactly. Nothing was prepared.` };
  }
  const statements: UserStatement[] = [];
  for (const raw of quotes) {
    const quote = raw.trim();
    const fig = row.read(quote, subject, graph);
    if ('refused' in fig) return { kind: 'refused', refusal: 'not_this_field', detail: `${fig.refused} Nothing was prepared. ${KEEP}` };
    if (statementBoundTo(graph, subject, quote, ctx) !== 'bound') {
      return { kind: 'refused', refusal: 'not_this_subject', detail: `“${quote}” is not clearly about ‘${label}’, so nothing was prepared. ${KEEP} Ask only what it is about.` };
    }
    const figures = fig.low === undefined && fig.high === undefined ? [] : [{ low: (fig.low ?? fig.high)!, high: (fig.high ?? fig.low)! }];
    const v = verifyStatement({ quote, form: fig.form, ...(fig.qualifier !== undefined ? { qualifier: fig.qualifier } : {}),
      ...(fig.form === 'range' ? { low: fig.low, high: fig.high } : { value: fig.form === 'upper_bound' ? fig.high : fig.low }) }, texts,
    { subject: { quantity: subject.field, node_id: subject.id, ...(subject.option_id !== undefined ? { option_id: subject.option_id } : {}) },
      unit: row.unit, forms: row.forms, figuresIn: () => figures });
    if (v.kind === 'refused') {
      return { kind: 'refused', refusal: v.refusal === 'different_conditions' ? 'statement_malformed' : v.refusal, detail: v.detail };
    }
    statements.push(v.statement);
  }
  return { kind: 'read', reading: { subject, label, statements, reading: row.readingWords(statements, subject, label, graph),
    assumptions: row.assumptions(statements, subject, graph) } };
}
