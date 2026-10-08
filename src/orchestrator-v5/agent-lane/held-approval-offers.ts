/** Shared Agent approval authority for turns and the opt-in scenario graph read. */
import type { SuggestedAction } from '../compose/types.js';
import { ProposalStore } from './proposal.js';
import { AMEND_CHIP, typedApprovalOf } from './approval-chips.js';
import { offeredApproveChipOnRow, rehydrateProposals } from './durable-proposal.js';
import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../session/pending-action.js';
import { identityReadingOf } from './identity-card.js';
import { identityCardOfferable } from '../system-events/identity-confirm-edit.js';
import type { StructuredProposal } from './proposal.js';

/**
 * ⛔ A HELD IDENTITY CARD IS SHOWN ONLY WHILE IT IS STILL OFFERABLE (#2851 Codex buddy r1 P1-1): a card held from before
 * the part-level gate, or one whose part lost the user's level, would be restored or carried and then refused on its Yes,
 * which is confirm-then-refuse again. Given the graph the caller read, a `confirm_identity` proposal is executable only
 * while `identityCardOfferable` holds on it. Without a graph nothing changes (the hash check stands alone, as before).
 */
export function identityProposalOfferable(proposal: StructuredProposal | undefined, graph: unknown): boolean {
  if (graph === undefined || proposal === undefined || identityReadingOf(proposal) === undefined) return true;
  return identityCardOfferable(graph);
}

/** The SAME process store the turn route authorises and settles. */
export const agentProposals = new ProposalStore();
const proposals = agentProposals;

/** The turn's authorise call, shared verbatim: current analysis-affecting graph hash and verified subject. */
export function executableProposalId(id: string, scenarioId: string, userId: string | null, graphHash: string | undefined, graph?: unknown): string | undefined {
  if (graphHash === undefined) return undefined;
  const decision = proposals.authorise({ proposal_id: id, scenario_id: scenarioId, authenticated_user_id: userId, current_graph_identity_hash: graphHash });
  return decision.status === 'execute' && identityProposalOfferable(proposals.get(id), graph) ? id : undefined;
}

/**
 * THE ONE PREDICATE for "may an approve chip be shown now": the ONE proposal still awaiting a yes for this
 * subject, when the store would EXECUTE it on the revision read back this turn — else nothing (a missing
 * readback fails closed). Used by the fresh Run carry AND by every replay (Codex #1807 5810816841: a
 * replay checked only id membership, so after the model moved a retried Run showed a chip that could not
 * commit).
 */
export function executableWaitingProposal(scenarioId: string, userId: string | null, graphHash: string | undefined, graph?: unknown): string | undefined {
  if (graphHash === undefined) return undefined;
  const waiting = proposals.outstanding(scenarioId, userId);
  if (waiting.length !== 1) return undefined;
  const id = waiting[0]!.proposal_id;
  return executableProposalId(id, scenarioId, userId, graphHash, graph);
}

/** The turn replay's approve/amend pair, in its original order. No other action is inferred. */
export function stillValidApprovalOffers(offered: readonly SuggestedAction[], outstandingProposalIds: ReadonlySet<string>): SuggestedAction[] {
  const approvals = offered.filter((a) => {
    const id = typedApprovalOf({ chip: { id: a.id } });
    return id !== undefined && outstandingProposalIds.has(id);
  });
  return [...approvals, ...(approvals.length > 0 ? [AMEND_CHIP] : [])];
}

export interface HeldProposalOfferRead {
  readonly turn_id: string;
  readonly proposal_id: string;
  readonly suggested_actions: readonly SuggestedAction[];
}

/** At most eight per-turn durable reads per opt-in graph request. */
export const HELD_OFFER_ROWS_READ_CAP = 8;

/**
 * Latest-carrier membership/expiry and integrity FIRST; then the turn's own executable authority.
 * Durable rows supply only the EXACT originally offered control (including detail). At most one card is armed:
 * the newest answer that offered that proposal. A failed authority is unknown and serves no controls.
 * Reading never changes the turn cache: only a fresh local store is rehydrated. Warm settlement is consulted read-only.
 */
export async function readExecutableHeldProposalOffers(input: {
  scenarioId: string; userId: string | null; graphHash: string | undefined;
  latest: readonly PendingAction[];
  /** The graph read with `graphHash`: a held identity card is armed only while it is still offerable on it. */
  graph?: unknown;
  rows: readonly { turn_id: string }[]; // newest first, answer rows only
  store: { readCommittedTurn?: (scenarioId: string, turnId: string) => Promise<{ pending_actions?: readonly unknown[] } | null> };
}): Promise<HeldProposalOfferRead[]> {
  try {
    if (input.graphHash === undefined || typeof input.store.readCommittedTurn !== 'function') return [];
    const subject = { scenario_id: input.scenarioId, user_id: input.userId };
    const live = input.latest.filter(pa => !isPendingActionExpired(pa, Date.now()));
    // A fresh, bounded membership check ensures warm memory cannot resurrect a dropped/expired carrier.
    const membership = new ProposalStore();
    rehydrateProposals(live, membership, subject);
    const candidates = membership.outstanding(input.scenarioId, input.userId);
    if (candidates.length !== 1) return [];
    const id = candidates[0]!.proposal_id;
    const request = { proposal_id: id, scenario_id: input.scenarioId,
      authenticated_user_id: input.userId, current_graph_identity_hash: input.graphHash,
      // Test the exact chip click; the row below must still offer this same typed identity.
      typed_approval_of: id };
    if (membership.authorise(request).status !== 'execute' || !identityProposalOfferable(membership.get(id), input.graph)) return [];
    // get and authorise only read Maps; neither changes order, capacity, or settlement.
    // A known warm refusal (including applied/partial/stale/integrity) vetoes durable authority.
    if (proposals.get(id) !== undefined && proposals.authorise(request).status !== 'execute') return [];
    for (const row of input.rows.slice(0, HELD_OFFER_ROWS_READ_CAP)) {
      // readRecent deliberately omits pending_actions, including on cache hits. Read the scenario-scoped
      // committed carrier for this exact answer, through the SAME path as turn replay.
      const committed = await input.store.readCommittedTurn(input.scenarioId, row.turn_id);
      const pending = (committed?.pending_actions ?? []).map(parsePendingAction).filter((pa): pa is PendingAction => pa !== null);
      const chip = offeredApproveChipOnRow(pending, subject);
      if (chip === undefined || typedApprovalOf({ chip: { id: chip.id } }) !== id) continue;
      return [{ turn_id: row.turn_id, proposal_id: id,
        suggested_actions: stillValidApprovalOffers([chip], new Set([id])) }];
    }
  } catch { /* Fail closed; graph and conversation text remain readable. */ }
  return [];
}
