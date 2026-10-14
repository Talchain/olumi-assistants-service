/**
 * ⭐ A HELD CARD IS STALE ONLY WHEN ITS OWN SUBJECT CHANGED (hiring judges post3007/3008/3009, "the deadline card lapses after
 * an unrelated approval"; served post3009 turn 05: approving two link strengths moved the model, and the pending deadline card
 * "no longer fits the model as it now stands, so it has lapsed" while the goal and its date were unchanged). The ONE
 * field-scoped rule, read at BOTH ends of a held card's life:
 *  · the press (`ProposalStore.authorise`'s `scoped_precondition_holds`): a moved model is not `superseded` while it holds;
 *  · the lapse (`reconcileHeldProposals`): a moved model does not lapse the card while it holds.
 * The digest is unchanged (the chip the user sees stays the one they press), the writer CASes on the CURRENT base, and
 * `authorise` still checks the user. Each kind's rule is its own writer's gate:
 *  · a team-time card: what it read is unchanged (`teamTimeReadHolds`);
 *  · a hiring-times card: its parts, carriers and deadline stand (`hiringTimesStillApply`);
 *  · a deadline card: the goal's COMPLETE projection (`goalReadingProjectionOf`: label, target, horizon, period, reading; DL 14 Oct,
 *    the PL's "reuse the complete current goal/reading") is exactly the one the card was made against, so ANY change to the goal
 *    lapses it (conservative) and an unrelated link edit does not. A retry after the card's own write landed is the writer's
 *    own landed-retry contract (the write may relabel an event goal with its date). A card made before its subject was
 *    recorded keeps the whole-model rule.
 * Initial build: session 4's staged work (`/private/tmp/b-lapse`, 14 Oct), extended to the complete goal subject.
 * Any other card keeps the whole-model rule.
 */
import { isDeepStrictEqual } from 'node:util';
import type { StructuredProposal } from '../proposal.js';
import type { PendingAction } from '../../session/pending-action.js';
import { teamTimeReadHolds } from '../../goal-target/team-share-write.js';
import { hiringTimesStillApply, type ApprovedHiringTimes } from '../../goal-target/hiring-times.js';
import { goalDeadlineFromRecord } from '../../goal-target/goal-kind.js';
import { goalReadingProjectionOf } from '../../goal-target/goal-reading-write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** As the stored card carries it (a JSON round trip drops absent members). */
const asStored = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The deadline card's subject at hold time: the goal's complete projection, recorded on the card's own operation. */
export function deadlineCardSubjectOf(graph: unknown, goalId: string): unknown {
  return asStored(goalReadingProjectionOf(graph, goalId));
}

/**
 * Whether a deadline card's recorded subject still holds on `graph`; `undefined` when the card recorded none (made before
 * this rule: its writer keeps its own date gate, and the lapse and press keep the whole-model rule).
 */
export function deadlineSubjectHolds(op: StructuredProposal['operations'][number], graph: unknown): boolean | undefined {
  const v = op.value as { deadline?: unknown; expected_deadline?: unknown; expected_goal?: unknown } | null | undefined;
  if (!isRec(v?.expected_goal)) return undefined;
  if (typeof v.deadline !== 'string' || (v.expected_deadline !== null && typeof v.expected_deadline !== 'string')) return false;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (nodes.filter((n) => n.id === op.path).length !== 1 || !nodes.some((n) => n.id === op.path && n.kind === 'goal')) return false;
  const now = deadlineCardSubjectOf(graph, op.path);
  if (now === undefined) return false;
  const heldNow = goalDeadlineFromRecord(graph, op.path) ?? null;
  // Not yet written: the goal is exactly the one the card was made against, its date included.
  if (heldNow === v.expected_deadline) return isDeepStrictEqual(now, v.expected_goal);
  // A retry of the card's own write that landed: its date is held, and the writer's own landed-retry contract decides
  // (`applyGoalHorizonEdit` / `goalHorizonLandedWriteIsScoped`). The write itself may relabel the goal (an event goal's label
  // takes the date, `withEventShareDate`), so the projection is not compared here.
  if (heldNow === v.deadline) return true;
  return false;
}

export function heldCardStillApplies(p: Pick<StructuredProposal, 'operations'>, graph: unknown): boolean {
  if (teamTimeReadHolds(p, graph)) return true;
  if (p.operations.length !== 1) return false;
  const op = p.operations[0]!;
  if (op.op === 'set_hiring_times') return hiringTimesStillApply(op.value as ApprovedHiringTimes, graph);
  if (op.op === 'set_goal_deadline') return deadlineSubjectHolds(op, graph) === true;
  return false;
}

/**
 * A card whose RECORDED subject moved although the model's hash did not (a goal's date, label or reading can change outside the
 * analysis hash): lapsed by the reconcile too, so ANY change to the card's goal retires it (DL 14 Oct, conservative). A card
 * with no recorded subject is never judged here (the whole-model rule owns it).
 */
export function heldCardSubjectMoved(p: Pick<StructuredProposal, 'operations'>, graph: unknown): boolean {
  return p.operations.length === 1 && p.operations[0]!.op === 'set_goal_deadline' && deadlineSubjectHolds(p.operations[0]!, graph) === false;
}

/**
 * The same rule for a HELD Agent card as a stored pending carries it (`inline_patch.agent_proposal`), at the two lapse seams
 * that see only pendings: a mutating commit's referee (`threadHoldsThroughMutatingCommit`) and the commit's own carry-forward
 * (`computeSurvivingPriorPendingsDetailed`, its hash rule). The hold keeps its pin: an Agent card's pin IS its proposal's base
 * (`agentProposalOf`), so re-pinning it would break the card the user sees.
 */
export function heldAgentCardStillApplies(pa: PendingAction, graph: unknown): boolean {
  if (pa.action.kind !== 'apply_proposed_change') return false;
  const proposal = (pa.action.inline_patch as Rec | undefined)?.['agent_proposal'];
  const operations = isRec(proposal) ? proposal['operations'] : undefined;
  return Array.isArray(operations) && heldCardStillApplies({ operations } as Pick<StructuredProposal, 'operations'>, graph);
}
