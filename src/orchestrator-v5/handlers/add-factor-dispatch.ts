/**
 * PJ-E-FIG — the add-factor held transaction (PURE assembly). Delivery Lead #72 5866036457, on Canonical 5866021645.
 *
 * The add-risk door's twin (`add-risk-dispatch.ts`), reached IN-PROCESS by the Agent (`holdAddFactorInProcess`,
 * `system-events/dispatch.ts`). Given the persisted frame and its hash, this module:
 *   1. builds the atomic batch (`buildAddFactorTransaction`: the new factors, then one placeholder link each);
 *   2. referees it through the SAME gate the add-risk and the typed add-option use (`evaluateEditGraphMutations`, under
 *      the typed transaction's envelope cap), so it is HELD as ONE `graph_management_held_v1` pending pinned to that hash;
 *   3. records each factor's figure — the user's, framed by the one rule — on that hold (`GM_HELD_USER_TODAY_KEY`), by
 *      the id THIS batch gives it. Never in the ops (R4): the confirm stamps it in the same apply.
 *
 * Every new factor must carry exactly one such figure: a door that would hold a factor without the user's value holds
 * nothing. The confirm is UNCHANGED: `executeGmHeldResume`, ONE commit under CAS. This module writes no state, makes no
 * model call and never throws.
 */
import type { OlumiResponse, HeldProposalBlock } from '@talchain/schemas/boundary';

import { evaluateEditGraphMutations, GM_HELD_OPERATIONS_MAX_JSON_CHARS, type EditGmChip, type EditGmGoverningVerdict } from './edit-graph-referee-gate.js';
import { chipToBoundaryAction, toGraphView } from './add-option-dispatch.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP, type FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { buildAddFactorTransaction, GM_HELD_USER_TODAY_KEY, isUserTodayObservedState, type AddFactorSkipReason } from '../routing/add-factor-transaction.js';

type StageIndicator = OlumiResponse['stage_indicator'];

export interface AddFactorTransactionInput {
  /** `{ factors: [{ id?, label, link: { to_id, effect_direction } }] }` — see `buildAddFactorTransaction`. */
  readonly params: unknown;
  /** Each factor's figure, in the order of `params.factors`: the user's, framed (`isUserTodayObservedState`). */
  readonly userToday: readonly unknown[];
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

export type AddFactorTransactionOutcome =
  | {
      readonly kind: 'held';
      readonly response: OlumiResponse;
      /** The ONE held pending (GM_HELD_HANDLER_ID inline_patch, with the figures) to commit. */
      readonly pendingActions: readonly PendingAction[];
      /** The new factors' ids, in request order. */
      readonly factorIds: readonly string[];
      /** The confirm chip the gate minted: its id is the `gmh_` handle. */
      readonly chip: EditGmChip;
    }
  | {
      readonly kind: 'refused';
      readonly reason: AddFactorSkipReason | 'gm_not_live' | 'no_graph_hash' | 'unreadable_graph' | 'today_invalid' | 'payload_too_large' | 'not_held';
      readonly governing?: EditGmGoverningVerdict;
    };

export function dispatchAddFactorTransaction(input: AddFactorTransactionInput): AddFactorTransactionOutcome {
  if (input.mode !== 'live') return { kind: 'refused', reason: 'gm_not_live' };
  if (input.currentGraphHash === null) return { kind: 'refused', reason: 'no_graph_hash' };
  const view = toGraphView(input.currentGraph);
  if (view === null) return { kind: 'refused', reason: 'unreadable_graph' };

  const built = buildAddFactorTransaction(input.params, view);
  if (!built.matched) return { kind: 'refused', reason: built.reason };
  const { operations, factors } = built.proposal;
  // ONE figure per factor, each the user's framed one: never a factor held without its value.
  if (input.userToday.length !== factors.length || !input.userToday.every(isUserTodayObservedState)) {
    return { kind: 'refused', reason: 'today_invalid' };
  }
  if (JSON.stringify(operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) return { kind: 'refused', reason: 'payload_too_large' };

  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations,
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
  const chip = decision.suggestedActions?.[0];
  if (decision.governing !== 'held' || decision.pendingActions === null || decision.pendingActions.length !== 1 || chip === undefined) {
    return { kind: 'refused', reason: 'not_held', governing: decision.governing };
  }
  const userToday = factors.map((f, i) => ({ factor_id: f.id, observed_state: { ...(input.userToday[i] as Record<string, unknown>) } }));
  const pending = decision.pendingActions[0]!;
  const ip = pending.action.kind === 'apply_proposed_change' ? pending.action.inline_patch : null;
  // Only a hold carrying the executable batch can carry its figures; anything else is refused whole.
  if (ip === null || typeof ip !== 'object' || !Array.isArray((ip as { operations?: unknown }).operations)) {
    return { kind: 'refused', reason: 'not_held', governing: decision.governing };
  }
  const held = { ...pending, action: { ...pending.action, inline_patch: { ...ip, [GM_HELD_USER_TODAY_KEY]: userToday } } } as PendingAction;
  const blocks: OlumiResponse['blocks'] = decision.heldProposalBlock != null ? [decision.heldProposalBlock as HeldProposalBlock] : [];
  const response: OlumiResponse = {
    response_version: 2,
    assistant_text: decision.assistantText ?? '',
    blocks,
    suggested_actions: (decision.suggestedActions ?? []).map(chipToBoundaryAction),
    insights: [],
    stage_indicator: input.stage,
  } as OlumiResponse;
  return { kind: 'held', response, pendingActions: [held], factorIds: factors.map((f) => f.id), chip };
}
