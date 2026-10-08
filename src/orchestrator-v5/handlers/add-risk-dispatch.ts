/**
 * SLICE C2 — the add-risk held transaction (PURE assembly). Canonical State ruling #70 5855234599.
 *
 * The add-risk twin of `add-option-dispatch.ts`, reached IN-PROCESS by the Agent (`holdAddRiskInProcess`,
 * `system-events/dispatch.ts`) — there is no wire member (`Intent` has no `add_risk`, and a new chip intent would be
 * refused at strict ingress, `route-v2-preflight.ts`). Given the persisted frame and its hash, this module:
 *   1. builds the atomic batch (`buildAddRiskTransaction`: the risk node, then one placeholder link each);
 *   2. referees it through the SAME gate the free-text edit and the typed add-option use
 *      (`evaluateEditGraphMutations`, under the typed transaction's envelope cap), so it is HELD as ONE
 *      `graph_management_held_v1` pending pinned to that hash, with its executable operations embedded;
 *   3. composes the held response (the gate's own copy, `held_proposal` block and confirm chip).
 *
 * The confirm is UNCHANGED: the persisted hold is resumed by the existing `executeGmHeldResume`, which re-referees and
 * applies the WHOLE batch in ONE commit under CAS. This module writes no state, makes no model call and never throws;
 * the caller owns the frame read, the commit of the returned pending and what it answers.
 */
import { GM_HELD_USER_EVENT_RISK_KEY, readUserEventRiskMember } from '../routing/stated-event-risk.js';
import type { OlumiResponse, HeldProposalBlock } from '@talchain/schemas/boundary';

import { evaluateEditGraphMutations, GM_HELD_OPERATIONS_MAX_JSON_CHARS, type EditGmChip, type EditGmGoverningVerdict } from './edit-graph-referee-gate.js';
import { chipToBoundaryAction, toGraphView } from './add-option-dispatch.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP, type FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { buildAddRiskTransaction, type AddRiskSkipReason } from '../routing/add-risk-transaction.js';
import { eventRiskCardLine } from '../agent-lane/stated-event-risk-draft.js';
import { heldReliesOnRiskLines, reliesOnRefereeOperations } from '../routing/relies-on-risk.js';

type StageIndicator = OlumiResponse['stage_indicator'];

export interface AddRiskTransactionInput {
  /** `{ risk: { id?, label }, links: [{ from_id? | to_id?, effect_direction }] }` — see `buildAddRiskTransaction`. */
  readonly params: unknown;
  /** event_risk.v1 slice 2a: validates with EventRiskV1 before holding. */
  readonly userEventRisk?: unknown;
  /** RC3: host-authored option precondition; permits no links and stamps the held add_node itself. */
  readonly reliesOn?: unknown;
  /** The PERSISTED pre-edit graph (the frame authority the hold is pinned to). */
  readonly currentGraph: unknown;
  /** Hash of `currentGraph`, resolved by the caller (never re-derived here). */
  readonly currentGraphHash: string | null;
  readonly freshness: FrameFreshness;
  /** Resolved `CEE_GRAPH_MANAGEMENT_MODE` — a hold exists only under 'live'. */
  readonly mode: 'off' | 'shadow' | 'live';
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly stage: StageIndicator;
}

export type AddRiskTransactionOutcome =
  | {
      readonly kind: 'held';
      readonly response: OlumiResponse;
      /** The ONE held pending (GM_HELD_HANDLER_ID inline_patch) to commit. */
      readonly pendingActions: readonly PendingAction[];
      readonly riskId: string;
      readonly riskLabel: string;
      /** The confirm chip the gate minted: its id is the `gmh_` handle. */
      readonly chip: EditGmChip;
    }
  | {
      /** Nothing held and nothing to commit. */
      readonly kind: 'refused';
      readonly reason: AddRiskSkipReason | 'gm_not_live' | 'no_graph_hash' | 'unreadable_graph' | 'payload_too_large' | 'not_held';
      /** Present when the referee ran but did not hold (diagnostics only). */
      readonly governing?: EditGmGoverningVerdict;
    };

export function dispatchAddRiskTransaction(input: AddRiskTransactionInput): AddRiskTransactionOutcome {
  if (input.mode !== 'live') return { kind: 'refused', reason: 'gm_not_live' };
  if (input.currentGraphHash === null) return { kind: 'refused', reason: 'no_graph_hash' };
  const view = toGraphView(input.currentGraph);
  if (view === null) return { kind: 'refused', reason: 'unreadable_graph' };

  const built = buildAddRiskTransaction(input.params, view, input.reliesOn);
  if (!built.matched) return { kind: 'refused', reason: built.reason };
  const { operations, riskId, riskLabel } = built.proposal;
  const refereeOperations = reliesOnRefereeOperations(operations, input.currentGraph);
  if (refereeOperations === undefined) return { kind: 'refused', reason: 'parameters_invalid' };
  const userEventRisk = input.userEventRisk === undefined ? undefined
    : readUserEventRiskMember({ ...(input.userEventRisk as object), risk_id: riskId });
  if (input.userEventRisk !== undefined && (userEventRisk === undefined || built.proposal.links.some((l) => l.to === riskId))) {
    return { kind: 'refused', reason: 'parameters_invalid' };
  }
  // Past the hold's payload cap the gate would mint a hold in the DECLINE posture, whose "yes" applies nothing.
  if (JSON.stringify(operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) return { kind: 'refused', reason: 'payload_too_large' };

  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations: refereeOperations,
    currentGraph: input.currentGraph,
    currentGraphHash: input.currentGraphHash,
    // Built against this very graph: base_hash_match by construction.
    baseGraphHash: input.currentGraphHash,
    freshness: input.freshness,
    scenarioId: input.scenarioId,
    turnId: input.turnId,
    requestId: input.requestId,
    // Mints the typed held_proposal block on the INITIAL hold (the confirm re-referees as 'gm_held_resume').
    dispatchPath: 'edit_graph',
    // A CEE-built typed transaction, bounded by its builder: judged under the typed ceiling, recorded for the confirm.
    envelopeCap: TYPED_TRANSACTION_ENVELOPE_CAP,
  });
  // Only a HELD verdict with exactly one pending is a hold the user can confirm; anything else is refused whole.
  const heldChip = decision.suggestedActions?.[0];
  if (decision.governing !== 'held' || decision.pendingActions === null || decision.pendingActions.length !== 1 || heldChip === undefined) {
    return { kind: 'refused', reason: 'not_held', governing: decision.governing };
  }
  // The stated likelihood rides on the confirm chip the user reads, in the card record's own words (record.ts).
  const lines = [
    ...(userEventRisk === undefined ? [] : [eventRiskCardLine(userEventRisk.event_risk)]),
    ...heldReliesOnRiskLines(operations, input.currentGraph),
  ];
  const chip: EditGmChip = lines.length === 0 ? heldChip
    : { ...heldChip, detail: [...(heldChip.detail === undefined ? [] : [heldChip.detail]), ...lines].join('\n') };
  const blocks: OlumiResponse['blocks'] = decision.heldProposalBlock != null ? [decision.heldProposalBlock as HeldProposalBlock] : [];
  const response: OlumiResponse = {
    response_version: 2,
    assistant_text: decision.assistantText ?? '',
    blocks,
    suggested_actions: (decision.suggestedActions ?? []).map((c, i) => chipToBoundaryAction(i === 0 ? chip : c)),
    insights: [],
    stage_indicator: input.stage,
  } as OlumiResponse;
  const pending = decision.pendingActions[0]!;
  const pendingActions = input.reliesOn === undefined && userEventRisk === undefined ? decision.pendingActions : [{ ...pending, action: { ...pending.action,
    inline_patch: { ...(pending.action as { inline_patch: Record<string, unknown> }).inline_patch, operations,
      ...(userEventRisk === undefined ? {} : { [GM_HELD_USER_EVENT_RISK_KEY]: userEventRisk }) },
  } } as PendingAction];
  return { kind: 'held', response, pendingActions, riskId, riskLabel, chip };
}
