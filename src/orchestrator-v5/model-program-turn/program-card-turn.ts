/**
 * A model program's held cards across a turn and a reload (inventory F6 part b): the card's own rule (`program-card.ts`) in place
 * of the Living Model's lifecycle and field-scoped rules. A program card holds while its program revision does; one whose
 * revision moved is kept for review and said, never dropped; an applied or declined card goes; an expired one lapses. Same
 * results as the legacy reconcile and reload offer gave a program card (`__tests__/program-card-turn.test.ts`), save one: a
 * reading card whose model the person changed by approving another card goes (Paul, 28 Oct: "Review this change" after "saved").
 */
import { ProposalStore } from '../agent-lane/proposal.js';
import { agentProposalOf, heldProposalId, offeredApproveChipOnRow, rehydrateProposals } from '../agent-lane/durable-proposal.js';
import { agentProposals, HELD_OFFER_ROWS_READ_CAP } from '../agent-lane/agent-proposals.js';
import type { HeldProposalOfferRead } from '../agent-lane/held-approval-offers.js';
import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../session/pending-action.js';
import { AMEND_CHIP, HELD_PROPOSAL_TURN_BUDGET, heldCardForReview, heldCardUnderReviewIn, programCardApplies, PROPOSAL_IDLE_TTL_MS,
  typedApprovalOf } from './program-card.js';

/** The same card with a fresh lifetime. Its pin is never touched. */
export function refreshedProgramHold(hold: PendingAction, nowMs: number): PendingAction {
  return { ...hold, expires_at_turn_count: HELD_PROPOSAL_TURN_BUDGET, expires_at_iso: new Date(nowMs + PROPOSAL_IDLE_TTL_MS).toISOString() };
}

/** Whether a held card still applies to the model read now: by its program revision, or, held before that was recorded, its pin. */
const holdsOn = (card: PendingAction, graph: unknown, graphHash: string): boolean =>
  programCardApplies(agentProposalOf(card), graph) ?? card.preconditions.graph_hash === graphHash;

/**
 * The program cards this answer row carries (the LATEST row's, the store's authority), refreshed and in emission order, and the
 * ones that went without the person (an expired card, or one this turn found that is no longer on the latest row). A card
 * applied or declined is gone, silently: the person did it. A card on an unknown model (`graphHash` undefined) is carried as it
 * stands. Only program cards are carried: a program has no other kind of held change. A READING card whose revision moved
 * because the person applied another card this turn lapses: their approved change replaced the model it read, and confirming
 * it adds nothing (every row stays Olumi's provisional reading). A change card, or a reading moved any other way, is reviewed.
 */
export function reconcileProgramCards(input: {
  readonly atStart: readonly PendingAction[];
  readonly latest: readonly PendingAction[];
  readonly isApplied: (proposalId: string) => boolean;
  readonly declined: ReadonlySet<string>;
  readonly graph: unknown;
  readonly graphHash: string | undefined;
  readonly scenarioId: string;
  readonly nowMs: number;
}): { carried: PendingAction[]; lapsed: PendingAction[] } {
  const cards = (holds: readonly PendingAction[]) => holds.filter((pa) => agentProposalOf(pa) !== undefined && pa.scenario_id === input.scenarioId);
  const gone = (card: PendingAction) => input.declined.has(heldProposalId(card)) || input.isApplied(heldProposalId(card));
  const lapsed: PendingAction[] = [];
  const live: PendingAction[] = [];
  const latest = cards(input.latest);
  const appliedNow = cards(input.atStart).some((card) => input.isApplied(heldProposalId(card)));
  for (const card of latest) {
    if (gone(card)) continue;
    if (isPendingActionExpired(card, input.nowMs)) { lapsed.push(card); continue; }
    const moved = input.graphHash !== undefined && !holdsOn(card, input.graph, input.graphHash);
    if (moved && appliedNow && agentProposalOf(card)?.reading === true) { lapsed.push(card); continue; }
    live.push(moved ? heldCardForReview(card, input.graphHash!) : card);
  }
  const onLatest = new Set(latest.map((h) => h.chip_id));
  for (const card of cards(input.atStart)) if (!onLatest.has(card.chip_id) && !gone(card)) lapsed.push(card);
  return { carried: live.sort((a, b) => a.emitted_at_iso.localeCompare(b.emitted_at_iso)).map((h) => refreshedProgramHold(h, input.nowMs)), lapsed };
}

/**
 * On a reload, the one waiting program card's button, exactly as its answer offered it, while it is still approvable: one card
 * outstanding, not kept for review, its revision the saved program's, and the warm store not refusing it. Durable rows supply
 * only the exact originally offered control. A failed authority is unknown and serves no controls.
 */
export async function readProgramHeldOffers(input: {
  scenarioId: string; userId: string | null; graphHash: string | undefined;
  latest: readonly PendingAction[];
  graph?: unknown;
  rows: readonly { turn_id: string }[]; // newest first, answer rows only
  store: { readCommittedTurn?: (scenarioId: string, turnId: string) => Promise<{ pending_actions?: readonly unknown[] } | null> };
}): Promise<HeldProposalOfferRead[]> {
  try {
    if (input.graphHash === undefined || typeof input.store.readCommittedTurn !== 'function') return [];
    const subject = { scenario_id: input.scenarioId, user_id: input.userId };
    const live = input.latest.filter((pa) => !isPendingActionExpired(pa, Date.now()));
    const membership = new ProposalStore();
    rehydrateProposals(live, membership, subject);
    const candidates = membership.outstanding(input.scenarioId, input.userId);
    if (candidates.length !== 1) return [];
    const id = candidates[0]!.proposal_id;
    if (heldCardUnderReviewIn(live, id)) return [];
    const request = { proposal_id: id, scenario_id: input.scenarioId, authenticated_user_id: input.userId, current_graph_identity_hash: input.graphHash,
      typed_approval_of: id,
      ...(input.graph !== undefined ? { scoped_precondition_holds: (p: unknown) => programCardApplies(p, input.graph) === true } : {}) };
    if (membership.authorise(request).status !== 'execute'
      || (input.graph !== undefined && programCardApplies(membership.get(id), input.graph) === false)) return [];
    if (agentProposals.get(id) !== undefined && agentProposals.authorise(request).status !== 'execute') return [];
    for (const row of input.rows.slice(0, HELD_OFFER_ROWS_READ_CAP)) {
      const committed = await input.store.readCommittedTurn(input.scenarioId, row.turn_id);
      const pending = (committed?.pending_actions ?? []).map(parsePendingAction).filter((pa): pa is PendingAction => pa !== null);
      const chip = offeredApproveChipOnRow(pending, subject);
      if (chip === undefined || typedApprovalOf({ chip: { id: chip.id } }) !== id) continue;
      return [{ turn_id: row.turn_id, proposal_id: id, suggested_actions: [chip, AMEND_CHIP] }];
    }
  } catch { /* Fail closed; graph and conversation text remain readable. */ }
  return [];
}
