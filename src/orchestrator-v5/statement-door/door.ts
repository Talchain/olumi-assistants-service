/**
 * ⭐ SYSTEM 1: the door's seams beside the Agent's tool. A pressed `record_statement` card writes through its row's carrier, the
 * EXISTING level door member, so the press, its preview and a held card's lapse delegate to that member's own operation
 * (`asMemberOp`): there is ONE writer per carrier, never a second. The readiness asks the door binds answers to (`doorAsks`), and
 * the ONE route issuer (`doorIssueArgs`) for a statement the turn's words or the brief already give. Pure.
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { userStatementOf, type UserStatement } from '../agent-lane/user-statements.js';
import { riskOccurrenceAskWords, riskOccurrenceSubject, SET_RISK_OCCURRENCE_OP } from '../agent-lane/risk-occurrence.js';
import type { StatementAsk } from './ask.js';
import { readStatement, type DoorContext } from './read.js';
import { ROLE_TABLE, rowKey, type RoleRow } from './role-table.js';
import { isStatementField, subjectKey, SUBJECT_KINDS, type DoorSubject, type SubjectKind } from './subject.js';
import { RECORD_STATEMENT_OP, type DoorWriteMember } from './write.js';
import type { ProposalOperation } from '../agent-lane/proposal.js';
import { RISK_HOLDS_NOW_ROW } from './rows/risk.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What a `record_statement` operation stores: the subject, its row's key, the verified statements, and the member write. */
export interface DoorCard {
  readonly subject: DoorSubject;
  readonly label: string;
  readonly field: RoleRow['field'];
  readonly carrier: DoorWriteMember;
  readonly statements: readonly UserStatement[];
  readonly member: DoorWriteMember;
  readonly payload: unknown;
}

/** The stored card, as its operation carries it, or `undefined` if malformed. */
export function doorCardOf(op: { readonly op: string; readonly value?: unknown }): DoorCard | undefined {
  if (op.op !== RECORD_STATEMENT_OP || !isRec(op.value)) return undefined;
  const v = op.value;
  const s = isRec(v.subject) ? v.subject : undefined;
  const statements = Array.isArray(v.statements) ? v.statements.map(userStatementOf) : [];
  if (s === undefined || typeof s.id !== 'string' || !isStatementField(s.field) || typeof s.kind !== 'string'
    || !(SUBJECT_KINDS as readonly string[]).includes(s.kind) || typeof v.label !== 'string' || !isStatementField(v.field)
    || typeof v.carrier !== 'string' || typeof v.member !== 'string' || statements.length === 0 || statements.some((x) => x === undefined)) return undefined;
  const subject: DoorSubject = { kind: s.kind as SubjectKind, id: s.id, field: s.field,
    ...(typeof s.to_id === 'string' ? { to_id: s.to_id } : {}), ...(typeof s.option_id === 'string' ? { option_id: s.option_id } : {}) };
  return { subject, label: v.label, field: v.field, carrier: v.carrier as DoorWriteMember, statements: statements as UserStatement[],
    member: v.member as DoorWriteMember, payload: v.payload };
}

/** The row a stored card was read by, by its key (field, carrier). */
export const doorRowOf = (card: Pick<DoorCard, 'field' | 'carrier'>): RoleRow | undefined => ROLE_TABLE.find((r) => rowKey(r) === rowKey(card));

/**
 * The card's write as its member's OWN operation (the operation that member's press, preview and held-card rule already read),
 * or `undefined` for a member the door does not carry yet.
 */
export function asMemberOp(op: { readonly op: string; readonly value?: unknown }): ProposalOperation | undefined {
  const card = doorCardOf(op);
  if (card === undefined || !isRec(card.payload)) return undefined;
  if (card.member === 'risk_occurrence' && typeof card.payload.risk_id === 'string') {
    return { op: SET_RISK_OCCURRENCE_OP, path: card.payload.risk_id, value: card.payload };
  }
  return undefined;
}

/** The door's operation for a card: ONE `record_statement`, keyed by its subject. */
export const doorOperation = (card: DoorCard): ProposalOperation => ({ op: RECORD_STATEMENT_OP, path: subjectKey(card.subject), value: card });

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);

/** The readiness asks the door binds an answer to, each in the words readiness says (`analysis-ready-helper` levelGapAsk). */
export function doorAsks(graph: unknown): StatementAsk[] {
  return nodesOf(graph).flatMap((n) => {
    if (n.kind !== 'risk' || typeof n.id !== 'string' || typeof n.label !== 'string') return [];
    const e = riskOccurrenceSubject(graph, n.id);
    if (e.kind !== 'eligible') return [];
    return [{ subject: { kind: 'risk' as const, id: n.id, field: 'holds_now' as const }, words: `Is ‘${n.label.trim()}’ already true now?` },
      { subject: { kind: 'risk' as const, id: n.id, field: 'occurrence' as const }, words: riskOccurrenceAskWords(n.label, e.window_months) }];
  });
}

/** The user's complete statements in a typed message, each a whole statement of it. */
const statementsIn = (typed: string): string[] => typed.split(/(?<=[.!?;])\s+|\n+/u).map((s) => s.trim())
  .filter((s) => s !== '' && wholeStatementIn(typed, s));

/**
 * THIS turn's typed words state ONE figure the door reads and binds for ONE subject: today a risk's chance ("I'd say there's about a
 * 30% chance it slips within the next 3 months"). Any doubt (none, or more than one) is `undefined`.
 */
export function typedDoorStatement(graph: unknown, typed: string | null | undefined, ctx: DoorContext): DoorIssueArgs | undefined {
  if (typeof typed !== 'string' || typed.trim() === '') return undefined;
  const risks = nodesOf(graph).filter((n) => n.kind === 'risk' && typeof n.id === 'string' && typeof n.label === 'string');
  const found = risks.flatMap((n) => statementsIn(typed).flatMap((quote) => {
    const subject: DoorSubject = { kind: 'risk', id: String(n.id), field: 'occurrence' };
    return readStatement(graph, subject, String(n.label), [quote], { now: typed }, { ...ctx, asks: ctx.asks ?? doorAsks(graph) }).kind === 'read'
      ? [{ subject, quotes: [quote] }] : [];
  }));
  return found.length === 1 ? found[0] : undefined;
}

export interface DoorIssueArgs { readonly subject: { readonly kind: SubjectKind; readonly id: string; readonly field: RoleRow['field'] };
  readonly quotes: readonly string[] }

/**
 * ⭐ THE ONE ROUTE ISSUER (the harness contract: its card's button is "Record what you said", quoting the turn). When the Agent
 * offered nothing:
 *  - THIS turn's typed words state ONE figure the door reads and binds for ONE subject (a risk's chance: "I'd say there's about a
 *    30% chance it slips within the next 3 months"), on a turn that changed, approved and offered nothing; or
 *  - the brief's own sentence the model already holds for a risk (`already_true_quote`, the drafter's reading kept by admission),
 *    on a turn that proposed and approved nothing.
 * Any doubt (none, or more than one) issues nothing. The capability re-verifies, and only the press records.
 */
export function doorIssueArgs(graph: unknown, typed: string | null | undefined, ctx: DoorContext, turn: {
  readonly toolCalls: readonly { readonly name: string }[]; readonly mutated: boolean; readonly proposalOffered: boolean; readonly heldWaiting: boolean;
}): DoorIssueArgs | undefined {
  if (turn.proposalOffered || turn.heldWaiting || turn.toolCalls.some((c) => c.name === 'authorise_change')) return undefined;
  const typedOne = turn.mutated ? undefined : typedDoorStatement(graph, typed, ctx);
  if (typedOne !== undefined) return typedOne;
  if (turn.toolCalls.some((c) => c.name.startsWith('propose_'))) return undefined;
  const risks = nodesOf(graph).filter((n) => n.kind === 'risk' && typeof n.id === 'string' && typeof n.label === 'string');
  for (const n of risks) {
    const subject: DoorSubject = { kind: 'risk', id: String(n.id), field: 'holds_now' };
    const quote = RISK_HOLDS_NOW_ROW.sourceOf?.(subject, graph);
    if (quote !== undefined && !('refused' in RISK_HOLDS_NOW_ROW.read(quote, subject, graph))) return { subject, quotes: [quote] };
  }
  return undefined;
}
