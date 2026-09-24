/**
 * ⛔ A PENDING APPROVAL SURVIVES A RESTART.
 *
 * Root cause of Paul's failing test (24 Sep 09:39–09:53Z, scenario `d41e2c21`, #63 5811981438): the
 * Agent lane held proposals only in process memory (`agent-v1-turn.ts` `new ProposalStore()`), every
 * staging merge redeploys the one instance, and three redeploys landed inside his session. His "yes"
 * reached a fresh process, `authorise` returned `unknown_proposal`, nothing was saved, and the model
 * stayed unanalysable.
 *
 * The exact stored proposal now travels with the answer row that offered it, on the carrier the product
 * already persists atomically with that row (`pending_actions`, no schema change): an
 * `apply_proposed_change` pending action whose `proposal_ref` is the approve chip's id and whose
 * `inline_patch` carries the proposal. It has NO `handler_id`, so the conventional short-confirm resumer
 * treats it as not-its-own and falls through (`proposed-change-synthesis.ts`: missing/unknown handler_id).
 *
 * A fresh process rehydrates a proposal only when it still HASHES TO ITS ID (the store's own integrity
 * rule — a stored copy that was altered is refused), belongs to THIS scenario and subject, and has not
 * expired. Everything after that is unchanged: `authorise` still refuses a model that moved since
 * (`superseded`), and the writes still use deterministic turn ids, so a re-applied approval replays.
 */
import { randomUUID } from 'node:crypto';

import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';
import { computeProposalId, type ProposalStore, type StructuredProposal } from './proposal.js';

/** The pending action that carries one offered proposal with its answer row. */
export function proposalPendingAction(
  proposal: StructuredProposal,
  chip: { readonly id: string; readonly label: string; readonly message: string },
  ctx: { readonly scenario_id: string; readonly emitted_at_iso: string },
): PendingAction {
  const emitted = Date.parse(ctx.emitted_at_iso);
  return {
    id: randomUUID(),
    scenario_id: ctx.scenario_id,
    chip_id: chip.id,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: chip.id,
      inline_patch: { agent_proposal: JSON.parse(JSON.stringify(proposal)) as Record<string, unknown> },
      public_label: chip.label,
      public_message: chip.message,
    },
    preconditions: {},
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
    expires_at_iso: new Date((Number.isFinite(emitted) ? emitted : Date.now()) + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    emitted_at_iso: ctx.emitted_at_iso,
  };
}

/**
 * Put back every persisted proposal this process no longer holds — when, and only when, it still hashes
 * to its id, belongs to this scenario and subject, and has not expired. Returns how many were restored.
 */
export function rehydrateProposals(
  pending: readonly unknown[],
  store: ProposalStore,
  subject: { readonly scenario_id: string; readonly user_id: string | null },
  nowMs: number = Date.now(),
): number {
  let restored = 0;
  for (const raw of pending) {
    const pa = raw as { scenario_id?: unknown; expires_at_iso?: unknown; action?: { kind?: unknown; inline_patch?: { agent_proposal?: unknown } } };
    if (pa?.action?.kind !== 'apply_proposed_change') continue;
    if (pa.scenario_id !== subject.scenario_id) continue;
    const expires = typeof pa.expires_at_iso === 'string' ? Date.parse(pa.expires_at_iso) : Number.NaN;
    if (!Number.isFinite(expires) || expires <= nowMs) continue;
    const p = pa.action.inline_patch?.agent_proposal as StructuredProposal | undefined;
    if (p === undefined || p === null || typeof p !== 'object' || typeof p.proposal_id !== 'string') continue;
    if (p.scenario_id !== subject.scenario_id || p.user_id !== subject.user_id) continue;
    const { proposal_id: _id, ...content } = p;
    if (computeProposalId(content) !== p.proposal_id) continue;
    if (store.get(p.proposal_id) !== undefined) continue;
    store.put(p);
    restored += 1;
  }
  return restored;
}
