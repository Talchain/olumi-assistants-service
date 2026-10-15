/**
 * ⭐ SYSTEM 1 M1: the risk rows of the door's table, (occurrence, risk_occurrence) and (holds_now, risk_occurrence). Their meaning
 * and words are the AIE's delivered rulings: 6179240850 (the user's own chance of a risk, its window and conditions) and 6178729504
 * (a condition the user says holds now). Each statement is read by the ONE shared occurrence reader
 * (`readStatedEventRiskWithBindingSpan`), never another matcher. Both write through the level door's `risk_occurrence` member, as
 * the user's own block beside their verified statement. Pure.
 */
import { EventRiskV1, type EventRiskV1T } from '../../../schemas/event-risk.js';
import { isFactorNamedByUser, readStatedEventRiskWithBindingSpan, readStatedLikelihoodWithoutWindow } from '../../routing/stated-event-risk.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import {
  alreadyTrueQuoteOf, applyRiskOccurrenceEdit, approvedRiskOccurrenceOf, chanceAsStated, riskEffectBasisWords, riskHoldsNowRecordedWords, riskOccurrenceGoalHolds,
  riskOccurrenceGoalLabel, riskOccurrencePostimageNode, riskOccurrenceSubject, RISK_OCCURRENCE_QUANTITY, statedWindowMonthsWords, riskOccurrenceWindowFromToday, riskStatedOccurrenceRecordedWords,
  userHoldsNowBlock, userOccurrenceBlock, type ApprovedRiskOccurrence,
} from '../../agent-lane/risk-occurrence.js';
import { isDeepStrictEqual } from 'node:util';
import type { DoorFigure, RoleRow } from '../role-table.js';
import type { DoorSubject } from '../subject.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

const APPROXIMATE = /(?<![\p{L}])(?:about|around|roughly|approximately|maybe|perhaps)(?![\p{L}])/iu;
/** A statement that negates what it states, or states it under a condition: never read as stating it (shared with the timing row). */
export const NEGATED = /(?<![\p{L}])(?:not|never|no|won['’]t|wouldn['’]t|isn['’]t|doesn['’]t|don['’]t|can['’]t|cannot)(?![\p{L}])/iu;
export const CONDITIONAL = /(?<![\p{L}])(?:if|unless|assuming|provided|once)(?![\p{L}])/iu;
const KEEP = 'Keep the user’s words exactly as they said them and do not ask them to repeat them.';
const windowSaid = (months: number): string => (months === 1 ? 'a month' : `${months} months`);
const percent = (p: number): number => Number((p * 100).toFixed(6));
const labelOf = (graph: unknown, id: string): string => String((isRec(graph) && Array.isArray(graph.nodes)
  ? graph.nodes.find((n): n is Rec => isRec(n) && n.id === id)?.label : undefined) ?? id).trim();
const optionNamedIn = (graph: unknown, clause: string): boolean => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [])
  .some((n) => isRec(n) && n.kind === 'option' && typeof n.label === 'string' && isFactorNamedByUser(n.label, clause));
const isRisk = (s: DoorSubject): boolean => s.kind === 'risk' && s.to_id === undefined && s.option_id === undefined;

/** Why this risk cannot carry the user's statement as a figure now, said once (never that it is untrue): `undefined` when it can. */
function notRecordable(subject: DoorSubject, graph: unknown, holdsNow: boolean): string | undefined {
  const e = riskOccurrenceSubject(graph, subject.id);
  const label = labelOf(graph, subject.id);
  if (e.kind === 'eligible') {
    // AIE 6178729504: true now licenses "at least once within the window" only for a window counted from TODAY.
    return holdsNow && !riskOccurrenceWindowFromToday(graph) ? `‘${label}’ being true now is the user’s own statement: keep it as theirs, and `
      + 'never say it is not true or not current. It is not written into the model as a figure yet, because the goal’s period counts from the '
      + 'launch, and being true now does not show it still holds then.' : undefined;
  }
  const why = e.reason === 'holds_a_level' ? 'it already holds a likelihood or level'
    : e.reason === 'has_a_cause' ? 'another factor in the model drives it, so it cannot be set directly'
    : e.reason === 'no_window' ? (holdsNow ? 'the model holds a risk over the goal’s time period, and the goal does not have one clear period yet'
      : 'the goal does not have one clear time window yet') : 'the model could not be read for it';
  return holdsNow ? `‘${label}’ being true now is the user’s own statement: keep it as theirs, and never say it is not true or not current. `
    + `It is not written into the model as a figure yet, because ${why}.`
    : `‘${label}’ cannot be recorded with the user’s chance of it happening, because ${why}.`;
}

/** The user's chance as the shared reader reads it: one likelihood-cued figure and ONE stated window, in the same clause. */
function readOccurrence(quote: string, subject: DoorSubject, graph: unknown): DoorFigure | { readonly refused: string } {
  const blocked = notRecordable(subject, graph, false);
  if (blocked !== undefined) return { refused: blocked };
  const e = riskOccurrenceSubject(graph, subject.id);
  const months = e.kind === 'eligible' ? e.window_months : 0;
  const label = labelOf(graph, subject.id);
  const stated = readStatedEventRiskWithBindingSpan(quote);
  if (stated === undefined) {
    return { refused: `“${quote}” does not state one chance over a stated time span that Olumi can read. If it gives a chance, ask only which time span `
      + `it covers, for example within ${windowSaid(months)} from today.` };
  }
  const clause = stated.clause_text;
  /**
   * AIE 6180618773 row 6: refuse only what the carrier cannot hold, and keep the statement either way. A risk's chance is held
   * without conditions, of the event happening: a chance under a condition, of the event NOT happening, or for an option is the
   * user's own estimate of something else, never written as this risk's chance.
   */
  if (CONDITIONAL.test(clause)) {
    return { refused: `“${quote}” gives a chance under a condition. The model holds the chance of ‘${label}’ without conditions, so it is `
      + 'not written as that. Keep their estimate and its condition exactly as they said them; it stays theirs.' };
  }
  if (NEGATED.test(clause) || optionNamedIn(graph, clause)) {
    return { refused: `“${quote}” gives a chance of something other than ‘${label}’ happening (it not happening, or under an option), so it is `
      + 'not written as that risk’s chance. Keep their estimate exactly as they said it; it stays theirs.' };
  }
  const { p_low: low, p_high: high } = stated.event_risk.occurrence;
  // AIE 6179240850: the user's window is theirs. A different span, or the same month count counted from a launch, is never the goal's.
  if (stated.event_risk.horizon.months !== months || !riskOccurrenceWindowFromToday(graph)) {
    return { refused: `“${quote}” covers a different time span from the goal’s window of ${windowSaid(months)} from today, and Olumi never rescales a `
      + `chance. Ask only whether it holds within ${windowSaid(months)} from today.` };
  }
  const qualifier = APPROXIMATE.exec(clause)?.[0];
  return { form: low === high ? 'point' : 'range', low: percent(low), high: percent(high), clause, ...(qualifier !== undefined ? { qualifier } : {}) };
}

/** A condition the user says holds now: a figure-free statement; a statement that gives a CHANCE is the occurrence reading. */
function readHoldsNow(quote: string, subject: DoorSubject, graph: unknown): DoorFigure | { readonly refused: string } {
  if (readStatedEventRiskWithBindingSpan(quote) !== undefined || readStatedLikelihoodWithoutWindow(quote)) {
    return { refused: `“${quote}” gives a chance of it happening, not a condition that holds now: record it as their chance (field occurrence).` };
  }
  const blocked = notRecordable(subject, graph, true);
  return blocked !== undefined ? { refused: blocked } : { form: 'holds_now' };
}

/** The card's bound goal and node, as the writer's stale gates read them. */
function approvedFor(statement: UserStatement, subject: DoorSubject, graph: unknown, block: EventRiskV1T | undefined, holdsNow: boolean):
  ApprovedRiskOccurrence | { readonly refused: string } {
  const e = riskOccurrenceSubject(graph, subject.id);
  if (e.kind !== 'eligible' || block === undefined) return { refused: 'The model changed, so this reading can no longer be recorded. Nothing was prepared.' };
  return { risk_id: subject.id, event_risk: block, expected_node: structuredClone(e.node), goal_id: e.goal_id, expected_goal: structuredClone(e.goal),
    ...(holdsNow ? { holds_now: statement } : { stated_occurrence: statement }), recorded_at: new Date().toISOString() };
}

/** The read-back by identity: the risk holds exactly the card's node with its block, and the goal is still exactly as bound. */
/** The stored payload as the member reads it (`approvedRiskOccurrenceOf`), or `undefined` if malformed. */
export const approvedOf = (payload: unknown): ApprovedRiskOccurrence | undefined => (isRec(payload) && typeof payload.risk_id === 'string'
  ? approvedRiskOccurrenceOf({ path: payload.risk_id, value: payload }) : undefined);
const holdsApproved = (write: { readonly payload: unknown }, after: unknown): boolean => {
  const approved = approvedOf(write.payload);
  if (approved === undefined) return false;
  const held = isRec(after) && Array.isArray(after.nodes) ? after.nodes.find((n) => isRec(n) && n.id === approved.risk_id) : undefined;
  return isDeepStrictEqual(held, riskOccurrencePostimageNode(approved)) && riskOccurrenceGoalHolds(approved, after);
};
const writes = (approved: ApprovedRiskOccurrence, graph: unknown): boolean => applyRiskOccurrenceEdit(graph, approved).kind !== 'refused';

const effectAssumption = (subject: DoorSubject, graph: unknown): string => {
  const e = riskOccurrenceSubject(graph, subject.id);
  const goal = e.kind === 'eligible' ? riskOccurrenceGoalLabel(graph, e.goal_id).trim() : 'the goal';
  return `How strongly it affects ‘${goal}’ is a separate assumption: ${riskEffectBasisWords(graph, subject.id)}.`;
};
const windowOf = (graph: unknown, subject: DoorSubject): number => {
  const e = riskOccurrenceSubject(graph, subject.id);
  return e.kind === 'eligible' ? e.window_months : 0;
};

/** AIE 6179240850: the user's own chance of the risk happening at least once within the goal's window from today. */
export const RISK_OCCURRENCE_ROW: RoleRow = {
  field: 'occurrence', carrier: 'risk_occurrence', unit: '%', forms: ['point', 'range'], maxStatements: 1, signed_by: '6179240850', allowsZero: true,
  quantity: RISK_OCCURRENCE_QUANTITY, periodOf: (subject, graph) => `${windowOf(graph, subject)} months`,
  applies: isRisk,
  read: readOccurrence,
  readingWords: (s, subject, label, graph) => `your estimate of ${chanceAsStated(s[0]!)} that ‘${label.trim()}’ happens at least once `
    + statedWindowMonthsWords(windowOf(graph, subject)),
  assumptions: (_s, subject, graph) => [effectAssumption(subject, graph)],
  // Said after the write, so its window is the block the risk now holds (its own window, as recorded).
  recordedWords: (s, subject, label, graph) => {
    const held = EventRiskV1.safeParse((isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [])
      .find((n): n is Rec => isRec(n) && n.id === subject.id)?.event_risk);
    return held.success ? riskStatedOccurrenceRecordedWords(label, s[0]!, held.data, riskEffectBasisWords(graph, subject.id))
      : `Recorded your estimate for ‘${label.trim()}’.`;
  },
  writer: {
    approve: (r, graph) => {
      const s = r.statements[0]!;
      const approved = approvedFor(s, r.subject, graph, userOccurrenceBlock(s.low, s.high, windowOf(graph, r.subject)), false);
      if ('refused' in approved) return approved;
      return writes(approved, graph) ? { member: 'risk_occurrence', payload: JSON.parse(JSON.stringify(approved)) as unknown }
        : { refused: `‘${r.label}’ cannot hold this reading as written. Nothing was prepared. ${KEEP}` };
    },
    holds: holdsApproved,
  },
};

/** AIE 6178729504: a condition the user says already holds now, kept as theirs; it licenses p = 1 only over a window from today. */
export const RISK_HOLDS_NOW_ROW: RoleRow = {
  field: 'holds_now', carrier: 'risk_occurrence', unit: '', forms: ['holds_now'], maxStatements: 1, signed_by: '6178729504',
  quantity: 'risk_holds_now', applies: isRisk,
  // AIE 6181498097: its write adds Olumi's derivation (true now → at least once within a window from today), so "Use this reading".
  derives: true,
  read: readHoldsNow,
  // The brief's own sentence, which admission kept for this risk (`already_true_quote`): bound by it.
  sourceOf: (subject, graph) => alreadyTrueQuoteOf((isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [])
    .find((n) => isRec(n) && n.id === subject.id)),
  readingWords: (_s, _subject, label) => `‘${label.trim()}’ already being true now`,
  assumptions: (_s, subject, graph) => [effectAssumption(subject, graph)],
  recordedWords: (_s, _subject, label) => riskHoldsNowRecordedWords(label),
  writer: {
    approve: (r, graph) => {
      const approved = approvedFor(r.statements[0]!, r.subject, graph, userHoldsNowBlock(windowOf(graph, r.subject)), true);
      if ('refused' in approved) return approved;
      return writes(approved, graph) ? { member: 'risk_occurrence', payload: JSON.parse(JSON.stringify(approved)) as unknown }
        : { refused: `‘${r.label}’ cannot hold this reading as written. Nothing was prepared. ${KEEP}` };
    },
    holds: holdsApproved,
  },
};
