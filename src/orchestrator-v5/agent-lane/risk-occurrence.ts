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
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';

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
}

/** Readiness's level rule, on the node as stored (`observed_state`, the V1 `data`, a sampled prior, the event block). */
export function riskHoldsALevel(node: Rec): boolean {
  if (finite(isRec(node.observed_state) ? node.observed_state.value : undefined)) return true;
  if (finite(isRec(node.data) ? node.data.value : undefined)) return true;
  const prior = isRec(node.prior) ? node.prior : undefined;
  if (prior !== undefined && prior.distribution === 'uniform' && finite(prior.range_min) && finite(prior.range_max)
    && prior.range_min !== prior.range_max) return true;
  return node.event_risk !== undefined && node.event_risk !== null;
}

/**
 * The window Olumi's range is stated over: the goal's own period in months, from the ONE goal record's horizon, else the
 * validated target reading's period. One goal only; anything else is `undefined` (no window is ever guessed).
 */
export function riskOccurrenceWindowMonths(graph: unknown): number | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal' && typeof n.id === 'string');
  if (goals.length !== 1) return undefined;
  const held = readGoalRecord(graph, goals[0]!.id as string)?.horizon?.months;
  const months = finite(held) ? held : goalTargetBasisOf(goals[0])?.period_months;
  return finite(months) && Number.isInteger(months) && months >= 1 && months <= 600 ? months : undefined;
}

export type RiskOccurrenceIneligible = 'not_a_risk' | 'holds_a_level' | 'has_a_cause' | 'no_window' | 'unreadable';

/** Whether Olumi may offer a range for this node, and the window it would be stated over. */
export function riskOccurrenceSubject(graph: unknown, nodeId: string):
  { readonly kind: 'eligible'; readonly node: Rec; readonly window_months: number } | { readonly kind: 'ineligible'; readonly reason: RiskOccurrenceIneligible } {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { kind: 'ineligible', reason: 'unreadable' };
  const matches = graph.nodes.filter((n): n is Rec => isRec(n) && n.id === nodeId);
  if (matches.length !== 1) return { kind: 'ineligible', reason: 'unreadable' };
  const node = matches[0]!;
  if (node.kind !== 'risk' || typeof node.label !== 'string' || node.label.trim() === '' || /[\r\n]/.test(node.label)) {
    return { kind: 'ineligible', reason: 'not_a_risk' };
  }
  if (riskHoldsALevel(node)) return { kind: 'ineligible', reason: 'holds_a_level' };
  if (graph.edges.some((e) => isRec(e) && e.to === nodeId)) return { kind: 'ineligible', reason: 'has_a_cause' };
  const window = riskOccurrenceWindowMonths(graph);
  return window === undefined ? { kind: 'ineligible', reason: 'no_window' } : { kind: 'eligible', node, window_months: window };
}

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

/** AIE_TEXT_PENDING: the card's sentence (`recovery/prompt/EVENT-RISK-CARD-DRAFT.txt`). */
export const RISK_OCCURRENCE_CARD_TEMPLATE = 'Adopt Olumi’s starting assumption: the chance that ‘{label}’ happens at least once '
  + 'within {window} is {range}. It stays Olumi’s estimate after you approve it, and the size of its effect is still Olumi’s placeholder.';
/** AIE_TEXT_PENDING: the receipt, said only after the writer's confirmed commit and a matching read-back. */
export const RISK_OCCURRENCE_RECORDED_TEMPLATE = 'Recorded Olumi’s starting assumption: the chance that ‘{label}’ happens at least once '
  + 'within {window} is {range}. It stays marked as Olumi’s estimate: your approval applied it, it did not make it your judgement.';

const fill = (template: string, label: string, block: EventRiskV1T): string => template
  .replace('{label}', () => label.trim()).replace('{window}', () => windowWords(block.horizon.months)).replace('{range}', () => rangeWords(block));
export const riskOccurrenceCardWords = (label: string, block: EventRiskV1T): string => fill(RISK_OCCURRENCE_CARD_TEMPLATE, label, block);
export const riskOccurrenceRecordedWords = (label: string, block: EventRiskV1T): string => fill(RISK_OCCURRENCE_RECORDED_TEMPLATE, label, block);

export type RiskOccurrenceRefusal = 'invalid_graph' | 'invalid_block' | 'risk_not_found' | 'risk_changed' | RiskOccurrenceIneligible;

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
  if (!block.success || block.data.occurrence.basis !== 'olumi' || !isDeepStrictEqual(block.data, approved.event_risk)) {
    return { kind: 'refused', reason: 'invalid_block' };
  }
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.risk_id);
  if (matches.length !== 1) return { kind: 'refused', reason: 'risk_not_found' };
  // ⭐ IDEMPOTENT: a retry after a write that landed finds exactly the card's node with this block, nothing else moved on it.
  if (isDeepStrictEqual(matches[0], { ...approved.expected_node, event_risk: approved.event_risk })) return { kind: 'unchanged' };
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
      safe_summary: 'Recorded Olumi’s starting assumption for a risk',
      impact: 'low',
      rerun_recommended: true,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact], confirmation: riskOccurrenceRecordedWords(label, block.data) };
}

/** The freshly computed atomic write, exactly: the writer's own postimage of `before`, nothing else. */
export function riskOccurrencePostimageIsScoped(before: unknown, after: unknown, approved: ApprovedRiskOccurrence): boolean {
  const written = applyRiskOccurrenceEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}
