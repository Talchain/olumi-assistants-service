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
import { readStatement, type DoorContext, type DoorQuote } from './read.js';
import { doorRowFor, ROLE_TABLE, rowKey, type RoleRow } from './role-table.js';
import { isStatementField, subjectKey, SUBJECT_KINDS, type DoorSubject, type SubjectKind } from './subject.js';
import { RECORD_STATEMENT_OP, type DoorWriteMember } from './write.js';
import type { ProposalOperation } from '../agent-lane/proposal.js';
import { RISK_HOLDS_NOW_ROW, windowHoldsAskOf } from './fields/risk.js';
import { SET_OPTION_CAPACITY_CHANGE_OP } from '../goal-target/option-capacity-change.js';
import { RANGE_LAW_ROW, rangeLawUseOf } from './fields/range-law.js';
import { rangeLawAdopted, rangeLawSubject } from '../intervention-range.js';
import { timingAskOf } from './fields/goal-timing.js';
import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { cohortForecastAsks } from './fields/cohort-relation.js';
import { SET_COHORT_FORECAST_OP, SET_STATEMENT_RECORD_OP } from '../goal-target/cohort-forecast-write.js';

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
  /** The write's read-back expectation beyond its payload (`DoorWrite.expected`), as stored. */
  readonly expected?: unknown;
  /** The written postimage adds an Olumi derivation (`RoleRow.derives`): its button is "Use this reading". */
  readonly derives?: boolean;
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
    member: v.member as DoorWriteMember, payload: v.payload, ...(v.expected !== undefined ? { expected: v.expected } : {}),
    ...(v.derives === true ? { derives: true } : {}) };
}

/** The row a stored card was read by, by its key (field, carrier). */
export const doorRowOf = (card: Pick<DoorCard, 'field' | 'carrier'>): RoleRow | undefined => ROLE_TABLE.find((r) => rowKey(r) === rowKey(card));

/**
 * The card's write as its member's OWN operation (the operation that member's press, preview and held-card rule already read),
 * or `undefined` for a member the door does not carry yet.
 */
export function asMemberOp(op: { readonly op: string; readonly value?: unknown }, pressed?: { readonly proposal_id: string }): ProposalOperation | undefined {
  const found = doorCardOf(op);
  if (found === undefined || !isRec(found.payload)) return undefined;
  const card = pressed === undefined ? found : { ...found, payload: confirmedBy(found.payload, pressed.proposal_id) };
  if (!isRec(card.payload)) return undefined;
  if (card.member === 'risk_occurrence' && typeof card.payload.risk_id === 'string') {
    return { op: SET_RISK_OCCURRENCE_OP, path: card.payload.risk_id, value: card.payload };
  }
  // M4-cohort (T8): an option's cohort forecast, and the goal's same-people answer, each through its own level door member.
  if (card.member === 'cohort_forecast' && typeof card.payload.option_id === 'string') {
    return { op: SET_COHORT_FORECAST_OP, path: card.payload.option_id, value: card.payload };
  }
  if (card.member === 'statement_record' && typeof card.payload.node_id === 'string') {
    return { op: SET_STATEMENT_RECORD_OP, path: card.payload.node_id, value: card.payload };
  }
  // M5: the option-capacity member's own registered revision (`applyOptionCapacityChange`), keyed by the option.
  if (card.member === 'option_capacity' && typeof card.payload.option_id === 'string') {
    return { op: SET_OPTION_CAPACITY_CHANGE_OP, path: card.payload.option_id, value: card.payload };
  }
  return undefined;
}

/**
 * ⭐ CLAIM RECORD (spec v2 §1, rule 5): the press confirms the card's NEW claims, each with the host's receipt (the displayed card's
 * proposal id). Claims the payload carries with a status already (another speaker's, kept beside it) are untouched; `said_by` never
 * moves. Applied to the member's payload before its write and its read-back, so both hold the same claims.
 */
function confirmedBy(payload: Rec, proposalId: string): Rec {
  const said = isRec(payload.user_statement) ? payload.user_statement : undefined;
  const record = said !== undefined && isRec(said.record) ? said.record : undefined;
  if (record === undefined || !Array.isArray(record.statements)) return payload;
  const statements = record.statements.map((st: unknown) => (isRec(st) && st.status === undefined
    ? { ...st, status: 'confirmed', approval: { proposal_id: proposalId } } : st));
  return { ...payload, user_statement: { ...said, record: { ...record, statements } } };
}

/** The door's operation for a card: ONE `record_statement`, keyed by its subject. */
export const doorOperation = (card: DoorCard): ProposalOperation => ({ op: RECORD_STATEMENT_OP, path: subjectKey(card.subject), value: card });

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);

/**
 * M5: readiness's ask for what an option sets a factor to ("… What should option ‘O’ set it to?"), in readiness's own words, where
 * the door has the row for that subject (today an option's share of time in the deadline forecast). Its answer binds by the ask.
 */
function optionSettingAsks(graph: unknown): StatementAsk[] {
  return assessCanonicalAnalysisReadiness(graph).blockingIssues.flatMap((i): StatementAsk[] => {
    if (i.code !== 'MISSING_OPTION_VALUE' || typeof i.option_id !== 'string' || typeof i.factor_id !== 'string' || typeof i.message !== 'string') return [];
    const subject: DoorSubject = { kind: 'factor', id: i.factor_id, option_id: i.option_id, field: 'level' };
    return doorRowFor(subject, graph) === undefined ? [] : [{ subject, words: i.message }];
  });
}

/** The readiness asks the door binds an answer to, each in the words readiness says (`analysis-ready-helper` levelGapAsk). */
export function doorAsks(graph: unknown): StatementAsk[] {
  // M4-cohort: each option's forecast questions and the goal's same-people question; M5: an option's share (readiness's own words).
  return [...cohortForecastAsks(graph), ...optionSettingAsks(graph), ...nodesOf(graph).flatMap((n): StatementAsk[] => {
    // M3b: the goal's ONE timing ask (every current option effect at the target's end point), so its answer binds by `answering`.
    if (n.kind === 'goal' && typeof n.id === 'string') { const t = timingAskOf(graph, n.id); return t === undefined ? [] : [t]; }
    if (n.kind !== 'risk' || typeof n.id !== 'string' || typeof n.label !== 'string') return [];
    const e = riskOccurrenceSubject(graph, n.id);
    if (e.kind !== 'eligible') return [];
    // Over a launch period, the brief's "holds now" gets ONE question about that period (`windowHoldsAskOf`), the words readiness says.
    const windowAsk = windowHoldsAskOf(graph, n.id);
    return [{ subject: { kind: 'risk' as const, id: n.id, field: 'holds_now' as const }, words: `Is ‘${n.label.trim()}’ already true now?` },
      ...(windowAsk !== undefined ? [{ subject: { kind: 'risk' as const, id: n.id, field: 'holds_now' as const }, words: windowAsk }] : []),
      { subject: { kind: 'risk' as const, id: n.id, field: 'occurrence' as const }, words: riskOccurrenceAskWords(n.label, e.window_months) }];
  })];
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
  readonly quotes: readonly DoorQuote[] }

/**
 * THIS turn's typed words answer Olumi's question about a launch period (`windowHoldsAskOf`), which Olumi's preceding reply said
 * exactly, with a plain yes the holds-now row reads (`holds_in_window`): ONE risk, else `undefined`. The whole typed message is the
 * quote, bound by that question (`answering`).
 */
export function typedWindowAnswer(graph: unknown, typed: string | null | undefined, ctx: DoorContext): DoorIssueArgs | undefined {
  if (typeof typed !== 'string' || typed.trim() === '' || typeof ctx.preceding_ask !== 'string') return undefined;
  const quote = typed.trim();
  const found = nodesOf(graph).filter((n) => n.kind === 'risk' && typeof n.id === 'string' && typeof n.label === 'string').flatMap((n) => {
    const ask = windowHoldsAskOf(graph, String(n.id));
    if (ask === undefined || !ctx.preceding_ask!.includes(ask)) return [];
    const subject: DoorSubject = { kind: 'risk', id: String(n.id), field: 'holds_now' };
    return readStatement(graph, subject, String(n.label), [{ quote, answering: ask }], { now: typed }, { ...ctx, asks: ctx.asks ?? doorAsks(graph) }).kind === 'read'
      ? [{ subject, quotes: [{ quote, answering: ask }] }] : [];
  });
  return found.length === 1 ? found[0] : undefined;
}

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
  const typedOne = turn.mutated ? undefined : typedDoorStatement(graph, typed, ctx) ?? typedWindowAnswer(graph, typed, ctx);
  if (typedOne !== undefined) return typedOne;
  if (turn.toolCalls.some((c) => c.name.startsWith('propose_'))) return undefined;
  const risks = nodesOf(graph).filter((n) => n.kind === 'risk' && typeof n.id === 'string' && typeof n.label === 'string');
  for (const n of risks) {
    const subject: DoorSubject = { kind: 'risk', id: String(n.id), field: 'holds_now' };
    const quote = RISK_HOLDS_NOW_ROW.sourceOf?.(subject, graph);
    if (quote !== undefined && !('refused' in RISK_HOLDS_NOW_ROW.read(quote, subject, graph))) return { subject, quotes: [quote] };
  }
  // ⭐ AIE 6184726873: a person's likely range whose equal-tail approximation is not adopted gets its approximation card, quoting the
  // words the range was stated in: the chance resting on it is withheld until that press, so the card is the next step.
  for (const o of nodesOf(graph).filter((n) => n.kind === 'option' && typeof n.id === 'string')) {
    const cells = isRec(o.interventions) ? o.interventions : isRec(o.data) && isRec(o.data.interventions) ? o.data.interventions : {};
    for (const factorId of Object.keys(cells)) {
      const subject = rangeLawSubject(String(o.id), factorId);
      const use = rangeLawUseOf(subject, graph);
      if (use === undefined || rangeLawAdopted(graph, String(o.id), use) || doorRowFor(subject, graph) !== RANGE_LAW_ROW) continue;
      const quote = RANGE_LAW_ROW.sourceOf?.(subject, graph);
      if (quote !== undefined && !('refused' in RANGE_LAW_ROW.read(quote, subject, graph))) return { subject, quotes: [quote] };
    }
  }
  return undefined;
}
