/**
 * GOAL-REACH build 1c — the RE-POINT held transaction (PURE assembly). Science §(e) addendum 5 (8 Oct): a risk linked
 * straight into a product goal vetoes Olumi's stored reading (MRR = price × subscribers); the routing ask's answer
 * "through ‘<factor>’" moves that ONE link from the goal to the factor, still unsized, so the reading is coherent again.
 *
 * The twin of `add-risk-dispatch.ts`, reached IN-PROCESS by the bar's routing press (`holdRepointRiskInProcess`,
 * `system-events/dispatch.ts`). Given the persisted frame and its hash, this module:
 *   1. checks the shape (the risk's ONE link into the goal exists, the factor is one of the stored reading's factors and
 *      not already linked from the risk) and builds the atomic batch [remove_edge risk→goal, add_edge risk→factor],
 *      the new link an Olumi placeholder with the old link's direction (both factors raise the goal, so the risk's net
 *      sign on the goal is unchanged);
 *   2. referees it through the SAME gate as the add-risk and free-text edits (`evaluateEditGraphMutations`, typed
 *      envelope cap), so it is HELD as ONE `graph_management_held_v1` pending pinned to that hash (a removal is always
 *      held for an explicit yes: REMOVE_UNCONFIRMED);
 *   3. composes the held response.
 * The confirm is UNCHANGED: `executeGmHeldResume` re-referees and applies the whole batch in ONE commit under CAS.
 * Writes no state, makes no model call and never throws.
 */
import type { OlumiResponse, HeldProposalBlock } from '@talchain/schemas/boundary';

import { evaluateEditGraphMutations, GM_HELD_OPERATIONS_MAX_JSON_CHARS, type EditGmChip, type EditGmGoverningVerdict } from './edit-graph-referee-gate.js';
import { chipToBoundaryAction, toGraphView } from './add-option-dispatch.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP, type FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { hypothesisEdgeValue } from '../routing/add-option-transaction.js';
import { storedReadingVetoOf } from '../agent-lane/identity-proposal.js';

type StageIndicator = OlumiResponse['stage_indicator'];
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface RepointRiskTransactionInput {
  readonly riskId: string;
  /** One of the stored reading's two factor ids (the routing answer). */
  readonly toFactorId: string;
  /** The PERSISTED pre-edit graph (the frame authority the hold is pinned to). */
  readonly currentGraph: unknown;
  readonly currentGraphHash: string | null;
  readonly freshness: FrameFreshness;
  readonly mode: 'off' | 'shadow' | 'live';
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly stage: StageIndicator;
}

export type RepointRiskSkipReason = 'not_the_veto' | 'factor_not_in_reading' | 'already_linked';

export type RepointRiskTransactionOutcome =
  | { readonly kind: 'held'; readonly response: OlumiResponse; readonly pendingActions: readonly PendingAction[]; readonly chip: EditGmChip }
  | {
      readonly kind: 'refused';
      readonly reason: RepointRiskSkipReason | 'gm_not_live' | 'no_graph_hash' | 'unreadable_graph' | 'payload_too_large' | 'not_held';
      readonly governing?: EditGmGoverningVerdict;
    };

/** The batch for a re-point, or the reason it does not apply to this graph (pure; exported for the rows). */
export function buildRepointRiskOperations(graph: unknown, riskId: string, toFactorId: string):
  { readonly ok: true; readonly operations: PatchOperation[] } | { readonly ok: false; readonly reason: RepointRiskSkipReason } {
  // The routing ask exists only for THE one risk vetoing the reading; the same predicate gates the door.
  const veto = storedReadingVetoOf(graph);
  if (veto === null || veto.risk_id !== riskId) return { ok: false, reason: 'not_the_veto' };
  if (!veto.factor_ids.includes(toFactorId)) return { ok: false, reason: 'factor_not_in_reading' };
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  if (edges.some((e) => e.from === riskId && e.to === toFactorId)) return { ok: false, reason: 'already_linked' };
  const old = edges.find((e) => e.from === riskId && e.to === veto.goal_id)!;
  const mean = isRec(old.strength) && typeof old.strength.mean === 'number' ? old.strength.mean : undefined;
  const direction: 'positive' | 'negative' = old.effect_direction === 'negative' || (mean !== undefined && mean < 0) ? 'negative' : 'positive';
  return { ok: true, operations: [
    { op: 'remove_edge', path: `${riskId}::${veto.goal_id}` },
    { op: 'add_edge', path: `${riskId}::${toFactorId}`, value: hypothesisEdgeValue(riskId, toFactorId, direction) },
  ] as PatchOperation[] };
}

export function dispatchRepointRiskTransaction(input: RepointRiskTransactionInput): RepointRiskTransactionOutcome {
  if (input.mode !== 'live') return { kind: 'refused', reason: 'gm_not_live' };
  if (input.currentGraphHash === null) return { kind: 'refused', reason: 'no_graph_hash' };
  if (toGraphView(input.currentGraph) === null) return { kind: 'refused', reason: 'unreadable_graph' };
  const built = buildRepointRiskOperations(input.currentGraph, input.riskId, input.toFactorId);
  if (!built.ok) return { kind: 'refused', reason: built.reason };
  if (JSON.stringify(built.operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) return { kind: 'refused', reason: 'payload_too_large' };

  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations: built.operations,
    currentGraph: input.currentGraph,
    currentGraphHash: input.currentGraphHash,
    baseGraphHash: input.currentGraphHash,
    freshness: input.freshness,
    scenarioId: input.scenarioId,
    turnId: input.turnId,
    requestId: input.requestId,
    dispatchPath: 'edit_graph',
    envelopeCap: TYPED_TRANSACTION_ENVELOPE_CAP,
  });
  const heldChip = decision.suggestedActions?.[0];
  if (decision.governing !== 'held' || decision.pendingActions === null || decision.pendingActions.length !== 1 || heldChip === undefined) {
    return { kind: 'refused', reason: 'not_held', governing: decision.governing };
  }
  const blocks: OlumiResponse['blocks'] = decision.heldProposalBlock != null ? [decision.heldProposalBlock as HeldProposalBlock] : [];
  const response: OlumiResponse = {
    response_version: 2,
    assistant_text: decision.assistantText ?? '',
    blocks,
    suggested_actions: (decision.suggestedActions ?? []).map((c) => chipToBoundaryAction(c)),
    insights: [],
    stage_indicator: input.stage,
  } as OlumiResponse;
  return { kind: 'held', response, pendingActions: decision.pendingActions, chip: heldChip };
}
