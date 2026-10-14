/**
 * ⭐ OLUMI'S STARTING ASSUMPTION FOR A RISK ROOT (DL 14 Oct, hiring path (a); event_risk.v1, Science 393023).
 *
 * Served hiring post3007 (CEE 35a66525, reads/01): the drafter's "Code quality deterioration" is a RISK root with no level,
 * so readiness withheld the whole Run and asked "How likely or how large is … today? … You can also ask Olumi to propose a
 * labelled starting assumption for review." Proven on the real route: `propose_assumptions` refused it (`not_a_factor`,
 * the value door is factor-only), so no card existed and the Run could never be unlocked that way.
 *
 * A risk's level is its OCCURRENCE (`event_risk`, `schemas/event-risk.ts`): the chance the event happens at least once
 * within a window, a stated range with its `basis`. This is the one writer of Olumi's range on an EXISTING risk:
 *  · only a risk ROOT (no incoming link: ISL v1 refuses a driver parent) that holds no level of any kind;
 *  · the window is the goal's own period, read through the ONE goal record or the validated target reading, never
 *    guessed (the range is never rescaled, value-warrant `event_risk.horizon.months`);
 *  · `basis: 'olumi'` before and after approval: the user's press applies Olumi's estimate, it never makes it theirs;
 *  · the links it acts through are untouched (their size stays Olumi's placeholder, still disclosed as Olumi's).
 * Reached ONLY through the atomic level door's `risk_occurrence` member, alone in its commit, after the user pressed the
 * card (card-only, `hasCardOnlyOperations`). Pure.
 */
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { goalTargetBasisOf } from '../goal-target/goal-target-basis.js';
import { readGoalRecord } from '../goal-target/goal-record.js';
import { goalReadingProjectionOf } from '../goal-target/goal-reading-write.js';
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';
import type { UserStatement } from './user-statements.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The proposal op (`proposal.ts`): `path` is the risk's id, `value` is {@link RiskOccurrenceValue}. */
export const SET_RISK_OCCURRENCE_OP = 'set_risk_occurrence' as const;

/** What the card carries and the door writes. */
export interface ApprovedRiskOccurrence {
  readonly risk_id: string;
  /** Olumi's range, as the card showed it. */
  readonly event_risk: EventRiskV1T;
  /** The risk node exactly as stored when the card was made: the stale gate (a rename, a level or a cause moves it). */
  readonly expected_node: Readonly<Rec>;
  /** The one goal whose window the range is stated over, and that goal exactly as it stood ({@link riskOccurrenceGoalSubject}). */
  readonly goal_id: string;
  readonly expected_goal: Readonly<Rec>;
  /**
   * THIS proposal's own write already landed (its partial progress, or its own commit in the ledger): only then is a node that
   * holds exactly the card's block a verified no-op. An equal block is never identity on its own (DL 08:08Z; Codex r1 on #3024).
   */
  readonly own_write_landed?: boolean;
  /**
   * ⭐ S2 "HOLDS NOW" (SCIENCE 16:49Z, AIE #94 6173489813): the user's verified statement that this risk is ALREADY TRUE NOW
   * ("I'm not that experienced with marketing" for ‘Limited marketing experience’). Its block is the user's (`basis: 'user'`,
   * occurrence 1 over the window): never an occurrence chance for a condition the user says already holds. How strongly it
   * acts stays on its link, still Olumi's placeholder.
   */
  readonly holds_now?: UserStatement;
}

/**
 * ⭐ THE GOAL THE CARD'S WINDOW IS STATED OVER, exactly as it stood when the card was made (Codex r1 on #3013: binding the
 * month COUNT let a card made for 14 October–14 January write after the saved window moved to 14 November–14 February, the
 * analysis hash unchanged). The goal's COMPLETE projection (`goalReadingProjectionOf`: label, target, horizon with its
 * deadline, period, reading) and the date its horizon counts from (`goal_horizon_reference_date`, outside the record),
 * as the stored card carries it (JSON). ANY change to it retires the card (DL 14 Oct, conservative); an unrelated edit does not.
 */
export function riskOccurrenceGoalSubject(graph: unknown, goalId: string): Rec | undefined {
  const projection = goalReadingProjectionOf(graph, goalId);
  if (projection === undefined) return undefined;
  const goal = (graph as { nodes: unknown[] }).nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId);
  const starts = typeof goal?.goal_horizon_reference_date === 'string' ? goal.goal_horizon_reference_date : null;
  return JSON.parse(JSON.stringify({ ...projection, starts })) as Rec;
}

/** The card's goal still stands exactly as bound: the one rule the press, the writer and the read-back each read. */
export function riskOccurrenceGoalHolds(approved: Pick<ApprovedRiskOccurrence, 'goal_id' | 'expected_goal'>, graph: unknown): boolean {
  const now = riskOccurrenceGoalSubject(graph, approved.goal_id);
  return now !== undefined && isDeepStrictEqual(now, approved.expected_goal);
}

/** Readiness's level rule, on the node as stored (`observed_state`, the V1 `data`, a sampled prior, a CURRENT event block). */
export function riskHoldsALevel(node: Rec, graph: unknown): boolean {
  if (finite(isRec(node.observed_state) ? node.observed_state.value : undefined)) return true;
  if (finite(isRec(node.data) ? node.data.value : undefined)) return true;
  const prior = isRec(node.prior) ? node.prior : undefined;
  if (prior !== undefined && prior.distribution === 'uniform' && finite(prior.range_min) && finite(prior.range_max)
    && prior.range_min !== prior.range_max) return true;
  if (node.event_risk === undefined || node.event_risk === null) return false;
  // Olumi's own range stated over a window that is no longer the goal's is stale, so no level (offered again over the current
  // window). Any other block, valid or not, is held as it stands and is never overwritten here.
  const block = EventRiskV1.safeParse(node.event_risk);
  return !(block.success && block.data.occurrence.basis === 'olumi' && !riskOccurrenceIsCurrent(node, graph));
}

/**
 * ⭐ AN OCCURRENCE IS A LEVEL ONLY OVER THE GOAL'S CURRENT WINDOW (Codex r2 on #3013: a write landed, the goal's period then
 * moved from 3 to 6 months, and a cold reopen admitted the Run on a 3-month occurrence). Olumi's range (`basis: 'olumi'`) is
 * bound to the window it was offered over: it counts only while that window is the goal's one current period
 * (`riskOccurrenceWindowMonths`); otherwise it is stale, readiness withholds, and the card is offered again over the current
 * window. A user's or a reference range keeps its own stated horizon (unchanged here).
 */
export function riskOccurrenceIsCurrent(node: object, graph: unknown): boolean {
  const block = EventRiskV1.safeParse((node as { event_risk?: unknown }).event_risk);
  if (!block.success) return false;
  return block.data.occurrence.basis !== 'olumi' || block.data.horizon.months === riskOccurrenceWindowMonths(graph);
}

/**
 * The window Olumi's range is stated over: the goal's CURRENT recorded period in months (AIE packet 6e52e896
 * `event_risk.horizon`): the ONE goal record's horizon and the validated target reading's period, wherever held. One goal
 * only, and one period: two recorded periods that disagree are a conflict, never a window licence. Anything else is
 * `undefined` (no window is ever guessed, scaled or chosen between).
 */
export function riskOccurrenceWindowMonths(graph: unknown): number | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal' && typeof n.id === 'string');
  if (goals.length !== 1) return undefined;
  const reading = goalTargetBasisOf(goals[0]);
  const held = readGoalRecord(graph, goals[0]!.id as string)?.horizon?.months;
  // The goal's horizon counts from its own reference date; a reading counted from a launch is a DIFFERENT window, whatever its
  // month count (Codex r1): two such periods are a conflict, never a window. A launch reading alone is the one window.
  if (finite(held) && reading !== undefined && reading.reference !== 'today') return undefined;
  const recorded = [held, reading?.period_months].filter(finite);
  if (recorded.length === 0 || recorded.some((m) => m !== recorded[0])) return undefined;
  const months = recorded[0]!;
  return Number.isInteger(months) && months >= 1 && months <= 600 ? months : undefined;
}

export type RiskOccurrenceIneligible = 'not_a_risk' | 'holds_a_level' | 'has_a_cause' | 'no_window' | 'unreadable';

/** Whether Olumi may offer a range for this node, and the window it would be stated over. */
export function riskOccurrenceSubject(graph: unknown, nodeId: string):
  { readonly kind: 'eligible'; readonly node: Rec; readonly window_months: number; readonly goal_id: string; readonly goal: Rec }
  | { readonly kind: 'ineligible'; readonly reason: RiskOccurrenceIneligible } {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { kind: 'ineligible', reason: 'unreadable' };
  const matches = graph.nodes.filter((n): n is Rec => isRec(n) && n.id === nodeId);
  if (matches.length !== 1) return { kind: 'ineligible', reason: 'unreadable' };
  const node = matches[0]!;
  if (node.kind !== 'risk' || typeof node.label !== 'string' || node.label.trim() === '' || /[\r\n]/.test(node.label)) {
    return { kind: 'ineligible', reason: 'not_a_risk' };
  }
  if (riskHoldsALevel(node, graph)) return { kind: 'ineligible', reason: 'holds_a_level' };
  if (graph.edges.some((e) => isRec(e) && e.to === nodeId)) return { kind: 'ineligible', reason: 'has_a_cause' };
  const window = riskOccurrenceWindowMonths(graph);
  const goalId = graph.nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal')?.id;
  const goal = window !== undefined && typeof goalId === 'string' ? riskOccurrenceGoalSubject(graph, goalId) : undefined;
  return window === undefined || goal === undefined ? { kind: 'ineligible', reason: 'no_window' }
    : { kind: 'eligible', node, window_months: window, goal_id: goalId as string, goal };
}

/** The user's "holds now" as a validated block: certain over the window, the user's own (`ApprovedRiskOccurrence.holds_now`). */
export function userHoldsNowBlock(windowMonths: number): EventRiskV1T | undefined {
  const parsed = EventRiskV1.safeParse({ version: 1,
    occurrence: { p_low: 1, p_high: 1, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: windowMonths } });
  return parsed.success ? parsed.data : undefined;
}
const isHoldsNowBlock = (block: EventRiskV1T): boolean =>
  block.occurrence.basis === 'user' && block.occurrence.p_low === 1 && block.occurrence.p_high === 1 && block.mitigations === undefined;

/** Olumi's range as a validated block, from percentages (0 ≤ low ≤ high ≤ 100), or `undefined`. */
export function olumiOccurrenceBlock(lowPercent: unknown, highPercent: unknown, windowMonths: number): EventRiskV1T | undefined {
  if (!finite(lowPercent) || !finite(highPercent) || lowPercent < 0 || highPercent > 100 || lowPercent > highPercent) return undefined;
  const parsed = EventRiskV1.safeParse({
    version: 1,
    occurrence: { p_low: Number((lowPercent / 100).toFixed(6)), p_high: Number((highPercent / 100).toFixed(6)),
      meaning: 'at_least_once_within_horizon', basis: 'olumi' },
    horizon: { months: windowMonths },
  });
  return parsed.success ? parsed.data : undefined;
}

const windowWords = (months: number): string => (months === 1 ? 'a month' : `${months} months`);
const rangeWords = (block: EventRiskV1T): string => {
  const low = Number((block.occurrence.p_low * 100).toFixed(6));
  const high = Number((block.occurrence.p_high * 100).toFixed(6));
  return low === high ? `${low}%` : `${low}–${high}%`;
};

/** AIE packet 6e52e896 `event_risk.card` (#94 6161383921), byte for byte. */
export const RISK_OCCURRENCE_CARD_TEMPLATE = 'Adopt Olumi’s starting assumption: the chance that ‘{label}’ happens at least once within {window} is {range}. This is an estimate, not a measurement, and it stays Olumi’s after approval. How strongly it affects the model, and whether it does at all, are separate Olumi guesses you can change.';
/** AIE packet 6e52e896 `event_risk.receipt`, byte for byte: said only after the writer's committed write and a matching read-back. */
export const RISK_OCCURRENCE_RECORDED_TEMPLATE = 'Recorded Olumi’s starting assumption: the chance that ‘{label}’ happens at least once within {window} is {range}. It stays marked as Olumi’s estimate: your approval applied it, it did not make it your judgement.';

const fill = (template: string, label: string, block: EventRiskV1T): string => template
  .replace('{label}', () => label.trim()).replace('{window}', () => windowWords(block.horizon.months)).replace('{range}', () => rangeWords(block));
/** AIE packet 6e52e896 `event_risk.readiness_copy`: the question on the eligible event path (readiness, `levelGapAsk`). */
export const RISK_OCCURRENCE_ASK_TEMPLATE = 'How likely is ‘{label}’ to happen at least once within {window}?';
export const riskOccurrenceAskWords = (label: string, windowMonths: number): string => RISK_OCCURRENCE_ASK_TEMPLATE
  .replace('{label}', () => label.trim()).replace('{window}', () => windowWords(windowMonths));
export const riskOccurrenceCardWords = (label: string, block: EventRiskV1T): string => fill(RISK_OCCURRENCE_CARD_TEMPLATE, label, block);
export const riskOccurrenceRecordedWords = (label: string, block: EventRiskV1T): string => fill(RISK_OCCURRENCE_RECORDED_TEMPLATE, label, block);
/** S2 "holds now": the card and receipt. The user's words are quoted; Olumi's reading of them is offered, never assumed. */
export const riskHoldsNowCardWords = (label: string, source: string): string => `From your message: ‘${source}’ Do you want to record that `
  + `‘${label.trim()}’ is already true now? How strongly it affects the model is a separate question, still Olumi’s placeholder on its link.`;
export const riskHoldsNowRecordedWords = (label: string): string => `Recorded from your words: ‘${label.trim()}’ is already true now. `
  + 'How strongly it affects the model is still Olumi’s placeholder on its link.';

export type RiskOccurrenceRefusal = 'invalid_graph' | 'invalid_block' | 'risk_not_found' | 'risk_changed' | 'goal_changed' | RiskOccurrenceIneligible;

export type RiskOccurrenceEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  /** The risk already holds exactly this card's block: a verified no-op (a retry of a write that landed). */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: RiskOccurrenceRefusal };

export function applyRiskOccurrenceEdit(persistedGraph: unknown, approved: ApprovedRiskOccurrence): RiskOccurrenceEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  const block = EventRiskV1.safeParse(approved.event_risk);
  // Olumi's range, or the user's "holds now" with its verified statement: no other block is ever written here.
  const holdsNow = approved.holds_now !== undefined && approved.holds_now.form === 'holds_now';
  if (!block.success || (holdsNow ? !isHoldsNowBlock(block.data) : block.data.occurrence.basis !== 'olumi')
    || !isDeepStrictEqual(block.data, approved.event_risk)) {
    return { kind: 'refused', reason: 'invalid_block' };
  }
  // The window's goal exactly as the card bound it, before anything else (a retry included): its dates, period and reading.
  if (!riskOccurrenceGoalHolds(approved, persistedGraph)) return { kind: 'refused', reason: 'goal_changed' };
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.risk_id);
  if (matches.length !== 1) return { kind: 'refused', reason: 'risk_not_found' };
  // ⭐ IDEMPOTENT, by identity: a retry after THIS proposal's own write landed finds exactly the card's node with this block. The
  // same block found without that identity is a node that changed since the card (refused below), never this card's write.
  if (approved.own_write_landed === true && isDeepStrictEqual(matches[0], { ...approved.expected_node, event_risk: approved.event_risk })) return { kind: 'unchanged' };
  if (!isDeepStrictEqual(matches[0], approved.expected_node)) return { kind: 'refused', reason: 'risk_changed' };
  const subject = riskOccurrenceSubject(persistedGraph, approved.risk_id);
  if (subject.kind === 'ineligible') return { kind: 'refused', reason: subject.reason };
  // The window the card said is still the goal's: a goal period moved since the card refuses.
  if (subject.window_months !== block.data.horizon.months) return { kind: 'refused', reason: 'risk_changed' };

  const graph = structuredClone(persistedGraph) as Rec & { nodes: unknown[] };
  const risk = graph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.risk_id)!;
  risk.event_risk = structuredClone(approved.event_risk);
  const label = String(risk.label).trim();
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'parameter_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'risk', label: label.slice(0, 120) }],
      graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never) || null,
      graph_hash_after: computeAnalysisAffectingGraphHash(graph as never) || null,
      safe_summary: holdsNow ? 'Recorded from your words that a risk is already true now' : 'Recorded Olumi’s starting assumption for a risk',
      impact: 'low',
      rerun_recommended: true,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: holdsNow ? riskHoldsNowRecordedWords(label) : riskOccurrenceRecordedWords(label, block.data) };
}

/** The freshly computed atomic write, exactly: the writer's own postimage of `before`, nothing else. */
export function riskOccurrencePostimageIsScoped(before: unknown, after: unknown, approved: ApprovedRiskOccurrence): boolean {
  const written = applyRiskOccurrenceEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}

/** The card as its stored operation carries it (`agent-capabilities.ts` proposeRiskOccurrence), or `undefined` if malformed. */
export function approvedRiskOccurrenceOf(op: { readonly path: string; readonly value?: unknown }): ApprovedRiskOccurrence | undefined {
  const v = (isRec(op.value) ? op.value : {}) as Rec;
  if (!isRec(v.event_risk) || !isRec(v.expected_node) || typeof v.goal_id !== 'string' || !isRec(v.expected_goal)) return undefined;
  return { risk_id: op.path, event_risk: v.event_risk as EventRiskV1T, expected_node: v.expected_node, goal_id: v.goal_id, expected_goal: v.expected_goal,
    ...(isRec(v.holds_now) ? { holds_now: v.holds_now as unknown as UserStatement } : {}) };
}

/**
 * A held risk card still applies to `graph` exactly when its own writer would not refuse it there (the goal as bound, the
 * node as shown, still eligible over the same window, or its own write already landed): the rule a held card's press and
 * its lapse read (`heldCardStillApplies`, #3024).
 */
export function riskOccurrenceCardHolds(op: { readonly path: string; readonly value?: unknown }, graph: unknown): boolean {
  const approved = approvedRiskOccurrenceOf(op);
  return approved !== undefined && applyRiskOccurrenceEdit(graph, approved).kind !== 'refused';
}
